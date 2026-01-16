import OpenAI from 'openai';
import { AgentConfig } from './agent-config';
import { Intent } from './types';
import { logger } from '../utils/logger';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LLMClient {
  classify(systemPrompt: string, userMessage: string): Promise<Intent>;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

export class OpenAILLMClient implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
    this.model = model;
  }

  async classify(systemPrompt: string, userMessage: string): Promise<Intent> {
    logger.debug('OpenAILLMClient: classify request', {
      model: this.model,
      baseUrl: this.client.baseURL ?? null,
      userMessageLength: userMessage.length,
      systemPromptLength: systemPrompt.length,
    });
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const choices = Array.isArray(response.choices) ? response.choices : [];
    const choice = choices[0];
    const content = choice?.message?.content;
    if (!content) {
      logger.warn('OpenAILLMClient: classify response missing content', {
        model: this.model,
        choiceCount: choices.length,
        responseMeta: {
          id: (response as any)?.id ?? null,
          object: (response as any)?.object ?? null,
          model: (response as any)?.model ?? null,
          usage: (response as any)?.usage ?? null,
          error: (response as any)?.error ?? null,
          keys: response && typeof response === 'object' ? Object.keys(response as any) : [],
        },
      });
      throw new Error('LLM response missing content');
    }

    logger.info('OpenAILLMClient: classify response received', {
      model: this.model,
      contentLength: content.length,
      content,
    });
    try {
      return JSON.parse(content) as Intent;
    } catch (error) {
      logger.warn('OpenAILLMClient: classify response not valid JSON', {
        model: this.model,
        contentSnippet: content.slice(0, 200),
      });
      throw error;
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    logger.debug('OpenAILLMClient: chat request', {
      model: this.model,
      baseUrl: this.client.baseURL ?? null,
      messageCount: messages.length,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 1000,
    });
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 1000,
    });

    const content = response.choices?.[0]?.message?.content || '';
    logger.info('OpenAILLMClient: chat response received', {
      model: this.model,
      contentLength: content.length,
      content,
    });
    return content;
  }
}

export function createLLMClient(config: AgentConfig): LLMClient {
  return new OpenAILLMClient(config.llmApiKey, config.llmModel, config.llmBaseUrl);
}
