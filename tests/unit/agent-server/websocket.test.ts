import { describe, expect, it } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import { attachWebSocketServer } from '../../../src/agent-server/websocket';

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', (error) => reject(error));
  });
}

describe('Agent WebSocket server', () => {
  it('accepts websocket connections', async () => {
    const server = http.createServer();
    const wss = attachWebSocketServer(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    await waitForOpen(ws);

    ws.close();
    wss.close();
    await new Promise((resolve) => server.close(resolve));

    expect(ws.readyState).toBe(WebSocket.CLOSING);
  });
});
