// Provider configuration shared by background modules.
//
// Extension pages/content scripts cannot import ES modules as content scripts,
// so common/messages.js still mirrors the public defaults for UI contexts.
// scripts/architecture-check.js keeps the two surfaces in sync.

export const STORAGE_KEYS = Object.freeze({
  API_KEY: 'at_api_key',
  API_KEY_GEMINI: 'at_api_key_gemini',
  API_KEY_DEEPSEEK: 'at_api_key_deepseek',
  API_KEY_OPENAI: 'at_api_key_openai',
  MODEL: 'at_model',
  PROVIDER: 'at_provider',
  FALLBACK_PROVIDER: 'at_fallback_provider',
});

export const PROVIDER_MODELS = Object.freeze({
  gemini: ['gemini-2.5-flash-lite', 'gemini-2.0-flash'],
  deepseek: ['deepseek-chat'],
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-7'],
  openai: ['gpt-4o-mini'],
});

export const DEFAULT_MODEL_BY_PROVIDER = Object.freeze(
  Object.fromEntries(
    Object.entries(PROVIDER_MODELS).map(([provider, models]) => [provider, models[0]]),
  ),
);

export const DEFAULT_PROVIDER = 'gemini';
export const DEFAULT_FALLBACK_PROVIDER = 'anthropic';

export function isValidProvider(provider) {
  return typeof provider === 'string' &&
    Object.prototype.hasOwnProperty.call(DEFAULT_MODEL_BY_PROVIDER, provider);
}

export function defaultModelForProvider(provider) {
  return DEFAULT_MODEL_BY_PROVIDER[provider] ||
    DEFAULT_MODEL_BY_PROVIDER[DEFAULT_PROVIDER];
}

export function isKnownModelForProvider(provider, model) {
  const models = PROVIDER_MODELS[provider];
  return Array.isArray(models) && models.includes(model);
}
