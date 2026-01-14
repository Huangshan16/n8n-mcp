import { useCallback, useEffect, useRef, useState } from 'react';
import {
  confirmAgentWorkflow,
  createWorkflow as createWorkflowApi,
  resetAgentSession,
  sendAgentMessage,
} from '../lib/agentApi';
import type { WorkflowCreateResult, WorkflowDefinition, AgentResponse, WorkflowBlueprint } from '../lib/agentApi';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  workflow?: WorkflowDefinition;
  blueprint?: WorkflowBlueprint;
  reasoning?: string;
  interaction?: AgentResponse['interaction'];
  metadata?: {
    iterations?: number;
    nodeCount?: number;
    showContinueButton?: boolean;
    showConfirmBuildButton?: boolean;
  };
  variant?: 'error' | 'normal';
  responseType?: AgentResponse['type'];
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';
export type BuildStatus = 0 | 1 | 2 | 3;

const WS_URL = import.meta.env.VITE_AGENT_WS_URL || 'ws://localhost:3005/ws';

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const [buildStatus, setBuildStatus] = useState<BuildStatus>(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const handleAgentResponse = useCallback((payload: any) => {
    if (payload?.sessionId) {
      setSessionId(payload.sessionId);
    }

    const response = payload?.response as AgentResponse | undefined;
    if (!response?.message) {
      return;
    }

    if (response.type === 'workflow_ready') {
      setBuildStatus(2);
    }
    if (
      response.type === 'guidance' ||
      response.type === 'summary_ready' ||
      response.type === 'select_single' ||
      response.type === 'select_multi' ||
      response.type === 'image_upload'
    ) {
      setBuildStatus(0);
    }
    if (response.type === 'error') {
      setBuildStatus(0);
    }

    appendMessage({
      id: `agent-${Date.now()}`,
      role: 'assistant',
      text: response.message,
      workflow: response.workflow,
      blueprint: response.blueprint,
      reasoning: response.reasoning,
      interaction: response.interaction,
      metadata: response.metadata,
      variant: response.type === 'error' ? 'error' : 'normal',
      responseType: response.type,
    });
  }, [appendMessage]);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current) {
      return;
    }

    setStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setStatus('open');
    });

    ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data as string);
        if (payload.type === 'agent_response') {
          handleAgentResponse(payload);
        }
      } catch {
        // Ignore malformed payloads.
      }
    });

    ws.addEventListener('close', () => {
      setStatus('closed');
      wsRef.current = null;

      if (reconnectTimer.current === null) {
        reconnectTimer.current = window.setTimeout(() => {
          reconnectTimer.current = null;
          connectWebSocket();
        }, 1500);
      }
    });

    ws.addEventListener('error', () => {
      setStatus('error');
    });
  }, [handleAgentResponse]);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (reconnectTimer.current) {
        window.clearTimeout(reconnectTimer.current);
      }
      const socket = wsRef.current;
      if (socket) {
        if (socket.readyState === WebSocket.CONNECTING) {
          const handleOpen = () => {
            socket.removeEventListener('open', handleOpen);
            socket.close();
          };
          socket.addEventListener('open', handleOpen);
        } else {
          socket.close();
        }
      }
      wsRef.current = null;
    };
  }, [connectWebSocket]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        return;
      }

      appendMessage({ id: `user-${Date.now()}`, role: 'user', text });
      setIsBusy(true);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'user_message',
            sessionId,
            message: text,
          })
        );
        setIsBusy(false);
        return;
      }

      try {
        const response = await sendAgentMessage(text, sessionId);
        handleAgentResponse({ type: 'agent_response', ...response });
      } finally {
        setIsBusy(false);
      }
    },
    [appendMessage, handleAgentResponse, sessionId]
  );

  const createWorkflow = useCallback(
    async (workflow: WorkflowDefinition): Promise<WorkflowCreateResult> => {
      const result = await createWorkflowApi(workflow, sessionId);
      setBuildStatus(3);
      return result;
    },
    [sessionId]
  );

  const confirmWorkflow = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setBuildStatus(1);
    setIsBusy(true);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'confirm_workflow',
          sessionId,
        })
      );
      setIsBusy(false);
      return;
    }

    try {
      const response = await confirmAgentWorkflow(sessionId);
      handleAgentResponse({ type: 'agent_response', ...response });
    } finally {
      setIsBusy(false);
    }
  }, [handleAgentResponse, sessionId]);

  const restartConversation = useCallback(async () => {
    if (sessionId) {
      await resetAgentSession(sessionId).catch(() => undefined);
    }
    setMessages([]);
    setBuildStatus(0);
    setSessionId(undefined);
  }, [sessionId]);

  return {
    messages,
    status,
    isBusy,
    sendMessage,
    createWorkflow,
    confirmWorkflow,
    restartConversation,
    buildStatus,
  };
}
