import { describe, expect, it } from 'vitest';
import { buildArchitectSystemPrompt } from '../../../src/agents/prompts/architect-system';
import { HARDWARE_COMPONENTS } from '../../../src/agents/hardware-components';

describe('buildArchitectSystemPrompt', () => {
  it('renders hardware components and tool instructions', () => {
    const prompt = buildArchitectSystemPrompt(HARDWARE_COMPONENTS.slice(0, 1), [
      'search_nodes: 搜索n8n节点',
      'get_node: 获取节点详细配置',
    ]);

    expect(prompt).toContain('可用硬件组件');
    expect(prompt).toContain(HARDWARE_COMPONENTS[0].displayName);
    expect(prompt).toContain('search_nodes');
    expect(prompt).toContain('Reasoning');
  });
});
