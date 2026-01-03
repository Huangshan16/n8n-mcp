import { describe, expect, it } from 'vitest';
import { ensureAgentTables, seedAgentData } from '../../../src/agents/agent-db';
import { createDatabaseAdapter } from '../../../src/database/database-adapter';
import fs from 'fs';
import os from 'os';
import path from 'path';

function getCount(adapter: Awaited<ReturnType<typeof createDatabaseAdapter>>, table: string): number {
  const result = adapter.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
  return result.count;
}

describe('Agent DB setup', () => {
  it('creates tables and seeds data', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-agent-db-'));
    const dbPath = path.join(tempDir, 'agent.db');
    const adapter = await createDatabaseAdapter(dbPath);

    try {
      await ensureAgentTables(adapter);
      await seedAgentData(adapter);

      expect(getCount(adapter, 'hardware_components')).toBeGreaterThan(0);

      const scenarioCheck = adapter
        .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
        .get('table', 'scenarios') as { name?: string } | undefined;
      expect(scenarioCheck?.name).toBeUndefined();

      const tableCheck = adapter
        .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
        .get('table', 'agent_sessions') as { name?: string } | undefined;
      expect(tableCheck?.name).toBe('agent_sessions');
    } finally {
      adapter.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
