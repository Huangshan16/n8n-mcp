# Agent Backend 架构重构方案 V2.0

**基于AI动态工作流生成的智能架构**

---

## 📋 执行摘要

### 核心变革

从**预定义模板匹配**升级至**AI动态工作流生成**：

| 维度 | V1.0 (当前) | V2.0 (目标) |
|------|------------|------------|
| **生成方式** | 静态模板 + 参数填充 | AI实时生成完整工作流 |
| **适用场景** | 3个固定场景 | 无限场景可能性 |
| **核心组件** | ScenarioMatcher, TemplateRenderer | WorkflowArchitect (AI Agent) |
| **知识来源** | scenario-seeds.ts硬编码 | n8n-mcp工具动态查询 |
| **灵活性** | 低（需编码新模板） | 高（自然语言即可） |
| **技术基础** | 简单匹配算法 | Prompt Engineering + Tool Use |

### 为什么需要重构？

**当前架构的局限性**：
1. ❌ **场景固化** - 只支持3个预定义场景，新增场景需要修改代码
2. ❌ **参数僵化** - 模板参数固定，无法处理复杂变体
3. ❌ **工具浪费** - n8n-mcp有强大的节点查询/验证能力未被利用
4. ❌ **AI能力未释放** - GPT-4o能力仅用于意图分类，未用于真正的工作流设计

**新架构的优势**：
1. ✅ **无限扩展** - AI理解自然语言需求，动态组装节点
2. ✅ **智能优化** - 根据硬件能力选择最佳节点配置
3. ✅ **自我验证** - 利用validate_workflow确保质量
4. ✅ **持续学习** - 通过Prompt迭代改进生成策略

---

## 🏗️ 新架构设计

### 整体流程图

```
┌─────────────────────────────────────────────────────────────┐
│ 用户输入: "见到老刘竖个中指骂人"                                │
└────────────┬────────────────────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────────────────┐
│ IntakeAgent (保留)                                          │
│ - 理解需求：人脸识别 + 手势动作 + 语音输出                    │
│ - 识别实体：person_name=老刘, gesture=竖中指, speech=骂人   │
└────────────┬───────────────────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────────────────┐
│ WorkflowArchitect (新增 - AI Tool Use Agent)               │
│                                                             │
│ Step 1: 查询可用节点                                        │
│   → search_nodes(query="face recognition")                 │
│   → search_nodes(query="http request")                     │
│   → get_node(nodeType="httpRequest", detail="standard")    │
│                                                             │
│ Step 2: 设计工作流拓扑                                      │
│   → 基于需求生成节点序列                                     │
│   → 计算节点位置坐标                                        │
│   → 构建连接关系                                            │
│                                                             │
│ Step 3: 生成完整JSON                                       │
│   → 包含nodes[], connections{}, settings{}                 │
│                                                             │
│ Step 4: 自我验证                                           │
│   → validate_workflow(workflow JSON)                       │
│   → 如有错误，调用autofix或迭代修复                          │
└────────────┬───────────────────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────────────────┐
│ WorkflowDeployer (简化的原WorkflowService)                  │
│ → n8n_create_workflow(完整工作流JSON)                       │
│ → 返回workflowId                                            │
└────────────┬───────────────────────────────────────────────┘
             ↓
┌────────────────────────────────────────────────────────────┐
│ Frontend: 显示成功通知                                       │
│ "已创建工作流「老刘手势交互」(ID: wf_abc123)"                │
└────────────────────────────────────────────────────────────┘
```

### 核心组件对比

#### 移除的组件

```typescript
// ❌ 删除 - 不再需要预定义场景
src/agents/scenario-seeds.ts           // 3个硬编码场景
src/agents/scenario-repository.ts      // 场景数据库访问
src/agents/scenario-matcher.ts         // 场景匹配逻辑
src/agents/command-generator.ts        // 命令生成器
src/agents/template-renderer.ts        // 模板参数填充
src/agents/agent-db.ts                 // scenarios表定义
```

#### 保留的组件

```typescript
// ✅ 保留 - 需求理解仍然重要
src/agents/intake-agent.ts             // 需求理解 + 实体提取
src/agents/llm-client.ts               // OpenAI客户端
src/agents/session-service.ts          // 会话管理
src/agents/agent-config.ts             // 配置管理

// ✅ 保留 - 硬件组件定义
src/agents/hardware-components.ts      // 7个硬件组件映射（从scenario-seeds提取）
```

#### 新增的组件

```typescript
// ✨ 新增 - AI动态工作流生成器
src/agents/workflow-architect.ts       // 核心AI Agent，使用n8n-mcp工具
src/agents/node-selector.ts            // 节点选择策略
src/agents/topology-designer.ts        // 工作流拓扑设计
src/agents/workflow-validator.ts       // 工作流验证封装
src/agents/prompts/architect-system.ts // WorkflowArchitect系统提示词
src/agents/prompts/hardware-context.ts // 硬件场景专用提示词
```

---

## 🧠 核心组件设计

### 1. WorkflowArchitect (核心AI Agent)

**职责**: 根据需求动态生成完整的n8n工作流JSON

**输入**:
```typescript
interface WorkflowRequest {
  userIntent: string;          // "见到老刘竖个中指骂人"
  entities: Record<string, string>; // { person_name: "老刘", gesture: "竖中指" }
  hardwareComponents: HardwareComponent[]; // 可用硬件列表
  conversationHistory: ConversationTurn[]; // 会话上下文
}
```

**输出**:
```typescript
interface WorkflowResult {
  success: boolean;
  workflow?: {
    name: string;
    nodes: Node[];
    connections: Connections;
    settings?: WorkflowSettings;
  };
  validationResult?: ValidationResult;
  iterations: number; // AI迭代次数
  reasoning: string;  // 设计思路说明
}
```

**核心逻辑**:
```typescript
export class WorkflowArchitect {
  private llmClient: LLMClient;
  private mcpClient: MCPClient; // n8n-mcp工具封装

  async generateWorkflow(request: WorkflowRequest): Promise<WorkflowResult> {
    // Step 1: 构建系统提示词（包含硬件上下文 + n8n-mcp工具列表）
    const systemPrompt = this.buildSystemPrompt(request.hardwareComponents);

    // Step 2: 构建用户消息（需求 + 实体）
    const userMessage = this.buildUserMessage(request);

    // Step 3: 调用LLM with Tool Use
    const response = await this.llmClient.chat({
      systemPrompt,
      messages: [...request.conversationHistory, userMessage],
      tools: this.getMCPTools(), // n8n-mcp工具定义
      maxIterations: 10,
    });

    // Step 4: 解析生成的工作流
    const workflow = this.extractWorkflow(response);

    // Step 5: 验证工作流
    const validationResult = await this.mcpClient.validateWorkflow(workflow);

    // Step 6: 如有错误，尝试自动修复
    if (!validationResult.isValid && validationResult.canAutoFix) {
      const fixed = await this.mcpClient.autofixWorkflow(workflow);
      return { success: true, workflow: fixed, validationResult, iterations: response.iterations };
    }

    return {
      success: validationResult.isValid,
      workflow: validationResult.isValid ? workflow : undefined,
      validationResult,
      iterations: response.iterations,
      reasoning: response.reasoning,
    };
  }

  private getMCPTools(): ToolDefinition[] {
    return [
      {
        name: 'search_nodes',
        description: '搜索n8n节点，支持关键词查询。返回节点类型、描述和配置示例。',
        parameters: { query: 'string', limit: 'number', includeExamples: 'boolean' },
      },
      {
        name: 'get_node',
        description: '获取节点详细信息，包括所有属性、typeVersion、示例配置。',
        parameters: { nodeType: 'string', detail: 'minimal|standard|full', includeExamples: 'boolean' },
      },
      {
        name: 'validate_workflow',
        description: '验证工作流JSON，检查节点配置、连接关系、表达式语法。',
        parameters: { workflow: 'object', options: 'object' },
      },
      // ... 其他工具
    ];
  }

  private buildSystemPrompt(hardwareComponents: HardwareComponent[]): string {
    return `
你是一个n8n工作流架构师，专门为硬件机器人设计自动化工作流。

# 可用硬件组件

${hardwareComponents.map(hw => `
## ${hw.displayName} (${hw.name})
- 节点类型: ${hw.nodeType}
- 能力: ${hw.capabilities.join(', ')}
- 默认配置:
\`\`\`json
${JSON.stringify(hw.defaultConfig, null, 2)}
\`\`\`
`).join('\n')}

# 可用n8n节点

你可以使用以下核心节点：
- **触发器**: webhook, manualTrigger, scheduleTrigger
- **HTTP请求**: httpRequest (与硬件API通信的核心)
- **逻辑控制**: if, switch, code, function
- **数据处理**: set, merge, splitInBatches, loop
- **AI能力**: @n8n/n8n-nodes-langchain.lmChatOpenAi, agent

# 工作流生成规范

1. **节点选择**:
   - 优先使用httpRequest节点调用硬件API
   - 根据硬件能力映射URL（例如：camera的face_recognition能力 → http://hardware-api/camera/recognize）
   - 使用if/switch节点处理条件分支
   - 使用code节点处理复杂逻辑

2. **节点配置**:
   - 必须包含正确的typeVersion（使用get_node查询最新版本）
   - HTTP节点必须设置method、url、headers等必需字段
   - 使用n8n表达式引用前序节点数据：\`={{ $json.fieldName }}\`

3. **连接关系**:
   - 使用标准格式：\`{ sourceNode: { main: [[{ node: 'targetNode', type: 'main', index: 0 }]] } }\`
   - if节点有两个输出分支：\`main: [[{true分支}], [{false分支}]]\`

4. **节点定位**:
   - 起始节点从[100, 200]开始
   - 每个节点水平间隔220px，垂直对齐或偏移80px

5. **工作流命名**:
   - 根据用户意图生成简洁的中文名称
   - 示例: "老刘手势交互"、"情感识别机器人"

# 工作流生成步骤

当收到需求时，按以下步骤执行：

1. **分析需求** - 识别需要的硬件组件和业务逻辑
2. **查询节点** - 使用search_nodes/get_node获取节点详情
3. **设计拓扑** - 确定节点序列和连接关系
4. **生成JSON** - 构建完整的workflow对象
5. **验证** - 使用validate_workflow检查
6. **修复** - 如有错误，根据提示修正

# 输出格式

最终必须返回完整的工作流JSON：
\`\`\`json
{
  "name": "工作流名称",
  "nodes": [...],
  "connections": {...},
  "settings": {
    "executionOrder": "v1"
  }
}
\`\`\`

# 重要提示

- 不要假设节点属性，必须通过get_node查询
- 生成后立即调用validate_workflow验证
- 如果验证失败，分析错误原因并重新生成
- 优先使用硬件组件的defaultConfig作为基础配置
`;
  }

  private buildUserMessage(request: WorkflowRequest): string {
    const entityStr = Object.entries(request.entities)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    return `
请为以下需求生成一个n8n工作流：

**用户意图**: ${request.userIntent}
**识别实体**: ${entityStr}

要求：
1. 使用search_nodes查询需要的节点类型
2. 使用get_node获取节点的详细配置
3. 生成完整的工作流JSON（包含nodes和connections）
4. 使用validate_workflow验证生成的工作流
5. 如果验证失败，根据错误信息修复

请开始生成工作流。
`;
  }

  private extractWorkflow(response: LLMResponse): Workflow {
    // 从LLM响应中提取工作流JSON
    const jsonMatch = response.content.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      throw new Error('LLM未返回有效的工作流JSON');
    }
    return JSON.parse(jsonMatch[1]);
  }
}
```

### 2. HardwareComponents (重构)

**从scenario-seeds.ts提取硬件定义**:

```typescript
// src/agents/hardware-components.ts
export interface HardwareComponent {
  id: string;
  name: string;
  displayName: string;
  nodeType: string;
  defaultConfig: Record<string, unknown>;
  capabilities: string[];
  apiEndpoints?: {
    [action: string]: {
      url: string;
      method: string;
      parameters?: Record<string, unknown>;
    };
  };
}

export const HARDWARE_COMPONENTS: HardwareComponent[] = [
  {
    id: 'camera',
    name: 'camera',
    displayName: '摄像头',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      method: 'POST',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
    },
    capabilities: [
      'face_recognition',    // 人脸识别
      'object_detection',    // 物体检测
      'gesture_recognition', // 手势识别
      'qr_code_scan',        // 二维码扫描
    ],
    apiEndpoints: {
      scan: { url: 'http://hardware-api/camera/scan', method: 'POST' },
      recognize_face: { url: 'http://hardware-api/camera/face/recognize', method: 'POST' },
      detect_gesture: { url: 'http://hardware-api/camera/gesture/detect', method: 'POST' },
    },
  },
  {
    id: 'mechanical_hand',
    name: 'mechanical_hand',
    displayName: '机械手',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      method: 'POST',
      sendHeaders: true,
    },
    capabilities: [
      'gesture_middle_finger', // 竖中指
      'gesture_v_sign',        // 比V
      'gesture_thumbs_up',     // 点赞
      'gesture_wave',          // 挥手
      'grasp',                 // 抓取
      'release',               // 释放
    ],
    apiEndpoints: {
      middle_finger: { url: 'http://hardware-api/mechanical-hand/middle-finger', method: 'POST' },
      v_sign: { url: 'http://hardware-api/mechanical-hand/v-sign', method: 'POST' },
      thumbs_up: { url: 'http://hardware-api/mechanical-hand/thumbs-up', method: 'POST' },
    },
  },
  {
    id: 'speaker',
    name: 'speaker',
    displayName: '喇叭',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      method: 'POST',
      sendBody: true,
      contentType: 'json',
    },
    capabilities: ['text_to_speech', 'play_audio', 'volume_control'],
    apiEndpoints: {
      tts: {
        url: 'http://hardware-api/speaker/tts',
        method: 'POST',
        parameters: { text: 'string' },
      },
    },
  },
  {
    id: 'microphone',
    name: 'microphone',
    displayName: '麦克风',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: { method: 'POST' },
    capabilities: ['voice_recording', 'speech_to_text', 'noise_cancellation'],
    apiEndpoints: {
      record: { url: 'http://hardware-api/microphone/record', method: 'POST' },
      stt: { url: 'http://hardware-api/microphone/stt', method: 'POST' },
    },
  },
  {
    id: 'screen',
    name: 'screen',
    displayName: '屏幕',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      method: 'POST',
      sendBody: true,
      contentType: 'json',
    },
    capabilities: ['emoji_display', 'text_display', 'image_display'],
    apiEndpoints: {
      display: {
        url: 'http://hardware-api/screen/display',
        method: 'POST',
        parameters: { content: 'string', type: 'emoji|text|image' },
      },
    },
  },
  {
    id: 'chassis',
    name: 'chassis',
    displayName: '底盘(全向轮)',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: { method: 'POST' },
    capabilities: ['omnidirectional_movement', 'rotation', 'speed_control'],
    apiEndpoints: {
      move: { url: 'http://hardware-api/chassis/move', method: 'POST' },
    },
  },
  {
    id: 'mechanical_arm',
    name: 'mechanical_arm',
    displayName: '机械臂',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: { method: 'POST' },
    capabilities: ['lift', 'lower', 'extend', 'retract', 'rotate', 'preset_action'],
    apiEndpoints: {
      action: { url: 'http://hardware-api/mechanical-arm/:action', method: 'POST' },
    },
  },
];
```

### 3. MCPClient (n8n-mcp工具封装)

```typescript
// src/agents/mcp-client.ts
import { NodeRepository } from '../database/node-repository';
import { validateWorkflow } from '../services/workflow-validator';
import { SearchNodesParams, GetNodeParams, ValidationResult } from '../types';

/**
 * n8n-mcp工具客户端 - 为WorkflowArchitect提供工具访问
 */
export class MCPClient {
  constructor(
    private nodeRepository: NodeRepository,
  ) {}

  /**
   * 搜索节点 - 封装search_nodes工具
   */
  async searchNodes(params: SearchNodesParams): Promise<SearchNodesResult> {
    const nodes = await this.nodeRepository.searchNodes(params.query, {
      limit: params.limit || 20,
      mode: params.mode || 'OR',
    });

    return {
      nodes: nodes.map(node => ({
        nodeType: node.node_type,
        displayName: node.display_name,
        description: node.description,
        category: node.category,
        exampleConfig: params.includeExamples ? this.getExampleConfig(node.node_type) : undefined,
      })),
      total: nodes.length,
    };
  }

  /**
   * 获取节点详情 - 封装get_node工具
   */
  async getNode(params: GetNodeParams): Promise<GetNodeResult> {
    const node = await this.nodeRepository.getNodeByType(params.nodeType);
    if (!node) {
      throw new Error(`Node not found: ${params.nodeType}`);
    }

    const detail = params.detail || 'standard';

    if (detail === 'minimal') {
      return {
        nodeType: node.node_type,
        displayName: node.display_name,
        defaultVersion: node.default_version,
      };
    }

    const properties = JSON.parse(node.properties || '[]');
    const versions = JSON.parse(node.versions_json || '[]');

    return {
      nodeType: node.node_type,
      displayName: node.display_name,
      description: node.description,
      defaultVersion: node.default_version,
      properties: detail === 'full' ? properties : this.filterEssentialProperties(properties),
      versions,
      exampleConfig: params.includeExamples ? this.getExampleConfig(node.node_type) : undefined,
    };
  }

  /**
   * 验证工作流 - 封装validate_workflow工具
   */
  async validateWorkflow(workflow: Workflow): Promise<ValidationResult> {
    return await validateWorkflow(workflow, {
      validateNodes: true,
      validateConnections: true,
      validateExpressions: true,
      profile: 'runtime',
    });
  }

  /**
   * 自动修复工作流 - 封装autofix逻辑
   */
  async autofixWorkflow(workflow: Workflow): Promise<Workflow> {
    const validationResult = await this.validateWorkflow(workflow);
    if (validationResult.isValid) {
      return workflow;
    }

    // 应用自动修复
    const fixed = { ...workflow };

    for (const error of validationResult.errors) {
      if (error.autoFix) {
        // 应用修复逻辑
        this.applyFix(fixed, error);
      }
    }

    return fixed;
  }

  private filterEssentialProperties(properties: any[]): any[] {
    // 过滤出核心属性（必需 + 常用）
    return properties.filter(prop =>
      prop.required ||
      ['resource', 'operation', 'url', 'method', 'authentication'].includes(prop.name)
    );
  }

  private applyFix(workflow: Workflow, error: ValidationError): void {
    // 实现具体的修复逻辑
    // 例如：修复missing typeVersion, 修正错误的表达式格式等
  }

  private getExampleConfig(nodeType: string): object | undefined {
    // 从数据库或内置示例中获取节点配置示例
    return undefined;
  }
}
```

### 4. IntakeAgent (重构)

**保留需求理解，移除场景匹配**:

```typescript
// src/agents/intake-agent.ts (重构版)
export class IntakeAgent {
  private llmClient: LLMClient;
  private workflowArchitect: WorkflowArchitect;
  private sessionService: SessionService;
  private hardwareComponents: HardwareComponent[];

  async processUserInput(userMessage: string, sessionId: string): Promise<AgentResponse> {
    // Step 1: 更新会话
    this.sessionService.appendTurn(sessionId, 'user', userMessage);
    const conversationHistory = this.sessionService.getHistory(sessionId);

    // Step 2: 理解需求 + 提取实体
    const intent = await this.extractIntent(userMessage, conversationHistory);

    // Step 3: 检查是否有足够信息
    const missing = this.checkMissingInfo(intent);
    if (missing.length > 0) {
      const question = await this.generateGuidanceQuestion(intent, missing);
      return {
        type: 'guidance',
        message: question,
      };
    }

    // Step 4: 调用WorkflowArchitect生成工作流
    try {
      const result = await this.workflowArchitect.generateWorkflow({
        userIntent: userMessage,
        entities: intent.entities,
        hardwareComponents: this.hardwareComponents,
        conversationHistory,
      });

      if (!result.success) {
        return {
          type: 'error',
          message: `工作流生成失败：${result.validationResult?.errors[0]?.message || '未知错误'}`,
          details: result.validationResult,
        };
      }

      // 保存工作流到会话
      this.sessionService.setWorkflow(sessionId, result.workflow!);

      return {
        type: 'workflow_ready',
        message: `已为您生成工作流「${result.workflow!.name}」。\n\n**设计思路**：${result.reasoning}\n\n点击下方按钮创建：`,
        workflow: result.workflow!,
        metadata: {
          iterations: result.iterations,
          nodeCount: result.workflow!.nodes.length,
        },
      };
    } catch (error) {
      logger.error('WorkflowArchitect error:', error);
      return {
        type: 'error',
        message: '抱歉，工作流生成过程中出现错误，请稍后重试。',
      };
    }
  }

  private async extractIntent(message: string, history: ConversationTurn[]): Promise<Intent> {
    const response = await this.llmClient.chat({
      systemPrompt: `
你是一个意图分析专家，专门理解用户对硬件机器人的需求。

任务：
1. 识别用户意图类型（face_recognition_action, emotion_interaction, game_interaction, custom）
2. 提取关键实体（person_name, gesture, speech_content, emotion_mode等）
3. 判断信息完整性（是否缺少关键参数）

可用硬件组件：
${this.hardwareComponents.map(hw => `- ${hw.displayName}: ${hw.capabilities.join(', ')}`).join('\n')}

请分析用户输入，返回JSON格式：
\`\`\`json
{
  "category": "intent类型",
  "entities": { "key": "value" },
  "confidence": 0.95,
  "missingInfo": ["缺少的关键信息"]
}
\`\`\`
`,
      messages: [...history, { role: 'user', content: message }],
    });

    return JSON.parse(this.extractJSON(response.content));
  }

  private checkMissingInfo(intent: Intent): string[] {
    // 根据意图类型检查必需信息
    const required: Record<string, string[]> = {
      face_recognition_action: ['person_name', 'gesture', 'speech_content'],
      emotion_interaction: ['emotion_detection_mode'],
      game_interaction: ['game_type'],
    };

    const missing: string[] = [];
    const requiredFields = required[intent.category] || [];

    for (const field of requiredFields) {
      if (!intent.entities[field]) {
        missing.push(field);
      }
    }

    return missing;
  }
}
```

---

## 🎯 Prompt Engineering 策略

### 系统提示词设计原则

1. **硬件上下文注入**
   - 将7个硬件组件的能力、API端点嵌入系统提示词
   - 明确每个硬件对应的n8n节点类型（全部是httpRequest）

2. **工具使用规范**
   - 清晰描述每个n8n-mcp工具的用途和调用时机
   - 强制要求先search_nodes再get_node，最后validate_workflow

3. **Few-shot示例**
   - 提供3个完整的工作流生成示例（对应原3个场景）
   - 展示从需求到最终JSON的完整过程

4. **错误处理策略**
   - 教导AI如何解读validation错误
   - 提供常见错误的修复模式（missing typeVersion, 错误的连接格式等）

### 示例Prompt（个性化手势交互场景）

```markdown
# Few-Shot示例1: 个性化手势交互

**用户需求**: "见到老刘竖个中指骂人"

**分析步骤**:

1. **需求解构**:
   - 触发条件：人脸识别 → 识别到"老刘"
   - 动作序列：竖中指手势 + 语音输出"骂人"
   - 涉及硬件：camera（人脸识别）, mechanical_hand（竖中指）, speaker（语音）

2. **节点查询**:
```json
search_nodes({ query: "http request", limit: 1 })
get_node({ nodeType: "n8n-nodes-base.httpRequest", detail: "standard" })
get_node({ nodeType: "n8n-nodes-base.if", detail: "standard" })
get_node({ nodeType: "n8n-nodes-base.manualTrigger", detail: "minimal" })
```

3. **拓扑设计**:
```
ManualTrigger → Camera Scan → Face Recognition → IF(name=="老刘")
                                                    ├─ [True] → Mechanical Hand (middle_finger) → Speaker (TTS)
                                                    └─ [False] → (无动作)
```

4. **生成JSON**:
```json
{
  "name": "个性化手势交互",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "camera/frame",
        "options": {}
      },
      "id": "a0ea163b-957f-4de6-9cb6-a6e2bd61c348",
      "name": "摄像头输入",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [
        -1120,
        208
      ],
      "webhookId": "652b807c-f583-44ac-aae1-b478961dda81"
    },
    {
      "parameters": {
        "functionCode": "// 模拟 YOLO 人脸识别结果\nreturn [\n  {\n    json: {\n      faces: [\n        { \"label\": \"老刘\", \"confidence\": 0.96 }\n      ]\n    }\n  }\n];"
      },
      "id": "069d8091-5dd2-4547-ac23-5b7008148379",
      "name": "YOLO 人脸识别",
      "type": "n8n-nodes-base.function",
      "typeVersion": 1,
      "position": [
        -896,
        208
      ]
    },
    {
      "parameters": {
        "functionCode": "const faces = items[0].json.faces;\nif (!faces || faces.length === 0) return [];\n\nreturn faces.map(f => ({ json: { person: f.label } }));"
      },
      "id": "63dc987b-9a3b-40a3-aa95-e885047d47b8",
      "name": "提取识别对象",
      "type": "n8n-nodes-base.function",
      "typeVersion": 1,
      "position": [
        -672,
        208
      ]
    },
    {
      "parameters": {
        "conditions": {
          "string": [
            {
              "value1": "={{$json.person}}",
              "value2": "老刘"
            }
          ]
        }
      },
      "id": "c99287e2-c86d-4783-bd67-c812418342f8",
      "name": "IF 识别到老刘",
      "type": "n8n-nodes-base.if",
      "typeVersion": 1,
      "position": [
        -416,
        160
      ]
    },
    {
      "parameters": {
        "functionCode": "return [{ json: { gesture: \"middle_finger\", text: \"滚\" } }];"
      },
      "id": "f6f9eab9-d313-400b-b10c-de51749a000d",
      "name": "老刘行为生成",
      "type": "n8n-nodes-base.function",
      "typeVersion": 1,
      "position": [
        -208,
        96
      ]
    },
    {
      "parameters": {
        "url": "http://robot/arm",
        "jsonParameters": true,
        "options": {}
      },
      "id": "5656b718-6269-4165-b627-91bdf47e8d98",
      "name": "机械手动作（竖中指）",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 1,
      "position": [
        0,
        -64
      ]
    },
    {
      "parameters": {
        "url": "http://robot/speaker",
        "jsonParameters": true,
        "options": {}
      },
      "id": "3597f4b0-281b-4466-b90c-f01334276795",
      "name": "音箱说话（老刘）",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 1,
      "position": [
        0,
        96
      ]
    },
    {
      "parameters": {
        "conditions": {
          "string": [
            {
              "value1": "={{$json.person}}",
              "value2": "老付"
            }
          ]
        }
      },
      "id": "14a4ee55-e204-4c07-b2f4-209867532116",
      "name": "IF 识别到老付",
      "type": "n8n-nodes-base.if",
      "typeVersion": 1,
      "position": [
        -416,
        288
      ]
    },
    {
      "parameters": {
        "functionCode": "return [{ json: { gesture: \"victory\", text: \"你长得好帅\" } }];"
      },
      "id": "6f05d7af-07cd-482f-bf88-980e9685664b",
      "name": "老付行为生成",
      "type": "n8n-nodes-base.function",
      "typeVersion": 1,
      "position": [
        -208,
        336
      ]
    },
    {
      "parameters": {
        "url": "http://robot/arm",
        "jsonParameters": true,
        "options": {}
      },
      "id": "dc8f1911-bc1d-4b7b-9ee5-4d97102c3402",
      "name": "机械手动作（比V）",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 1,
      "position": [
        0,
        336
      ]
    },
    {
      "parameters": {
        "url": "http://robot/speaker",
        "jsonParameters": true,
        "options": {}
      },
      "id": "1dbc862a-b9a7-4670-a39d-971bb2e50211",
      "name": "音箱说话（老付）",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 1,
      "position": [
        0,
        496
      ]
    }
  ],
  "pinData": {},
  "connections": {
    "摄像头输入": {
      "main": [
        [
          {
            "node": "YOLO 人脸识别",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "YOLO 人脸识别": {
      "main": [
        [
          {
            "node": "提取识别对象",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "提取识别对象": {
      "main": [
        [
          {
            "node": "IF 识别到老刘",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "IF 识别到老刘": {
      "main": [
        [
          {
            "node": "老刘行为生成",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "IF 识别到老付",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "老刘行为生成": {
      "main": [
        [
          {
            "node": "机械手动作（竖中指）",
            "type": "main",
            "index": 0
          },
          {
            "node": "音箱说话（老刘）",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "IF 识别到老付": {
      "main": [
        [
          {
            "node": "老付行为生成",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "老付行为生成": {
      "main": [
        [
          {
            "node": "机械手动作（比V）",
            "type": "main",
            "index": 0
          },
          {
            "node": "音箱说话（老付）",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1"
  },
  "versionId": "",
  "meta": {
    "instanceId": "45754d6d5f7f2bed817205dbe77e9a7a8a3cf052118fe99a211ce0703085696d"
  },
  "tags": []
}
```

5. **验证**:
```json
validate_workflow({ workflow: <上述JSON> })
// 返回: { isValid: true, errors: [], warnings: [] }
```

**设计思路说明**:
采用线性触发流程，使用IF节点判断人物身份，确保只有识别到"老刘"时才执行后续动作。所有硬件调用统一使用httpRequest节点，URL映射到对应的硬件API端点。

---

## 📐 实施计划

### Phase 0: 准备工作 (0.5周)

#### Task 0.1: 数据库清理
```bash
# 已完成 - 移除第三方节点，保留15个核心节点
npm run agent:cleanup:nodes

# 已完成 - 清空模板
npm run agent:cleanup:templates
```

#### Task 0.2: 硬件组件提取
- [ ] 从scenario-seeds.ts提取硬件定义
- [ ] 创建src/agents/hardware-components.ts
- [ ] 添加apiEndpoints映射
- [ ] 单元测试

#### Task 0.3: 移除旧组件
- [ ] 删除scenario-seeds.ts, scenario-repository.ts, scenario-matcher.ts
- [ ] 删除command-generator.ts, template-renderer.ts
- [ ] 删除agent-db.ts中的scenarios表定义
- [ ] 更新TypeScript imports

---

### Phase 1: 核心组件开发 (2周)

#### Sprint 1.1: MCPClient实现 (3天)
- [ ] 创建src/agents/mcp-client.ts
- [ ] 实现searchNodes()封装
- [ ] 实现getNode()封装
- [ ] 实现validateWorkflow()封装
- [ ] 实现autofixWorkflow()封装
- [ ] 单元测试（mock NodeRepository）

#### Sprint 1.2: Prompt体系设计 (4天)
- [ ] 创建src/agents/prompts/architect-system.ts
  - [ ] 硬件上下文注入模板
  - [ ] n8n-mcp工具使用规范
  - [ ] 工作流生成步骤说明
- [ ] 创建src/agents/prompts/few-shot-examples.ts
  - [ ] 场景1: 个性化手势交互
  - [ ] 场景2: 情感交互
  - [ ] 场景3: 石头剪刀布
- [ ] 创建src/agents/prompts/error-patterns.ts
  - [ ] 常见验证错误及修复方法
- [ ] Prompt单元测试（验证模板渲染）

#### Sprint 1.3: WorkflowArchitect实现 (7天)
- [ ] 创建src/agents/workflow-architect.ts
- [ ] 实现buildSystemPrompt()
  - [ ] 硬件组件注入
  - [ ] Few-shot示例拼接
- [ ] 实现buildUserMessage()
- [ ] 实现generateWorkflow()核心逻辑
  - [ ] LLM Tool Use调用
  - [ ] 迭代修复机制（最多10次）
  - [ ] 工作流提取和解析
- [ ] 实现extractWorkflow()
- [ ] 集成测试（真实LLM调用，需要API key）

---

### Phase 2: IntakeAgent重构 (1周)

#### Sprint 2.1: 需求理解重构 (3天)
- [ ] 重构IntakeAgent.processUserInput()
  - [ ] 移除ScenarioMatcher调用
  - [ ] 集成WorkflowArchitect
- [ ] 重构extractIntent()
  - [ ] 更新系统提示词（基于硬件能力）
  - [ ] 实体提取逻辑优化
- [ ] 重构checkMissingInfo()
  - [ ] 动态检测缺失信息

#### Sprint 2.2: 响应格式调整 (2天)
- [ ] 更新AgentResponse类型
  - [ ] 新增workflow_ready类型
  - [ ] 添加reasoning字段
  - [ ] 添加metadata（迭代次数、节点数）
- [ ] 更新Frontend解析逻辑
- [ ] 端到端测试

#### Sprint 2.3: Session管理优化 (2天)
- [ ] SessionService添加setWorkflow()方法
- [ ] 工作流缓存策略
- [ ] 清理过期工作流

---

### Phase 3: 前端适配 (0.5周)

#### Task 3.1: 响应解析更新
- [ ] 更新commandParser.ts（已不需要指令集解析）
- [ ] ChatInterface处理workflow_ready类型
- [ ] 显示设计思路（reasoning字段）

#### Task 3.2: 创建按钮优化
- [ ] 显示工作流节点数
- [ ] 显示AI迭代次数
- [ ] 添加"查看工作流详情"按钮

---

### Phase 4: 测试与优化 (1.5周)

#### Sprint 4.1: Prompt优化迭代 (5天)
- [ ] 测试3个核心场景生成成功率
- [ ] 收集失败案例
- [ ] 优化系统提示词
- [ ] 调整Few-shot示例
- [ ] A/B测试不同Prompt版本

#### Sprint 4.2: 性能优化 (2天)
- [ ] LLM调用超时处理
- [ ] 工作流缓存机制
- [ ] 减少不必要的tool调用

#### Sprint 4.3: 端到端测试 (3天)
- [ ] 场景1: 个性化手势交互（10个变体）
- [ ] 场景2: 情感交互（5个变体）
- [ ] 场景3: 游戏互动（5个变体）
- [ ] 边界case测试（缺失信息、错误需求）

---

### Phase 5: 文档与部署 (0.5周)

#### Task 5.1: 文档更新
- [ ] 更新AGENT_QUICKSTART.md
  - [ ] 新架构说明
  - [ ] 环境变量（需要LLM API key）
- [ ] 更新IMPLEMENTATION_PLAN.md
  - [ ] 标记已废弃的组件
- [ ] 创建PROMPT_ENGINEERING_GUIDE.md
  - [ ] Prompt优化指南
  - [ ] Few-shot示例库

#### Task 5.2: 部署验证
- [ ] Docker镜像更新
- [ ] 环境变量配置
- [ ] 健康检查
- [ ] 生产环境测试

---

## 📊 预期效果

### 功能对比

| 功能 | V1.0 (模板) | V2.0 (AI生成) |
|------|------------|--------------|
| **场景数量** | 3个固定场景 | 理论无限 |
| **需求变体** | 低（仅参数替换） | 高（理解自然语言） |
| **新增场景** | 需修改代码 | 自然语言描述即可 |
| **工作流质量** | 人工预设（可靠） | AI生成（需验证） |
| **响应时间** | <1秒 | 5-15秒（取决于LLM） |
| **成本** | 无 | LLM API调用费用 |

### 成功指标

**定量指标**:
1. **生成成功率** ≥ 85%（3个核心场景 + 10个变体）
2. **首次验证通过率** ≥ 70%（无需迭代修复）
3. **平均生成时间** ≤ 10秒（含validation）
4. **平均迭代次数** ≤ 2次

**定性指标**:
1. 工作流结构合理（节点顺序符合逻辑）
2. 节点配置正确（URL、参数、typeVersion）
3. 连接关系清晰（无断链、无循环）
4. 命名规范（工作流名称、节点名称）

---

## ⚠️ 风险与缓解

### 风险1: LLM生成质量不稳定

**描述**: AI可能生成错误的工作流JSON

**缓解措施**:
1. **强制验证** - 所有生成的工作流必须通过validate_workflow
2. **自动修复** - 集成autofix机制处理常见错误
3. **迭代机制** - 允许最多10次重试，根据错误信息优化
4. **Few-shot强化** - 提供高质量示例引导生成

### 风险2: 响应时间过长

**描述**: LLM调用 + Tool Use可能导致10秒以上延迟

**缓解措施**:
1. **流式响应** - 前端显示生成进度
2. **异步处理** - 工作流生成在后台进行
3. **缓存策略** - 相似需求直接返回缓存结果
4. **超时控制** - 30秒超时，避免无限等待

### 风险3: LLM成本过高

**描述**: 每次生成可能消耗大量Token

**缓解措施**:
1. **Prompt优化** - 精简系统提示词，移除冗余内容
2. **Tool Use优化** - 减少不必要的search_nodes调用
3. **模型选择** - 使用GPT-4o-mini降低成本
4. **缓存复用** - 相同需求不重复调用

### 风险4: 硬件API变更

**描述**: 硬件API端点变化导致生成的工作流失效

**缓解措施**:
1. **配置化** - 硬件组件定义外部化（environment variable或数据库）
2. **版本管理** - 记录API版本，支持多版本并存
3. **运行时验证** - 创建工作流前测试API可用性

---

## 🎓 附录

### A. n8n-mcp工具清单

**知识库工具** (用于查询节点信息):
- `search_nodes` - 关键词搜索节点
- `get_node` - 获取节点详情
- `validate_node` - 验证节点配置
- `validate_workflow` - 验证完整工作流
- `tools_documentation` - 获取工具文档

**管理工具** (用于创建/修改工作流):
- `n8n_create_workflow` - 创建工作流
- `n8n_get_workflow` - 获取工作流
- `n8n_update_partial_workflow` - 增量更新
- `n8n_validate_workflow` - 验证工作流（by ID）
- `n8n_autofix_workflow` - 自动修复
- `n8n_test_workflow` - 测试工作流

**WorkflowArchitect使用的工具子集**:
1. `search_nodes` - 查询可用节点
2. `get_node` - 获取节点详细配置
3. `validate_workflow` - 验证生成的工作流

### B. 15个核心节点清单

```
触发器 (4):
- n8n-nodes-base.webhook
- n8n-nodes-base.manualTrigger
- n8n-nodes-base.scheduleTrigger
- n8n-nodes-base.errorTrigger

HTTP/API (1):
- n8n-nodes-base.httpRequest (硬件通信核心)

逻辑控制 (4):
- n8n-nodes-base.if
- n8n-nodes-base.switch
- n8n-nodes-base.code
- n8n-nodes-base.function

数据处理 (4):
- n8n-nodes-base.set
- n8n-nodes-base.merge
- n8n-nodes-base.splitInBatches
- n8n-nodes-base.loop

工具 (1):
- n8n-nodes-base.wait

AI (2):
- @n8n/n8n-nodes-langchain.lmChatOpenAi
- @n8n/n8n-nodes-langchain.agent
```

### C. 代码文件变更清单

**删除**:
```
src/agents/scenario-seeds.ts
src/agents/scenario-repository.ts
src/agents/scenario-matcher.ts
src/agents/command-generator.ts
src/agents/template-renderer.ts
src/agents/agent-db.ts (scenarios表部分)
tests/unit/agents/scenario-matcher.test.ts
tests/unit/agents/scenario-repository.test.ts
```

**新增**:
```
src/agents/hardware-components.ts
src/agents/workflow-architect.ts
src/agents/mcp-client.ts
src/agents/prompts/architect-system.ts
src/agents/prompts/few-shot-examples.ts
src/agents/prompts/error-patterns.ts
tests/unit/agents/workflow-architect.test.ts
tests/unit/agents/mcp-client.test.ts
tests/integration/agent/ai-workflow-generation.test.ts
docs/refactor/PROMPT_ENGINEERING_GUIDE.md
```

**修改**:
```
src/agents/intake-agent.ts (重构processUserInput)
src/agents/types.ts (更新AgentResponse)
src/agent-server/agent-service.ts (移除scenario依赖)
apps/agent-ui/src/components/ChatInterface.tsx (处理新响应格式)
```

### D. 环境变量更新

**新增**:
```bash
# LLM配置（必需）
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o  # 或 gpt-4o-mini 降低成本

# WorkflowArchitect配置
WORKFLOW_ARCHITECT_MAX_ITERATIONS=10  # 最大重试次数
WORKFLOW_ARCHITECT_TIMEOUT=30000      # 超时时间（毫秒）
WORKFLOW_ARCHITECT_CACHE_TTL=3600     # 缓存生存时间（秒）
```

---

## 📝 总结

### 核心改进

1. **从固化到灵活** - 预定义模板 → AI动态生成
2. **从有限到无限** - 3个场景 → 理论无限场景
3. **从被动到主动** - 参数填充 → 智能设计
4. **从浪费到利用** - 忽略工具 → 充分发挥n8n-mcp能力

### 技术亮点

- **Prompt Engineering** - 硬件上下文 + Few-shot + 工具规范
- **Tool Use Pattern** - LLM调用n8n-mcp工具动态查询节点
- **Self-Validation** - AI生成后自动validate并修复
- **Iterative Refinement** - 最多10次迭代确保质量

### 预期收益

- **开发效率** ↑ - 新增场景无需编码
- **用户体验** ↑ - 自然语言描述需求即可
- **可扩展性** ↑ - 硬件组件易于添加
- **维护成本** ↓ - 无需维护大量模板代码

---

*Conceived by Romuald Członkowski - [www.aiadvisors.pl/en](https://www.aiadvisors.pl/en)*
