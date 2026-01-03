import { describe, expect, it } from 'vitest';
import { cleanupNodes, cleanupTemplates, DEFAULT_KEEP_NODE_TYPES } from '../../../src/agents/db-maintenance';
import { createDatabaseAdapter } from '../../../src/database/database-adapter';
import fs from 'fs';
import os from 'os';
import path from 'path';

function getCount(adapter: Awaited<ReturnType<typeof createDatabaseAdapter>>, table: string): number {
  const result = adapter.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
  return result.count;
}

describe('Database maintenance', () => {
  it('removes non-whitelisted nodes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-maintenance-'));
    const dbPath = path.join(tempDir, 'maintenance.db');
    const adapter = await createDatabaseAdapter(dbPath);

    try {
      adapter.exec('CREATE TABLE nodes (node_type TEXT PRIMARY KEY, package_name TEXT, display_name TEXT)');
      adapter.exec('CREATE TABLE IF NOT EXISTS nodes_fts (node_type TEXT)');

      adapter
        .prepare('INSERT INTO nodes (node_type, package_name, display_name) VALUES (?, ?, ?)')
        .run(DEFAULT_KEEP_NODE_TYPES[0], 'n8n-nodes-base', 'HTTP Request');
      adapter
        .prepare('INSERT INTO nodes (node_type, package_name, display_name) VALUES (?, ?, ?)')
        .run('n8n-nodes-base.gmail', 'n8n-nodes-base', 'Gmail');

      adapter.prepare('INSERT INTO nodes_fts (node_type) VALUES (?)').run(DEFAULT_KEEP_NODE_TYPES[0]);
      adapter.prepare('INSERT INTO nodes_fts (node_type) VALUES (?)').run('n8n-nodes-base.gmail');

      const result = cleanupNodes(adapter);

      expect(result.deletedNodes).toBe(1);
      expect(getCount(adapter, 'nodes')).toBe(1);
      expect(getCount(adapter, 'nodes_fts')).toBe(1);
    } finally {
      adapter.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('clears template tables', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-templates-'));
    const dbPath = path.join(tempDir, 'templates.db');
    const adapter = await createDatabaseAdapter(dbPath);

    try {
      adapter.exec('CREATE TABLE templates (id TEXT)');
      adapter.exec('CREATE TABLE template_nodes (id TEXT)');
      adapter.exec('CREATE TABLE template_node_configs (id TEXT)');

      adapter.prepare('INSERT INTO templates (id) VALUES (?)').run('t1');
      adapter.prepare('INSERT INTO template_nodes (id) VALUES (?)').run('n1');
      adapter.prepare('INSERT INTO template_node_configs (id) VALUES (?)').run('c1');

      cleanupTemplates(adapter);

      expect(getCount(adapter, 'templates')).toBe(0);
      expect(getCount(adapter, 'template_nodes')).toBe(0);
      expect(getCount(adapter, 'template_node_configs')).toBe(0);
    } finally {
      adapter.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
