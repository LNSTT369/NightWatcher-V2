import { createError, ErrorCode } from "../../lib/errors";
import type { LLMProvider, CompletionParams, CompletionResult } from "../types";

// Ollama exposes an OpenAI-compatible /v1/chat/completions endpoint.
// For hosted Ollama (e.g. ollama.ai cloud) an API key is required.
// For local Ollama (http://localhost:11434) no key is needed.

export interface OllamaConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

interface OllamaResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OllamaProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: OllamaConfig) {
    this.apiKey = config.apiKey ?? "";
    this.model = config.model ?? "llama3.2";
    // Default to hosted ollama.ai; override with OLLAMA_BASE_URL for local
    this.baseUrl = config.baseUrl ?? "https://api.ollama.ai/v1";
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: params.model ?? this.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 1024,
      stream: false,
    };

    if (params.response_format?.type === "json_object") {
      body.response_format = { type: "json_object" };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw createError(
        ErrorCode.PROVIDER_ERROR,
        `Ollama API error (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as OllamaResponse;
    const content = data.choices[0]?.message?.content ?? "";

    return {
      content,
      usage: {
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
        total_tokens: data.usage?.total_tokens ?? 0,
      },
    };
  }
}

export function createOllamaProvider(config: OllamaConfig): OllamaProvider {
  return new OllamaProvider(config);
}
