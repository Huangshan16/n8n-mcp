import { DatabaseAdapter } from '../database/database-adapter';
import { logger } from '../utils/logger';
import { DEFAULT_HARDWARE_COMPONENTS, DEFAULT_SCENARIOS } from './scenario-seeds';

export async function ensureAgentTables(adapter: DatabaseAdapter): Promise<void> {
  adapter.exec(`
    CREATE TABLE IF NOT EXISTS scenarios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      intent_category TEXT NOT NULL,
      intent_sub_category TEXT,
      required_components TEXT NOT NULL,
      required_params TEXT NOT NULL,
      workflow_template TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hardware_components (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      node_type TEXT NOT NULL,
      default_config TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      conversation TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_scenarios_intent ON scenarios(intent_category, intent_sub_category);
    CREATE INDEX IF NOT EXISTS idx_components_name ON hardware_components(name);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_expires ON agent_sessions(expires_at);
  `);
}

export async function seedAgentData(adapter: DatabaseAdapter): Promise<void> {
  const scenarioCount = adapter.prepare('SELECT COUNT(*) as count FROM scenarios').get() as { count: number };
  if (scenarioCount.count === 0) {
    const insertScenario = adapter.prepare(`
      INSERT INTO scenarios (
        id,
        name,
        description,
        intent_category,
        intent_sub_category,
        required_components,
        required_params,
        workflow_template
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    DEFAULT_SCENARIOS.forEach((scenario) => {
      insertScenario.run(
        scenario.id,
        scenario.name,
        scenario.description,
        scenario.intentCategory,
        scenario.intentSubCategory ?? null,
        JSON.stringify(scenario.requiredComponents),
        JSON.stringify(scenario.requiredParams),
        JSON.stringify(scenario.workflowTemplate)
      );
    });

    logger.info(`Seeded ${DEFAULT_SCENARIOS.length} scenarios`);
  }

  const componentCount = adapter
    .prepare('SELECT COUNT(*) as count FROM hardware_components')
    .get() as { count: number };
  if (componentCount.count === 0) {
    const insertComponent = adapter.prepare(`
      INSERT INTO hardware_components (
        id,
        name,
        display_name,
        node_type,
        default_config,
        capabilities
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    DEFAULT_HARDWARE_COMPONENTS.forEach((component) => {
      insertComponent.run(
        component.id,
        component.name,
        component.displayName,
        component.nodeType,
        JSON.stringify(component.defaultConfig),
        JSON.stringify(component.capabilities)
      );
    });

    logger.info(`Seeded ${DEFAULT_HARDWARE_COMPONENTS.length} hardware components`);
  }
}
