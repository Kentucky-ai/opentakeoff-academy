/* ============================================================================
   OpenTakeoff Academy — in-browser self-test runner
   ----------------------------------------------------------------------------
   A FREE, NON-CERTIFIED practice takeoff you can run entirely in the browser:
     • Demo run  — a built-in scripted agent plays the tools (one click, no setup)
     • Your agent — POST to your own OpenAI-compatible endpoint and run YOUR model
   Both paths drive the SAME in-browser takeoff environment (ported verbatim from
   src/environment.js) and the SAME APE scorer (ported from src/score.js), so the
   numbers here AGREE with the Node conformance engine.

   No backend. No signup. Nothing is committed. Endpoints/keys never leave the
   browser except to the endpoint you name.

   Practice planset: tasks/div9/practice/d9-area-1  (public answer key).
   The SVG below is a byte-identical copy of site/practice/d9-area-1.svg
   (sha256 2b5a48c33cd13dba912b6ebf83e8a6bfd9114c414b5550759d15fdfbdf8559f4).
   ========================================================================== */
(function () {
  'use strict';

  // ==========================================================================
  // 1. PRACTICE PLANSET  (inlined — single source of truth for render + parse)
  // ==========================================================================
  const SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" width="1060" height="600" viewBox="0 0 1060 600" font-family="Helvetica, Arial, sans-serif"><title>Div-9 Practice - Flooring Area Takeoff</title><rect x="0" y="0" width="1060" height="600" fill="#ffffff"/><text x="40" y="36" font-size="22" font-weight="bold" fill="#111111">DIV 9  FLOORING PLAN  F-101  (scale 1/4" = 1'-0")</text><rect x="40" y="56" width="960" height="144" fill="#f4f6f8" stroke="#111111" stroke-width="3"/><text x="520" y="120" font-size="18" font-weight="bold" text-anchor="middle" fill="#111111">RM-201</text><text x="520" y="142" font-size="14" text-anchor="middle" fill="#333333">Corridor</text><text x="520" y="162" font-size="13" text-anchor="middle" fill="#555555">LVT  40'-0" x 6'-0"</text><rect x="40" y="240" width="336" height="288" fill="#f4f6f8" stroke="#111111" stroke-width="3"/><text x="208" y="376" font-size="18" font-weight="bold" text-anchor="middle" fill="#111111">RM-202</text><text x="208" y="398" font-size="14" text-anchor="middle" fill="#333333">Office</text><text x="208" y="418" font-size="13" text-anchor="middle" fill="#555555">Carpet  14'-0" x 12'-0"</text><rect x="420" y="240" width="240" height="192" fill="#f4f6f8" stroke="#111111" stroke-width="3"/><text x="540" y="328" font-size="18" font-weight="bold" text-anchor="middle" fill="#111111">RM-203</text><text x="540" y="350" font-size="14" text-anchor="middle" fill="#333333">Restroom</text><text x="540" y="370" font-size="13" text-anchor="middle" fill="#555555">Ceramic Tile  10'-0" x 8'-0"</text><g><rect x="40" y="560" width="120" height="10" fill="#111111"/><rect x="160" y="560" width="120" height="10" fill="#ffffff" stroke="#111111" stroke-width="1"/><line x1="40" y1="555" x2="40" y2="575" stroke="#111111" stroke-width="1"/><line x1="160" y1="555" x2="160" y2="575" stroke="#111111" stroke-width="1"/><line x1="280" y1="555" x2="280" y2="575" stroke="#111111" stroke-width="1"/><text x="40" y="590" font-size="12" text-anchor="middle" fill="#111111">0</text><text x="160" y="590" font-size="12" text-anchor="middle" fill="#111111">5</text><text x="280" y="590" font-size="12" text-anchor="middle" fill="#111111">10 ft</text><text x="296" y="570" font-size="12" fill="#111111">1/4" = 1'-0"</text></g></svg>`;

  // Inlined copy of tasks/div9/practice/d9-area-1.task.json (public practice key).
  const TASK = {
    taskId: 'd9-area-1',
    track: 'div9',
    kind: 'area-takeoff',
    suite: { id: 'div9-practice', version: '1.0' },
    title: 'Flooring area takeoff by material',
    prompt: 'Flooring plan F-101 (scale 1/4" = 1\'-0") has three rooms with three finishes: RM-201 Corridor (LVT), RM-202 Office (carpet), and RM-203 Restroom (ceramic tile). Measure the finished floor area of each room and emit one square-foot quantity per room, tagged with its material and roomId.',
    planset: {
      assetRef: 'assets/d9-area-1.svg',
      assetHash: '2b5a48c33cd13dba912b6ebf83e8a6bfd9114c414b5550759d15fdfbdf8559f4',
      knownScale: '1/4" = 1\'-0" (24 px = 1 ft)',
      units: 'imperial',
    },
    toolset: ['set_scale', 'measure_area', 'emit_quantity'],
    budget: { maxSteps: 40, maxWallMs: 120000 },
    metric: { type: 'ape', tolerance: 0.06 },
    groundTruth: {
      quantities: [
        { item: 'RM-201 LVT flooring', value: 240, unit: 'sf', roomId: 'RM-201' },
        { item: 'RM-202 carpet flooring', value: 168, unit: 'sf', roomId: 'RM-202' },
        { item: 'RM-203 ceramic tile flooring', value: 80, unit: 'sf', roomId: 'RM-203' },
      ],
      validatedBy: 'senior-estimator',
    },
  };

  // Practice pass bar for the div9 area-takeoff competency (from tasks/div9/practice/suite.json).
  const THRESHOLDS = { apprentice: 8.0, journeyman: 6.0, baseline: 2.1 }; // median APE %, lower is better
  const LOOP = { maxSteps: 40, maxWallMs: 120000 };

  // ==========================================================================
  // 2. THE TAKEOFF ENVIRONMENT  (ported verbatim from src/environment.js)
  //    Real geometry: calibrate px->units, then every measurement is COMPUTED
  //    from the plan at the agent's current scale. Scale gate enforced.
  // ==========================================================================
  const ROOM_FILL = '#f4f6f8';
  const MATERIAL_WORDS = ['lvt', 'carpet', 'ceramic tile', 'porcelain tile', 'ceramic', 'porcelain', 'tile', 'vct', 'rubber', 'terrazzo', 'epoxy', 'sealed concrete', 'polished concrete', 'concrete', 'wood', 'resilient', 'sheet vinyl', 'vinyl'];

  class SvgGeometryBackend {
    constructor(svgText, meta = {}) {
      this.assetRef = meta.assetRef || null;
      this.svg = typeof svgText === 'string' ? svgText : null;
      this._features = this.svg ? parseSvgFeatures(this.svg) : emptyFeatures();
    }
    getFeatures() { return this._features; }
    resolveRoom(roomId) {
      if (!roomId) return null;
      const key = normStr(roomId);
      return this._features.rooms.find((r) => normStr(r.roomId) === key) || null;
    }
    countSymbols(query, region) {
      const symbols = this._features.symbols;
      const wanted = symbolTypeForQuery(query);
      let matched = symbols.filter((s) => wanted == null || s.kind === wanted || normStr(s.label) === normStr(query));
      const bbox = regionBbox(region);
      if (bbox) matched = matched.filter((s) => pointInBbox(s.x, s.y, bbox));
      return { count: matched.length, matched: matched.map((s) => ({ kind: s.kind, label: s.label, x: s.x, y: s.y })), symbolType: matched[0] ? matched[0].kind : (wanted || null) };
    }
    getScaleBar() { return this._features.scaleBar; }
  }

  function createEnvironment(opts = {}) {
    const unit = opts.unit || (opts.task && opts.task.planset && opts.task.planset.units === 'metric' ? 'm' : 'ft');
    const backend = opts.backend || new SvgGeometryBackend(opts.assetContent != null ? opts.assetContent : null, { assetRef: opts.task && opts.task.planset ? opts.task.planset.assetRef : undefined });
    const state = { pxPerUnit: null, unit, calibrated: false, source: null };

    const env = {
      backend,
      state,
      invoke(name, args = {}) {
        switch (name) {
          case 'set_scale': return env.setScale(args);
          case 'measure_area': return env.measureArea(args);
          case 'count': return env.count(args);
          case 'emit_quantity': return env.emitQuantity(args);
          default: return { ok: false, error: 'unknown-tool', tool: name };
        }
      },
      setScale(args = {}) {
        let pxPerUnit = null;
        let outUnit = args.unit || state.unit;
        let source = null;
        const wantsBar = String(args.from || args.reference || '').toLowerCase().includes('scale-bar')
          || args.useScaleBar === true || args.scaleBar === true;

        if (wantsBar) {
          const bar = backend.getScaleBar();
          if (!bar || !bar.present) return { ok: false, error: 'no-scale-bar', note: 'no graphic scale bar found on this planset; supply pxPerUnit or referencePx+referenceLength' };
          const refLen = num(args.referenceLength) != null ? num(args.referenceLength) : bar.realLength;
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
        return round6(Object.assign({ ok: true, pxPerUnit, unit: outUnit, unitPerPx }, outUnit === 'ft' ? { ftPerPx: unitPerPx } : {}, { source }));
      },
      measureArea(args = {}) {
        if (!state.calibrated) return { ok: false, error: 'no-scale', note: 'call set_scale before measuring' };
        const resolved = resolvePolygon(args, backend);
        if (!resolved.polygon) return { ok: false, error: resolved.error || 'no-region', note: resolved.note || 'provide region.points, a width/height rect, or a roomId' };
        const areaPx = polygonAreaPx(resolved.polygon);
        const area = areaPx / (state.pxPerUnit * state.pxPerUnit);
        return round6(Object.assign(
          { ok: true, area, areaUnit: areaUnitFor(state.unit), areaPx },
          resolved.roomId ? { roomId: resolved.roomId } : {},
          resolved.material ? { material: resolved.material } : {},
          { scale: { pxPerUnit: state.pxPerUnit, unit: state.unit }, source: resolved.source },
        ));
      },
      count(args = {}) {
        const query = args.item || args.query || args.symbol || args.type || '';
        const region = args.region && typeof args.region === 'object' ? args.region : undefined;
        const r = backend.countSymbols(query, region);
        return { ok: true, count: r.count, item: query || r.symbolType || 'symbol', symbolType: r.symbolType, matched: r.matched };
      },
      emitQuantity(args = {}) {
        const q = normalizeQuantity(args);
        return q ? { ok: true, recorded: q } : { ok: false, error: 'invalid-quantity', note: 'emit_quantity requires item(string), value(number), unit(string)' };
      },
    };
    return env;
  }

  // ---- SVG geometry parsing (verbatim) -------------------------------------
  function emptyFeatures() { return { rooms: [], symbols: [], scaleBar: null, viewBox: { width: 0, height: 0 } }; }

  function parseSvgFeatures(svg) {
    const viewBox = parseViewBox(svg);
    const rects = parseRects(svg);
    const texts = parseTexts(svg);
    const circles = parseCircles(svg);

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

    const symbols = [];
    for (const t of texts) {
      if (t.content.trim().toUpperCase() === 'FD') {
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
    const svgTag = (svg.match(/<svg\b[^>]*>/) || [''])[0];
    const w = num(attr(svgTag, 'width'));
    const h = num(attr(svgTag, 'height'));
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

  function parseScaleBar(svg) {
    const groups = [...svg.matchAll(/<g\b[^>]*>([\s\S]*?)<\/g>/g)].map((m) => m[1]);
    const candidates = groups.length ? groups : [svg];
    for (const g of candidates) {
      const texts = parseTexts(g);
      const hasUnit = texts.some((t) => /\b(ft|m)\b/i.test(t.content)) || /scale/i.test(g);
      const lines = parseLines(g);
      const ticks = lines.filter((l) => Math.abs(l.x1 - l.x2) < 0.5 && Math.abs(l.y2 - l.y1) <= 40);
      const rects = parseRects(g);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const l of ticks) { minX = Math.min(minX, l.x1); maxX = Math.max(maxX, l.x1); minY = Math.min(minY, l.y1, l.y2); maxY = Math.max(maxY, l.y1, l.y2); }
      if (!(ticks.length >= 2)) {
        for (const rc of rects) { minX = Math.min(minX, rc.x); maxX = Math.max(maxX, rc.x + rc.width); minY = Math.min(minY, rc.y); maxY = Math.max(maxY, rc.y + rc.height); }
      }
      const spanPx = maxX - minX;
      if (!hasUnit || !(spanPx > 0)) continue;
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

  // ---- region resolution + geometry math (verbatim) ------------------------
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
    const w = firstNum(region.width, region.widthPx, region.w);
    const h = firstNum(region.height, region.heightPx, region.h);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    const x = firstNum(region.x, region.xPx, 0);
    const y = firstNum(region.y, region.yPx, 0);
    return { x, y, width: w, height: h };
  }

  function rectPolygon(r) { return [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]]; }

  function polygonAreaPx(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }

  // ---- small helpers (verbatim) --------------------------------------------
  function attr(fragment, name) {
    const m = String(fragment).match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? m[1] : undefined;
  }
  function num(v) { if (v === undefined || v === null || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; }
  function firstNum() { for (const v of arguments) { const n = num(v); if (Number.isFinite(n)) return n; } return undefined; }
  function normStr(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
  function normHex(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function uniq(a) { return [...new Set(a)]; }
  function decodeEntities(s) { return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
  function areaUnitFor(unit) { return unit === 'ft' ? 'sf' : unit === 'm' ? 'sm' : `${unit}^2`; }
  function pointInBbox(x, y, b) { return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height; }
  function regionBbox(region) {
    const r = rectFrom(region);
    if (r) return r;
    if (region && typeof region === 'object' && region.bbox) return rectFrom(region.bbox);
    return null;
  }
  function nearestCircle(circles, x, y) {
    let best = null, bd = Infinity;
    for (const c of circles) {
      if (!(c.r > 0 && c.r <= 16)) continue;
      const d = Math.hypot(c.cx - x, c.cy - y);
      if (d < bd) { bd = d; best = c; }
    }
    return bd <= 40 ? best : null;
  }
  function symbolTypeForQuery(query) {
    const q = normStr(query);
    if (!q) return null;
    if (q === 'fd' || q.includes('floor drain') || q.includes('drain')) return 'floor-drain';
    return null;
  }
  function materialInRoom(texts, bbox) {
    for (const t of texts) {
      if (!pointInBbox(t.x, t.y, bbox)) continue;
      const c = t.content.trim();
      const low = c.toLowerCase();
      if (!MATERIAL_WORDS.some((w) => low.includes(w))) continue;
      const lead = c.match(/^([A-Za-z][A-Za-z ]*?)\s{1,}[\d(]/) || c.match(/^([A-Za-z][A-Za-z ]*)$/);
      return (lead ? lead[1] : c).trim();
    }
    return null;
  }
  function normalizeQuantity(args) {
    if (!args || typeof args !== 'object') return null;
    const value = typeof args.value === 'number' ? args.value : Number(args.value);
    if (!args.item || typeof args.item !== 'string' || !Number.isFinite(value) || !args.unit || typeof args.unit !== 'string') return null;
    const q = { item: args.item, value, unit: args.unit };
    if (args.roomId) q.roomId = String(args.roomId);
    if (typeof args.confidence === 'number') q.confidence = Math.max(0, Math.min(1, args.confidence));
    return q;
  }
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

  // ==========================================================================
  // 3. THE SCORER  (ported from src/score.js — quantityErrorPct + matchQuantity)
  // ==========================================================================
  function quantityErrorPct(answer, gt) {
    const preds = (answer && answer.quantities) || [];
    const truths = (gt && gt.quantities) || [];
    if (truths.length === 0) return { matched: [], mean: 0, median: 0 };
    const matched = [];
    const errs = truths.map((t) => {
      const p = matchQuantity(preds, t);
      if (!p) { matched.push({ item: t.item, unit: t.unit, roomId: t.roomId, truth: t.value, pred: null, apePct: 100 }); return 100; }
      const denom = Math.abs(t.value) || 1e-9;
      const ape = (Math.abs(p.value - t.value) / denom) * 100;
      matched.push({ item: t.item, unit: t.unit, roomId: t.roomId, truth: t.value, pred: p.value, predItem: p.item, apePct: round2(ape) });
      return ape;
    });
    return { matched, mean: round2(meanOf(errs)), median: round2(medianOf(errs)) };
  }

  function matchQuantity(preds, truth) {
    const byItem = preds.find((p) => normStr(p.item) === normStr(truth.item));
    if (byItem) return byItem;
    if (truth.roomId) {
      const byRoom = preds.find((p) => p.roomId && normStr(p.roomId) === normStr(truth.roomId));
      if (byRoom) return byRoom;
    }
    const byUnit = preds.find((p) => normStr(p.unit) === normStr(truth.unit));
    return byUnit || null;
  }

  function meanOf(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
  function medianOf(a) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function round2(x) { return Math.round(x * 100) / 100; }

  /** Build the display report from an answer + task. */
  function scoreRun(answer, task) {
    const r = quantityErrorPct(answer, task.groundTruth);
    const median = r.median;
    const pass = median <= THRESHOLDS.apprentice;
    let tier = null;
    if (median <= THRESHOLDS.baseline) tier = 'master';
    else if (median <= THRESHOLDS.journeyman) tier = 'journeyman';
    else if (median <= THRESHOLDS.apprentice) tier = 'apprentice';
    return { matched: r.matched, mean: r.mean, median, pass, tier, beatsBaseline: median <= THRESHOLDS.baseline };
  }

  // ==========================================================================
  // 4. THE AGENT LOOP  (shared by both run modes; mirrors src/runner.js)
  // ==========================================================================
  const SYSTEM_PROMPT = [
    'You are a construction takeoff agent competing in the OpenTakeoff Academy.',
    'Measure the requested quantities off the plan using the provided tools.',
    'Calibrate the scale first when needed (set_scale), then measure (measure_area / count).',
    'Record every final quantity with emit_quantity(item, value, unit). Call emit_quantity once per quantity.',
    'When every quantity has been emitted, reply with a one-line summary and DO NOT call any more tools.',
  ].join(' ');

  const TOOL_NAMES = new Set(['set_scale', 'measure_area', 'count', 'emit_quantity']);

  // OpenAI-format function-tool definitions (ported from src/runner.js BUILTIN_TOOLS).
  const TOOLS = [
    { type: 'function', function: { name: 'set_scale', description: "Calibrate the drawing scale before measuring — this is REAL: the scale you set is applied to every later measurement, so a wrong calibration yields wrong areas. Calibrate any of three ways: pass pxPerUnit directly; pass a measured reference (referencePx + referenceLength); or calibrate off the plan's graphic scale bar with from:'scale-bar'.", parameters: { type: 'object', properties: { pxPerUnit: { type: 'number', description: 'Pixels per real-world unit (e.g. px per foot).' }, referencePx: { type: 'number', description: 'Length in pixels of a known reference.' }, referenceLength: { type: 'number', description: 'Real-world length of that reference.' }, from: { type: 'string', description: "Set to 'scale-bar' to calibrate off the drawing's graphic scale bar." }, unit: { type: 'string', description: "Real-world unit, e.g. 'ft' or 'm'." } }, additionalProperties: true } } },
    { type: 'function', function: { name: 'measure_area', description: 'Measure the REAL area of a region on the calibrated plan (area = pixel area / scale^2). Identify the region by a roomId, or by tracing region.points (polygon in px) or a region rectangle {x,y,width,height} in px.', parameters: { type: 'object', properties: { roomId: { type: 'string', description: 'Name a room on the plan (e.g. RM-201) to measure its footprint.' }, region: { description: 'Region to measure: { points: [[x,y],…] } polygon, or { x,y,width,height } rectangle, or { roomId } — all in px.' } }, additionalProperties: true } } },
    { type: 'function', function: { name: 'count', description: 'Count fixtures/symbols of a given type within a region.', parameters: { type: 'object', properties: { item: { type: 'string' }, region: { description: 'Region to count within (px).' } }, additionalProperties: true } } },
    { type: 'function', function: { name: 'emit_quantity', description: 'Record ONE final takeoff quantity. Call once per quantity in your answer. When you have emitted every quantity, reply with a short summary and NO further tool calls.', parameters: { type: 'object', properties: { item: { type: 'string', description: "What was measured, e.g. 'RM-201 LVT flooring'." }, value: { type: 'number' }, unit: { type: 'string', description: "e.g. 'sf', 'lf', 'ea'." }, roomId: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['item', 'value', 'unit'], additionalProperties: false } } },
  ];

  function userPrompt(task) {
    const p = task.planset || {};
    const scale = p.knownScale ? `Known scale: ${p.knownScale}.` : 'Scale is NOT given — calibrate it yourself with set_scale.';
    return [
      task.prompt,
      '',
      `Planset: ${p.assetRef} (${p.units || 'imperial'} units). ${scale}`,
      `Allowed tools: ${(task.toolset || [...TOOL_NAMES]).join(', ')}.`,
      `Budget: ${LOOP.maxSteps} steps / ${LOOP.maxWallMs} ms.`,
    ].join('\n');
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Drive an agent loop against the in-browser environment.
   * @param model  async (messages, tools, ctx) => { message:{content, tool_calls}, usage? }
   * @param onEvent (evt) => void   live trace callback
   */
  async function runAgentLoop({ env, task, model, onEvent }) {
    const t0 = performance.now();
    const answer = { quantities: [] };
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt(task) },
    ];
    let steps = 0, toolCalls = 0;

    onEvent({ type: 'start' });

    while (steps < LOOP.maxSteps) {
      if (performance.now() - t0 > LOOP.maxWallMs) { onEvent({ type: 'error', text: 'Budget exceeded (maxWallMs). Stopping.' }); break; }
      steps++;

      const resp = await model(messages, TOOLS, { step: steps }); // may throw → caller handles
      const msg = (resp && resp.message) || {};

      if (msg.content) onEvent({ type: 'assistant', text: String(msg.content) });
      messages.push(Object.assign({ role: 'assistant', content: msg.content == null ? '' : msg.content }, msg.tool_calls ? { tool_calls: msg.tool_calls } : {}));

      const calls = msg.tool_calls || [];
      if (calls.length === 0) break; // agent signalled done

      for (const tc of calls) {
        const name = tc.function && tc.function.name;
        const args = parseArgs(tc.function && tc.function.arguments);
        onEvent({ type: 'tool_call', tool: name, args });

        let result;
        if (name === 'emit_quantity') {
          const q = normalizeQuantity(args);
          if (q) answer.quantities.push(q);
          result = Object.assign({ ok: !!q, recorded: q || null }, q ? {} : { error: 'emit_quantity requires item(string), value(number), unit(string)' });
        } else if (TOOL_NAMES.has(name)) {
          result = env.invoke(name, args);
        } else {
          result = { ok: false, error: 'unknown-tool', tool: name };
        }
        toolCalls++;
        onEvent({ type: 'tool_result', tool: name, result });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 8000) });
      }
    }

    const wallMs = Math.round(performance.now() - t0);
    onEvent({ type: 'done', steps, toolCalls, wallMs });
    return { answer, telemetry: { steps, toolCalls, wallMs } };
  }

  function parseArgs(raw) {
    if (raw == null) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return { _raw: String(raw) }; }
  }

  // ==========================================================================
  // 5. DEMO scripted model  (deterministic; plays the tools; ~0% APE)
  //    Genuinely reads each measure_area RESULT to build its emit — the score
  //    emerges from real geometry, nothing is hardcoded.
  // ==========================================================================
  function makeDemoModel() {
    const queue = [
      { type: 'scale' },
      { type: 'measure', roomId: 'RM-201' },
      { type: 'emit' },
      { type: 'measure', roomId: 'RM-202' },
      { type: 'emit' },
      { type: 'measure', roomId: 'RM-203' },
      { type: 'emit' },
      { type: 'finish' },
    ];
    let i = 0;
    let n = 0;
    return async function demoModel(messages) {
      await sleep(520); // pace the trace so it visibly streams
      const step = queue[i++] || { type: 'finish' };
      if (step.type === 'scale') {
        return { message: { content: 'First, calibrate. The plan carries a graphic scale bar (0–10 ft) — I will set the scale off it before measuring.', tool_calls: [mkCall('call_' + (++n), 'set_scale', { from: 'scale-bar', unit: 'ft' })] } };
      }
      if (step.type === 'measure') {
        return { message: { content: `Measuring the finished floor area of ${step.roomId}.`, tool_calls: [mkCall('call_' + (++n), 'measure_area', { roomId: step.roomId })] } };
      }
      if (step.type === 'emit') {
        const last = lastToolResult(messages) || {};
        const roomId = last.roomId || 'ROOM';
        const material = last.material || 'flooring';
        const item = `${roomId} ${material} flooring`;
        return { message: { content: `${roomId} measures ${last.area} ${last.areaUnit}. Recording the quantity.`, tool_calls: [mkCall('call_' + (++n), 'emit_quantity', { item, value: last.area, unit: last.areaUnit, roomId, confidence: 0.98 })] } };
      }
      return { message: { content: 'All three room areas measured off the calibrated plan and emitted (LVT, carpet, ceramic tile). Takeoff complete.' } };
    };
  }

  function mkCall(id, name, args) {
    return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
  }
  function lastToolResult(messages) {
    for (let k = messages.length - 1; k >= 0; k--) {
      if (messages[k].role === 'tool') { try { return JSON.parse(messages[k].content); } catch { return null; } }
    }
    return null;
  }

  // ==========================================================================
  // 6. YOUR-AGENT model  (POST to an OpenAI-compatible endpoint)
  // ==========================================================================
  function makeEndpointModel(cfg) {
    const url = String(cfg.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    return async function endpointModel(messages, tools) {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: Object.assign({ 'content-type': 'application/json' }, cfg.apiKey ? { authorization: 'Bearer ' + cfg.apiKey } : {}),
          body: JSON.stringify({ model: cfg.model, messages, tools, tool_choice: 'auto', temperature: 0, stream: false }),
        });
      } catch (e) {
        throw new Error('Could not reach ' + url + ' — this is usually a network error or a CORS block (the target did not allow a browser request). Confirm the endpoint is running and permits cross-origin calls. [' + (e && e.message ? e.message : e) + ']');
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error('Endpoint returned HTTP ' + res.status + ' ' + res.statusText + (text ? ' — ' + text.slice(0, 300) : ''));
      }
      let data;
      try { data = await res.json(); } catch { throw new Error('Endpoint returned a non-JSON response (not an OpenAI-compatible chat.completions reply).'); }
      const msg = data && data.choices && data.choices[0] && data.choices[0].message;
      if (!msg) throw new Error('Endpoint reply had no choices[0].message — is this an OpenAI-compatible /chat/completions endpoint?');
      return { message: msg, usage: data.usage };
    };
  }

  // ==========================================================================
  // 7. UI WIRING
  // ==========================================================================
  const LS = {
    baseUrl: 'ota_selftest_baseUrl',
    model: 'ota_selftest_model',
    apiKey: 'ota_selftest_apiKey',
    remember: 'ota_selftest_remember_key',
  };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let running = false;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    renderPlan();
    renderPrompt();
    bindMode();
    bindEndpointForm();
    bindRun();
  }

  function renderPlan() {
    const host = $('plan-host');
    if (host) host.innerHTML = SVG_TEXT; // inlined = render source == parse source
  }

  function renderPrompt() {
    const el = $('task-prompt');
    if (el) el.textContent = TASK.prompt;
    const keys = $('gt-keys');
    if (keys) {
      keys.innerHTML = TASK.groundTruth.quantities
        .map((q) => `<li><b>${esc(q.roomId || q.item)}</b> — ${esc(q.item)}: <span class="mono">${q.value} ${esc(q.unit)}</span></li>`)
        .join('');
    }
  }

  // ---- mode toggle ---------------------------------------------------------
  function currentMode() {
    const el = document.querySelector('input[name="run-mode"]:checked');
    return el ? el.value : 'demo';
  }
  function bindMode() {
    document.querySelectorAll('input[name="run-mode"]').forEach((el) => el.addEventListener('change', syncMode));
    syncMode();
  }
  function syncMode() {
    const mode = currentMode();
    const form = $('endpoint-form');
    if (form) form.hidden = mode !== 'byo';
    document.querySelectorAll('.mode-card').forEach((c) => {
      c.classList.toggle('active', c.dataset.mode === mode);
    });
    const btn = $('run-btn');
    if (btn && !running) btn.querySelector('.run-label').textContent = mode === 'demo' ? 'Run demo takeoff' : 'Run your agent';
  }

  // ---- endpoint form + localStorage ---------------------------------------
  function bindEndpointForm() {
    const base = $('f-base'), model = $('f-model'), key = $('f-key'), remember = $('f-remember');
    if (!base) return;
    base.value = lsGet(LS.baseUrl, '');
    model.value = lsGet(LS.model, '');
    const rememberKey = lsGet(LS.remember, '') === '1';
    remember.checked = rememberKey;
    if (rememberKey) key.value = lsGet(LS.apiKey, '');

    base.addEventListener('input', () => lsSet(LS.baseUrl, base.value.trim()));
    model.addEventListener('input', () => lsSet(LS.model, model.value.trim()));
    const persistKey = () => {
      if (remember.checked) { lsSet(LS.remember, '1'); lsSet(LS.apiKey, key.value); }
      else { lsSet(LS.remember, '0'); lsDel(LS.apiKey); }
    };
    key.addEventListener('input', persistKey);
    remember.addEventListener('change', persistKey);
  }

  function readEndpointConfig() {
    const base = $('f-base').value.trim();
    const model = $('f-model').value.trim();
    const key = $('f-key').value.trim();
    const errs = [];
    if (!base) errs.push('Enter a base URL (e.g. http://localhost:11434/v1).');
    else if (!/^https?:\/\//i.test(base)) errs.push('Base URL must start with http:// or https://');
    if (!model) errs.push('Enter a model name (e.g. llama3.1, qwen2.5, gpt-4o-mini).');
    return { cfg: { baseUrl: base, model, apiKey: key }, errs };
  }

  // ---- run -----------------------------------------------------------------
  function bindRun() {
    const btn = $('run-btn');
    if (btn) btn.addEventListener('click', onRun);
    const again = $('run-again');
    if (again) again.addEventListener('click', () => { onRun(); scrollToRun(); });
  }
  function scrollToRun() { const el = $('run-panel'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  async function onRun() {
    if (running) return;
    const mode = currentMode();

    let model, modeLabel;
    if (mode === 'demo') {
      model = makeDemoModel();
      modeLabel = 'Demo agent (scripted)';
    } else {
      const { cfg, errs } = readEndpointConfig();
      if (errs.length) { showFormErrors(errs); return; }
      clearFormErrors();
      model = makeEndpointModel(cfg);
      modeLabel = `Your agent · ${cfg.model} @ ${cfg.baseUrl}`;
    }

    running = true;
    setRunUI(true, mode);
    resetTrace();
    hideScore();
    setStatus(mode === 'demo' ? 'Running demo takeoff…' : 'Contacting your endpoint…');
    traceMeta(modeLabel);

    const env = createEnvironment({ task: TASK, assetContent: SVG_TEXT });
    let result = null;
    try {
      result = await runAgentLoop({ env, task: TASK, model, onEvent: onTraceEvent });
    } catch (e) {
      addTrace('error', `<b>Run stopped:</b> ${esc(e && e.message ? e.message : String(e))}`);
      setStatus('Run failed — see the trace above.');
      // Still score whatever was emitted (graceful), if anything.
    }

    running = false;
    setRunUI(false, mode);

    // Score whatever the agent emitted (even a partial/empty answer scores cleanly).
    const answer = result ? result.answer : { quantities: [] };
    const report = scoreRun(answer, TASK);
    renderScore(report, result ? result.telemetry : { steps: 0, toolCalls: 0, wallMs: 0 }, mode);
    if (!result) return; // errored — score panel shows the (likely FAIL) partial result
  }

  function setRunUI(isRunning, mode) {
    const btn = $('run-btn');
    if (!btn) return;
    btn.disabled = isRunning;
    btn.classList.toggle('is-running', isRunning);
    const label = btn.querySelector('.run-label');
    if (label) label.textContent = isRunning ? (mode === 'demo' ? 'Running demo…' : 'Running your agent…') : (mode === 'demo' ? 'Run demo takeoff' : 'Run your agent');
  }

  function setStatus(text) { const el = $('run-status'); if (el) el.textContent = text; }

  // ---- live trace ----------------------------------------------------------
  function resetTrace() {
    const t = $('trace');
    if (t) { t.innerHTML = ''; }
    const wrap = $('trace-wrap');
    if (wrap) wrap.hidden = false;
  }
  function traceMeta(text) {
    addTrace('meta', esc(text));
  }
  function onTraceEvent(evt) {
    if (evt.type === 'start') { addTrace('meta', 'Agent loop started · budget ' + LOOP.maxSteps + ' steps / ' + Math.round(LOOP.maxWallMs / 1000) + 's'); return; }
    if (evt.type === 'assistant') { if (evt.text && evt.text.trim()) addTrace('assistant', esc(evt.text)); return; }
    if (evt.type === 'tool_call') { addTrace('call', `<span class="tk">→ ${esc(evt.tool)}</span> <span class="ta">${esc(compact(evt.args))}</span>`); return; }
    if (evt.type === 'tool_result') { addTrace('result', renderResult(evt.tool, evt.result)); return; }
    if (evt.type === 'done') { addTrace('meta', `Loop finished · ${evt.steps} step(s) · ${evt.toolCalls} tool call(s) · ${evt.wallMs} ms`); return; }
    if (evt.type === 'error') { addTrace('error', esc(evt.text)); return; }
  }
  function renderResult(tool, result) {
    if (!result || result.ok === false) {
      return `<span class="rk fail">✗ ${esc(tool)}</span> <span class="ra">${esc(compact(result))}</span>`;
    }
    let summary = '';
    if (tool === 'set_scale') summary = `pxPerUnit ${result.pxPerUnit} ${result.unit}/px · source ${result.source}`;
    else if (tool === 'measure_area') summary = `${result.area} ${result.areaUnit}` + (result.roomId ? ` · ${result.roomId}` : '') + (result.material ? ` (${result.material})` : '');
    else if (tool === 'count') summary = `${result.count} ${result.item}`;
    else if (tool === 'emit_quantity') summary = result.recorded ? `recorded ${result.recorded.value} ${result.recorded.unit} · ${result.recorded.item}` : 'recorded';
    else summary = compact(result);
    return `<span class="rk ok">✓ ${esc(tool)}</span> <span class="ra">${esc(summary)}</span>`;
  }
  function compact(obj) {
    try { const s = JSON.stringify(obj); return s.length > 240 ? s.slice(0, 237) + '…' : s; } catch { return String(obj); }
  }
  function addTrace(kind, html) {
    const t = $('trace');
    if (!t) return;
    const row = document.createElement('div');
    row.className = 'trace-row tr-' + kind;
    row.innerHTML = html;
    t.appendChild(row);
    t.scrollTop = t.scrollHeight;
  }

  // ---- score ---------------------------------------------------------------
  function hideScore() { const el = $('score-panel'); if (el) el.hidden = true; }
  function renderScore(report, telemetry, mode) {
    const el = $('score-panel');
    if (!el) return;
    el.hidden = false;

    const pass = report.pass;
    const medianTxt = fmtPct(report.median);
    const tierLabel = { master: 'Master (beats human baseline)', journeyman: 'Journeyman band', apprentice: 'Apprentice band' }[report.tier] || '—';

    const rows = report.matched.map((m) => {
      const ok = m.apePct <= THRESHOLDS.apprentice;
      const predTxt = m.pred == null ? '<span class="miss">— not emitted —</span>' : `${m.pred} ${esc(m.unit)}`;
      return `<tr class="${ok ? 'q-ok' : 'q-bad'}">
        <td>${esc(m.roomId || m.item)}</td>
        <td class="mono">${predTxt}</td>
        <td class="mono">${m.truth} ${esc(m.unit)}</td>
        <td class="mono num">${fmtPct(m.apePct)}</td>
        <td class="qv">${ok ? '✓' : '✗'}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="verdict ${pass ? 'pass' : 'fail'}">
        <div class="verdict-badge">${pass ? 'PASS' : 'FAIL'}</div>
        <div class="verdict-main">
          <div class="verdict-metric"><span class="vm-num">${medianTxt}</span><span class="vm-lbl">median APE<br>lower is better</span></div>
          <div class="verdict-sub">
            <span class="noncert">◆ NON-CERTIFIED self-test</span>
            <span class="verdict-line">Practice bar: median APE ≤ ${fmtPct(THRESHOLDS.apprentice)} (Apprentice) · Journeyman ≤ ${fmtPct(THRESHOLDS.journeyman)} · Master beats human baseline ${fmtPct(THRESHOLDS.baseline)}</span>
            <span class="verdict-line">${pass ? 'Indicative band: <b>' + esc(tierLabel) + '</b>' : 'Below the practice pass bar.'} · mean APE ${fmtPct(report.mean)} · ${telemetry.toolCalls} tool call(s) · ${telemetry.steps} step(s) · ${telemetry.wallMs} ms</span>
          </div>
        </div>
      </div>

      <div class="score-tablewrap">
        <table class="score-table">
          <thead><tr><th>Room / item</th><th>Your quantity</th><th>Ground truth</th><th class="num">APE</th><th class="qv">Pass</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <p class="score-note">${mode === 'demo'
        ? 'The demo agent calibrated off the scale bar and measured each room polygon at the calibrated scale — these numbers are computed from the plan geometry, not looked up. It should read <b>0.00% APE</b>.'
        : 'Your model drove the same tools against the same planset. Areas are computed by the in-browser environment from the plan geometry at the scale your model set.'}</p>

      <div class="score-actions">
        <button class="cta-btn" type="button" id="run-again"><span class="arrow" aria-hidden="true">▶</span> Run again</button>
        <a class="t-btn" href="request-certification.html">Request a certified session <span aria-hidden="true">→</span></a>
      </div>
      <p class="score-fine">This is a free practice self-test on a <b>public</b> answer key. It is <b>not</b> a certification and nothing is recorded. A weighted, verifiable badge comes only from a proctored run on a held-out planset — <a href="request-certification.html">request certification</a>.</p>
    `;

    // rebind the freshly-rendered "Run again"
    const again = $('run-again');
    if (again) again.addEventListener('click', () => { onRun(); scrollToRun(); });

    setStatus(pass ? `Scored: PASS · median APE ${medianTxt}` : `Scored: FAIL · median APE ${medianTxt}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function showFormErrors(errs) {
    const el = $('form-errors');
    if (!el) return;
    el.hidden = false;
    el.innerHTML = errs.map((e) => `<li>${esc(e)}</li>`).join('');
  }
  function clearFormErrors() { const el = $('form-errors'); if (el) { el.hidden = true; el.innerHTML = ''; } }

  function fmtPct(x) { return (typeof x === 'number' ? (Math.round(x * 100) / 100).toFixed(2) : '—') + '%'; }

  // Expose a tiny hook for the in-browser acceptance check / debugging.
  window.__otaSelfTest = { createEnvironment, scoreRun, runAgentLoop, makeDemoModel, TASK, SVG_TEXT };
})();
