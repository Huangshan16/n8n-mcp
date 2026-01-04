## 合法n8n工作流JSON文档规则

基于代码库中的文件，n8n工作流JSON的结构规则主要通过实际示例和部分schema定义来体现，没有单独的完整规则文档。

### 核心结构组件

工作流JSON的基本结构包含以下必需字段：

```json
{
  "name": "工作流名称",
  "nodes": [...],
  "connections": {...},
  "settings": {...}
}
```

**节点定义** [1](#0-0) ：
- `id`: 唯一标识符（UUID格式）
- `name`: 节点显示名称
- `type`: 节点类型（如"n8n-nodes-base.manualTrigger"）
- `typeVersion`: 节点版本号
- `position`: 坐标位置[x, y]
- `parameters`: 节点参数配置

**连接定义** [2](#0-1) ：
- 按源节点名称组织
- 包含输出类型（如"main"）
- 指定目标节点、连接类型和索引

### Schema定义示例

在N8nTrainingCustomerDatastore中发现了部分schema定义 [3](#0-2) ：

```json
{
  "type": "object",
  "properties": {
    "active": {"type": "boolean"},
    "createdAt": {"type": "string"},
    "id": {"type": "string"},
    "name": {"type": "string"},
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {"type": "string"},
          "name": {"type": "string"},
          "type": {"type": "string"}
        }
      }
    }
  }
}
```

### 特殊字段

- `pinData`: 手动固定的数据 [4](#0-3) 
- `staticData`: 静态数据存储 [5](#0-4) 
- `meta`: 元数据信息 [6](#0-5) 
- `tags`: 标签数组 [7](#0-6) 

## Notes

虽然没有找到完整的官方规则文档，但通过分析代码库中的工作流示例，可以推断出n8n工作流JSON的基本结构要求。最完整的参考可能是实际的工作流文件和部分schema定义。建议查看测试目录中的各种工作流示例来了解完整的结构规则。

Wiki pages you might want to explore:
- [Workflow Execution Engine (n8n-io/n8n)](/wiki/n8n-io/n8n#2)

### Citations

**File:** packages/testing/playwright/tests/cli-workflows/workflows/5.json (L7-15)
```json
	"nodes": [
		{
			"parameters": {},
			"name": "Start",
			"type": "n8n-nodes-base.manualTrigger",
			"typeVersion": 1,
			"position": [250, 300],
			"id": "481a7e7f-5ea7-402b-8316-f72c37b850bb"
		},
```

**File:** packages/testing/playwright/tests/cli-workflows/workflows/5.json (L51-60)
```json
	"connections": {
		"Start": {
			"main": [
				[
					{
						"node": "Hacker News",
						"type": "main",
						"index": 0
					}
				]
```

**File:** packages/nodes-base/nodes/N8nTrainingCustomerDatastore/__schema__/v1.0.0/workflow/getAll.json (L1-60)
```json
{
    "type": "object",
    "properties": {
        "active": {
            "type": "boolean"
        },
        "createdAt": {
            "type": "string"
        },
        "id": {
            "type": "string"
        },
        "meta": {
            "type": "object",
            "properties": {
                "templateCredsSetupCompleted": {
                    "type": "boolean"
                }
            }
        },
        "name": {
            "type": "string"
        },
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string"
                    },
                    "name": {
                        "type": "string"
                    },
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "assignments": {
                                "type": "object",
                                "properties": {
                                    "assignments": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "id": {
                                                    "type": "string"
                                                },
                                                "name": {
                                                    "type": "string"
                                                },
                                                "type": {
                                                    "type": "string"
                                                }
                                            }
                                        }
                                    }
                                }
                            },
                            "authentication": {
```

**File:** packages/frontend/editor-ui/src/features/workflows/templates/utils/samples/tutorial/json_basics.json (L504-504)
```json
	"pinData": {},
```

**File:** packages/testing/playwright/tests/cli-workflows/workflows/199.json (L49-54)
```json
	"staticData": {
		"node:Clockify Trigger": {
			"userId": "60335ad2f24e660123d7fdeb",
			"lastTimeChecked": "2021-05-10T14:49:24Z"
		}
	},
```

**File:** packages/testing/playwright/tests/cli-workflows/workflows/199.json (L55-56)
```json
	"meta": null,
	"pinData": null,
```

**File:** packages/testing/playwright/tests/cli-workflows/workflows/199.json (L58-60)
```json
	"triggerCount": 0,
	"tags": []
```
