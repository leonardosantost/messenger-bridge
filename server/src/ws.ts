import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { config } from './config';
import { sendIncomingMessageToChatwoot } from './chatwoot';

let extensionSocket: WebSocket | null = null;

type IncomingFromExtension =
  | { type: 'auth'; token: string }
  | { type: 'incoming_message'; threadId: string; senderId: string; senderName: string; text: string };

export function sendToExtension(command: { type: 'send_message'; threadId: string; text: string }): boolean {
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) return false;
  extensionSocket.send(JSON.stringify(command));
  return true;
}

export function attachWebSocketServer(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/extension' });

  wss.on('connection', (socket) => {
    let authenticated = false;

    socket.on('message', async (raw) => {
      let payload: IncomingFromExtension;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!authenticated) {
        if (payload.type === 'auth' && payload.token === config.extensionToken) {
          authenticated = true;
          extensionSocket = socket;
          socket.send(JSON.stringify({ type: 'auth_ok' }));
        } else {
          socket.close(4001, 'unauthorized');
        }
        return;
      }

      if (payload.type === 'incoming_message') {
        try {
          await sendIncomingMessageToChatwoot({
            threadId: payload.threadId,
            senderId: payload.senderId,
            senderName: payload.senderName,
            text: payload.text,
          });
        } catch (err) {
          console.error('Failed to forward message to Chatwoot', err);
        }
      }
    });

    socket.on('close', () => {
      if (extensionSocket === socket) extensionSocket = null;
    });
  });
}
