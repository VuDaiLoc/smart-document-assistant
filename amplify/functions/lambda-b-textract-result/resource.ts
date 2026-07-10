import { defineFunction, secret } from '@aws-amplify/backend';

export const lambdaBTextractResult = defineFunction({
  name: 'lambda-b-textract-result',
  entry: './handler.ts',
  timeoutSeconds: 300,
  environment: {
    OPENROUTER_API_KEY: secret('OPENROUTER_API_KEY'),
  },
});
