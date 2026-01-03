# Agent V2 执行文档（基于 Agent_Design_v2）

本执行文档基于现有实现（WorkflowArchitect + MCPClient）与最新设计文档 `docs/refactor/Agent_Design_v2.md`，用于指导下一轮重构与交付。

---

## 1. 目标与范围

**目标**：将当前“即时生成 + 自动创建”流程升级为“分阶段确认 + 校验构建”流程，并严格控制节点边界。

**必须满足的设计要求**
- Intake Agent：先确认**整体逻辑**，再逐节点确认配置细节
- 每 **3 轮对话**主动输出“逻辑配置概述”，并提供按钮：**继续交流 / 确认构建**
- 用户点击“确认构建”后，进入 `validate_workflow` 步骤
- `validate_workflow` 失败时自动重试（默认 3 次）
- 仅允许**设计文档定义的节点边界**（触发器/逻辑器/执行器）

---

## 2. 现有实现概览（当前状态）

### 已有能力
- `WorkflowArchitect` + `MCPClient` 动态生成工作流 JSON
- `validate_workflow` 校验 + autofix 自动修复
- `WorkflowDeployer` 负责创建 n8n 工作流
- UI 已支持 `workflow_ready` 响应并显示 reasoning/metadata

### 主要差距（与 V2 设计对比）

| 需求 | 当前实现 | 差距 |
|---|---|---|
| 逻辑概述每 3 轮输出 | ❌ 无 | 需新增“summary_ready”阶段 |
| 继续 / 确认构建按钮 | ❌ 无 | 需 UI + API 交互 |
| 用户确认后才生成工作流 | ❌ 立即生成 | 需状态机与确认 gating |
| validate_workflow 失败重试上限 3 | ⚠️ 有重试但不基于确认 | 需绑定确认触发 |
| 节点边界强约束 | ⚠️ 仅提示 | 需白名单 + prompt 强化 + 校验过滤 |
| 节点配置逐步确认 | ❌ 无 | 需配置清单与缺失字段问答 |

---

## 3. 节点边界（强制白名单）

来自 `Agent_Design_v2.md`：
- 触发器：`n8n-nodes-base.webhook` / `n8n-nodes-base.scheduleTrigger`
- 逻辑器：`n8n-nodes-base.if` / `n8n-nodes-base.splitInBatches`
- 执行器：`n8n-nodes-base.set` / `n8n-nodes-base.httpRequest`

**落地策略**
- 在 WorkflowArchitect 提示词中明确“仅可使用白名单节点”
- 在校验阶段增加“allowed node types”过滤并回传错误
- MCPClient 提供 `getNode` 仅针对白名单节点

---

## 4. 目标数据结构（建议）

### 4.1 会话内 “逻辑配置” 结构
用于每 3 轮输出总结：
```ts
type WorkflowBlueprint = {
  intentSummary: string;
  triggers: Array<{ type: 'webhook' | 'scheduleTrigger'; config: Record<string, unknown> }>;
  logic: Array<{ type: 'if' | 'splitInBatches'; config: Record<string, unknown> }>;
  executors: Array<{ type: 'set' | 'httpRequest'; config: Record<string, unknown> }>;
  missingFields: string[];
};
```

### 4.2 交互响应类型
```ts
type AgentResponse =
  | { type: 'guidance'; message: string }
  | { type: 'summary_ready'; message: string; blueprint: WorkflowBlueprint }
  | { type: 'workflow_ready'; message: string; workflow: WorkflowDefinition; reasoning?: string }
  | { type: 'error'; message: string };
```

---

## 5. 新增处理逻辑（核心改造点）

### 5.1 Intake Agent 分阶段逻辑
1. **用户输入 → 意图 & 配置抽取**
2. **补全逻辑缺口**（缺触发器/缺动作/缺参数）
3. **每 3 轮输出 summary_ready**
4. 若用户点击 **确认构建** → 进入 validate_workflow
5. validate 失败 → 重新生成（最多 3 次）
6. validate 成功 → workflow_ready

### 5.2 Workflow 构建时机
仅在用户“确认构建”后启动 `WorkflowArchitect` 生成；之前只构建 **Blueprint**。

---

## 6. 具体开发任务拆分

### Phase A：数据结构 & 会话状态机
- 新增 `WorkflowBlueprint` 与 `summary_ready` 响应类型
- Session 中保存：`blueprint`、`turnCount`、`confirmed` 状态
- 每 3 轮触发 summary_ready
- 单测：turn count 触发 summary_ready、蓝图更新逻辑

### Phase B：Intake 逻辑改造
- 将 `extractIntent` 输出拆成“逻辑结构 + 节点配置缺口”
- 增加“逐节点参数确认”问答
- 在确认前不生成 workflow JSON
- 单测：缺失字段 → guidance；满足条件 → summary_ready

### Phase C：校验与重试策略
- 新增确认入口：`/api/agent/confirm` 或 WS event `confirm_workflow`
- 确认后执行 `WorkflowArchitect.generateWorkflow`
- 重试最多 3 次，失败返回问题并回到 guidance
- 单测：验证失败触发重试次数上限

### Phase D：节点白名单约束
- MCPClient 增加 `allowedNodeTypes` 参数
- WorkflowArchitect prompt 强制白名单
- 校验前校验节点类型（不在白名单则报错）
- 单测：非法节点被拒绝

### Phase E：前端交互更新
- ChatInterface 增加 `summary_ready` 渲染
- 展示“继续交流 / 确认构建”按钮
- `confirm` 触发后调用新 API 或 WS 消息
- 单测：按钮触发确认调用

---

## 7. Demo 场景落地（个性化手势）

要求支持文档中的节点配置边界：
1. 触发器：Webhook 视频输入
2. 逻辑：IF 分支识别老刘/老付
3. 执行器：Set + httpRequest（机械手 + TTS + 喇叭）

**验证标准**
- JSON 通过 `validate_workflow`
- 仅使用允许节点类型
- 节点参数包含必要字段（method/url/path）

---

## 8. 测试策略

### 单测
- Intake summary cadence（每 3 轮）
- Blueprint 生成与缺失字段检测
- 白名单节点约束

### 集成测试
- chat → summary_ready → confirm → workflow_ready
- validate 失败自动重试（≤3次）
- workflow 创建成功 → UI 刷新

---

## 9. 交付清单

- 新增/更新核心模块：
  - `src/agents/intake-agent.ts`
  - `src/agents/workflow-architect.ts`
  - `src/agents/mcp-client.ts`
  - `src/agents/session-service.ts`
  - `src/agent-server/server.ts`
  - `apps/agent-ui/src/components/ChatInterface.tsx`
- 新增文档：
  - 本文档 `docs/refactor/AGENT_EXECUTION_PLAN_V2.md`

