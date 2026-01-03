import fs from 'fs';
import path from 'path';
import { createDatabaseAdapter } from '../database/database-adapter';
import { cleanupNodes, DEFAULT_KEEP_NODE_TYPES } from '../agents/db-maintenance';
import { logger } from '../utils/logger';

async function run() {
  const dbPath = process.env.NODE_DB_PATH || path.join(process.cwd(), 'data', 'nodes.db');
  const backupPath = dbPath.replace(/\.db$/i, `.backup-${Date.now()}.db`);

  logger.info(`Backing up database: ${backupPath}`);
  fs.copyFileSync(dbPath, backupPath);

  const adapter = await createDatabaseAdapter(dbPath);
  try {
    const before = adapter.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
    logger.info(`Nodes before cleanup: ${before.count}`);

    const result = cleanupNodes(adapter, DEFAULT_KEEP_NODE_TYPES);
    logger.info(`Deleted nodes: ${result.deletedNodes}`);

    const after = adapter.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
    logger.info(`Nodes after cleanup: ${after.count}`);
  } finally {
    adapter.close();
  }
}

run().catch((error) => {
  logger.error('Failed to clean up nodes:', error);
  process.exit(1);
});
