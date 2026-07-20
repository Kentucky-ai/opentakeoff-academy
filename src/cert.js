// src/cert.js
//
// Issues a verifiable certificate (schema/cert.schema.json) from a score
// report and renders an embeddable shields-style SVG badge.
//
// Trust model (PROTOCOL §4): only a *proctored* run can earn the trustworthy
// "certified" mark; a self_reported run yields a visually-distinct, lower-trust
// badge that is NOT signed by the Academy.
//
// Determinism: this module never calls Date.now()/new Date() at module scope.
// All timestamps come from opts.now (an ISO string or Date), and all ids are
// derived deterministically from the evidence hash (or opts.serial).

import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { canonicalize, sha256Hex } from './bundle.js';

const DEFAULT_ISSUER_URL = 'https://aec.kentucky-ai.com';
const DEFAULT_VALIDITY_DAYS = 365;

// Competency → single-letter code, and track → short code, for certId.
const COMPETENCY_CODE = {
  'scale-calibration': 'S',
  'fixture-count': 'C',
  'area-takeoff': 'A',
  'scope-identification': 'P',
  'general-takeoff': 'G',
};
const COMPETENCY_LABEL = {
  'scale-calibration': 'Scale Calibration',
  'fixture-count': 'Fixture Count',
  'area-takeoff': 'Area Takeoff',
  'scope-identification': 'Scope ID',
  'general-takeoff': 'General Takeoff',
};
const TIER_LABEL = { apprentice: 'Apprentice', journeyman: 'Journeyman', master: 'Master' };

/**
 * Issue a certificate from a score report.
 * @param {object} report - output of scoreBundle()
 * @param {object} opts
 * @param {'self_reported'|'certified'} opts.attestation
 * @param {string} opts.now - ISO-8601 timestamp for issuedAt (REQUIRED; not read from the clock)
 * @param {number} [opts.validityDays=365]
 * @param {string} [opts.modelId] - defaults from report/bundle if the caller passes it through
 * @param {string} [opts.contestant]
 * @param {string} [opts.harness]
 * @param {string} [opts.subjectUrl]
 * @param {string} [opts.competency] - override the report's competency
 * @param {'apprentice'|'journeyman'|'master'} [opts.tier] - override the report's tier
 * @param {number} [opts.serial] - certId serial (else derived from the bundle hash)
 * @param {string} [opts.issuerUrl]
 * @param {string} [opts.verifyUrl]
 * @param {string} [opts.leaderboardUrl]
 * @param {string} [opts.academyKeyPem] - ed25519 PEM; REQUIRED to mint a 'certified' cert
 * @param {string} [opts.academyKeyId='ota-root']
 * @returns {object} cert conforming to cert.schema.json
 */
export function issueCert(report, opts = {}) {
  if (!opts.now) throw new Error('issueCert requires opts.now (ISO-8601) — timestamps are never read from the system clock');
  const attestation = opts.attestation;
  if (attestation !== 'self_reported' && attestation !== 'certified') {
    throw new Error(`issueCert: opts.attestation must be 'self_reported' or 'certified' (got ${attestation})`);
  }

  // A certified mark can only come from a proctored run.
  if (attestation === 'certified' && report.attestation !== 'proctored') {
    throw new Error("issueCert: 'certified' requires a proctored run (bundle attestation.mode === 'proctored'); this report is " + report.attestation);
  }
  // The Academy signature is what makes a certified mark verifiable.
  if (attestation === 'certified' && !opts.academyKeyPem) {
    throw new Error("issueCert: 'certified' requires opts.academyKeyPem to sign the certificate");
  }

  const competency = opts.competency || report.competency || 'general-takeoff';
  const tier = opts.tier || report.suite?.tier;
  if (!tier) throw new Error('issueCert: no tier earned (run did not pass threshold) and none supplied via opts.tier');

  const track = report.generatedFor?.track || 'generalist';
  const bundleHash = report.generatedFor?.bundleHash;
  if (!bundleHash) throw new Error('issueCert: report is missing evidence bundleHash');

  const serial = typeof opts.serial === 'number' ? opts.serial : deriveSerial(bundleHash);
  const certId = makeCertId(track, competency, serial);

  const issuerUrl = opts.issuerUrl || DEFAULT_ISSUER_URL;
  const issuedAt = new Date(opts.now).toISOString();
  const validityDays = opts.validityDays || DEFAULT_VALIDITY_DAYS;
  const expiresAt = new Date(new Date(opts.now).getTime() + validityDays * 86400_000).toISOString();

  const message = `${COMPETENCY_LABEL[competency] || competency} · ${TIER_LABEL[tier] || tier}`;

  // Assemble everything except integrity, then hash + sign.
  const cert = {
    certVersion: '1.0',
    certId,
    issuer: { name: 'OpenTakeoff Academy', url: issuerUrl },
    subject: pruneUndefined({
      modelId: opts.modelId || report.subject?.modelId || 'unknown-model',
      contestant: opts.contestant,
      harness: opts.harness,
      url: opts.subjectUrl,
    }),
    track,
    competency,
    tier,
    attestation,
    result: pruneUndefined({
      metric: report.metric,
      score: report.suite?.median,
      baseline: report.suite?.baseline,
      nRanked: report.suite?.n,
      suiteVersion: report.generatedFor?.suiteVersion || 'unknown',
    }),
    issuedAt,
    expiresAt,
    evidence: pruneUndefined({
      runBundleHash: bundleHash,
      verifyUrl: opts.verifyUrl || `${issuerUrl}/cert/${certId}`,
      leaderboardUrl: opts.leaderboardUrl,
    }),
    badge: {
      label: 'OpenTakeoff Certified',
      message,
      color: attestation === 'certified' ? tierColor(tier) : '#9aa0a6',
    },
    integrity: { hashAlg: 'sha256', certHash: '', academySignature: '' },
  };

  cert.integrity.certHash = computeCertHash(cert);
  cert.integrity.academySignature = signCert(cert, attestation, opts);
  if (opts.academyKeyPem) cert.integrity.academyKeyId = opts.academyKeyId || 'ota-root';

  return cert;
}

/** Canonical pre-image hash for a cert: certHash + academySignature nulled. */
function computeCertHash(cert) {
  const clone = structuredClone(cert);
  clone.integrity = { hashAlg: 'sha256', certHash: null, academySignature: null, academyKeyId: null };
  return sha256Hex(canonicalize(clone));
}

/** Sign certHash with the Academy key for 'certified'; sentinel for 'self_reported'. */
function signCert(cert, attestation, opts) {
  if (attestation === 'self_reported') return 'self-reported:unsigned';
  const priv = createPrivateKey(opts.academyKeyPem);
  return cryptoSign(null, Buffer.from(cert.integrity.certHash, 'utf8'), priv).toString('base64');
}

/** Deterministic 4-digit serial from the evidence hash (no randomness). */
function deriveSerial(bundleHash) {
  const n = parseInt(bundleHash.slice(0, 8), 16) % 10000;
  return n;
}

/** certId like OTA-D9A-0047 (track code + competency letter + zero-padded serial). */
function makeCertId(track, competency, serial) {
  const tc = trackCode(track);
  const cc = COMPETENCY_CODE[competency] || 'G';
  let code = `${tc}${cc}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 2) code = (code + 'XX').slice(0, 2);
  if (code.length > 6) code = code.slice(0, 6);
  const ser = String(Math.max(0, Math.min(serial, 999999))).padStart(4, '0');
  return `OTA-${code}-${ser}`;
}

/** Compact track code: 'div9'→'D9', 'generalist'→'GEN', else first alnum chars. */
function trackCode(track) {
  const t = String(track || '').toLowerCase();
  if (t === 'generalist') return 'GEN';
  const m = t.match(/^([a-z]+)(\d+)?/);
  if (m) {
    const letters = (m[1] || '').slice(0, 3).toUpperCase();
    return (m[2] ? letters.slice(0, 1) + m[2] : letters).slice(0, 4);
  }
  return t.replace(/[^a-z0-9]/g, '').slice(0, 4).toUpperCase() || 'GEN';
}

function tierColor(tier) {
  return { apprentice: '#3f83f8', journeyman: '#8b5cf6', master: '#2ea44f' }[tier] || '#2ea44f';
}

function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Render a self-contained, shields-style SVG badge for a cert.
 * Certified marks are solid and colored with a ✓; self_reported marks are
 * muted/hatched and labeled "self-reported" so the two are visually distinct.
 * @param {object} cert
 * @returns {string} SVG markup
 */
export function renderBadgeSvg(cert) {
  const certified = cert.attestation === 'certified';
  const label = cert.badge?.label || 'OpenTakeoff Certified';
  const message = cert.badge?.message || `${cert.competency} · ${cert.tier}`;
  const rightColor = certified ? (cert.badge?.color || tierColor(cert.tier)) : '#6b7280';
  const leftColor = '#334155';

  // Rough text metrics (shields uses ~7px/char at 11px Verdana).
  const mark = certified ? '✓ ' : '⚠ ';
  const leftText = label;
  const rightText = mark + message;
  const pad = 10;
  const charW = 6.7;
  const leftW = Math.ceil(leftText.length * charW) + pad * 2;
  const rightW = Math.ceil(rightText.length * charW) + pad * 2;
  const total = leftW + rightW;
  const h = 20;

  // A subtle diagonal hatch pattern marks self-reported badges.
  const hatch = certified ? '' : `
    <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="${rightColor}"/>
      <line x1="0" y1="0" x2="0" y2="6" stroke="#4b5563" stroke-width="2"/>
    </pattern>`;
  const rightFill = certified ? rightColor : 'url(#hatch)';

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${h}" role="img" aria-label="${esc(leftText)}: ${esc(rightText)}">
  <title>${esc(leftText)}: ${esc(rightText)}</title>
  <defs>
    <linearGradient id="s" x2="0" y2="100%">
      <stop offset="0" stop-color="#fff" stop-opacity=".12"/>
      <stop offset="1" stop-opacity=".12"/>
    </linearGradient>${hatch}
  </defs>
  <clipPath id="r"><rect width="${total}" height="${h}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftW}" height="${h}" fill="${leftColor}"/>
    <rect x="${leftW}" width="${rightW}" height="${h}" fill="${rightFill}"/>
    <rect width="${total}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${leftW / 2}" y="15" fill="#000" fill-opacity=".3">${esc(leftText)}</text>
    <text x="${leftW / 2}" y="14">${esc(leftText)}</text>
    <text x="${leftW + rightW / 2}" y="15" fill="#000" fill-opacity=".3">${esc(rightText)}</text>
    <text x="${leftW + rightW / 2}" y="14">${esc(rightText)}</text>
  </g>
</svg>`;
}

/** Verify a cert's hash (and, when a key is provided, its Academy signature). */
export function verifyCert(cert, academyPublicKeyPem) {
  const expected = computeCertHash(cert);
  const hashMatch = expected === cert?.integrity?.certHash;
  let signatureValid = null;
  if (cert.attestation === 'certified' && academyPublicKeyPem && cert.integrity?.academySignature) {
    try {
      const pub = createPublicKey(academyPublicKeyPem);
      signatureValid = cryptoVerify(null, Buffer.from(cert.integrity.certHash, 'utf8'), pub, Buffer.from(cert.integrity.academySignature, 'base64'));
    } catch { signatureValid = false; }
  }
  return { ok: hashMatch && signatureValid !== false, hashMatch, signatureValid, expectedHash: expected };
}
