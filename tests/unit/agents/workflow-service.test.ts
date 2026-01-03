import { describe, expect, it, vi } from 'vitest';
import { WorkflowService } from '../../../src/agents/workflow-service';
import { DEFAULT_SCENARIOS } from '../../../src/agents/scenario-seeds';

const scenario = DEFAULT_SCENARIOS[0];

describe('WorkflowService', () => {
  it('renders templates and calls n8n API', async () => {
    const scenarioRepository = {
      findById: vi.fn().mockResolvedValue(scenario),
    } as any;

    const createWorkflow = vi.fn().mockResolvedValue({
      id: 'wf-123',
      name: 'Test Workflow',
    });

    const service = new WorkflowService(scenarioRepository, { createWorkflow }, 'http://localhost:5678');

    const result = await service.createWorkflow('face-gesture-interaction', {
      person_name: '老刘',
      gesture_action: '挥手',
      speech_content: '你好',
    });

    expect(createWorkflow).toHaveBeenCalled();
    expect(result.workflowId).toBe('wf-123');
    expect(result.workflowUrl).toBe('http://localhost:5678/workflow/wf-123');
  });

  it('throws on missing required params', async () => {
    const scenarioRepository = {
      findById: vi.fn().mockResolvedValue(scenario),
    } as any;

    const service = new WorkflowService(scenarioRepository, { createWorkflow: vi.fn() }, 'http://localhost:5678');

    await expect(service.createWorkflow('face-gesture-interaction', { person_name: '老刘' })).rejects.toThrow(
      'Missing required parameter'
    );
  });
});
