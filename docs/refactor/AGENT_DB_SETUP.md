# Agent DB Setup

This guide covers the bootstrap scripts introduced for the agent backend refactor.

## Initialize Agent Tables

Creates `scenarios`, `hardware_components`, and `agent_sessions`, then seeds demo data.

```bash
npm run build
npm run agent:db:init
```

## Clean Up Node Catalog (Optional)

Backs up `nodes.db` and removes non-whitelisted nodes from the catalog.

```bash
npm run build
npm run agent:cleanup:nodes
```

## Clean Up Templates (Optional)

Clears template tables while preserving schema.

```bash
npm run build
npm run agent:cleanup:templates
```

## LLM Connectivity Smoke Test

Runs a sample intent classification request using your LLM env vars.

```bash
npm run build
npm run test:llm-intent
```
