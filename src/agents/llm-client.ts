import OpenAI from 'openai';
import { AgentConfig } from './agent-config';
import { Intent } from './types';

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

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM response missing content');
    }

    return JSON.parse(content) as Intent;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 1000,
    });

    return response.choices[0]?.message?.content || '';
  }
}

export function createLLMClient(config: AgentConfig): LLMClient {
  return new OpenAILLMClient(config.llmApiKey, config.llmModel, config.llmBaseUrl);
}
