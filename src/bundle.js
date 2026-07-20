// src/bundle.js
//
// Tamper-evidence for run-bundles: canonical JSON, sha256 hashing, and
// optional ed25519 signing — all with node:crypto, no external deps.
//
// The contract (schema/run-bundle.schema.json):
//   integrity.bundleHash = sha256 of the *canonicalized* bundle with the
//   integrity block's signature fields nulled. A signature (optional) binds
//   the bundle to the entrant's key; proctored runs are additionally
//   co-signed by the Academy (academySignature).
//
// Everything here is deterministic: no Date.now(), no Math.random().

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Deterministic, stable-sorted JSON serialization.
 * Object keys are sorted recursively; arrays keep their order; `undefined`
 * values are dropped; `null` is preserved (it is meaningful for hashing).
 * @param {*} value
 * @returns {string} canonical JSON
 */
export function canonicalize(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const v = value[key];
    if (v === undefined) continue; // JSON has no undefined
    out[key] = sortValue(v);
  }
  return out;
}

/**
 * sha256 of a UTF-8 string, hex-encoded.
 * @param {string} str
 * @returns {string} 64-char lowercase hex
 */
export function sha256Hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * sha256 of a file's raw bytes, hex-encoded. Used to bind a run to the exact
 * planset asset it measured (see the assetHash provenance check).
 * @param {string} path
 * @returns {string} 64-char lowercase hex
 */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Fields inside integrity that are excluded from the hash pre-image.
const INTEGRITY_HASH_NULLS = { hashAlg: 'sha256', bundleHash: null, signature: null, publicKey: null, academySignature: null };

/**
 * Produce the canonical pre-image string that bundleHash is computed over:
 * the whole bundle with integrity's hash/signature fields nulled.
 * @param {object} bundle
 * @returns {string}
 */
function hashPreimage(bundle) {
  const clone = structuredClone(bundle);
  clone.integrity = { ...INTEGRITY_HASH_NULLS };
  return canonicalize(clone);
}

/**
 * Compute integrity.bundleHash for a bundle (does not mutate).
 * @param {object} bundle
 * @returns {string} 64-char hex
 */
export function computeBundleHash(bundle) {
  return sha256Hex(hashPreimage(bundle));
}

/**
 * Assemble a run-bundle from its parts and stamp integrity.bundleHash.
 * Signature fields are left off until signBundle() is called (unsigned
 * bundles are valid — they carry only the hash).
 * @param {object} parts - everything except `integrity`
 * @returns {object} a complete, hashed bundle
 */
export function buildBundle(parts) {
  const bundle = {
    bundleVersion: '1.0',
    ...parts,
    integrity: { hashAlg: 'sha256', bundleHash: '' },
  };
  bundle.integrity.bundleHash = computeBundleHash(bundle);
  return bundle;
}

/**
 * Sign a bundle with an entrant ed25519 private key (PEM). Sets
 * integrity.signature (base64) over the bundleHash and integrity.publicKey
 * (SPKI PEM). If no key is supplied the bundle is returned hash-only.
 * @param {object} bundle
 * @param {string} [privateKeyPem] - PKCS#8 PEM of an ed25519 private key
 * @returns {object} bundle (a copy) with signature fields set when a key is given
 */
export function signBundle(bundle, privateKeyPem) {
  const out = structuredClone(bundle);
  // Always (re)derive the hash so a caller-mutated bundle stays consistent.
  out.integrity.bundleHash = computeBundleHash(out);
  if (!privateKeyPem) return out;

  const priv = createPrivateKey(privateKeyPem);
  const pub = createPublicKey(priv);
  const sig = cryptoSign(null, Buffer.from(out.integrity.bundleHash, 'utf8'), priv);
  out.integrity.signature = sig.toString('base64');
  out.integrity.publicKey = pub.export({ type: 'spki', format: 'pem' }).toString();
  return out;
}

/**
 * Co-sign a bundle's hash with the Academy key (for proctored runs).
 * @param {object} bundle
 * @param {string} academyKeyPem - ed25519 private key PEM
 * @returns {object} bundle (a copy) with integrity.academySignature set
 */
export function academyCosign(bundle, academyKeyPem) {
  const out = structuredClone(bundle);
  out.integrity.bundleHash = computeBundleHash(out);
  const priv = createPrivateKey(academyKeyPem);
  const sig = cryptoSign(null, Buffer.from(out.integrity.bundleHash, 'utf8'), priv);
  out.integrity.academySignature = sig.toString('base64');
  return out;
}

/**
 * Verify a bundle's hash and (if present) its signature(s).
 * @param {object} bundle
 * @returns {{hashMatch: boolean, expectedHash: string, signatureValid: (boolean|null), academySignatureValid: (boolean|null), ok: boolean, reason?: string}}
 */
export function verifyBundle(bundle) {
  const expectedHash = computeBundleHash(bundle);
  const hashMatch = expectedHash === bundle?.integrity?.bundleHash;

  let signatureValid = null;
  if (bundle?.integrity?.signature && bundle?.integrity?.publicKey) {
    try {
      const pub = createPublicKey(bundle.integrity.publicKey);
      signatureValid = cryptoVerify(
        null,
        Buffer.from(bundle.integrity.bundleHash, 'utf8'),
        pub,
        Buffer.from(bundle.integrity.signature, 'base64'),
      );
    } catch {
      signatureValid = false;
    }
  }

  // academySignature verification needs the Academy public key out-of-band,
  // so we only report its presence here; the registry checks the signature.
  const academySignatureValid = bundle?.integrity?.academySignature ? null : null;

  const ok = hashMatch && signatureValid !== false;
  return {
    ok,
    hashMatch,
    expectedHash,
    signatureValid,
    academySignatureValid,
    reason: hashMatch ? (signatureValid === false ? 'signature-invalid' : undefined) : 'hash-mismatch',
  };
}

/**
 * Generate an ephemeral ed25519 keypair as PEM strings. Handy for tests and
 * for entrants who want to sign a self-reported bundle.
 * @returns {{privateKeyPem: string, publicKeyPem: string}}
 */
export function generateKeypairPem() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/**
 * Convenience: a non-time-derived run id, e.g. "run_1b2c...". Matches the
 * run-bundle pattern ^run_[A-Za-z0-9._-]{6,}$.
 * @returns {string}
 */
export function newRunId() {
  return `run_${randomUUID()}`;
}
