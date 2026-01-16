import dotenv from 'dotenv';
import { existsSync } from 'fs';
import path from 'path';
import { z } from 'zod';

export interface AgentConfig {
  llmProvider: 'openai';
  llmModel: string;
  llmApiKey: string;
  llmBaseUrl?: string;
  maxConversationTurns: number;
  convergenceThreshold: number;
  llmTimeoutMs: number;
  workflowCacheTtlSeconds: number;
  maxIterations: number;
  promptVariant?: string;
}

const agentConfigSchema = z.object({
  AI_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  api_key: z.string().min(1).optional(),
  AI_BASE_URL: z.string().url().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  base_url: z.string().url().optional(),
  AI_MODEL: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  AGENT_MAX_TURNS: z.coerce.number().positive().default(6),
  AGENT_CONVERGENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  AGENT_LLM_TIMEOUT_MS: z.coerce.number().positive().default(30000),
  AGENT_WORKFLOW_CACHE_TTL: z.coerce.number().positive().default(600),
  AGENT_MAX_ITERATIONS: z.coerce.number().positive().default(3),
  AGENT_PROMPT_VARIANT: z.string().optional(),
});

let envLoaded = false;

function loadEnvOnce() {
  if (envLoaded) {
    return;
  }

  dotenv.config();

  const envCopyPath = path.join(process.cwd(), '.env copy');
  if (existsSync(envCopyPath)) {
    dotenv.config({ path: envCopyPath });
  }

  envLoaded = true;
}

export function loadAgentConfig(): AgentConfig {
  loadEnvOnce();

  const parsed = agentConfigSchema.parse(process.env);
  const llmApiKey = parsed.AI_API_KEY || parsed.OPENAI_API_KEY || parsed.api_key;
  if (!llmApiKey) {
    throw new Error('Missing LLM API key (AI_API_KEY, OPENAI_API_KEY, or api_key)');
  }

  const llmBaseUrl = parsed.AI_BASE_URL || parsed.OPENAI_BASE_URL || parsed.base_url;
  const llmModel = parsed.AI_MODEL || parsed.OPENAI_MODEL || parsed.model || 'gpt-4o-mini';

  return {
    llmProvider: 'openai',
    llmModel,
    llmApiKey,
    llmBaseUrl,
    maxConversationTurns: parsed.AGENT_MAX_TURNS,
    convergenceThreshold: parsed.AGENT_CONVERGENCE_THRESHOLD,
    llmTimeoutMs: parsed.AGENT_LLM_TIMEOUT_MS,
    workflowCacheTtlSeconds: parsed.AGENT_WORKFLOW_CACHE_TTL,
    maxIterations: parsed.AGENT_MAX_ITERATIONS,
    promptVariant: parsed.AGENT_PROMPT_VARIANT,
  };
}
