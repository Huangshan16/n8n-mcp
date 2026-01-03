import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCommandText, WorkflowCommand } from '../lib/commandParser';
import { createWorkflow as createWorkflowApi, sendAgentMessage } from '../lib/agentApi';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  command?: WorkflowCommand;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';

const WS_URL = import.meta.env.VITE_AGENT_WS_URL || 'ws://localhost:3005/ws';

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const handleAgentResponse = useCallback((payload: any) => {
    if (payload?.sessionId) {
      setSessionId(payload.sessionId);
    }

    const response = payload?.response;
    if (!response?.message) {
      return;
    }

    const command = response.command || parseCommandText(response.commandText || response.message);
    appendMessage({
      id: `agent-${Date.now()}`,
      role: 'assistant',
      text: response.message,
      command: command || undefined,
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
      wsRef.current?.close();
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

  const createWorkflow = useCallback(async (command: WorkflowCommand) => {
    return createWorkflowApi(command);
  }, []);

  return {
    messages,
    status,
    isBusy,
    sendMessage,
    createWorkflow,
  };
}
