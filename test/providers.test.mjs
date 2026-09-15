// Provider presets: resolution, missing-key errors, env substitution.
import assert from 'node:assert/strict';
import { PROVIDERS, resolveProvider, providerStatus } from '../src/providers.js';

let n = 0;
function t(name, fn) { fn(); n++; console.log(`  ✓ ${name}`); }

t('every preset has an http(s) base URL and a default model', () => {
  for (const [k, p] of Object.entries(PROVIDERS)) {
    assert.match(p.baseUrl, /^https?:\/\//, k);
    assert.ok(p.defaultModel, k);
  }
});
t('resolveProvider returns endpoint/key/model from env', () => {
  const r = resolveProvider('groq', { GROQ_API_KEY: 'k1' });
  assert.equal(r.endpoint, 'https://api.groq.com/openai/v1');
  assert.equal(r.apiKey, 'k1');
  assert.equal(r.model, PROVIDERS.groq.defaultModel);
});
t('resolveProvider is case-insensitive', () => {
  assert.equal(resolveProvider('NVIDIA', { NVIDIA_API_KEY: 'x' }).name, 'nvidia');
});
t('missing key throws and names the env var', () => {
  assert.throws(() => resolveProvider('gemini', {}), /GEMINI_API_KEY/);
});
t('unknown provider throws and lists the known ones', () => {
  assert.throws(() => resolveProvider('nope', {}), /known: .*groq/);
});
t('cloudflare substitutes the account id into the URL', () => {
  const r = resolveProvider('cloudflare', { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'abc123' });
  assert.equal(r.endpoint, 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1');
  assert.throws(() => resolveProvider('cloudflare', { CLOUDFLARE_API_TOKEN: 't' }), /CLOUDFLARE_ACCOUNT_ID/);
});
t('ollama needs no key', () => {
  const r = resolveProvider('ollama', {});
  assert.equal(r.apiKey, undefined);
  assert.equal(providerStatus({}).find((x) => x.name === 'ollama').ready, true);
});
t('providerStatus reports readiness per env', () => {
  const s = providerStatus({ GROQ_API_KEY: 'k' });
  assert.equal(s.find((x) => x.name === 'groq').ready, true);
  assert.equal(s.find((x) => x.name === 'nvidia').ready, false);
});
console.log(`providers: ${n} passed`);
