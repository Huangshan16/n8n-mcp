import { describe, expect, it, vi } from 'vitest';
import { MCPClient } from '../../../src/agents/mcp-client';

describe('MCPClient', () => {
  it('rejects workflows that use disallowed nodes', async () => {
    const nodeRepository = {
      searchNodes: vi.fn(),
      getNodeByType: vi.fn(),
    };
    const workflowValidator = {
      validateWorkflow: vi.fn(),
    };
    const client = new MCPClient(nodeRepository as any, {
      workflowValidator: workflowValidator as any,
      allowedNodeTypes: ['n8n-nodes-base.set'],
    });

    const workflow = {
      name: 'Demo',
      nodes: [
        {
          id: 'node-1',
          name: 'HTTP',
          type: 'n8n-nodes-base.httpRequest',
          position: [0, 0],
          parameters: {},
        },
      ],
      connections: {},
    };

    const result = await client.validateWorkflow(workflow as any);

    expect(result.isValid).toBe(false);
    expect(result.errors[0].message).toContain('not allowed');
    expect(workflowValidator.validateWorkflow).not.toHaveBeenCalled();
  });
});
