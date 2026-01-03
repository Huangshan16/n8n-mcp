export interface WorkflowCommand {
  scenarioId: string;
  params: Record<string, unknown>;
  displayText: string;
}

const COMMAND_PREFIX = '#CREATE_WORKFLOW:';

export function parseCommandText(text: string): WorkflowCommand | null {
  const index = text.indexOf(COMMAND_PREFIX);
  if (index === -1) {
    return null;
  }

  const payload = text.slice(index + COMMAND_PREFIX.length).trim();
  try {
    const data = JSON.parse(payload) as WorkflowCommand;
    if (!data.scenarioId || !data.displayText) {
      return null;
    }
    return {
      scenarioId: data.scenarioId,
      params: data.params || {},
      displayText: data.displayText,
    };
  } catch {
    return null;
  }
}
