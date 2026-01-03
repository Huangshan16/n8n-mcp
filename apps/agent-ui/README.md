# Agent UI

Frontend console for the n8n-MCP agent backend.

## Development

```bash
npm install
npm run dev
```

## Environment Variables

Create a `.env` file (optional):

```bash
VITE_AGENT_API_URL=http://localhost:3005
VITE_AGENT_WS_URL=ws://localhost:3005/ws
VITE_N8N_IFRAME_URL=http://localhost:5678/home/workflows
```

## Tests

```bash
npm test -- --run
```
