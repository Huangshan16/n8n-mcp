import path from 'path';

export function resolveAgentDbPath(): string {
  return process.env.NODE_DB_PATH || path.join(process.cwd(), 'data', 'nodes.db');
}
