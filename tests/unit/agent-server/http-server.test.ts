import { describe, expect, it } from 'vitest';
import { AgentHttpServer } from '../../../src/agent-server/server';

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

describe('AgentHttpServer', () => {
  it('handles chat and workflow endpoints', async () => {
    const agentService = {
      chat: async () => ({ sessionId: 's1', response: { type: 'guidance', message: 'ok' } }),
    } as any;

    const workflowService = {
      createWorkflow: async () => ({ workflowId: 'w1', workflowName: 'WF', workflowUrl: 'http://localhost:5678/workflow/w1' }),
    } as any;

    const scenarioRepository = {
      list: async () => [],
    } as any;

    const server = new AgentHttpServer(agentService, workflowService, scenarioRepository);
    const { port } = await server.start({ host: '127.0.0.1', port: 0 });

    try {
      const chatResult = await postJson(`http://127.0.0.1:${port}/api/agent/chat`, { message: 'hello' });
      expect(chatResult.response.status).toBe(200);
      expect(chatResult.data.sessionId).toBe('s1');

      const workflowResult = await postJson(`http://127.0.0.1:${port}/api/workflow/create`, { scenarioId: 'demo', params: {} });
      expect(workflowResult.response.status).toBe(200);
      expect(workflowResult.data.workflowId).toBe('w1');
    } finally {
      await server.stop();
    }
  });
});
