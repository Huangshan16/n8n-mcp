const API_URL = import.meta.env.VITE_AGENT_API_URL || 'http://localhost:3005';

export interface WorkflowDefinition {
  name: string;
  nodes: Array<Record<string, unknown>>;
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface WorkflowBlueprint {
  intentSummary: string;
  triggers: Array<{ type: 'webhook' | 'scheduleTrigger'; config: Record<string, unknown> }>;
  logic: Array<{ type: 'if' | 'splitInBatches'; config: Record<string, unknown> }>;
  executors: Array<{ type: 'set' | 'httpRequest'; config: Record<string, unknown> }>;
  missingFields: string[];
}

export interface AgentResponse {
  type: 'guidance' | 'summary_ready' | 'workflow_ready' | 'error';
  message: string;
  blueprint?: WorkflowBlueprint;
  workflow?: WorkflowDefinition;
  reasoning?: string;
  metadata?: {
    iterations: number;
    nodeCount: number;
  };
  details?: unknown;
}

export interface AgentChatResponse {
  sessionId: string;
  response: AgentResponse;
}

export interface WorkflowCreateResult {
  workflowId: string;
  workflowName?: string;
  workflowUrl?: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Request failed');
  }

  return response.json() as Promise<T>;
}

export async function sendAgentMessage(message: string, sessionId?: string): Promise<AgentChatResponse> {
  return postJson<AgentChatResponse>('/api/agent/chat', { message, sessionId });
}

export async function confirmAgentWorkflow(sessionId: string): Promise<AgentChatResponse> {
  return postJson<AgentChatResponse>('/api/agent/confirm', { sessionId });
}

export async function createWorkflow(
  workflow: WorkflowDefinition,
  sessionId?: string
): Promise<WorkflowCreateResult> {
  return postJson<WorkflowCreateResult>('/api/workflow/create', {
    workflow,
    sessionId,
  });
}
