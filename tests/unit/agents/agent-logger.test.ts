import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentLogger } from '../../../src/agents/agent-logger';
import { logger } from '../../../src/utils/logger';

describe('AgentLogger', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('logs user input details', () => {
    const agentLogger = new AgentLogger();

    agentLogger.logUserInput({
      sessionId: 'session-1',
      phase: 'understanding',
      turnCount: 2,
      message: 'ping',
    });

    expect(infoSpy).toHaveBeenCalledWith(
      'Agent: user input',
      expect.objectContaining({
        sessionId: 'session-1',
        phase: 'understanding',
        turnCount: 2,
        messageLength: 4,
      })
    );
  });

  it('logs phase transitions', () => {
    const agentLogger = new AgentLogger();

    agentLogger.logPhaseChange({ sessionId: 'session-2', from: 'understanding', to: 'generating' });

    expect(infoSpy).toHaveBeenCalledWith('Agent: phase transition', {
      sessionId: 'session-2',
      from: 'understanding',
      to: 'generating',
    });
  });

  it('logs summary generation metadata', () => {
    const agentLogger = new AgentLogger();

    agentLogger.logSummaryGeneration({
      sessionId: 'session-3',
      turnCount: 3,
      confirmedEntities: { person_name: 'alice' },
      missingInfo: ['gesture'],
      summary: 'summary text',
    });

    expect(infoSpy).toHaveBeenCalledWith(
      'Agent: summary generated',
      expect.objectContaining({
        sessionId: 'session-3',
        turnCount: 3,
        confirmedEntities: { person_name: 'alice' },
        missingInfo: ['gesture'],
        summary: 'summary text',
      })
    );
  });

  it('logs workflow generation and validation', () => {
    const agentLogger = new AgentLogger();
    const workflow = {
      name: 'Test Workflow',
      nodes: [
        {
          id: '1',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          position: [0, 0],
          parameters: {},
        },
      ],
      connections: {},
    };

    agentLogger.logWorkflowGenerated({
      sessionId: 'session-4',
      attempt: 1,
      workflow: workflow as any,
      reasoning: 'reasoning text',
    });

    agentLogger.logValidationResult({
      sessionId: 'session-4',
      attempt: 1,
      stage: 'initial',
      validationResult: {
        isValid: false,
        errors: [{ message: 'missing field', code: 'MISSING' }],
        warnings: [],
      },
    });

    expect(infoSpy).toHaveBeenCalledWith(
      'Agent: workflow JSON generated',
      expect.objectContaining({
        sessionId: 'session-4',
        attempt: 1,
        reasoning: 'reasoning text',
        nodeCount: 1,
        workflow: expect.any(String),
      })
    );

    expect(infoSpy).toHaveBeenCalledWith(
      'Agent: validation result',
      expect.objectContaining({
        sessionId: 'session-4',
        attempt: 1,
        stage: 'initial',
        isValid: false,
        errorCount: 1,
        warningCount: 0,
      })
    );
  });

  it('logs LLM calls at debug level', () => {
    const agentLogger = new AgentLogger();

    agentLogger.logLLMCall({
      sessionId: 'session-5',
      phase: 'generating',
      systemPrompt: 'system prompt',
      userMessage: 'user message',
      response: 'response text',
    });

    expect(debugSpy).toHaveBeenCalledWith(
      'Agent: LLM call',
      expect.objectContaining({
        sessionId: 'session-5',
        phase: 'generating',
        systemPrompt: 'system prompt',
        userMessage: 'user message',
        response: 'response text',
        systemPromptLength: 13,
        responseLength: 13,
      })
    );
  });
});
