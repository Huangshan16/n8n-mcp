import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInterface } from './ChatInterface';


describe('ChatInterface', () => {
  it('renders workflow button and triggers handler', () => {
    const onCreateWorkflow = vi.fn().mockResolvedValue(null);
    const onConfirmWorkflow = vi.fn().mockResolvedValue(undefined);
    const messages = [
      {
        id: '1',
        role: 'assistant' as const,
        text: '准备好了',
        workflow: {
          name: 'Demo',
          nodes: [],
          connections: {},
        },
      },
    ];

    render(
      <ChatInterface
        messages={messages}
        onSend={() => undefined}
        onCreateWorkflow={onCreateWorkflow}
        onConfirmWorkflow={onConfirmWorkflow}
        status="open"
        isBusy={false}
      />
    );

    const button = screen.getByRole('button', { name: '创建工作流' });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(onCreateWorkflow).toHaveBeenCalled();
  });

  it('triggers confirm handler from summary response', () => {
    const onConfirmWorkflow = vi.fn().mockResolvedValue(undefined);
    const messages = [
      {
        id: 'summary-1',
        role: 'assistant' as const,
        text: '已整理逻辑',
        responseType: 'summary_ready' as const,
        blueprint: {
          intentSummary: 'demo',
          triggers: [{ type: 'webhook', config: {} }],
          logic: [{ type: 'if', config: {} }],
          executors: [{ type: 'set', config: {} }],
          missingFields: [],
        },
      },
    ];

    render(
      <ChatInterface
        messages={messages}
        onSend={() => undefined}
        onCreateWorkflow={vi.fn()}
        onConfirmWorkflow={onConfirmWorkflow}
        status="open"
        isBusy={false}
      />
    );

    const button = screen.getByRole('button', { name: '确认构建' });
    fireEvent.click(button);
    expect(onConfirmWorkflow).toHaveBeenCalled();
  });
});
