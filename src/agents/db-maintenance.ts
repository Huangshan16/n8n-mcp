import { DatabaseAdapter } from '../database/database-adapter';

export const DEFAULT_KEEP_NODE_TYPES = [
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.if',
  'n8n-nodes-base.switch',
  'n8n-nodes-base.set',
  'n8n-nodes-base.code',
  'n8n-nodes-base.function',
  'n8n-nodes-base.merge',
  'n8n-nodes-base.splitInBatches',
  'n8n-nodes-base.loop',
  'n8n-nodes-base.wait',
  'n8n-nodes-base.errorTrigger',
  '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  '@n8n/n8n-nodes-langchain.agent',
];

function tableExists(adapter: DatabaseAdapter, tableName: string): boolean {
  const result = adapter
    .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', tableName) as { name?: string } | undefined;
  return Boolean(result?.name);
}

export function cleanupNodes(
  adapter: DatabaseAdapter,
  keepNodeTypes: string[] = DEFAULT_KEEP_NODE_TYPES
): { deletedNodes: number } {
  if (keepNodeTypes.length === 0) {
    throw new Error('keepNodeTypes must not be empty');
  }

  const placeholders = keepNodeTypes.map(() => '?').join(',');
  const deleteNodes = adapter
    .prepare(`DELETE FROM nodes WHERE node_type NOT IN (${placeholders})`)
    .run(...keepNodeTypes);

  if (tableExists(adapter, 'nodes_fts')) {
    adapter.prepare(`DELETE FROM nodes_fts WHERE node_type NOT IN (${placeholders})`).run(...keepNodeTypes);
  }

  if (tableExists(adapter, 'node_documentation')) {
    adapter.prepare(`DELETE FROM node_documentation WHERE node_type NOT IN (${placeholders})`).run(...keepNodeTypes);
  }

  return { deletedNodes: deleteNodes.changes };
}

export function cleanupTemplates(adapter: DatabaseAdapter): void {
  if (tableExists(adapter, 'template_node_configs')) {
    adapter.exec('DELETE FROM template_node_configs');
  }
  if (tableExists(adapter, 'template_nodes')) {
    adapter.exec('DELETE FROM template_nodes');
  }
  if (tableExists(adapter, 'templates')) {
    adapter.exec('DELETE FROM templates');
  }
}
