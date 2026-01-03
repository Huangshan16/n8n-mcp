export type IntentCategory = 'robot_task' | 'greeting' | 'hardware_query' | 'workflow_edit';

export interface Entity {
  type: string;
  value: string;
}

export interface Intent {
  category: IntentCategory;
  subCategory?: string;
  entities: Entity[];
  confidence: number;
}

export interface ScenarioParameter {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  value?: string | number | boolean | null;
  default?: string | number | boolean | null;
}

export interface WorkflowTemplate {
  name: string;
  nodes: Array<Record<string, unknown>>;
  connections: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  intentCategory: IntentCategory;
  intentSubCategory?: string;
  requiredComponents: string[];
  requiredParams: ScenarioParameter[];
  workflowTemplate: WorkflowTemplate;
}

export interface CommandInstruction {
  command: 'CREATE_WORKFLOW';
  scenarioId: string;
  params: Record<string, unknown>;
  displayText: string;
}

export interface AgentResponse {
  type: 'guidance' | 'command_ready';
  message: string;
  command?: CommandInstruction;
  commandText?: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentSession {
  id: string;
  history: ConversationTurn[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface HardwareComponent {
  id: string;
  name: string;
  displayName: string;
  nodeType: string;
  defaultConfig: Record<string, unknown>;
  capabilities: string[];
}
