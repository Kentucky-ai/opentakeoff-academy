// src/container.js
//
// The sealed-container proctor: run an entrant's Docker image against the
// Academy environment API with NOTHING else reachable. The contract
// (docs/CONTAINER-RUNNER.md) is deliberately one-sided — the Academy supplies
// the endpoint and records provenance; the image keeps its model, parser,
// prompts, and harness sealed inside. Neutrality is structural: every image
// gets the same tasks, the same tools, the same budgets, the same locked-down
// runtime.
//
// Topology (per run): a Docker `--internal` network — kernel-level, no
// external connectivity at all — carrying exactly two containers:
//
//   ota-academy-<tag>   node:20-alpine over a read-only mount of this repo,
//                       running `opentakeoff-academy serve` on :8080, writing
//                       the bundle to a mounted output dir. Alias:
//                       academy.internal.
//   ota-entrant-<tag>   the entrant's sealed image: --read-only rootfs,
//                       --cap-drop ALL, no-new-privileges, pids/mem/cpu caps.
//
// A host-gateway route would need NAT, which is exactly what an isolated
// network forbids — the sidecar shape works identically on Linux and
// Docker Desktop, and the entrant's only reachable service is the sidecar.
//
// The run is bound to the exact image: endpointFingerprint = sha256 of the
// resolved image ID, recorded in the bundle's attestation block.

import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const execFile = promisify(execFileCb);

// Docker Desktop on macOS installs outside the default non-login PATH.
const ENV_PATH = { ...process.env, PATH: `${process.env.PATH || ''}:/usr/local/bin:/opt/homebrew/bin` };

const docker = (args, opts = {}) => execFile('docker', args, { env: ENV_PATH, maxBuffer: 16 * 1024 * 1024, ...opts });

const ACADEMY_PORT = 8080;
export const ACADEMY_IMAGE = 'node:20-alpine';

/** Throw a readable error when the docker CLI is unavailable. */
export async function ensureDocker() {
  try { await docker(['version', '--format', '{{.Server.Version}}']); }
  catch (e) { throw new Error(`docker is not available (${e?.code || e?.message}) — the container path needs a running Docker daemon`); }
}

/** Resolve an image to its content-addressed ID and fingerprint it. */
export async function imageFingerprint(image) {
  const { stdout } = await docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  const imageId = stdout.trim();
  if (!imageId) throw new Error(`cannot resolve image '${image}' — is it built/pulled?`);
  return { imageId, fingerprint: createHash('sha256').update(imageId, 'utf8').digest('hex') };
}

/**
 * Run a full sealed proctored suite: academy sidecar + entrant image on an
 * internal network, until the bundle lands, the entrant exits, or the wall
 * budget lapses.
 *
 * @param {object} opts
 * @param {string} opts.image - entrant image
 * @param {string} opts.repoDir - academy repo root (mounted read-only into the sidecar)
 * @param {string} opts.outDir - host dir the sidecar writes the bundle into
 * @param {string} opts.track
 * @param {string} opts.suite
 * @param {string} opts.fingerprint - entrant image fingerprint (into attestation)
 * @param {number} opts.maxWallMs - suite-level kill budget
 * @param {object} [opts.limits] - { memory='4g', cpus='2', pids=512 }
 * @param {Array<string>} [opts.serveArgs] - extra flags for the sidecar serve (e.g. --academy-key)
 * @param {function} [opts.log]
 * @returns {Promise<{bundleFile: string|null, exitCode: number|null, killed: boolean, reason: string}>}
 */
export async function runSealedSuite(opts) {
  const log = opts.log || (() => {});
  const tag = randomBytes(4).toString('hex');
  const netName = `ota-proctor-${tag}`;
  const academyName = `ota-academy-${tag}`;
  const entrantName = `ota-entrant-${tag}`;
  const token = randomBytes(24).toString('base64url');
  const limits = { memory: '4g', cpus: '2', pids: 512, ...(opts.limits || {}) };

  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });
  const bundleName = `proctor-${tag}.bundle.json`;
  const bundleHostPath = `${outDir}/${bundleName}`;

  // Fully isolated network: no gateway to anywhere, host included.
  await docker(['network', 'create', '--internal', netName]);
  log(`network ${netName} created (--internal: no external connectivity)`);

  let entrant = null;
  try {
    // --- academy sidecar ---------------------------------------------------
    await docker([
      'run', '-d', '--rm', '--name', academyName,
      '--network', netName, '--network-alias', 'academy.internal',
      '-v', `${resolve(opts.repoDir)}:/academy:ro`,
      '-v', `${outDir}:/out`,
      '-w', '/academy',
      ACADEMY_IMAGE, 'node', 'src/cli.js', 'serve',
      '--track', opts.track, '--suite', opts.suite,
      '--host', '0.0.0.0', '--port', String(ACADEMY_PORT), '--token', token,
      '--adapter', 'container', '--endpoint-fingerprint', opts.fingerprint,
      '--out', `/out/${bundleName}`,
      ...(opts.serveArgs || []),
    ]);
    await waitForSidecar(academyName, log);

    // --- entrant -----------------------------------------------------------
    log(`starting entrant ${opts.image} as ${entrantName} …`);
    entrant = spawn('docker', [
      'run', '--rm', '--name', entrantName,
      '--network', netName,
      '--read-only', '--tmpfs', '/tmp:rw,size=512m',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--pids-limit', String(limits.pids), '--memory', limits.memory, '--cpus', String(limits.cpus),
      '-e', `ACADEMY_ENV_URL=http://academy.internal:${ACADEMY_PORT}/v1`,
      '-e', `ACADEMY_SESSION_TOKEN=${token}`,
      '-e', `ACADEMY_TRACK=${opts.track}`,
      '-e', `ACADEMY_SUITE=${opts.suite}`,
      '-e', 'ACADEMY_PROTOCOL=ota-env/1',
      opts.image,
    ], { env: ENV_PATH, stdio: ['ignore', 'pipe', 'pipe'] });
    entrant.stdout.on('data', (d) => log(`[entrant] ${String(d).trimEnd()}`));
    entrant.stderr.on('data', (d) => log(`[entrant] ${String(d).trimEnd()}`));
    const entrantExit = new Promise((r) => entrant.on('close', (code) => r(code)));

    // --- wait: bundle written | entrant exit | wall budget -------------------
    let reason = 'suite-complete';
    let killed = false;
    const t0 = Date.now();
    for (;;) {
      if (existsSync(bundleHostPath)) break;                       // serve wrote the bundle
      if (entrant.exitCode !== null) {
        // Entrant gave up (or crashed) mid-suite: tell the sidecar to
        // finalize whatever was recorded — a partial run is still a record.
        reason = 'entrant-exited';
        log(`entrant exited (${entrant.exitCode}) before completion — finalizing partial run`);
        await sidecarComplete(academyName, token, log);
        await waitForFile(bundleHostPath, 15000);
        break;
      }
      if (Date.now() - t0 > opts.maxWallMs) {
        reason = 'wall-budget-exceeded';
        killed = true;
        log('wall budget exceeded — killing entrant, finalizing partial run');
        await docker(['kill', entrantName]).catch(() => {});
        await sidecarComplete(academyName, token, log);
        await waitForFile(bundleHostPath, 15000);
        break;
      }
      await sleep(500);
    }

    if (entrant.exitCode === null && reason === 'suite-complete') {
      await sleep(5000);                                           // grace to exit clean
      if (entrant.exitCode === null) { killed = true; await docker(['kill', entrantName]).catch(() => {}); }
    }
    const exitCode = await Promise.race([entrantExit, sleep(10000).then(() => null)]);

    return { bundleFile: existsSync(bundleHostPath) ? bundleHostPath : null, exitCode, killed, reason };
  } finally {
    await docker(['stop', '-t', '2', academyName]).catch(() => {});
    await docker(['kill', entrantName]).catch(() => {});
    await sleep(1500);                                             // let --rm detach from the network
    await docker(['network', 'rm', netName]).then(
      () => log(`network ${netName} removed`),
      () => log(`network ${netName} removal failed (still busy?)`),
    );
  }
}

/** Poll the sidecar's own loopback until /v1/protocol answers. */
async function waitForSidecar(name, log, timeoutMs = 30000) {
  const probe = `fetch('http://127.0.0.1:${ACADEMY_PORT}/v1/protocol').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`;
  const t0 = Date.now();
  for (;;) {
    try { await docker(['exec', name, 'node', '-e', probe]); log('academy sidecar ready'); return; }
    catch {
      if (Date.now() - t0 > timeoutMs) throw new Error('academy sidecar did not become ready — check `docker logs` for it');
      await sleep(500);
    }
  }
}

/** Ask the sidecar (from inside, via exec) to finalize the run early. */
async function sidecarComplete(name, token, log) {
  const call = `fetch('http://127.0.0.1:${ACADEMY_PORT}/v1/run/complete',{method:'POST',headers:{authorization:'Bearer ${token}'}}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`;
  await docker(['exec', name, 'node', '-e', call]).catch(() => log('early-finalize call failed (sidecar already gone?)'));
}

async function waitForFile(path, timeoutMs) {
  const t0 = Date.now();
  while (!existsSync(path) && Date.now() - t0 < timeoutMs) await sleep(250);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
