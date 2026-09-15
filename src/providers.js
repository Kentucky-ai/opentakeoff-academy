// Provider presets — free-tier and startup-credit OpenAI-compatible endpoints
// the Academy runner can drive without a custom --endpoint. Each preset is a
// base URL, the env var that carries its key, and a default model. Keys are
// never stored here; the runner reads them from the environment at run time.
//
//   opentakeoff-academy providers                 # list presets + which have keys
//   opentakeoff-academy run --provider groq ...   # resolves endpoint/key/model
//
// Override the model with --model. Base URLs verified 2026-09-15 against each
// vendor's OpenAI-compatibility docs; model ids drift, so `providers --live`
// asks each endpoint for its /models list instead of trusting the defaults.

export const PROVIDERS = {
  nvidia: {
    label: 'NVIDIA NIM (build.nvidia.com)',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyEnv: 'NVIDIA_API_KEY',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    free: 'free inference credits per API key, more on request; 40 RPM',
  },
  gemini: {
    label: 'Google Gemini (OpenAI-compatible)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    free: 'free tier on Flash / Flash-Lite, no billing account needed',
  },
  groq: {
    label: 'GroqCloud',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    free: 'free dev tier, ~14,400 req/day, no card',
  },
  cloudflare: {
    label: 'Cloudflare Workers AI',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1',
    keyEnv: 'CLOUDFLARE_API_TOKEN',
    extraEnv: ['CLOUDFLARE_ACCOUNT_ID'],
    defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    free: '10,000 Neurons/day, resets daily',
  },
  nebius: {
    label: 'Nebius AI Studio',
    baseUrl: 'https://api.studio.nebius.com/v1',
    keyEnv: 'NEBIUS_API_KEY',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    free: '$25 builder credit self-serve; $5K pre-seed program',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'openrouter/free',
    free: 'free-model router, 50 req/day (1,000/day after a $10 top-up)',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4.1-mini',
    free: 'none (Codex OSS Fund credits if awarded)',
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    keyEnv: null,
    defaultModel: 'llama3.1',
    free: 'local, no key',
  },
};

/**
 * Resolve a preset into runner options.
 * @param {string} name - preset key (case-insensitive)
 * @param {object} [env=process.env]
 * @returns {{ name:string, endpoint:string, apiKey:string|undefined, model:string, label:string }}
 * @throws if the preset is unknown, or a required env var is missing
 */
export function resolveProvider(name, env = process.env) {
  const key = String(name || '').toLowerCase();
  const p = PROVIDERS[key];
  if (!p) throw new Error(`unknown provider '${name}' — known: ${Object.keys(PROVIDERS).join(', ')}`);
  let endpoint = p.baseUrl;
  for (const v of p.extraEnv || []) {
    if (!env[v]) throw new Error(`provider '${key}' needs ${v} in the environment`);
    endpoint = endpoint.replace(`{${v}}`, env[v]);
  }
  const apiKey = p.keyEnv ? env[p.keyEnv] : undefined;
  if (p.keyEnv && !apiKey) throw new Error(`provider '${key}' needs ${p.keyEnv} in the environment (${p.free})`);
  return { name: key, endpoint, apiKey, model: p.defaultModel, label: p.label };
}

/** One row per preset: whether its key (and any extra env) is present. */
export function providerStatus(env = process.env) {
  return Object.entries(PROVIDERS).map(([name, p]) => ({
    name,
    label: p.label,
    keyEnv: p.keyEnv,
    ready: (!p.keyEnv || Boolean(env[p.keyEnv])) && (p.extraEnv || []).every((v) => Boolean(env[v])),
    defaultModel: p.defaultModel,
    free: p.free,
  }));
}
