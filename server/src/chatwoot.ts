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
  itemContext?: string | null;
}

async function createContact(senderId: string, senderName: string, itemContext?: string | null): Promise<string> {
  const name = itemContext ? `${senderName} — ${itemContext}` : senderName;
  const { data } = await publicApi.post('/contacts', {
    identifier: senderId,
    name,
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

  console.log(`[chatwoot] criando contato/conversa novos para a thread ${message.threadId} (${message.senderName})`);
  const contactIdentifier = await createContact(message.senderId, message.senderName, message.itemContext);
  const conversationId = await createConversation(contactIdentifier);
  const mapping: ThreadMapping = {
    threadId: message.threadId,
    contactIdentifier,
    conversationId,
  };
  saveThreadMapping(mapping);
  console.log(`[chatwoot] conversation ${conversationId} criada e mapeada para a thread ${message.threadId}`);
  return mapping;
}

export async function sendIncomingMessageToChatwoot(message: IncomingMessage): Promise<void> {
  try {
    const mapping = await ensureMapping(message);
    await publicApi.post(
      `/contacts/${mapping.contactIdentifier}/conversations/${mapping.conversationId}/messages`,
      { content: message.text, echo_id: `${message.threadId}-${Date.now()}` }
    );
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error('[chatwoot] erro na API:', err.response?.status, JSON.stringify(err.response?.data));
    }
    throw err;
  }
}
