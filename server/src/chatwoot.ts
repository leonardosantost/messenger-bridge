import axios from 'axios';
import { config } from './config';
import { deleteThreadMapping, getThreadMapping, saveThreadMapping, ThreadMapping } from './db';

const publicApi = axios.create({
  baseURL: `${config.chatwootBaseUrl}/public/api/v1/inboxes/${config.chatwootInboxIdentifier}`,
});

interface IncomingMessage {
  threadId: string;
  senderId: string;
  senderName: string;
  text: string;
  itemContext?: string | null;
  avatarUrl?: string | null;
}

function formatContactName(senderName: string, itemContext?: string | null): string {
  const name = itemContext ? `${senderName} - ${itemContext}` : senderName;
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

async function createContact(
  senderId: string,
  senderName: string,
  itemContext?: string | null,
  avatarUrl?: string | null
): Promise<string> {
  const name = formatContactName(senderName, itemContext);
  const { data } = await publicApi.post('/contacts', {
    identifier: senderId,
    name,
    avatar_url: avatarUrl || undefined,
  });
  return data.source_id as string;
}

async function createConversation(contactIdentifier: string): Promise<number> {
  const { data } = await publicApi.post(`/contacts/${contactIdentifier}/conversations`, {});
  return data.id as number;
}

// Várias mensagens da mesma thread nova costumam chegar quase juntas (ex:
// aviso de sistema + pergunta + card de sugestão do Marketplace). Sem essa
// trava, duas chamadas concorrentes de ensureMapping viam "sem mapeamento
// ainda" ao mesmo tempo e cada uma criava seu próprio contato+conversa,
// duplicando a conversa no Chatwoot. Aqui garantimos que só a primeira
// chamada por thread realmente cria; as demais reaproveitam a mesma promise.
const inFlightMappings = new Map<string, Promise<ThreadMapping>>();

async function ensureMapping(message: IncomingMessage): Promise<ThreadMapping> {
  const existing = getThreadMapping(message.threadId);
  if (existing) return existing;

  const inFlight = inFlightMappings.get(message.threadId);
  if (inFlight) return inFlight;

  const creation = (async (): Promise<ThreadMapping> => {
    console.log(`[chatwoot] criando contato/conversa novos para a thread ${message.threadId} (${message.senderName})`);
    const contactIdentifier = await createContact(
      message.senderId,
      message.senderName,
      message.itemContext,
      message.avatarUrl
    );
    const conversationId = await createConversation(contactIdentifier);
    const mapping: ThreadMapping = {
      threadId: message.threadId,
      contactIdentifier,
      conversationId,
    };
    saveThreadMapping(mapping);
    console.log(`[chatwoot] conversation ${conversationId} criada e mapeada para a thread ${message.threadId}`);
    return mapping;
  })();

  inFlightMappings.set(message.threadId, creation);
  try {
    return await creation;
  } finally {
    inFlightMappings.delete(message.threadId);
  }
}

async function postMessage(mapping: ThreadMapping, message: IncomingMessage): Promise<void> {
  await publicApi.post(`/contacts/${mapping.contactIdentifier}/conversations/${mapping.conversationId}/messages`, {
    content: message.text,
    echo_id: `${message.threadId}-${Date.now()}`,
  });
}

export async function sendIncomingMessageToChatwoot(message: IncomingMessage): Promise<void> {
  const mapping = await ensureMapping(message);
  try {
    await postMessage(mapping, message);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      // O contato/conversa mapeado foi apagado no Chatwoot (ex: limpeza manual
      // de teste). Descarta o mapeamento morto e recria do zero, uma vez, em
      // vez de exigir que alguém apague a linha no banco na mão toda vez.
      console.warn(`[chatwoot] mapeamento da thread ${message.threadId} não existe mais no Chatwoot, recriando...`);
      deleteThreadMapping(message.threadId);
      const freshMapping = await ensureMapping(message);
      await postMessage(freshMapping, message);
      return;
    }
    if (axios.isAxiosError(err)) {
      console.error('[chatwoot] erro na API:', err.response?.status, JSON.stringify(err.response?.data));
    }
    throw err;
  }
}
