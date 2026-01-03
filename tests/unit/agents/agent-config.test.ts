import { describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe('Agent config', () => {
  it('loads config from AI_* variables', async () => {
    resetEnv();
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_MODEL = 'test-model';
    process.env.AI_BASE_URL = 'https://example.com';
    process.env.AGENT_MAX_TURNS = '4';
    process.env.AGENT_CONVERGENCE_THRESHOLD = '0.9';
    process.env.AGENT_LLM_TIMEOUT_MS = '12000';
    process.env.AGENT_WORKFLOW_CACHE_TTL = '900';
    process.env.AGENT_MAX_ITERATIONS = '4';
    process.env.AGENT_PROMPT_VARIANT = 'strict';

    vi.resetModules();
    const { loadAgentConfig } = await import('../../../src/agents/agent-config');

    const config = loadAgentConfig();
    expect(config.llmApiKey).toBe('test-key');
    expect(config.llmModel).toBe('test-model');
    expect(config.llmBaseUrl).toBe('https://example.com');
    expect(config.maxConversationTurns).toBe(4);
    expect(config.convergenceThreshold).toBe(0.9);
    expect(config.llmTimeoutMs).toBe(12000);
    expect(config.workflowCacheTtlSeconds).toBe(900);
    expect(config.maxIterations).toBe(4);
    expect(config.promptVariant).toBe('strict');
  });

  it('falls back to generic variables', async () => {
    resetEnv();
    process.env.api_key = 'fallback-key';
    process.env.base_url = 'https://fallback.example.com';
    process.env.model = 'fallback-model';

    vi.resetModules();
    const { loadAgentConfig } = await import('../../../src/agents/agent-config');

    const config = loadAgentConfig();
    expect(config.llmApiKey).toBe('fallback-key');
    expect(config.llmBaseUrl).toBe('https://fallback.example.com');
    expect(config.llmModel).toBe('fallback-model');
  });
});
