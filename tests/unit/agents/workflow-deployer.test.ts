import { describe, expect, it, vi } from 'vitest';
import { WorkflowDeployer } from '../../../src/agents/workflow-service';
import { getN8nApiConfig } from '../../../src/config/n8n-api';
import { N8nApiClient } from '../../../src/services/n8n-api-client';

vi.mock('../../../src/config/n8n-api', () => ({
  getN8nApiConfig: vi.fn(),
}));

vi.mock('../../../src/services/n8n-api-client', () => ({
  N8nApiClient: vi.fn(),
}));

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

  it('uses public URL for workflow links when configured', async () => {
    const createWorkflow = vi.fn().mockResolvedValue({ id: 'wf-2', name: 'Demo' });
    const config = {
      baseUrl: 'http://localhost:5678/api/v1',
      publicUrl: 'http://public.example.com:5678',
      apiKey: 'test-key',
      timeout: 30000,
      maxRetries: 3,
    };

    vi.mocked(getN8nApiConfig).mockReturnValue(config as any);
    vi.mocked(N8nApiClient).mockImplementation(() => ({ createWorkflow }) as any);

    const deployer = WorkflowDeployer.create();
    const result = await deployer.createWorkflow({ name: 'Demo', nodes: [], connections: {} });

    expect(result.workflowUrl).toBe('http://public.example.com:5678/workflow/wf-2');
  });
});
