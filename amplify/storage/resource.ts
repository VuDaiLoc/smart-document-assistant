import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'documentAssistantStorage',
  access: (allow) => ({
    'raw/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
    'processed/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});
