# n8n-MCP Agent 后端重构实施方案

## 文档概述

**项目名称**: n8n-MCP Agent Backend Refactoring
**目标**: 将现有 n8n-MCP 项目重构为完整的 Agent 后端系统 + 测试前端
**设计依据**:
- Agent 设计文档: `docs/refactor/IntakeAgent_Design.md`
- 前端原型: `docs/refactor/prototype.html`
- 现有项目架构: n8n-MCP v2.31+

**版本**: 1.0.0
**日期**: 2026-01-03

---

## 已废弃组件 (V2)

下列 V1 组件已移除或不再使用，改为动态工作流生成流程：

- `src/agents/scenario-seeds.ts`
- `src/agents/scenario-repository.ts`
- `src/agents/scenario-matcher.ts`
- `src/agents/command-generator.ts`
- `src/agents/template-renderer.ts`
- `scenarios` 数据表（agent-db）

## 目录

1. [重构目标与愿景](#1-重构目标与愿景)
2. [当前架构分析](#2-当前架构分析)
3. [目标架构设计](#3-目标架构设计)
4. [分阶段实施计划](#4-分阶段实施计划)
5. [技术实现细节](#5-技术实现细节)
6. [测试策略](#6-测试策略)
7. [风险评估与缓解](#7-风险评估与缓解)
8. [附录](#8-附录)

---

## 1. 重构目标与愿景

### 1.1 核心目标

将 n8n-MCP 从单纯的**文档/工作流管理工具**升级为**智能 Agent 后端系统**，实现：

1. **自然语言理解** → 接收用户描述（如"帮我搭建一个见到老付就打招呼的机器人"）
2. **意图分类与需求收敛** → Intake Agent 多轮对话，收集足够的工作流上下文
3. **指令集输出** → Agent 输出特殊指令集（如 `#CREATE_WORKFLOW:{scenario_id, params}`）
4. **前端交互渲染** → 对话窗口正则匹配指令集，渲染成可点击按钮
5. **工作流创建** → 用户点击按钮 → 直接调用本地 n8n 实例 API 创建工作流
6. **n8n 界面嵌入** → 前端嵌入本地 n8n 界面（iframe），实时查看工作流

### 1.2 使用场景

**Demo场景示例**（来自 IntakeAgent_Design.md）：

| 场景 | 用户输入 | 涉及硬件组件 | 工作流逻辑 |
|------|---------|-------------|-----------|
| **个性化手势交互** | "见到老刘竖个中指骂人，见到老付比个V打招呼" | 机械手、摄像头、喇叭、底盘 | 人脸识别 → 条件分支 → 手势控制 + TTS |
| **情感交互** | "我想做一个和我共情的机器人" | 机械臂、摄像头、喇叭、屏幕、麦克风 | 语音识别 + 视觉识别 → 情绪分析 → 表情显示 + 动作控制 |
| **游戏互动** | "我想有一个和我玩石头剪刀布的机器人" | 机械手、摄像头、喇叭、屏幕 | 倒数语音 → 手势识别 → 输赢判断 → 反馈 |

### 1.3 成功标准

- ✅ **功能完整性**: Intake Agent 能够处理 80% 的典型机器人场景
- ✅ **响应时间**: 从输入到工作流生成 < 5 秒
- ✅ **准确率**: 工作流验证通过率 > 95%
- ✅ **用户体验**: 前端交互流畅，可视化直观
- ✅ **可扩展性**: 支持新增硬件组件和场景模板

---

## 2. 当前架构分析

### 2.1 现有能力盘点

#### 核心优势

| 能力模块 | 现有实现 | 覆盖率 | 复用价值 |
|---------|---------|--------|---------|
| **节点知识库** | 543 个 n8n 节点，99% 属性覆盖 | 543/545 | ⭐⭐⭐⭐⭐ |
| **工作流验证** | `WorkflowValidator` 全面验证 | 完整 | ⭐⭐⭐⭐⭐ |
| **模板系统** | 2,709 个预构建模板 | 100% | ⭐⭐⭐⭐ |
| **工作流管理** | CRUD + 版本控制 | 完整 | ⭐⭐⭐⭐⭐ |
| **属性过滤** | `PropertyFilter` 智能简化 | 完整 | ⭐⭐⭐⭐ |
| **自动修复** | `WorkflowAutoFixer` 自动修复 | 完整 | ⭐⭐⭐⭐ |
| **表达式验证** | `ExpressionValidator` 语法检查 | 完整 | ⭐⭐⭐⭐ |

#### 架构特点

```
当前架构（MCP Server）:
┌─────────────────────────────────────────┐
│  MCP Protocol Layer (stdio/HTTP)        │
├─────────────────────────────────────────┤
│  Tools Layer (29+ MCP Tools)            │
│  - search_nodes                         │
│  - get_node (essentials/standard/full)  │
│  - validate_workflow                    │
│  - create_workflow                      │
│  - update_workflow (full/partial)       │
│  - autofix_workflow                     │
│  - search_templates                     │
│  - ...                                  │
├─────────────────────────────────────────┤
│  Services Layer                         │
│  - NodeRepository (数据访问)            │
│  - PropertyFilter (属性过滤)            │
│  - ConfigValidator (配置验证)           │
│  - WorkflowValidator (工作流验证)       │
│  - TemplateService (模板服务)           │
│  - ExpressionValidator (表达式验证)     │
├─────────────────────────────────────────┤
│  Data Layer                             │
│  - SQLite Database (节点知识库)         │
│  - Template Repository (模板库)         │
└─────────────────────────────────────────┘
```

### 2.2 缺失能力分析

| 需求 | 当前状态 | 差距 |
|------|---------|-----|
| **自然语言理解** | ❌ 不支持 | 需要集成 LLM |
| **意图分类引擎** | ❌ 不支持 | 需要设计 Intake Agent |
| **场景模板匹配** | ⚠️ 部分（通用模板） | 需要硬件场景专用模板 |
| **前端交互界面** | ❌ 无前端 | 需要开发测试前端 |
| **实时可视化** | ❌ 无可视化 | 需要工作流拓扑渲染 |
| **会话状态管理** | ⚠️ 部分（HTTP模式） | 需要增强对话上下文 |

### 2.3 技术栈评估

**可复用技术**:
- ✅ TypeScript + Node.js (完整保留)
- ✅ SQLite 数据库 (扩展 Agent 状态存储)
- ✅ MCP SDK (作为底层协议可选保留)
- ✅ Vitest 测试框架 (继续使用)

**需要新增技术**:
- 🆕 **LLM 集成**: Claude/GPT API (用于自然语言理解)
- 🆕 **前端框架**: React/Vue + TailwindCSS (已有原型)
- 🆕 **WebSocket**: 实时通信 (前后端状态同步)
- 🆕 **Agent 框架**: LangChain/LangGraph (可选，用于复杂对话流)

---

## 3. 目标架构设计

### 3.1 总体架构（简化版）

```
┌────────────────────────────────────────────────────────────────┐
│                     前端层 (Web UI)                             │
│  ┌──────────────────────────┐  ┌──────────────────────────┐   │
│  │   对话界面 (Chat UI)      │  │  n8n 界面 (iframe)        │   │
│  │  - 消息列表               │  │  http://localhost:5678   │   │
│  │  - 输入框                 │  │  /home/workflows         │   │
│  │  - 指令按钮渲染           │  │  (嵌入本地 n8n)          │   │
│  └──────────────────────────┘  └──────────────────────────┘   │
│  ┌──────────────────────────┐  ┌──────────────────────────┐   │
│  │  硬件孪生 (占位)          │  │  系统日志 (占位)          │   │
│  │  (保留原型UI，不开发)     │  │  (保留原型UI，不开发)     │   │
│  └──────────────────────────┘  └──────────────────────────┘   │
└──────────────────┬─────────────────────────────────────────────┘
                   │ WebSocket (对话) + REST API (按钮点击)
┌──────────────────┴─────────────────────────────────────────────┐
│                    Agent 后端层                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  Intake Agent (核心智能层)                                 ││
│  │  - 自然语言理解 (OpenAI GPT)                               ││
│  │  - 意图分类 (Intent Classifier)                            ││
│  │  - 需求收敛引擎 (Convergence Engine)                       ││
│  │  - 指令集生成器 (Command Generator)                        ││
│  │    → 输出: #CREATE_WORKFLOW:{scenario_id, params}         ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  API 层 (简化)                                              ││
│  │  - POST /api/agent/chat     (WebSocket)                    ││
│  │  - POST /api/workflow/create  (点击按钮后调用)             ││
│  │    → 直接调用现有 n8n-mcp 的 n8n_create_workflow 工具     ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  现有 n8n-MCP 能力 (直接复用)                              ││
│  │  - n8nApiClient (已集成本地实例 API/Key)                   ││
│  │  - n8n_create_workflow 工具                                ││
│  │  - ScenarioRepository (场景模板库)                         ││
│  │  - WorkflowValidator (可选验证)                            ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────────┘
                          │ n8n REST API
                   ┌──────┴──────┐
                   │ 本地 n8n 实例 │
                   │ :5678        │
                   └──────────────┘
```

**关键简化点**:
1. ✅ **前端**: 对话窗口 + 嵌入 n8n iframe（无需自己实现工作流可视化）
2. ✅ **Agent 输出**: 特殊指令集（而非完整 JSON），前端渲染按钮
3. ✅ **工作流创建**: 直接调用现有 n8n-mcp 的 `n8n_create_workflow` 工具
4. ✅ **n8n 集成**: 复用已配置的本地实例（API URL + API Key）

### 3.2 核心模块设计

#### 3.2.1 Intake Agent 架构

```typescript
// 新增文件: src/agents/intake-agent.ts

interface IntakeAgentConfig {
  llmProvider: 'openai';  // 使用 OpenAI
  llmModel: string;       // 例如: 'gpt-4o'
  llmApiKey: string;
  maxConversationTurns: number; // 最大对话轮次
  convergenceThreshold: number; // 需求收敛阈值
}

interface CommandInstruction {
  command: 'CREATE_WORKFLOW';
  scenarioId: string;
  params: Record<string, any>;
  displayText: string;  // 按钮显示文本，如"创建人脸识别工作流"
}

class IntakeAgent {
  private conversationHistory: ConversationTurn[];
  private intentClassifier: IntentClassifier;
  private scenarioMatcher: ScenarioMatcher;
  private commandGenerator: CommandGenerator;

  /**
   * 处理用户输入
   * @returns 引导性问题 | 指令集
   */
  async processUserInput(
    userMessage: string,
    sessionId: string
  ): Promise<AgentResponse> {
    // 1. 意图分类
    const intent = await this.intentClassifier.classify(userMessage);

    // 2. 场景匹配
    const matchedScenarios = await this.scenarioMatcher.match(intent);

    // 3. 判断是否收敛
    if (this.isConverged(matchedScenarios)) {
      // 生成指令集
      const command = await this.commandGenerator.generate(
        matchedScenarios[0]
      );

      return {
        type: 'command_ready',
        message: `已为您准备好工作流配置。点击下方按钮创建:`,
        command: command
      };
    } else {
      // 生成引导问题
      const question = await this.generateGuidanceQuestion(
        intent,
        matchedScenarios
      );
      return {
        type: 'guidance',
        message: question
      };
    }
  }

  private isConverged(scenarios: Scenario[]): boolean {
    // 判断逻辑: 是否有唯一匹配场景 + 所有必需参数已确定
    return scenarios.length === 1 &&
           scenarios[0].requiredParams.every(p => p.value !== null);
  }
}
```

#### 3.2.2 意图分类器

```typescript
// 新增文件: src/agents/intent-classifier.ts

interface Intent {
  category: 'greeting' | 'robot_task' | 'hardware_query' | 'workflow_edit';
  subCategory?: string; // 例如: 'face_recognition', 'emotion_interaction'
  entities: Entity[]; // 提取的实体: 人名、动作、硬件组件
  confidence: number;
}

class IntentClassifier {
  private llmClient: LLMClient;

  async classify(userMessage: string): Promise<Intent> {
    const systemPrompt = `
你是意图分类专家。分析用户消息，识别：
1. 意图类别 (robot_task | greeting | hardware_query | workflow_edit)
2. 子类别 (face_recognition, emotion_interaction, game_interaction, etc.)
3. 实体提取 (人名、动作、硬件组件、情感状态等)

示例输入: "见到老刘竖个中指骂人"
示例输出:
{
  "category": "robot_task",
  "subCategory": "face_recognition_action",
  "entities": [
    {"type": "person", "value": "老刘"},
    {"type": "action", "value": "竖中指"},
    {"type": "speech", "value": "骂人"}
  ],
  "confidence": 0.95
}
`;
    return this.llmClient.classify(systemPrompt, userMessage);
  }
}
```

#### 3.2.3 场景匹配器

```typescript
// 新增文件: src/agents/scenario-matcher.ts

interface Scenario {
  id: string;
  name: string;
  description: string;
  requiredComponents: string[]; // ['camera', 'speaker', 'mechanical_hand']
  requiredParams: Parameter[];
  workflowTemplate: WorkflowTemplate;
}

class ScenarioMatcher {
  private scenarioRepository: ScenarioRepository;

  async match(intent: Intent): Promise<Scenario[]> {
    // 基于意图和实体匹配预定义场景
    const candidates = await this.scenarioRepository.findByIntent(
      intent.category,
      intent.subCategory
    );

    // 按相似度排序
    return candidates.sort((a, b) =>
      this.calculateSimilarity(a, intent) -
      this.calculateSimilarity(b, intent)
    );
  }

  private calculateSimilarity(scenario: Scenario, intent: Intent): number {
    // 相似度算法: 实体匹配度 + 组件匹配度
    let score = 0;

    // 检查实体匹配
    intent.entities.forEach(entity => {
      if (scenario.requiredParams.some(p => p.type === entity.type)) {
        score += 0.3;
      }
    });

    // 检查硬件组件匹配 (基于意图推断所需硬件)
    const inferredComponents = this.inferHardwareFromIntent(intent);
    const componentMatch = scenario.requiredComponents.filter(
      c => inferredComponents.includes(c)
    ).length / scenario.requiredComponents.length;
    score += componentMatch * 0.7;

    return score;
  }
}
```

#### 3.2.4 指令集生成器（简化版）

```typescript
// 新增文件: src/agents/command-generator.ts

class CommandGenerator {
  /**
   * 生成指令集（不生成完整工作流 JSON）
   * 只需要返回场景 ID 和参数，前端点击按钮后再调用 n8n API
   */
  async generate(scenario: Scenario): Promise<CommandInstruction> {
    // 提取已确定的参数值
    const params: Record<string, any> = {};
    scenario.requiredParams.forEach(param => {
      if (param.value !== null) {
        params[param.name] = param.value;
      }
    });

    return {
      command: 'CREATE_WORKFLOW',
      scenarioId: scenario.id,
      params: params,
      displayText: `创建「${scenario.name}」工作流`
    };
  }

  /**
   * 将指令集序列化为特殊标记
   * 前端通过正则匹配该标记渲染按钮
   */
  serializeCommand(command: CommandInstruction): string {
    return `#CREATE_WORKFLOW:${JSON.stringify({
      scenarioId: command.scenarioId,
      params: command.params,
      displayText: command.displayText
    })}`;
  }
}

// 使用示例
const command = await commandGenerator.generate(scenario);
const serialized = commandGenerator.serializeCommand(command);
// 输出: "#CREATE_WORKFLOW:{\"scenarioId\":\"face-gesture-interaction\",\"params\":{\"person_name\":\"老刘\"},\"displayText\":\"创建「个性化手势交互」工作流\"}"
```

**前端正则匹配示例**:
```typescript
// 前端代码
const MESSAGE_COMMAND_PATTERN = /#CREATE_WORKFLOW:(\{.*?\})/g;

function renderMessage(message: string) {
  // 检测是否包含指令
  const match = MESSAGE_COMMAND_PATTERN.exec(message);

  if (match) {
    const commandData = JSON.parse(match[1]);

    return (
      <div>
        <p>{message.replace(MESSAGE_COMMAND_PATTERN, '')}</p>
        <button
          onClick={() => handleCreateWorkflow(commandData)}
          className="btn-create-workflow"
        >
          {commandData.displayText}
        </button>
      </div>
    );
  }

  return <p>{message}</p>;
}

async function handleCreateWorkflow(commandData: any) {
  // 调用后端 API → 后端调用 n8n-mcp 的 n8n_create_workflow 工具
  const response = await fetch('/api/workflow/create', {
    method: 'POST',
    body: JSON.stringify({
      scenarioId: commandData.scenarioId,
      params: commandData.params
    })
  });

  const result = await response.json();

  // 刷新 iframe 中的 n8n 界面
  document.getElementById('n8n-iframe').contentWindow.location.reload();
}
```

### 3.3 数据模型扩展

#### 3.3.1 新增数据库表

```sql
-- 场景模板表
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  required_components TEXT, -- JSON array: ["camera", "speaker", ...]
  required_params TEXT,     -- JSON array: [{"name": "person_name", "type": "string", ...}]
  workflow_template TEXT,   -- JSON: 完整的工作流模板
  created_at INTEGER,
  updated_at INTEGER
);

-- 硬件组件映射表 (硬件 → n8n 节点)
CREATE TABLE hardware_components (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,           -- 例如: "camera"
  display_name TEXT,             -- 例如: "摄像头"
  node_type TEXT NOT NULL,       -- 对应的 n8n 节点: "n8n-nodes-base.HttpRequest"
  default_config TEXT,           -- 默认配置 JSON
  capabilities TEXT              -- 能力列表 JSON: ["face_recognition", "object_detection"]
);

-- 会话状态表
CREATE TABLE agent_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT,
  conversation_history TEXT,     -- JSON array of conversation turns
  current_intent TEXT,           -- JSON: 当前意图
  matched_scenarios TEXT,        -- JSON array: 匹配的场景
  state TEXT,                    -- 'converging' | 'converged' | 'generating'
  created_at INTEGER,
  updated_at INTEGER
);
```

#### 3.3.2 核心数据结构

```typescript
// 新增文件: src/types/agent-types.ts

interface ConversationTurn {
  role: 'user' | 'assistant';
  message: string;
  timestamp: number;
  metadata?: {
    intent?: Intent;
    matchedScenarios?: Scenario[];
  };
}

interface AgentSession {
  sessionId: string;
  userId?: string;
  conversationHistory: ConversationTurn[];
  currentIntent?: Intent;
  matchedScenarios: Scenario[];
  state: 'converging' | 'converged' | 'generating' | 'completed';
  createdAt: number;
  updatedAt: number;
}

interface Parameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'person' | 'action' | 'emotion';
  description: string;
  value: any;
  required: boolean;
  source?: 'user_input' | 'inferred' | 'default';
}

interface WorkflowTemplate {
  name: string;
  description: string;
  nodes: INodeUi[];
  connections: IConnections;
  placeholders: string[]; // 占位符列表: ["{{ person_name }}", "{{ action }}"]
}

interface AgentResponse {
  type: 'guidance' | 'command_ready' | 'error';
  message: string;
  command?: CommandInstruction;  // 指令集（仅当 type = 'command_ready'）
  error?: string;
}
```

### 3.4 API 设计

#### 3.4.1 RESTful API 端点（简化版）

```typescript
// 新增文件: src/api/routes/agent.ts

/**
 * POST /api/agent/chat
 * 发送消息给 Intake Agent（通过 WebSocket 更好）
 */
app.post('/api/agent/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  const response = await intakeAgent.processUserInput(message, sessionId);

  res.json({
    success: true,
    data: response,
    sessionId: sessionId
  });
});

/**
 * POST /api/workflow/create
 * 创建工作流（用户点击按钮后调用）
 * 直接调用现有 n8n-mcp 的工具
 */
app.post('/api/workflow/create', async (req, res) => {
  const { scenarioId, params } = req.body;

  try {
    // 1. 加载场景模板
    const scenario = await scenarioRepository.findById(scenarioId);
    if (!scenario) {
      return res.status(404).json({
        success: false,
        error: `场景 ${scenarioId} 不存在`
      });
    }

    // 2. 填充参数生成完整工作流
    const workflow = await templateFiller.fillTemplate(
      scenario.workflowTemplate,
      params
    );

    // 3. 调用现有 n8n-mcp 的 n8n_create_workflow 工具
    // （这里直接复用 handlers-n8n-manager.ts 的逻辑）
    const result = await n8nHandlers.handleCreateWorkflow({
      name: workflow.name,
      workflow: workflow
    });

    res.json({
      success: true,
      data: {
        workflowId: result.id,
        workflowUrl: `http://localhost:5678/workflow/${result.id}`
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/scenarios
 * 获取预定义场景列表（可选，用于调试）
 */
app.get('/api/scenarios', async (req, res) => {
  const scenarios = await scenarioRepository.findAll();
  res.json({ success: true, data: scenarios });
});
```

**关键点**:
- ✅ 不需要单独的部署接口，直接在创建时完成
- ✅ 直接复用现有 `handlers-n8n-manager.ts` 的 `handleCreateWorkflow` 逻辑
- ✅ 工作流创建后返回 n8n 实例的 URL，前端刷新 iframe

#### 3.4.2 WebSocket 消息协议

```typescript
// 新增文件: src/api/websocket/agent-ws.ts

interface WSMessage {
  type: 'chat' | 'workflow_update' | 'deployment_status' | 'system_log';
  sessionId: string;
  payload: any;
}

// 客户端 → 服务端
interface ChatMessage extends WSMessage {
  type: 'chat';
  payload: {
    message: string;
  };
}

// 服务端 → 客户端
interface WorkflowUpdateMessage extends WSMessage {
  type: 'workflow_update';
  payload: {
    nodes: Array<{
      id: string;
      status: 'active' | 'inactive';
    }>;
    connections: Array<{
      from: string;
      to: string;
      status: 'active' | 'inactive';
    }>;
  };
}

interface SystemLogMessage extends WSMessage {
  type: 'system_log';
  payload: {
    level: 'info' | 'warning' | 'error';
    message: string;
    timestamp: number;
  };
}
```

### 3.5 前端实现（简化版）

#### 3.5.1 技术栈

- **框架**: React 18+ (基于现有 prototype.html 改造)
- **UI库**: TailwindCSS (已使用)
- **状态管理**: Zustand (轻量级)
- **通信**: Axios (REST) + WebSocket API
- **n8n 嵌入**: iframe

**无需额外的工作流可视化库** - 直接嵌入 n8n 自带界面

#### 3.5.2 组件结构（简化版）

```
src/frontend/
├── components/
│   ├── ChatInterface/          # 对话交互界面（核心开发）
│   │   ├── MessageList.tsx      # 消息列表 + 指令按钮渲染
│   │   ├── InputArea.tsx        # 输入框
│   │   └── QuickActions.tsx     # 快捷示例
│   ├── N8nEmbed/               # n8n 嵌入（核心开发）
│   │   └── N8nIframe.tsx        # iframe 嵌入本地 n8n
│   ├── Placeholders/           # 占位组件（保留UI，不开发）
│   │   ├── HardwareTwin.tsx     # 硬件数字孪生占位
│   │   └── SystemLog.tsx        # 系统日志占位
│   └── Layout/
│       ├── Header.tsx
│       └── MainLayout.tsx
├── hooks/
│   ├── useAgentChat.ts         # Agent 对话逻辑
│   └── useWebSocket.ts         # WebSocket 连接
├── services/
│   ├── agentApi.ts             # Agent API 封装
│   └── workflowApi.ts          # 工作流创建 API
├── stores/
│   └── chatStore.ts            # 对话状态
└── App.tsx
```

#### 3.5.3 核心交互流程（简化版）

```typescript
// src/frontend/hooks/useAgentChat.ts

export function useAgentChat(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async (text: string) => {
    setIsLoading(true);

    // 添加用户消息
    setMessages(prev => [...prev, { role: 'user', text }]);

    try {
      // 发送到 Agent
      const response = await agentApi.chat(sessionId, text);

      if (response.type === 'guidance') {
        // 显示引导问题
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: response.message
        }]);
      } else if (response.type === 'command_ready') {
        // 显示消息 + 指令按钮
        const commandText = response.command
          ? `${response.message}\n#CREATE_WORKFLOW:${JSON.stringify({
              scenarioId: response.command.scenarioId,
              params: response.command.params,
              displayText: response.command.displayText
            })}`
          : response.message;

        setMessages(prev => [...prev, {
          role: 'assistant',
          text: commandText
        }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: '抱歉，发生了错误: ' + error.message
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return { messages, sendMessage, isLoading };
}
```

```typescript
// src/frontend/components/ChatInterface/MessageList.tsx

const MESSAGE_COMMAND_PATTERN = /#CREATE_WORKFLOW:(\{.*?\})/;

function MessageItem({ message }: { message: Message }) {
  const match = MESSAGE_COMMAND_PATTERN.exec(message.text);

  if (match) {
    const commandData = JSON.parse(match[1]);
    const textWithoutCommand = message.text.replace(MESSAGE_COMMAND_PATTERN, '');

    return (
      <div className="message assistant">
        <p>{textWithoutCommand}</p>
        <button
          onClick={() => handleCreateWorkflow(commandData)}
          className="btn-create-workflow"
        >
          {commandData.displayText}
        </button>
      </div>
    );
  }

  return <div className="message">{message.text}</div>;
}

async function handleCreateWorkflow(commandData: any) {
  try {
    const response = await workflowApi.create(
      commandData.scenarioId,
      commandData.params
    );

    // 通知用户成功
    toast.success('工作流创建成功！');

    // 刷新 iframe 中的 n8n 界面
    const iframe = document.getElementById('n8n-iframe') as HTMLIFrameElement;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.location.href = response.data.workflowUrl;
    }
  } catch (error) {
    toast.error('工作流创建失败: ' + error.message);
  }
}
```

```typescript
// src/frontend/components/N8nEmbed/N8nIframe.tsx

export function N8nIframe() {
  const n8nUrl = 'http://localhost:5678/home/workflows';

  return (
    <div className="n8n-embed">
      <div className="embed-header">
        <span className="orbitron text-xs text-cyan-500">n8n Workflows</span>
      </div>
      <iframe
        id="n8n-iframe"
        src={n8nUrl}
        className="w-full h-full border-0"
        allow="fullscreen"
      />
    </div>
  );
}
```

---

## 4. 分阶段实施计划

### Phase 0: 准备阶段 (1周)

**目标**: 环境搭建 + 技术验证 + 数据清理

#### Sprint 0.1: 环境搭建 (0.3周)

- [ ] **0.1.1** 创建新分支 `feature/agent-backend`
- [ ] **0.1.2** 搭建前端开发环境 (React + Vite)
  - 初始化项目
  - 配置 TailwindCSS
  - 配置 ESLint + Prettier
- [ ] **0.1.3** LLM 集成测试 (OpenAI)
  - 测试 API Key 有效性
  - 测试 JSON 模式输出
  - 编写简单的意图分类示例
- [ ] **0.1.4** WebSocket 服务器基础搭建
  - 基于 `ws` 库
  - 测试前后端连接

#### Sprint 0.2: 数据库清理与扩展 (0.4周) 🔥 **关键任务**

**任务 A: 清理节点知识库**

- [ ] **0.2.1** 分析现有节点分类
  - 统计节点数量（按 package 和 category）
  - 识别核心通用节点 vs 第三方应用节点

- [ ] **0.2.2** 定义保留节点白名单
  ```sql
  -- 保留的核心节点（用于硬件工作流）
  - n8n-nodes-base.httpRequest       # HTTP 请求（调用硬件 API）
  - n8n-nodes-base.webhook            # Webhook 触发器
  - n8n-nodes-base.manualTrigger      # 手动触发器
  - n8n-nodes-base.scheduleTrigger    # 定时触发器（可选）
  - n8n-nodes-base.if                 # 条件分支
  - n8n-nodes-base.switch             # 多路分支
  - n8n-nodes-base.set                # 数据处理
  - n8n-nodes-base.code               # 代码执行
  - n8n-nodes-base.function           # 函数节点
  - n8n-nodes-base.merge              # 数据合并
  - n8n-nodes-base.splitInBatches     # 批量处理
  - n8n-nodes-base.loop               # 循环
  - n8n-nodes-base.wait               # 等待
  - n8n-nodes-base.errorTrigger       # 错误处理
  - @n8n/n8n-nodes-langchain.lmChatOpenAi  # OpenAI Chat（用于情感分析等）
  - @n8n/n8n-nodes-langchain.agent    # LangChain Agent（可选）
  ```

- [ ] **0.2.3** 编写数据清理脚本
  ```typescript
  // scripts/cleanup-nodes.ts

  const KEEP_NODE_TYPES = [
    'n8n-nodes-base.httpRequest',
    'n8n-nodes-base.webhook',
    'n8n-nodes-base.manualTrigger',
    'n8n-nodes-base.if',
    'n8n-nodes-base.switch',
    'n8n-nodes-base.set',
    'n8n-nodes-base.code',
    'n8n-nodes-base.function',
    // ... 完整白名单
  ];

  // 删除不在白名单中的节点
  await db.run(`
    DELETE FROM nodes
    WHERE node_type NOT IN (${KEEP_NODE_TYPES.map(t => `'${t}'`).join(',')})
  `);

  // 同步删除相关的 FTS 索引
  await db.run(`
    DELETE FROM nodes_fts
    WHERE node_type NOT IN (${KEEP_NODE_TYPES.map(t => `'${t}'`).join(',')})
  `);
  ```

- [ ] **0.2.4** 执行清理并验证
  - 备份原始数据库
  - 执行清理脚本
  - 验证保留节点数量（预计 15-20 个）
  - 测试搜索功能正常

**任务 B: 清理模板系统**

- [ ] **0.2.5** 移除预构建模板
  ```sql
  -- 清空模板表（保留表结构）
  DELETE FROM templates;
  DELETE FROM template_nodes;
  DELETE FROM template_node_configs;
  ```

- [ ] **0.2.6** 禁用模板相关功能（可选）
  - 注释掉 `TemplateService` 的模板获取逻辑
  - 或者保留服务，后续用于硬件场景模板

**任务 C: 数据库 Schema 扩展**

- [ ] **0.2.7** 创建新表
  - `scenarios` - 硬件场景模板
  - `hardware_components` - 硬件组件映射
  - `agent_sessions` - Agent 会话状态

- [ ] **0.2.8** 种子数据导入
  - 导入 3 个 Demo 场景（个性化手势、情感交互、游戏互动）
  - 导入硬件组件映射（camera, speaker, mechanical_hand 等）

#### Sprint 0.3: 技术验证 (0.3周)

- [ ] **0.3.1** 测试清理后的节点搜索
  - 搜索 "http request" 能找到
  - 搜索 "gmail" 找不到
  - 验证 Agent 能正确使用保留的节点

- [ ] **0.3.2** 编写清理文档
  - 记录删除的节点类型和数量
  - 记录保留节点的选择原因
  - 更新 README

**验收标准**:
- ✅ 前端能成功启动并显示原型界面
- ✅ 后端能成功调用 OpenAI API 并返回 JSON 格式响应
- ✅ WebSocket 连接正常
- ✅ **节点知识库仅包含 15-20 个核心通用节点**
- ✅ **模板表已清空，预构建模板已移除**
- ✅ **新数据库表（scenarios, hardware_components, agent_sessions）已创建**
- ✅ **3 个 Demo 场景种子数据已导入**

---

### Phase 1: 核心 Agent 开发 (2-3周)

**目标**: 实现 Intake Agent 基础能力

#### Sprint 1.1: 意图分类 (1周)

- [ ] **1.1.1** 实现 `IntentClassifier` 类
  - 设计 System Prompt
  - 集成 LLM API
  - 实现实体提取逻辑
- [ ] **1.1.2** 编写单元测试 (覆盖率 > 80%)
  - 测试不同类型的用户输入
  - 验证实体提取准确性
- [ ] **1.1.3** 创建测试数据集 (20+ 样本)

#### Sprint 1.2: 场景匹配 (1周)

- [ ] **1.2.1** 设计场景模板结构
  - 定义 3 个 Demo 场景 (个性化手势、情感交互、游戏互动)
  - 创建 `Scenario` 数据模型
- [ ] **1.2.2** 实现 `ScenarioMatcher` 类
  - 相似度算法
  - 硬件组件推断逻辑
- [ ] **1.2.3** 实现 `ScenarioRepository`
  - 数据库 CRUD 操作
  - 种子数据导入

#### Sprint 1.3: 指令集生成 (0.5周)

- [ ] **1.3.1** 实现 `CommandGenerator` 类
  - 指令集结构设计
  - 序列化为特殊标记 (`#CREATE_WORKFLOW:{...}`)
  - 指令集验证
- [ ] **1.3.2** 创建硬件组件映射表
  - 定义 camera → n8n HTTP Request 节点
  - 定义 speaker → n8n TTS 节点
  - 定义 mechanical_hand → n8n Webhook 节点
- [ ] **1.3.3** 端到端测试
  - 输入: "见到老刘竖个中指"
  - 输出: 指令集 `#CREATE_WORKFLOW:{scenarioId, params, displayText}`

**验收标准**:
- ✅ 能够识别 80% 的测试用例意图
- ✅ 能够为 3 个场景生成正确的指令集
- ✅ 指令集格式符合前端解析要求

---

### Phase 2: API 与会话管理 (1周)

**目标**: 构建简化的 API + WebSocket 服务

#### Sprint 2.1: REST API (0.5周)

- [ ] **2.1.1** 实现 `/api/agent/chat` 端点
  - 接收用户消息
  - 调用 Intake Agent
  - 返回引导问题或指令集
- [ ] **2.1.2** 实现 `/api/workflow/create` 端点
  - 接收场景 ID 和参数
  - 填充工作流模板
  - **调用现有 `n8n_create_workflow` 工具**
  - 返回工作流 URL
- [ ] **2.1.3** 实现 `/api/scenarios` 端点（可选，用于调试）

#### Sprint 2.2: 会话管理 (0.25周)

- [ ] **2.2.1** 实现简化的 `SessionService` 类
  - 会话创建、读取
  - 对话历史存储（内存即可，可选持久化）
- [ ] **2.2.2** 实现会话超时管理

#### Sprint 2.3: WebSocket 实时通信 (0.25周)

- [ ] **2.3.1** 实现 WebSocket 服务器
  - 基于 `ws` 库
  - 连接管理
- [ ] **2.3.2** 实现前端 WebSocket 客户端
  - 自动重连机制
  - 消息处理

**验收标准**:
- ✅ 对话 API 正常响应（引导问题 + 指令集）
- ✅ 工作流创建 API 能成功调用 n8n 实例
- ✅ WebSocket 连接稳定，消息实时传递

---

### Phase 3: 前端开发 (1.5周) 【大幅简化】

**目标**: 对话界面 + n8n iframe 嵌入

#### Sprint 3.1: 基础布局 (0.5周)

- [ ] **3.1.1** 初始化 React + Vite 项目
  - 配置 TailwindCSS
  - 移植 prototype.html 的基础样式（背景、网格、玻璃态）
- [ ] **3.1.2** 实现四宫格布局
  - 左上: 对话界面（核心开发）
  - 右上: n8n iframe（核心开发）
  - 左下: 硬件数字孪生占位（仅静态 UI）
  - 右下: 系统日志占位（仅静态 UI）
- [ ] **3.1.3** 实现 Header 组件
  - Logo + 项目名
  - 连接状态指示器

#### Sprint 3.2: 对话界面 (0.5周)

- [ ] **3.2.1** 实现 `ChatInterface` 组件
  - 消息列表 + 自动滚动
  - 输入框 + 发送按钮
  - 快捷示例卡片（点击填充输入框）
- [ ] **3.2.2** 实现 **指令按钮渲染**
  - 正则匹配 `#CREATE_WORKFLOW:{...}`
  - 解析 JSON 数据
  - 渲染可点击按钮（显示 `displayText`）
  - 点击后调用 `/api/workflow/create`
- [ ] **3.2.3** 实现 `useAgentChat` Hook
  - WebSocket 消息发送/接收
  - 对话历史状态管理
  - 加载状态处理
- [ ] **3.2.4** 实现消息提示（react-hot-toast）
  - 工作流创建成功/失败提示
  - WebSocket 连接状态提示

#### Sprint 3.3: n8n iframe 嵌入 (0.25周)

- [ ] **3.3.1** 实现 `N8nIframe` 组件
  - iframe 嵌入 `http://localhost:5678/home/workflows`
  - 自动刷新机制（工作流创建后）
  - 加载状态处理
- [ ] **3.3.2** iframe 安全配置
  - 跨域处理（如需要）
  - postMessage 通信（可选，用于高级交互）

#### Sprint 3.4: 占位组件 (0.25周)

- [ ] **3.4.1** 创建占位组件
  - `HardwareTwinPlaceholder.tsx` - 保留原型的硬件孪生 UI（纯静态）
  - `SystemLogPlaceholder.tsx` - 保留原型的日志 UI（纯静态）
- [ ] **3.4.2** 添加"开发中"提示
  - 半透明遮罩 + "Coming Soon" 文字

**验收标准**:
- ✅ 对话界面正常工作，能渲染指令按钮
- ✅ 点击按钮成功创建工作流，n8n iframe 自动刷新
- ✅ 占位组件显示静态 UI，无需实际功能
- ✅ WebSocket 连接稳定，消息实时传递

---

### Phase 4: 集成测试与优化 (1周)

**目标**: 端到端测试 + 基础优化

#### Sprint 4.1: 集成测试 (0.5周)

- [ ] **4.1.1** 编写端到端测试 (Playwright)
  - 测试完整对话流程（3 个场景）
  - 测试指令按钮渲染
  - 测试工作流创建
- [ ] **4.1.2** 编写 API 集成测试
  - `/api/agent/chat` 测试
  - `/api/workflow/create` 测试
- [ ] **4.1.3** WebSocket 连接测试
  - 自动重连测试
  - 消息丢失处理测试

#### Sprint 4.2: 性能优化 (0.25周)

- [ ] **4.2.1** LLM 响应缓存（相同输入缓存 10 分钟）
- [ ] **4.2.2** 前端代码分割（按路由）
- [ ] **4.2.3** 数据库索引优化

#### Sprint 4.3: 文档与 Demo (0.25周)

- [ ] **4.3.1** 编写 README（包含快速开始）
- [ ] **4.3.2** 录制 Demo 视频（5 分钟）
  - 演示 3 个场景的完整流程
- [ ] **4.3.3** 编写部署指南（Docker 方式）

**验收标准**:
- ✅ 所有端到端测试通过
- ✅ 响应时间 < 5 秒 (P95)
- ✅ Demo 视频录制完成

---

### Phase 5: 发布与部署 (可选)

**目标**: 内部测试版本发布

- [ ] **5.1** 代码审查
- [ ] **5.2** 构建 Docker 镜像
- [ ] **5.3** 部署到测试服务器
- [ ] **5.4** 更新项目 README

**验收标准**:
- ✅ Docker 镜像正常运行
- ✅ 测试服务器可访问

---

### 📊 时间汇总（简化后）

| Phase | 内容 | 原计划时间 | **简化后时间** | 节省时间 | 关键变化 |
|-------|------|-----------|--------------|---------|---------|
| **Phase 0** | 准备阶段 | 1周 | **1周** | 0 | - |
| **Phase 1** | Agent 开发 | 2-3周 | **2.5周** | 0.5周 | Sprint 1.3 改为指令集生成 (1周→0.5周) |
| **Phase 2** | API + 会话 | 1-2周 | **1周** | 1周 | 简化 API，直接复用 n8n-mcp 工具 |
| **Phase 3** | 前端开发 | 2-3周 | **1.5周** | 1.5周 | 🎯 **大幅简化**<br>- 无需 React Flow (1.5周)<br>- iframe 嵌入 n8n (0.25周)<br>- 占位组件 (0.25周) |
| **Phase 4** | 测试优化 | 1-2周 | **1周** | 1周 | 聚焦核心功能测试 |
| **Phase 5** | 发布部署 | 1周 | **可选** | - | 内部测试为主 |
| **总计** | - | **7-10周** | **5-7周** | **2-3周** | 缩短 30% |

**最大节省点**: Phase 3 前端开发 (1.5周)
- ❌ 删除自己实现工作流可视化（React Flow + 节点动画）
- ✅ 改为 iframe 嵌入本地 n8n 界面
- ✅ 占位组件仅静态 UI，无需开发功能

**关键简化**:
1. **Agent 输出**: 指令集（而非完整 JSON） → 节省 0.5周
2. **API 层**: 直接复用现有工具 → 节省 1周
3. **前端可视化**: iframe 嵌入 → 节省 1.5周
4. **测试范围**: 聚焦核心流程 → 节省 1周

**实际开发周期**: **5-7 周**（最快 5 周可完成 MVP）

---

## 5. 技术实现细节

### 5.1 数据清理脚本实现

#### 5.1.1 节点知识库清理脚本

```typescript
// 新增文件: scripts/cleanup-nodes.ts

import { createDatabaseAdapter } from '../src/database/database-adapter';
import { logger } from '../src/utils/logger';
import fs from 'fs';
import path from 'path';

// 保留的核心节点白名单
const KEEP_NODE_TYPES = [
  // 触发器节点
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.errorTrigger',

  // HTTP 和 API 节点
  'n8n-nodes-base.httpRequest',

  // 逻辑控制节点
  'n8n-nodes-base.if',
  'n8n-nodes-base.switch',
  'n8n-nodes-base.merge',
  'n8n-nodes-base.loop',
  'n8n-nodes-base.splitInBatches',
  'n8n-nodes-base.wait',

  // 数据处理节点
  'n8n-nodes-base.set',
  'n8n-nodes-base.code',
  'n8n-nodes-base.function',
  'n8n-nodes-base.item',
  'n8n-nodes-base.aggregate',

  // AI 节点（用于情感分析等）
  '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  '@n8n/n8n-nodes-langchain.agent',
  '@n8n/n8n-nodes-langchain.chainLlm',
];

async function cleanupNodes() {
  const db = await createDatabaseAdapter();

  try {
    // 1. 备份数据库
    const dbPath = process.env.DATABASE_PATH || './node_storage.db';
    const backupPath = dbPath.replace('.db', `.backup-${Date.now()}.db`);
    logger.info(`📦 备份数据库: ${backupPath}`);
    fs.copyFileSync(dbPath, backupPath);

    // 2. 统计当前节点数量
    const beforeCount = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM nodes'
    );
    logger.info(`📊 清理前节点数量: ${beforeCount?.count}`);

    // 3. 统计各 package 的节点数量
    const packageStats = await db.all<{ package_name: string; count: number }>(
      'SELECT package_name, COUNT(*) as count FROM nodes GROUP BY package_name'
    );
    logger.info('📦 各 package 节点统计:');
    packageStats.forEach(stat => {
      logger.info(`  - ${stat.package_name}: ${stat.count}`);
    });

    // 4. 删除不在白名单中的节点
    const placeholders = KEEP_NODE_TYPES.map(() => '?').join(',');
    const deletedNodes = await db.run(
      `DELETE FROM nodes WHERE node_type NOT IN (${placeholders})`,
      KEEP_NODE_TYPES
    );
    logger.info(`🗑️  删除节点数量: ${deletedNodes.changes}`);

    // 5. 同步删除 FTS 索引
    await db.run(
      `DELETE FROM nodes_fts WHERE node_type NOT IN (${placeholders})`,
      KEEP_NODE_TYPES
    );

    // 6. 统计清理后节点数量
    const afterCount = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM nodes'
    );
    logger.info(`✅ 清理后节点数量: ${afterCount?.count}`);

    // 7. 列出保留的节点
    const keptNodes = await db.all<{ node_type: string; display_name: string }>(
      'SELECT node_type, display_name FROM nodes ORDER BY node_type'
    );
    logger.info('🎯 保留的节点列表:');
    keptNodes.forEach(node => {
      logger.info(`  - ${node.node_type} (${node.display_name})`);
    });

    // 8. 验证数据完整性
    const orphanedDocs = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM node_documentation
       WHERE node_type NOT IN (SELECT node_type FROM nodes)`
    );
    if (orphanedDocs && orphanedDocs.count > 0) {
      logger.warn(`⚠️  发现 ${orphanedDocs.count} 条孤立的文档记录，正在清理...`);
      await db.run(
        `DELETE FROM node_documentation
         WHERE node_type NOT IN (SELECT node_type FROM nodes)`
      );
    }

    logger.info('✅ 节点知识库清理完成！');
  } catch (error) {
    logger.error('❌ 清理失败:', error);
    throw error;
  } finally {
    await db.close();
  }
}

// 运行清理
cleanupNodes().catch(console.error);
```

**运行清理脚本**:
```bash
npm run build
node dist/scripts/cleanup-nodes.js
```

#### 5.1.2 模板系统清理脚本

```typescript
// 新增文件: scripts/cleanup-templates.ts

import { createDatabaseAdapter } from '../src/database/database-adapter';
import { logger } from '../src/utils/logger';

async function cleanupTemplates() {
  const db = await createDatabaseAdapter();

  try {
    // 1. 统计模板数量
    const beforeCount = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM templates'
    );
    logger.info(`📊 清理前模板数量: ${beforeCount?.count}`);

    // 2. 清空模板相关表
    await db.run('DELETE FROM template_node_configs');
    logger.info('✅ 清空 template_node_configs 表');

    await db.run('DELETE FROM template_nodes');
    logger.info('✅ 清空 template_nodes 表');

    await db.run('DELETE FROM templates');
    logger.info('✅ 清空 templates 表');

    // 3. 验证清理结果
    const afterCount = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM templates'
    );
    logger.info(`✅ 清理后模板数量: ${afterCount?.count}`);

    logger.info('✅ 模板系统清理完成！');
  } catch (error) {
    logger.error('❌ 清理失败:', error);
    throw error;
  } finally {
    await db.close();
  }
}

// 运行清理
cleanupTemplates().catch(console.error);
```

**运行清理脚本**:
```bash
npm run build
node dist/scripts/cleanup-templates.js
```

#### 5.1.3 一键清理脚本

```typescript
// 新增文件: scripts/cleanup-all.ts

import { execSync } from 'child_process';
import { logger } from '../src/utils/logger';

async function cleanupAll() {
  logger.info('🚀 开始完整数据清理...');

  try {
    // 1. 清理节点知识库
    logger.info('\n📦 步骤 1/2: 清理节点知识库...');
    execSync('node dist/scripts/cleanup-nodes.js', { stdio: 'inherit' });

    // 2. 清理模板系统
    logger.info('\n📦 步骤 2/2: 清理模板系统...');
    execSync('node dist/scripts/cleanup-templates.js', { stdio: 'inherit' });

    logger.info('\n✅ 所有清理任务完成！');
    logger.info('📝 下一步: 导入硬件场景种子数据');
  } catch (error) {
    logger.error('❌ 清理失败:', error);
    process.exit(1);
  }
}

cleanupAll();
```

**一键运行**:
```bash
npm run cleanup:all
```

**在 package.json 中添加脚本**:
```json
{
  "scripts": {
    "cleanup:nodes": "npm run build && node dist/scripts/cleanup-nodes.js",
    "cleanup:templates": "npm run build && node dist/scripts/cleanup-templates.js",
    "cleanup:all": "npm run build && node dist/scripts/cleanup-all.js"
  }
}
```

---

### 5.2 LLM 集成策略（OpenAI）

#### 5.2.1 OpenAI Client 实现

```typescript
// 新增文件: src/llm/openai-client.ts

import OpenAI from 'openai';

interface LLMClient {
  classify(systemPrompt: string, userMessage: string): Promise<Intent>;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

class OpenAILLMClient implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4o') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async classify(systemPrompt: string, userMessage: string): Promise<Intent> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,  // 低温度提高一致性
      max_tokens: 500,
      response_format: { type: 'json_object' }  // 强制 JSON 输出
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content);
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 1000
    });

    return response.choices[0].message.content || '';
  }
}

// Factory
export function createLLMClient(config: IntakeAgentConfig): LLMClient {
  return new OpenAILLMClient(config.llmApiKey, config.llmModel);
}
```

#### 5.2.2 Prompt 工程

**意图分类 Prompt**:

```typescript
const INTENT_CLASSIFICATION_PROMPT = `
你是一个机器人场景意图分类专家。你的任务是分析用户的自然语言输入，识别以下信息：

1. **意图类别** (category):
   - "robot_task": 用户想要机器人执行特定任务
   - "greeting": 用户在打招呼或闲聊
   - "hardware_query": 用户询问硬件组件能力
   - "workflow_edit": 用户想修改已有工作流

2. **子类别** (subCategory) - 仅当 category 为 "robot_task" 时:
   - "face_recognition_action": 识别人脸后执行动作
   - "emotion_interaction": 情感交互
   - "game_interaction": 游戏互动
   - "voice_interaction": 语音交互
   - "gesture_recognition": 手势识别
   - "autonomous_navigation": 自主导航

3. **实体提取** (entities):
   提取关键信息如:
   - 人名 (type: "person", value: "老刘")
   - 动作 (type: "action", value: "竖中指")
   - 语音内容 (type: "speech", value: "你好")
   - 情感状态 (type: "emotion", value: "高兴")
   - 硬件组件 (type: "hardware", value: "camera")

4. **置信度** (confidence): 0-1 之间的数值

**输出格式** (严格 JSON):
{
  "category": "robot_task",
  "subCategory": "face_recognition_action",
  "entities": [
    {"type": "person", "value": "老刘"},
    {"type": "action", "value": "竖中指"},
    {"type": "speech", "value": "骂人"}
  ],
  "confidence": 0.95
}

**示例**:

输入: "见到老付比个V打招呼"
输出:
{
  "category": "robot_task",
  "subCategory": "face_recognition_action",
  "entities": [
    {"type": "person", "value": "老付"},
    {"type": "action", "value": "比个V"},
    {"type": "speech", "value": "打招呼"}
  ],
  "confidence": 0.98
}

输入: "我想做一个和我共情的机器人"
输出:
{
  "category": "robot_task",
  "subCategory": "emotion_interaction",
  "entities": [
    {"type": "emotion", "value": "共情"}
  ],
  "confidence": 0.92
}

现在分析以下用户输入:
`;
```

**引导问题生成 Prompt**:

```typescript
const GUIDANCE_QUESTION_PROMPT = `
你是一个引导式对话专家。当前场景:

- 用户意图: {intent}
- 可能的匹配场景: {scenarios}
- 已确定的参数: {confirmedParams}
- 未确定的参数: {missingParams}

你的任务是生成一个友好、自然的问题，引导用户提供缺失的信息。

**要求**:
1. 问题简洁明了，不超过 30 字
2. 语气亲切自然，符合机器人助手的人设
3. 优先询问最关键的缺失参数
4. 可以提供选项帮助用户选择

**示例**:

场景: 情感交互
缺失参数: 表达方式 (表情 vs 声音)
输出: "听起来很有趣！你希望机器人用表情还是声音来表达情绪呢？"

场景: 人脸识别互动
缺失参数: 第二个人的动作
输出: "好的，见到老刘会竖中指。那见到其他人呢？需要做什么动作吗？"

现在生成引导问题:
`;
```

### 5.2 场景模板设计

#### 5.2.1 个性化手势交互模板

```json
{
  "id": "face-gesture-interaction",
  "name": "个性化手势交互",
  "description": "识别特定人脸，触发预定义的手势和语音动作",
  "requiredComponents": ["camera", "mechanical_hand", "speaker", "chassis"],
  "requiredParams": [
    {
      "name": "person_name",
      "type": "person",
      "description": "目标人物姓名",
      "required": true
    },
    {
      "name": "gesture_action",
      "type": "action",
      "description": "手势动作 (如: 竖中指, 比V)",
      "required": true
    },
    {
      "name": "speech_content",
      "type": "speech",
      "description": "语音内容",
      "required": true
    }
  ],
  "workflowTemplate": {
    "name": "{{ person_name }} 手势交互",
    "nodes": [
      {
        "id": "trigger",
        "type": "n8n-nodes-base.manualTrigger",
        "name": "启动触发",
        "position": [100, 200],
        "parameters": {}
      },
      {
        "id": "camera_scan",
        "type": "n8n-nodes-base.httpRequest",
        "name": "摄像头扫描",
        "position": [300, 200],
        "parameters": {
          "url": "http://hardware-api/camera/scan",
          "method": "POST",
          "options": {}
        }
      },
      {
        "id": "face_recognition",
        "type": "n8n-nodes-base.httpRequest",
        "name": "人脸识别",
        "position": [500, 200],
        "parameters": {
          "url": "http://ai-service/face/recognize",
          "method": "POST",
          "jsonParameters": true,
          "bodyParametersJson": "={{ { \"image\": $json.image } }}"
        }
      },
      {
        "id": "condition_check",
        "type": "n8n-nodes-base.if",
        "name": "判断人物",
        "position": [700, 200],
        "parameters": {
          "conditions": {
            "string": [
              {
                "value1": "={{ $json.name }}",
                "operation": "equals",
                "value2": "{{ person_name }}"
              }
            ]
          }
        }
      },
      {
        "id": "gesture_control",
        "type": "n8n-nodes-base.httpRequest",
        "name": "手势控制",
        "position": [900, 100],
        "parameters": {
          "url": "http://hardware-api/mechanical-hand/gesture",
          "method": "POST",
          "jsonParameters": true,
          "bodyParametersJson": "={{ { \"action\": \"{{ gesture_action }}\" } }}"
        }
      },
      {
        "id": "tts_output",
        "type": "n8n-nodes-base.httpRequest",
        "name": "语音输出",
        "position": [1100, 100],
        "parameters": {
          "url": "http://hardware-api/speaker/tts",
          "method": "POST",
          "jsonParameters": true,
          "bodyParametersJson": "={{ { \"text\": \"{{ speech_content }}\" } }}"
        }
      }
    ],
    "connections": {
      "trigger": { "main": [[{ "node": "camera_scan", "type": "main", "index": 0 }]] },
      "camera_scan": { "main": [[{ "node": "face_recognition", "type": "main", "index": 0 }]] },
      "face_recognition": { "main": [[{ "node": "condition_check", "type": "main", "index": 0 }]] },
      "condition_check": { "main": [[{ "node": "gesture_control", "type": "main", "index": 0 }], []] },
      "gesture_control": { "main": [[{ "node": "tts_output", "type": "main", "index": 0 }]] }
    }
  }
}
```

#### 5.2.2 情感交互模板

```json
{
  "id": "emotion-interaction",
  "name": "情感交互",
  "description": "通过语音和视觉识别用户情绪，输出相应的表情、语音和动作",
  "requiredComponents": ["camera", "microphone", "speaker", "screen", "mechanical_arm"],
  "requiredParams": [
    {
      "name": "emotion_detection_mode",
      "type": "string",
      "description": "情绪检测模式: voice_only, vision_only, multimodal",
      "required": true,
      "default": "multimodal"
    },
    {
      "name": "response_style",
      "type": "string",
      "description": "回应风格: empathetic, cheerful, calm",
      "required": false,
      "default": "empathetic"
    }
  ],
  "workflowTemplate": {
    "name": "情感交互机器人",
    "nodes": [
      {
        "id": "trigger",
        "type": "n8n-nodes-base.webhook",
        "name": "持续监听",
        "position": [100, 200],
        "parameters": {
          "path": "emotion-trigger",
          "responseMode": "lastNode"
        }
      },
      {
        "id": "voice_input",
        "type": "n8n-nodes-base.httpRequest",
        "name": "语音输入",
        "position": [300, 100],
        "parameters": {
          "url": "http://hardware-api/microphone/record",
          "method": "POST"
        }
      },
      {
        "id": "vision_input",
        "type": "n8n-nodes-base.httpRequest",
        "name": "视觉输入",
        "position": [300, 300],
        "parameters": {
          "url": "http://hardware-api/camera/capture",
          "method": "POST"
        }
      },
      {
        "id": "emotion_analysis",
        "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic",
        "name": "情绪分析",
        "position": [500, 200],
        "parameters": {
          "model": "claude-3-5-sonnet-20241022",
          "options": {
            "systemMessage": "分析用户的情绪状态，返回: happy, sad, angry, neutral"
          }
        }
      },
      {
        "id": "response_generator",
        "type": "n8n-nodes-base.function",
        "name": "生成回应策略",
        "position": [700, 200],
        "parameters": {
          "functionCode": "// 根据情绪生成表情、语音、动作\nconst emotion = $json.emotion;\nreturn [{\n  emoji: emotion === 'happy' ? '😊' : emotion === 'sad' ? '😢' : '😐',\n  speech: emotion === 'happy' ? '你看起来很开心！' : '怎么了呀主人',\n  armAction: emotion === 'sad' ? 'lower' : 'wave'\n}];"
        }
      }
    ],
    "connections": {
      "trigger": {
        "main": [
          [{ "node": "voice_input" }, { "node": "vision_input" }]
        ]
      },
      "voice_input": { "main": [[{ "node": "emotion_analysis" }]] },
      "vision_input": { "main": [[{ "node": "emotion_analysis" }]] },
      "emotion_analysis": { "main": [[{ "node": "response_generator" }]] }
    }
  }
}
```

### 5.3 硬件组件映射

```typescript
// 新增文件: src/services/hardware-service.ts

interface HardwareComponent {
  id: string;
  name: string;
  displayName: string;
  nodeType: string;
  defaultConfig: any;
  capabilities: string[];
}

const HARDWARE_COMPONENTS: HardwareComponent[] = [
  {
    id: 'camera',
    name: 'camera',
    displayName: '摄像头',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/camera/{{action}}',
      method: 'POST',
      responseFormat: 'json'
    },
    capabilities: [
      'face_recognition',
      'object_detection',
      'gesture_recognition',
      'qr_code_scan'
    ]
  },
  {
    id: 'mechanical_hand',
    name: 'mechanical_hand',
    displayName: '机械手',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/mechanical-hand/{{action}}',
      method: 'POST'
    },
    capabilities: [
      'gesture_middle_finger',
      'gesture_v_sign',
      'gesture_thumbs_up',
      'gesture_wave',
      'grasp',
      'release'
    ]
  },
  {
    id: 'speaker',
    name: 'speaker',
    displayName: '喇叭',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/speaker/tts',
      method: 'POST',
      jsonParameters: true,
      bodyParametersJson: '={{ { "text": $json.speech } }}'
    },
    capabilities: [
      'text_to_speech',
      'play_audio',
      'volume_control'
    ]
  },
  {
    id: 'microphone',
    name: 'microphone',
    displayName: '麦克风',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/microphone/record',
      method: 'POST'
    },
    capabilities: [
      'voice_recording',
      'speech_to_text',
      'noise_cancellation'
    ]
  },
  {
    id: 'screen',
    name: 'screen',
    displayName: '屏幕',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/screen/display',
      method: 'POST',
      jsonParameters: true,
      bodyParametersJson: '={{ { "content": $json.displayContent } }}'
    },
    capabilities: [
      'emoji_display',
      'text_display',
      'image_display'
    ]
  },
  {
    id: 'chassis',
    name: 'chassis',
    displayName: '底盘(全向轮)',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/chassis/move',
      method: 'POST'
    },
    capabilities: [
      'omnidirectional_movement',
      'rotation',
      'speed_control'
    ]
  },
  {
    id: 'mechanical_arm',
    name: 'mechanical_arm',
    displayName: '机械臂',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/mechanical-arm/{{action}}',
      method: 'POST'
    },
    capabilities: [
      'lift',
      'lower',
      'extend',
      'retract',
      'rotate',
      'preset_action'
    ]
  }
];

export class HardwareService {
  async listComponents(): Promise<HardwareComponent[]> {
    return HARDWARE_COMPONENTS;
  }

  async getComponentByName(name: string): Promise<HardwareComponent | null> {
    return HARDWARE_COMPONENTS.find(c => c.name === name) || null;
  }

  async inferComponentsFromIntent(intent: Intent): Promise<string[]> {
    const components: Set<string> = new Set();

    // 基于实体推断硬件组件
    intent.entities.forEach(entity => {
      if (entity.type === 'action') {
        if (['竖中指', '比V', '挥手'].some(a => entity.value.includes(a))) {
          components.add('mechanical_hand');
        }
      }
      if (entity.type === 'speech') {
        components.add('speaker');
      }
    });

    // 基于子类别推断
    if (intent.subCategory === 'face_recognition_action') {
      components.add('camera');
    }
    if (intent.subCategory === 'emotion_interaction') {
      components.add('camera');
      components.add('microphone');
      components.add('speaker');
      components.add('screen');
    }

    return Array.from(components);
  }
}
```

---

## 6. 测试策略

### 6.1 单元测试

**测试框架**: Vitest
**覆盖率目标**: > 80%

#### 核心测试文件

```typescript
// tests/unit/agents/intent-classifier.test.ts

describe('IntentClassifier', () => {
  let classifier: IntentClassifier;

  beforeEach(() => {
    classifier = new IntentClassifier(mockLLMClient);
  });

  it('应正确分类人脸识别任务', async () => {
    const result = await classifier.classify(
      '见到老刘竖个中指骂人'
    );

    expect(result.category).toBe('robot_task');
    expect(result.subCategory).toBe('face_recognition_action');
    expect(result.entities).toContainEqual({
      type: 'person',
      value: '老刘'
    });
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('应正确处理模糊输入', async () => {
    const result = await classifier.classify('我想要一个机器人');

    expect(result.category).toBe('robot_task');
    expect(result.confidence).toBeLessThan(0.7);
  });
});
```

```typescript
// tests/unit/agents/scenario-matcher.test.ts

describe('ScenarioMatcher', () => {
  it('应匹配个性化手势交互场景', async () => {
    const intent: Intent = {
      category: 'robot_task',
      subCategory: 'face_recognition_action',
      entities: [
        { type: 'person', value: '老刘' },
        { type: 'action', value: '竖中指' }
      ],
      confidence: 0.95
    };

    const scenarios = await matcher.match(intent);

    expect(scenarios[0].id).toBe('face-gesture-interaction');
    expect(scenarios[0].requiredComponents).toContain('camera');
  });
});
```

```typescript
// tests/unit/agents/workflow-generator.test.ts

describe('WorkflowGenerator', () => {
  it('应生成有效的工作流', async () => {
    const scenario = await scenarioRepository.findById(
      'face-gesture-interaction'
    );
    scenario.requiredParams = [
      { name: 'person_name', value: '老刘' },
      { name: 'gesture_action', value: '竖中指' },
      { name: 'speech_content', value: '滚' }
    ];

    const workflow = await generator.generate(scenario);

    expect(workflow.nodes).toHaveLength(6);
    expect(workflow.nodes[3].parameters.conditions.string[0].value2)
      .toBe('老刘');
  });
});
```

### 6.2 集成测试

```typescript
// tests/integration/agent/end-to-end.test.ts

describe('Agent End-to-End Flow', () => {
  it('应完成完整的对话 → 工作流生成流程', async () => {
    const sessionId = generateSessionId();

    // 第一轮: 用户输入
    const response1 = await agentApi.chat(sessionId, '见到老刘竖个中指');
    expect(response1.type).toBe('guidance');
    expect(response1.question).toContain('说什么');

    // 第二轮: 补充信息
    const response2 = await agentApi.chat(sessionId, '说"滚"');
    expect(response2.type).toBe('workflow_generated');
    expect(response2.trigger).toBe('#@%SCENARIO_JSON');

    // 验证工作流
    const validation = await workflowValidator.validateWorkflow(
      response2.workflow
    );
    expect(validation.isValid).toBe(true);
  });
});
```

### 6.3 前端测试

**框架**: React Testing Library + Vitest

```typescript
// tests/frontend/ChatInterface.test.tsx

describe('ChatInterface', () => {
  it('应正确显示用户消息', async () => {
    const { getByRole, getByText } = render(<ChatInterface />);

    const input = getByRole('textbox');
    const sendButton = getByRole('button', { name: /发送/i });

    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(getByText('你好')).toBeInTheDocument();
    });
  });

  it('应在收到工作流后触发可视化', async () => {
    const mockWorkflow = { nodes: [...], connections: {...} };

    const { getByTestId } = render(<App />);

    // 模拟 WebSocket 消息
    act(() => {
      mockWebSocket.emit('workflow_update', {
        type: 'workflow_generated',
        workflow: mockWorkflow
      });
    });

    await waitFor(() => {
      expect(getByTestId('workflow-visualizer')).toBeInTheDocument();
    });
  });
});
```

---

## 7. 风险评估与缓解

### 7.1 技术风险

| 风险 | 影响 | 概率 | 缓解策略 |
|------|------|------|---------|
| **LLM 响应不稳定** | 高 | 中 | - 使用低温度 (0.3)<br>- 添加输出验证<br>- 实现重试机制<br>- 缓存常见意图 |
| **工作流生成错误** | 高 | 中 | - 集成现有 `WorkflowValidator`<br>- 自动修复机制<br>- 人工审核选项 |
| **前端性能问题** | 中 | 低 | - 代码分割<br>- 虚拟滚动<br>- Web Worker 处理可视化 |
| **WebSocket 连接不稳定** | 中 | 中 | - 自动重连机制<br>- 消息队列缓冲<br>- 降级到轮询 |
| **数据库性能瓶颈** | 中 | 低 | - 索引优化<br>- 连接池管理<br>- 缓存层 |

### 7.2 产品风险

| 风险 | 影响 | 概率 | 缓解策略 |
|------|------|------|---------|
| **场景覆盖不足** | 高 | 高 | - 分阶段发布 (先支持 3 个 Demo 场景)<br>- 收集用户反馈<br>- 快速迭代新场景 |
| **用户学习成本** | 中 | 中 | - 提供快捷示例<br>- 详细文档和视频<br>- 智能引导 |
| **部署复杂度** | 中 | 低 | - 提供 Docker 一键部署<br>- Railway 托管服务<br>- 详细部署文档 |

### 7.3 时间风险

| 风险 | 影响 | 概率 | 缓解策略 |
|------|------|------|---------|
| **LLM 集成超时** | 高 | 中 | - 预留 buffer 时间<br>- 并行开发其他模块<br>- 使用现成 SDK |
| **前端可视化复杂** | 中 | 中 | - 使用 React Flow 库<br>- 简化动画逻辑<br>- MVP 先上基础功能 |

---

## 8. 附录

### 8.1 目录结构变更

```diff
n8n-mcp/
├── src/
+   ├── agents/                    # 新增 Agent 层
+   │   ├── intake-agent.ts
+   │   ├── intent-classifier.ts
+   │   ├── scenario-matcher.ts
+   │   └── workflow-generator.ts
+   ├── api/                       # 新增 API 层
+   │   ├── routes/
+   │   │   ├── agent.ts
+   │   │   ├── hardware.ts
+   │   │   └── scenarios.ts
+   │   ├── websocket/
+   │   │   └── agent-ws.ts
+   │   └── server.ts
+   ├── llm/                       # 新增 LLM 集成
+   │   ├── llm-client.ts
+   │   ├── claude-client.ts
+   │   └── openai-client.ts
+   ├── frontend/                  # 新增前端
+   │   ├── components/
+   │   ├── hooks/
+   │   ├── services/
+   │   ├── stores/
+   │   └── App.tsx
│   ├── services/                  # 扩展现有服务
+   │   ├── session-service.ts
+   │   ├── hardware-service.ts
+   │   └── scenario-repository.ts
│   ├── types/
+   │   └── agent-types.ts
│   ├── database/
+   │   └── schema-agent.sql       # 新增表 schema
│   └── ...
├── tests/
+   ├── unit/agents/
+   ├── integration/agent/
+   └── frontend/
└── docs/
    └── refactor/
        ├── IntakeAgent_Design.md
        ├── prototype.html
+       └── IMPLEMENTATION_PLAN.md  # 本文档
```

### 8.2 环境变量配置

```bash
# .env.agent
# LLM 配置
LLM_PROVIDER=openai
LLM_API_KEY=sk-proj-xxx  # OpenAI API Key
LLM_MODEL=gpt-4o

# Agent 配置
AGENT_MAX_CONVERSATION_TURNS=10
AGENT_CONVERGENCE_THRESHOLD=0.8
AGENT_SESSION_TIMEOUT=1800000 # 30 分钟

# API 配置
API_PORT=3000
API_CORS_ORIGIN=http://localhost:5173

# WebSocket 配置
WS_PORT=3001

# 硬件 API 基础 URL (如果有真实硬件)
HARDWARE_API_BASE_URL=http://localhost:8080

# n8n 实例配置
N8N_API_URL=https://your-n8n-instance.com
N8N_API_KEY=your-n8n-api-key
```

### 8.3 依赖包新增

```json
{
  "dependencies": {
    "openai": "^4.73.0",
    "express": "^4.21.2",
    "ws": "^8.18.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^5.0.3",
    "axios": "^1.7.9",
    "react-hot-toast": "^2.4.1"  # 消息提示
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.7",
    "@testing-library/react": "^16.1.0"
  }
}
```

### 8.4 参考资源

- **n8n 文档**: https://docs.n8n.io
- **MCP 协议**: https://modelcontextprotocol.io
- **Claude API**: https://docs.anthropic.com
- **OpenAI API**: https://platform.openai.com/docs

---

## 总结

本重构方案将 n8n-MCP 从**文档工具**升级为**智能 Agent 后端系统**，核心创新点：

1. **自然语言接口**: 用户用自然语言描述需求，无需了解 n8n 节点
2. **智能意图理解**: Intake Agent (OpenAI GPT) 自动分类意图、匹配场景、收敛需求
3. **指令集交互**: Agent 输出特殊指令集，前端渲染为可点击按钮
4. **一键工作流创建**: 点击按钮 → 直接调用本地 n8n 实例 API 创建工作流
5. **n8n 界面嵌入**: 前端嵌入本地 n8n 界面（iframe），无需自己实现可视化
6. **硬件抽象层**: 将机器人硬件组件映射到 n8n 节点，实现灵活扩展

**架构简化优势**:
- ✅ **复用现有能力**: 80% 复用 n8n-mcp 已有工具（n8n_create_workflow, WorkflowValidator 等）
- ✅ **降低前端复杂度**: 无需自己实现工作流可视化，直接嵌入 n8n 界面
- ✅ **加快开发速度**: Agent 只需生成指令集，无需生成完整工作流 JSON
- ✅ **更好的用户体验**: 使用 n8n 原生界面，用户可直接编辑和调试工作流

**预计开发周期**: 5-7 周（简化后缩短 2-3 周）
**技术风险**: 低 (复用现有 80% 能力 + 简化架构)
**创新价值**: 高 (填补 n8n 在机器人场景的空白)

---

**Conceived by Romuald Członkowski** - [www.aiadvisors.pl/en](https://www.aiadvisors.pl/en)
