# Agent Backend API 文档（给前端调试用）

## 基础信息
- 默认地址: `http://127.0.0.1:3005`
- 端口/Host:
  - `AGENT_PORT`（默认 `3005`）
  - `AGENT_HOST`（默认 `0.0.0.0`）
- 请求体大小上限: `1mb`
- 认证: 无
- 返回类型: `application/json`

## 启动方式
```bash
npm run agent:dev
```

## 会话与返回类型说明
服务端每次对话会返回 `sessionId`，后续请求建议带上该值。

`response.type` 可能值：
- `guidance`：继续收集信息
- `summary_ready`：给出结构化摘要 + 蓝图
- `workflow_ready`：生成了可用的 n8n workflow JSON
- `error`：异常

## HTTP 接口

### 1) 健康检查
**GET** `/api/health`

响应
```json
{ "status": "ok" }
```

---

### 2) 对话接口
**POST** `/api/agent/chat`

请求
```json
{
  "message": "用户输入文本",
  "sessionId": "可选，首次不传"
}
```

响应
```json
{
  "sessionId": "服务端会话ID",
  "response": {
    "type": "guidance | summary_ready | workflow_ready | error",
    "message": "对话文本",
    "blueprint": {
      "intentSummary": "string",
      "triggers": [{ "type": "webhook", "config": {} }],
      "logic": [{ "type": "if", "config": {} }],
      "executors": [{ "type": "set", "config": {} }],
      "missingFields": []
    },
    "workflow": {
      "name": "string",
      "nodes": [],
      "connections": {},
      "settings": {},
      "meta": {}
    },
    "reasoning": "string",
    "metadata": {
      "iterations": 1,
      "nodeCount": 4
    }
  }
}
```

错误码
- `400`：`message is required`
- `500`：`Agent error`

---

### 3) 确认需求（与前端“继续/确认”按钮对应）
**POST** `/api/agent/confirm`

请求
```json
{ "sessionId": "必须" }
```

响应：同 `/api/agent/chat`

错误码
- `400`：`sessionId is required`
- `500`：`Agent error`

---

### 4) 确认构建（别名接口）
**POST** `/api/agent/confirm-build`

请求
```json
{ "sessionId": "必须" }
```

响应：同 `/api/agent/chat`

---

### 5) 重置会话
**POST** `/api/agent/reset-session`

请求
```json
{ "sessionId": "必须" }
```

响应
```json
{ "success": true }
```

---

### 6) 创建 n8n Workflow
**POST** `/api/workflow/create`

请求（二选一）
```json
{
  "workflow": {
    "name": "Workflow Name",
    "nodes": [],
    "connections": {},
    "settings": {},
    "meta": {}
  }
}
```
或
```json
{ "sessionId": "..." }
```

响应
```json
{
  "workflowId": "n8n workflow id",
  "workflowName": "name",
  "workflowUrl": "https://your-n8n-host/workflow/<id>"
}
```

错误码
- `400`：`workflow or sessionId is required`
- `400`：`N8N API is not configured. Set N8N_API_URL and N8N_API_KEY.`

配置依赖（创建 n8n workflow 时必须）
```
N8N_API_URL=http://127.0.0.1:5678/api/v1
N8N_API_KEY=***
N8N_PUBLIC_URL=http://127.0.0.1:5678
```

## WebSocket 接口

**URL** `ws://127.0.0.1:3005/ws`

### 发送
```json
{ "type": "ping" }
```
```json
{ "type": "user_message", "sessionId": "可选", "message": "用户输入" }
```
```json
{ "type": "confirm_workflow", "sessionId": "必须" }
```

### 接收
```json
{ "type": "pong" }
```
```json
{
  "type": "agent_response",
  "sessionId": "会话ID",
  "response": {
    "type": "guidance | summary_ready | workflow_ready | error",
    "message": "..."
  }
}
```
```json
{ "type": "error", "message": "..." }
```

## 推荐前端调用流程
1. `POST /api/agent/chat`（首次不传 `sessionId`）
2. 后续对话携带 `sessionId`
3. 当返回 `summary_ready`：展示摘要并提示用户确认
4. 调用 `/api/agent/confirm` 或 WS `confirm_workflow`
5. 当返回 `workflow_ready`：展示 workflow JSON 或调用 `/api/workflow/create` 部署

