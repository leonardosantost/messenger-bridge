import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { config } from './config';
import { sendIncomingMessageToChatwoot } from './chatwoot';

let extensionSocket: WebSocket | null = null;

type SendMessageCommand = { type: 'send_message'; threadId: string; text: string };

type IncomingFromExtension =
  | { type: 'auth'; token: string }
  | { type: 'incoming_message'; threadId: string; senderId: string; senderName: string; text: string };

// A extensão (MV3) tem o service worker derrubado por inatividade e só
// reconecta periodicamente (alarme de ~1min, mínimo permitido pelo Chrome).
// Se um comando chegar nesse intervalo, guardamos aqui e reenviamos assim
// que ela autenticar de novo — sem isso, respostas do agente eram perdidas
// silenciosamente quando a extensão estava momentaneamente desconectada.
const pendingCommands: SendMessageCommand[] = [];

function flushPendingCommands(): void {
  while (pendingCommands.length > 0 && extensionSocket?.readyState === WebSocket.OPEN) {
    const command = pendingCommands.shift()!;
    extensionSocket.send(JSON.stringify(command));
    console.log(`[ws] comando pendente entregue para a extensão (thread ${command.threadId})`);
  }
}

export function sendToExtension(command: SendMessageCommand): boolean {
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    pendingCommands.push(command);
    console.warn(
      `[ws] extensão não conectada, comando enfileirado para thread ${command.threadId} (${pendingCommands.length} pendente(s))`
    );
    return false;
  }
  extensionSocket.send(JSON.stringify(command));
  console.log(`[ws] comando send_message enviado para a extensão (thread ${command.threadId})`);
  return true;
}

export function attachWebSocketServer(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/extension' });

  wss.on('connection', (socket) => {
    let authenticated = false;
    console.log('[ws] nova conexão recebida, aguardando auth...');

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
          console.log('[ws] extensão autenticada e conectada');
          flushPendingCommands();
        } else {
          console.warn('[ws] tentativa de conexão com token inválido');
          socket.close(4001, 'unauthorized');
        }
        return;
      }

      if (payload.type === 'incoming_message') {
        console.log(`[ws] mensagem recebida da extensão (thread ${payload.threadId}): "${payload.text}"`);
        try {
          await sendIncomingMessageToChatwoot({
            threadId: payload.threadId,
            senderId: payload.senderId,
            senderName: payload.senderName,
            text: payload.text,
          });
          console.log(`[ws] mensagem da thread ${payload.threadId} encaminhada ao Chatwoot com sucesso`);
        } catch (err) {
          console.error('[ws] falha ao encaminhar mensagem para o Chatwoot', err);
        }
      }
    });

    socket.on('close', () => {
      if (extensionSocket === socket) {
        extensionSocket = null;
        console.log('[ws] extensão desconectada');
      }
    });
  });
}
