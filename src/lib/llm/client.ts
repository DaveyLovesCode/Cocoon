/**
 * Centralized LLM Client
 * - 3 retry attempts per model before falling back to backup
 * - Categorized error handling (retryable vs terminal)
 * - Reasoning/thinking level support per model
 * - Logging of all requests/responses
 */

import { createLogger } from '../logger';
import { getModelConfig, type ModelConfig, type ReasoningLevel } from './config';

const log = createLogger('LLM');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_ATTEMPTS_PER_MODEL = 3;

// Errors that shouldn't retry on same model
const NON_RETRYABLE_STATUSES = new Set([400, 401, 402, 403]);
// Errors that should skip to backup immediately (no retry)
const SKIP_TO_BACKUP_STATUSES = new Set([404]);
// Errors that should abort completely (no backup fallback)
const TERMINAL_STATUSES = new Set([401, 402, 403]);

export type LLMMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LLMRequestOptions = {
  apiKey: string;
  messages: LLMMessage[];
  signal?: AbortSignal;
  modelConfig?: ModelConfig;
};

export type LLMResponse = {
  content: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

type AttemptRecord = {
  model: string;
  attempt: number;
  isPrimary: boolean;
  status: number | undefined;
  message: string;
};

class LLMError extends Error {
  status?: number;
  isTerminal: boolean;

  constructor(message: string, status?: number | null, isTerminal = false) {
    super(message);
    this.name = 'LLMError';
    this.status = status ?? undefined;
    this.isTerminal = isTerminal;
  }
}

function shouldRetry(status: number | undefined, attempt: number): boolean {
  if (attempt >= MAX_ATTEMPTS_PER_MODEL) return false;
  if (status === undefined) return true; // Network error, worth retrying
  if (NON_RETRYABLE_STATUSES.has(status)) return false;
  if (SKIP_TO_BACKUP_STATUSES.has(status)) return false;
  return true;
}

function shouldTryBackup(status: number | undefined): boolean {
  if (status === undefined) return true; // Network error
  return !TERMINAL_STATUSES.has(status);
}

function createUserFriendlyError(status: number | undefined, rawMessage: string): LLMError {
  if (status === 401) {
    return new LLMError('API key not recognized', status, true);
  }
  if (status === 402) {
    return new LLMError('Out of credits', status, true);
  }
  if (status === 403) {
    const isLimit = rawMessage.toLowerCase().includes('limit');
    if (isLimit) {
      return new LLMError('Spending limit reached', status, true);
    }
    return new LLMError(`Access denied: ${rawMessage}`, status, true);
  }
  if (status === 429) {
    return new LLMError('Rate limit hit', status, false);
  }
  if (status === 404) {
    return new LLMError('Model unavailable, trying backup...', status, false);
  }
  if (status !== undefined && status >= 500) {
    return new LLMError('Service temporarily unavailable', status, false);
  }
  // Network errors or unknown
  if (status === undefined || status === 0) {
    return new LLMError('Connection failed', status, false);
  }
  return new LLMError(`API error: ${rawMessage}`, status, false);
}

/**
 * Transform reasoning level into model-specific params.
 * - xAI/Grok: binary toggle (enabled: true/false)
 * - Others: effort level
 */
function getReasoningParams(model: string, reasoning: ReasoningLevel): Record<string, unknown> {
  // xAI/Grok models: binary toggle
  if (model.includes('x-ai') || model.includes('grok')) {
    return { reasoning: { enabled: reasoning !== 'none' } };
  }

  // Others: effort level (none/minimal/low/medium/high)
  return { reasoning: { effort: reasoning } };
}

async function attemptRequest(
  apiKey: string,
  model: string,
  messages: LLMMessage[],
  reasoning: ReasoningLevel,
  signal?: AbortSignal
): Promise<{ content: string; usage?: LLMResponse['usage'] }> {
  const reasoningParams = getReasoningParams(model, reasoning);
  const requestBody = { model, messages, ...reasoningParams };

  log.debug('Request body', { model, reasoning, reasoningParams });

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://cocoon.surf',
      'X-Title': 'Cocoon Extension',
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    let errorMessage = text;
    try {
      const json = JSON.parse(text);
      errorMessage = json.error?.message || json.message || text;
    } catch {}

    const error = new LLMError(errorMessage, response.status);
    throw error;
  }

  const data = await response.json();

  // Log raw response for debugging reasoning tokens
  log.debug('Raw response', {
    model: data.model,
    usage: data.usage,
    id: data.id,
  });

  if (data.error?.message) {
    throw new LLMError(data.error.message, response.status);
  }

  const content = data.choices?.[0]?.message?.content || '';
  if (!content.trim()) {
    throw new LLMError('Model returned empty response', 0);
  }

  return { content, usage: data.usage };
}

export async function sendLLMRequest(options: LLMRequestOptions): Promise<LLMResponse> {
  const { apiKey, messages, signal, modelConfig } = options;
  const config = modelConfig ?? getModelConfig();

  const modelSequence = [
    { model: config.primary.model, reasoning: config.primary.reasoning, isPrimary: true },
    { model: config.backup.model, reasoning: config.backup.reasoning, isPrimary: false },
  ].filter((entry, idx, arr) => {
    // Skip backup if same as primary
    if (idx > 0 && entry.model === arr[0].model) return false;
    return true;
  });

  const attemptRecords: AttemptRecord[] = [];
  let lastError: LLMError | null = null;

  for (const entry of modelSequence) {
    const { model, reasoning, isPrimary } = entry;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const reasoningLabel = reasoning === 'none' ? 'no-thinking' : `thinking:${reasoning}`;
        log.info(`Request: ${model} [${reasoningLabel}] (${isPrimary ? 'primary' : 'backup'}, attempt ${attempt})`);
        log.debug('Messages', messages.map(m => ({ role: m.role, length: m.content.length })));

        const start = Date.now();
        const result = await attemptRequest(apiKey, model, messages, reasoning, signal);
        const duration = Date.now() - start;

        const usage = result.usage;
        if (usage) {
          log.info(`Response (${duration}ms): ${usage.prompt_tokens} in, ${usage.completion_tokens} out`);
        } else {
          log.info(`Response (${duration}ms)`);
        }
        log.debug('Content', result.content.substring(0, 500));

        return { content: result.content, model, usage };
      } catch (err) {
        // Handle abort
        if (err instanceof Error && err.name === 'AbortError') {
          throw err;
        }

        const llmError =
          err instanceof LLMError
            ? err
            : new LLMError(err instanceof Error ? err.message : String(err), null);

        attemptRecords.push({
          model,
          attempt,
          isPrimary,
          status: llmError.status,
          message: llmError.message,
        });
        lastError = llmError;

        log.warn(`Attempt failed: ${model} #${attempt}`, {
          status: llmError.status,
          message: llmError.message,
        });

        // Terminal error - don't try backup
        if (llmError.isTerminal) {
          log.error('Terminal error, aborting', llmError.message);
          throw createUserFriendlyError(llmError.status, llmError.message);
        }

        // Check if we should retry same model
        if (!shouldRetry(llmError.status, attempt)) {
          break; // Move to backup
        }

        // Brief delay before retry
        if (attempt < MAX_ATTEMPTS_PER_MODEL) {
          await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
    }

    // Check if we should try backup
    if (lastError && !shouldTryBackup(lastError.status)) {
      break;
    }
  }

  // All attempts failed
  log.error('All attempts failed', { attempts: attemptRecords.length, lastError: lastError?.message });

  if (lastError) {
    throw createUserFriendlyError(lastError.status, lastError.message);
  }

  throw new LLMError('All models failed');
}
