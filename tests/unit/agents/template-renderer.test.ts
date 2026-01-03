import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../../../src/agents/template-renderer';


describe('TemplateRenderer', () => {
  it('replaces placeholders in strings', () => {
    const result = renderTemplate('hello {{ name }}', { name: 'world' });
    expect(result).toBe('hello world');
  });

  it('replaces placeholders in nested objects', () => {
    const template = {
      name: '{{ title }}',
      nodes: [{ url: 'http://example.com/{{ path }}' }],
    };

    const result = renderTemplate(template, { title: 'Demo', path: 'api' }) as any;
    expect(result.name).toBe('Demo');
    expect(result.nodes[0].url).toBe('http://example.com/api');
  });

  it('keeps unknown placeholders', () => {
    const result = renderTemplate('value {{ missing }}', { name: 'x' });
    expect(result).toBe('value {{ missing }}');
  });
});
