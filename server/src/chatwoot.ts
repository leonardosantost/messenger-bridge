import axios from 'axios';
import { config } from './config';
import { getThreadMapping, saveThreadMapping, ThreadMapping } from './db';

const publicApi = axios.create({
  baseURL: `${config.chatwootBaseUrl}/public/api/v1/inboxes/${config.chatwootInboxIdentifier}`,
});

interface IncomingMessage {
  threadId: string;
  senderId: string;
  senderName: string;
  text: string;
}

async function createContact(senderId: string, senderName: string): Promise<string> {
  const { data } = await publicApi.post('/contacts', {
    identifier: senderId,
    name: senderName,
  });
  return data.source_id as string;
}

async function createConversation(contactIdentifier: string): Promise<number> {
  const { data } = await publicApi.post(`/contacts/${contactIdentifier}/conversations`, {});
  return data.id as number;
}

async function ensureMapping(message: IncomingMessage): Promise<ThreadMapping> {
  const existing = getThreadMapping(message.threadId);
  if (existing) return existing;

  const contactIdentifier = await createContact(message.senderId, message.senderName);
  const conversationId = await createConversation(contactIdentifier);
  const mapping: ThreadMapping = {
    threadId: message.threadId,
    contactIdentifier,
    conversationId,
  };
  saveThreadMapping(mapping);
  return mapping;
}

export async function sendIncomingMessageToChatwoot(message: IncomingMessage): Promise<void> {
  const mapping = await ensureMapping(message);
  await publicApi.post(
    `/contacts/${mapping.contactIdentifier}/conversations/${mapping.conversationId}/messages`,
    { content: message.text, echo_id: `${message.threadId}-${Date.now()}` }
  );
}
