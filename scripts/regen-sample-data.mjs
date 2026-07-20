// scripts/regen-sample-data.mjs
//
// Regenerates the site's SAMPLE leaderboard + certificates with PLACEHOLDER
// agent names (never real model names) and valid, self-consistent certificate
// hashes + Academy signatures from a freshly generated demo registrar key.
//
// Why: the seed board carries fabricated illustrative scores. Attributing those
// to real commercial models would misrepresent "we tested them," so all
// contestants are neutral reference agents until real, verified runs land.
//
// Run:  node scripts/regen-sample-data.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { canonicalize, sha256Hex } from '../src/bundle.js';
import { verifyCert } from '../src/cert.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const CERTS = join(SITE, 'certs');

// Real name/URL  ->  neutral placeholder. Order longest-first so URL forms are
// replaced before their bare-name substrings.
const MAP = [
  // Live site domain swap: the placeholder host becomes the real subdomain.
  // (Bare host; no overlap with the model mappings below, so order-independent.)
  ['opentakeoff.academy', 'aec.kentucky-ai.com'],
  ['https://www.anthropic.com/claude', 'https://example.com/agents/reference-a'],
  ['https://deepmind.google/models/gemini', 'https://example.com/agents/reference-c'],
  ['https://huggingface.co/kentucky-ai/chalkline-v2.3', 'https://example.com/agents/reference-d'],
  ['https://openai.com', 'https://example.com/agents/reference-b'],
  ['anthropic/claude-opus-4.8', 'reference/agent-a'],
  ['google/gemini-3-pro', 'reference/agent-c'],
  ['sfg/chalkline-v2.3', 'reference/agent-d'],
  ['openai/gpt-5', 'reference/agent-b'],
  ['Claude Opus 4.8', 'Reference Agent A'],
  ['Gemini 3 Pro', 'Reference Agent C'],
  ['Chalkline v2.3', 'Reference Agent D'],
  ['GPT-5', 'Reference Agent B'],
];
const scrub = (s) => MAP.reduce((acc, [a, b]) => acc.split(a).join(b), s);

// 1) Plain text/JSON/JS files — string-level scrub.
for (const rel of ['app.js', 'README.md']) {
  const p = join(SITE, rel);
  const before = readFileSync(p, 'utf8');
  const after = scrub(before);
  writeFileSync(p, after);
  console.log(`scrubbed site/${rel}: ${before === after ? 'no change' : 'updated'}`);
}

// 1b) leaderboard.json — scrub, then add an explicit SAMPLE-DATA disclaimer.
const lbPath = join(SITE, 'leaderboard.json');
const lb = JSON.parse(scrub(readFileSync(lbPath, 'utf8')));
lb.disclaimer =
  'SAMPLE DATA — placeholder reference agents with illustrative scores. The board populates with real, verified results as runs land.';
writeFileSync(lbPath, JSON.stringify(lb, null, 2) + '\n');
console.log('scrubbed site/leaderboard.json + added disclaimer');

// 2) Demo Academy registrar key (published so the certs are actually verifiable).
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
writeFileSync(join(SITE, 'academy-public-key.pem'), pubPem);
const KEY_ID = 'ota-registrar-demo-2026';

// Mirror cert.js computeCertHash exactly (integrity nulled, canonical, sha256).
function computeCertHash(cert) {
  const clone = structuredClone(cert);
  clone.integrity = { hashAlg: 'sha256', certHash: null, academySignature: null, academyKeyId: null };
  return sha256Hex(canonicalize(clone));
}

// 3) Certificates — scrub subject, then recompute hash + re-sign.
let ok = 0;
for (const f of readdirSync(CERTS).filter((x) => x.endsWith('.json'))) {
  const p = join(CERTS, f);
  const cert = JSON.parse(scrub(readFileSync(p, 'utf8')));
  cert.integrity = { hashAlg: 'sha256', certHash: '', academySignature: '' };
  cert.integrity.certHash = computeCertHash(cert);
  if (cert.attestation === 'certified') {
    cert.integrity.academySignature = cryptoSign(null, Buffer.from(cert.integrity.certHash, 'utf8'), privateKey).toString('base64');
    cert.integrity.academyKeyId = KEY_ID;
  } else {
    cert.integrity.academySignature = 'self-reported:unsigned';
  }
  writeFileSync(p, JSON.stringify(cert, null, 2) + '\n');
  const v = verifyCert(cert, pubPem);
  const good = v.hashMatch && v.signatureValid !== false;
  if (good) ok++;
  console.log(`  ${f}: ${cert.subject.contestant} · hash ${v.hashMatch ? 'ok' : 'BAD'} · sig ${v.signatureValid === null ? 'n/a' : v.signatureValid ? 'ok' : 'BAD'}`);
}
console.log(`\n${ok}/${readdirSync(CERTS).filter((x) => x.endsWith('.json')).length} certs verify. done.`);
