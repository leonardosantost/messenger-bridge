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
  if (config.chatwootWebhookToken) {
    const token = req.header('X-Webhook-Token');
    if (token !== config.chatwootWebhookToken) {
      res.sendStatus(401);
      return;
    }
  }

  const payload = req.body as ChatwootMessageCreatedPayload;

  if (payload.event !== 'message_created' || payload.message_type !== 'outgoing' || payload.private) {
    res.sendStatus(204);
    return;
  }

  const mapping = getThreadMappingByConversationId(payload.conversation.id);
  if (!mapping) {
    res.sendStatus(204);
    return;
  }

  const delivered = sendToExtension({ type: 'send_message', threadId: mapping.threadId, text: payload.content });
  res.sendStatus(delivered ? 200 : 202);
});
