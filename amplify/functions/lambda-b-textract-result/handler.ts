import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { TextractClient, GetDocumentTextDetectionCommand } from '@aws-sdk/client-textract';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({});
const textractClient = new TextractClient({});
const bedrockClient = new BedrockRuntimeClient({ region: 'ap-southeast-1' });

const documentTableName = process.env.DOCUMENT_TABLE_NAME;
const storageBucketName = process.env.STORAGE_BUCKET_NAME;
const openrouterApiKey = process.env.OPENROUTER_API_KEY;

// Tìm tài liệu theo textractJobId (GSI)
async function getDocumentByJobId(jobId: string) {
  const command = new QueryCommand({
    TableName: documentTableName,
    IndexName: 'textractJobId-index',
    KeyConditionExpression: 'textractJobId = :jobId',
    ExpressionAttributeValues: {
      ':jobId': jobId,
    },
  });
  const response = await ddbDocClient.send(command);
  return response.Items && response.Items.length > 0 ? response.Items[0] : null;
}

// Cập nhật tài liệu
async function updateDocument(id: string, status: string, extraAttrs: Record<string, any> = {}) {
  const updateExpressionParts = ['#status = :status'];
  const expressionAttributeNames: Record<string, string> = { '#status': 'status' };
  const expressionAttributeValues: Record<string, any> = { ':status': status };

  for (const [k, v] of Object.entries(extraAttrs)) {
    const attrName = `#${k}`;
    const attrVal = `:${k}`;
    updateExpressionParts.push(`${attrName} = ${attrVal}`);
    expressionAttributeNames[attrName] = k;
    expressionAttributeValues[attrVal] = v;
  }

  const command = new UpdateCommand({
    TableName: documentTableName,
    Key: { id },
    UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  });

  await ddbDocClient.send(command);
}

// Gọi OpenRouter API với multi-model fallback
async function summarizeAndClassifyWithOpenRouter(text: string, apiKey: string): Promise<{ summary: string; category: string }> {
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  // Router tự động chọn model free đang khả dụng trên OpenRouter — tránh phải
  // tự liệt kê slug model cụ thể (catalog free model đổi/gỡ liên tục, dễ 404/400).
  // Giữ thêm 1 model free ổn định làm lớp dự phòng trước khi rơi xuống Bedrock.
  const freeModels = [
    'openrouter/free',
    'meta-llama/llama-3.3-70b-instruct:free',
  ];

  // Delay ngắn giữa các lần thử model để tránh dồn burst request liên tiếp
  // gây rate-limit dây chuyền trên nhiều model cùng lúc
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const prompt = `Tóm tắt đoạn văn bản sau trong 3-5 câu và phân loại vào một trong các nhóm: [Hợp đồng, Hóa đơn, Báo cáo, Khác]. Bạn BẮT BUỘC chỉ trả về JSON thuần túy, không kèm giải thích, không kèm markdown code block, theo đúng cấu trúc sau:
{
  "summary": "Nội dung tóm tắt ở đây",
  "category": "Hợp đồng" hoặc "Hóa đơn" hoặc "Báo cáo" hoặc "Khác"
}

Văn bản cần xử lý:
${text.slice(0, 10000)}`;

  const lastErrors: string[] = [];

  for (const model of freeModels) {
    try {
      console.log(`OpenRouter: trying model ${model}...`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/aws-amplify/amplify-backend',
          'X-Title': 'Smart Document Assistant',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
        }),
      });

      if (response.status === 429 || response.status === 503) {
        const msg = `Model ${model} rate-limited (${response.status}). Trying next...`;
        console.warn(msg);
        lastErrors.push(msg);
        await sleep(300); // tránh burst request liên tiếp gây rate-limit dây chuyền
        continue; // thử model tiếp theo
      }

      if (response.status === 404) {
        const msg = `Model ${model} not found (404). Trying next...`;
        console.warn(msg);
        lastErrors.push(msg);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errText}`);
      }

      const json: any = await response.json();
      const responseText = json.choices[0].message.content;
      const cleaned = responseText.replace(/```json\s*|\s*```/g, '').trim();
      console.log(`OpenRouter: success with model ${model}`);
      return JSON.parse(cleaned);

    } catch (err: any) {
      const msg = `Model ${model} failed: ${err.message}`;
      console.error(msg);
      lastErrors.push(msg);
      // Tiếp tục thử model tiếp theo
    }
  }

  throw new Error(`OpenRouter: all models failed.\n${lastErrors.join('\n')}`);
}

// Gọi Bedrock làm giải pháp dự phòng
async function summarizeAndClassifyWithBedrock(text: string): Promise<{ summary: string; category: string }> {
  console.log('Using Bedrock Fallback (Amazon Nova Lite)...');

  const prompt = `Tóm tắt đoạn văn bản sau trong 3-5 câu và phân loại vào một trong các nhóm: [Hợp đồng, Hóa đơn, Báo cáo, Khác]. Bạn BẮT BUỘC chỉ trả về JSON thuần túy, không kèm giải thích, không kèm markdown code block, theo đúng cấu trúc sau:
{
  "summary": "Nội dung tóm tắt ở đây",
  "category": "Hợp đồng" hoặc "Hóa đơn" hoặc "Báo cáo" hoặc "Khác"
}

Văn bản cần xử lý:
${text.slice(0, 10000)}`;

  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [{ text: prompt }],
      },
    ],
    inferenceConfig: {
      max_new_tokens: 300,
      temperature: 0.1,
    },
  };

  const command = new InvokeModelCommand({
    // Amazon Nova Lite ở ap-southeast-1 phải gọi qua cross-region inference profile
    // (không dùng được model ID trần "amazon.nova-lite-v1:0" trực tiếp)
    modelId: 'apac.amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const responseText: string = responseBody?.output?.message?.content?.[0]?.text ?? '';
  const cleaned = responseText.replace(/```json\s*|\s*```/g, '').trim();
  return JSON.parse(cleaned);
}

// Gọi OpenRouter làm giải pháp chính (fallback sang Bedrock nếu lỗi)
async function summarizeAndClassify(text: string): Promise<{ summary: string; category: string }> {
  if (openrouterApiKey) {
    try {
      return await summarizeAndClassifyWithOpenRouter(text, openrouterApiKey);
    } catch (openrouterErr) {
      console.error('OpenRouter primary call failed. Attempting fallback to Bedrock...', openrouterErr);
    }
  } else {
    console.warn('OPENROUTER_API_KEY not configured. Falling back to Bedrock directly.');
  }

  try {
    return await summarizeAndClassifyWithBedrock(text);
  } catch (bedrockErr: any) {
    console.error('Bedrock fallback also failed:', bedrockErr);
    throw new Error('AI analysis failed: both OpenRouter and Bedrock unavailable.');
  }
}

export const handler = async (event: any) => {
  console.log('Received SNS Event:', JSON.stringify(event, null, 2));

  const snsRecord = event.Records[0];
  const message = JSON.parse(snsRecord.Sns.Message);
  const { JobId, Status } = message;

  console.log(`Processing Textract callback. JobId: ${JobId}, Status: ${Status}`);

  const doc = await getDocumentByJobId(JobId);
  if (!doc) {
    console.error(`No document found in DynamoDB for Textract JobId: ${JobId}`);
    return;
  }

  if (Status !== 'SUCCEEDED') {
    console.error(`Textract Job ${JobId} failed or returned status: ${Status}`);
    await updateDocument(doc.id, 'error');
    return;
  }

  try {
    let allText = '';
    let nextToken: string | undefined = undefined;

    console.log(`Retrieving Textract results for JobId: ${JobId}`);
    do {
      const result: any = await textractClient.send(new GetDocumentTextDetectionCommand({
        JobId,
        NextToken: nextToken,
      }));

      if (result.Blocks) {
        const pageText = result.Blocks
          .filter((b: any) => b.BlockType === 'LINE')
          .map((b: any) => b.Text)
          .join('\n');
        allText += pageText + '\n';
      }
      nextToken = result.NextToken;
    } while (nextToken);

    console.log(`OCR complete. Extracted ${allText.length} characters.`);

    console.log('Invoking AI (OpenRouter with Bedrock Fallback) for analysis...');
    const aiResult = await summarizeAndClassify(allText);

    const updateAttrs: Record<string, any> = {
      summary: aiResult.summary,
      category: aiResult.category,
    };

    if (allText.length > 300000) {
      const identityId = doc.s3Key.split('/')[1];
      const processedS3Key = `processed/${identityId}/${doc.id}-text.txt`;

      console.log(`Extracted text length (${allText.length}) exceeds threshold. Uploading to S3: ${processedS3Key}`);
      await s3Client.send(new PutObjectCommand({
        Bucket: storageBucketName,
        Key: processedS3Key,
        Body: allText,
        ContentType: 'text/plain; charset=utf-8',
      }));

      updateAttrs.processedS3Key = processedS3Key;
    } else {
      updateAttrs.extractedText = allText;
    }

    await updateDocument(doc.id, 'done', updateAttrs);
    console.log(`Document ${doc.id} processed successfully and set to done.`);

  } catch (error: any) {
    console.error(`Error retrieving or processing results for JobId ${JobId}:`, error);
    await updateDocument(doc.id, 'error');
  }
};