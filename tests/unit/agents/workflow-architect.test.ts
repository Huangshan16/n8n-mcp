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
});
