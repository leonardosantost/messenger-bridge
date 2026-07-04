import { Router } from 'express';
import { config } from './config';
import { getThreadMappingByConversationId } from './db';
import { sendToExtension } from './ws';

export const webhookRouter = Router();

interface ChatwootMessageCreatedPayload {
  event: string;
  content: string;
  message_type: 'incoming' | 'outgoing';
  private: boolean;
  conversation: { id: number };
}

webhookRouter.post('/webhook', (req, res) => {
  const payload = req.body as ChatwootMessageCreatedPayload;
  console.log(`[webhook] recebido: event=${payload.event} message_type=${payload.message_type} private=${payload.private}`);

  if (config.chatwootWebhookToken) {
    const token = req.header('X-Webhook-Token');
    if (token !== config.chatwootWebhookToken) {
      console.warn('[webhook] token inválido, ignorado');
      res.sendStatus(401);
      return;
    }
  }

  if (payload.event !== 'message_created' || payload.message_type !== 'outgoing' || payload.private) {
    res.sendStatus(204);
    return;
  }

  const mapping = getThreadMappingByConversationId(payload.conversation.id);
  if (!mapping) {
    console.warn(`[webhook] nenhuma thread do Messenger mapeada para a conversation ${payload.conversation.id}`);
    res.sendStatus(204);
    return;
  }

  const delivered = sendToExtension({ type: 'send_message', threadId: mapping.threadId, text: payload.content });
  res.sendStatus(delivered ? 200 : 202);
});
