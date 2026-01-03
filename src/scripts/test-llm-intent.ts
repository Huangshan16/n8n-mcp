import { loadAgentConfig } from '../agents/agent-config';
import { createLLMClient } from '../agents/llm-client';
import { INTENT_CLASSIFICATION_PROMPT } from '../agents/prompts';

async function run() {
  const config = loadAgentConfig();
  const client = createLLMClient(config);
  const input = '见到老刘竖个中指骂人';

  const result = await client.classify(INTENT_CLASSIFICATION_PROMPT, input);
  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
