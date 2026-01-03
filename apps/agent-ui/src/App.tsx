import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { ChatInterface } from './components/ChatInterface';
import { Header } from './components/Header';
import { HardwareTwinPlaceholder } from './components/HardwareTwinPlaceholder';
import { N8nIframe } from './components/N8nIframe';
import { SystemLogPlaceholder } from './components/SystemLogPlaceholder';
import { useAgentChat } from './hooks/useAgentChat';
import type { WorkflowCommand } from './lib/commandParser';

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
            <ChatInterface
              messages={messages}
              onSend={sendMessage}
              onCreateWorkflow={handleCreateWorkflow}
              status={status}
              isBusy={isBusy}
            />
          </div>
          <div className="flex-1">
            <HardwareTwinPlaceholder />
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <div className="flex-[2]">
            <N8nIframe refreshToken={refreshToken} />
          </div>
          <div className="flex-1">
            <SystemLogPlaceholder />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
