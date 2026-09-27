// src/ot-backend.js
//
// OpenTakeoffBackend — the CERTIFIED-path backend for src/environment.js. It
// drives the REAL OpenTakeoff engine (`opentakeoff-mcp`) over stdio: it loads
// the plan PDF and adopts the sheet's detected scale, so the agent calibrates and
// measures in the engine's own pixel frame (render scale 2.0). The environment
// above is UNCHANGED when this backend is swapped in.
//
// No flood fill. Rooms are never auto-filled from a click: the agent traces each
// room on its wall faces and measures the polygon (region.points). A roomId-only
// measure has nothing to resolve and is refused with a note to trace the room.
//
// This DEPLOYS/DRIVES an OpenTakeoff-grade engine; it does NOT modify OpenTakeoff.
//
// ── Why the numbers reconcile exactly ──────────────────────────────────────
// The engine works in image px at render scale 2.0 and computes
//   area_sf = pixelArea * upp²           (upp = real feet per px)
// The academy environment computes
//   area   = pixelArea / pxPerUnit²
// so the two agree iff  pxPerUnit = 1/upp. getScaleBar() therefore reports a
// scale synthesized from the engine's detected upp (pxPerUnit = 1/upp): once the
// agent calibrates off it, the environment's shoelace over a traced polygon
// equals the engine's measure_polygon. Calibrate wrong → wrong area.
//
// ── Async construction, sync serving ───────────────────────────────────────
// The environment calls the backend synchronously, so all engine I/O happens up
// front in createOpenTakeoffBackend(): load plan → set scale, then the
// subprocess is closed and the methods answer from the cache.
//
// Deterministic: no Date.now(), no Math.random().

import { connectOtEngine, OtEngineError } from './ot-mcp-client.js';

/**
 * OpenTakeoffBackend — serves cached engine geometry through the backend
 * interface. Build it with {@link createOpenTakeoffBackend}, never `new` directly
 * (construction requires async engine I/O).
 */
export class OpenTakeoffBackend {
  /** @param {object} cache - prebuilt by createOpenTakeoffBackend */
  constructor(cache) {
    this.assetRef = cache.assetRef || null;
    this.engine = { sheet: cache.sheet, upp: cache.upp, scaleLabel: cache.scaleLabel, source: 'opentakeoff-mcp' };
    this._features = {
      rooms: cache.rooms,
      symbols: [],                    // the engine has no symbol-detection tool
      scaleBar: cache.scaleBar,
      viewBox: cache.viewBox,
    };
  }

  /** @returns {{rooms:Array, symbols:Array, scaleBar:(object|null), viewBox:object}} */
  getFeatures() { return this._features; }

  /** No flood fill: rooms are traced by the agent, never resolved by id. */
  resolveRoom() { return null; }

  /** Why a roomId-only measure is refused on this backend. */
  get roomLookupNote() {
    return 'rooms are not auto-filled on the OpenTakeoff engine (no flood fill); trace the room on its wall faces and pass region.points';
  }

  /**
   * Symbol counting is NOT available on the engine backend: OpenTakeoff's MCP
   * surface has no symbol-detection tool. Rather than fabricate a zero, we say so
   * — a count task belongs on a BYO harness (read_sheet_text + your own vision).
   */
  countSymbols(query) {
    return {
      count: 0,
      matched: [],
      symbolType: null,
      unsupported: true,
      note: `symbol counting is not available on the OpenTakeoff engine backend (no symbol-detection tool); count '${query || 'symbols'}' via a BYO harness`,
    };
  }

  /** @returns {object|null} scale synthesized from the engine's detected upp. */
  getScaleBar() { return this._features.scaleBar; }
}

/**
 * Build an OpenTakeoffBackend by driving the real engine over one connection.
 *
 * @param {object} opts
 * @param {string}  opts.plansetPath          - absolute path to the plan PDF
 * @param {string}  [opts.mcpDir]             - engine dir (else auto-resolved)
 * @param {string}  [opts.unit='ft']          - imperial only (engine is feet-based)
 * @param {number}  [opts.scaleBarRealFeet=10]- the synthetic scale bar's labeled length
 * @param {function}[opts.log]                - progress logger
 * @param {number}  [opts.connectTimeoutMs] @param {number}[opts.callTimeoutMs]
 *
 * @returns {Promise<OpenTakeoffBackend>}
 */
export async function createOpenTakeoffBackend(opts = {}) {
  const log = opts.log || (() => {});
  const unit = opts.unit || 'ft';
  if (unit !== 'ft') {
    throw new OtEngineError(`OpenTakeoffBackend is imperial-only (the engine measures in feet); got unit='${unit}'`, { code: 'bad-unit' });
  }
  if (!opts.plansetPath) throw new OtEngineError('createOpenTakeoffBackend requires { plansetPath }', { code: 'no-planset' });

  // opts.engineClient is a dependency-injection seam: pass a connected client
  // (anything with .call()/.close()) to drive an already-open engine or a mock in
  // tests. Otherwise spawn a fresh engine subprocess.
  const engine = opts.engineClient || await connectOtEngine({ mcpDir: opts.mcpDir, connectTimeoutMs: opts.connectTimeoutMs, callTimeoutMs: opts.callTimeoutMs });
  try {
    // 1) Load the plan (PDF parse can be slow → generous timeout).
    const lp = await engine.call('load_plan', { path: opts.plansetPath }, { timeoutMs: Math.max(120000, engine.callTimeoutMs) });
    const s0 = lp?.sheets?.[0];
    if (!s0?.sheet) throw new OtEngineError(`load_plan returned no sheets for ${opts.plansetPath}`, { code: 'no-sheet' });
    const sheet = s0.sheet;
    const W = s0.width_px, H = s0.height_px;
    log(`load_plan: sheet=${sheet} ${W}x${H}px detected_scale=${JSON.stringify(s0.detected_scale)}`);

    // 2) Adopt the sheet's detected scale (the engine never applies it silently).
    let ss;
    try {
      ss = await engine.call('set_scale', { sheet, use_detected: true });
    } catch (e) {
      throw new OtEngineError(
        `could not set scale from the detected note (${e.message}). The certified planset must carry a readable scale, ` +
        'or supply an explicit upp/scale hint.', { code: 'no-scale' });
    }
    const upp = ss?.upp;
    if (!(upp > 0)) throw new OtEngineError(`engine returned a non-positive upp (${upp})`, { code: 'bad-upp' });
    const pxPerFoot = 1 / upp;
    log(`set_scale: upp=${upp} (${(ss.label || s0.detected_scale || '').toString()}) → pxPerFoot=${round4(pxPerFoot)}`);

    const scaleBarRealFeet = opts.scaleBarRealFeet ?? 10;
    const scaleBar = {
      present: true,
      spanPx: round4(scaleBarRealFeet * pxPerFoot),
      realLength: scaleBarRealFeet,
      unit: 'ft',
      pxPerUnit: round6(pxPerFoot),
      unitPerPx: round6(upp),
      source: 'detected',
      label: ss.label || s0.detected_scale || null,
    };

    return new OpenTakeoffBackend({
      assetRef: opts.plansetPath,
      sheet, upp, scaleLabel: scaleBar.label,
      rooms: [],
      scaleBar,
      viewBox: { width: W, height: H },
    });
  } finally {
    await engine.close();       // all geometry cached; the subprocess is done
  }
}

function round4(x) { return Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x; }
function round6(x) { return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x; }
