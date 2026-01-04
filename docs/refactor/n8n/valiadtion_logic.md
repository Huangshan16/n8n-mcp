# Workflow Validation 具体校验逻辑

## 核心验证架构

Workflow Validation 由 `WorkflowValidator` 类实现，采用多层验证架构 [1](#5-0) ：

```typescript
class WorkflowValidator {
  constructor(
    private nodeRepository: NodeRepository,
    private nodeValidator: typeof EnhancedConfigValidator
  )
}
```

## 1. 工作流结构验证

### 基本结构要求
- **必须字段**: `nodes` (数组) 和 `connections` (对象) [2](#5-1) 
- **可选字段**: `name`, `settings`, `staticData`, `pinData`, `meta` [3](#5-2) 

### 节点数组验证
```typescript
// 必须是数组
if (!Array.isArray(workflow.nodes)) {
  errors.push('nodes must be an array');
}

// 空工作流警告
if (workflow.nodes.length === 0) {
  warnings.push('Workflow is empty - no nodes defined');
}
```

### 连接对象验证
```typescript
// 必须是对象
if (typeof workflow.connections !== 'object' || Array.isArray(workflow.connections)) {
  errors.push('connections must be an object');
}
```

### 单节点工作流规则
- 仅允许 webhook 节点作为单节点工作流 [4](#5-3) 
- 其他单节点工作流被视为无效

## 2. 节点验证规则

### 必需节点属性
每个节点必须包含 [5](#5-4) ：
```typescript
interface WorkflowNode {
  id: string;           // 唯一标识符
  name: string;         // 显示名称
  type: string;         // 节点类型
  position: [number, number]; // UI位置
  parameters: any;      // 节点参数
  typeVersion?: number; // 版本号（推荐）
  disabled?: boolean;   // 是否禁用
  // 可选属性
  credentials?: any;
  notes?: string;
  continueOnFail?: boolean;
  onError?: 'continueRegularOutput' | 'continueErrorOutput' | 'stopWorkflow';
}
```

### 节点类型验证
- 必须包含包前缀（如 `n8n-nodes-base.webhook`） [6](#5-5) 
- 拒绝无前缀类型（如 `webhook`）
- 拒绝过时的 `nodes-base.` 前缀

### typeVersion 验证
- 版本化节点必须指定 `typeVersion` [7](#5-6) 
- 版本号不能超过节点支持的最大版本

## 3. 连接验证规则

### 连接结构格式
```typescript
interface WorkflowConnection {
  [sourceNode: string]: {
    main?: Array<Array<{ node: string; type: string; index: number }>>;
    error?: Array<Array<{ node: string; type: string; index: number }>>;
    ai_tool?: Array<Array<{ node: string; type: string; index: number }>>;
  };
}
```

### 连接引用验证
- **源节点**: 必须使用节点名称（不是ID） [8](#5-7) 
- **目标节点**: 必须存在于工作流中 [9](#5-8) 
- **循环检测**: 检测并报告工作流中的循环连接 [10](#5-9) 

### 多节点工作流连接要求
- 多节点工作流必须有至少一个连接 [11](#5-10) 
- 空连接会导致错误

## 4. 表达式验证规则

### 表达式格式
- 必须用 `{{ }}` 包裹表达式 [12](#5-11) 
- 检查括号匹配和语法正确性

### 变量引用验证
- `$json`: 访问当前节点数据
- `$node["Node Name"]`: 引用其他节点输出
- `$input.item`: 循环中的输入数据
- `$fromAI()`: AI特定表达式

### 资源定位器验证
- `__rl` 结构用于动态资源选择
- 验证模式：`id`, `url`, `expression`, `name`, `list`

## 5. AI特定验证

### AI Agent 工作流验证 [13](#5-12) 
- 检查语言模型连接
- 验证AI工具连接
- 强制流模式约束
- 检查内存和输出解析器配置

### LangChain 节点验证
- 跳过常规表达式验证（使用AI特定规则） [14](#5-13) 

## 6. 验证配置文件

### 支持的验证模式 [15](#5-14) 
- **minimal**: 仅必需字段错误，用于实时编辑
- **runtime**: 仅关键运行时错误，用于执行验证
- **ai-friendly**: 平衡验证，适合AI代理
- **strict**: 全面验证，用于生产部署

## 7. 错误恢复建议

验证器提供智能错误恢复建议 [16](#5-15) ：
- 节点类型错误修复指导
- 连接结构修复示例
- 配置问题解决方案
- typeVersion错误修复建议

## 完整的合法工作流JSON示例

```json
{
  "name": "Example Workflow",
  "nodes": [
    {
      "id": "1",
      "name": "Manual Trigger",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [250, 300],
      "parameters": {}
    },
    {
      "id": "2", 
      "name": "Set Variable",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3,
      "position": [450, 300],
      "parameters": {
        "values": {
          "string": [
            {
              "name": "message",
              "value": "{{ $json.data }}"
            }
          ]
        }
      },
      "onError": "continueErrorOutput"
    }
  ],
  "connections": {
    "Manual Trigger": {
      "main": [[{ "node": "Set Variable", "type": "main", "index": 0 }]]
    }
  }
}
```

## Notes

这些验证规则确保生成的工作流JSON在n8n中能够正确导入和执行。AI生成工作流时应严格遵循这些规则，特别注意节点类型格式、连接引用使用名称而非ID、以及必需的typeVersion字段。验证器还提供详细的错误信息和修复建议，帮助快速定位和解决问题。

Wiki pages you might want to explore:
- [Template Tools (czlonkowski/n8n-mcp)](/wiki/czlonkowski/n8n-mcp#4.2)
- [Validation Tools (czlonkowski/n8n-mcp)](/wiki/czlonkowski/n8n-mcp#4.3)
- [n8n Management Tools (czlonkowski/n8n-mcp)](/wiki/czlonkowski/n8n-mcp#4.4)

### Citations

**File:** src/services/workflow-validator.ts (L16-34)
```typescript
interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  position: [number, number];
  parameters: any;
  credentials?: any;
  disabled?: boolean;
  notes?: string;
  notesInFlow?: boolean;
  typeVersion?: number;
  continueOnFail?: boolean;
  onError?: 'continueRegularOutput' | 'continueErrorOutput' | 'stopWorkflow';
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
}
```

**File:** src/services/workflow-validator.ts (L44-52)
```typescript
interface WorkflowJson {
  name?: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection;
  settings?: any;
  staticData?: any;
  pinData?: any;
  meta?: any;
}
```

**File:** src/services/workflow-validator.ts (L77-86)
```typescript
export class WorkflowValidator {
  private currentWorkflow: WorkflowJson | null = null;
  private similarityService: NodeSimilarityService;

  constructor(
    private nodeRepository: NodeRepository,
    private nodeValidator: typeof EnhancedConfigValidator
  ) {
    this.similarityService = new NodeSimilarityService(nodeRepository);
  }
```

**File:** src/services/workflow-validator.ts (L178-197)
```typescript
        // Validate AI-specific nodes (AI Agent, Chat Trigger, AI tools)
        if (workflow.nodes.length > 0 && hasAINodes(workflow)) {
          const aiIssues = validateAISpecificNodes(workflow);
          // Convert AI validation issues to workflow validation format
          for (const issue of aiIssues) {
            const validationIssue: ValidationIssue = {
              type: issue.severity === 'error' ? 'error' : 'warning',
              nodeId: issue.nodeId,
              nodeName: issue.nodeName,
              message: issue.message,
              details: issue.code ? { code: issue.code } : undefined
            };

            if (issue.severity === 'error') {
              result.errors.push(validationIssue);
            } else {
              result.warnings.push(validationIssue);
            }
          }
        }
```

**File:** src/services/workflow-validator.ts (L223-258)
```typescript
  private validateWorkflowStructure(
    workflow: WorkflowJson,
    result: WorkflowValidationResult
  ): void {
    // Check for required fields
    if (!workflow.nodes) {
      result.errors.push({
        type: 'error',
        message: workflow.nodes === null ? 'nodes must be an array' : 'Workflow must have a nodes array'
      });
      return;
    }

    if (!Array.isArray(workflow.nodes)) {
      result.errors.push({
        type: 'error',
        message: 'nodes must be an array'
      });
      return;
    }

    if (!workflow.connections) {
      result.errors.push({
        type: 'error',
        message: workflow.connections === null ? 'connections must be an object' : 'Workflow must have a connections object'
      });
      return;
    }

    if (typeof workflow.connections !== 'object' || Array.isArray(workflow.connections)) {
      result.errors.push({
        type: 'error',
        message: 'connections must be an object'
      });
      return;
    }
```

**File:** src/services/workflow-validator.ts (L269-288)
```typescript
    // Check for minimum viable workflow
    if (workflow.nodes.length === 1) {
      const singleNode = workflow.nodes[0];
      const normalizedType = NodeTypeNormalizer.normalizeToFullForm(singleNode.type);
      const isWebhook = normalizedType === 'nodes-base.webhook' ||
                       normalizedType === 'nodes-base.webhookTrigger';
      const isLangchainNode = normalizedType.startsWith('nodes-langchain.');

      // Langchain nodes can be validated standalone for AI tool purposes
      if (!isWebhook && !isLangchainNode) {
        result.errors.push({
          type: 'error',
          message: 'Single-node workflows are only valid for webhook endpoints. Add at least one more connected node to create a functional workflow.'
        });
      } else if (isWebhook && Object.keys(workflow.connections).length === 0) {
        result.warnings.push({
          type: 'warning',
          message: 'Webhook node has no connections. Consider adding nodes to process the webhook data.'
        });
      }
```

**File:** src/services/workflow-validator.ts (L969-974)
```typescript
      // Skip expression validation for langchain nodes
      // They have AI-specific validators and different expression rules
      const normalizedType = NodeTypeNormalizer.normalizeToFullForm(node.type);
      if (normalizedType.startsWith('nodes-langchain.')) {
        continue;
      }
```

**File:** src/services/workflow-validator.ts (L1013-1024)
```typescript
      // Validate expression format (check for missing = prefix and resource locator format)
      const formatContext = {
        nodeType: node.type,
        nodeName: node.name,
        nodeId: node.id
      };

      const formatIssues = ExpressionFormatValidator.validateNodeParameters(
        node.parameters,
        formatContext
      );

```

**File:** src/services/workflow-validator.ts (L1764-1829)
```typescript
  private addErrorRecoverySuggestions(result: WorkflowValidationResult): void {
    // Categorize errors and provide specific recovery actions
    const errorTypes = {
      nodeType: result.errors.filter(e => e.message.includes('node type') || e.message.includes('Node type')),
      connection: result.errors.filter(e => e.message.includes('connection') || e.message.includes('Connection')),
      structure: result.errors.filter(e => e.message.includes('structure') || e.message.includes('nodes must be')),
      configuration: result.errors.filter(e => e.message.includes('property') || e.message.includes('field')),
      typeVersion: result.errors.filter(e => e.message.includes('typeVersion'))
    };

    // Add recovery suggestions based on error types
    if (errorTypes.nodeType.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: Invalid node types detected. Use these patterns:',
        '   • For core nodes: "n8n-nodes-base.nodeName" (e.g., "n8n-nodes-base.webhook")',
        '   • For AI nodes: "@n8n/n8n-nodes-langchain.nodeName"',
        '   • Never use just the node name without package prefix'
      );
    }

    if (errorTypes.connection.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: Connection errors detected. Fix with:',
        '   • Use node NAMES in connections, not IDs or types',
        '   • Structure: { "Source Node Name": { "main": [[{ "node": "Target Node Name", "type": "main", "index": 0 }]] } }',
        '   • Ensure all referenced nodes exist in the workflow'
      );
    }

    if (errorTypes.structure.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: Workflow structure errors. Fix with:',
        '   • Ensure "nodes" is an array: "nodes": [...]',
        '   • Ensure "connections" is an object: "connections": {...}',
        '   • Add at least one node to create a valid workflow'
      );
    }

    if (errorTypes.configuration.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: Node configuration errors. Fix with:',
        '   • Check required fields using validate_node_minimal first',
        '   • Use get_node_essentials to see what fields are needed',
        '   • Ensure operation-specific fields match the node\'s requirements'
      );
    }

    if (errorTypes.typeVersion.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: TypeVersion errors. Fix with:',
        '   • Add "typeVersion": 1 (or latest version) to each node',
        '   • Use get_node_info to check the correct version for each node type'
      );
    }

    // Add general recovery workflow
    if (result.errors.length > 3) {
      result.suggestions.push(
        '📋 SUGGESTED WORKFLOW: Too many errors detected. Try this approach:',
        '   1. Fix structural issues first (nodes array, connections object)',
        '   2. Validate node types and fix invalid ones',
        '   3. Add required typeVersion to all nodes',
        '   4. Test connections step by step',
        '   5. Use validate_node_minimal on individual nodes to verify configuration'
      );
    }
```

**File:** src/services/n8n-validation.ts (L227-232)
```typescript
        // Additional check for common node type mistakes
        if (node.type.startsWith('nodes-base.')) {
          errors.push(`Invalid node type "${node.type}" at index ${index}. Use "n8n-nodes-base.${node.type.substring(11)}" instead.`);
        } else if (!node.type.includes('.')) {
          errors.push(`Invalid node type "${node.type}" at index ${index}. Node types must include package prefix (e.g., "n8n-nodes-base.webhook").`);
        }
```

**File:** tests/unit/services/workflow-validator-comprehensive.test.ts (L805-827)
```typescript
    it('should error for connection from non-existent node', async () => {
      const workflow = {
        nodes: [
          {
            id: '1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            position: [100, 100],
            parameters: {}
          }
        ],
        connections: {
          'NonExistent': {
            main: [[{ node: 'Webhook', type: 'main', index: 0 }]]
          }
        }
      } as any;

      const result = await validator.validateWorkflow(workflow as any);

      expect(result.errors.some(e => e.message.includes('Connection from non-existent node: "NonExistent"'))).toBe(true);
      expect(result.statistics.invalidConnections).toBe(1);
    });
```

**File:** tests/unit/services/workflow-validator-comprehensive.test.ts (L1103-1114)
```typescript
            main: [[{ node: 'Node3', type: 'main', index: 0 }]]
          },
          'Node3': {
            main: [[{ node: 'Node1', type: 'main', index: 0 }]] // Creates cycle
          }
        }
      } as any;

      const result = await validator.validateWorkflow(workflow as any);

      expect(result.errors.some(e => e.message.includes('Workflow contains a cycle'))).toBe(true);
    });
```

**File:** tests/unit/services/workflow-validator-comprehensive.test.ts (L1953-1954)
```typescript
      expect(result.errors.some(e => e.message.includes('Missing required property \'typeVersion\''))).toBe(true);
      expect(result.errors.some(e => e.message.includes('Node-level properties onError are in the wrong location'))).toBe(true);
```

**File:** tests/unit/services/workflow-validator-with-mocks.test.ts (L392-398)
```typescript
      // Act
      const result = await validator.validateWorkflow(workflow as any);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Multi-node workflow has no connections'))).toBe(true);
    });
```

**File:** src/mcp/tools.ts (L557-562)
```typescript
            profile: {
              type: 'string',
              enum: ['minimal', 'runtime', 'ai-friendly', 'strict'],
              description: 'Validation profile for node validation. Default "runtime".',
              default: 'runtime',
            },
```
