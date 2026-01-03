import path from 'path';
import { createDatabaseAdapter } from '../src/database/database-adapter';
import { cleanupTemplates } from '../src/agents/db-maintenance';
import { logger } from '../src/utils/logger';

async function run() {
  const dbPath = process.env.NODE_DB_PATH || path.join(process.cwd(), 'data', 'nodes.db');
  const adapter = await createDatabaseAdapter(dbPath);
  try {
    cleanupTemplates(adapter);
    logger.info('Template tables cleaned.');
  } finally {
    adapter.close();
  }
}

run().catch((error) => {
  logger.error('Failed to clean up templates:', error);
  process.exit(1);
});
