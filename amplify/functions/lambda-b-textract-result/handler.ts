import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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

// ── PROMPT BUILDER ──────────────────────────────────────────────────────────
function buildPrompt(text: string, mode: string): string {
  const truncated = text.slice(0, 10000);

  const modeInstructions: Record<string, string> = {
    summary_detailed: `Tóm tắt chi tiết đoạn văn bản sau trong 6-10 câu, bao gồm các ý chính, chi tiết quan trọng và kết luận. Sau đó phân loại tài liệu.`,
    summary_short: `Tóm tắt ngắn gọn đoạn văn bản sau trong 2-3 câu, chỉ nêu ý chính nhất. Sau đó phân loại tài liệu.`,
    key_points: `Trích xuất 3-5 điểm chính quan trọng nhất từ văn bản sau dưới dạng danh sách gạch đầu dòng. Gộp tất cả vào trường "summary". Sau đó phân loại tài liệu.`,
    classify_only: `Đọc văn bản sau và chỉ cần xác định phân loại tài liệu. Đặt "summary" là một câu mô tả ngắn về tài liệu.`,
    extract_text: `Phân loại tài liệu dựa trên nội dung văn bản sau. Chỉ trả về category.`,
  };

  const instruction = modeInstructions[mode] ?? modeInstructions['summary_detailed'];

  return `${instruction}

Bạn BẮT BUỘC chỉ trả về JSON thuần túy, không kèm giải thích, không kèm markdown code block:
{
  "summary": "Nội dung ở đây",
  "category": "Hợp đồng" hoặc "Hóa đơn" hoặc "Báo cáo" hoặc "Khác"
}

Văn bản cần xử lý:
${truncated}`;
}

// ── AI HELPERS ──────────────────────────────────────────────────────────────
async function callOpenRouter(prompt: string, apiKey: string): Promise<{ summary: string; category: string }> {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const freeModels = ['openrouter/free', 'meta-llama/llama-3.3-70b-instruct:free'];
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
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
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1 }),
      });

      if (response.status === 429 || response.status === 503) {
        lastErrors.push(`Model ${model} rate-limited (${response.status})`);
        await sleep(300);
        continue;
      }
      if (response.status === 404) { lastErrors.push(`Model ${model} not found`); continue; }
      if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${await response.text()}`);

      const json: any = await response.json();
      const cleaned = json.choices[0].message.content.replace(/```json\s*|\s*```/g, '').trim();
      console.log(`OpenRouter: success with model ${model}`);
      return JSON.parse(cleaned);
    } catch (err: any) {
      lastErrors.push(`${model}: ${err.message}`);
    }
  }
  throw new Error(`OpenRouter all models failed:\n${lastErrors.join('\n')}`);
}

async function callBedrock(prompt: string): Promise<{ summary: string; category: string }> {
  console.log('Using Bedrock Fallback (Amazon Nova Lite)...');
  const command = new InvokeModelCommand({
    modelId: 'apac.amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { max_new_tokens: 500, temperature: 0.1 },
    }),
  });
  const response = await bedrockClient.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body));
  const text: string = body?.output?.message?.content?.[0]?.text ?? '';
  return JSON.parse(text.replace(/```json\s*|\s*```/g, '').trim());
}

async function analyzeWithAI(text: string, mode: string): Promise<{ summary: string; category: string }> {
  const prompt = buildPrompt(text, mode);
  if (openrouterApiKey) {
    try { return await callOpenRouter(prompt, openrouterApiKey); }
    catch (e) { console.error('OpenRouter failed, falling back to Bedrock:', e); }
  } else {
    console.warn('OPENROUTER_API_KEY not set, using Bedrock directly.');
  }
  try { return await callBedrock(prompt); }
  catch (e: any) {
    throw new Error(`AI analysis failed: both OpenRouter and Bedrock unavailable. ${e.message}`);
  }
}

// ── DDB HELPERS ─────────────────────────────────────────────────────────────
async function getDocumentByJobId(jobId: string) {
  const response = await ddbDocClient.send(new QueryCommand({
    TableName: documentTableName,
    IndexName: 'textractJobId-index',
    KeyConditionExpression: 'textractJobId = :jobId',
    ExpressionAttributeValues: { ':jobId': jobId },
  }));
  return response.Items?.[0] ?? null;
}

async function getDocumentById(id: string) {
  const response = await ddbDocClient.send(new GetCommand({
    TableName: documentTableName,
    Key: { id },
  }));
  return response.Item ?? null;
}

async function updateDocument(id: string, status: string, extraAttrs: Record<string, any> = {}) {
  const parts = ['#status = :status'];
  const names: Record<string, string> = { '#status': 'status' };
  const values: Record<string, any> = { ':status': status };

  for (const [k, v] of Object.entries(extraAttrs)) {
    parts.push(`#${k} = :${k}`);
    names[`#${k}`] = k;
    values[`:${k}`] = v;
  }

  await ddbDocClient.send(new UpdateCommand({
    TableName: documentTableName,
    Key: { id },
    UpdateExpression: `SET ${parts.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

// ── S3 HELPERS ───────────────────────────────────────────────────────────────
async function readS3Text(key: string): Promise<string> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: storageBucketName, Key: key }));
  const chunks: any[] = [];
  for await (const chunk of response.Body as any) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

// ── PATH A: SNS Textract callback ────────────────────────────────────────────
async function handleSnsEvent(event: any) {
  const snsRecord = event.Records[0];
  const message = JSON.parse(snsRecord.Sns.Message);
  const { JobId, Status } = message;
  console.log(`[SNS] Textract callback. JobId: ${JobId}, Status: ${Status}`);

  const doc = await getDocumentByJobId(JobId);
  if (!doc) { console.error(`No document found for JobId: ${JobId}`); return; }

  if (Status !== 'SUCCEEDED') {
    await updateDocument(doc.id, 'error');
    return;
  }

  try {
    // Lấy toàn bộ OCR text (paginated)
    let allText = '';
    let nextToken: string | undefined;
    do {
      const result: any = await textractClient.send(new GetDocumentTextDetectionCommand({ JobId, NextToken: nextToken }));
      if (result.Blocks) {
        allText += result.Blocks.filter((b: any) => b.BlockType === 'LINE').map((b: any) => b.Text).join('\n') + '\n';
      }
      nextToken = result.NextToken;
    } while (nextToken);

    console.log(`[SNS] OCR complete. ${allText.length} characters extracted.`);

    // Lưu text → status = text_extracted, chờ user chọn mode
    if (allText.length > 300000) {
      const identityId = doc.s3Key.split('/')[1];
      const processedS3Key = `processed/${identityId}/${doc.id}-text.txt`;
      await s3Client.send(new PutObjectCommand({
        Bucket: storageBucketName, Key: processedS3Key,
        Body: allText, ContentType: 'text/plain; charset=utf-8',
      }));
      await updateDocument(doc.id, 'text_extracted', { processedS3Key });
    } else {
      await updateDocument(doc.id, 'text_extracted', { extractedText: allText });
    }

    console.log(`[SNS] Document ${doc.id} ready for analysis (text_extracted).`);
  } catch (error: any) {
    console.error(`[SNS] Error for JobId ${JobId}:`, error);
    await updateDocument(doc.id, 'error');
  }
}

// ── PATH B: DynamoDB Stream — user đã chọn analysisMode ─────────────────────
async function handleDynamoStreamEvent(event: any) {
  for (const record of event.Records) {
    if (record.eventName !== 'MODIFY') continue;

    const newImage = record.dynamodb?.NewImage;
    if (!newImage) continue;

    const id = newImage.id?.S;
    const status = newImage.status?.S;
    const analysisMode = newImage.analysisMode?.S;

    // Filter: chỉ xử lý khi status=processing và có analysisMode
    if (status !== 'processing' || !analysisMode) continue;

    console.log(`[DDB Stream] Analyzing document ${id} with mode: ${analysisMode}`);

    try {
      const doc = await getDocumentById(id);
      if (!doc) { 
        console.error(`Document ${id} not found`); 
        continue; 
      }

      // Lấy text từ DB hoặc S3
      let text = doc.extractedText ?? '';
      if (!text && doc.processedS3Key) {
        console.log(`[DDB Stream] Loading text from S3: ${doc.processedS3Key}`);
        text = await readS3Text(doc.processedS3Key);
      }
      if (!text) {
        console.error(`[DDB Stream] No text available for document ${id}`);
        await updateDocument(id, 'error');
        continue;
      }

      // Mode đặc biệt: extract_text - không gọi AI, chỉ lưu text vào summary
      if (analysisMode === 'extract_text') {
        console.log(`[DDB Stream] Extract text only mode - skipping AI`);
        // Gọi AI chỉ để classify (prompt ngắn hơn)
        const aiResult = await analyzeWithAI(text, analysisMode);
        await updateDocument(id, 'done', {
          summary: text.slice(0, 50000), // Lưu text vào summary (giới hạn 50k chars)
          category: aiResult.category,
        });
        console.log(`[DDB Stream] Document ${id} extract text complete.`);
        continue;
      }

      // Các mode khác: gọi AI để tóm tắt
      console.log(`[DDB Stream] Calling AI (mode=${analysisMode}, textLen=${text.length})...`);
      const aiResult = await analyzeWithAI(text, analysisMode);

      await updateDocument(id, 'done', {
        summary: aiResult.summary,
        category: aiResult.category,
      });

      console.log(`[DDB Stream] Document ${id} analysis complete.`);
    } catch (error: any) {
      console.error(`[DDB Stream] Error analyzing document ${id}:`, error);
      await updateDocument(id, 'error');
    }
  }
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export const handler = async (event: any) => {
  console.log('Lambda B received event:', JSON.stringify(event, null, 2));

  // Phân biệt nguồn event: SNS hay DynamoDB Stream
  if (event.Records) {
    const firstRecord = event.Records[0];
    
    if (firstRecord.EventSource === 'aws:sns' || firstRecord.eventSource === 'aws:sns') {
      // SNS event từ Textract callback → extract text → status=text_extracted
      await handleSnsEvent(event);
    } else if (firstRecord.eventSource === 'aws:dynamodb') {
      // DynamoDB Stream event → user đã chọn mode → gọi AI
      await handleDynamoStreamEvent(event);
    } else {
      console.warn('Unknown event source:', firstRecord.EventSource ?? firstRecord.eventSource);
    }
  } else {
    console.warn('Event has no Records array');
  }
};
