export type IntentCategory =
  | 'face_recognition_action'
  | 'emotion_interaction'
  | 'game_interaction'
  | 'custom';

export interface Intent {
  category: IntentCategory;
  entities: Record<string, string>;
  confidence: number;
  missingInfo?: string[];
}

export interface WorkflowDefinition {
  name: string;
  nodes: Array<Record<string, unknown>>;
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export type AgentResponse =
  | {
      type: 'guidance';
      message: string;
    }
  | {
      type: 'workflow_ready';
      message: string;
      workflow: WorkflowDefinition;
      reasoning?: string;
      metadata?: {
        iterations: number;
        nodeCount: number;
      };
    }
  | {
      type: 'error';
      message: string;
      details?: unknown;
    };

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentSession {
  id: string;
  history: ConversationTurn[];
  workflow?: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}
