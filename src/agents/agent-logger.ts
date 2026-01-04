import { logger } from '../utils/logger';
import type { AgentPhase, WorkflowDefinition } from './types';

export interface ValidationSummary {
  isValid: boolean;
  errors: Array<{ message: string; code?: string; nodeName?: string; nodeId?: string }>;
  warnings: Array<{ message: string; code?: string; nodeName?: string; nodeId?: string }>;
}

export class AgentLogger {
  logUserInput(data: { sessionId: string; phase: AgentPhase; turnCount: number; message: string }): void {
    logger.info('Agent: user input', {
      sessionId: data.sessionId,
      phase: data.phase,
      turnCount: data.turnCount,
      messageLength: data.message.length,
    });
  }

  logPhaseChange(data: { sessionId: string; from: AgentPhase; to: AgentPhase }): void {
    logger.info('Agent: phase transition', data);
  }

  logSummaryGeneration(data: {
    sessionId: string;
    turnCount: number;
    confirmedEntities: Record<string, string>;
    missingInfo: string[];
    summary: string;
  }): void {
    logger.info('Agent: summary generated', {
      sessionId: data.sessionId,
      turnCount: data.turnCount,
      confirmedEntities: data.confirmedEntities,
      missingInfo: data.missingInfo,
      summary: data.summary,
    });
  }

  logWorkflowGenerated(data: {
    sessionId: string;
    attempt: number;
    workflow: WorkflowDefinition;
    reasoning: string;
  }): void {
    logger.info('Agent: workflow JSON generated', {
      sessionId: data.sessionId,
      attempt: data.attempt,
      reasoning: data.reasoning,
      nodeCount: data.workflow.nodes.length,
      workflow: JSON.stringify(data.workflow, null, 2),
    });
  }

  logValidationResult(data: {
    sessionId: string;
    attempt: number;
    stage: 'initial' | 'autofix';
    validationResult: ValidationSummary;
  }): void {
    logger.info('Agent: validation result', {
      sessionId: data.sessionId,
      attempt: data.attempt,
      stage: data.stage,
      isValid: data.validationResult.isValid,
      errorCount: data.validationResult.errors.length,
      warningCount: data.validationResult.warnings.length,
      errors: data.validationResult.errors,
      warnings: data.validationResult.warnings,
    });
  }

  logLLMCall(data: {
    sessionId: string;
    phase: AgentPhase;
    systemPrompt: string;
    userMessage: string;
    response: string;
  }): void {
    logger.debug('Agent: LLM call', {
      sessionId: data.sessionId,
      phase: data.phase,
      systemPrompt: data.systemPrompt,
      userMessage: data.userMessage,
      response: data.response,
      systemPromptLength: data.systemPrompt.length,
      responseLength: data.response.length,
    });
  }
}
