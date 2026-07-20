// src/ot-backend.js
//
// OpenTakeoffBackend — the CERTIFIED-path backend for src/environment.js. It
// answers the SAME three geometric questions the SvgGeometryBackend answers
// (getFeatures / resolveRoom / countSymbols / getScaleBar), but instead of
// parsing a static practice SVG it drives the REAL OpenTakeoff engine
// (`opentakeoff-mcp`) over stdio: it loads the plan PDF, adopts the sheet's
// detected scale, and floods each room with the engine's One-Click Area tool to
// obtain the actual traced polygon. The environment above is UNCHANGED when this
// backend is swapped in.
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
// agent calibrates off it, the environment's shoelace over the engine's REAL
// vertices reproduces the engine's One-Click area. Calibrate wrong → wrong area,
// exactly like the SVG backend: grounding is preserved.
//
// ── Async construction, sync serving ───────────────────────────────────────
// The environment calls the backend synchronously, so all engine I/O happens up
// front in createOpenTakeoffBackend(): load plan → set scale → discover rooms →
// cache polygons, then the subprocess is closed and the four methods answer from
// the cache. Traced-polygon measurements (region.points) never touch the engine
// — the environment's own shoelace at the engine-derived scale is identical to
// the engine's measure_polygon, so no live connection is needed after discovery.
//
// Deterministic: no Date.now(), no Math.random(). Candidate click points are
// tried in a fixed order.

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
    this._roomIndex = indexRooms(cache.rooms);
    this._unresolved = cache.unresolved || [];
  }

  /** @returns {{rooms:Array, symbols:Array, scaleBar:(object|null), viewBox:object}} */
  getFeatures() { return this._features; }

  /** Resolve a room by id/number/name to the engine's real pixel polygon. */
  resolveRoom(roomId) {
    if (!roomId) return null;
    return this._roomIndex.get(normStr(roomId)) || null;
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

  /** Rooms the engine could not cleanly flood (diagnostic; not an error). */
  unresolvedRooms() { return this._unresolved; }
}

/**
 * Build an OpenTakeoffBackend by driving the real engine over one connection.
 *
 * @param {object} opts
 * @param {string}  opts.plansetPath          - absolute path to the plan PDF
 * @param {string}  [opts.mcpDir]             - engine dir (else auto-resolved)
 * @param {Array}   [opts.rooms]              - room hints (see below); when omitted,
 *                                              rooms are auto-discovered from labels
 * @param {string}  [opts.unit='ft']          - imperial only (engine is feet-based)
 * @param {number}  [opts.scaleBarRealFeet=10]- the synthetic scale bar's labeled length
 * @param {function}[opts.log]                - progress logger
 * @param {number}  [opts.connectTimeoutMs] @param {number}[opts.callTimeoutMs]
 *
 * Room hint shape (all fields optional except id):
 *   { id: '162', condition: 'WD-1',
 *     points: [[x,y], ...],            // candidate click points, tried in order
 *     search: '162',                    // label text to locate if points omitted
 *     plausibleSf: [lo, hi] }           // reject fills outside this SF window
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

    // 3) Text on the sheet — labels double as room locators.
    let textItems = [];
    try {
      const txt = await engine.call('read_sheet_text', { sheet, region: { x0: 0, y0: 0, x1: W, y1: H } });
      textItems = Array.isArray(txt?.items) ? txt.items : [];
    } catch (e) {
      log(`read_sheet_text unavailable (${e.message}); auto-discovery from labels disabled`);
    }

    // 4) Build the room list to resolve: explicit hints, else auto from labels.
    const hints = Array.isArray(opts.rooms) && opts.rooms.length
      ? opts.rooms.map(normalizeHint)
      : autoHintsFromText(textItems);
    log(`resolving ${hints.length} room(s) via the engine…`);

    const rooms = [];
    const unresolved = [];
    for (const hint of hints) {
      const resolved = await floodRoom(engine, sheet, hint, { textItems, W, H, log });
      if (resolved) rooms.push(resolved);
      else unresolved.push(hint.id);
    }
    if (unresolved.length) log(`unresolved rooms (no clean fill): ${unresolved.join(', ')}`);

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
      rooms, unresolved,
      scaleBar,
      viewBox: { width: W, height: H },
    });
  } finally {
    await engine.close();       // all geometry cached; the subprocess is done
  }
}

// ---------------------------------------------------------------------------
// Room flooding — robust One-Click over candidate points
// ---------------------------------------------------------------------------

/**
 * Flood one room with the engine's One-Click Area tool and return its real
 * polygon. Robustness (mirrors the validated AF101 run):
 *   - try each candidate click point in order (explicit hint points first, then
 *     an offset ring around the room's label — clicking ON a label fills the
 *     glyph, so we offset into open floor);
 *   - accept the first clean fill (status ok) whose area is plausible AND whose
 *     polygon CONTAINS the label point (guarantees we filled the label's own room
 *     and not a neighbor). If none contains the label, fall back to the largest
 *     plausible clean fill;
 *   - a leak / dense-linework click is a readable engine error we skip past.
 * Discovery does NOT commit shapes (no `condition`), so it never pollutes a
 * takeoff.
 * @returns {object|null} room record { roomId, material, polygonPx, bboxPx, centroidPx, areaSfEngine }
 */
async function floodRoom(engine, sheet, hint, ctx) {
  const label = locateLabel(hint, ctx.textItems);
  const labelPt = label ? { x: label.x, y: label.y } : null;
  const candidates = candidatePoints(hint, labelPt, ctx.W, ctx.H);
  const [lo, hi] = hint.plausibleSf || [0, Infinity];

  let fallback = null;   // best plausible fill that didn't contain the label
  for (const pt of candidates) {
    let r;
    try {
      r = await engine.call('one_click', { sheet, x: pt.x, y: pt.y, condition: undefined, return_verts: true });
    } catch (e) {
      ctx.log?.(`  [${hint.id}] click (${pt.x},${pt.y}) → ${e.message}`);
      continue;                                   // leak / hatching / off-building
    }
    const area = typeof r?.area_sf === 'number' ? r.area_sf : null;
    const verts = normVerts(r?.verts);
    if (area == null || !verts) continue;         // px-only (no scale) or no polygon
    if (!(area >= lo && area <= hi)) {            // implausible → try next point
      ctx.log?.(`  [${hint.id}] click (${pt.x},${pt.y}) → ${area} sf implausible (want ${lo}–${hi})`);
      continue;
    }
    const record = roomRecord(hint, verts, area);
    if (!labelPt || pointInPolygon(labelPt, verts)) {
      ctx.log?.(`  [${hint.id}] ✓ ${area} sf (${verts.length} verts) @ (${pt.x},${pt.y})`);
      return record;
    }
    if (!fallback || area > fallback.areaSfEngine) fallback = record;  // largest plausible so far
  }
  if (fallback) ctx.log?.(`  [${hint.id}] ~ ${fallback.areaSfEngine} sf (label not enclosed; largest plausible fill)`);
  return fallback;
}

/** Assemble a cached room record from engine vertices. */
function roomRecord(hint, verts, areaSfEngine) {
  const bboxPx = bboxOf(verts);
  return {
    roomId: hint.id,
    material: hint.condition || null,
    polygonPx: verts,
    bboxPx,
    centroidPx: { x: bboxPx.x + bboxPx.width / 2, y: bboxPx.y + bboxPx.height / 2 },
    areaSfEngine,
  };
}

/** Candidate click points: hint.points first, then an offset ring around the label. */
function candidatePoints(hint, labelPt, W, H) {
  const pts = [];
  for (const p of hint.points || []) {
    const xy = asPoint(p);
    if (xy) pts.push(xy);
  }
  if (labelPt) {
    // Offset into open floor: a fixed ring of directions × radii, in px. Scaled
    // modestly to the sheet so it works across drawing densities.
    const base = Math.max(24, Math.round(Math.min(W, H) * 0.012));
    const radii = [base, base * 2, base * 3, base * 4];
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const rad of radii) {
      for (const [dx, dy] of dirs) {
        pts.push({ x: Math.round(labelPt.x + dx * rad), y: Math.round(labelPt.y + dy * rad) });
      }
    }
  }
  return dedupePoints(pts);
}

/** Locate a room's label on the sheet by explicit search text or the room id. */
function locateLabel(hint, textItems) {
  const wanted = normStr(hint.search || hint.id);
  if (!wanted || !textItems.length) return null;
  // Exact match first, then a contains match (labels sometimes carry suffixes).
  return (
    textItems.find((t) => normStr(t.str) === wanted) ||
    textItems.find((t) => normStr(t.str).includes(wanted)) ||
    null
  );
}

/** Auto room hints: text items that look like room numbers become locators. */
function autoHintsFromText(textItems) {
  const seen = new Set();
  const hints = [];
  for (const t of textItems) {
    const s = String(t?.str ?? '').trim();
    // A room number: 2–4 digits, optional letter suffix (e.g. "162", "162A").
    if (!/^\d{2,4}[A-Za-z]?$/.test(s)) continue;
    const key = normStr(s);
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push({ id: s, search: s, points: [] });
  }
  return hints;
}

// ---------------------------------------------------------------------------
// geometry + small helpers
// ---------------------------------------------------------------------------

/** Ray-casting point-in-polygon for a px polygon [[x,y],...]. */
function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = (yi > pt.y) !== (yj > pt.y) &&
      pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function bboxOf(verts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of verts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function normVerts(raw) {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const out = [];
  for (const p of raw) {
    const xy = asPoint(p);
    if (!xy) return null;
    out.push([xy.x, xy.y]);
  }
  return out;
}

function asPoint(p) {
  if (Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) return { x: +p[0], y: +p[1] };
  if (p && typeof p === 'object' && Number.isFinite(+p.x) && Number.isFinite(+p.y)) return { x: +p.x, y: +p.y };
  return null;
}

function dedupePoints(pts) {
  const seen = new Set();
  const out = [];
  for (const p of pts) {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function normalizeHint(h) {
  if (typeof h === 'string') return { id: h, search: h, points: [] };
  return {
    id: String(h.id ?? h.roomId ?? h.room ?? ''),
    condition: h.condition || h.finish || h.material || null,
    points: Array.isArray(h.points) ? h.points : [],
    search: h.search || h.label || null,
    plausibleSf: Array.isArray(h.plausibleSf) ? h.plausibleSf : (Array.isArray(h.plaus) ? h.plaus : null),
  };
}

function indexRooms(rooms) {
  const m = new Map();
  for (const r of rooms) {
    m.set(normStr(r.roomId), r);
    // Also index a bare "RM-162" ↔ "162" style alias.
    const bare = normStr(String(r.roomId).replace(/^rm[-\s]?/i, ''));
    if (bare && !m.has(bare)) m.set(bare, r);
  }
  return m;
}

function normStr(s) { return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
function round4(x) { return Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x; }
function round6(x) { return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x; }
