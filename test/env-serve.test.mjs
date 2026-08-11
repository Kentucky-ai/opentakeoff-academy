// test/env-serve.test.mjs
//
// End-to-end over the BYO-harness surface: a scripted entrant harness drives
// the environment HTTP API (src/env-serve.js) through the full div9 practice
// suite exactly as a remote company would — discover, measure, emit, advance —
// and the resulting SERVER-RECORDED bundle must validate against the schema,
// carry the proctored attestation, and score a pass against the practice keys.
// Also: auth is enforced, ground truth never crosses the wire, disallowed
// tools are refused and recorded.

import assert from 'node:assert/strict';
import { loadTasks, validateBundle, scoreBundle } from '../src/index.js';
import { createSession } from '../src/env-session.js';
import { serveSession } from '../src/env-serve.js';

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

console.log('env-serve: the bring-your-own-harness surface records a certifiable run');

const tasks = loadTasks('./tasks', 'div9', 'practice');
const session = createSession({
  track: 'div9',
  suite: 'practice',
  tasks,
  contestant: { name: 'wire-test', modelId: 'scripted-harness', adapter: 'remote-env' },
  attestationMode: 'proctored',
  proctor: { endpointFingerprint: 'test-fingerprint' },
});

let completedBundle = null;
const handle = await serveSession({ session, onComplete: (b) => { completedBundle = b; } });
const base = `${handle.url}/v1`;
const auth = { authorization: `Bearer ${handle.token}` };

const get = async (p, headers = auth) => (await fetch(base + p, { headers })).json();
const post = async (p, body = {}, headers = auth) =>
  (await fetch(base + p, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

// ── discovery + auth ────────────────────────────────────────────────────────
const proto = await (await fetch(base + '/protocol')).json();
check(proto.protocol === 'ota-env/1' && proto.taskCount === tasks.length, 'GET /protocol is public and describes the suite');

const unauth = await (await fetch(base + '/session')).json();
check(unauth.error === 'unauthorized', 'session routes reject a missing token');
const badTok = await (await fetch(base + '/session', { headers: { authorization: 'Bearer nope' } })).json();
check(badTok.error === 'unauthorized', 'session routes reject a wrong token');

// ── the scripted harness plays every task ───────────────────────────────────
for (let i = 0; i < tasks.length; i++) {
  const st = await get('/session');
  check(st.ok && st.task && !('groundTruth' in st.task), `task ${i + 1}: manifest arrives WITHOUT ground truth (${st.task?.taskId})`);
  const task = st.task;
  const toolset = new Set(task.toolset || []);

  // A tool outside the task's toolset must be refused (and that's provenance).
  if (!toolset.has('identify_scope')) {
    const refused = await post('/tools/identify_scope');
    check(refused.ok === false && refused.error === 'tool-not-allowed', `task ${i + 1}: disallowed tool is refused`);
  }

  if (task.taskId === 'd9-area-1') {
    // Calibrate off the graphic bar (fall back to the stated 24 px/ft), then
    // measure each named room and emit its material quantity.
    let scale = await post('/tools/set_scale', { from: 'scale-bar', unit: 'ft' });
    if (!scale.ok) scale = await post('/tools/set_scale', { pxPerUnit: 24, unit: 'ft' });
    check(scale.ok, 'd9-area-1: scale calibrated');
    const rooms = [
      { roomId: 'RM-201', item: 'RM-201 LVT flooring' },
      { roomId: 'RM-202', item: 'RM-202 carpet flooring' },
      { roomId: 'RM-203', item: 'RM-203 ceramic tile flooring' },
    ];
    for (const r of rooms) {
      const m = await post('/tools/measure_area', { roomId: r.roomId });
      check(m.ok && m.area > 0, `d9-area-1: ${r.roomId} measured (${m.area} ${m.areaUnit})`);
      const e = await post('/tools/emit_quantity', { item: r.item, value: m.area, unit: 'sf', roomId: r.roomId, confidence: 0.95 });
      check(e.ok, `d9-area-1: ${r.roomId} emitted`);
    }
  } else if (task.taskId === 'd9-count-1') {
    const c = await post('/tools/count', { item: 'floor drain' });
    check(c.ok && c.count > 0, `d9-count-1: counted ${c.count} floor drain(s)`);
    const e = await post('/tools/emit_quantity', { item: 'floor drain', value: c.count, unit: 'ea' });
    check(e.ok, 'd9-count-1: emitted');
  } else if (task.taskId === 'd9-scale-1') {
    const scale = await post('/tools/set_scale', { from: 'scale-bar', unit: 'ft' });
    check(scale.ok && scale.unitPerPx > 0, `d9-scale-1: calibrated off the bar (${scale.unitPerPx} ft/px)`);
    const e = await post('/tools/emit_quantity', { item: 'drawing scale', value: scale.unitPerPx, unit: 'ft/px' });
    check(e.ok, 'd9-scale-1: emitted');
  } else {
    check(false, `unexpected task ${task.taskId} — extend the scripted harness`);
  }

  await post('/task/done');
}

// ── completion + the recorded bundle ────────────────────────────────────────
const done = await get('/session');
check(done.suiteComplete === true, 'suite reports complete after the last task/done');
check(!!completedBundle, 'onComplete delivered the finalized bundle');
await handle.close();

const v = validateBundle(completedBundle);
if (!v.valid) for (const e of v.errors || []) console.error(`    schema: ${e.instancePath} ${e.message}`);
check(v.valid, 'server-recorded bundle is schema-valid');
check(completedBundle.attestation.mode === 'proctored'
  && completedBundle.attestation.proctor.endpointFingerprint === 'test-fingerprint',
'bundle carries the proctored attestation + endpoint fingerprint');
check(completedBundle.contestant.adapter === 'remote-env', "adapter is 'remote-env'");

const anchors = completedBundle.tasks.map((t) => t.trace.find((e) => e.tool === 'planset'));
check(anchors.every((a) => a && a.result.verified === true), 'every task trace opens with a verified planset anchor');
const refusals = completedBundle.tasks.flatMap((t) => t.trace.filter((e) => e.type === 'error' && e.result?.error === 'tool-not-allowed'));
check(refusals.length > 0, 'tool refusals are recorded in the trace (a refusal is provenance)');

const report = scoreBundle(completedBundle, tasks);
check(report.suite.passed === true, `scored a PASS against the practice keys (median ${report.suite.median} ${report.suite.metric})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
