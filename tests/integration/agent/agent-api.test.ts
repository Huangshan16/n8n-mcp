import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentHttpServer } from '../../../src/agent-server/server';
import { createAgentStack } from '../../../src/agent-server/agent-factory';

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-agent-integration-'));
  return path.join(dir, 'agent.db');
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

describe('Agent API integration', () => {
  it('handles chat flow and scenario listing', async () => {
    const dbPath = createTempDbPath();
    const llmClient = {
      classify: async () => ({
        category: 'robot_task',
        subCategory: 'face_recognition_action',
        entities: [{ type: 'person', value: '老刘' }],
        confidence: 0.9,
      }),
      chat: async () => '需要补充动作和语音吗？',
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

    try {
      const chatResult = await postJson(`http://127.0.0.1:${port}/api/agent/chat`, {
        message: '见到老刘竖个中指',
      });

      expect(chatResult.response.status).toBe(200);
      expect(chatResult.data.sessionId).toBeTruthy();
      expect(chatResult.data.response.type).toBe('guidance');

      const scenariosResponse = await fetch(`http://127.0.0.1:${port}/api/scenarios`);
      const scenariosPayload = await scenariosResponse.json();
      expect(scenariosPayload.scenarios.length).toBeGreaterThan(0);
    } finally {
      await server.stop();
      scenarioRepository.close();
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });
});
