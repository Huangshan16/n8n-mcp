export type IntentCategory =
  | 'face_recognition_action'
  | 'emotion_interaction'
  | 'game_interaction'
  | 'custom';

export type AgentPhase = 'understanding' | 'generating' | 'deploying';

export type AgentResponseType =
  | 'guidance'
  | 'summary_ready'
  | 'workflow_ready'
  | 'error'
  | 'select_single'
  | 'select_multi'
  | 'image_upload';

export type InteractionField =
  | 'tts_voice'
  | 'screen_emoji'
  | 'chassis_action'
  | 'hand_gestures'
  | 'yolo_gestures'
  | 'emotion_labels'
  | 'arm_actions'
  | 'face_profiles';

export interface InteractionOption {
  label: string;
  value: string;
}

export interface InteractionRequest {
  id: string;
  mode: 'single' | 'multi' | 'image';
  field: InteractionField;
  title: string;
  description?: string;
  options: InteractionOption[];
  minSelections?: number;
  maxSelections?: number;
  selected?: string | string[];
  allowUpload?: boolean;
  uploadHint?: string;
}

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
      interaction?: InteractionRequest;
      confirmedEntities?: Record<string, string>;
      missingInfo?: string[];
      metadata?: {
        showContinueButton?: boolean;
        showConfirmBuildButton?: boolean;
      };
    }
  | {
      type: 'summary_ready';
      message: string;
      blueprint: WorkflowBlueprint;
      confirmedEntities?: Record<string, string>;
      missingInfo?: string[];
      interaction?: InteractionRequest;
      metadata?: {
        showContinueButton: boolean;
        showConfirmBuildButton: boolean;
      };
    }
  | {
      type: 'select_single' | 'select_multi' | 'image_upload';
      message: string;
      interaction: InteractionRequest;
      confirmedEntities?: Record<string, string>;
      missingInfo?: string[];
      metadata?: {
        showContinueButton?: boolean;
        showConfirmBuildButton?: boolean;
      };
    }
  | {
      type: 'workflow_ready';
      message: string;
      workflow: WorkflowDefinition;
      reasoning?: string;
      interaction?: InteractionRequest;
      metadata?: {
        iterations: number;
        nodeCount: number;
      };
    }
  | {
      type: 'error';
      message: string;
      details?: unknown;
      interaction?: InteractionRequest;
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
