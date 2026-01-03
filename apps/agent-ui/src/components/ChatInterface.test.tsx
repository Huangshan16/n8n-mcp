import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInterface } from './ChatInterface';


describe('ChatInterface', () => {
  it('renders workflow button and triggers handler', () => {
    const onCreateWorkflow = vi.fn().mockResolvedValue(null);
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
        status="open"
        isBusy={false}
      />
    );

    const button = screen.getByRole('button', { name: '创建工作流' });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(onCreateWorkflow).toHaveBeenCalled();
  });
});
