import { NodeRepository } from '../database/node-repository';
import { EnhancedConfigValidator } from '../services/enhanced-config-validator';
import { WorkflowAutoFixer } from '../services/workflow-auto-fixer';
import { WorkflowDiffEngine } from '../services/workflow-diff-engine';
import { WorkflowValidator, ValidationIssue } from '../services/workflow-validator';
import { SimpleCache } from '../utils/simple-cache';
import type { WorkflowDefinition } from './types';

export interface SearchNodesParams {
  query: string;
  limit?: number;
  mode?: 'OR' | 'AND' | 'FUZZY';
  includeExamples?: boolean;
}

export interface SearchNodesResult {
  nodes: Array<{
    nodeType: string;
    displayName: string;
    description?: string;
    category?: string;
    exampleConfig?: object;
  }>;
  total: number;
}

export interface GetNodeParams {
  nodeType: string;
  detail?: 'minimal' | 'standard' | 'full';
  includeExamples?: boolean;
}

export interface GetNodeResult {
  nodeType: string;
  displayName: string;
  description?: string;
  defaultVersion?: number;
  properties?: any[];
  operations?: any[];
  credentials?: any[];
  exampleConfig?: object;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  suggestions: string[];
  statistics: {
    totalNodes: number;
    enabledNodes: number;
    triggerNodes: number;
    validConnections: number;
    invalidConnections: number;
    expressionsValidated: number;
  };
}

export interface MCPClientOptions {
  cacheTtlSeconds?: number;
  workflowValidator?: {
    validateWorkflow: (
      workflow: WorkflowDefinition,
      options?: {
        validateNodes?: boolean;
        validateConnections?: boolean;
        validateExpressions?: boolean;
        profile?: 'minimal' | 'runtime' | 'ai-friendly' | 'strict';
      }
    ) => Promise<{
      valid: boolean;
      errors: ValidationIssue[];
      warnings: ValidationIssue[];
      statistics: ValidationResult['statistics'];
      suggestions: string[];
    }>;
  };
  autoFixer?: WorkflowAutoFixer;
  diffEngine?: WorkflowDiffEngine;
}

export class MCPClient {
  private cache: SimpleCache;
  private cacheTtlSeconds: number;
  private workflowValidator: {
    validateWorkflow: (
      workflow: WorkflowDefinition,
      options?: {
        validateNodes?: boolean;
        validateConnections?: boolean;
        validateExpressions?: boolean;
        profile?: 'minimal' | 'runtime' | 'ai-friendly' | 'strict';
      }
    ) => Promise<{
      valid: boolean;
      errors: ValidationIssue[];
      warnings: ValidationIssue[];
      statistics: ValidationResult['statistics'];
      suggestions: string[];
    }>;
  };
  private autoFixer: WorkflowAutoFixer;
  private diffEngine: WorkflowDiffEngine;

  constructor(
    private nodeRepository: NodeRepository,
    options: MCPClientOptions = {}
  ) {
    this.cache = new SimpleCache();
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 600;
    if (options.workflowValidator) {
      this.workflowValidator = options.workflowValidator;
    } else {
      const validator = new WorkflowValidator(this.nodeRepository, EnhancedConfigValidator);
      this.workflowValidator = {
        validateWorkflow: (workflow, options) =>
          validator.validateWorkflow(workflow as any, options),
      };
    }
    this.autoFixer = options.autoFixer ?? new WorkflowAutoFixer(this.nodeRepository);
    this.diffEngine = options.diffEngine ?? new WorkflowDiffEngine();
  }

  async searchNodes(params: SearchNodesParams): Promise<SearchNodesResult> {
    const cacheKey = `search:${params.query}:${params.mode ?? 'OR'}:${params.limit ?? 20}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as SearchNodesResult;
    }

    const nodes = this.nodeRepository.searchNodes(
      params.query,
      params.mode ?? 'OR',
      params.limit ?? 20
    );

    const result: SearchNodesResult = {
      nodes: nodes.map((node) => ({
        nodeType: node.nodeType,
        displayName: node.displayName,
        description: node.description,
        category: node.category,
        exampleConfig: params.includeExamples ? this.getExampleConfig(node.nodeType) : undefined,
      })),
      total: nodes.length,
    };

    this.cache.set(cacheKey, result, this.cacheTtlSeconds);
    return result;
  }

  async getNode(params: GetNodeParams): Promise<GetNodeResult> {
    const cacheKey = `node:${params.nodeType}:${params.detail ?? 'standard'}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as GetNodeResult;
    }

    const node = this.nodeRepository.getNodeByType(params.nodeType);
    if (!node) {
      throw new Error(`Node not found: ${params.nodeType}`);
    }

    const detail = params.detail ?? 'standard';
    const properties =
      detail === 'full' ? node.properties : this.filterEssentialProperties(node.properties || []);

    const result: GetNodeResult = {
      nodeType: node.nodeType,
      displayName: node.displayName,
      description: node.description,
      defaultVersion: node.version,
      properties,
      operations: detail === 'minimal' ? undefined : node.operations,
      credentials: detail === 'minimal' ? undefined : node.credentials,
      exampleConfig: params.includeExamples ? this.getExampleConfig(node.nodeType) : undefined,
    };

    this.cache.set(cacheKey, result, this.cacheTtlSeconds);
    return result;
  }

  async validateWorkflow(workflow: WorkflowDefinition): Promise<ValidationResult> {
    const result = await this.workflowValidator.validateWorkflow(workflow, {
      validateNodes: true,
      validateConnections: true,
      validateExpressions: true,
      profile: 'runtime',
    });

    return {
      isValid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      suggestions: result.suggestions,
      statistics: result.statistics,
    };
  }

  async autofixWorkflow(workflow: WorkflowDefinition): Promise<WorkflowDefinition> {
    const validation = await this.validateWorkflow(workflow);
    if (validation.isValid) {
      return workflow;
    }

    const fixes = await this.autoFixer.generateFixes(workflow as any, validation as any, [], {
      applyFixes: true,
      confidenceThreshold: 'medium',
      maxFixes: 20,
    });

    if (fixes.operations.length === 0) {
      return workflow;
    }

    const result = await this.diffEngine.applyDiff(workflow as any, {
      id: workflow.name || 'autofix',
      operations: fixes.operations,
      validateOnly: false,
    });

    return (result.workflow as WorkflowDefinition) ?? workflow;
  }

  private filterEssentialProperties(properties: any[]): any[] {
    return properties.filter(
      (prop) =>
        prop.required ||
        ['resource', 'operation', 'url', 'method', 'authentication'].includes(prop.name)
    );
  }

  private getExampleConfig(_nodeType: string): object | undefined {
    return undefined;
  }
}
