# Agent Backend 重构执行方案

**基于 Agent_Design_v2.md 设计文档与实际测试反馈**

---

## 📋 执行摘要

### 当前问题诊断

基于测试对话分析，现有Agent实现存在**6大核心缺陷**：

| 问题类别 | 现象 | 根因 | 影响 |
|---------|------|------|------|
| **上下文管理混乱** | 音色a/中指手势被重复询问3次以上 | Session未正确累积已确认信息 | 用户体验极差 |
| **整理逻辑断层** | 每3轮整理只显示最近配置 | 整理时未合并历史上下文 | 丢失关键信息 |
| **校验失败处理粗暴** | 返回"Unexpected end of JSON input" | 错误直接抛给用户，未自动重试 | 无法自愈 |
| **前端体验缺失** | 无进度提示、无重新开始按钮 | UI组件未实现 | 交互不友好 |
| **日志不完整** | 无法追踪构建过程 | Logger调用不足 | 问题无法排查 |
| **询问逻辑偏离** | 询问"心情如何？" | Prompt未聚焦工作流配置 | 效率低下 |

### 设计文档核心要求

**Agent_Design_v2.md 定义的标准流程**：

```
阶段1: 需求理解（intake agent）
  ├─ 确认工作流整体逻辑
  ├─ 确认每个节点的配置需求
  ├─ 每3轮对话 → 主动汇总上下文 → 显示"继续交流""确认构建"按钮
  └─ 用户点击"确认构建" → 进入阶段2

阶段2: 工作流生成（validate_workflow）
  ├─ 基于累积的上下文生成完整JSON
  ├─ 调用validate_workflow校验
  ├─ 校验失败 → Agent自动重试（最多3次）
  └─ 校验成功 → 进入阶段3

阶段3: 工作流部署（Workflow Management）
  └─ 调用n8n API创建工作流 → 刷新前端
```

**节点边界（6种官方节点）**：
1. **触发器**: webhook, scheduleTrigger
2. **逻辑器**: if, splitInBatches
3. **执行器**: set, httpRequest

**Demo场景（个性化手势交互）**：
- 用户输入: "见到老刘竖个中指骂人，见到老付比个V打招呼"
- 自定义节点配置:
  1. 机械手 - 手势执行（中指/V/大拇指）
  2. 摄像头 - 视频输入（无需配置）
  3. 喇叭 - 音频播放（无需配置）
  4. TTS - 音频生成（音色a/b/c）
  5. yolov8 - 人脸识别（人脸图片：老刘/老付/老王）

---

## 🔍 现有实现验收

### 已实现组件清单 (1687行代码)

✅ **核心组件完整**：
- `IntakeAgent` (245行) - 需求理解入口
- `WorkflowArchitect` (259行) - AI工作流生成器
- `MCPClient` (236行) - n8n-mcp工具封装
- `SessionService` (123行) - 会话状态管理
- `LLMClient` (108行) - OpenAI集成
- `HardwareComponents` (134行) - 7个硬件组件定义

✅ **Prompt体系完整**：
- `architect-system.ts` (71行) - 系统提示词
- `few-shot-examples.ts` - Few-shot示例
- `error-patterns.ts` - 错误修复模式
- `prompt-variants.ts` - Prompt变体

✅ **数据库支持**：
- `agent-db.ts` - hardware_components表 + agent_sessions表
- 已移除scenarios表（符合V2.0设计）

### 关键缺陷定位

#### 缺陷1: 上下文累积逻辑缺失

**问题代码** (`intake-agent.ts:93-150`):
```typescript
private async extractIntent(message: string, history: ConversationTurn[]): Promise<Intent> {
  // ❌ 问题：每次extractIntent都是基于完整history，但没有累积已确认的实体
  const systemPrompt = `你是一个意图分析专家...`;
  const response = await this.llmClient.chat({
    systemPrompt,
    messages: [...history, { role: 'user', content: message }],
  });
  return JSON.parse(this.extractJSON(response.content));
}
```

**根因**：
- Intent对象每次重新解析，未保留之前确认的entities
- 缺少`confirmedEntities`字段持久化

#### 缺陷2: 每3轮整理逻辑不完整

**问题代码** (`intake-agent.ts:20-91`):
```typescript
async processUserInput(userMessage: string, sessionId: string): Promise<AgentResponse> {
  // ❌ 缺少：每3轮检测逻辑
  // ❌ 缺少：汇总历史上下文生成概述
  // ❌ 缺少：返回"继续交流""确认构建"按钮

  const intent = await this.extractIntent(userMessage, history);
  const missingInfo = this.checkMissingInfo(intent);

  if (missingInfo.length > 0) {
    // 继续询问
  }

  // ❌ 直接进入工作流生成，没有等待"确认构建"触发
  const result = await this.workflowArchitect.generateWorkflow(...);
}
```

**根因**：
- 未实现`turnCount`计数器
- 未实现`generateSummary()`方法
- 缺少`summary_ready`响应类型

#### 缺陷3: 校验失败后直接返回错误

**问题代码** (`intake-agent.ts:61-67`):
```typescript
if (!result.success || !result.workflow) {
  // ❌ 直接返回错误给用户，没有自动重试
  return {
    type: 'error',
    message: `工作流生成失败：${result.validationResult?.errors[0]?.message || '未知错误'}`,
    details: result.validationResult,
  };
}
```

**根因**：
- WorkflowArchitect内部有重试逻辑（maxIterations=5），但失败后直接抛出
- 应该在IntakeAgent层再次尝试引导用户补充信息

#### 缺陷4: Prompt询问无关问题

**问题代码** (`intake-agent.ts:98-125`):
```typescript
const systemPrompt = `
你是一个意图分析专家，专门理解用户对硬件机器人的需求。

任务：
1. 识别用户意图类型（face_recognition_action, emotion_interaction, ...）
2. 提取关键实体（person_name, gesture, speech_content, ...）
3. 判断信息完整性（是否缺少关键参数）

// ❌ 问题：没有明确限制只询问工作流配置相关信息
// 导致Agent询问"心情如何？"、"只说中文吗？"等无关问题
`;
```

**根因**：
- Prompt未聚焦"工作流节点配置"
- 缺少"禁止询问列表"

#### 缺陷5: 前端缺少进度提示和重置按钮

**前端组件** (`apps/agent-ui/src/components/ChatInterface.tsx`):
```tsx
// ❌ 缺少：构建进度条组件
// ❌ 缺少：重新开始对话按钮
// ❌ 缺少：处理summary_ready响应类型
```

#### 缺陷6: 日志不完整

**日志调用不足**：
```typescript
// ✅ 有的日志
logger.debug('IntakeAgent: processing message', { sessionId, messageLength });

// ❌ 缺少的日志
// - 每3轮整理的触发日志
// - 生成的JSON文档记录
// - validate_workflow的详细返回信息
// - LLM调用的完整Prompt和响应
```

---

## 🎯 重构目标

### 核心原则

1. **严格遵循设计文档** - Agent_Design_v2.md定义的3阶段流程
2. **消除重复询问** - 累积确认的信息，永不重复问
3. **自动错误修复** - 校验失败时Agent自动重试，不抛给用户
4. **聚焦配置询问** - 只询问工作流节点配置相关信息
5. **完整日志追踪** - 记录每一步关键决策和数据

### 改进指标

| 指标 | 当前 | 目标 |
|------|------|------|
| **重复询问率** | 40%+ (测试中音色a被问3次) | 0% |
| **每轮有效性** | 60% (询问无关问题) | 95% |
| **校验成功率** | 未知（直接报错） | 85%+ (3次重试) |
| **用户满意度** | 低（测试反馈） | 高（流畅体验） |
| **日志完整性** | 30% | 100% |

---

## 📐 重构实施计划

### Phase 1: 核心逻辑重构 (3天)

#### Task 1.1: IntakeAgent 三阶段改造 (1.5天)

**新增状态机**:
```typescript
// src/agents/types.ts
export type AgentPhase = 'understanding' | 'generating' | 'deploying';

export interface SessionState {
  sessionId: string;
  phase: AgentPhase;
  turnCount: number;
  confirmedEntities: Record<string, string>; // 累积确认的实体
  workflowSummary?: string; // 每3轮生成的概述
  generatedWorkflow?: WorkflowDefinition;
}
```

**重构 IntakeAgent.processUserInput()**:
```typescript
async processUserInput(userMessage: string, sessionId: string): Promise<AgentResponse> {
  const state = this.sessionService.getState(sessionId);

  // 阶段1: 需求理解
  if (state.phase === 'understanding') {
    return await this.handleUnderstandingPhase(userMessage, state);
  }

  // 阶段2: 工作流生成
  if (state.phase === 'generating') {
    return await this.handleGeneratingPhase(state);
  }

  // 阶段3: 部署（已有逻辑）
  if (state.phase === 'deploying') {
    return await this.handleDeployingPhase(state);
  }
}

private async handleUnderstandingPhase(
  message: string,
  state: SessionState
): Promise<AgentResponse> {
  // 1. 提取新实体（不覆盖已确认的）
  const newIntent = await this.extractIntent(message, state.conversationHistory);
  state.confirmedEntities = {
    ...state.confirmedEntities,
    ...newIntent.entities, // 只添加新的，不覆盖旧的
  };

  // 2. 检查缺失信息
  const missingInfo = this.checkMissingInfo(state.confirmedEntities);

  // 3. 每3轮整理一次
  state.turnCount += 1;
  if (state.turnCount % 3 === 0) {
    const summary = await this.generateSummary(state.confirmedEntities, missingInfo);
    state.workflowSummary = summary;

    logger.info('Agent: 3-turn summary generated', {
      sessionId: state.sessionId,
      turnCount: state.turnCount,
      confirmedEntities: state.confirmedEntities,
      missingInfo,
    });

    return {
      type: 'summary_ready',
      message: summary,
      confirmedEntities: state.confirmedEntities,
      missingInfo,
      metadata: {
        showContinueButton: true,
        showConfirmBuildButton: missingInfo.length === 0,
      },
    };
  }

  // 4. 正常询问缺失信息
  if (missingInfo.length > 0) {
    const question = await this.generateGuidanceQuestion(state.confirmedEntities, missingInfo);
    return { type: 'guidance', message: question };
  }

  // 5. 信息完整，等待用户确认构建
  return {
    type: 'guidance',
    message: '看起来信息都齐了，点击下方"确认构建"按钮开始生成工作流吧！',
  };
}

private async handleGeneratingPhase(state: SessionState): Promise<AgentResponse> {
  logger.info('Agent: entering generating phase', {
    sessionId: state.sessionId,
    confirmedEntities: state.confirmedEntities,
  });

  // 循环生成并校验，最多3次
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await this.workflowArchitect.generateWorkflow({
      userIntent: state.workflowSummary || '生成工作流',
      entities: state.confirmedEntities,
      hardwareComponents: this.hardwareComponents,
      conversationHistory: state.conversationHistory,
    });

    // 记录生成的JSON
    if (result.workflow) {
      logger.info('Agent: workflow JSON generated', {
        sessionId: state.sessionId,
        attempt,
        workflow: JSON.stringify(result.workflow, null, 2), // 完整JSON
      });
    }

    // 记录校验结果
    logger.info('Agent: validation result', {
      sessionId: state.sessionId,
      attempt,
      isValid: result.validationResult?.isValid,
      errors: result.validationResult?.errors,
      warnings: result.validationResult?.warnings,
    });

    if (result.success && result.workflow) {
      state.generatedWorkflow = result.workflow;
      state.phase = 'deploying';

      return {
        type: 'workflow_ready',
        message: `已为您生成工作流「${result.workflow.name}」。`,
        workflow: result.workflow,
        reasoning: result.reasoning,
        metadata: { iterations: result.iterations, nodeCount: result.workflow.nodes.length },
      };
    }

    // 校验失败，尝试引导用户补充
    if (attempt < 3) {
      const errorSummary = result.validationResult?.errors.map(e => e.message).join('; ') || '未知错误';
      logger.warn('Agent: validation failed, retrying', {
        sessionId: state.sessionId,
        attempt,
        errorSummary,
      });

      // 尝试从错误信息中提取缺失字段
      const missingFields = this.extractMissingFieldsFromError(errorSummary);
      if (missingFields.length > 0) {
        state.phase = 'understanding'; // 退回理解阶段
        const question = `工作流生成遇到问题，还需要确认以下信息：${missingFields.join('、')}`;
        return { type: 'guidance', message: question };
      }
    }
  }

  // 3次都失败，返回详细错误
  return {
    type: 'error',
    message: '工作流生成失败，已尝试3次。请检查配置信息是否完整。',
    details: { confirmedEntities: state.confirmedEntities },
  };
}
```

**新增方法**:
```typescript
private async generateSummary(
  confirmedEntities: Record<string, string>,
  missingInfo: string[]
): Promise<string> {
  const confirmedLines = Object.entries(confirmedEntities)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');

  const missingLines = missingInfo.length > 0
    ? `\n\n还缺少：${missingInfo.join('、')}`
    : '';

  return `
已整理当前逻辑配置：

**已确认信息**：
${confirmedLines}

**触发器**: webhook
**逻辑**: if (条件分支)
**执行**: set (数据处理) / httpRequest (硬件调用)
${missingLines}
`.trim();
}

private extractMissingFieldsFromError(errorMessage: string): string[] {
  // 从校验错误中提取缺失字段
  // 例如："Missing required field: person_name" → ["person_name"]
  const matches = errorMessage.match(/Missing required field: (\w+)/g);
  if (!matches) return [];
  return matches.map(m => m.replace('Missing required field: ', ''));
}
```

#### Task 1.2: SessionService 状态持久化 (0.5天)

**扩展 SessionService**:
```typescript
// src/agents/session-service.ts
export class SessionService {
  private sessions: Map<string, SessionState>;

  getState(sessionId: string): SessionState {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        phase: 'understanding',
        turnCount: 0,
        confirmedEntities: {},
        conversationHistory: [],
      });
    }
    return this.sessions.get(sessionId)!;
  }

  updateState(sessionId: string, updates: Partial<SessionState>): void {
    const state = this.getState(sessionId);
    Object.assign(state, updates);
  }

  resetSession(sessionId: string): void {
    this.sessions.set(sessionId, {
      sessionId,
      phase: 'understanding',
      turnCount: 0,
      confirmedEntities: {},
      conversationHistory: [],
    });
    logger.info('SessionService: session reset', { sessionId });
  }
}
```

#### Task 1.3: Prompt 聚焦工作流配置 (1天)

**重构 extractIntent 系统提示词**:
```typescript
// src/agents/intake-agent.ts
private async extractIntent(message: string, history: ConversationTurn[]): Promise<Intent> {
  const systemPrompt = `
你是一个工作流配置分析专家，专门提取用户需求中的节点配置信息。

# 可用硬件组件
${this.hardwareComponents.map(hw => `- ${hw.displayName}: ${hw.capabilities.join(', ')}`).join('\n')}

# 你的任务
从用户输入中提取以下信息：
1. **人物识别**: person_name (例如：老刘、老付)
2. **手势动作**: gesture (中指、V手势、大拇指)
3. **语音内容**: speech_content (具体说的话)
4. **音色选择**: tts_voice (a、b、c)

# 禁止询问的信息
- ❌ 情绪、心情相关（与工作流配置无关）
- ❌ 语言偏好（默认中文）
- ❌ 识别距离（由硬件决定）
- ❌ 哲学性问题

# 输出格式
\`\`\`json
{
  "category": "face_recognition_action",
  "entities": { "person_name": "老刘", "gesture": "中指", ... },
  "confidence": 0.95
}
\`\`\`

请仅提取工作流配置相关的实体，不要添加无关字段。
`;
  // ...
}
```

---

### Phase 2: 前端体验优化 (2天)

#### Task 2.1: 新增响应类型处理 (0.5天)

**扩展 AgentResponse 类型**:
```typescript
// src/agents/types.ts
export interface SummaryReadyResponse {
  type: 'summary_ready';
  message: string; // 完整的汇总概述
  confirmedEntities: Record<string, string>;
  missingInfo: string[];
  metadata: {
    showContinueButton: boolean;
    showConfirmBuildButton: boolean;
  };
}

export type AgentResponse =
  | GuidanceResponse
  | SummaryReadyResponse // 新增
  | WorkflowReadyResponse
  | ErrorResponse;
```

**前端解析**:
```tsx
// apps/agent-ui/src/components/ChatInterface.tsx
function ChatInterface() {
  const handleAgentResponse = (response: AgentResponse) => {
    if (response.type === 'summary_ready') {
      return (
        <div className="summary-message">
          <Markdown>{response.message}</Markdown>
          <div className="button-group">
            {response.metadata.showContinueButton && (
              <button onClick={() => onContinue()}>继续交流</button>
            )}
            {response.metadata.showConfirmBuildButton && (
              <button onClick={() => onConfirmBuild()}>确认构建</button>
            )}
          </div>
        </div>
      );
    }
    // ...
  };
}
```

#### Task 2.2: 进度条组件 (0.5天)

**创建 BuildProgressBar 组件**:
```tsx
// apps/agent-ui/src/components/BuildProgressBar.tsx
export function BuildProgressBar({ status }: { status: BuildStatus }) {
  return (
    <div className="progress-container">
      <div className="progress-bar">
        <div className={`step ${status >= 1 ? 'active' : ''}`}>
          <span className="step-number">1</span>
          <span className="step-label">生成JSON</span>
        </div>
        <div className={`step ${status >= 2 ? 'active' : ''}`}>
          <span className="step-number">2</span>
          <span className="step-label">校验工作流</span>
        </div>
        <div className={`step ${status >= 3 ? 'active' : ''}`}>
          <span className="step-number">3</span>
          <span className="step-label">部署到n8n</span>
        </div>
      </div>
      {status < 3 && <div className="loading-spinner"></div>}
    </div>
  );
}
```

**集成到 ChatInterface**:
```tsx
const [buildStatus, setBuildStatus] = useState<number>(0);

const handleConfirmBuild = async () => {
  setBuildStatus(1); // 生成JSON
  const response = await api.confirmBuild(sessionId);

  setBuildStatus(2); // 校验工作流
  // ... 等待校验完成

  setBuildStatus(3); // 部署完成
};

return (
  <div>
    {buildStatus > 0 && <BuildProgressBar status={buildStatus} />}
    {/* ... */}
  </div>
);
```

#### Task 2.3: 重新开始按钮 (0.5天)

**Header 组件更新**:
```tsx
// apps/agent-ui/src/components/Header.tsx
export function Header({ onRestart }: { onRestart: () => void }) {
  return (
    <header className="chat-header">
      <h1>n8n 工作流 Agent</h1>
      <div className="header-actions">
        <button className="restart-button" onClick={onRestart}>
          <RestartIcon />
          重新开始对话
        </button>
        <ConnectionStatus />
      </div>
    </header>
  );
}
```

**重置逻辑**:
```typescript
// apps/agent-ui/src/hooks/useAgentChat.ts
const restartConversation = async () => {
  await api.resetSession(sessionId);
  setMessages([]);
  setBuildStatus(0);
  // 生成新sessionId
  sessionId = generateSessionId();
};
```

#### Task 2.4: 后端支持 (0.5天)

**新增 API 端点**:
```typescript
// src/agent-server/server.ts
app.post('/api/agent/confirm-build', async (req, res) => {
  const { sessionId } = req.body;
  const state = agentService.getSessionState(sessionId);

  // 切换到生成阶段
  state.phase = 'generating';

  const result = await agentService.chat('', sessionId); // 触发工作流生成
  res.json(result);
});

app.post('/api/agent/reset-session', async (req, res) => {
  const { sessionId } = req.body;
  sessionService.resetSession(sessionId);
  res.json({ success: true });
});
```

---

### Phase 3: 日志增强 (1天)

#### Task 3.1: 结构化日志封装 (0.5天)

**创建 AgentLogger**:
```typescript
// src/agents/agent-logger.ts
export class AgentLogger {
  private baseLogger: Logger;

  // 每3轮整理日志
  logSummaryGeneration(data: {
    sessionId: string;
    turnCount: number;
    confirmedEntities: Record<string, string>;
    missingInfo: string[];
    summary: string;
  }): void {
    this.baseLogger.info('Agent: 3-turn summary generated', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  // JSON生成日志
  logWorkflowGenerated(data: {
    sessionId: string;
    attempt: number;
    workflow: WorkflowDefinition;
    reasoning: string;
  }): void {
    this.baseLogger.info('Agent: workflow JSON generated', {
      sessionId: data.sessionId,
      attempt: data.attempt,
      reasoning: data.reasoning,
      workflow: JSON.stringify(data.workflow, null, 2), // 完整JSON
      nodeCount: data.workflow.nodes.length,
      timestamp: new Date().toISOString(),
    });
  }

  // 校验结果日志
  logValidationResult(data: {
    sessionId: string;
    attempt: number;
    validationResult: ValidationResult;
  }): void {
    this.baseLogger.info('Agent: validation result', {
      sessionId: data.sessionId,
      attempt: data.attempt,
      isValid: data.validationResult.isValid,
      errorCount: data.validationResult.errors.length,
      warningCount: data.validationResult.warnings.length,
      errors: data.validationResult.errors.map(e => ({
        code: e.code,
        message: e.message,
        path: e.path,
      })),
      warnings: data.validationResult.warnings,
      timestamp: new Date().toISOString(),
    });
  }

  // LLM调用日志
  logLLMCall(data: {
    sessionId: string;
    phase: AgentPhase;
    systemPrompt: string;
    userMessage: string;
    response: string;
    tokenUsage?: { prompt: number; completion: number; total: number };
  }): void {
    this.baseLogger.debug('Agent: LLM call', {
      ...data,
      systemPromptLength: data.systemPrompt.length,
      timestamp: new Date().toISOString(),
    });
  }
}
```

#### Task 3.2: 日志记录点插入 (0.5天)

**IntakeAgent 日志插入**:
```typescript
// src/agents/intake-agent.ts
async processUserInput(userMessage: string, sessionId: string): Promise<AgentResponse> {
  const state = this.sessionService.getState(sessionId);

  this.agentLogger.logUserInput({
    sessionId,
    phase: state.phase,
    turnCount: state.turnCount,
    message: userMessage,
  });

  // ... 处理逻辑

  if (state.turnCount % 3 === 0) {
    this.agentLogger.logSummaryGeneration({
      sessionId,
      turnCount: state.turnCount,
      confirmedEntities: state.confirmedEntities,
      missingInfo,
      summary,
    });
  }

  return response;
}
```

**WorkflowArchitect 日志插入**:
```typescript
// src/agents/workflow-architect.ts
async generateWorkflow(request: WorkflowRequest): Promise<WorkflowResult> {
  for (let attempt = 1; attempt <= this.maxIterations; attempt++) {
    const response = await this.callLLM(messages);

    this.agentLogger.logLLMCall({
      sessionId: 'current', // 从request传入
      phase: 'generating',
      systemPrompt,
      userMessage,
      response: response.content,
      tokenUsage: response.usage,
    });

    const workflow = this.extractWorkflow(response);
    this.agentLogger.logWorkflowGenerated({
      sessionId: 'current',
      attempt,
      workflow,
      reasoning: this.extractReasoning(response),
    });

    const validation = await this.mcpClient.validateWorkflow(workflow);
    this.agentLogger.logValidationResult({
      sessionId: 'current',
      attempt,
      validationResult: validation,
    });

    // ...
  }
}
```

---

### Phase 4: 测试与验证 (2天)

#### Task 4.1: 回归测试 (1天)

**测试场景1: 个性化手势交互**
```
用户: "见到老刘竖个中指骂人"
期望:
  - 第1轮: Agent询问"骂什么内容？音色？"
  - 第2轮: 用户"傻瓜蛋；音色a"
  - 第3轮: Agent输出汇总 + 显示"继续交流""确认构建"按钮
  - 用户点击"确认构建" → 进度条显示 → 工作流创建成功
  - ✅ 全程无重复询问
  - ✅ 无无关问题
```

**测试场景2: 缺失信息补充**
```
用户: "见到老刘竖中指"
期望:
  - 第1轮: Agent询问"说什么？音色？"
  - 用户: "骂他傻瓜"
  - 第2轮: Agent询问"音色？"
  - 用户: "音色a"
  - 第3轮: 汇总 + 显示按钮
  - ✅ confirmedEntities累积：{ person_name: "老刘", gesture: "中指", speech_content: "傻瓜", tts_voice: "a" }
```

**测试场景3: 校验失败自动重试**
```
模拟: 第1次生成的JSON缺少typeVersion
期望:
  - Agent自动重试生成
  - 日志记录：attempt=1, error="Missing typeVersion"
  - 第2次生成成功
  - ✅ 用户不感知错误
```

#### Task 4.2: 端到端测试 (1天)

**E2E测试脚本**:
```typescript
// tests/e2e/agent-workflow.test.ts
describe('Agent End-to-End Workflow', () => {
  it('should complete full workflow creation without repeating questions', async () => {
    const session = await createSession();

    // Round 1
    const r1 = await agent.chat('见到老刘竖个中指骂人', session.id);
    expect(r1.type).toBe('guidance');
    expect(r1.message).toContain('骂什么');

    // Round 2
    const r2 = await agent.chat('傻瓜蛋；音色a', session.id);
    expect(r2.type).toBe('guidance');

    // Round 3 - Summary
    const r3 = await agent.chat('就这样', session.id);
    expect(r3.type).toBe('summary_ready');
    expect(r3.metadata.showConfirmBuildButton).toBe(true);

    // Confirm build
    const r4 = await agent.confirmBuild(session.id);
    expect(r4.type).toBe('workflow_ready');
    expect(r4.workflow.nodes.length).toBeGreaterThan(0);

    // Verify no repeated questions
    const allMessages = [r1.message, r2.message, r3.message];
    expect(allMessages.filter(m => m.includes('音色')).length).toBe(1);
  });
});
```

---

## 📊 验收标准

### 功能验收

| 功能点 | 验收标准 | 测试方法 |
|--------|---------|---------|
| **上下文累积** | 已确认的信息永不重复询问 | 测试场景1：音色a只问1次 |
| **每3轮整理** | 第3/6/9轮自动输出汇总 + 按钮 | 计数器测试 |
| **校验自动重试** | 失败时自动重试最多3次，不抛给用户 | Mock validation失败 |
| **聚焦配置** | 不询问"心情""语言"等无关问题 | Prompt审查 |
| **进度提示** | 构建时显示3阶段进度条 | UI测试 |
| **重新开始** | 点击按钮清空session | Session重置测试 |
| **日志完整** | 记录JSON、validation结果、LLM调用 | 日志审查 |

### 性能验收

| 指标 | 目标 | 测试方法 |
|------|------|---------|
| **单轮响应时间** | ≤ 3秒 | 压力测试 |
| **工作流生成时间** | ≤ 15秒 (含3次重试) | 计时测试 |
| **重复询问率** | 0% | 对话分析 |
| **校验成功率** | ≥ 85% (首次) | 100次生成统计 |

---

## 📝 附录

### A. 文件变更清单

**修改**:
```
src/agents/intake-agent.ts         (245行 → 400行，重构3阶段逻辑)
src/agents/session-service.ts      (123行 → 180行，状态管理扩展)
src/agents/types.ts                 (新增AgentPhase, SessionState, SummaryReadyResponse)
src/agents/agent-logger.ts          (新建，150行)
src/agent-server/server.ts          (新增2个API端点)
apps/agent-ui/src/components/ChatInterface.tsx (处理summary_ready)
apps/agent-ui/src/components/BuildProgressBar.tsx (新建)
apps/agent-ui/src/components/Header.tsx (新增重启按钮)
```

**删除**:
```
无（纯增强，不删除现有代码）
```

### B. 配置变更

**环境变量新增**:
```bash
# 日志级别
LOG_LEVEL=debug  # 开发环境使用debug，生产使用info

# Session超时
AGENT_SESSION_TIMEOUT=1800000  # 30分钟

# 重试配置
AGENT_MAX_RETRY_ATTEMPTS=3
```

### C. 测试对话验证清单

**原测试对话问题对比**:

| 问题 | 原对话表现 | 重构后期望 |
|------|-----------|-----------|
| 音色a重复询问 | 第1/4/6轮都问 | 只在第1轮问 |
| "心情如何？" | 出现 | 不出现 |
| "只说中文吗？" | 出现 | 不出现 |
| 校验失败报错 | 3次报"Unexpected end of JSON input" | 自动重试3次，成功或友好提示 |
| 整理丢失上下文 | 每次只显示最近配置 | 累积所有确认信息 |
| 缺少进度提示 | 无 | 3阶段进度条 |

---

## 🚀 实施时间线

| Phase | 任务 | 工作量 | 开始日期 | 完成日期 |
|-------|------|--------|---------|---------|
| **Phase 1** | 核心逻辑重构 | 3天 | Day 1 | Day 3 |
| **Phase 2** | 前端体验优化 | 2天 | Day 4 | Day 5 |
| **Phase 3** | 日志增强 | 1天 | Day 6 | Day 6 |
| **Phase 4** | 测试与验证 | 2天 | Day 7 | Day 8 |
| **总计** | **完整重构** | **8天** | - | - |

---

## ⚠️ 风险与缓解

### 风险1: 状态管理复杂度增加

**描述**: SessionState字段增多，可能导致状态不一致

**缓解**:
- 使用TypeScript严格类型检查
- 单元测试覆盖状态转换逻辑
- 日志记录每次状态变更

### 风险2: 3次重试仍然失败

**描述**: 某些复杂需求可能3次都无法生成有效工作流

**缓解**:
- 提供"返回理解阶段"按钮，让用户重新描述
- 记录失败案例，优化Prompt
- 提供人工干预接口（后期）

### 风险3: LLM成本增加

**描述**: 每3轮整理+重试机制可能增加LLM调用次数

**缓解**:
- 使用GPT-4o-mini降低成本
- 缓存相似需求的生成结果
- 监控Token使用，设置预算上限

---

## 🎯 下一步行动

### 立即可做（今日）

1. ✅ **审阅本文档** - 确认重构方案符合预期
2. ✅ **确认优先级** - Phase 1-4的顺序是否需要调整
3. ✅ **准备环境** - 确保开发/测试环境就绪

### 明日开始

1. **Task 1.1** - 开始IntakeAgent三阶段改造
2. **设置Milestone** - 在GitHub/Project Management工具中创建里程碑
3. **Daily Review** - 每日晚间验收当天进度

---

*Conceived by Romuald Członkowski - [www.aiadvisors.pl/en](https://www.aiadvisors.pl/en)*
