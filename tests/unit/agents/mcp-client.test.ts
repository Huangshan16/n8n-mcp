import { describe, expect, it, vi } from 'vitest';
import { MCPClient } from '../../../src/agents/mcp-client';

describe('MCPClient', () => {
  it('searchNodes maps node data and caches results', async () => {
    const searchNodes = vi.fn().mockReturnValue([
      { nodeType: 'n8n-nodes-base.httpRequest', displayName: 'HTTP Request', description: 'desc', category: 'core' },
    ]);

    const repo = { searchNodes } as any;
    const client = new MCPClient(repo);

    const first = await client.searchNodes({ query: 'http' });
    const second = await client.searchNodes({ query: 'http' });

    expect(first.total).toBe(1);
    expect(first.nodes[0].nodeType).toBe('n8n-nodes-base.httpRequest');
    expect(second.nodes[0].displayName).toBe('HTTP Request');
    expect(searchNodes).toHaveBeenCalledTimes(1);
  });

  it('getNode filters properties for standard detail', async () => {
    const repo = {
      getNodeByType: vi.fn().mockReturnValue({
        nodeType: 'n8n-nodes-base.httpRequest',
        displayName: 'HTTP Request',
        description: 'desc',
        version: 4,
        properties: [
          { name: 'resource', required: true },
          { name: 'url', required: false },
          { name: 'misc', required: false },
        ],
      }),
    } as any;

    const client = new MCPClient(repo);
    const result = await client.getNode({ nodeType: 'n8n-nodes-base.httpRequest', detail: 'standard' });

    expect(result.defaultVersion).toBe(4);
    expect(result.properties?.some((prop) => prop.name === 'resource')).toBe(true);
    expect(result.properties?.some((prop) => prop.name === 'misc')).toBe(false);
  });

  it('validateWorkflow maps validator result', async () => {
    const repo = { searchNodes: vi.fn(), getNodeByType: vi.fn() } as any;
    const workflowValidator = {
      validateWorkflow: vi.fn().mockResolvedValue({
        valid: true,
        errors: [],
        warnings: [],
        statistics: {
          totalNodes: 1,
          enabledNodes: 1,
          triggerNodes: 1,
          validConnections: 1,
          invalidConnections: 0,
          expressionsValidated: 0,
        },
        suggestions: [],
      }),
    };
    const client = new MCPClient(repo, { workflowValidator });

    const result = await client.validateWorkflow({ name: 'wf', nodes: [], connections: {} });
    expect(result.isValid).toBe(true);
  });

  it('autofixWorkflow returns original when no fixes available', async () => {
    const repo = { searchNodes: vi.fn(), getNodeByType: vi.fn() } as any;
    const workflowValidator = {
      validateWorkflow: vi.fn().mockResolvedValue({
        valid: false,
        errors: [{ message: 'missing typeVersion' }],
        warnings: [],
        statistics: {
          totalNodes: 1,
          enabledNodes: 1,
          triggerNodes: 1,
          validConnections: 0,
          invalidConnections: 1,
          expressionsValidated: 0,
        },
        suggestions: [],
      }),
    };
    const autoFixer = {
      generateFixes: vi.fn().mockResolvedValue({ operations: [] }),
    } as any;
    const diffEngine = { applyDiff: vi.fn() } as any;
    const client = new MCPClient(repo, { workflowValidator, autoFixer, diffEngine });

    const workflow = { name: 'wf', nodes: [], connections: {} };
    const result = await client.autofixWorkflow(workflow);

    expect(result).toBe(workflow);
    expect(diffEngine.applyDiff).not.toHaveBeenCalled();
  });
});
