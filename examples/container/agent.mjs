#!/usr/bin/env node
// examples/container/agent.mjs
//
// The reference sealed-container adapter — the whole ota-env/1 lifecycle in
// plain fetch, no SDK. Replace decideAndMeasure() with calls into YOUR stack
// (your model, your parser, your orchestration); the loop around it is the
// entire contract: session → tools → done → exit.
//
// Runs anywhere node >= 18 runs. Inside the proctor container the two env vars
// are injected for you; locally you can export them by hand against
// `opentakeoff-academy serve`.

const BASE = process.env.ACADEMY_ENV_URL;
const TOKEN = process.env.ACADEMY_SESSION_TOKEN;
if (!BASE || !TOKEN) { console.error('ACADEMY_ENV_URL and ACADEMY_SESSION_TOKEN are required'); process.exit(2); }

const HEADERS = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const get = async (p) => (await fetch(BASE + p, { headers: HEADERS })).json();
const tool = async (name, args = {}) =>
  (await fetch(`${BASE}/tools/${name}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(args) })).json();
const post = async (p) => (await fetch(BASE + p, { method: 'POST', headers: HEADERS, body: '{}' })).json();

for (;;) {
  const st = await get('/session');
  if (st.suiteComplete) { console.log(`suite complete — run ${st.runId}`); process.exit(0); }
  if (!st.ok || !st.task) { console.error('unexpected session state', st); process.exit(1); }

  console.log(`task ${st.task.taskId} (${st.tasksDone + 1}/${st.taskCount}): ${st.task.title || ''}`);
  try {
    await decideAndMeasure(st.task);
  } catch (e) {
    console.error(`task ${st.task.taskId} failed: ${e?.message || e}`); // move on; unanswered scores as unanswered
  }
  await post('/task/done');
}

/**
 * The part that is YOURS. This scripted version handles the three public
 * practice-task kinds so the example passes end-to-end; a real entrant swaps
 * this for their own intelligence — e.g. fetch /v1/planset, hand the drawing
 * to your vision model or parser, and turn its output into tool calls.
 */
async function decideAndMeasure(task) {
  const tools = new Set(task.toolset || []);

  // 1. Calibrate whenever the task allows it: graphic scale bar first, stated
  //    scale as fallback ("24 px = 1 ft" style note in planset.knownScale).
  let scale = null;
  if (tools.has('set_scale')) {
    scale = await tool('set_scale', { from: 'scale-bar', unit: 'ft' });
    if (!scale.ok) {
      const m = /([\d.]+)\s*px\s*=\s*1\s*ft/.exec(task.planset?.knownScale || '');
      if (m) scale = await tool('set_scale', { pxPerUnit: Number(m[1]), unit: 'ft' });
    }
    if (scale?.ok) console.log(`  calibrated: ${scale.pxPerUnit} px/${scale.unit} (${scale.source})`);
  }

  // 2. Scale-calibration tasks: the calibration IS the answer.
  if (task.kind === 'scale-calibration' && scale?.ok) {
    await tool('emit_quantity', { item: 'drawing scale', value: scale.unitPerPx, unit: 'ft/px' });
    return;
  }

  // 3. Count tasks: count the named symbol and emit the total.
  if (tools.has('count') && task.kind === 'fixture-count') {
    const item = /floor drain/i.test(task.prompt) ? 'floor drain' : 'fixture';
    const c = await tool('count', { item });
    if (c.ok) await tool('emit_quantity', { item, value: c.count, unit: 'ea' });
    return;
  }

  // 4. Area tasks: measure every room named in the prompt (RM-xxx (material)),
  //    or fall back to identify_scope when the task allows it.
  if (tools.has('measure_area')) {
    const rooms = [...task.prompt.matchAll(/(RM-\d+)[^()]*\(([^)]+)\)/g)]
      .map(([, roomId, material]) => ({ roomId, material: material.trim() }));
    for (const r of rooms) {
      const m = await tool('measure_area', { roomId: r.roomId });
      if (!m.ok) { console.error(`  ${r.roomId}: ${m.error}`); continue; }
      await tool('emit_quantity', { item: `${r.roomId} ${r.material} flooring`, value: m.area, unit: 'sf', roomId: r.roomId, confidence: 0.9 });
      console.log(`  ${r.roomId}: ${m.area} ${m.areaUnit} (${r.material})`);
    }
  }
}
