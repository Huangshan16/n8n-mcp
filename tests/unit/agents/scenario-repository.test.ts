import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ScenarioRepository } from '../../../src/agents/scenario-repository';

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-scenarios-'));
  return path.join(dir, 'scenarios.db');
}

describe('ScenarioRepository', () => {
  it('loads seeded scenarios by id', async () => {
    const dbPath = createTempDbPath();
    const repo = await ScenarioRepository.create({ dbPath, seed: true });

    try {
      const scenario = await repo.findById('face-gesture-interaction');
      expect(scenario?.name).toBe('个性化手势交互');
    } finally {
      repo.close();
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });
});
