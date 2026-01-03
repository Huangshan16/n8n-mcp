# Prompt Engineering Guide (Agent V2)

This guide documents the prompt strategy for the WorkflowArchitect.

## Goals

- Convert natural language hardware scenarios into valid n8n workflow JSON.
- Minimize validation errors by reinforcing node config rules.
- Keep token usage reasonable while still providing enough context.

## Prompt Structure

1. **System prompt** (`src/agents/prompts/architect-system.ts`)
   - Injects hardware components and default configs
   - Defines tool usage order (search_nodes → get_node → validate_workflow)
   - Includes error patterns and few-shot summaries
2. **Node context**
   - Built by WorkflowArchitect from MCPClient node details
3. **User request**
   - Includes intent + extracted entities
4. **Validation feedback loop**
   - Injects validation errors for retries

## Prompt Variants

Prompt variants are selected via `AGENT_PROMPT_VARIANT`:

- `baseline` (default): balanced instruction set
- `strict`: extra emphasis on typeVersion + connection integrity
- `ab`: stable A/B split based on user intent hash

Source: `src/agents/prompts/prompt-variants.ts`

## Few-shot Examples

Lightweight examples are stored in:

- `src/agents/prompts/few-shot-examples.ts`

They focus on topology structure rather than full JSON to reduce tokens.

## Error Patterns

Common validation errors are summarized in:

- `src/agents/prompts/error-patterns.ts`

Use this list to expand fix guidance when validation failures are frequent.

## Optimization Tips

- Prefer concise JSON blocks over verbose commentary.
- Keep node context trimmed to essentials (resource/operation/url/method).
- Use prompt variants for targeted experiments before changing baseline.
