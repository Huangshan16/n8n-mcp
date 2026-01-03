import { getN8nApiConfig } from '../config/n8n-api';
import { N8nApiClient } from '../services/n8n-api-client';
import { ScenarioRepository } from './scenario-repository';
import { renderTemplate } from './template-renderer';

export interface WorkflowCreateResult {
  workflowId: string;
  workflowName: string;
  workflowUrl: string;
}

export class WorkflowService {
  constructor(
    private scenarioRepository: ScenarioRepository,
    private n8nClient: Pick<N8nApiClient, 'createWorkflow'>,
    private n8nBaseUrl: string
  ) {}

  static async create(): Promise<WorkflowService> {
    const config = getN8nApiConfig();
    if (!config) {
      throw new Error('N8N API is not configured. Set N8N_API_URL and N8N_API_KEY.');
    }

    const scenarioRepository = await ScenarioRepository.create();
    return WorkflowService.createWithRepository(scenarioRepository);
  }

  static createWithRepository(scenarioRepository: ScenarioRepository): WorkflowService {
    const config = getN8nApiConfig();
    if (!config) {
      throw new Error('N8N API is not configured. Set N8N_API_URL and N8N_API_KEY.');
    }

    const n8nClient = new N8nApiClient(config);
    const baseUrl = stripApiBase(config.baseUrl);

    return new WorkflowService(scenarioRepository, n8nClient, baseUrl);
  }

  async createWorkflow(scenarioId: string, params: Record<string, unknown>): Promise<WorkflowCreateResult> {
    const scenario = await this.scenarioRepository.findById(scenarioId);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }

    const resolvedParams = this.resolveParams(scenario.requiredParams, params);
    const renderedWorkflow = renderTemplate(scenario.workflowTemplate, resolvedParams) as Record<string, unknown>;

    const created = await this.n8nClient.createWorkflow({
      name: renderedWorkflow.name as string,
      nodes: renderedWorkflow.nodes as any,
      connections: renderedWorkflow.connections as any,
    });

    return {
      workflowId: created.id as string,
      workflowName: created.name as string,
      workflowUrl: `${this.n8nBaseUrl}/workflow/${created.id}`,
    };
  }

  private resolveParams(requiredParams: Array<{ name: string; required: boolean; default?: unknown }>, params: Record<string, unknown>) {
    const resolved: Record<string, unknown> = { ...params };

    requiredParams.forEach((param) => {
      if (resolved[param.name] === undefined || resolved[param.name] === null) {
        if (param.default !== undefined && param.default !== null) {
          resolved[param.name] = param.default;
        }
      }

      if (param.required && (resolved[param.name] === undefined || resolved[param.name] === null)) {
        throw new Error(`Missing required parameter: ${param.name}`);
      }
    });

    return resolved;
  }
}

function stripApiBase(url: string): string {
  return url.replace(/\/api\/v\d+\/?$/, '');
}
