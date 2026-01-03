import { describe, expect, it, vi } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import { attachWebSocketServer } from '../../../src/agent-server/websocket';

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', (error) => reject(error));
  });
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.on('message', (data) => resolve(data.toString()));
  });
}

describe('Agent WebSocket server', () => {
  it('accepts websocket connections and returns responses', async () => {
    const server = http.createServer();
    const agentService = {
      chat: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        response: { type: 'guidance', message: 'hello' },
      }),
    };

    attachWebSocketServer(server, agentService as any);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ type: 'user_message', message: 'hi' }));
    const message = await waitForMessage(ws);

    const parsed = JSON.parse(message);
    expect(parsed.type).toBe('agent_response');
    expect(parsed.response.message).toBe('hello');

    ws.close();
    await new Promise((resolve) => server.close(resolve));
  });
});
