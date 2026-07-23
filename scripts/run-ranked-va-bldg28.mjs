// scripts/run-ranked-va-bldg28.mjs
//
// Produce a REAL ranked run-bundle for the VA Building 28 (AF101) Div-9 flooring
// standard, for submission through the Academy scoring workflow.
//
// This is NOT a stub. It drives the actual OpenTakeoff engine (opentakeoff-mcp)
// through the academy runner (src/runner.js, engine:'opentakeoff'): every
// measurement is the engine's real One-Click geometry at the agent's calibrated
// scale. The "agent" is a deterministic REFERENCE POLICY — a scripted
// OpenAI-compatible endpoint that calibrates from the scale bar, measures each
// target room, and emits one quantity per finish. It is the board's reference
// anchor, clearly labeled as such; a real contestant swaps in their own model.
//
// The bundle is signed with an ephemeral entrant key so it self-verifies, and is
// written to submissions/ for the score-submission.yml PR workflow to validate +
// score against the held-out ground truth (OTA_GROUNDTRUTH_DIR).
//
// The held-out ANSWER KEY is never read here — the reference agent operates the
// engine blind and reports what it measures. Scoring happens later, in CI.
//
// Run:  node scripts/run-ranked-va-bldg28.mjs [--out <path>]
//       (needs the opentakeoff-mcp engine installed; see src/ot-mcp-client.js)

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSuite, generateKeypairPem, validateBundle, verifyBundle } from '../src/index.js';
import { resolveMcpDir, OtEngineError } from '../src/ot-mcp-client.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const TASK_DIR = resolve(REPO, 'tasks/div9/va-bldg28');
const TASK_FILE = join(TASK_DIR, 'va-bldg28-area.task.json');

// Room hints (image px @ render scale 2.0): open-floor click points + a
// plausibility window per room. These are the agent's harness inputs (where to
// click), NOT answer keys — the engine returns the true traced geometry. Same
// points the validated AF101 run used; the backend rings around each if a click
// lands on a label/wall.
const ROOMS = [
  { id: '162', condition: 'WD-1', points: [[3300, 2010], [3260, 1990], [3350, 1965], [3280, 2035]], plausibleSf: [140, 360] },
  { id: '161', condition: 'WD-1', points: [[3620, 2015], [3660, 1985], [3565, 2010], [3640, 1955]], plausibleSf: [140, 360] },
  { id: '158', condition: 'WD-1', points: [[3875, 2280], [3900, 2445], [3850, 2300], [3920, 2260]], plausibleSf: [140, 360] },
  { id: '159', condition: 'VCT-1', points: [[3850, 2140], [3890, 2060], [3825, 2165], [3900, 2095]], plausibleSf: [40, 180] },
];

// finish → member rooms (the scope the prompt states). The policy sums measured
// room areas per finish; it does not know the truth.
const FINISH_ROOMS = { 'WD-1': ['162', '161', '158'], 'VCT-1': ['159'] };
const MEASURE_ORDER = ['162', '161', '158', '159'];

const round2 = (x) => Math.round(x * 100) / 100;

function argOut() {
  const i = process.argv.indexOf('--out');
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : resolve(REPO, 'submissions/reference-opentakeoff-va-bldg28.bundle.json');
}

// ---------------------------------------------------------------------------
// Reference policy as a scripted OpenAI-compatible endpoint (fetchImpl).
// One decision per turn; state reconstructed from the conversation so far so the
// emitted numbers are exactly what the engine measured.
// ---------------------------------------------------------------------------
function makeReferenceEndpoint() {
  let callSeq = 0;

  const think = {
    scale: 'The plan carries a graphic scale bar (nominal 1/8" = 1\'-0"). Calibrating from it before I measure anything.',
    '162': 'Measuring the finished floor area of Patient Room 162 (finish WD-1).',
    '161': 'Measuring the finished floor area of Patient Room 161 (finish WD-1).',
    '158': 'Measuring the finished floor area of Patient Room 158 (finish WD-1).',
    '159': 'Measuring the finished floor area of Clean Linen 159 (finish VCT-1).',
    'WD-1': 'Rooms 162, 161 and 158 are all WD-1 — summing their measured areas and recording the WD-1 quantity.',
    'VCT-1': 'Clean Linen 159 is VCT-1 — recording its measured area.',
    done: 'Division 9 flooring takeoff complete: WD-1 and VCT-1 measured off the calibrated AF101 plan and emitted.',
  };

  const toolMessage = (id, name, args, content) => ({
    id: `tool_${callSeq}`,
    choices: [{
      index: 0,
      finish_reason: 'tool_calls',
      message: { role: 'assistant', content, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
    }],
    usage: { prompt_tokens: 180 + 30 * callSeq, completion_tokens: 24 },
  });
  const finalMessage = (content) => ({
    id: `tool_${callSeq}`,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, tool_calls: [] } }],
    usage: { prompt_tokens: 180 + 30 * callSeq, completion_tokens: 18 },
  });

  return async function fetchImpl(_url, init) {
    callSeq++;
    const body = JSON.parse(init.body);
    const messages = body.messages || [];
    const toolResults = messages
      .filter((m) => m.role === 'tool')
      .map((m) => { try { return JSON.parse(m.content); } catch { return {}; } });

    const didScale = toolResults.some((r) => r && r.ok === true && typeof r.pxPerUnit === 'number' && r.area === undefined && r.recorded === undefined);
    const measured = {};
    for (const r of toolResults) if (r && r.ok && typeof r.area === 'number' && r.roomId != null) measured[String(r.roomId)] = r.area;
    const emitted = new Set(toolResults.filter((r) => r && r.recorded && r.recorded.item).map((r) => r.recorded.item));

    let resp;
    const callId = `call_${callSeq}`;
    if (!didScale) {
      resp = toolMessage(callId, 'set_scale', { from: 'scale-bar', unit: 'ft' }, think.scale);
    } else {
      const nextRoom = MEASURE_ORDER.find((r) => measured[r] === undefined);
      if (nextRoom) {
        resp = toolMessage(callId, 'measure_area', { roomId: nextRoom }, think[nextRoom]);
      } else {
        const nextFinish = Object.keys(FINISH_ROOMS).find((f) => !emitted.has(f));
        if (nextFinish) {
          const rooms = FINISH_ROOMS[nextFinish];
          const value = round2(rooms.reduce((a, r) => a + (measured[r] || 0), 0));
          resp = toolMessage(callId, 'emit_quantity', { item: nextFinish, value, unit: 'sf', confidence: 0.95 }, think[nextFinish]);
        } else {
          resp = finalMessage(think.done);
        }
      }
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => resp, text: async () => JSON.stringify(resp) };
  };
}

async function main() {
  try { resolveMcpDir(); } catch (e) {
    if (e instanceof OtEngineError) { console.error(`\n✗ cannot produce the ranked bundle — ${e.message}`); process.exit(2); }
    throw e;
  }
  const task = JSON.parse(readFileSync(TASK_FILE, 'utf8'));
  task.__dir = TASK_DIR; // loadTasks normally stamps this; needed to resolve the planset asset
  // Hand the runner's OT backend the room hints in-memory (not committed to the
  // task file — they are the reference harness's inputs).
  task.planset = { ...task.planset, rooms: ROOMS };

  const { privateKeyPem } = generateKeypairPem();

  console.log('Producing the VA Bldg-28 (AF101) ranked reference run — REAL opentakeoff-mcp engine …\n');
  const bundle = await runSuite({
    track: 'div9',
    suite: 'va-bldg28',
    mode: 'ranked',
    endpoint: 'http://reference.local/v1',
    model: 'opentakeoff-oneclick-reference',
    tasks: [task],
    engine: 'opentakeoff',
    mcpDir: resolveMcpDir(),
    fetchImpl: makeReferenceEndpoint(),
    contestant: {
      name: 'Reference · OpenTakeoff One-Click',
      modelId: 'reference/opentakeoff-oneclick',
      harness: 'opentakeoff-academy/reference-runner',
      contact: 'https://github.com/Kentucky-ai/opentakeoff-academy',
    },
    attestationMode: 'self_reported',
    privateKeyPem,
    log: (m) => process.stderr.write(`  · ${m}\n`),
  });

  // Show what the reference agent measured + emitted (NOT scored here).
  const t = bundle.tasks[0];
  console.log('\nemitted quantities:');
  for (const q of t.answer.quantities) console.log(`  ${q.item.padEnd(6)} ${q.value} ${q.unit}  (confidence ${q.confidence ?? '—'})`);
  console.log(`\ntrace: ${t.trace.length} steps · ${t.telemetry.toolCalls} tool call(s) · ${t.telemetry.wallMs} ms`);

  const v = validateBundle(bundle);
  const iv = verifyBundle(bundle);
  console.log(`\nschema-valid: ${v.valid} · hashMatch: ${iv.hashMatch} · entrant signature: ${iv.signatureValid}`);
  if (!v.valid) { console.error('  schema errors:', JSON.stringify(v.errors, null, 2)); process.exit(1); }
  if (!iv.hashMatch || iv.signatureValid === false) { console.error('  integrity failed'); process.exit(1); }

  const out = argOut();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(bundle, null, 2) + '\n');
  console.log(`\n✅ ranked reference bundle → ${out}`);
  console.log(`   runId ${bundle.runId}`);
  console.log(`   bundleHash ${bundle.integrity.bundleHash}`);
  console.log('\n   Score it with the held-out key:');
  console.log('     OTA_GROUNDTRUTH_DIR=tasks/div9/va-bldg28/ground-truth \\');
  console.log(`       node src/cli.js score ${out.replace(REPO + '/', '')} --track div9 --suite va-bldg28`);
}

main().catch((e) => { console.error(`\n✗ ${e?.stack || e}`); process.exit(1); });
