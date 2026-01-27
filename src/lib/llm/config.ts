/**
 * LLM Model Configuration
 * Primary/backup model setup with reasoning levels for content filtering.
 */

// OpenRouter unified effort levels: none disables, minimal/low/medium/high enable with varying depth
export type ReasoningLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high';

export type ModelEntry = {
  model: string;
  reasoning: ReasoningLevel;
};

export type ModelConfig = {
  primary: ModelEntry;
  backup: ModelEntry;
};

const DEFAULT_CONFIG: ModelConfig = {
  primary: { model: 'x-ai/grok-4.1-fast', reasoning: 'none' },
  backup: { model: 'google/gemini-3-flash-preview', reasoning: 'minimal' },
};

let currentConfig = DEFAULT_CONFIG;

export function getModelConfig(): ModelConfig {
  return currentConfig;
}

export function setModelConfig(config: Partial<ModelConfig>): void {
  currentConfig = {
    primary: config.primary ?? currentConfig.primary,
    backup: config.backup ?? currentConfig.backup,
  };
}
