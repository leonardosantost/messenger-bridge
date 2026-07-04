import express from 'express';
import { createServer } from 'http';
import { config } from './config';
import { webhookRouter } from './webhook';
import { attachWebSocketServer } from './ws';

const app = express();
app.use(express.json());
app.use(webhookRouter);

const httpServer = createServer(app);
attachWebSocketServer(httpServer);

httpServer.listen(config.port, () => {
  console.log(`messenger-bridge server listening on port ${config.port}`);
});
