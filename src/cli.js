#!/usr/bin/env node
// src/cli.js
//
// OpenTakeoff Academy conformance CLI. Every subcommand exits non-zero on
// failure so CI can gate. Contract:
//
//   opentakeoff-academy run   --track <t> --suite <practice|ranked|id> --endpoint <url> [--model <m>] [--mcp <file>] --out <bundle.json>
//   opentakeoff-academy score <bundle.json> --track <t> --suite <id> [--tasks <dir>] [--out <report.json>]
//   opentakeoff-academy cert  <report.json> --attestation <self_reported|certified> --out <cert.json>
//   opentakeoff-academy validate <bundle.json>
//   opentakeoff-academy badge <cert.json> --out <badge.svg>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  runSuite, loadTasks, scoreBundle, formatReport, validateBundle, verifyBundle,
  issueCert, renderBadgeSvg,
} from './index.js';

main().catch((err) => { fail(err?.message || String(err)); process.exit(1); });

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const { positionals, flags } = parseArgs(argv.slice(1));

  switch (cmd) {
    case 'run':      return cmdRun(flags);
    case 'score':    return cmdScore(positionals[0], flags);
    case 'cert':     return cmdCert(positionals[0], flags);
    case 'validate': return cmdValidate(positionals[0]);
    case 'badge':    return cmdBadge(positionals[0], flags);
    case 'help': case '--help': case '-h': case undefined:
      return usage(0);
    default:
      return fail(`unknown command: ${cmd}\n`), usage(1);
  }
}

// --- run --------------------------------------------------------------------
async function cmdRun(flags) {
  requireFlags(flags, ['track', 'suite', 'endpoint', 'out']);

  const mcpDescriptor = flags.mcp ? JSON.parse(readFileSync(flags.mcp, 'utf8')) : undefined;
  const privateKeyPem = flags.key ? readFileSync(flags.key, 'utf8') : undefined;

  const bundle = await runSuite({
    track: flags.track,
    suite: flags.suite,
    endpoint: flags.endpoint,
    model: flags.model,
    mcpDescriptor,
    tasksDir: flags.tasks || './tasks',
    contestant: {
      name: flags.name,
      modelId: flags['model-id'] || flags.model,
      harness: flags.harness,
      adapter: flags.adapter,
      contact: flags.contact,
    },
    attestationMode: flags.attestation === 'proctored' ? 'proctored' : 'self_reported',
    mode: flags.mode,
    now: nowIso(flags),
    privateKeyPem,
    log: (m) => process.stderr.write(`[run] ${m}\n`),
  });

  writeJson(flags.out, bundle);
  const v = validateBundle(bundle);
  process.stdout.write(`run complete: ${bundle.tasks.length} task(s) → ${flags.out}\n`);
  process.stdout.write(`  runId ${bundle.runId}\n  bundleHash ${bundle.integrity.bundleHash}\n  schema-valid: ${v.valid}\n`);
  if (!v.valid) { printAjvErrors(v.errors); process.exit(1); }
}

// --- score ------------------------------------------------------------------
function cmdScore(bundlePath, flags) {
  if (!bundlePath) return fail('score requires a <bundle.json> path'), process.exit(1);
  requireFlags(flags, ['track', 'suite']);

  const bundle = readJson(bundlePath);

  // Validate the bundle first; exit non-zero if invalid.
  const v = validateBundle(bundle);
  if (!v.valid) { fail(`bundle is not schema-valid (${bundlePath})`); printAjvErrors(v.errors); process.exit(2); }

  const tasksDir = flags.tasks || './tasks';
  const tasks = loadTasks(tasksDir, flags.track, flags.suite);

  // If the suite ships a suite.json with published thresholds/baselines, use
  // them for the dominant competency (canonical bar = the journeyman value).
  // Explicit --threshold/--baseline flags always win. This bridges the runner
  // to real suites without coupling the pure scorer to the manifest shape.
  const suiteCfg = readSuiteConfig(tasksDir, flags.track, flags.suite, tasks);
  const report = scoreBundle(bundle, tasks, {
    threshold: numFlag(flags.threshold) ?? suiteCfg.threshold,
    baseline: numFlag(flags.baseline) ?? suiteCfg.baseline,
    consistencyWindows: numFlag(flags['consistency-windows']) || 0,
  });

  process.stdout.write(formatReport(report) + '\n');
  if (flags.out) { writeJson(flags.out, report); process.stdout.write(`\nreport → ${flags.out}\n`); }

  // Gate for CI unless --report-only. Fail on: invalid integrity, provenance
  // flags, or a suite that did not clear the threshold.
  const hasCheatFlags = report.flags.length > 0;
  const gate = !flags['report-only'];
  if (gate && (!report.integrity.valid || !report.suite.passed || hasCheatFlags)) {
    process.stderr.write(`\nGATE: ${!report.integrity.valid ? 'integrity-invalid ' : ''}${!report.suite.passed ? 'threshold-not-met ' : ''}${hasCheatFlags ? 'provenance-flags' : ''}\n`);
    process.exit(1);
  }
}

// --- cert -------------------------------------------------------------------
function cmdCert(reportPath, flags) {
  if (!reportPath) return fail('cert requires a <report.json> path'), process.exit(1);
  requireFlags(flags, ['attestation', 'out']);

  const report = readJson(reportPath);
  const academyKeyPem = flags['academy-key'] ? readFileSync(flags['academy-key'], 'utf8') : undefined;

  const cert = issueCert(report, {
    attestation: flags.attestation,
    now: nowIso(flags),
    validityDays: numFlag(flags['validity-days']),
    modelId: flags['model-id'],
    contestant: flags.contestant,
    harness: flags.harness,
    subjectUrl: flags['subject-url'],
    competency: flags.competency,
    tier: flags.tier,
    serial: numFlag(flags.serial),
    issuerUrl: flags['issuer-url'],
    verifyUrl: flags['verify-url'],
    leaderboardUrl: flags['leaderboard-url'],
    academyKeyPem,
    academyKeyId: flags['academy-key-id'],
  });

  writeJson(flags.out, cert);
  process.stdout.write(`issued ${cert.certId} — ${cert.competency} · ${cert.tier} (${cert.attestation}) → ${flags.out}\n`);
  process.stdout.write(`  certHash ${cert.integrity.certHash}\n  verify ${cert.evidence.verifyUrl}\n`);
}

// --- validate ---------------------------------------------------------------
function cmdValidate(bundlePath) {
  if (!bundlePath) return fail('validate requires a <bundle.json> path'), process.exit(1);
  const bundle = readJson(bundlePath);

  // (1) schema conformance
  const v = validateBundle(bundle);
  if (!v.valid) { fail(`INVALID (schema) ✗ ${bundlePath}`); printAjvErrors(v.errors); process.exit(1); }

  // (2) integrity: recompute the hash (and verify any signature). A bundle
  // that is schema-valid but whose stored hash no longer matches its content
  // has been tampered with — fail so CI can gate.
  const iv = verifyBundle(bundle);
  if (!iv.hashMatch) { fail(`INVALID (integrity) ✗ ${bundlePath} — bundleHash does not match content (expected ${iv.expectedHash})`); process.exit(1); }
  if (iv.signatureValid === false) { fail(`INVALID (signature) ✗ ${bundlePath} — entrant signature does not verify`); process.exit(1); }

  const sig = iv.signatureValid === true ? ' · signature ok' : '';
  process.stdout.write(`valid ✓ ${bundlePath} (schema ok · hash ok${sig})\n`);
}

// --- badge ------------------------------------------------------------------
function cmdBadge(certPath, flags) {
  if (!certPath) return fail('badge requires a <cert.json> path'), process.exit(1);
  requireFlags(flags, ['out']);
  const cert = readJson(certPath);
  const svg = renderBadgeSvg(cert);
  writeFileSync(flags.out, svg);
  process.stdout.write(`badge → ${flags.out} (${cert.attestation})\n`);
}

// --- helpers ----------------------------------------------------------------
function parseArgs(args) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) { flags[key] = true; }
      else { flags[key] = next; i++; }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function requireFlags(flags, names) {
  const missing = names.filter((n) => flags[n] === undefined);
  if (missing.length) { fail(`missing required flag(s): ${missing.map((m) => '--' + m).join(', ')}`); process.exit(1); }
}

function nowIso(flags) {
  // Prefer an explicit --now for reproducibility; else stamp at runtime.
  return flags.now || new Date().toISOString();
}

/**
 * Best-effort read of a suite manifest (tasks/<track>/<suite>/suite.json) to
 * pull the published threshold + baseline for the suite's dominant competency.
 * Fully defensive: returns {} if the file is absent or shaped unexpectedly, so
 * the scorer falls back to its built-in defaults.
 */
function readSuiteConfig(tasksDir, track, suite, tasks) {
  try {
    const raw = readFileSync(`${tasksDir}/${track}/${suite}/suite.json`, 'utf8');
    const man = JSON.parse(raw);
    // Dominant competency = the most common `kind` among the loaded tasks.
    const counts = {};
    for (const t of tasks) if (t.kind) counts[t.kind] = (counts[t.kind] || 0) + 1;
    const competency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!competency) return {};
    const th = man.thresholds?.[competency];
    const bl = man.baseline?.[competency];
    // Canonical published bar = the journeyman threshold when numeric.
    const threshold = typeof th?.journeyman === 'number' ? th.journeyman
      : typeof th?.apprentice === 'number' ? th.apprentice : undefined;
    const baseline = typeof bl?.score === 'number' ? bl.score : undefined;
    return { threshold, baseline, competency };
  } catch {
    return {};
  }
}

function numFlag(v) { return v === undefined ? undefined : Number(v); }

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { fail(`cannot read/parse ${p}: ${e.message}`); process.exit(1); }
}

function writeJson(p, obj) {
  mkdirSync(dirname(p) || '.', { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function printAjvErrors(errors) {
  for (const e of errors || []) process.stderr.write(`  ✗ ${e.instancePath || '(root)'} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}\n`);
}

function fail(msg) { process.stderr.write(`error: ${msg}\n`); }

function usage(code = 0) {
  process.stdout.write(`OpenTakeoff Academy — conformance CLI

Usage:
  opentakeoff-academy run   --track <t> --suite <practice|ranked|id> --endpoint <url> [--model <m>] [--mcp <file>] --out <bundle.json>
                            [--tasks <dir>] [--name <h>] [--model-id <id>] [--adapter <a>] [--contact <url>] [--key <pem>]
  opentakeoff-academy score <bundle.json> --track <t> --suite <id> [--tasks <dir>] [--out <report.json>]
                            [--threshold <n>] [--baseline <n>] [--report-only]
  opentakeoff-academy cert  <report.json> --attestation <self_reported|certified> --out <cert.json>
                            [--academy-key <pem>] [--now <iso>] [--serial <n>] [--verify-url <url>] [--model-id <id>]
  opentakeoff-academy validate <bundle.json>
  opentakeoff-academy badge <cert.json> --out <badge.svg>

Docs: PROTOCOL.md · schema/*.schema.json
`);
  process.exit(code);
}
