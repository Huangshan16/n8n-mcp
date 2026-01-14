# Agent Backend Quick Start

This quick start wires the agent backend, Web UI, and n8n instance together.

## 1) Initialize the Agent Tables

```bash
npm install
npm run build
npm run agent:db:init
```

## 2) Start the Agent Server

```bash
npm run agent:dev
```

By default the server listens on `http://localhost:3005` and exposes:
- `POST /api/agent/chat`
- `POST /api/workflow/create`
- WebSocket `ws://localhost:3005/ws`

## 3) Start the UI

```bash
cd apps/agent-ui
npm run dev

cd docs
./web.sh

npm install
```

### UI Environment Variables

Create a `.env` file inside `apps/agent-ui` if you want to override defaults:

```bash
VITE_AGENT_API_URL=http://localhost:3005
VITE_AGENT_WS_URL=ws://localhost:3005/ws
VITE_N8N_IFRAME_URL=http://localhost:5678/home/workflows
```

## 4) Required Backend Environment Variables

Set these in the root `.env` (or `.env copy`):

```bash
N8N_API_URL=http://localhost:5678/api/v1
N8N_API_KEY=your-n8n-api-key
base_url=https://your-llm-endpoint
api_key=your-llm-api-key
model=gpt-5.1
```

The agent server uses these values to call your LLM and create workflows in n8n.

### Optional Agent Tuning

```bash
AGENT_LLM_TIMEOUT_MS=30000
AGENT_WORKFLOW_CACHE_TTL=600
AGENT_MAX_ITERATIONS=5
AGENT_PROMPT_VARIANT=baseline   # baseline | strict | ab
```

The agent will return `workflow_ready` responses that include the workflow JSON,
reasoning text, and metadata (iterations + node count).
