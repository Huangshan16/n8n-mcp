import { Server } from 'http';
import { WebSocketServer } from 'ws';
import { logger } from '../utils/logger';

export function attachWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket) => {
    logger.info('Agent WebSocket connected');
    socket.on('close', () => {
      logger.info('Agent WebSocket disconnected');
    });
  });

  return wss;
}
