#!/usr/bin/env node
// examples/my-agent.example.js
//
// A reference "bring your own agent" for OpenTakeoff Academy that needs NO LLM
// and NO network. It is an OpenAI-compatible endpoint the conformance runner
// can drive exactly like a real model server, so the whole harness works
// end-to-end offline.
//
// It solves the practice tasks by actually OPERATING the OpenTakeoff
// environment: it calibrates the scale (set_scale), calls the real measurement/
// count tools, READS the measured results back out of the conversation, and
// emits those measured quantities — it never pre-computes the answer. Wire it to
// a wrong calibration and the environment hands back a wrong area, which it would
// report. Real entrants replace this with an actual model behind
// /v1/chat/completions.
//
// Modes:
//   node examples/my-agent.example.js --serve [--port 8123]
//       Run the endpoint; then point the CLI at it:
//       opentakeoff-academy run --track div9 --suite practice \
//         --endpoint http://localhost:8123/v1 --model reference-nollm \
//         --out ./runs/example.bundle.json
//
//   node examples/my-agent.example.js --selftest
//       Full offline E2E: run the sample task against this agent, validate +
//       score the bundle, issue a self-reported cert, render a badge, and
//       smoke-test the example MCP parser. Exits non-zero on any failure.
//       (This is what `npm test` runs.)

import http from 'node:http';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import {
  runSuite, loadTasks, scoreBundle, formatReport, validateBundle,
  issueCert, renderBadgeSvg, sampleTask, connectMcp,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// The deterministic "brain": decide the next action from the conversation.
//
// This agent ACTUALLY OPERATES the OpenTakeoff environment. It does not pre-
// compute answers: it calibrates the scale, calls the measurement/count tools,
// READS the real tool results back out of the conversation, and only then emits
// the measured quantities. Feed it a wrong calibration and the environment
// returns a wrong area — which this agent would faithfully report.
// ---------------------------------------------------------------------------

/**
 * Given an OpenAI chat.completions request body, return the assistant's next
 * turn (a single tool call, or a final message when the takeoff is complete).
 */
function decide(body) {
  const messages = body.messages || [];
  const toolNames = new Set((body.tools || []).map((t) => t.function?.name));
  const userText = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  const task = parseTask(userText, toolNames);
  const K = task.targets.length;

  // Rehydrate what the environment has told us so far (stateless server).
  const results = (messages.filter((m) => m.role === 'tool')).map((m) => { try { return JSON.parse(m.content); } catch { return {}; } });
  const scaleRes = results.filter((r) => r && typeof r.pxPerUnit === 'number');
  const areaRes = results.filter((r) => r && typeof r.area === 'number');
  const lenRes = results.filter((r) => r && typeof r.length === 'number');
  const countRes = results.filter((r) => r && typeof r.count === 'number');
  const done = results.length;

  const calibrates = task.kind === 'area' || task.kind === 'length' || task.kind === 'scale';
  const cal = calibrates ? 1 : 0;

  // Scale-calibration task: calibrate, then emit the environment's scale.
  if (task.kind === 'scale') {
    if (done < cal) return scaleCall(task);
    const i = done - cal;
    if (i < K) return emitCall(task.targets[i], scaleRes[0]?.unitPerPx);
    return finalMessage('Scale calibrated and reported.');
  }

  // Count task: count each subject, then emit each count.
  if (task.kind === 'count') {
    if (done < K) return countCall(task.targets[done]);
    const i = done - K;
    if (i < K) return emitCall(task.targets[i], countRes[i]?.count);
    return finalMessage('Fixture count complete.');
  }

  // Area / length task: calibrate → measure every target → emit every measurement.
  if (done < cal) return scaleCall(task);
  if (done < cal + K) {
    const t = task.targets[done - cal];
    return task.kind === 'length' ? measureLengthCall(t) : measureAreaCall(t);
  }
  const i = done - cal - K;
  if (i < K) {
    const measured = task.kind === 'length' ? lenRes[i]?.length : areaRes[i]?.area;
    return emitCall(task.targets[i], measured);
  }
  return finalMessage('Takeoff complete.');
}

/**
 * Parse the task from the prompt: which competency, how to calibrate, and the
 * list of measurement targets (rooms with material, or a count/scale subject).
 */
function parseTask(text, toolNames) {
  const kind = toolNames.has('count') ? 'count'
    : toolNames.has('measure_area') ? 'area'
    : toolNames.has('measure_length') ? 'length'
    : toolNames.has('set_scale') ? 'scale'
    : 'area';

  // Calibration reference, e.g. "24 px = 1 ft" or "200 px = 20 ft".
  const sc = text.match(/(\d+(?:\.\d+)?)\s*px\s*=\s*(\d+(?:\.\d+)?)\s*(ft|m)\b/i);
  const scale = sc
    ? { refPx: Number(sc[1]), refLen: Number(sc[2]), unit: sc[3].toLowerCase(), fromBar: false }
    : { fromBar: true, unit: 'ft' };

  if (kind === 'scale') {
    return { kind, scale, targets: [{ item: 'drawing scale', emitUnit: 'ft/px' }] };
  }
  if (kind === 'count') {
    return { kind, scale, targets: [{ item: 'floor drain', emitUnit: 'ea' }] };
  }

  const suffix = kind === 'length' ? 'base' : 'flooring';
  const emitUnit = kind === 'length' ? 'lf' : 'sf';

  // Multi-room prompts tag each room with its material: "RM-201 Corridor (LVT)".
  const roomsWithMat = [...text.matchAll(/\b(RM-\d+)\b[^()]{0,40}?\(([^)]+)\)/gi)]
    .map((m) => ({ roomId: m[1].toUpperCase(), material: m[2].trim() }));
  if (roomsWithMat.length) {
    return {
      kind, scale,
      targets: roomsWithMat.map((r) => ({ roomId: r.roomId, material: r.material, item: `${r.roomId} ${r.material} ${suffix}`, emitUnit })),
    };
  }

  // Single-room prompt with an explicit pixel rectangle (e.g. the practice sample).
  const roomId = (text.match(/\b(RM-\d+)\b/i)?.[1] || 'RM-001').toUpperCase();
  const rect = text.match(/(\d+(?:\.\d+)?)\s*px\s*wide\s*by\s*(\d+(?:\.\d+)?)\s*px/i);
  const material = materialFromText(text);
  return {
    kind, scale,
    targets: [{
      roomId, material,
      rectPx: rect ? { w: Number(rect[1]), h: Number(rect[2]) } : null,
      item: `${roomId} ${material} area`,
      emitUnit,
    }],
  };
}

// --- individual tool-call builders (operate the environment) ----------------

function scaleCall(task) {
  const s = task.scale;
  const args = task.kind === 'scale' || s.fromBar
    ? { from: 'scale-bar', unit: s.unit }
    : { referencePx: s.refPx, referenceLength: s.refLen, unit: s.unit };
  return toolCall('set_scale', args);
}

function measureAreaCall(t) {
  const region = t.rectPx ? { width: t.rectPx.w, height: t.rectPx.h } : { roomId: t.roomId };
  return toolCall('measure_area', { roomId: t.roomId, region, label: t.roomId });
}

function measureLengthCall(t) {
  return toolCall('measure_length', { roomId: t.roomId, region: { roomId: t.roomId }, label: t.roomId });
}

function countCall(t) {
  return toolCall('count', { item: t.item });
}

function emitCall(t, measuredValue) {
  const value = Number.isFinite(measuredValue) ? round2(measuredValue) : 0;
  const args = { item: t.item, value, unit: t.emitUnit, confidence: 0.96 };
  if (t.roomId) args.roomId = t.roomId;
  return toolCall('emit_quantity', args);
}

/** Find a flooring material named in a single-room prompt (best effort). */
function materialFromText(text) {
  const low = text.toLowerCase();
  const known = [['lvt', 'LVT'], ['vct', 'VCT'], ['ceramic tile', 'ceramic tile'], ['porcelain tile', 'porcelain tile'], ['carpet', 'carpet'], ['terrazzo', 'terrazzo'], ['epoxy', 'epoxy'], ['tile', 'tile'], ['vinyl', 'vinyl'], ['wood', 'wood']];
  for (const [needle, label] of known) if (low.includes(needle)) return label;
  return 'LVT';
}

/** Build an OpenAI tool_call response for a named tool with the given args. */
function toolCall(name, args) {
  return completion({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: `call_${randomUUID().slice(0, 8)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  }, 'tool_calls');
}

function finalMessage(text) {
  return completion({ role: 'assistant', content: text }, 'stop');
}

/** Wrap a message in the OpenAI chat.completions envelope (deterministic usage). */
function completion(message, finishReason) {
  const outStr = JSON.stringify(message);
  return {
    id: `chatcmpl-${randomUUID().slice(0, 12)}`,
    object: 'chat.completion',
    created: 0, // no clock: deterministic
    model: 'reference-nollm-agent',
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 64, completion_tokens: Math.max(8, Math.round(outStr.length / 4)), total_tokens: 0 },
  };
}

function round2(x) { return Math.round(x * 100) / 100; }

// ---------------------------------------------------------------------------
// HTTP server (OpenAI-compatible /v1/chat/completions).
// ---------------------------------------------------------------------------

export function createServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found; POST /v1/chat/completions' }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw || '{}'); }
      catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'bad json' })); return; }
      const out = decide(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
}

/** Start the server and resolve with { server, port, url }. */
export function startServer(port = 0) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({ server, port: p, url: `http://127.0.0.1:${p}/v1` });
    });
  });
}

// ---------------------------------------------------------------------------
// Offline end-to-end self-test (what `npm test` runs).
// ---------------------------------------------------------------------------

async function selftest() {
  const FIXED_NOW = '2026-01-01T00:00:00.000Z'; // deterministic timestamps
  let failures = 0;
  const check = (cond, msg) => { if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; } };

  console.log('OpenTakeoff Academy — offline self-test\n');

  // 1) stand up the reference agent
  const { server, url } = await startServer(0);
  console.log(`reference agent listening at ${url}`);

  // 2) write the sample practice task to a temp suite dir and load it
  const tmp = mkdtempSync(join(tmpdir(), 'ota-selftest-'));
  const suiteDir = join(tmp, 'div9', 'practice');
  mkdirSync(suiteDir, { recursive: true });
  const task = sampleTask();
  writeFileSync(join(suiteDir, `${task.taskId}.task.json`), JSON.stringify(task, null, 2));
  const tasks = loadTasks(tmp, 'div9', 'practice');
  check(tasks.length === 1 && tasks[0].taskId === task.taskId, 'loaded sample task from disk');

  // 3) run the suite against the reference agent
  const bundle = await runSuite({
    track: 'div9',
    suite: 'practice',
    endpoint: url,
    model: 'reference-nollm',
    tasksDir: tmp,
    contestant: { name: 'example-agent', modelId: 'reference-nollm-agent', adapter: 'openai-endpoint', harness: 'ota-example' },
    attestationMode: 'self_reported',
    now: FIXED_NOW,
  });

  // 4) validate the bundle against the schema
  const v = validateBundle(bundle);
  check(v.valid, `run-bundle is schema-valid${v.valid ? '' : ': ' + JSON.stringify(v.errors?.slice(0, 2))}`);
  const bt = bundle.tasks[0];
  check(bt.answer.quantities.length === 1, 'agent emitted exactly one quantity');
  check(Math.abs((bt.answer.quantities[0]?.value ?? 0) - 850) < 0.01, `computed area ≈ 850 sf (got ${bt.answer.quantities[0]?.value})`);
  check(bt.trace.some((s) => s.type === 'tool_call' && s.tool === 'set_scale'), 'trace records set_scale provenance');
  check(bt.trace.some((s) => s.type === 'tool_call' && s.tool === 'emit_quantity'), 'trace records emit_quantity provenance');

  // 5) score against ground truth
  const report = scoreBundle(bundle, tasks, {});
  check(report.integrity.valid, 'scorer verifies bundle integrity');
  check(report.suite.median <= 0.01, `median APE ≈ 0% (got ${report.suite.median}%)`);
  check(report.suite.passed, 'suite passes the threshold');
  check(report.flags.length === 0, `no provenance flags${report.flags.length ? ': ' + JSON.stringify(report.flags) : ''}`);
  check(report.suite.tier === 'master', `earned tier = master (beats baseline) (got ${report.suite.tier})`);

  // 6) issue a self-reported cert + render a badge
  const cert = issueCert(report, { attestation: 'self_reported', now: FIXED_NOW, modelId: 'reference-nollm-agent', contestant: 'example-agent' });
  check(/^OTA-D9A-\d{4}$/.test(cert.certId), `cert id looks right (${cert.certId})`);
  check(cert.attestation === 'self_reported' && cert.integrity.academySignature === 'self-reported:unsigned', 'self-reported cert is not Academy-signed');
  const badge = renderBadgeSvg(cert);
  check(badge.startsWith('<svg') && badge.includes('OpenTakeoff Certified'), 'badge SVG renders');

  // 7) MCP smoke test against the shipped example parser
  try {
    const mcp = await connectMcp({ command: 'node', args: [join(__dirname, 'my-parser.mcp.example.js')] }, { serverId: 'example-parser' });
    const toolList = await mcp.listTools();
    check(toolList.some((t) => t.name === 'parse_planset'), `MCP parser exposes parse_planset (${toolList.map((t) => t.name).join(', ')})`);
    const parsed = await mcp.callTool('parse_planset', { assetRef: task.planset.assetRef });
    check(Array.isArray(parsed?.rooms) && parsed.rooms.length > 0, 'MCP parse_planset returns rooms');
    await mcp.close();
  } catch (e) {
    check(false, `MCP smoke test: ${e.message || e}`);
  }

  server.close();

  console.log('\n' + formatReport(report) + '\n');
  if (failures === 0) {
    console.log(`self-test PASSED — ${cert.certId} (${cert.competency} · ${cert.tier})`);
    process.exit(0);
  } else {
    console.error(`\nself-test FAILED — ${failures} check(s) failed`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('--selftest')) {
  selftest().catch((e) => { console.error(e); process.exit(1); });
} else if (args.includes('--serve')) {
  const pi = args.indexOf('--port');
  const port = pi >= 0 ? Number(args[pi + 1]) : 8123;
  startServer(port).then(({ url }) => {
    process.stdout.write(`reference agent (no-LLM) listening at ${url}\n`);
    process.stdout.write(`try: opentakeoff-academy run --track div9 --suite practice --endpoint ${url} --model reference-nollm --out ./runs/example.bundle.json\n`);
  });
} else {
  process.stdout.write('usage: my-agent.example.js [--serve [--port N] | --selftest]\n');
}
