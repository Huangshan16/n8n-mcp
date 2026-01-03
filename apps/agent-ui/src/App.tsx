import { Suspense, lazy, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ChatInterface } from './components/ChatInterface';
import { Header } from './components/Header';
import { useAgentChat } from './hooks/useAgentChat';
import type { WorkflowCommand } from './lib/commandParser';

const N8nIframe = lazy(() =>
  import('./components/N8nIframe').then((module) => ({ default: module.N8nIframe }))
);

function App() {
  const { messages, status, isBusy, sendMessage, createWorkflow } = useAgentChat();
  const [refreshToken, setRefreshToken] = useState(0);

  const handleCreateWorkflow = async (command: WorkflowCommand) => {
    try {
      const result = await createWorkflow(command);
      toast.success(`工作流已创建: ${result.workflowName || result.workflowId}`);
      setRefreshToken((prev) => prev + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '工作流创建失败');
    }
  };

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4">
      <Header status={status} />

      <div className="flex flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex-[2]">
            <Suspense
              fallback={<div className="glass-panel h-full rounded-3xl p-6 text-cyan-200/60">Loading...</div>}
            >
              <N8nIframe refreshToken={refreshToken} />
            </Suspense>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <div className="flex-[2]">
            <ChatInterface
              messages={messages}
              onSend={sendMessage}
              onCreateWorkflow={handleCreateWorkflow}
              status={status}
              isBusy={isBusy}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
