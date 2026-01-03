import { describe, expect, it } from 'vitest';
import { selectPromptVariant } from '../../../src/agents/prompts/prompt-variants';

describe('selectPromptVariant', () => {
  it('returns baseline by default', () => {
    const variant = selectPromptVariant(undefined, 'seed');
    expect(variant.id).toBe('baseline');
  });

  it('returns explicit variant when provided', () => {
    const variant = selectPromptVariant('strict', 'seed');
    expect(variant.id).toBe('strict');
  });

  it('returns stable variant for AB mode', () => {
    const first = selectPromptVariant('ab', 'user-123');
    const second = selectPromptVariant('ab', 'user-123');
    expect(first.id).toBe(second.id);
  });
});
