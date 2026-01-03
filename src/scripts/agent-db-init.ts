import path from 'path';
import { createDatabaseAdapter } from '../database/database-adapter';
import { ensureAgentTables, seedAgentData } from '../agents/agent-db';
import { logger } from '../utils/logger';

async function run() {
  const dbPath = process.env.NODE_DB_PATH || path.join(process.cwd(), 'data', 'nodes.db');
  const adapter = await createDatabaseAdapter(dbPath);
  try {
    await ensureAgentTables(adapter);
    await seedAgentData(adapter);
    logger.info('Agent tables initialized.');
  } finally {
    adapter.close();
  }
}

run().catch((error) => {
  logger.error('Failed to initialize agent tables:', error);
  process.exit(1);
});
