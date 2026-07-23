/* ============================================================================
   OpenTakeoff Academy — run inspector (client-side audit surface)
   ----------------------------------------------------------------------------
   Opens a run-bundle and audits it entirely in the browser:
     1. Integrity — recompute integrity.bundleHash (canonicalize + SHA-256) and
        verify the entrant's ed25519 signature. This REPLICATES src/bundle.js
        (canonicalize / hashPreimage) byte-for-byte, so the credential is
        checkable without trusting the site that served it.
     2. Anti-cheat — trace-level provenance signals (measurement present? emit
        provenance? implausible speed? planset hash bound?), computed from the
        trace alone (no held-out key needed).
     3. Trace — the complete ordered tool-call timeline.
     4. Export — map the trace to OpenTelemetry GenAI spans (OTLP JSON) so the
        run is portable to LangSmith / Phoenix / any OTLP sink.

   Nothing loaded here is uploaded. No backend.
   ========================================================================== */
(function () {
  'use strict';

  const MEASUREMENT_TOOLS = new Set(['set_scale', 'measure_area', 'measure_length', 'count', 'identify_scope']);
  const DEFAULT_BUNDLE = 'runs/reference-va-bldg28.bundle.json';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const esc = (s) => String(s);
  let CURRENT = null; // the loaded bundle

  // ==========================================================================
  // Canonical hashing — MUST match src/bundle.js exactly.
  // ==========================================================================
  function sortValue(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(sortValue);
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  const canonicalize = (value) => JSON.stringify(sortValue(value));

  function hashPreimage(bundle) {
    const clone = structuredClone(bundle);
    clone.integrity = { hashAlg: 'sha256', bundleHash: null, signature: null, publicKey: null, academySignature: null };
    return canonicalize(clone);
  }

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const computeBundleHash = async (bundle) => sha256Hex(hashPreimage(bundle));

  function pemToDer(pem) {
    const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  async function verifySignature(bundle) {
    const ig = bundle.integrity || {};
    if (!ig.signature || !ig.publicKey) return { status: 'none' };
    try {
      const key = await crypto.subtle.importKey('spki', pemToDer(ig.publicKey), { name: 'Ed25519' }, false, ['verify']);
      const ok = await crypto.subtle.verify('Ed25519', key, b64ToBytes(ig.signature), new TextEncoder().encode(ig.bundleHash));
      return { status: ok ? 'valid' : 'invalid' };
    } catch (e) {
      return { status: 'unsupported', error: String(e && e.message || e) };
    }
  }

  // ==========================================================================
  // Trace-level provenance signals (no held-out key needed).
  // ==========================================================================
  function traceSignals(task) {
    const trace = task.trace || [];
    const emitCalls = trace.filter((s) => s.type === 'tool_call' && s.tool === 'emit_quantity').length;
    const measureCalls = trace.filter((s) => s.type === 'tool_call' && MEASUREMENT_TOOLS.has(s.tool)).length;
    const mcpCalls = trace.filter((s) => s.type === 'mcp_call').length;
    const nQ = (task.answer && task.answer.quantities || []).length;
    const wallMs = (task.telemetry && task.telemetry.wallMs) || 0;
    const steps = (task.telemetry && task.telemetry.steps) || 0;
    const anchor = trace.find((s) => s.tool === 'planset' && s.result && typeof s.result === 'object');
    return {
      emitCalls, measureCalls, mcpCalls, nQ, wallMs, steps, anchor: anchor ? anchor.result : null,
      flags: {
        'answered-without-measurement': emitCalls > 0 && measureCalls === 0 && mcpCalls === 0,
        'missing-emit-provenance': nQ > 0 && emitCalls < nQ,
        'implausible-speed': nQ > 0 && (wallMs < nQ || steps < 1),
        'planset-hash-mismatch': !!(anchor && anchor.result && anchor.result.verified === false),
      },
    };
  }

  // ==========================================================================
  // Render
  // ==========================================================================
  function kv(k, v, mono) {
    const box = el('div', 'kv');
    box.appendChild(el('span', 'k', k));
    box.appendChild(el('span', 'v' + (mono ? ' mono' : ''), v == null || v === '' ? '—' : String(v)));
    return box;
  }

  function renderHeader(b) {
    $('runTitle').textContent = (b.contestant && b.contestant.name) || 'Run';
    $('runMode').textContent = (b.suite && b.suite.mode ? b.suite.mode : '—') + ' · ' + (b.attestation && b.attestation.mode || '—');
    const t = b.telemetry || {};
    const meta = $('runMeta');
    meta.textContent = '';
    const rows = [
      ['Run ID', b.runId, true],
      ['Model ID', b.contestant && b.contestant.modelId, true],
      ['Harness', b.contestant && b.contestant.harness],
      ['Adapter', b.contestant && b.contestant.adapter],
      ['Track', b.track],
      ['Suite', (b.suite && b.suite.id) + ' @ ' + (b.suite && b.suite.version)],
      ['Tasks', (b.tasks || []).length],
      ['Total steps', t.totalSteps],
      ['Tokens (in / out)', (t.totalTokensIn || 0) + ' / ' + (t.totalTokensOut || 0)],
      ['Wall time', (t.totalWallMs != null ? t.totalWallMs + ' ms' : null)],
      ['SDK', t.sdkVersion],
      ['Bundle hash', b.integrity && b.integrity.bundleHash, true],
    ];
    for (const [k, v, mono] of rows) meta.appendChild(kv(k, v, mono));
  }

  async function renderIntegrity(b) {
    const wrap = $('integrityChecks');
    wrap.textContent = '';
    const add = (state, title, detail) => {
      const c = el('div', 'check ' + state);
      c.appendChild(el('span', 'mark', state === 'ok' ? '✓' : state === 'warn' ? '!' : state === 'bad' ? '✗' : '·'));
      const body = el('div', 'body');
      body.appendChild(el('span', 'title', title));
      if (detail) body.appendChild(el('span', 'detail', detail));
      c.appendChild(body);
      wrap.appendChild(c);
    };

    // 1. hash
    const expected = await computeBundleHash(b);
    const stored = b.integrity && b.integrity.bundleHash;
    if (expected === stored) add('ok', 'Bundle hash verified', 'sha256 ' + expected.slice(0, 32) + '… — recomputed here, matches the record');
    else add('bad', 'Bundle hash MISMATCH — tampered', 'expected ' + expected.slice(0, 24) + '… · stored ' + String(stored).slice(0, 24) + '…');

    // 2. signature
    const sig = await verifySignature(b);
    if (sig.status === 'valid') add('ok', 'Entrant signature valid (ed25519)', 'signed over the bundle hash with the embedded public key');
    else if (sig.status === 'invalid') add('bad', 'Entrant signature INVALID', 'the signature does not verify against the embedded key');
    else if (sig.status === 'none') add('warn', 'Unsigned bundle (hash-only)', 'valid, but self-attested without an entrant signature');
    else add('na', 'Signature check unavailable', 'this browser lacks WebCrypto Ed25519 — ' + (sig.error || ''));

    // 3. academy co-sign
    if (b.integrity && b.integrity.academySignature) add('ok', 'Academy co-signature present', 'proctored — co-signed by the Academy registrar (verify against the published Academy key)');
    else add('na', 'No Academy co-signature', 'self-reported run (a Certified badge requires an Academy-proctored, co-signed run)');

    // 4. per-task trace signals (aggregate)
    const agg = { 'answered-without-measurement': 0, 'missing-emit-provenance': 0, 'implausible-speed': 0, 'planset-hash-mismatch': 0 };
    let anchored = 0, total = (b.tasks || []).length;
    for (const task of (b.tasks || [])) {
      const s = traceSignals(task);
      for (const f in agg) if (s.flags[f]) agg[f]++;
      if (s.anchor && s.anchor.assetHash) anchored++;
    }
    add(anchored === total && total > 0 ? 'ok' : 'warn', 'Planset bound by sha256', anchored + '/' + total + ' task(s) anchor the run to the exact planset asset hash');
    const FLAG_TXT = {
      'answered-without-measurement': 'emitted a quantity with no measurement/tool step',
      'missing-emit-provenance': 'reported more quantities than emit_quantity calls',
      'implausible-speed': 'faster than physically plausible for the work',
      'planset-hash-mismatch': 'measured a planset whose hash != the declared one',
    };
    for (const f in agg) {
      if (agg[f] > 0) add('bad', 'Anti-cheat flag: ' + f, FLAG_TXT[f] + ' — ' + agg[f] + ' task(s)');
    }
    const clean = Object.values(agg).every((n) => n === 0);
    if (clean) add('ok', 'No trace-level anti-cheat flags', 'the agent operated the tools and emitted with provenance');

    $('integrityNote').textContent = 'Trace-level signals are computed from the trace alone. The full scored provenance flags (which need the held-out answer key) are produced by the Academy scorer; a Certified badge additionally requires an Academy co-signed, proctored run.';
  }

  function shortJson(obj, max) {
    let s;
    try { s = JSON.stringify(obj, null, 2); } catch (e) { s = String(obj); }
    if (max && s.length > max) s = s.slice(0, max) + '\n… (' + (s.length - max) + ' more chars)';
    return s;
  }

  // pull a few human highlights out of a step's args/result
  function highlights(step) {
    const out = [];
    const r = step.result, a = step.args;
    if (step.type === 'model_message' && step.tokens) out.push(['tokens', (step.tokens.in || 0) + '→' + (step.tokens.out || 0)]);
    if (step.type === 'model_message' && r && Array.isArray(r.tool_calls) && r.tool_calls.length) out.push(['calls', r.tool_calls.map((t) => t.name).join(', ')]);
    if (a && a.roomId != null) out.push(['roomId', a.roomId]);
    if (a && a.from) out.push(['from', a.from]);
    if (r && typeof r === 'object') {
      if (typeof r.area === 'number') out.push(['area', r.area + ' ' + (r.areaUnit || 'sf')]);
      if (typeof r.pxPerUnit === 'number') out.push(['pxPerUnit', r.pxPerUnit]);
      if (r.scaleLabel) out.push(['scale', r.scaleLabel]);
      if (typeof r.upp === 'number') out.push(['upp', r.upp]);
      if (r.recorded && r.recorded.item != null) out.push(['recorded', r.recorded.item + ' = ' + r.recorded.value + ' ' + r.recorded.unit]);
      if (r.assetHash) out.push(['assetHash', String(r.assetHash).slice(0, 16) + '…' + (r.verified === true ? ' ✓' : r.verified === false ? ' ✗' : '')]);
      if (r.error) out.push(['error', r.error]);
    }
    return out;
  }

  function renderTimeline(b) {
    const tl = $('timeline');
    tl.textContent = '';
    const multi = (b.tasks || []).length > 1;
    for (const task of (b.tasks || [])) {
      if (multi) { const sep = el('li'); sep.appendChild(el('div', 'task-sep', 'TASK · ' + task.taskId)); tl.appendChild(sep); }
      for (const step of (task.trace || [])) {
        const li = el('li', 'tl-step');
        const g = el('div', 'tl-gutter');
        g.appendChild(el('div', null, '#' + step.seq));
        const t = el('div', 't', '+' + (step.tOffsetMs || 0) + 'ms'); g.appendChild(t);
        li.appendChild(g);

        const card = el('div', 'tl-card t-' + step.type);
        const row1 = el('div', 'row1');
        row1.appendChild(el('span', 'tl-type b-' + step.type, step.type.replace('_', ' ')));
        if (step.tool) row1.appendChild(el('span', 'tl-tool', step.tool));
        if (step.type === 'model_message' && step.result && step.result.content) row1.appendChild(el('span', 'tl-note', String(step.result.content).slice(0, 160)));
        if (step.server) row1.appendChild(el('span', 'tl-note', '@' + step.server));
        card.appendChild(row1);

        const hs = highlights(step);
        if (hs.length) {
          const kvs = el('div', 'tl-kvs');
          for (const [k, v] of hs) { const s = el('span', 'tl-kv'); s.innerHTML = k + ': '; const bEl = el('b', null, String(v)); s.appendChild(bEl); kvs.appendChild(s); }
          card.appendChild(kvs);
        }
        if (step.args !== undefined || step.result !== undefined) {
          const d = el('details', 'tl-json');
          d.appendChild(el('summary', null, 'raw'));
          const body = {};
          if (step.args !== undefined) body.args = step.args;
          if (step.result !== undefined) body.result = step.result;
          d.appendChild(el('pre', null, shortJson(body, 4000)));
          card.appendChild(d);
        }
        li.appendChild(card);
        tl.appendChild(li);
      }
    }
    // tab summary + legend
    const totalSteps = (b.tasks || []).reduce((n, t) => n + (t.trace || []).length, 0);
    $('traceTabs').textContent = totalSteps + ' steps';
    const legend = $('traceLegend'); legend.textContent = '';
    const types = [['model_message', 'model'], ['tool_call', 'tool call'], ['tool_result', 'tool result'], ['mcp_call', 'mcp'], ['error', 'error']];
    for (const [cls, label] of types) {
      const lg = el('span', 'lg');
      const dot = el('span', 'dot b-' + cls); lg.appendChild(dot); lg.appendChild(document.createTextNode(label));
      legend.appendChild(lg);
    }
  }

  // ==========================================================================
  // OpenTelemetry GenAI export (OTLP/JSON, relative-timed).
  // Aligns to the gen_ai.* semantic conventions so the run is portable to any
  // OTLP sink (LangSmith / Phoenix / Braintrust / Langfuse).
  // ==========================================================================
  function hexId(seed, len) {
    let h = 0x811c9dc5 >>> 0;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    let out = '';
    for (let i = 0; i < len; i++) { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; out += (h & 0xff).toString(16).padStart(2, '0'); }
    return out.slice(0, len * 2);
  }
  const attr = (k, v) => ({ key: k, value: (typeof v === 'number' && Number.isInteger(v)) ? { intValue: v } : { stringValue: String(v) } });

  function toOtel(b) {
    const traceId = hexId(b.runId, 16);
    const spans = [];
    const runSpanId = hexId(b.runId + ':run', 8);
    spans.push({
      traceId, spanId: runSpanId, name: 'opentakeoff.academy run', kind: 2,
      startTimeUnixNano: '0', endTimeUnixNano: String((b.telemetry && b.telemetry.totalWallMs || 0) * 1e6),
      attributes: [
        attr('gen_ai.system', 'opentakeoff-academy'),
        attr('gen_ai.request.model', (b.contestant && b.contestant.modelId) || 'unknown'),
        attr('opentakeoff.run_id', b.runId), attr('opentakeoff.track', b.track || ''),
        attr('opentakeoff.suite', (b.suite && b.suite.id) || ''), attr('opentakeoff.mode', (b.suite && b.suite.mode) || ''),
      ],
    });
    (b.tasks || []).forEach((task, ti) => {
      const taskSpanId = hexId(b.runId + ':t' + ti, 8);
      const taskEnd = String((task.telemetry && task.telemetry.wallMs || 0) * 1e6);
      spans.push({
        traceId, spanId: taskSpanId, parentSpanId: runSpanId, name: 'task ' + task.taskId, kind: 1,
        startTimeUnixNano: '0', endTimeUnixNano: taskEnd,
        attributes: [attr('opentakeoff.task_id', task.taskId), attr('opentakeoff.n_quantities', (task.answer && task.answer.quantities || []).length)],
      });
      (task.trace || []).forEach((step) => {
        const start = String((step.tOffsetMs || 0) * 1e6);
        const a = [attr('opentakeoff.step_seq', step.seq), attr('opentakeoff.step_type', step.type)];
        let name = step.type;
        if (step.type === 'model_message') {
          name = 'chat ' + ((b.contestant && b.contestant.modelId) || 'model');
          a.push(attr('gen_ai.operation.name', 'chat'), attr('gen_ai.request.model', (b.contestant && b.contestant.modelId) || 'unknown'));
          if (step.tokens) { a.push(attr('gen_ai.usage.input_tokens', step.tokens.in || 0), attr('gen_ai.usage.output_tokens', step.tokens.out || 0)); }
        } else if (step.type === 'tool_call' || step.type === 'tool_result') {
          name = 'execute_tool ' + (step.tool || '');
          a.push(attr('gen_ai.operation.name', 'execute_tool'), attr('gen_ai.tool.name', step.tool || ''));
          if (step.type === 'tool_call' && step.args !== undefined) a.push(attr('gen_ai.tool.call.arguments', shortJson(step.args, 2000)));
          if (step.type === 'tool_result' && step.result !== undefined) a.push(attr('gen_ai.tool.message', shortJson(step.result, 2000)));
        } else if (step.type === 'mcp_call' || step.type === 'mcp_result') {
          name = 'mcp ' + (step.tool || '');
          a.push(attr('gen_ai.operation.name', 'execute_tool'), attr('gen_ai.tool.name', step.tool || ''), attr('mcp.server', step.server || ''));
        } else if (step.type === 'error') {
          a.push(attr('error.type', (step.result && step.result.error) || 'error'));
        }
        spans.push({ traceId, spanId: hexId(b.runId + ':' + ti + ':' + step.seq, 8), parentSpanId: taskSpanId, name, kind: 3, startTimeUnixNano: start, endTimeUnixNano: start, attributes: a });
      });
    });
    return {
      resourceSpans: [{
        resource: { attributes: [attr('service.name', 'opentakeoff-academy'), attr('gen_ai.system', 'opentakeoff-academy'), attr('opentakeoff.time_basis', 'relative_ms_from_task_start')] },
        scopeSpans: [{ scope: { name: 'opentakeoff-academy', version: (b.telemetry && b.telemetry.sdkVersion) || '' }, spans }],
      }],
    };
  }

  function downloadOtel() {
    if (!CURRENT) return;
    const blob = new Blob([JSON.stringify(toOtel(CURRENT), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'run-' + String(CURRENT.runId || 'bundle').replace(/[^a-z0-9_-]+/gi, '').slice(0, 24) + '.otel.json';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // ==========================================================================
  // Load + wire
  // ==========================================================================
  function looksLikeBundle(o) { return o && o.integrity && Array.isArray(o.tasks) && o.runId; }

  async function inspect(bundle, sourceLabel) {
    if (!looksLikeBundle(bundle)) { note('That does not look like a run-bundle (needs runId, tasks[], integrity).', true); return; }
    CURRENT = bundle;
    renderHeader(bundle);
    renderTimeline(bundle);
    await renderIntegrity(bundle);
    $('result').hidden = false;
    note('Loaded ' + (sourceLabel || 'bundle') + ' · ' + (bundle.tasks || []).length + ' task(s). Nothing was uploaded.');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function note(msg, isErr) { const n = $('loadNote'); n.textContent = msg; n.className = 'load-note' + (isErr ? ' err' : ''); }

  async function loadUrl(url, label) {
    note('Loading ' + (label || url) + '…');
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await inspect(await res.json(), label || url);
    } catch (e) { note('Could not load ' + url + ' — ' + (e.message || e), true); }
  }

  function wire() {
    $('loadExample').addEventListener('click', () => loadUrl(DEFAULT_BUNDLE, 'the reference run'));
    $('fileInput').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { inspect(JSON.parse(r.result), f.name); } catch (e) { note('Not valid JSON — ' + e.message, true); } };
      r.readAsText(f);
    });
    $('pasteToggle').addEventListener('click', () => { const w = $('pasteWrap'); w.hidden = !w.hidden; if (!w.hidden) $('pasteArea').focus(); });
    $('pasteGo').addEventListener('click', () => { try { inspect(JSON.parse($('pasteArea').value), 'pasted bundle'); } catch (e) { note('Not valid JSON — ' + e.message, true); } });
    $('otelBtn').addEventListener('click', downloadOtel);

    const params = new URLSearchParams(location.search);
    const src = params.get('bundle');
    if (src && /^runs\//.test(src)) loadUrl(src, src);       // same-origin runs/ only
    else loadUrl(DEFAULT_BUNDLE, 'the reference run');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
