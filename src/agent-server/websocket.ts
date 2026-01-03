import { Server } from 'http';
import { WebSocketServer } from 'ws';
import { AgentService } from './agent-service';
import { logger } from '../utils/logger';

type IncomingMessage = {
  type: 'user_message' | 'confirm_workflow' | 'ping';
  sessionId?: string;
  message?: string;
};

export function attachWebSocketServer(server: Server, agentService: AgentService): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket) => {
    logger.info('Agent WebSocket connected');

    socket.on('message', async (data) => {
      try {
        const payload = JSON.parse(data.toString()) as IncomingMessage;
        if (payload.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (payload.type === 'confirm_workflow') {
          if (!payload.sessionId) {
            socket.send(JSON.stringify({ type: 'error', message: 'sessionId is required' }));
            return;
          }
          logger.debug('WebSocket: confirm request received', { sessionId: payload.sessionId });
          const result = await agentService.confirm(payload.sessionId);
          socket.send(
            JSON.stringify({
              type: 'agent_response',
              sessionId: result.sessionId,
              response: result.response,
            })
          );
          return;
        }

        if (payload.type === 'user_message' && payload.message) {
          logger.debug('WebSocket: user message received', {
            sessionId: payload.sessionId ?? null,
            messageLength: payload.message.length,
          });
          const result = await agentService.chat(payload.message, payload.sessionId);
          socket.send(
            JSON.stringify({
              type: 'agent_response',
              sessionId: result.sessionId,
              response: result.response,
            })
          );
          return;
        }

        socket.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      } catch (error) {
        logger.warn('WebSocket message error', error);
        socket.send(JSON.stringify({ type: 'error', message: 'Failed to process message' }));
      }
    });

    socket.on('close', () => {
      logger.info('Agent WebSocket disconnected');
    });
  });

  return wss;
}
