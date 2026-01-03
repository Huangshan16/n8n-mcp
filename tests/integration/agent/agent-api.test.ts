import { describe, expect, it } from 'vitest';
import { AgentHttpServer } from '../../../src/agent-server/server';
import { createAgentStack } from '../../../src/agent-server/agent-factory';

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

describe('Agent API integration', () => {
  it('handles chat flow and workflow creation', async () => {
    const llmClient = {
      chat: async () =>
        JSON.stringify({
          category: 'game_interaction',
          entities: { game_type: 'rps' },
          confidence: 0.9,
          missingInfo: [],
        }),
    };

    const config = {
      llmProvider: 'openai' as const,
      llmModel: 'test-model',
      llmApiKey: 'test-key',
      maxConversationTurns: 4,
      convergenceThreshold: 0.7,
    };

    const workflow = { name: 'Demo', nodes: [], connections: {} };
    const workflowArchitect = {
      generateWorkflow: async () => ({
        success: true,
        workflow,
        iterations: 1,
        reasoning: 'test',
      }),
    } as any;
    const mcpClient = { searchNodes: async () => ({ nodes: [], total: 0 }), getNode: async () => ({}) } as any;

    const { agentService, close } = await createAgentStack({
      config,
      llmClient,
      workflowArchitect,
      mcpClient,
      hardwareComponents: [],
    });

    const workflowService = {
      createWorkflow: async () => ({
        workflowId: 'wf-1',
        workflowName: 'WF',
        workflowUrl: 'http://localhost:5678/workflow/wf-1',
      }),
    } as any;

    const server = new AgentHttpServer(agentService, workflowService);
    const { port } = await server.start({ host: '127.0.0.1', port: 0 });

    try {
      const chatResult = await postJson(`http://127.0.0.1:${port}/api/agent/chat`, {
        message: '见到老刘竖个中指',
      });

      expect(chatResult.response.status).toBe(200);
      expect(chatResult.data.sessionId).toBeTruthy();
      expect(chatResult.data.response.type).toBe('workflow_ready');

      const workflowResult = await postJson(`http://127.0.0.1:${port}/api/workflow/create`, {
        sessionId: chatResult.data.sessionId,
      });
      expect(workflowResult.response.status).toBe(200);
      expect(workflowResult.data.workflowId).toBe('wf-1');
    } finally {
      await server.stop();
      close();
    }
  });
});
