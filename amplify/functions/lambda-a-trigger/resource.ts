import { defineFunction, secret } from '@aws-amplify/backend';

export const lambdaATrigger = defineFunction({
  name: 'lambda-a-trigger',
  entry: './handler.ts',
  timeoutSeconds: 60,
  environment: {
    OPENROUTER_API_KEY: secret('OPENROUTER_API_KEY'),
  },
});
