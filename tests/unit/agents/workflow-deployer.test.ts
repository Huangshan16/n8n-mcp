import { describe, expect, it } from 'vitest';
import { WorkflowDeployer } from '../../../src/agents/workflow-service';

describe('WorkflowDeployer', () => {
  it('creates workflow via n8n client', async () => {
    const n8nClient = {
      createWorkflow: async () => ({ id: 'wf-1', name: 'Demo' }),
    };
    const deployer = new WorkflowDeployer(n8nClient as any, 'http://localhost:5678');

    const result = await deployer.createWorkflow({ name: 'Demo', nodes: [], connections: {} });

    expect(result.workflowId).toBe('wf-1');
    expect(result.workflowUrl).toContain('/workflow/wf-1');
  });
});
