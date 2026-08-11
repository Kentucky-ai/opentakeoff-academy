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
//   opentakeoff-academy verify   <cert.json> [--key <pem-path-or-url>]
//   opentakeoff-academy badge <cert.json> --out <badge.svg>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runSuite, loadTasks, scoreBundle, formatReport, validateBundle, verifyBundle,
  issueCert, renderBadgeSvg, verifyCert, applyGroundTruth, hasGroundTruth,
} from './index.js';
import { createSession } from './env-session.js';
import { serveSession } from './env-serve.js';
import { ensureDocker, imageFingerprint, runSealedSuite } from './container.js';

/** Published Academy signing key — the default trust anchor for `verify`. */
const ACADEMY_KEY_URL = 'https://aec.kentucky-ai.com/academy-public-key.pem';

main().catch((err) => { fail(err?.message || String(err)); process.exit(1); });

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const { positionals, flags } = parseArgs(argv.slice(1));

  switch (cmd) {
    case 'run':      return cmdRun(flags);
    case 'serve':    return cmdServe(flags);
    case 'proctor':  return cmdProctor(flags);
    case 'score':    return cmdScore(positionals[0], flags);
    case 'cert':     return cmdCert(positionals[0], flags);
    case 'validate': return cmdValidate(positionals[0]);
    case 'verify':   return cmdVerify(positionals[0], flags);
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

// --- serve ------------------------------------------------------------------
// Host the environment API for a REMOTE-ENV entrant: their harness, wherever it
// runs, drives our tools over HTTP while we record the trace. Blocks until the
// suite completes (or Ctrl-C → finalize what happened).
async function cmdServe(flags) {
  requireFlags(flags, ['track', 'suite', 'out']);
  const { session } = buildSessionFromFlags(flags, flags.adapter === 'container' ? 'container' : 'remote-env', pruneEmpty({ endpointFingerprint: flags['endpoint-fingerprint'] }));

  const handle = await serveSession({
    session,
    port: flags.port ? Number(flags.port) : 0,
    host: flags.host || '127.0.0.1',
    token: flags.token,
    log: (m) => process.stderr.write(`[serve] ${m}\n`),
    onComplete: (bundle) => {
      writeJson(flags.out, bundle);
      const v = validateBundle(bundle);
      process.stdout.write(`run complete: ${bundle.tasks.length} task(s) → ${flags.out}\n  runId ${bundle.runId}\n  bundleHash ${bundle.integrity.bundleHash}\n  schema-valid: ${v.valid}\n`);
    },
  });

  process.stdout.write(`environment API: ${handle.url}/v1\n`);
  process.stdout.write(`session token:   ${handle.token}\n`);
  process.stdout.write(`hand both to the entrant; they drive, we record. Ctrl-C finalizes a partial run.\n`);

  await new Promise((resolve) => {
    const finish = () => resolve();
    const iv = setInterval(() => { if (session.complete) { clearInterval(iv); finish(); } }, 500);
    process.once('SIGINT', () => { clearInterval(iv); handle.complete(); finish(); });
  });
  await handle.close();
}

// --- proctor ----------------------------------------------------------------
// Run a sealed entrant image against the environment API on a fully internal
// Docker network (academy sidecar + entrant, nothing else reachable). The
// image sees ONLY the Academy endpoint; the sidecar records everything and the
// bundle is bound to the exact image ID.
async function cmdProctor(flags) {
  requireFlags(flags, ['track', 'suite', 'image', 'out']);
  await ensureDocker();
  const { fingerprint, imageId } = await imageFingerprint(flags.image);
  const log = (m) => process.stderr.write(`[proctor] ${m}\n`);
  log(`image ${flags.image} → ${imageId.slice(0, 19)}… (fingerprint ${fingerprint.slice(0, 12)}…)`);

  const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const tasks = loadTasks(flags.tasks || './tasks', flags.track, flags.suite);
  const suiteWallMs = tasks.reduce((a, t) => a + (t.budget?.maxWallMs ?? 180000), 0) + 60000;

  const serveArgs = [];
  for (const f of ['name', 'model-id', 'harness', 'contact', 'engine', 'attestation']) {
    if (flags[f]) serveArgs.push(`--${f}`, String(flags[f]));
  }

  const outcome = await runSealedSuite({
    image: flags.image,
    repoDir,
    outDir: dirname(resolve(flags.out)) || '.',
    track: flags.track,
    suite: flags.suite,
    fingerprint,
    maxWallMs: numFlag(flags['max-wall-ms']) || suiteWallMs,
    limits: { memory: flags.memory || '4g', cpus: flags.cpus || '2', pids: numFlag(flags.pids) || 512 },
    serveArgs,
    log,
  });

  process.stdout.write(`proctored run: ${outcome.reason}${outcome.killed ? ' (entrant killed)' : ''} · entrant exit ${outcome.exitCode ?? '—'}\n`);
  if (!outcome.bundleFile) {
    fail('no bundle was produced — the entrant never reached the environment (see the sidecar/entrant logs above)');
    process.exit(1);
  }

  const bundle = readJson(outcome.bundleFile);
  writeJson(flags.out, bundle);
  const v = validateBundle(bundle);
  process.stdout.write(`  ${bundle.tasks.length} task(s) → ${flags.out}\n  runId ${bundle.runId}\n  bundleHash ${bundle.integrity.bundleHash}\n  imageFingerprint ${fingerprint}\n  schema-valid: ${v.valid}\n`);
  if (!v.valid) {
    printAjvErrors(v.errors);
    if (bundle.tasks.length === 0) fail('the entrant connected but finished no task — nothing to score');
    process.exit(1);
  }
}

/** Shared session construction for serve/proctor. */
function buildSessionFromFlags(flags, adapter, proctorExtra = {}) {
  const tasksDir = flags.tasks || './tasks';
  const tasks = loadTasks(tasksDir, flags.track, flags.suite);
  const academyKeyPem = flags['academy-key'] ? readFileSync(flags['academy-key'], 'utf8') : undefined;
  const session = createSession({
    track: flags.track,
    suite: flags.suite,
    tasks,
    contestant: {
      name: flags.name,
      modelId: flags['model-id'],
      harness: flags.harness,
      adapter,
      contact: flags.contact,
    },
    attestationMode: flags.attestation === 'self_reported' ? 'self_reported' : 'proctored',
    proctor: pruneEmpty(proctorExtra),
    engine: flags.engine,
    mcpDir: flags['mcp-dir'],
    now: nowIso(flags),
    academyKeyPem,
    log: (m) => process.stderr.write(`[session] ${m}\n`),
  });
  return { session, tasks };
}

function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out;
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

  // Inject held-out ground truth for RANKED scoring. Ranked task files carry
  // `groundTruth: null` — the keys are never committed (PROTOCOL §5). They are
  // materialized out-of-tree and pointed to by --groundtruth or the
  // OTA_GROUNDTRUTH_DIR env var (see .github/workflows/score-submission.yml).
  // Practice tasks keep their embedded keys and are left untouched.
  const gtDir = flags.groundtruth || process.env.OTA_GROUNDTRUTH_DIR;
  const gt = applyGroundTruth(tasks, gtDir, { log: (m) => process.stderr.write(`[score] ${m}\n`) });
  if (gt.applied.length) process.stderr.write(`[score] injected held-out ground truth for ${gt.applied.length} task(s): ${gt.applied.join(', ')}\n`);

  // Fail CLOSED: a ranked bundle scored against tasks with no available key would
  // silently produce an empty (0-task) result and read as a non-pass. Say why
  // instead of scoring a phantom run.
  const isRanked = bundle.suite?.mode === 'ranked';
  const scoredTaskIds = new Set(bundle.tasks.map((t) => t.taskId));
  const unkeyed = tasks.filter((t) => scoredTaskIds.has(t.taskId) && !hasGroundTruth(t)).map((t) => t.taskId);
  if (isRanked && unkeyed.length && !flags['report-only']) {
    fail(`ranked scoring requires ground truth for every scored task; missing key(s) for: ${unkeyed.join(', ')}. `
      + `Set --groundtruth <dir> or OTA_GROUNDTRUTH_DIR to the held-out keys (they are never committed).`);
    process.exit(1);
  }

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

// --- verify -----------------------------------------------------------------
// Third-party check of a published credential: recompute certHash from the
// record itself, then verify the Academy's signature over it against the
// published Academy key. This is the command the cert page points at — anyone
// holding a cert.json can run it without trusting the site that served it.
async function cmdVerify(certPath, flags) {
  if (!certPath) return fail('verify requires a <cert.json> path'), process.exit(1);
  const cert = readJson(certPath);
  const keyRef = flags.key || ACADEMY_KEY_URL;

  let pem = null;
  try {
    pem = /^https?:\/\//.test(keyRef) ? await fetchText(keyRef) : readFileSync(keyRef, 'utf8');
  } catch (err) {
    // A missing key is only fatal for a certified cert — say so, don't guess.
    if (cert.attestation === 'certified') {
      fail(`cannot read Academy key from ${keyRef} — ${err?.message || err}`);
      process.exit(1);
    }
  }

  const v = verifyCert(cert, pem);
  if (!v.hashMatch) {
    fail(`INVALID (tampered) ✗ ${certPath} — certHash does not match the record (expected ${v.expectedHash})`);
    process.exit(1);
  }
  if (v.signatureValid === false) {
    fail(`INVALID (signature) ✗ ${certPath} — not signed by the Academy key at ${keyRef}`);
    process.exit(1);
  }

  const id = cert.certId || '(no id)';
  if (cert.attestation === 'certified') {
    process.stdout.write(`verified ✓ ${id} — certified · hash ok · Academy signature ok (key ${cert.integrity?.academyKeyId || '—'})\n`);
  } else {
    process.stdout.write(`verified ✓ ${id} — self-reported · hash ok · NO Academy signature (entrant-run, self-attested)\n`);
  }
}

/** Fetch a text resource (the published Academy key) with a bounded timeout. */
async function fetchText(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
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
  opentakeoff-academy serve --track <t> --suite <id> --out <bundle.json> [--port <n>] [--host <ip>] [--token <t>]
                            [--academy-key <pem>] [--attestation self_reported] [--engine opentakeoff]
                            (host the environment API; the entrant's harness drives, the Academy records — docs/ENVIRONMENT-API.md)
  opentakeoff-academy proctor --track <t> --suite <id> --image <docker-image> --out <bundle.json>
                            [--memory 4g] [--cpus 2] [--pids 512] [--max-wall-ms <n>] [--academy-key <pem>]
                            (run a sealed entrant container on a no-egress network — docs/CONTAINER-RUNNER.md)
  opentakeoff-academy score <bundle.json> --track <t> --suite <id> [--tasks <dir>] [--out <report.json>]
                            [--threshold <n>] [--baseline <n>] [--groundtruth <dir>] [--report-only]
                            (ranked keys: --groundtruth <dir> or env OTA_GROUNDTRUTH_DIR; never committed)
  opentakeoff-academy cert  <report.json> --attestation <self_reported|certified> --out <cert.json>
                            [--academy-key <pem>] [--now <iso>] [--serial <n>] [--verify-url <url>] [--model-id <id>]
  opentakeoff-academy validate <bundle.json>
  opentakeoff-academy verify   <cert.json> [--key <pem-path-or-url>]
                            (defaults to the published Academy key)
  opentakeoff-academy badge <cert.json> --out <badge.svg>

Docs: PROTOCOL.md · schema/*.schema.json
`);
  process.exit(code);
}
