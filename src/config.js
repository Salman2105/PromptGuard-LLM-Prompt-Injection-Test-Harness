import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function integer(env, key, fallback, min, max) {
  const value = env[key] || String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`Invalid ${key} configuration`);
  }
  return Number(value);
}

export function loadConfig(env = process.env) {
  const provider = env.LLM_PROVIDER || 'mock';
  if (!['mock', 'openai'].includes(provider)) throw new Error('Invalid LLM_PROVIDER configuration');
  return {
    provider,
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_MODEL || '',
    mongoUri: env.MONGODB_URI || '',
    host: env.HOST || '127.0.0.1',
    port: integer(env, 'PORT', 3000, 1, 65535),
    timeoutMs: integer(env, 'LLM_TIMEOUT_MS', 30000, 100, 120000),
    maxOutputTokens: integer(env, 'MAX_OUTPUT_TOKENS', 512, 16, 4096),
  };
}
