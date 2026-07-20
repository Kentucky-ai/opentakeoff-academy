// src/environment.js
//
// The OpenTakeoff environment — a REAL takeoff sandbox the agent operates. The
// built-in tools (set_scale, measure_area, measure_length, count,
// identify_scope, emit_quantity) are backed by the planset's actual geometry:
// the agent calibrates px→units, then every measurement is COMPUTED from the
// plan at the agent's current scale. Calibrate wrong and areas come out wrong —
// that is intended. Agents are scored on OPERATING the tool, not self-reporting
// numbers.
//
// The backend is pluggable behind one interface:
//   - SvgGeometryBackend (ships now): parses the planset SVG's known geometry
//     and answers measurements exactly. Used for the public practice suites.
//   - OpenTakeoffBackend (documented seam / stub): the CERTIFIED path runs the
//     same environment against a DEPLOYED OpenTakeoff instance/engine behind the
//     identical interface. This module DEPLOYS/DRIVES OpenTakeoff-grade takeoff;
//     it does NOT modify the OpenTakeoff source.
//
// Everything here is deterministic: no Date.now(), no Math.random().

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------
//
// A backend answers three geometric questions about a planset, in PIXELS (the
// environment applies the agent's calibrated scale on top):
//   getFeatures()            -> { rooms, symbols, scaleBar, viewBox }
//   resolveRoom(roomId)      -> { roomId, polygonPx, bboxPx, ... } | null
//   countSymbols(query,region)-> { count, matched, symbolType }
//   getScaleBar()            -> { present, spanPx, realLength, unit, pxPerUnit } | null
//
// SvgGeometryBackend implements this by parsing the SVG; OpenTakeoffBackend
// implements it by querying a live OpenTakeoff takeoff engine.

const ROOM_FILL = '#f4f6f8';                 // interior fill used for room rects in the practice plansets
const MATERIAL_WORDS = ['lvt', 'carpet', 'ceramic tile', 'porcelain tile', 'ceramic', 'porcelain', 'tile', 'vct', 'rubber', 'terrazzo', 'epoxy', 'sealed concrete', 'polished concrete', 'concrete', 'wood', 'resilient', 'sheet vinyl', 'vinyl'];

/**
 * SvgGeometryBackend — parses the KNOWN geometry of a planset SVG and answers
 * measurements exactly (rooms, fixture symbols, the graphic scale bar). This is
 * the practice-suite backend; a real deployed instance plugs in as
 * OpenTakeoffBackend behind the same three methods.
 */
export class SvgGeometryBackend {
  /**
   * @param {string|null} svgText - raw SVG markup (null when no asset is on disk)
   * @param {object} [meta] - { assetRef }
   */
  constructor(svgText, meta = {}) {
    this.assetRef = meta.assetRef || null;
    this.svg = typeof svgText === 'string' ? svgText : null;
    this._features = this.svg ? parseSvgFeatures(this.svg) : emptyFeatures();
  }

  /** @returns {{rooms:Array, symbols:Array, scaleBar:(object|null), viewBox:object}} */
  getFeatures() { return this._features; }

  /** Resolve a room by id to its real pixel polygon. @returns {object|null} */
  resolveRoom(roomId) {
    if (!roomId) return null;
    const key = normStr(roomId);
    return this._features.rooms.find((r) => normStr(r.roomId) === key) || null;
  }

  /**
   * Count fixture symbols matching a query, optionally within a pixel region.
   * @param {string} query - e.g. 'floor drain', 'FD'
   * @param {object} [region] - { x,y,width,height } bbox in px
   * @returns {{count:number, matched:Array, symbolType:(string|null)}}
   */
  countSymbols(query, region) {
    const symbols = this._features.symbols;
    const wanted = symbolTypeForQuery(query);
    let matched = symbols.filter((s) => wanted == null || s.kind === wanted || normStr(s.label) === normStr(query));
    const bbox = regionBbox(region);
    if (bbox) matched = matched.filter((s) => pointInBbox(s.x, s.y, bbox));
    return { count: matched.length, matched: matched.map((s) => ({ kind: s.kind, label: s.label, x: s.x, y: s.y })), symbolType: matched[0]?.kind || wanted || null };
  }

  /** @returns {object|null} the graphic scale bar's pixel span + labeled real length. */
  getScaleBar() { return this._features.scaleBar; }
}

/**
 * OpenTakeoffBackend — the CERTIFIED-path backend. Instead of parsing a static
 * SVG, it drives the REAL OpenTakeoff engine (`opentakeoff-mcp`) over stdio and
 * returns the engine's actual pixel geometry through the SAME methods
 * SvgGeometryBackend exposes, so the environment above is unchanged when it is
 * swapped in. It is async to construct (it does engine I/O up front), so it lives
 * in its own module and is built via `createOpenTakeoffBackend(...)`.
 *
 * Re-exported here so the backend name resolves from either module. See
 * `src/ot-backend.js` for the implementation and the exact reconciliation math
 * (pxPerUnit = 1/upp), and `src/ot-mcp-client.js` for the engine transport.
 */
export { OpenTakeoffBackend, createOpenTakeoffBackend } from './ot-backend.js';

// ---------------------------------------------------------------------------
// The environment (operations layer)
// ---------------------------------------------------------------------------

/**
 * Create an OpenTakeoff environment for one task/planset. State (the calibrated
 * scale) persists across calls, so set_scale → measure_* behaves like operating
 * a real takeoff tool.
 *
 * @param {object} opts
 * @param {object} [opts.task] - the task (used for units, assetRef)
 * @param {string|null} [opts.assetContent] - raw planset markup (SVG) if on disk
 * @param {string|null} [opts.assetPath] - resolved asset path (informational)
 * @param {object} [opts.backend] - a pre-built backend (defaults to SvgGeometryBackend over assetContent)
 * @param {string} [opts.unit] - real-world linear unit ('ft' | 'm'); inferred from task.planset.units
 * @returns {object} environment with invoke(name,args) + typed methods
 */
export function createEnvironment(opts = {}) {
  const unit = opts.unit || (opts.task?.planset?.units === 'metric' ? 'm' : 'ft');
  const backend = opts.backend || new SvgGeometryBackend(opts.assetContent ?? null, { assetRef: opts.task?.planset?.assetRef });

  const state = { pxPerUnit: null, unit, calibrated: false, source: null };

  const env = {
    backend,
    state,

    /** Route a built-in tool call to the real operation. */
    invoke(name, args = {}) {
      switch (name) {
        case 'set_scale': return env.setScale(args);
        case 'measure_area': return env.measureArea(args);
        case 'measure_length': return env.measureLength(args);
        case 'count': return env.count(args);
        case 'identify_scope': return env.identifyScope(args);
        case 'emit_quantity': return env.emitQuantity(args);
        default: return { ok: false, error: 'unknown-tool', tool: name };
      }
    },

    /**
     * Calibrate px→units. Accepts any of:
     *   { pxPerUnit, unit }
     *   { referencePx, referenceLength, unit }     (a measured reference, e.g. a scale bar)
     *   { from: 'scale-bar', referenceLength?, unit? }  (calibrate off the plan's graphic bar)
     * Stores the scale and USES it for every later measurement.
     */
    setScale(args = {}) {
      let pxPerUnit = null;
      let outUnit = args.unit || state.unit;
      let source = null;

      const wantsBar = String(args.from || args.reference || '').toLowerCase().includes('scale-bar')
        || args.useScaleBar === true || args.scaleBar === true;

      if (wantsBar) {
        const bar = backend.getScaleBar();
        if (!bar || !bar.present) return { ok: false, error: 'no-scale-bar', note: 'no graphic scale bar found on this planset; supply pxPerUnit or referencePx+referenceLength' };
        const refLen = num(args.referenceLength) ?? bar.realLength;
        if (!(refLen > 0)) return { ok: false, error: 'bad-reference-length', note: 'scale bar length not readable; supply referenceLength' };
        pxPerUnit = bar.spanPx / refLen;
        outUnit = args.unit || bar.unit || outUnit;
        source = 'scale-bar';
      } else if (Number.isFinite(num(args.pxPerUnit))) {
        pxPerUnit = num(args.pxPerUnit);
        source = 'pxPerUnit';
      } else if (Number.isFinite(num(args.referencePx)) && Number.isFinite(num(args.referenceLength))) {
        const rl = num(args.referenceLength);
        if (!(rl > 0)) return { ok: false, error: 'bad-reference-length', note: 'referenceLength must be > 0' };
        pxPerUnit = num(args.referencePx) / rl;
        source = 'reference';
      } else {
        return { ok: false, error: 'insufficient-scale-args', note: 'provide pxPerUnit, or referencePx+referenceLength, or from:"scale-bar"' };
      }

      if (!(pxPerUnit > 0) || !Number.isFinite(pxPerUnit)) {
        return { ok: false, error: 'bad-scale', note: 'computed pixels-per-unit is not a positive number' };
      }

      state.pxPerUnit = pxPerUnit;
      state.unit = outUnit;
      state.calibrated = true;
      state.source = source;
      const unitPerPx = 1 / pxPerUnit;
      return round6({
        ok: true,
        pxPerUnit,
        unit: outUnit,
        unitPerPx,
        ...(outUnit === 'ft' ? { ftPerPx: unitPerPx } : {}),
        source,
      });
    },

    /**
     * Measure a region's REAL area at the current scale. Region may be:
     *   { region: { points: [[x,y],...] } }  explicit traced polygon (px)
     *   { region: { x?,y?,width,height } }    explicit rectangle (px)  (widthPx/heightPx also accepted)
     *   { roomId } | { region: { roomId | ref } }  a named room from the plan
     * area = pixelArea / pxPerUnit²  → wrong calibration yields a wrong area.
     */
    measureArea(args = {}) {
      if (!state.calibrated) return { ok: false, error: 'no-scale', note: 'call set_scale before measuring' };
      const resolved = resolvePolygon(args, backend);
      if (!resolved.polygon) return { ok: false, error: resolved.error || 'no-region', note: resolved.note || 'provide region.points, a width/height rect, or a roomId' };

      const areaPx = polygonAreaPx(resolved.polygon);
      const area = areaPx / (state.pxPerUnit * state.pxPerUnit);
      return round6({
        ok: true,
        area,
        areaUnit: areaUnitFor(state.unit),
        areaPx,
        ...(resolved.roomId ? { roomId: resolved.roomId } : {}),
        ...(resolved.material ? { material: resolved.material } : {}),
        scale: { pxPerUnit: state.pxPerUnit, unit: state.unit },
        source: resolved.source,
      });
    },

    /**
     * Measure a REAL linear length at the current scale. Region:
     *   { region: { points: [[x,y],...] } }  a traced polyline (px)
     *   or a room's perimeter via { roomId } (uses the room polygon)
     * length = pixelLength / pxPerUnit.
     */
    measureLength(args = {}) {
      if (!state.calibrated) return { ok: false, error: 'no-scale', note: 'call set_scale before measuring' };
      const resolved = resolvePolyline(args, backend);
      if (!resolved.points) return { ok: false, error: resolved.error || 'no-region', note: resolved.note || 'provide region.points or a roomId' };

      const lengthPx = polylineLengthPx(resolved.points, resolved.closed);
      const length = lengthPx / state.pxPerUnit;
      return round6({
        ok: true,
        length,
        lengthUnit: lengthUnitFor(state.unit),
        lengthPx,
        ...(resolved.roomId ? { roomId: resolved.roomId } : {}),
        scale: { pxPerUnit: state.pxPerUnit, unit: state.unit },
        source: resolved.source,
      });
    },

    /**
     * Count the fixtures/symbols actually present in the plan matching a query,
     * optionally restricted to a pixel region.
     */
    count(args = {}) {
      const query = args.item || args.query || args.symbol || args.type || '';
      const region = args.region && typeof args.region === 'object' ? args.region : undefined;
      const r = backend.countSymbols(query, region);
      return { ok: true, count: r.count, item: query || r.symbolType || 'symbol', symbolType: r.symbolType, matched: r.matched };
    },

    /**
     * Identify candidate scope items present on the plan: rooms (with material +
     * pixel bbox), the graphic scale bar, and a fixture-symbol summary. This is
     * what the agent inspects to decide what to calibrate, measure, and count.
     */
    identifyScope(args = {}) {
      const f = backend.getFeatures();
      const bbox = regionBbox(args.region);
      const inScope = (r) => !bbox || rectsOverlap(r.bboxPx, bbox);
      const rooms = f.rooms.filter(inScope).map((r) => ({ roomId: r.roomId, material: r.material || null, bboxPx: r.bboxPx }));
      const symbolCounts = {};
      for (const s of f.symbols) symbolCounts[s.kind] = (symbolCounts[s.kind] || 0) + 1;
      const materials = uniq(rooms.map((r) => r.material).filter(Boolean));
      return {
        ok: true,
        rooms,
        materials,
        symbols: Object.entries(symbolCounts).map(([kind, count]) => ({ kind, count })),
        scaleBar: f.scaleBar ? { present: true, spanPx: f.scaleBar.spanPx, realLength: f.scaleBar.realLength, unit: f.scaleBar.unit } : { present: false },
      };
    },

    /**
     * Record the agent's final reported quantity. The runner keeps its own copy
     * for the answer block; this validates/echoes for the MCP surface.
     */
    emitQuantity(args = {}) {
      const q = normalizeQuantity(args);
      return q
        ? { ok: true, recorded: q }
        : { ok: false, error: 'invalid-quantity', note: 'emit_quantity requires item(string), value(number), unit(string)' };
    },
  };

  return env;
}

// ---------------------------------------------------------------------------
// SVG geometry parsing
// ---------------------------------------------------------------------------

function emptyFeatures() { return { rooms: [], symbols: [], scaleBar: null, viewBox: { width: 0, height: 0 } }; }

/**
 * Parse the known geometry out of a practice-suite SVG:
 *   rooms   — rects with the room interior fill, tagged with roomId + material
 *   symbols — fixture markers (floor drains: 'FD' annotations)
 *   scaleBar— the graphic scale bar (inside its own <g>), pixel span + real length
 * Regex-based on purpose: the practice assets are controlled, self-contained SVG
 * and we avoid adding an XML dependency.
 */
function parseSvgFeatures(svg) {
  const viewBox = parseViewBox(svg);

  const rects = parseRects(svg);
  const texts = parseTexts(svg);
  const circles = parseCircles(svg);

  // Rooms: interior-fill rects, matched to their RM-#### label + material text.
  const roomLabels = texts.filter((t) => /^RM-\d+$/i.test(t.content.trim()));
  const rooms = [];
  for (const rc of rects) {
    if (normHex(rc.fill) !== ROOM_FILL) continue;
    const bboxPx = { x: rc.x, y: rc.y, width: rc.width, height: rc.height };
    const label = roomLabels.find((t) => pointInBbox(t.x, t.y, bboxPx));
    const roomId = label ? label.content.trim().toUpperCase() : `ROOM-${rooms.length + 1}`;
    const material = materialInRoom(texts, bboxPx);
    rooms.push({
      roomId,
      material,
      bboxPx,
      polygonPx: [[rc.x, rc.y], [rc.x + rc.width, rc.y], [rc.x + rc.width, rc.y + rc.height], [rc.x, rc.y + rc.height]],
      centroidPx: { x: rc.x + rc.width / 2, y: rc.y + rc.height / 2 },
    });
  }

  // Fixture symbols: floor drains are annotated 'FD' (a marker circle + label).
  const symbols = [];
  for (const t of texts) {
    if (t.content.trim().toUpperCase() === 'FD') {
      // Anchor to the nearest marker circle when present, else the label position.
      const near = nearestCircle(circles, t.x, t.y);
      symbols.push({ kind: 'floor-drain', label: 'FD', x: near ? near.cx : t.x, y: near ? near.cy : t.y });
    }
  }

  const scaleBar = parseScaleBar(svg);

  return { rooms, symbols, scaleBar, viewBox };
}

function parseViewBox(svg) {
  const vb = svg.match(/viewBox="([\d.\s-]+)"/);
  if (vb) { const p = vb[1].trim().split(/\s+/).map(Number); if (p.length === 4) return { x: p[0], y: p[1], width: p[2], height: p[3] }; }
  const w = num(attr(svg.match(/<svg\b[^>]*>/)?.[0] || '', 'width'));
  const h = num(attr(svg.match(/<svg\b[^>]*>/)?.[0] || '', 'height'));
  return { width: w || 0, height: h || 0 };
}

function parseRects(svg) {
  const out = [];
  for (const m of svg.matchAll(/<rect\b([^>]*?)\/?>/g)) {
    const a = m[1];
    out.push({
      x: num(attr(a, 'x')) || 0, y: num(attr(a, 'y')) || 0,
      width: num(attr(a, 'width')) || 0, height: num(attr(a, 'height')) || 0,
      fill: attr(a, 'fill'), stroke: attr(a, 'stroke'), strokeWidth: num(attr(a, 'stroke-width')),
    });
  }
  return out;
}

function parseTexts(svg) {
  const out = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    out.push({ x: num(attr(m[1], 'x')) || 0, y: num(attr(m[1], 'y')) || 0, content: decodeEntities(m[2]) });
  }
  return out;
}

function parseCircles(svg) {
  const out = [];
  for (const m of svg.matchAll(/<circle\b([^>]*?)\/?>/g)) {
    const a = m[1];
    out.push({ cx: num(attr(a, 'cx')) || 0, cy: num(attr(a, 'cy')) || 0, r: num(attr(a, 'r')) || 0, fill: attr(a, 'fill'), stroke: attr(a, 'stroke') });
  }
  return out;
}

function parseLines(fragment) {
  const out = [];
  for (const m of fragment.matchAll(/<line\b([^>]*?)\/?>/g)) {
    const a = m[1];
    out.push({ x1: num(attr(a, 'x1')) || 0, y1: num(attr(a, 'y1')) || 0, x2: num(attr(a, 'x2')) || 0, y2: num(attr(a, 'y2')) || 0 });
  }
  return out;
}

/**
 * Parse the graphic scale bar. The bar lives inside its own <g> (the fixture
 * crosshairs elsewhere are NOT grouped), so we locate the <g> that carries a
 * unit label ('ft'/'m') or ruler numbers, then measure its tick span in px and
 * read its largest labeled real length.
 * @returns {object|null}
 */
function parseScaleBar(svg) {
  const groups = [...svg.matchAll(/<g\b[^>]*>([\s\S]*?)<\/g>/g)].map((m) => m[1]);
  const candidates = groups.length ? groups : [svg];

  for (const g of candidates) {
    const texts = parseTexts(g);
    const hasUnit = texts.some((t) => /\b(ft|m)\b/i.test(t.content)) || /scale/i.test(g);
    const lines = parseLines(g);
    const ticks = lines.filter((l) => Math.abs(l.x1 - l.x2) < 0.5 && Math.abs(l.y2 - l.y1) <= 40);
    const rects = parseRects(g);

    // Span in px: prefer the vertical tick marks; fall back to the bar rects.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const l of ticks) { minX = Math.min(minX, l.x1); maxX = Math.max(maxX, l.x1); minY = Math.min(minY, l.y1, l.y2); maxY = Math.max(maxY, l.y1, l.y2); }
    if (!(ticks.length >= 2)) {
      for (const rc of rects) { minX = Math.min(minX, rc.x); maxX = Math.max(maxX, rc.x + rc.width); minY = Math.min(minY, rc.y); maxY = Math.max(maxY, rc.y + rc.height); }
    }
    const spanPx = maxX - minX;
    if (!hasUnit || !(spanPx > 0)) continue;

    // Real length = the largest numeric ruler label near the bar; unit from a label.
    const labelWindow = { xMin: minX - 25, xMax: maxX + 25, yMin: minY - 5, yMax: maxY + 45 };
    let realLength = 0;
    let unit = 'ft';
    for (const t of texts) {
      if (t.x < labelWindow.xMin || t.x > labelWindow.xMax || t.y < labelWindow.yMin || t.y > labelWindow.yMax) continue;
      const um = t.content.match(/\b(ft|m)\b/i); if (um) unit = um[1].toLowerCase();
      const nm = t.content.match(/-?\d+(?:\.\d+)?/); if (nm) realLength = Math.max(realLength, parseFloat(nm[0]));
    }
    if (!(realLength > 0)) continue;

    return { present: true, spanPx, realLength, unit, pxPerUnit: spanPx / realLength, unitPerPx: realLength / spanPx, minX, maxX };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Region resolution + geometry math
// ---------------------------------------------------------------------------

/** Resolve measure_area args to a pixel polygon (explicit points/rect or a room). */
function resolvePolygon(args, backend) {
  const region = args.region && typeof args.region === 'object' ? args.region : args;

  const pts = pointsFrom(region.points || (Array.isArray(region) ? region : null));
  if (pts && pts.length >= 3) return { polygon: pts, source: 'traced-polygon' };

  const rect = rectFrom(region);
  if (rect) return { polygon: rectPolygon(rect), source: 'traced-rect' };

  const roomId = args.roomId || region.roomId || region.ref || region.room;
  if (roomId) {
    const room = backend.resolveRoom(roomId);
    if (!room) return { polygon: null, error: 'unknown-room', note: `no room '${roomId}' on this planset` };
    return { polygon: room.polygonPx, roomId: room.roomId, material: room.material, source: 'plan-room' };
  }
  return { polygon: null };
}

/** Resolve measure_length args to a pixel polyline (explicit points or a room perimeter). */
function resolvePolyline(args, backend) {
  const region = args.region && typeof args.region === 'object' ? args.region : args;
  const pts = pointsFrom(region.points || (Array.isArray(region) ? region : null));
  if (pts && pts.length >= 2) return { points: pts, closed: false, source: 'traced-polyline' };

  const roomId = args.roomId || region.roomId || region.ref || region.room;
  if (roomId) {
    const room = backend.resolveRoom(roomId);
    if (!room) return { points: null, error: 'unknown-room', note: `no room '${roomId}' on this planset` };
    return { points: room.polygonPx, closed: true, roomId: room.roomId, source: 'plan-room-perimeter' };
  }
  return { points: null };
}

function pointsFrom(raw) {
  if (!Array.isArray(raw)) return null;
  const pts = [];
  for (const p of raw) {
    if (Array.isArray(p) && p.length >= 2) pts.push([Number(p[0]), Number(p[1])]);
    else if (p && typeof p === 'object' && 'x' in p && 'y' in p) pts.push([Number(p.x), Number(p.y)]);
  }
  return pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) && pts.length ? pts : null;
}

function rectFrom(region) {
  if (!region || typeof region !== 'object') return null;
  const w = num(region.width) ?? num(region.widthPx) ?? num(region.w);
  const h = num(region.height) ?? num(region.heightPx) ?? num(region.h);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  const x = num(region.x) ?? num(region.xPx) ?? 0;
  const y = num(region.y) ?? num(region.yPx) ?? 0;
  return { x, y, width: w, height: h };
}

function rectPolygon(r) { return [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]]; }

/** Shoelace area (absolute) of a pixel polygon. */
function polygonAreaPx(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function polylineLengthPx(points, closed) {
  let len = 0;
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    len += Math.hypot(x2 - x1, y2 - y1);
  }
  return len;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function attr(fragment, name) {
  const m = String(fragment).match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}
function num(v) { if (v === undefined || v === null || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function normStr(s) { return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
function normHex(s) { return String(s ?? '').trim().toLowerCase(); }
function uniq(a) { return [...new Set(a)]; }
function decodeEntities(s) { return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }

function areaUnitFor(unit) { return unit === 'ft' ? 'sf' : unit === 'm' ? 'sm' : `${unit}^2`; }
function lengthUnitFor(unit) { return unit === 'ft' ? 'lf' : unit === 'm' ? 'lm' : unit; }

function pointInBbox(x, y, b) { return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height; }
function regionBbox(region) {
  const r = rectFrom(region);
  if (r) return r;
  if (region && typeof region === 'object' && region.bbox) return rectFrom(region.bbox);
  return null;
}
function rectsOverlap(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }

function nearestCircle(circles, x, y) {
  let best = null, bd = Infinity;
  for (const c of circles) {
    if (!(c.r > 0 && c.r <= 16)) continue; // marker-sized circles only
    const d = Math.hypot(c.cx - x, c.cy - y);
    if (d < bd) { bd = d; best = c; }
  }
  return bd <= 40 ? best : null;
}

/** Map a count query to a known symbol kind. */
function symbolTypeForQuery(query) {
  const q = normStr(query);
  if (!q) return null;
  if (q === 'fd' || q.includes('floor drain') || q.includes('drain')) return 'floor-drain';
  return null; // unknown → match by label equality in countSymbols
}

/** Extract a material label from the texts inside a room's bbox. */
function materialInRoom(texts, bbox) {
  for (const t of texts) {
    if (!pointInBbox(t.x, t.y, bbox)) continue;
    const c = t.content.trim();
    const low = c.toLowerCase();
    if (!MATERIAL_WORDS.some((w) => low.includes(w))) continue;
    // Material = leading words before the first dimension/number, e.g. "Ceramic Tile  10'-0"" → "Ceramic Tile".
    const lead = c.match(/^([A-Za-z][A-Za-z ]*?)\s{1,}[\d(]/) || c.match(/^([A-Za-z][A-Za-z ]*)$/);
    return (lead ? lead[1] : c).trim();
  }
  return null;
}

/** Validate/normalize a quantity for emit_quantity (mirrors the runner). */
function normalizeQuantity(args) {
  if (!args || typeof args !== 'object') return null;
  const value = typeof args.value === 'number' ? args.value : Number(args.value);
  if (!args.item || typeof args.item !== 'string' || !Number.isFinite(value) || !args.unit || typeof args.unit !== 'string') return null;
  const q = { item: args.item, value, unit: args.unit };
  if (args.roomId) q.roomId = String(args.roomId);
  if (typeof args.confidence === 'number') q.confidence = Math.max(0, Math.min(1, args.confidence));
  return q;
}

/** Round numeric leaves to 6 decimals to keep results clean and deterministic. */
function round6(obj) {
  const r = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x);
  const walk = (v) => {
    if (typeof v === 'number') return r(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    return v;
  };
  return walk(obj);
}
