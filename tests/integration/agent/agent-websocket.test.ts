import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { AgentHttpServer } from '../../../src/agent-server/server';
import { createAgentStack } from '../../../src/agent-server/agent-factory';

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(data.toString()));
  });
}

describe('Agent WebSocket integration', () => {
  it('responds to chat messages', async () => {
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
      llmTimeoutMs: 1000,
      workflowCacheTtlSeconds: 300,
      maxIterations: 2,
      promptVariant: 'baseline',
    };

    const workflowArchitect = {
      generateWorkflow: async () => ({
        success: true,
        workflow: { name: 'Demo', nodes: [], connections: {} },
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    try {
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      ws.send(JSON.stringify({ type: 'user_message', message: '测试' }));

      const response = await waitForMessage(ws);
      const payload = JSON.parse(response);

      expect(payload.type).toBe('agent_response');
      expect(payload.response.type).toBe('summary_ready');

      ws.send(JSON.stringify({ type: 'confirm_workflow', sessionId: payload.sessionId }));
      const confirmResponse = await waitForMessage(ws);
      const confirmPayload = JSON.parse(confirmResponse);

      expect(confirmPayload.type).toBe('agent_response');
      expect(confirmPayload.response.type).toBe('workflow_ready');
      expect(confirmPayload.response.message).toContain('工作流');
    } finally {
      ws.close();
      await server.stop();
      close();
    }
  });
});
