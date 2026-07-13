import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { TextractClient, StartDocumentTextDetectionCommand } from '@aws-sdk/client-textract';
import mammoth from 'mammoth';
import officeParser from 'officeparser';
import * as pdfParse from 'pdf-parse';
// pdf-parse là CommonJS module, gọi như function trực tiếp
const parsePdf: (buffer: Buffer) => Promise<{ text: string }> = (pdfParse as any).default ?? pdfParse;

const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({});
const textractClient = new TextractClient({});

const documentTableName = process.env.DOCUMENT_TABLE_NAME;
const userQuotaTableName = process.env.USER_QUOTA_TABLE_NAME;
const textractSnsTopicArn = process.env.TEXTRACT_SNS_TOPIC_ARN;
const textractSnsRoleArn = process.env.TEXTRACT_SNS_ROLE_ARN;
const storageBucketName = process.env.STORAGE_BUCKET_NAME;

// Tìm tài liệu theo s3Key (GSI)
async function getDocumentByS3Key(s3Key: string) {
  const command = new QueryCommand({
    TableName: documentTableName,
    IndexName: 's3Key-index',
    KeyConditionExpression: 's3Key = :s3Key',
    ExpressionAttributeValues: { ':s3Key': s3Key },
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
      ExpressionAttributeValues: { ':inc': 1, ':zero': 0, ':maxVal': 50 },
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
  if (!response.Body) throw new Error('S3 response body is empty');
  const chunks: any[] = [];
  for await (const chunk of response.Body as any) chunks.push(chunk);
  return Buffer.concat(chunks);
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
      // Cập nhật status → processing và tăng quota
      const doc = await updateDocument(key, 'processing');
      if (doc && doc.owner) {
        await incrementUserQuota(doc.owner);
      }

      if (['pdf', 'jpg', 'jpeg', 'png'].includes(extension)) {
        // ── PDF: thử extract text trực tiếp trước (giữ nguyên Unicode/dấu tiếng Việt)
        // Chỉ fallback Textract OCR khi PDF là scan (text quá ít)
        if (extension === 'pdf') {
          console.log(`Trying direct PDF text extraction for: ${key}`);
          try {
            const buffer = await downloadS3Object(bucketName, key);
            const pdfData = await parsePdf(buffer);
            const extractedText = pdfData.text?.trim() ?? '';

            // Nếu extract được đủ text → lưu thẳng, không cần Textract
            if (extractedText.length > 100) {
              console.log(`PDF has native text (${extractedText.length} chars), skipping Textract.`);
              if (extractedText.length > 300000) {
                const identityId = key.split('/')[1];
                const processedS3Key = `processed/${identityId}/${doc!.id}-text.txt`;
                await s3Client.send(new PutObjectCommand({
                  Bucket: storageBucketName, Key: processedS3Key,
                  Body: extractedText, ContentType: 'text/plain; charset=utf-8',
                }));
                await updateDocument(key, 'text_extracted', { processedS3Key });
              } else {
                await updateDocument(key, 'text_extracted', { extractedText });
              }
              continue; // bỏ qua Textract
            }
            console.log(`PDF has little/no native text (${extractedText.length} chars), falling back to Textract OCR.`);
          } catch (pdfErr) {
            console.warn(`pdf-parse failed, falling back to Textract:`, pdfErr);
          }
        }

        // ── PDF scan / ẢNH: dùng Textract async OCR ─────────────────────
        console.log(`Starting Textract async job for: ${key}`);
        const command = new StartDocumentTextDetectionCommand({
          DocumentLocation: { S3Object: { Bucket: bucketName, Name: key } },
          NotificationChannel: {
            SNSTopicArn: textractSnsTopicArn,
            RoleArn: textractSnsRoleArn,
          },
        });
        const textractResponse = await textractClient.send(command);
        console.log(`Textract Job started: ${textractResponse.JobId}`);

        await updateDocument(key, 'processing', {
          textractJobId: textractResponse.JobId,
        });

      } else if (['docx', 'pptx', 'xlsx'].includes(extension)) {
        // ── DOCX / PPTX: parse local, lưu text → status = text_extracted ─
        console.log(`Parsing office file locally: ${key}`);
        const buffer = await downloadS3Object(bucketName, key);

        let extractedText = '';
        if (extension === 'docx') {
          // Dùng convertToHtml rồi strip tags để giữ cấu trúc heading/bullet
          const result = await mammoth.convertToHtml({ buffer });
          extractedText = result.value
            .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n$1\n')
            .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n• $1')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/tr>/gi, '\n')
            .replace(/<\/td>/gi, '\t')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        } else {
          extractedText = await officeParser.parseOffice(buffer) as any as string;
        }
        console.log(`Extracted ${extractedText.length} characters.`);

        // Nếu text quá dài → lưu lên S3, chỉ lưu key vào DB
        if (extractedText.length > 300000) {
          const identityId = key.split('/')[1];
          const processedS3Key = `processed/${identityId}/${doc!.id}-text.txt`;
          console.log(`Text too large, uploading to S3: ${processedS3Key}`);
          await s3Client.send(new PutObjectCommand({
            Bucket: storageBucketName,
            Key: processedS3Key,
            Body: extractedText,
            ContentType: 'text/plain; charset=utf-8',
          }));
          await updateDocument(key, 'text_extracted', { processedS3Key });
        } else {
          await updateDocument(key, 'text_extracted', { extractedText });
        }

      } else {
        console.warn(`Unsupported file format: ${extension}.`);
        await updateDocument(key, 'error');
      }

    } catch (error: any) {
      console.error(`Error processing file ${key}:`, error);
      await updateDocument(key, 'error');
    }
  }
};
