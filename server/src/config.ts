import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  extensionToken: required('EXTENSION_TOKEN'),
  chatwootWebhookToken: process.env.CHATWOOT_WEBHOOK_TOKEN ?? '',
  chatwootBaseUrl: required('CHATWOOT_BASE_URL').replace(/\/$/, ''),
  chatwootInboxIdentifier: required('CHATWOOT_INBOX_IDENTIFIER'),
};
