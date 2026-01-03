import { createDatabaseAdapter, DatabaseAdapter } from '../database/database-adapter';
import { ensureAgentTables, seedAgentData } from './agent-db';
import { resolveAgentDbPath } from './agent-db-path';
import { Scenario } from './types';

export interface ScenarioRepositoryOptions {
  dbPath?: string;
  seed?: boolean;
}

export class ScenarioRepository {
  constructor(private adapter: DatabaseAdapter) {}

  static async create(options: ScenarioRepositoryOptions = {}): Promise<ScenarioRepository> {
    const dbPath = options.dbPath || resolveAgentDbPath();
    const adapter = await createDatabaseAdapter(dbPath);
    await ensureAgentTables(adapter);
    if (options.seed !== false) {
      await seedAgentData(adapter);
    }
    return new ScenarioRepository(adapter);
  }

  async findByIntent(category: string, subCategory?: string): Promise<Scenario[]> {
    if (subCategory) {
      const rows = this.adapter
        .prepare('SELECT * FROM scenarios WHERE intent_category = ? AND intent_sub_category = ?')
        .all(category, subCategory) as Record<string, string>[];
      if (rows.length > 0) {
        return rows.map((row) => this.mapRow(row));
      }
    }

    const fallbackRows = this.adapter
      .prepare('SELECT * FROM scenarios WHERE intent_category = ?')
      .all(category) as Record<string, string>[];
    return fallbackRows.map((row) => this.mapRow(row));
  }

  async findById(id: string): Promise<Scenario | null> {
    const row = this.adapter.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as
      | Record<string, string>
      | undefined;
    return row ? this.mapRow(row) : null;
  }

  async list(): Promise<Scenario[]> {
    const rows = this.adapter.prepare('SELECT * FROM scenarios').all() as Record<string, string>[];
    return rows.map((row) => this.mapRow(row));
  }

  close(): void {
    this.adapter.close();
  }

  private mapRow(row: Record<string, string>): Scenario {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      intentCategory: row.intent_category as Scenario['intentCategory'],
      intentSubCategory: row.intent_sub_category || undefined,
      requiredComponents: JSON.parse(row.required_components),
      requiredParams: JSON.parse(row.required_params),
      workflowTemplate: JSON.parse(row.workflow_template),
    };
  }
}
