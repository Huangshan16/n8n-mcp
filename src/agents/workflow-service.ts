import { getN8nApiConfig } from '../config/n8n-api';
import { N8nApiClient } from '../services/n8n-api-client';
import type { WorkflowDefinition } from './types';

export interface WorkflowCreateResult {
  workflowId: string;
  workflowName: string;
  workflowUrl: string;
}

export class WorkflowDeployer {
  constructor(
    private n8nClient: Pick<N8nApiClient, 'createWorkflow'>,
    private n8nBaseUrl: string
  ) {}

  static create(): WorkflowDeployer {
    const config = getN8nApiConfig();
    if (!config) {
      throw new Error('N8N API is not configured. Set N8N_API_URL and N8N_API_KEY.');
    }

    const n8nClient = new N8nApiClient(config);
    const workflowBaseUrl = stripApiBase(config.publicUrl ?? config.baseUrl);
    return new WorkflowDeployer(n8nClient, workflowBaseUrl);
  }

  async createWorkflow(workflow: WorkflowDefinition): Promise<WorkflowCreateResult> {
    const created = await this.n8nClient.createWorkflow({
      name: workflow.name,
      nodes: workflow.nodes as any,
      connections: workflow.connections as any,
      settings: workflow.settings as any,
      meta: workflow.meta as any,
    });

    return {
      workflowId: created.id as string,
      workflowName: created.name as string,
      workflowUrl: `${this.n8nBaseUrl}/workflow/${created.id}`,
    };
  }
}

function stripApiBase(url: string): string {
  return url.replace(/\/api\/v\d+\/?$/, '');
}
