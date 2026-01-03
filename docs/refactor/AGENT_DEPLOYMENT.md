# Agent Backend Docker Deployment (Draft)

This deployment guide focuses on running the agent backend and UI in containers.

## Agent Server (Node)

```bash
docker run --rm -p 3005:3005 \
  -v $(pwd):/app \
  -w /app \
  -e N8N_API_URL=http://host.docker.internal:5678/api/v1 \
  -e N8N_API_KEY=your-n8n-api-key \
  -e base_url=https://your-llm-endpoint \
  -e api_key=your-llm-api-key \
  -e model=gpt-5.1 \
  -e AGENT_LLM_TIMEOUT_MS=30000 \
  -e AGENT_WORKFLOW_CACHE_TTL=600 \
  -e AGENT_MAX_ITERATIONS=5 \
  -e AGENT_PROMPT_VARIANT=baseline \
  node:22-bullseye \
  bash -lc "npm install && npm run build && npm run agent:start"
```

## Agent UI (Vite)

```bash
docker run --rm -p 5173:5173 \
  -v $(pwd)/apps/agent-ui:/app \
  -w /app \
  -e VITE_AGENT_API_URL=http://host.docker.internal:3005 \
  -e VITE_AGENT_WS_URL=ws://host.docker.internal:3005/ws \
  -e VITE_N8N_IFRAME_URL=http://host.docker.internal:5678/home/workflows \
  node:22-bullseye \
  bash -lc "npm install && npm run dev -- --host 0.0.0.0"
```

## Notes

- `host.docker.internal` resolves to the host machine on Docker Desktop.
- For Linux, replace with your host IP or use `--network host`.
- These commands mount the repo directly to keep setup simple for now.
