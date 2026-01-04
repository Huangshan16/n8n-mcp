## 最新版n8n节点JSON结构

### 1. Webhook触发器 (n8n-nodes-base.webhook) - 最新版
```json
{
  "parameters": {
    "httpMethod": "POST",
    "path": "webhook",
    "responseMode": "onReceived",
    "options": {}
  },
  "type": "n8n-nodes-base.webhook",
  "typeVersion": 2
}
```

### 2. 定时触发器 (n8n-nodes-base.scheduleTrigger) - 最新版
```json
{
  "parameters": {
    "rule": {
      "interval": [
        {
          "field": "minutes",
          "minutesInterval": 5
        }
      ]
    }
  },
  "type": "n8n-nodes-base.scheduleTrigger",
  "typeVersion": 1.1
}
```

### 3. 条件分支 (n8n-nodes-base.if) - 最新版 v2.2
```json
{
  "parameters": {
    "conditions": {
      "options": {
        "version": 2,
        "caseSensitive": true,
        "typeValidation": "loose"
      },
      "combinator": "and",
      "conditions": [
        {
          "operator": {
            "type": "boolean",
            "operation": "true"
          },
          "leftValue": "={{ $json.is_fragile }}",
          "rightValue": ""
        }
      ]
    }
  },
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.2
}
``` [1](#2-0) 

### 4. 批量处理/循环 (n8n-nodes-base.splitInBatches) - 最新版 v3
```json
{
  "parameters": {
    "batchSize": 1,
    "options": {
      "reset": false
    }
  },
  "type": "n8n-nodes-base.splitInBatches",
  "typeVersion": 3
}
``` [2](#2-1) 

### 5. 数据处理 (n8n-nodes-base.set) - 最新版 v3.4
```json
{
  "parameters": {
    "assignments": {
      "assignments": [
        {
          "id": "e87952cb-878e-4feb-8261-342eaf887838",
          "name": "json_example_string",
          "type": "string",
          "value": "This is a simple string"
        }
      ]
    },
    "options": {},
    "includeOtherFields": false
  },
  "type": "n8n-nodes-base.set",
  "typeVersion": 3.4
}
``` [3](#2-2) 

### 6. HTTP请求 (n8n-nodes-base.httpRequest) - 最新版 v4.2
```json
{
  "parameters": {
    "url": "https://example.com/api",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "onError": "continueErrorOutput"
}
``` [4](#2-3) 

## Notes

- 所有节点都需要包含 `id` (UUID)、`name` (显示名称)、`type` (节点类型)、`typeVersion` (版本号) 和 `position` (坐标) 这些基本字段
- 最新版本的节点通常提供更丰富的功能和更好的用户体验
- SplitInBatches v3 的输出端口顺序为 `['done', 'loop']`，与 v2 相反

### Citations

**File:** packages/frontend/editor-ui/src/features/workflows/templates/utils/samples/tutorial/workflow_logic.json (L365-390)
```json
			"parameters": {
				"options": {},
				"conditions": {
					"options": {
						"version": 2,
						"leftValue": "",
						"caseSensitive": true,
						"typeValidation": "loose"
					},
					"combinator": "and",
					"conditions": [
						{
							"id": "a68aad83-1d09-4ebe-9732-aaedc407bb4b",
							"operator": {
								"type": "boolean",
								"operation": "true",
								"singleValue": true
							},
							"leftValue": "={{ $json.is_fragile }}",
							"rightValue": ""
						}
					]
				},
				"looseTypeValidation": true
			},
			"typeVersion": 2.2
```

**File:** packages/nodes-base/nodes/SplitInBatches/v3/SplitInBatchesV3.node.ts (L35-61)
```typescript
			{
				displayName: 'Batch Size',
				name: 'batchSize',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 1,
				description: 'The number of items to return with each call',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Reset',
						name: 'reset',
						type: 'boolean',
						default: false,
						description:
							'Whether the node starts again from the beginning of the input items. This will treat incoming data as a new set rather than continuing with the previous items.',
					},
				],
			},
```

**File:** packages/nodes-base/nodes/HttpRequest/test/node/workflow.use_error_output.json (L31-36)
```json
			"type": "n8n-nodes-base.httpRequest",
			"typeVersion": 4.2,
			"position": [240, 368],
			"alwaysOutputData": false,
			"onError": "continueErrorOutput"
		},
```
