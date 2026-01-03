import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';
import { AgentHttpServer } from '../../../src/agent-server/server';
import { createAgentStack } from '../../../src/agent-server/agent-factory';

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-agent-ws-'));
  return path.join(dir, 'agent.db');
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.on('message', (data) => resolve(data.toString()));
  });
}

describe('Agent WebSocket integration', () => {
  it('responds to chat messages', async () => {
    const dbPath = createTempDbPath();
    const llmClient = {
      classify: async () => ({
        category: 'robot_task',
        subCategory: 'face_recognition_action',
        entities: [],
        confidence: 0.95,
      }),
      chat: async () => '需要补充动作吗？',
    };

    const config = {
      llmProvider: 'openai' as const,
      llmModel: 'test-model',
      llmApiKey: 'test-key',
      maxConversationTurns: 4,
      convergenceThreshold: 0.7,
    };

    const { agentService, scenarioRepository } = await createAgentStack({
      config,
      llmClient,
      scenarioDbPath: dbPath,
      seed: true,
    });

    const workflowService = {
      createWorkflow: async () => ({
        workflowId: 'wf-1',
        workflowName: 'WF',
        workflowUrl: 'http://localhost:5678/workflow/wf-1',
      }),
    } as any;

    const server = new AgentHttpServer(agentService, workflowService, scenarioRepository);
    const { port } = await server.start({ host: '127.0.0.1', port: 0 });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    try {
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));
      ws.send(JSON.stringify({ type: 'user_message', message: '测试' }));

      const response = await waitForMessage(ws);
      const payload = JSON.parse(response);

      expect(payload.type).toBe('agent_response');
      expect(payload.response.message).toContain('补充');
    } finally {
      ws.close();
      await server.stop();
      scenarioRepository.close();
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });
});
