export type IntentCategory =
  | 'face_recognition_action'
  | 'emotion_interaction'
  | 'game_interaction'
  | 'custom';

export type AgentPhase = 'understanding' | 'generating' | 'deploying';

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

export interface WorkflowBlueprint {
  intentSummary: string;
  triggers: Array<{ type: 'webhook' | 'scheduleTrigger'; config: Record<string, unknown> }>;
  logic: Array<{ type: 'if' | 'splitInBatches'; config: Record<string, unknown> }>;
  executors: Array<{ type: 'set' | 'httpRequest'; config: Record<string, unknown> }>;
  missingFields: string[];
}

export type AgentResponse =
  | {
      type: 'guidance';
      message: string;
    }
  | {
      type: 'summary_ready';
      message: string;
      blueprint: WorkflowBlueprint;
      confirmedEntities?: Record<string, string>;
      missingInfo?: string[];
      metadata?: {
        showContinueButton: boolean;
        showConfirmBuildButton: boolean;
      };
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
  phase: AgentPhase;
  history: ConversationTurn[];
  workflow?: WorkflowDefinition;
  blueprint?: WorkflowBlueprint;
  intent?: Intent;
  confirmedEntities: Record<string, string>;
  workflowSummary?: string;
  confirmed: boolean;
  userTurns: number;
  lastSummaryTurn: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}
