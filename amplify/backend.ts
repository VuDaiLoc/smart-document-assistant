import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { lambdaATrigger } from './functions/lambda-a-trigger/resource';
import { lambdaBTextractResult } from './functions/lambda-b-textract-result/resource';
import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';

const backend = defineBackend({
  auth,
  data,
  storage,
  lambdaATrigger,
  lambdaBTextractResult,
});

// ── STABLE FUNCTION NAMES ──────────────────────────────────────────────────
// Override function names so we can construct their ARNs as strings.
// This breaks the circular CDK cross-stack dependency caused by using live tokens.
const lambdaAFunctionName = 'smart-doc-upload-trigger';
const lambdaBFunctionName = 'smart-doc-textract-result';

const cfnLambdaA = backend.lambdaATrigger.resources.lambda.node.defaultChild as cdk.CfnResource;
cfnLambdaA.addPropertyOverride('FunctionName', lambdaAFunctionName);

const cfnLambdaB = backend.lambdaBTextractResult.resources.lambda.node.defaultChild as cdk.CfnResource;
cfnLambdaB.addPropertyOverride('FunctionName', lambdaBFunctionName);

// Construct ARNs from pseudo-params (no CDK cross-stack dependency)
const region = backend.stack.region;
const account = backend.stack.account;
const lambdaAArn = `arn:aws:lambda:${region}:${account}:function:${lambdaAFunctionName}`;
const lambdaBArn = `arn:aws:lambda:${region}:${account}:function:${lambdaBFunctionName}`;

// ── S3 → LAMBDA A EVENT NOTIFICATION ──────────────────────────────────────
// Use CfnBucket.notificationConfiguration directly (avoids LambdaDestination
// which would call lambda.addPermission with bucket.bucketArn CDK token,
// creating a function→storage circular dependency)
const bucket = backend.storage.resources.bucket;

// STABLE BUCKET NAME — same trick as the Lambda function names above.
// We override the bucket's physical name to a deterministic string so that
// referencing "the bucket name" elsewhere (e.g. Lambda env vars) does NOT
// pull in the CDK token `bucket.bucketName`, which would create a
// function→storage stack dependency. Combined with the storage→function
// dependency we add below (for permission ordering), a token-based
// `bucket.bucketName` reference would form a circular dependency between
// the storage and function nested stacks. Using a plain string breaks that.
const storageBucketName = `smart-doc-storage-${account}-${region}`;
const cfnBucketName = bucket.node.defaultChild as cdk.CfnResource;
cfnBucketName.addPropertyOverride('BucketName', storageBucketName);

// Manually allow S3 to invoke Lambda A (restrict to our account)
backend.lambdaATrigger.resources.lambda.addPermission('AllowS3Invoke', {
  principal: new iam.ServicePrincipal('s3.amazonaws.com'),
  action: 'lambda:InvokeFunction',
  sourceAccount: account,
});

// Grab the CfnPermission resource that addPermission() just created, so we
// can force CloudFormation to create it BEFORE the bucket's notification
// config. Without this explicit dependency, CloudFormation may create/update
// the bucket notification before the Lambda permission exists, causing S3 to
// fail validating the destination ("Unable to validate the following
// destination configurations" / 400 InvalidRequest) → stack rollback.
const s3InvokePermission = backend.lambdaATrigger.resources.lambda.node.findChild('AllowS3Invoke') as cdk.CfnResource;

// Configure the bucket notification using CfnBucket override
const cfnBucket = bucket.node.defaultChild as cdk.CfnResource;
cfnBucket.addDependency(s3InvokePermission);
cfnBucket.addPropertyOverride('NotificationConfiguration', {
  LambdaConfigurations: [
    {
      Event: 's3:ObjectCreated:Put',
      Filter: {
        S3Key: { Rules: [{ Name: 'prefix', Value: 'raw/' }] },
      },
      Function: lambdaAArn,
    },
  ],
});

// ── SNS TOPIC ──────────────────────────────────────────────────────────────
const topicName = 'textract-ocr-completed-topic';
const topic = new sns.Topic(backend.stack, 'TextractOcrCompletedTopic', {
  topicName,
});

// Construct SNS Topic ARN as a string (no CDK token from parent stack)
const topicArn = `arn:aws:sns:${region}:${account}:${topicName}`;

// ── TEXTRACT IAM ROLE ──────────────────────────────────────────────────────
const textractSnsRoleName = 'TextractSnsPublishRole';
const textractSnsRole = new iam.Role(backend.stack, 'TextractSnsRole', {
  roleName: textractSnsRoleName,
  assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
});
textractSnsRole.addToPolicy(new iam.PolicyStatement({
  actions: ['sns:Publish'],
  resources: [topic.topicArn],
}));

// Construct Role ARN as a string
const roleArn = `arn:aws:iam::${account}:role/${textractSnsRoleName}`;

// ── SNS → LAMBDA B SUBSCRIPTION ───────────────────────────────────────────
// Use CfnSubscription instead of LambdaSubscription to avoid the automatic
// lambda.addPermission call that would use topic.topicArn (CDK token from
// parent stack), causing function→parent circular dependency.

// Manually allow SNS to invoke Lambda B (using constructed topicArn string).
// This MUST be created before the subscription, since SNS tries to invoke
// the Lambda to confirm the subscription right away — same class of race
// condition as the S3→Lambda A notification below.
backend.lambdaBTextractResult.resources.lambda.addPermission('AllowSNSInvoke', {
  principal: new iam.ServicePrincipal('sns.amazonaws.com'),
  action: 'lambda:InvokeFunction',
  sourceArn: topicArn, // constructed string → no CDK parent→function dependency
});

const snsInvokePermission = backend.lambdaBTextractResult.resources.lambda.node.findChild('AllowSNSInvoke') as cdk.CfnResource;

const lambdaBSubscription = new sns.CfnSubscription(backend.stack, 'LambdaBSnsSubscription', {
  topicArn: topic.topicArn,  // OK: topic is in same (parent) stack
  protocol: 'lambda',
  endpoint: lambdaBArn,       // constructed string, no CDK cross-stack ref
});
lambdaBSubscription.addDependency(snsInvokePermission);

// ── ENVIRONMENT VARIABLES ──────────────────────────────────────────────────
const lambdaATriggerFn = backend.lambdaATrigger.resources.lambda as any;
const lambdaBTextractResultFn = backend.lambdaBTextractResult.resources.lambda as any;

// SNS Topic and Textract Role ARNs (all constructed strings)
lambdaATriggerFn.addEnvironment('TEXTRACT_SNS_TOPIC_ARN', topicArn);
lambdaATriggerFn.addEnvironment('TEXTRACT_SNS_ROLE_ARN', roleArn);

// DynamoDB table names (from data nested stack — sibling dependency handled by CDK)
lambdaATriggerFn.addEnvironment('DOCUMENT_TABLE_NAME', backend.data.resources.tables['Document'].tableName);
lambdaATriggerFn.addEnvironment('USER_QUOTA_TABLE_NAME', backend.data.resources.tables['UserQuota'].tableName);
lambdaATriggerFn.addEnvironment('STORAGE_BUCKET_NAME', storageBucketName);

lambdaBTextractResultFn.addEnvironment('DOCUMENT_TABLE_NAME', backend.data.resources.tables['Document'].tableName);
lambdaBTextractResultFn.addEnvironment('USER_QUOTA_TABLE_NAME', backend.data.resources.tables['UserQuota'].tableName);
lambdaBTextractResultFn.addEnvironment('STORAGE_BUCKET_NAME', storageBucketName);

// ── IAM PERMISSIONS ────────────────────────────────────────────────────────
// Textract
backend.lambdaATrigger.resources.lambda.addToRolePolicy(new iam.PolicyStatement({
  actions: ['textract:StartDocumentTextDetection'],
  resources: ['*'],
}));
backend.lambdaBTextractResult.resources.lambda.addToRolePolicy(new iam.PolicyStatement({
  actions: ['textract:GetDocumentTextDetection'],
  resources: ['*'],
}));

// Bedrock (Amazon Nova Lite & Anthropic Claude 3 Haiku)
// Nova Lite ở ap-southeast-1 chỉ invoke được qua cross-region inference
// profile (modelId: "apac.amazon.nova-lite-v1:0" trong handler.ts), nên
// cần cấp quyền trên CẢ foundation-model (nơi request cuối cùng được route
// tới, có thể là region khác trong APAC) LẪN inference-profile (ARN thực
// sự được gọi trong InvokeModelCommand).
const bedrockPolicy = new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: [
    'arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0',
    'arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-20240307-v1:0',
    `arn:aws:bedrock:${region}:${account}:inference-profile/apac.amazon.nova-lite-v1:0`,
  ],
});
backend.lambdaATrigger.resources.lambda.addToRolePolicy(bedrockPolicy);
backend.lambdaBTextractResult.resources.lambda.addToRolePolicy(bedrockPolicy);

// DynamoDB (sibling cross-stack refs — CDK handles these correctly through parent)
const documentTable = backend.data.resources.tables['Document'];
const userQuotaTable = backend.data.resources.tables['UserQuota'];

const ddbPolicy = new iam.PolicyStatement({
  actions: [
    'dynamodb:GetItem',
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
    'dynamodb:Query',
    'dynamodb:Scan',
    'dynamodb:BatchGetItem',
    'dynamodb:BatchWriteItem',
    'dynamodb:DescribeTable',
  ],
  resources: [
    documentTable.tableArn,
    `${documentTable.tableArn}/index/*`,
    userQuotaTable.tableArn,
    `${userQuotaTable.tableArn}/index/*`,
  ],
});
backend.lambdaATrigger.resources.lambda.addToRolePolicy(ddbPolicy);
backend.lambdaBTextractResult.resources.lambda.addToRolePolicy(ddbPolicy);

// S3 (wildcard to avoid storage↔function circular dependency)
const s3Policy = new iam.PolicyStatement({
  actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
  resources: ['arn:aws:s3:::*', 'arn:aws:s3:::*/*'],
});
backend.lambdaATrigger.resources.lambda.addToRolePolicy(s3Policy);
backend.lambdaBTextractResult.resources.lambda.addToRolePolicy(s3Policy);

// ── DYNAMODB STREAM → LAMBDA B ─────────────────────────────────────────────
// Enable DynamoDB Stream trên Document table để Lambda B tự động trigger khi
// user update analysisMode + status = processing (sau khi chọn mode phân tích).

// Access underlying nested stack của data để tìm CFN resources
const dataStack = backend.data.resources.cfnResources.cfnGraphqlApi.stack;

// Tìm tất cả CfnTable trong data nested stack
const allTables = dataStack.node.findAll().filter(
  (child) => child.node.id.includes('Table') && cdk.CfnResource.isCfnResource(child)
);

console.log('Found tables:', allTables.map(t => t.node.id));

// Tìm Document table bằng cách check logical ID hoặc physical properties
// Amplify Gen2 tạo table với pattern: amplifyDataModel<ModelName><Hash>
const documentCfnTable = allTables.find((table) => {
  const logicalId = (table as any).logicalId || '';
  return logicalId.includes('Document') && !logicalId.includes('UserQuota');
}) as cdk.CfnResource | undefined;

if (documentCfnTable) {
  console.log('Found Document table:', documentCfnTable.node.id);
  
  // Enable DynamoDB Stream
  documentCfnTable.addPropertyOverride('StreamSpecification', {
    StreamViewType: 'NEW_AND_OLD_IMAGES',
  });

  // Cấp quyền Lambda B đọc stream
  backend.lambdaBTextractResult.resources.lambda.addToRolePolicy(new iam.PolicyStatement({
    actions: [
      'dynamodb:GetRecords',
      'dynamodb:GetShardIterator', 
      'dynamodb:DescribeStream',
      'dynamodb:ListStreams',
    ],
    resources: [
      `${documentTable.tableArn}/stream/*`,
    ],
  }));

  // Thêm DynamoDB Stream event source
  backend.lambdaBTextractResult.resources.lambda.addEventSource(
    new lambdaEventSources.DynamoEventSource(documentTable as any, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 1,
      bisectBatchOnError: true,
      retryAttempts: 2,
      filters: [
        lambda.FilterCriteria.filter({
          eventName: lambda.FilterRule.isEqual('MODIFY'),
          dynamodb: {
            NewImage: {
              status: { S: lambda.FilterRule.isEqual('processing') },
              analysisMode: { S: lambda.FilterRule.exists() },
            },
          },
        }),
      ],
    })
  );
  
  console.log('DynamoDB Stream configured successfully');
} else {
  console.error('Document table CFN resource not found!');
}