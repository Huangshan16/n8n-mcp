import { describe, expect, it, vi } from 'vitest';
import { WorkflowArchitect } from '../../../src/agents/workflow-architect';

describe('WorkflowArchitect', () => {
  it('returns workflow when validation passes', async () => {
    const llmClient = {
      chat: vi.fn().mockResolvedValue(
        [
          'Reasoning: 使用摄像头识别人脸后执行动作。',
          '```json',
          JSON.stringify({ name: '测试工作流', nodes: [], connections: {} }, null, 2),
          '```',
        ].join('\n')
      ),
    };
    const mcpClient = {
      searchNodes: vi.fn().mockResolvedValue({ nodes: [], total: 0 }),
      getNode: vi.fn().mockResolvedValue({
        nodeType: 'n8n-nodes-base.httpRequest',
        displayName: 'HTTP Request',
        defaultVersion: 4,
        properties: [],
      }),
      validateWorkflow: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: [],
        suggestions: [],
        statistics: {
          totalNodes: 0,
          enabledNodes: 0,
          triggerNodes: 0,
          validConnections: 0,
          invalidConnections: 0,
          expressionsValidated: 0,
        },
      }),
      autofixWorkflow: vi.fn(),
    } as any;

    const architect = new WorkflowArchitect(llmClient as any, mcpClient);
    const result = await architect.generateWorkflow({
      userIntent: '见到老刘打招呼',
      entities: { person_name: '老刘' },
      hardwareComponents: [],
      conversationHistory: [],
    });

    expect(result.success).toBe(true);
    expect(result.workflow?.name).toBe('测试工作流');
    expect(result.reasoning).toContain('摄像头');
  });

  it('attempts autofix when validation fails', async () => {
    const workflow = { name: '失败工作流', nodes: [], connections: {} };
    const llmClient = {
      chat: vi.fn().mockResolvedValue(
        ['Reasoning: 测试。', '```json', JSON.stringify(workflow, null, 2), '```'].join('\n')
      ),
    };
    const mcpClient = {
      searchNodes: vi.fn().mockResolvedValue({ nodes: [], total: 0 }),
      getNode: vi.fn().mockResolvedValue({
        nodeType: 'n8n-nodes-base.httpRequest',
        displayName: 'HTTP Request',
        defaultVersion: 4,
        properties: [],
      }),
      validateWorkflow: vi
        .fn()
        .mockResolvedValueOnce({
          isValid: false,
          errors: [{ message: 'missing typeVersion' }],
          warnings: [],
          suggestions: [],
          statistics: {
            totalNodes: 0,
            enabledNodes: 0,
            triggerNodes: 0,
            validConnections: 0,
            invalidConnections: 1,
            expressionsValidated: 0,
          },
        })
        .mockResolvedValueOnce({
          isValid: true,
          errors: [],
          warnings: [],
          suggestions: [],
          statistics: {
            totalNodes: 0,
            enabledNodes: 0,
            triggerNodes: 0,
            validConnections: 0,
            invalidConnections: 0,
            expressionsValidated: 0,
          },
        }),
      autofixWorkflow: vi.fn().mockResolvedValue(workflow),
    } as any;

    const architect = new WorkflowArchitect(llmClient as any, mcpClient, { maxIterations: 2 });
    const result = await architect.generateWorkflow({
      userIntent: '测试',
      entities: {},
      hardwareComponents: [],
      conversationHistory: [],
    });

    expect(result.success).toBe(true);
    expect(mcpClient.autofixWorkflow).toHaveBeenCalled();
  });

  it('normalizes legacy if node conditions before validation', async () => {
    const legacyWorkflow = {
      name: 'Legacy If Workflow',
      nodes: [
        {
          id: '1',
          name: 'If',
          type: 'n8n-nodes-base.if',
          typeVersion: 2.3,
          position: [100, 200],
          parameters: {
            conditions: {
              string: [
                {
                  value1: '={{ $json.person_name }}',
                  operation: 'equal',
                  value2: '老刘',
                },
              ],
            },
            combineOperation: 'all',
          },
        },
      ],
      connections: {},
    };
    const llmClient = {
      chat: vi.fn().mockResolvedValue(
        ['Reasoning: 测试。', '```json', JSON.stringify(legacyWorkflow, null, 2), '```'].join('\n')
      ),
    };
    const mcpClient = {
      searchNodes: vi.fn().mockResolvedValue({ nodes: [], total: 0 }),
      getNode: vi.fn().mockResolvedValue({
        nodeType: 'n8n-nodes-base.if',
        displayName: 'If',
        defaultVersion: 2.3,
        properties: [],
      }),
      validateWorkflow: vi.fn().mockImplementation(async (workflow: any) => {
        const ifNode = workflow.nodes.find((node: any) => node.type === 'n8n-nodes-base.if');
        expect(ifNode.parameters.conditions).toEqual(
          expect.objectContaining({
            combinator: 'and',
            conditions: [
              expect.objectContaining({
                operator: { type: 'string', operation: 'equals' },
              }),
            ],
          })
        );
        return {
          isValid: true,
          errors: [],
          warnings: [],
          suggestions: [],
          statistics: {
            totalNodes: 1,
            enabledNodes: 1,
            triggerNodes: 0,
            validConnections: 0,
            invalidConnections: 0,
            expressionsValidated: 0,
          },
        };
      }),
      autofixWorkflow: vi.fn(),
    } as any;

    const architect = new WorkflowArchitect(llmClient as any, mcpClient);
    const result = await architect.generateWorkflow({
      userIntent: '测试',
      entities: {},
      hardwareComponents: [],
      conversationHistory: [],
    });

    expect(result.success).toBe(true);
    expect(mcpClient.validateWorkflow).toHaveBeenCalled();
  });

  it('repairs truncated JSON responses', async () => {
    const truncated = '{\n  "name": "Truncated",\n  "nodes": [],\n  "connections": {}\n';
    const llmClient = {
      chat: vi.fn().mockResolvedValue(['Reasoning: 测试。', '```json', truncated, '```'].join('\n')),
    };
    const mcpClient = {
      searchNodes: vi.fn().mockResolvedValue({ nodes: [], total: 0 }),
      getNode: vi.fn().mockResolvedValue({
        nodeType: 'n8n-nodes-base.webhook',
        displayName: 'Webhook',
        defaultVersion: 2,
        properties: [],
      }),
      validateWorkflow: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: [],
        suggestions: [],
        statistics: {
          totalNodes: 0,
          enabledNodes: 0,
          triggerNodes: 0,
          validConnections: 0,
          invalidConnections: 0,
          expressionsValidated: 0,
        },
      }),
      autofixWorkflow: vi.fn(),
    } as any;

    const architect = new WorkflowArchitect(llmClient as any, mcpClient);
    const result = await architect.generateWorkflow({
      userIntent: '测试',
      entities: {},
      hardwareComponents: [],
      conversationHistory: [],
    });

    expect(result.success).toBe(true);
    expect(result.workflow?.name).toBe('Truncated');
  });

  it('uses LLM repair when JSON is invalid', async () => {
    const invalidJson = '{ "name": "Broken" "nodes": [], "connections": {} }';
    const repairedJson = JSON.stringify({ name: 'Fixed', nodes: [], connections: {} }, null, 2);
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce(
          ['Reasoning: 测试。', '```json', invalidJson, '```'].join('\n')
        )
        .mockResolvedValueOnce(repairedJson),
    };
    const mcpClient = {
      searchNodes: vi.fn().mockResolvedValue({ nodes: [], total: 0 }),
      getNode: vi.fn().mockResolvedValue({
        nodeType: 'n8n-nodes-base.webhook',
        displayName: 'Webhook',
        defaultVersion: 2,
        properties: [],
      }),
      validateWorkflow: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: [],
        suggestions: [],
        statistics: {
          totalNodes: 0,
          enabledNodes: 0,
          triggerNodes: 0,
          validConnections: 0,
          invalidConnections: 0,
          expressionsValidated: 0,
        },
      }),
      autofixWorkflow: vi.fn(),
    } as any;

    const architect = new WorkflowArchitect(llmClient as any, mcpClient);
    const result = await architect.generateWorkflow({
      userIntent: '测试',
      entities: {},
      hardwareComponents: [],
      conversationHistory: [],
    });

    expect(result.success).toBe(true);
    expect(result.workflow?.name).toBe('Fixed');
    expect(llmClient.chat).toHaveBeenCalledTimes(2);
  });

  it('assigns unique node ids when missing or duplicated', async () => {
    const workflowWithMissingIds = {
      name: 'Missing IDs',
      nodes: [
        { name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: {} },
        { name: 'If', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [200, 0], parameters: { conditions: { combinator: 'and', conditions: [] } } },
        { id: 'dup', name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 3, position: [400, 0], parameters: {} },
        { id: 'dup', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [600, 0], parameters: {} },
      ],
      connections: {},
    };
    const llmClient = {
      chat: vi.fn().mockResolvedValue(
        ['Reasoning: 测试。', '```json', JSON.stringify(workflowWithMissingIds, null, 2), '```'].join('\n')
      ),
    };
    const mcpClient = {
      searchNodes: vi.fn().mockResolvedValue({ nodes: [], total: 0 }),
      getNode: vi.fn().mockResolvedValue({
        nodeType: 'n8n-nodes-base.webhook',
        displayName: 'Webhook',
        defaultVersion: 2,
        properties: [],
      }),
      validateWorkflow: vi.fn().mockImplementation(async (workflow: any) => {
        const ids = workflow.nodes.map((node: any) => node.id);
        expect(ids.filter((id: string) => !id)).toHaveLength(0);
        expect(new Set(ids).size).toBe(ids.length);
        return {
          isValid: true,
          errors: [],
          warnings: [],
          suggestions: [],
          statistics: {
            totalNodes: workflow.nodes.length,
            enabledNodes: workflow.nodes.length,
            triggerNodes: 1,
            validConnections: 0,
            invalidConnections: 0,
            expressionsValidated: 0,
          },
        };
      }),
      autofixWorkflow: vi.fn(),
    } as any;

    const architect = new WorkflowArchitect(llmClient as any, mcpClient);
    const result = await architect.generateWorkflow({
      userIntent: '测试',
      entities: {},
      hardwareComponents: [],
      conversationHistory: [],
    });

    expect(result.success).toBe(true);
  });
});
