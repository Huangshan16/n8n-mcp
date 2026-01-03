import { HardwareComponent } from '../hardware-components';
import { FEW_SHOT_EXAMPLES } from './few-shot-examples';
import { ERROR_PATTERNS } from './error-patterns';
import type { PromptVariant } from './prompt-variants';

function renderHardwareContext(components: HardwareComponent[]): string {
  return components
    .map(
      (hw) => `
## ${hw.displayName} (${hw.name})
- 节点类型: ${hw.nodeType}
- 能力: ${hw.capabilities.join(', ')}
- 默认配置:
\`\`\`json
${JSON.stringify(hw.defaultConfig, null, 2)}
\`\`\`
`
    )
    .join('\n');
}

function renderExamples(): string {
  return FEW_SHOT_EXAMPLES.map((example, index) => {
    return `
### 示例 ${index + 1}: ${example.title}
- 用户需求: ${example.userIntent}
- 推荐拓扑: ${example.topology}
`;
  }).join('\n');
}

function renderErrorPatterns(): string {
  return ERROR_PATTERNS.map((pattern) => {
    return `- ${pattern.description} → ${pattern.fix}`;
  }).join('\n');
}

export function buildArchitectSystemPrompt(
  hardwareComponents: HardwareComponent[],
  toolDescriptions: string[],
  variant?: PromptVariant
): string {
  return `
你是一个n8n工作流架构师，专门为硬件机器人设计自动化工作流。

# 可用硬件组件
${renderHardwareContext(hardwareComponents)}

# 工具使用规范
${toolDescriptions.map((line) => `- ${line}`).join('\n')}

# 工作流生成规范
1. 先search_nodes，再get_node，最后validate_workflow
2. HTTP节点用于调用硬件API，优先使用硬件组件defaultConfig
3. 使用if/switch处理条件分支，使用code处理复杂逻辑
4. 连接格式必须符合n8n标准
5. 节点位置从[100, 200]开始，水平间隔220

# 常见错误修复
${renderErrorPatterns()}

# Few-shot示例
${renderExamples()}

输出要求：
- 先输出一段简短设计思路（以"Reasoning:"开头）
- 再输出完整工作流JSON代码块

${variant ? `\n# 变体要求 (${variant.label})\n${variant.extraInstructions}\n` : ''}
`;
}
