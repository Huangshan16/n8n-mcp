export interface PromptVariant {
  id: string;
  label: string;
  extraInstructions: string;
}

export const PROMPT_VARIANTS: PromptVariant[] = [
  {
    id: 'baseline',
    label: 'Baseline',
    extraInstructions: '保持简洁，但必须满足节点配置与连接规范。',
  },
  {
    id: 'strict',
    label: 'Strict validation',
    extraInstructions: '所有节点必须包含typeVersion，连接必须完整无断链。',
  },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function selectPromptVariant(
  desired: string | undefined,
  seed: string
): PromptVariant {
  if (!desired || desired === 'baseline') {
    return PROMPT_VARIANTS[0];
  }

  const directMatch = PROMPT_VARIANTS.find((variant) => variant.id === desired);
  if (directMatch) {
    return directMatch;
  }

  if (desired === 'ab' || desired === 'random') {
    const index = hashString(seed) % PROMPT_VARIANTS.length;
    return PROMPT_VARIANTS[index];
  }

  return PROMPT_VARIANTS[0];
}
