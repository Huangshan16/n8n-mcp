import type { WorkflowCommand } from './commandParser';

const API_URL = import.meta.env.VITE_AGENT_API_URL || 'http://localhost:3005';

export interface AgentChatResponse {
  sessionId: string;
  response: {
    type: 'guidance' | 'command_ready';
    message: string;
    command?: WorkflowCommand;
    commandText?: string;
  };
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

export async function createWorkflow(command: WorkflowCommand) {
  return postJson('/api/workflow/create', {
    scenarioId: command.scenarioId,
    params: command.params,
  });
}
