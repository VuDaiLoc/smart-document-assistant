import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { TextractClient, StartDocumentTextDetectionCommand } from '@aws-sdk/client-textract';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import mammoth from 'mammoth';
import officeParser from 'officeparser';

const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({});
const textractClient = new TextractClient({});
const bedrockClient = new BedrockRuntimeClient({ region: 'ap-southeast-1' });

const documentTableName = process.env.DOCUMENT_TABLE_NAME;
const userQuotaTableName = process.env.USER_QUOTA_TABLE_NAME;
const textractSnsTopicArn = process.env.TEXTRACT_SNS_TOPIC_ARN;
const textractSnsRoleArn = process.env.TEXTRACT_SNS_ROLE_ARN;
const openrouterApiKey = process.env.OPENROUTER_API_KEY;

// Tìm tài liệu theo s3Key (GSI)
async function getDocumentByS3Key(s3Key: string) {
  const command = new QueryCommand({
    TableName: documentTableName,
    IndexName: 's3Key-index',
    KeyConditionExpression: 's3Key = :s3Key',
    ExpressionAttributeValues: {
      ':s3Key': s3Key,
    },
  });
  const response = await ddbDocClient.send(command);
  return response.Items && response.Items.length > 0 ? response.Items[0] : null;
}

// Cập nhật trạng thái và các thuộc tính khác của tài liệu
async function updateDocument(s3Key: string, status: string, extraAttrs: Record<string, any> = {}) {
  const doc = await getDocumentByS3Key(s3Key);
  if (!doc) {
    console.error(`Document with s3Key ${s3Key} not found in DB`);
    return null;
  }

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
    Key: { id: doc.id },
    UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  });

  await ddbDocClient.send(command);
  console.log(`Updated document ${doc.id} with status: ${status}`);
  return doc;
}

// Tăng số lượng quota đã dùng
async function incrementUserQuota(owner: string) {
  try {
    const command = new UpdateCommand({
      TableName: userQuotaTableName,
      Key: { owner },
      UpdateExpression: 'SET uploadedCount = if_not_exists(uploadedCount, :zero) + :inc, maxUploads = if_not_exists(maxUploads, :maxVal)',
      ExpressionAttributeValues: {
        ':inc': 1,
        ':zero': 0,
        ':maxVal': 50,
      },
    });
    await ddbDocClient.send(command);
    console.log(`Incremented uploadedCount for user ${owner}`);
  } catch (error) {
    console.error(`Failed to increment quota for user ${owner}:`, error);
  }
}

// Tải file từ S3
async function downloadS3Object(bucket: string, key: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);
  if (!response.Body) {
    throw new Error('S3 response body is empty');
  }
  const chunks: any[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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
        continue; // thử model tiếp theo ngay
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
    modelId: 'amazon.nova-lite-v1:0',
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
  console.log('Received S3 Event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const bucketName = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    console.log(`Processing file: ${key} from bucket: ${bucketName}`);

    const extension = key.split('.').pop()?.toLowerCase();
    if (!extension) {
      console.error('File extension not found. Skipping.');
      continue;
    }

    try {
      const doc = await updateDocument(key, 'processing');
      if (doc && doc.owner) {
        await incrementUserQuota(doc.owner);
      }

      if (['pdf', 'jpg', 'jpeg', 'png'].includes(extension)) {
        console.log(`Starting Textract Job for ${key}`);
        const command = new StartDocumentTextDetectionCommand({
          DocumentLocation: {
            S3Object: {
              Bucket: bucketName,
              Name: key,
            },
          },
          NotificationChannel: {
            SNSTopicArn: textractSnsTopicArn,
            RoleArn: textractSnsRoleArn,
          },
        });
        const textractResponse = await textractClient.send(command);
        console.log(`Textract Job started with JobId: ${textractResponse.JobId}`);

        await updateDocument(key, 'processing', {
          textractJobId: textractResponse.JobId,
        });
      } else if (['docx', 'pptx', 'xlsx'].includes(extension)) {
        console.log(`Downloading and parsing office file: ${key}`);
        const buffer = await downloadS3Object(bucketName, key);

        let extractedText = '';
        if (extension === 'docx') {
          const result = await mammoth.extractRawText({ buffer });
          extractedText = result.value;
        } else {
          extractedText = await officeParser.parseOffice(buffer) as any as string;
        }
        console.log(`Extracted ${extractedText.length} characters of text.`);

        console.log('Invoking AI (OpenRouter with Bedrock Fallback) for analysis...');
        const aiResult = await summarizeAndClassify(extractedText);

        await updateDocument(key, 'done', {
          summary: aiResult.summary,
          category: aiResult.category,
          extractedText: extractedText.length > 300000 ? extractedText.slice(0, 300000) : extractedText,
        });
      } else {
        console.warn(`Unsupported file format: ${extension}. Setting status to error.`);
        await updateDocument(key, 'error');
      }
    } catch (error: any) {
      console.error(`Error processing file ${key}:`, error);
      await updateDocument(key, 'error');
    }
  }
};