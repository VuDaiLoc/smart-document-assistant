import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Document: a
    .model({
      owner: a.string(),
      fileName: a.string().required(),
      fileType: a.string().required(), // pdf | docx | pptx | jpg | png
      fileSize: a.integer().required(),
      s3Key: a.string().required(),
      status: a.enum(['uploaded', 'processing', 'text_extracted', 'done', 'error']),
      summary: a.string(),
      category: a.string(),
      textractJobId: a.string(),
      extractedText: a.string(), // Văn bản thô đã trích xuất
      processedS3Key: a.string(), // Key lưu file text thô trên S3 nếu text quá dài
      createdAt: a.datetime().required(),
    })
    .secondaryIndexes((index) => [
      index('owner')
        .sortKeys(['createdAt'])
        .queryField('listDocumentsByOwnerAndCreatedAt')
        .name('owner-createdAt-index'),
      index('textractJobId')
        .queryField('listDocumentsByTextractJobId')
        .name('textractJobId-index'),
      index('s3Key')
        .queryField('listDocumentsByS3Key')
        .name('s3Key-index'),
    ])
    .authorization((allow) => [
      allow.owner(),
    ]),

  UserQuota: a
    .model({
      owner: a.string().required(),
      uploadedCount: a.integer().default(0),
      maxUploads: a.integer().default(50),
    })
    .identifier(['owner'])
    .authorization((allow) => [
      allow.owner(),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});