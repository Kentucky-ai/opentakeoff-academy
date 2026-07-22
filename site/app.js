/* ============================================================
   OpenTakeoff Academy — shared front-end logic.
   - Injects the decorative construction-site scene.
   - Loads ./leaderboard.json (embedded fallback if absent).
   - Renders the index leaderboard/academy and the cert page.
   Depends on badge.js (window.OTABadge).
   ============================================================ */
(function () {
  "use strict";

  /* ---------- tiny helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function pct(n, d) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toFixed(d == null ? 1 : d) + "%";
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toISOString().slice(0, 10);
  }
  function fmtDateTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
  function monthYear(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    var m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return m[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  var COMPETENCY_LABEL = {
    "scale-calibration": "Scale Calibration",
    "fixture-count": "Fixture Count",
    "area-takeoff": "Area Takeoff",
    "scope-identification": "Scope Identification",
    "general-takeoff": "General Takeoff"
  };
  var COMPETENCY_SHORT = {
    "scale-calibration": "S.Cal", "fixture-count": "Fix",
    "area-takeoff": "Area", "scope-identification": "Scope", "general-takeoff": "Gen"
  };
  var METRIC_NOUN = {
    "scale-calibration": "median scale error",
    "fixture-count": "median count error",
    "area-takeoff": "median APE",
    "scope-identification": "missed-scope rate",
    "general-takeoff": "median APE"
  };
  var TIER_LABEL = { apprentice: "Apprentice", journeyman: "Journeyman", master: "Master", bar: "Baseline" };
  var TIER_LETTER = { apprentice: "A", journeyman: "J", master: "M", bar: "BAR" };
  var TIER_PERMIT = { apprentice: "a", journeyman: "j", master: "m", bar: "m" };
  var TIER_CHIP = { apprentice: "c-a", journeyman: "c-j", master: "c-m", bar: "c-bar" };

  function compLabel(c) { return COMPETENCY_LABEL[c] || c || "—"; }
  function metricNoun(c) { return METRIC_NOUN[c] || "median error"; }

  function attChip(att) {
    if (att === "certified") {
      return '<span class="att att-certified" title="Proctored held-out run — trustworthy public mark">' +
        '<span class="dot" aria-hidden="true"></span>Certified</span>';
    }
    return '<span class="att att-self" title="Entrant-run and self-attested — lower trust">' +
      '<span class="dot" aria-hidden="true"></span>Self-Reported</span>';
  }
  function movementCell(m) {
    if (m === "up") return '<span class="d-up" title="Moved up">&#9650;</span>';
    if (m === "down") return '<span class="d-down" title="Moved down">&#9660;</span>';
    if (m === "new") return '<span class="d-new" title="New this window">NEW</span>';
    return '<span class="d-flat" title="No change">&mdash;</span>';
  }

  /* ---------- embedded fallback (documented shape) ---------- */
  /* Used only if ./leaderboard.json is absent (e.g. standalone preview).
     When the file is present it is the source of truth. */
  var THRESH = {
    "area-takeoff": { metric: "ape", apprentice: 8.0, journeyman: 6.0, master: "beats-baseline", unit: "% APE" },
    "fixture-count": { metric: "count-error", apprentice: 5.0, journeyman: 3.0, master: "beats-baseline", unit: "% miscount" },
    "scale-calibration": { metric: "scale-error", apprentice: 5.0, journeyman: 3.5, master: "beats-baseline", unit: "% error" },
    "scope-identification": { metric: "scope-f1", apprentice: 6.0, journeyman: 4.0, master: "beats-baseline", unit: "% miss" }
  };
  var FALLBACK = {
    schemaVersion: "1.0",
    updatedAt: "2026-07-19T00:00:00Z",
    windowLabel: "2026-07-19",
    suites: {
      div9: { track: "div9", title: "Division 9 — Flooring", suiteVersion: "1.0", baseline: 2.1,
        competencies: ["area-takeoff", "fixture-count", "scale-calibration", "scope-identification"], thresholds: THRESH },
      generalist: { track: "generalist", title: "Generalist Takeoff", suiteVersion: "1.0", baseline: 2.2,
        competencies: ["area-takeoff", "fixture-count", "scale-calibration", "scope-identification"], thresholds: THRESH }
    },
    rows: [
      { rank: 1, modelId: "reference/agent-a", contestant: "Reference Agent A", track: "generalist",
        competency: "fixture-count", tier: "master", medianApe: 1.4, nRanked: 48,
        attestation: "certified", movement: "up", certId: "OTA-FC-0031", url: "https://example.com/agents/reference-a" },
      { rank: 2, modelId: "human/senior-estimator", contestant: "THE ESTIMATOR", track: "div9",
        competency: "area-takeoff", tier: "bar", medianApe: 2.1, nRanked: 60,
        attestation: "certified", movement: "flat" },
      { rank: 3, modelId: "reference/agent-c", contestant: "Reference Agent C", track: "generalist",
        competency: "fixture-count", tier: "journeyman", medianApe: 2.6, nRanked: 36,
        attestation: "certified", movement: "up", certId: "OTA-FC-0039", url: "https://example.com/agents/reference-c" },
      { rank: 4, modelId: "reference/agent-d", contestant: "Reference Agent D", track: "div9",
        competency: "scale-calibration", tier: "journeyman", medianApe: 3.2, nRanked: 24,
        attestation: "certified", movement: "flat", certId: "OTA-SC-0052", url: "https://example.com/agents/reference-d" },
      { rank: 5, modelId: "reference/agent-a", contestant: "Reference Agent A", track: "generalist",
        competency: "scope-identification", tier: "journeyman", medianApe: 3.8, nRanked: 40,
        attestation: "certified", movement: "up", certId: "OTA-SI-0044", url: "https://example.com/agents/reference-a" },
      { rank: 6, modelId: "reference/agent-d", contestant: "Reference Agent D", track: "div9",
        competency: "area-takeoff", tier: "journeyman", medianApe: 4.6, nRanked: 24,
        attestation: "certified", movement: "flat", certId: "OTA-D9A-0047", url: "https://example.com/agents/reference-d" },
      { rank: 7, modelId: "reference/agent-b", contestant: "Reference Agent B", track: "generalist",
        competency: "scope-identification", tier: "apprentice", medianApe: 4.9, nRanked: 18,
        attestation: "self_reported", movement: "new", url: "https://example.com/agents/reference-b" }
    ]
  };

  function loadLeaderboard() {
    return fetch("./leaderboard.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("no file"); return r.json(); })
      .then(function (j) { return normalize(j); })
      .catch(function () { var f = normalize(FALLBACK); f._fallback = true; return f; });
  }
  function normalize(data) {
    data = data || {};
    var rows = Array.isArray(data.rows) ? data.rows.slice() : [];
    rows.forEach(function (r, i) {
      if (r.rank == null) r.rank = i;
      if (r.medianApe == null && r.score != null) r.medianApe = r.score;
      if (!r.attestation) r.attestation = "self_reported";
      if (!r.tier) r.tier = "apprentice";
      if (!r.movement) r.movement = "flat";
    });
    data.rows = rows;
    if (!data.suites) data.suites = {};
    return data;
  }

  function suiteFor(data, track) {
    return (data.suites && (data.suites[track] || data.suites[Object.keys(data.suites)[0]])) || {};
  }
  function suiteVersionOf(s) { return s.suiteVersion || s.version || "—"; }
  function suiteTitleOf(s, track) { return s.title || s.track || track || "—"; }
  // Handles both flat-number thresholds and per-tier threshold objects.
  // Returns the numeric pass bar for this row's tier, or undefined
  // (e.g. master = "beats-baseline", or the human baseline row).
  function thresholdFor(data, row) {
    var s = suiteFor(data, row.track);
    var t = s.thresholds ? s.thresholds[row.competency] : undefined;
    if (t == null) return undefined;
    if (typeof t === "number") return t;
    var v = t[row.tier];
    return typeof v === "number" ? v : undefined;
  }
  function recertOf(data) { return data.recertAt || data.recertDate || null; }
  function recertText(data) {
    var r = recertOf(data);
    return r ? fmtDate(r) : (data.windowLabel ? "window " + data.windowLabel : "—");
  }
  function expLabel(data) {
    var r = recertOf(data);
    return r ? "EXP " + fmtDate(r) : (data.windowLabel ? "WINDOW " + data.windowLabel : "IN FORCE");
  }

  /* ============================================================
     DECORATIVE SCENE (shared background) — injected, aria-hidden.
     ============================================================ */
  var SCENE = '' +
'<svg class="scene-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">' +
'<defs>' +
'<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9def8"/><stop offset="0.42" stop-color="#cfeaf6"/><stop offset="0.72" stop-color="#ffe6b8"/><stop offset="1" stop-color="#ffcf87"/></linearGradient>' +
'<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6dd"/><stop offset="0.5" stop-color="#ffdd8a"/><stop offset="1" stop-color="#ffce7a" stop-opacity="0"/></radialGradient>' +
'<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8c69c"/><stop offset="1" stop-color="#b39a6c"/></linearGradient>' +
'<pattern id="scaff" width="46" height="56" patternUnits="userSpaceOnUse"><line x1="0" y1="0.5" x2="46" y2="0.5" stroke="#8b97a2" stroke-width="2"/><line x1="0" y1="28" x2="46" y2="28" stroke="#8b97a2" stroke-width="2"/><line x1="0.5" y1="0" x2="0.5" y2="56" stroke="#8b97a2" stroke-width="2"/><line x1="45.5" y1="0" x2="45.5" y2="56" stroke="#8b97a2" stroke-width="2"/><line x1="0" y1="0" x2="46" y2="28" stroke="#a7b2bc" stroke-width="1.4"/><line x1="46" y1="28" x2="0" y2="56" stroke="#a7b2bc" stroke-width="1.4"/></pattern>' +
'<pattern id="net" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 0 L12 12 M12 0 L0 12" stroke="rgba(232,93,4,0.5)" stroke-width="1.1"/></pattern>' +
'<pattern id="latV" width="24" height="38" patternUnits="userSpaceOnUse"><line x1="0.5" y1="0" x2="0.5" y2="38" stroke="#c98a00" stroke-width="2"/><line x1="23.5" y1="0" x2="23.5" y2="38" stroke="#c98a00" stroke-width="2"/><line x1="0" y1="0" x2="24" y2="38" stroke="#e8a900" stroke-width="1.4"/><line x1="24" y1="0" x2="0" y2="38" stroke="#e8a900" stroke-width="1.4"/></pattern>' +
'<pattern id="latH" width="38" height="18" patternUnits="userSpaceOnUse"><line x1="0" y1="0.5" x2="38" y2="0.5" stroke="#c98a00" stroke-width="2"/><line x1="0" y1="17.5" x2="38" y2="17.5" stroke="#c98a00" stroke-width="2"/><line x1="0" y1="0" x2="38" y2="18" stroke="#e8a900" stroke-width="1.3"/><line x1="38" y1="0" x2="0" y2="18" stroke="#e8a900" stroke-width="1.3"/></pattern>' +
'<pattern id="hazTape" width="34" height="14" patternUnits="userSpaceOnUse"><rect width="34" height="14" fill="#ffd21e"/><polygon points="0,0 14,0 0,14" fill="#191510"/><polygon points="17,0 31,0 3,14 -11,14" fill="#191510"/><polygon points="34,0 48,0 20,14 6,14" fill="#191510"/></pattern>' +
'</defs>' +
'<rect width="1600" height="900" fill="url(#sky)"/><circle cx="1300" cy="205" r="150" fill="url(#sun)"/><circle cx="1300" cy="205" r="60" fill="#fff4d4"/>' +
'<g fill="#ffffff" opacity="0.72"><g class="cloud"><ellipse cx="250" cy="150" rx="60" ry="24"/><ellipse cx="300" cy="138" rx="48" ry="26"/><ellipse cx="205" cy="160" rx="40" ry="20"/></g><g class="cloud c2" opacity="0.6"><ellipse cx="880" cy="110" rx="70" ry="26"/><ellipse cx="940" cy="98" rx="52" ry="26"/><ellipse cx="820" cy="120" rx="44" ry="20"/></g><g class="cloud c3" opacity="0.5"><ellipse cx="620" cy="215" rx="52" ry="20"/><ellipse cx="668" cy="206" rx="40" ry="20"/></g></g>' +
'<g fill="#9fb9d0" opacity="0.55"><rect x="40" y="486" width="70" height="150"/><rect x="120" y="446" width="54" height="190"/><rect x="360" y="502" width="60" height="134"/><rect x="430" y="470" width="46" height="166"/><rect x="1040" y="494" width="66" height="142"/><rect x="1116" y="458" width="50" height="178"/><rect x="1420" y="486" width="72" height="150"/><rect x="1500" y="510" width="48" height="126"/></g>' +
'<g><rect x="150" y="360" width="230" height="410" fill="#d3d8dd"/><g stroke="#a7afb8" stroke-width="4"><line x1="150" y1="420" x2="380" y2="420"/><line x1="150" y1="490" x2="380" y2="490"/><line x1="150" y1="560" x2="380" y2="560"/><line x1="150" y1="630" x2="380" y2="630"/><line x1="150" y1="700" x2="380" y2="700"/><line x1="212" y1="360" x2="212" y2="770"/><line x1="286" y1="360" x2="286" y2="770"/></g><g fill="#8ea2b0" opacity="0.8"><rect x="164" y="500" width="34" height="44"/><rect x="228" y="500" width="34" height="44"/><rect x="302" y="500" width="34" height="44"/><rect x="164" y="570" width="34" height="44"/><rect x="302" y="570" width="34" height="44"/><rect x="164" y="640" width="34" height="44"/><rect x="228" y="640" width="34" height="44"/></g><rect x="286" y="420" width="94" height="350" fill="url(#scaff)"/><rect x="286" y="420" width="94" height="180" fill="url(#net)"/></g>' +
'<g><rect x="640" y="250" width="270" height="520" fill="#dbe0e4"/><g stroke="#aab2ba" stroke-width="4"><line x1="640" y1="316" x2="910" y2="316"/><line x1="640" y1="388" x2="910" y2="388"/><line x1="640" y1="460" x2="910" y2="460"/><line x1="640" y1="532" x2="910" y2="532"/><line x1="640" y1="604" x2="910" y2="604"/><line x1="640" y1="676" x2="910" y2="676"/><line x1="730" y1="250" x2="730" y2="770"/><line x1="820" y1="250" x2="820" y2="770"/></g><g fill="#93a7b5" opacity="0.82"><rect x="656" y="400" width="40" height="48"/><rect x="746" y="400" width="40" height="48"/><rect x="836" y="400" width="40" height="48"/><rect x="656" y="472" width="40" height="48"/><rect x="836" y="472" width="40" height="48"/><rect x="656" y="544" width="40" height="48"/><rect x="746" y="544" width="40" height="48"/><rect x="836" y="544" width="40" height="48"/></g><rect x="640" y="316" width="90" height="454" fill="url(#scaff)"/><rect x="640" y="316" width="90" height="230" fill="url(#net)"/></g>' +
'<g><rect x="1180" y="404" width="210" height="366" fill="#d3d8dd"/><g stroke="#a7afb8" stroke-width="4"><line x1="1180" y1="464" x2="1390" y2="464"/><line x1="1180" y1="534" x2="1390" y2="534"/><line x1="1180" y1="604" x2="1390" y2="604"/><line x1="1180" y1="674" x2="1390" y2="674"/><line x1="1250" y1="404" x2="1250" y2="770"/><line x1="1320" y1="404" x2="1320" y2="770"/></g><g fill="#8ea2b0" opacity="0.8"><rect x="1194" y="546" width="36" height="46"/><rect x="1264" y="546" width="36" height="46"/><rect x="1334" y="546" width="36" height="46"/></g><rect x="1180" y="464" width="86" height="306" fill="url(#scaff)"/><rect x="1180" y="464" width="86" height="150" fill="url(#net)"/></g>' +
'<g transform="translate(590,690)"><rect x="-13" y="-430" width="26" height="430" fill="url(#latV)"/><rect x="-17" y="-462" width="34" height="32" rx="3" fill="#f2b100" stroke="#8a5f00" stroke-width="2"/><polygon points="0,-506 -15,-462 15,-462" fill="none" stroke="#8a5f00" stroke-width="2.5"/><rect x="-168" y="-468" width="150" height="18" fill="url(#latH)"/><rect x="-178" y="-476" width="30" height="34" fill="#333029" stroke="#111" stroke-width="1.5"/><rect x="18" y="-466" width="330" height="16" fill="url(#latH)"/><g stroke="#6b4a00" stroke-width="1.6"><line x1="0" y1="-506" x2="-150" y2="-468"/><line x1="0" y1="-506" x2="150" y2="-460"/><line x1="0" y1="-506" x2="320" y2="-456"/></g><g class="swing"><line x1="250" y1="-450" x2="250" y2="-320" stroke="#3a2c10" stroke-width="2.5"/><polygon points="243,-320 257,-320 254,-306 246,-306" fill="#6b4a00"/><rect x="216" y="-306" width="68" height="20" rx="2" fill="#cbb27f" stroke="#7a6636" stroke-width="1.5"/></g></g>' +
'<g transform="translate(1250,660) scale(0.72)" opacity="0.9"><rect x="-12" y="-460" width="24" height="460" fill="url(#latV)"/><rect x="-16" y="-490" width="32" height="30" rx="3" fill="#f2b100" stroke="#8a5f00" stroke-width="2"/><polygon points="0,-532 -14,-490 14,-490" fill="none" stroke="#8a5f00" stroke-width="2.5"/><rect x="-158" y="-496" width="142" height="18" fill="url(#latH)"/><rect x="-168" y="-504" width="28" height="34" fill="#333029" stroke="#111" stroke-width="1.5"/><rect x="16" y="-494" width="300" height="16" fill="url(#latH)"/><g stroke="#6b4a00" stroke-width="1.6"><line x1="0" y1="-532" x2="-140" y2="-496"/><line x1="0" y1="-532" x2="150" y2="-488"/><line x1="0" y1="-532" x2="300" y2="-484"/></g><g class="swing s2"><line x1="210" y1="-478" x2="210" y2="-360" stroke="#3a2c10" stroke-width="2.5"/><rect x="182" y="-360" width="56" height="46" rx="2" fill="#333029" stroke="#111" stroke-width="1.5"/></g></g>' +
'<rect x="0" y="762" width="1600" height="138" fill="url(#ground)"/><rect x="0" y="762" width="1600" height="16" fill="url(#hazTape)"/>' +
'<g transform="translate(360,700)"><ellipse cx="70" cy="86" rx="130" ry="12" fill="rgba(25,21,16,0.18)"/><rect x="-6" y="58" width="176" height="30" rx="15" fill="#2a2620" stroke="#141210" stroke-width="2"/><g fill="#4a453b"><circle cx="16" cy="73" r="9"/><circle cx="55" cy="73" r="9"/><circle cx="95" cy="73" r="9"/><circle cx="134" cy="73" r="9"/><circle cx="158" cy="73" r="9"/></g><rect x="18" y="18" width="120" height="44" rx="6" fill="#ffcf1e" stroke="#c9880a" stroke-width="2"/><rect x="120" y="24" width="26" height="14" rx="3" fill="#c9880a"/><rect x="26" y="-16" width="60" height="42" rx="6" fill="#ffcf1e" stroke="#c9880a" stroke-width="2"/><rect x="34" y="-8" width="44" height="26" rx="3" fill="#2f5468" opacity="0.85"/><g class="digarm"><polygon points="130,26 150,4 214,66 196,84" fill="#ffcf1e" stroke="#c9880a" stroke-width="2"/><polygon points="206,60 240,92 236,110 200,100 194,80" fill="#e8a800" stroke="#a8760a" stroke-width="2"/><path d="M228 96 L262 104 L256 122 L224 112 Z" fill="#5a5148" stroke="#2a2620" stroke-width="2"/></g><g fill="#efe6d2"><ellipse class="puff" cx="270" cy="120" rx="16" ry="11"/><ellipse class="puff p2" cx="290" cy="122" rx="13" ry="9"/><ellipse class="puff p3" cx="256" cy="124" rx="11" ry="8"/></g></g>' +
'<g transform="translate(760,772)"><rect x="-4" y="0" width="120" height="20" fill="url(#hazTape)"/><line x1="8" y1="20" x2="-6" y2="52" stroke="#3a352b" stroke-width="6"/><line x1="104" y1="20" x2="118" y2="52" stroke="#3a352b" stroke-width="6"/></g>' +
'<g transform="translate(1170,738)"><line x1="26" y1="52" x2="26" y2="96" stroke="#4a453b" stroke-width="6"/><rect x="0" y="0" width="52" height="52" rx="6" transform="rotate(45 26 26)" fill="#ffd21e" stroke="#191510" stroke-width="4"/><text x="26" y="34" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" font-weight="900" fill="#191510">!</text></g>' +
'<g transform="translate(560,834)"><ellipse cx="16" cy="40" rx="20" ry="5" fill="rgba(25,21,16,0.18)"/><rect x="-2" y="36" width="36" height="6" rx="3" fill="#e85d04"/><polygon points="16,2 30,38 2,38" fill="#ff7a1a"/><polygon points="11,18 21,18 24,26 8,26" fill="#fff"/></g>' +
'<g transform="translate(690,842) scale(0.86)"><ellipse cx="16" cy="40" rx="20" ry="5" fill="rgba(25,21,16,0.18)"/><rect x="-2" y="36" width="36" height="6" rx="3" fill="#e85d04"/><polygon points="16,2 30,38 2,38" fill="#ff7a1a"/><polygon points="11,18 21,18 24,26 8,26" fill="#fff"/></g>' +
'<g transform="translate(940,850) scale(0.78)"><ellipse cx="16" cy="40" rx="20" ry="5" fill="rgba(25,21,16,0.18)"/><rect x="-2" y="36" width="36" height="6" rx="3" fill="#e85d04"/><polygon points="16,2 30,38 2,38" fill="#ff7a1a"/><polygon points="11,18 21,18 24,26 8,26" fill="#fff"/></g>' +
'</svg><div class="scene-haze"></div>';

  function injectScene() {
    var host = $("#scene");
    if (host && !host.getAttribute("data-filled")) {
      host.innerHTML = SCENE;
      host.setAttribute("data-filled", "1");
    }
  }

  /* ============================================================
     ACADEMY SEAL (shared SVG)
     ============================================================ */
  function sealSVG(sub) {
    return '' +
'<svg viewBox="0 0 130 130" role="img" aria-label="Academy seal">' +
'<circle cx="65" cy="65" r="60" fill="none" stroke="#e8b64a" stroke-width="7" stroke-dasharray="4 3"/>' +
'<circle cx="65" cy="65" r="53" fill="#fbf6e8" stroke="#a9761c" stroke-width="1.5"/>' +
'<circle cx="65" cy="65" r="36" fill="none" stroke="#a9761c" stroke-width="1"/>' +
'<defs><path id="sealTop" d="M 65,65 m -44,0 a 44,44 0 1,1 88,0"/><path id="sealBot" d="M 65,65 m -44,0 a 44,44 0 1,0 88,0"/></defs>' +
'<text font-size="9.5" font-family="system-ui, sans-serif" font-weight="700" letter-spacing="2.5" fill="#a9761c"><textPath href="#sealTop" startOffset="50%" text-anchor="middle">OPENTAKEOFF ACADEMY</textPath></text>' +
'<text font-size="8.5" font-family="system-ui, sans-serif" font-weight="700" letter-spacing="2" fill="#a9761c"><textPath href="#sealBot" startOffset="50%" text-anchor="middle">' + esc(sub || "CERTIFIED CREW") + '</textPath></text>' +
'<path d="M65 45 L69.7 58.6 L84.1 58.9 L72.6 67.6 L76.8 81.4 L65 73.2 L53.2 81.4 L57.4 67.6 L45.9 58.9 L60.3 58.6 Z" fill="#e8b64a" stroke="#a9761c" stroke-width="1"/>' +
'<text x="65" y="94" text-anchor="middle" font-size="7" font-family="system-ui, sans-serif" font-weight="700" letter-spacing="1.5" fill="#a9761c">EST. 2026</text>' +
'</svg>';
  }

  /* ============================================================
     CERT PAPER (shared: index featured ticket + cert page)
     `c` is a normalized cert-ish object.
     ============================================================ */
  function certPaper(c) {
    var certified = c.attestation === "certified";
    var name = c.contestant || c.modelId || "—";
    var thr = c.threshold;
    var terms;
    if (c.tier === "master") {
      terms = "Earned by holding " + metricNoun(c.competency) + " at " + pct(c.score) +
        " — beating the Senior Estimator baseline of " + pct(c.baseline) + " — across " +
        (c.nRanked || "—") + " held-out plansets, within the per-planset wall-clock and token budget.";
    } else if (c.tier === "journeyman") {
      terms = "Earned by holding " + metricNoun(c.competency) + " at " + pct(c.score) +
        (thr != null ? " — under the " + pct(thr) + " threshold" : "") +
        " — repeatably across " + (c.nRanked || "—") +
        " held-out plansets within the per-planset budget, sustained over consecutive weekly recerts.";
    } else {
      terms = "Provisional: cleared " + metricNoun(c.competency) + " at " + pct(c.score) +
        (thr != null ? " against the " + pct(thr) + " threshold" : "") +
        " on a ranked batch of " + (c.nRanked || "—") + " plansets. Supervised release until held repeatably.";
    }
    var attLine = certified
      ? '<div class="cert-attline">' + attChip("certified") + '</div>'
      : '<div class="cert-attline">' + attChip("self_reported") + '</div>';

    return '' +
'<div class="hero-cert' + (certified ? "" : " self") + '">' +
'<div class="cert-inner">' +
'<div class="cert-academy">OPENTAKEOFF ACADEMY</div>' +
'<p class="cert-office">Certification Office &middot; Estimating Department</p>' +
attLine +
'<div class="cert-divider"><span>&#9670;</span></div>' +
'<p class="cert-certifies">This certifies that</p>' +
'<p class="cert-name">' + esc(name) + '</p>' +
'<p class="cert-qualified">is qualified to perform</p>' +
'<p class="cert-comp">' + esc(compLabel(c.competency).toUpperCase()) + '</p>' +
'<span class="cert-tier-banner">' + esc(TIER_LABEL[c.tier] || c.tier) + '</span>' +
'<p class="cert-terms">' + esc(terms) + '</p>' +
'<p class="cert-valid">Issued ' + esc(fmtDate(c.issuedAt)) + ' &middot; Expires ' + esc(fmtDate(c.expiresAt)) + ' &middot; Recert required</p>' +
'<div class="cert-footer">' +
'<div class="cert-sig"><span class="sig-script">The Estimator</span><div class="sig-line"><div class="sig-name">The Estimator</div><div class="sig-role">Senior Estimator &middot; Registrar</div></div></div>' +
'<div class="cert-seal-block" aria-hidden="true">' + sealSVG(certified ? "CERTIFIED CREW" : "SELF-REPORTED") + '<div class="seal-ribbons"><i></i><i></i></div></div>' +
'<div class="cert-no">Ticket N&ordm; ' + esc(c.certId || "—") + '<br>Suite ' + esc(c.suiteVersion || "—") + '<br>Registrar, OpenTakeoff Academy</div>' +
'</div>' +
'</div>' +
'</div>';
  }

  // Build a cert-ish object from a leaderboard row (+ suite) — used for the
  // index featured ticket when we don't fetch the full cert JSON.
  function certFromRow(data, row) {
    var s = suiteFor(data, row.track);
    return {
      certId: row.certId, contestant: row.contestant, modelId: row.modelId,
      competency: row.competency, tier: row.tier, attestation: row.attestation,
      score: row.medianApe, baseline: s.baseline, nRanked: row.nRanked,
      threshold: thresholdFor(data, row), suiteVersion: suiteVersionOf(s),
      issuedAt: data.windowLabel ? data.windowLabel + "T06:00:00Z" : data.updatedAt,
      expiresAt: data.recertAt
    };
  }

  // Normalize a full cert.json (cert.schema.json) into the cert-ish shape.
  function certFromDoc(doc, data) {
    var r = doc.result || {};
    return {
      certId: doc.certId, contestant: (doc.subject || {}).contestant,
      modelId: (doc.subject || {}).modelId, harness: (doc.subject || {}).harness,
      subjectUrl: (doc.subject || {}).url,
      competency: doc.competency, tier: doc.tier, attestation: doc.attestation,
      score: r.score, baseline: r.baseline, nRanked: r.nRanked, metric: r.metric,
      suiteVersion: r.suiteVersion, track: doc.track,
      issuedAt: doc.issuedAt, expiresAt: doc.expiresAt,
      evidence: doc.evidence || {}, integrity: doc.integrity || {}, issuer: doc.issuer || {},
      threshold: undefined
    };
  }

  /* ============================================================
     INDEX PAGE
     ============================================================ */
  function renderIndex(data) {
    var rows = data.rows.slice();
    // pin baseline (tier:'bar') first, then by rank
    rows.sort(function (a, b) {
      var ab = a.tier === "bar" ? -1 : 0, bb = b.tier === "bar" ? -1 : 0;
      if (ab !== bb) return ab - bb;
      return (a.rank || 0) - (b.rank || 0);
    });
    var ranked = rows.filter(function (r) { return r.tier !== "bar"; });
    var tickets = ranked.filter(function (r) { return r.tier === "journeyman" || r.tier === "master"; });
    var provisional = ranked.filter(function (r) { return r.tier === "apprentice"; });
    var certifiedTickets = ranked.filter(function (r) { return r.attestation === "certified" && r.tier !== "apprentice"; });

    var s = suiteFor(data, "div9");

    /* ---- topbar counters + tickers ---- */
    var setText = function (id, t) { var e = document.getElementById(id); if (e) e.textContent = t; };
    // Render an integer into a fixed-width LED strip (9 digits, comma-grouped).
    var setLed = function (id, n) {
      var e = document.getElementById(id);
      if (!e) return;
      var d = String(Math.max(0, Math.round(n || 0))).padStart(9, "0").split("");
      e.innerHTML = d.map(function (ch, i) {
        return (i && i % 3 === 0 ? '<b class="sep">,</b>' : "") + "<b>" + ch + "</b>";
      }).join("");
    };
    setText("count-tickets", certifiedTickets.length + " CERTIFIED TICKETS IN FORCE");
    setText("count-tickets2", certifiedTickets.length);
    // The board is sample data until real runs land. Say so on the page — a
    // disclaimer that only appears when the fetch FAILS is backwards, and this
    // site's whole claim is that its numbers are checkable.
    var demoTag = document.getElementById("demo-tag");
    if (demoTag) {
      var sample = !!(data._fallback || data.disclaimer);
      demoTag.style.display = sample ? "" : "none";
      if (data.disclaimer) demoTag.textContent = "⚠ " + data.disclaimer;
    }

    // Runs-scored odometer reflects actual scored runs — no decorative count.
    setLed("led-runs", ranked.reduce(function (n, r) { return n + (r.nRanked || 0); }, 0));

    /* ---- featured (top certified journeyman/master) ---- */
    var featured = certifiedTickets[0] || ranked[0] || rows[0];
    if (featured) {
      var fSuite = suiteFor(data, featured.track);
      var fBaseline = fSuite.baseline;
      var fThr = thresholdFor(data, featured);
      var isMaster = featured.tier === "master";
      var pass = isMaster || fThr == null || featured.medianApe <= fThr;
      var thrText = isMaster ? " &middot; BEATS BAR" : (fThr != null ? " &middot; THR " + esc(pct(fThr)) : "");
      var lcd = document.getElementById("lcd-main");
      if (lcd) {
        lcd.innerHTML = '' +
'<div class="lcd-cell"><p class="lcd-label">Now Certifying &middot; ' + esc(metricNoun(featured.competency)) + '</p>' +
'<p class="lcd-big">' + esc(pct(featured.medianApe)) + '</p>' +
'<p class="lcd-sub' + (pass ? "" : " fail") + '">' + esc(compLabel(featured.competency).toUpperCase()) + thrText + ' &middot; ' + (pass ? "PASS" : "OVER") + '</p></div>' +
'<div class="lcd-cell"><p class="lcd-label">Accuracy Meter &middot; Error Spectrum</p><div class="vz" aria-hidden="true">' + new Array(25).join("<i></i>") + '</div></div>' +
'<div class="lcd-cell"><p class="lcd-label">Trial Telemetry</p><div class="tele">' +
'<div class="tele-row"><span class="k">Tier</span><span class="v amber">' + esc((TIER_LABEL[featured.tier] || "").toUpperCase()) + '</span></div>' +
'<div class="tele-row"><span class="k">vs Bar</span><span class="v ' + (fBaseline != null && featured.medianApe <= fBaseline ? "green" : "") + '">' + esc(pct(fBaseline)) + '</span></div>' +
'<div class="tele-row"><span class="k">N Ranked</span><span class="v">' + esc(featured.nRanked || "—") + '</span></div>' +
'<div class="tele-row"><span class="k">Held-Out</span><span class="v green">' + esc(featured.nRanked || "—") + ' PLANSETS</span></div>' +
'</div></div>';
      }
      var deckTicker = document.getElementById("deck-ticker");
      if (deckTicker) {
        var seg = "NOW CERTIFYING: " + compLabel(featured.competency).toUpperCase() + " — " +
          (featured.contestant || featured.modelId).toUpperCase() + " · " + (TIER_LABEL[featured.tier]||"").toUpperCase() +
          " · " + metricNoun(featured.competency).toUpperCase() + " " + pct(featured.medianApe) +
          (fThr != null ? " ≤ THR " + pct(fThr) : "") + " · " + (featured.nRanked||"—") + " HELD-OUT PLANSETS · RECERT " + recertText(data) + " ·   ";
        deckTicker.textContent = seg + seg;
      }
    }

    /* ---- competency board (featured contestant's certs) ---- */
    var board = document.getElementById("comp-board");
    if (board && featured) {
      var who = featured.contestant || featured.modelId;
      var mine = ranked.filter(function (r) { return (r.contestant || r.modelId) === who; });
      var order = ["scale-calibration", "fixture-count", "area-takeoff", "scope-identification"];
      mine.sort(function (a, b) { return order.indexOf(a.competency) - order.indexOf(b.competency); });
      var pctFor = { apprentice: 33, journeyman: 66, master: 100, bar: 80 };
      board.innerHTML = mine.map(function (r) {
        var w = pctFor[r.tier] || 20;
        return '<div class="comp-row">' +
          '<div class="comp-name">' + esc(compLabel(r.competency)) + '<small>' + esc(metricNoun(r.competency)) + " " + esc(pct(r.medianApe)) + '</small></div>' +
          '<div class="comp-tierchip"><span class="tier-chip ' + TIER_CHIP[r.tier] + '">' + esc(TIER_LABEL[r.tier] || r.tier) + '</span></div>' +
          '<div class="comp-bar"><i class="b-' + esc(r.tier) + '" style="width:' + w + '%"></i></div>' +
          '</div>';
      }).join("") || '<div class="comp-empty">No certifications yet</div>';
      var ct = document.getElementById("comp-title");
      if (ct) ct.textContent = "Competency Board — " + who;
    }

    /* ---- cert wall (tickets in force) ---- */
    var wall = document.getElementById("cert-wall");
    if (wall) {
      var wallRows = ranked.slice().sort(function (a, b) {
        var t = { master: 0, journeyman: 1, apprentice: 2 };
        if (t[a.tier] !== t[b.tier]) return t[a.tier] - t[b.tier];
        return (a.rank||0) - (b.rank||0);
      });
      wall.innerHTML = wallRows.map(function (r) {
        var thr = thresholdFor(data, r);
        var stat;
        if (r.tier === "master") stat = metricNoun(r.competency).toUpperCase() + " " + pct(r.medianApe) + " &middot; BEATS BAR " + pct(r.baseline || s.baseline) + " &middot; " + (r.nRanked||"—") + " PLANSETS";
        else if (r.tier === "journeyman") stat = metricNoun(r.competency).toUpperCase() + " " + pct(r.medianApe) + (thr!=null?" &le; " + pct(thr):"") + " &middot; " + (r.nRanked||"—") + " PLANSETS";
        else stat = "PROVISIONAL &middot; " + metricNoun(r.competency).toUpperCase() + " " + pct(r.medianApe) + " &middot; SUPERVISED";
        var tag = r.certId ? "a" : "div";
        var href = r.certId ? ' href="cert.html?id=' + encodeURIComponent(r.certId) + '"' : "";
        return '<' + tag + ' class="permit ' + TIER_PERMIT[r.tier] + '"' + href + '>' +
          (r.movement === "new" ? '<span class="new-flag">NEW</span>' : "") +
          '<div class="permit-tab"></div><div class="permit-bd">' +
          '<p class="t-comp">' + esc(compLabel(r.competency)) + '</p>' +
          '<p class="t-holder">' + esc((r.contestant || r.modelId || "").toUpperCase()) + '</p>' +
          '<p class="t-stat">' + stat + '</p>' +
          '<div style="margin-top:9px">' + attChip(r.attestation) + '</div>' +
          '<div class="permit-foot"><span class="tier-chip ' + TIER_CHIP[r.tier] + '">' + esc(TIER_LABEL[r.tier]||r.tier) + '</span>' +
          '<span class="t-exp">' + (r.tier === "apprentice" ? "PROVISIONAL" : expLabel(data)) + '</span></div>' +
          '</div></' + tag + '>';
      }).join("");
    }

    /* ---- crew roster ---- */
    var body = document.getElementById("crew-body");
    if (body) {
      body.innerHTML = rows.map(function (r) {
        var isBar = r.tier === "bar";
        var nameCell;
        var role = isBar ? "HUMAN · SENIOR ESTIMATOR · TRAINER · PINNED"
          : (esc(r.modelId || "") + (r.attestation === "self_reported" ? " · SELF-REPORTED" : ""));
        var nm = esc(r.contestant || r.modelId || "—");
        nameCell = r.certId
          ? '<a class="crew-name" href="cert.html?id=' + encodeURIComponent(r.certId) + '">' + nm + '</a>'
          : '<span class="crew-name">' + nm + '</span>';
        var tierCell = isBar
          ? '<span class="tl tl-bar">BAR</span>'
          : '<span class="tl tl-' + (r.tier === "apprentice" ? "a" : r.tier === "journeyman" ? "j" : "m") + '">' +
            (TIER_LETTER[r.tier] || "") + (r.tier === "master" ? "&#9733;" : "") + '</span>';
        var idx = isBar ? "&#9733;" : String(r.rank).padStart(2, "0");
        return '<tr' + (isBar ? ' class="human"' : "") + '>' +
          '<td class="idx">' + idx + '</td>' +
          '<td>' + nameCell + '<span class="crew-role">' + role + '</span></td>' +
          '<td>' + esc(compLabel(r.competency)) + '</td>' +
          '<td>' + tierCell + '</td>' +
          '<td class="num">' + esc(pct(r.medianApe)) + '</td>' +
          '<td class="num">' + esc(r.nRanked || "—") + '</td>' +
          '<td>' + (isBar ? '<span class="tl tl-bar">SETS BAR</span>' : attChip(r.attestation)) + '</td>' +
          '<td class="num">' + movementCell(isBar ? "flat" : r.movement) + '</td>' +
          '</tr>';
      }).join("");
    }
    var rfoot = document.getElementById("roster-foot");
    if (rfoot) {
      var contestants = {};
      ranked.forEach(function (r) { contestants[r.contestant || r.modelId] = 1; });
      var selfCt = ranked.filter(function (r) { return r.attestation === "self_reported"; }).length;
      rfoot.innerHTML = '<span>' + certifiedTickets.length + ' CERTIFIED &middot; ' + provisional.length + ' PROVISIONAL &middot; <span class="hot">' + selfCt + ' SELF-REPORTED</span></span>' +
        '<span>' + Object.keys(contestants).length + ' CONTESTANTS + 1 TRAINER &middot; BASELINE ' + pct(s.baseline) + '</span>';
    }

    /* ---- weekly review (derived from movement) ---- */
    var weekly = document.getElementById("weekly-grid");
    if (weekly) {
      var promoted = ranked.filter(function (r) { return r.movement === "new" || r.movement === "up"; })
        .sort(function (a, b) { return (a.movement === "new" ? -1 : 0) - (b.movement === "new" ? -1 : 0); })[0];
      var watch = ranked.filter(function (r) { return r.movement === "down"; })[0];
      var leader = ranked.filter(function (r) { return r.tier === "master"; })[0] || certifiedTickets[0];
      var cards = [];
      if (promoted) cards.push('<div class="review-card promo"><div class="rc-head"><span class="rc-led" aria-hidden="true"></span><span class="rc-label">' + (promoted.movement === "new" ? "New Ticket" : "Promoted") + '</span></div>' +
        '<h3>' + esc(promoted.contestant || promoted.modelId) + ' &middot; ' + esc(compLabel(promoted.competency)) + '</h3>' +
        '<p>Cleared ' + esc(metricNoun(promoted.competency)) + ' at ' + esc(pct(promoted.medianApe)) + ' on fresh held-out plansets and holds a ' + esc(TIER_LABEL[promoted.tier]) + ' ticket this window.</p>' +
        '<p class="rc-stat">' + (promoted.certId ? "TICKET " + esc(promoted.certId) : "PROVISIONAL") + '</p></div>');
      if (watch) cards.push('<div class="review-card revoke"><div class="rc-head"><span class="rc-led" aria-hidden="true"></span><span class="rc-label">On Watch</span></div>' +
        '<h3>' + esc(watch.contestant || watch.modelId) + ' &middot; ' + esc(compLabel(watch.competency)) + '</h3>' +
        '<p>Slipped this recert (' + esc(metricNoun(watch.competency)) + ' ' + esc(pct(watch.medianApe)) + ', ' + esc(attChip(watch.attestation).replace(/<[^>]+>/g, "").trim()) + '). Must re-clear next Monday or the ticket comes off the wall.</p>' +
        '<p class="rc-stat">REGRESSION FLAG &middot; RECERT ' + esc(recertText(data)) + '</p></div>');
      if (leader) cards.push('<div class="review-card eow"><div class="rc-head"><span class="rc-led" aria-hidden="true"></span><span class="rc-label">&#9733; Crew Lead</span></div>' +
        '<h3>' + esc(leader.contestant || leader.modelId) + '</h3>' +
        '<p>Top mark on the wall: ' + esc(compLabel(leader.competency)) + ' at ' + esc(pct(leader.medianApe)) +
        (leader.tier === "master" ? ' — beating the Senior Estimator baseline of ' + esc(pct(leader.baseline || s.baseline)) + '. Qualified to sign off.' : '.') + '</p>' +
        '<p class="rc-stat">' + esc((leader.contestant || leader.modelId).toUpperCase()) + ' &middot; ' + esc((TIER_LABEL[leader.tier]||"").toUpperCase()) + '</p></div>');
      weekly.innerHTML = cards.join("");
    }

    /* ---- featured ticket printer ---- */
    var ticket = document.getElementById("ticket-cert");
    if (ticket && featured) {
      // prefer the full cert doc for richer terms; fall back to the row
      var render = function (cObj) { ticket.innerHTML = certPaper(cObj); };
      if (featured.certId) {
        fetch("./certs/" + featured.certId + ".json", { cache: "no-cache" })
          .then(function (r) { if (!r.ok) throw 0; return r.json(); })
          .then(function (doc) { var c = certFromDoc(doc, data); render(c); })
          .catch(function () { render(certFromRow(data, featured)); });
      } else {
        render(certFromRow(data, featured));
      }
    }

    /* ---- provenance card ---- */
    var prov = document.getElementById("prov-grid");
    if (prov) {
      prov.innerHTML =
        provItem("Benchmark", "OpenTakeoff Academy · " + suiteTitleOf(s, "div9")) +
        provItem("Protocol", "Held-out ranked plansets · weekly recertification") +
        provItem("Metric", "Per-competency error vs. ground truth (lower is better)") +
        provItem("Budget", "Wall-clock + token cap per planset") +
        provItem("Baseline", "Human Senior Estimator · APE " + pct(s.baseline)) +
        provItem("Build", "Suite " + suiteTitleOf(s, "div9") + " v" + suiteVersionOf(s) + " · updated " + fmtDate(data.updatedAt));
    }
    var stampEls = document.querySelectorAll("[data-updated]");
    stampEls.forEach && stampEls.forEach(function (e) { e.textContent = fmtDateTime(data.updatedAt); });

    setupTransport();
  }
  function provItem(k, v) {
    return '<div><span class="prov-k">' + esc(k) + '</span><span class="prov-v">' + esc(v) + '</span></div>';
  }

  function setupTransport() {
    var body = document.body;
    var run = document.getElementById("btn-run");
    var pause = document.getElementById("btn-pause");
    var reset = document.getElementById("btn-reset");
    var printBtn = document.getElementById("btn-print");
    var status = document.getElementById("deck-status");
    if (run && pause) {
      run.addEventListener("click", function () {
        body.classList.remove("halted");
        run.setAttribute("aria-pressed", "true"); pause.setAttribute("aria-pressed", "false");
        if (status) status.textContent = "Feed live · demo loop";
      });
      pause.addEventListener("click", function () {
        body.classList.add("halted");
        pause.setAttribute("aria-pressed", "true"); run.setAttribute("aria-pressed", "false");
        if (status) status.textContent = "Feed paused · demo loop";
      });
    }
    if (reset) reset.addEventListener("click", function () {
      document.querySelectorAll(".vz i, .marquee-inner, .swing, .digarm, .puff, .cloud").forEach(function (el) {
        el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
      });
      body.classList.remove("halted");
      if (run) run.setAttribute("aria-pressed", "true");
      if (pause) pause.setAttribute("aria-pressed", "false");
      if (status) status.textContent = "Feed reset · demo loop";
    });
    if (printBtn) printBtn.addEventListener("click", function () {
      var t = document.getElementById("ticket-window");
      if (t) t.scrollIntoView();
      window.print();
    });
  }

  /* ============================================================
     CERT PAGE
     ============================================================ */
  function getParam(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
  }
  function siteRoot() {
    // Must resolve identically on BOTH cert URLs, or embedded badge/asset links
    // break on the shareable one: the pretty /cert/:id (a Netlify rewrite — the
    // address bar keeps it) and the raw /cert.html?id=:id.
    var p = location.href.split(/[?#]/)[0];
    p = p.replace(/\/cert\/[^/]*$/, "/"); // pretty URL → site root
    return p.replace(/[^/]*$/, "");       // else strip the filename
  }

  function renderCert(data) {
    var id = getParam("id");
    var root = document.getElementById("cert-root");
    if (!root) return;

    if (!id) { root.innerHTML = certNotFound(null, "No credential id supplied. Add ?id=OTA-… to the URL."); return; }
    if (!/^OTA-[A-Z0-9]{2,6}-[0-9]{4,6}$/.test(id)) {
      root.innerHTML = certNotFound(id, "That credential id is not a valid OpenTakeoff Academy id."); return;
    }
    root.innerHTML = '<section class="board"><div class="board-bd"><div class="loading-block">Fetching credential ' + esc(id) + ' …</div></div></section>';

    fetch("./certs/" + id + ".json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("404"); return r.json(); })
      .then(function (doc) { root.innerHTML = certFullView(certFromDoc(doc, data), doc); wireCertUI(); })
      .catch(function () { root.innerHTML = certNotFound(id, "No credential with this id is on file. It may have expired, been revoked, or never issued."); });
  }

  function certNotFound(id, msg) {
    return '' +
'<section class="board"><div class="hazbar"></div><div class="board-bd">' +
'<div class="notice-block">' +
'<div class="nb-code">404</div>' +
'<h2>Ticket not on the wall</h2>' +
(id ? '<p><b>' + esc(id) + '</b> — ' + esc(msg) + '</p>' : '<p>' + esc(msg) + '</p>') +
'<p><a class="cta-btn" href="index.html"><span class="arrow">&#9664;</span> Back to the Leaderboard</a></p>' +
'</div></div></section>';
  }

  function certFullView(c, doc) {
    var certified = c.attestation === "certified";
    var badge = window.OTABadge ? window.OTABadge.svg({ competency: c.competency, tier: c.tier, attestation: c.attestation }) : "";

    // score-vs-baseline bars (lower is better)
    var maxV = Math.max(c.score || 0, c.baseline || 0) * 1.35 || 1;
    var mw = Math.min(100, ((c.score || 0) / maxV) * 100);
    var bw = c.baseline != null ? Math.min(100, (c.baseline / maxV) * 100) : null;
    var beatsBar = c.baseline != null && c.score != null && c.score <= c.baseline;
    var scoreBlock = '' +
'<div class="scorebars">' +
'<div class="scorebar"><div class="sb-top"><span>' + esc(c.contestant || c.modelId) + ' &middot; ' + esc(c.metric || metricNoun(c.competency)) + '</span><span class="sb-val">' + esc(pct(c.score)) + '</span></div>' +
'<div class="sb-track"><div class="sb-fill model' + (beatsBar ? "" : " over") + '" style="width:' + mw.toFixed(1) + '%"></div>' + (bw != null ? '<div class="sb-marker" style="left:' + bw.toFixed(1) + '%"></div>' : "") + '</div></div>' +
(c.baseline != null ? '<div class="scorebar"><div class="sb-top"><span>The Estimator &middot; human baseline</span><span class="sb-val">' + esc(pct(c.baseline)) + '</span></div>' +
'<div class="sb-track"><div class="sb-fill base" style="width:' + bw.toFixed(1) + '%"></div></div></div>' : "") +
'</div>' +
'<p class="comp-note">' + (beatsBar ? "Beats the human baseline on the same held-out plansets — Master-grade." : "Lower is better. Ranked against the Senior Estimator on identical held-out plansets.") + '</p>';

    var integrity = c.integrity || {}, evidence = c.evidence || {};
    var certUrl = evidence.verifyUrl || (location.href.split("#")[0]);
    var vstatus = certified
      ? '<div class="vstatus ok"><svg class="vico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" fill="none" stroke="#5fd08a" stroke-width="1.8"/><path d="M8.5 12l2.4 2.4 4.6-5" fill="none" stroke="#5fd08a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Certified · proctored held-out run</div>'
      : '<div class="vstatus self"><svg class="vico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z" fill="none" stroke="#ffd21e" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 16.5v.5" stroke="#ffd21e" stroke-width="1.8" stroke-linecap="round"/></svg> Self-Reported · entrant-run, self-attested</div>';

    var verifyPanel = '' +
'<div class="verify-grid">' +
'<div class="bp vpanel">' + vstatus +
vrow("Credential", c.certId) +
vrow("Model / System", c.modelId + (c.subjectUrl ? '' : '')) +
vrow("Track · Suite", (c.track || "—") + " · " + (c.suiteVersion || "—")) +
vrow("Competency · Tier", compLabel(c.competency) + " · " + (TIER_LABEL[c.tier] || c.tier)) +
vrow("Metric · Score", (c.metric || metricNoun(c.competency)) + " = " + pct(c.score), beatsBar ? "pass" : "") +
vrow("Human baseline", pct(c.baseline)) +
vrow("Held-out tasks", String(c.nRanked || "—")) +
vrow("Issued · Expires", fmtDate(c.issuedAt) + "  →  " + fmtDate(c.expiresAt)) +
'</div>' +
'<div class="bp vpanel">' +
'<p class="lcd-label" style="margin-bottom:10px">Run Provenance &middot; cross-checkable</p>' +
vrow("Attestation", certified ? "certified (proctored)" : "self_reported", certified ? "pass" : "amber") +
vrow("Run-bundle sha256", evidence.runBundleHash || "—", "mono-hash") +
vrow("Cert hash", integrity.certHash || "—", "mono-hash") +
vrow("Signature", integrity.academySignature || "—", "mono-hash") +
vrow("Key id", integrity.academyKeyId || "—") +
vrow("Hash alg", integrity.hashAlg || "sha256") +
vrowRaw("Academy key", '<a href="/academy-public-key.pem" rel="noopener">academy-public-key.pem &#8599;</a>') +
vrowRaw("This record", '<a href="/certs/' + esc(c.certId) + '.json" rel="noopener">' + esc(c.certId) + '.json &#8599;</a>') +
'<div style="margin-top:12px" class="embed-live">' + badge + '</div>' +
'<p class="comp-note">The Academy signs <b>certHash</b>; anyone can recompute it from this record and check the signature against the <a href="/academy-public-key.pem">published Academy key</a> &mdash; without trusting this page:</p>' +
'<pre class="verify-cmd"><code>curl -O ' + esc(siteRoot()) + 'certs/' + esc(c.certId) + '.json\nnpx github:Kentucky-ai/opentakeoff-academy verify ' + esc(c.certId) + '.json \\\n  --key ' + esc(siteRoot()) + 'academy-public-key.pem</code></pre>' +
'<p class="comp-note">Tamper with any field and the hash check fails; sign with any other key and the signature check fails. The <b>run-bundle hash</b> binds the score to the exact recorded trace.</p>' +
'</div>' +
'</div>';

    var embedPanel = embeds(c, certUrl);

    return '' +
// paper credential
'<section class="board" id="cert-paper"><div class="board-hd">' +
'<svg class="hd-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v6H8z" fill="none" stroke="#191510" stroke-width="1.8" stroke-linejoin="round"/></svg>' +
'<span class="hd-title">Verifiable Credential &mdash; ' + esc(c.certId) + '</span><span class="hd-tag">' + (certified ? "Certified" : "Self-Reported") + '</span></div>' +
'<div class="board-bd"><div class="printer-slot" aria-hidden="true"></div>' +
'<div class="hero-cert-wrap" id="cert-render">' + certPaper(c) + '</div>' +
'<div class="transport" style="justify-content:center;margin-top:18px">' +
'<a class="t-btn" href="index.html"><span class="arrow" aria-hidden="true">&#9664;</span> Leaderboard</a>' +
(c.subjectUrl ? '<a class="t-btn" href="' + esc(c.subjectUrl) + '" target="_blank" rel="noopener">Model page &#8599;</a>' : "") +
'<button class="t-btn print" type="button" id="btn-print"><span class="ico ico-print" aria-hidden="true"></span>Print Certificate</button>' +
'</div></div></section>' +
// verify
'<section class="board" id="verify"><div class="board-hd">' +
'<svg class="hd-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" fill="none" stroke="#191510" stroke-width="1.8"/><path d="M8.5 12l2.4 2.4 4.6-5" fill="none" stroke="#191510" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
'<span class="hd-title">Verify &mdash; Score, Baseline &amp; Provenance</span><span class="hd-tag">Attestation</span></div>' +
'<div class="board-bd">' + scoreBlock + '<div style="height:16px"></div>' + verifyPanel + '</div></section>' +
// embeds
'<section class="board" id="embeds"><div class="board-hd">' +
'<svg class="hd-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6 3 12l5 6M16 6l5 6-5 6M13 4l-2 16" fill="none" stroke="#191510" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
'<span class="hd-title">Embed This Credential</span><span class="hd-tag">Copy-Paste</span></div>' +
'<div class="board-bd">' + embedPanel + '</div></section>';
  }

  function vrow(k, v, cls) {
    return '<div class="vrow"><span class="vk">' + esc(k) + '</span><span class="vv ' + (cls || "") + '">' + esc(v) + '</span></div>';
  }

  // Same row, trusted markup for the value (links only — never user data).
  function vrowRaw(k, html, cls) {
    return '<div class="vrow"><span class="vk">' + esc(k) + '</span><span class="vv ' + (cls || "") + '">' + html + '</span></div>';
  }

  function embeds(c, certUrl) {
    var badgeUrl = siteRoot() + "certs/" + c.certId + ".badge.svg";
    var compL = compLabel(c.competency), tierL = TIER_LABEL[c.tier] || c.tier;
    var alt = "OpenTakeoff " + (c.attestation === "certified" ? "Certified" : "Self-Reported") + " — " + compL + " · " + tierL;

    // Hugging Face: markdown badge + model-index YAML
    var hfMd = "[![" + alt + "](" + badgeUrl + ")](" + certUrl + ")";
    var metricType = c.competency === "scope-identification" ? "missed-scope-rate"
      : c.competency === "fixture-count" ? "count-error"
      : c.competency === "scale-calibration" ? "scale-error" : "ape";
    var hfYaml =
"model-index:\n" +
"  - name: " + (c.modelId || "your-model") + "\n" +
"    results:\n" +
"      - task:\n" +
"          type: construction-takeoff\n" +
"          name: " + compL + "\n" +
"        dataset:\n" +
"          name: OpenTakeoff Academy — " + (c.track || "div9") + " (" + (c.suiteVersion || "") + ")\n" +
"          type: opentakeoff-academy-" + (c.track || "div9") + "\n" +
"        metrics:\n" +
"          - type: " + metricType + "\n" +
"            value: " + (c.score != null ? c.score : "") + "\n" +
"            name: " + (c.metric || metricNoun(c.competency)) + " (lower is better)\n" +
"            verified: " + (c.attestation === "certified") + "\n" +
"        source:\n" +
"          name: OpenTakeoff Academy Certificate " + c.certId + "\n" +
"          url: " + certUrl;

    var ghMd = "[![" + alt + "](" + badgeUrl + ")](" + certUrl + ")";

    var li =
"Name:                 OpenTakeoff Certified — " + compL + " (" + tierL + ")\n" +
"Issuing organization: OpenTakeoff Academy\n" +
"Issue date:           " + monthYear(c.issuedAt) + "\n" +
"Expiration date:      " + monthYear(c.expiresAt) + "\n" +
"Credential ID:        " + c.certId + "\n" +
"Credential URL:       " + certUrl;

    return '' +
'<div class="embed-live" aria-label="Live badge preview">' + (window.OTABadge ? window.OTABadge.svg({ competency: c.competency, tier: c.tier, attestation: c.attestation }) : "") +
'<span class="comp-note" style="margin:0">Live badge · ' + (c.attestation === "certified" ? "Certified" : "Self-Reported") + '. The hosted file is <code>certs/' + esc(c.certId) + '.badge.svg</code>.</span></div>' +
'<div class="embed-tabs" role="tablist">' +
'<button class="embed-tab" role="tab" aria-selected="true" data-tab="hf">Hugging Face</button>' +
'<button class="embed-tab" role="tab" aria-selected="false" data-tab="gh">GitHub README</button>' +
'<button class="embed-tab" role="tab" aria-selected="false" data-tab="li">LinkedIn</button>' +
'</div>' +
panel("hf", true,
  '<p class="comp-note">Badge (Markdown) for your model card:</p>' + code(hfMd) +
  '<p class="comp-note" style="margin-top:12px">Structured <code>model-index</code> eval-results block for the card metadata (YAML front-matter):</p>' + code(hfYaml)) +
panel("gh", false,
  '<p class="comp-note">Drop this into your README:</p>' + code(ghMd)) +
panel("li", false,
  '<p class="comp-note">Add under <b>Licenses &amp; Certifications</b> on your LinkedIn profile (issuer = OpenTakeoff Academy, as an Open Badge):</p>' + code(li));
  }
  function panel(id, active, inner) {
    return '<div class="embed-panel' + (active ? " active" : "") + '" data-panel="' + id + '">' + inner + '</div>';
  }
  function code(text) {
    return '<div class="codewrap"><button class="copy-btn" type="button" data-copy>Copy</button><pre><code>' + esc(text) + '</code></pre></div>';
  }

  function wireCertUI() {
    // print
    var pb = document.getElementById("btn-print");
    if (pb) pb.addEventListener("click", function () { window.print(); });
    // tabs
    document.querySelectorAll(".embed-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".embed-tab").forEach(function (t) { t.setAttribute("aria-selected", "false"); });
        tab.setAttribute("aria-selected", "true");
        var id = tab.getAttribute("data-tab");
        document.querySelectorAll(".embed-panel").forEach(function (p) {
          p.classList.toggle("active", p.getAttribute("data-panel") === id);
        });
      });
    });
    // copy
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pre = btn.parentNode.querySelector("code");
        var text = pre ? pre.textContent : "";
        var done = function () { btn.textContent = "Copied ✓"; btn.classList.add("copied"); setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
        } else { legacyCopy(text); done(); }
      });
    });
  }
  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ============================================================
     DIVISIONS / SPECIALIST TRACKS (index board)
     Fetches ./divisions.json (authored separately). Each division:
     { code, name, trackId, specialty, status:"live"|"coming"|"request",
       competencies:[…], suites:[…], blurb }.
     Falls back to a sample set if the file is absent (e.g. clean
     checkout or standalone preview) so the board still renders.
     ============================================================ */
  var STATUS_META = {
    live:    { label: "Live",    cls: "st-live",    cta: "View leaderboard" },
    coming:  { label: "Coming",  cls: "st-coming",  cta: "Request early access" },
    request: { label: "Request", cls: "st-request", cta: "Request certification" }
  };
  function prettyKey(k) {
    return String(k == null ? "" : k).replace(/[-_]/g, " ")
      .replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }
  // Competency label that also degrades gracefully for keys we don't know.
  function divCompLabel(c) { return COMPETENCY_LABEL[c] || prettyKey(c); }
  // A suite entry may be a plain string ("div9-ranked v1.0") or an object
  // ({ id, mode, version, status }); render either into a short label.
  function suiteLabel(s) {
    if (s == null) return "";
    if (typeof s === "string") return s;
    if (typeof s !== "object") return String(s);
    var id = s.id || s.name || s.suite || "";
    var mode = s.mode || "";
    var ver = s.version || s.suiteVersion || "";
    var label = String(id);
    if (mode) label += " (" + mode + ")";
    else if (ver) label += " v" + ver;
    return label.trim();
  }

  var FALLBACK_DIVISIONS = [
    { code: "09", name: "Finishes", trackId: "div9", status: "live",
      specialty: "Flooring, resilient & tile, carpet, wall finishes",
      competencies: ["area-takeoff", "fixture-count", "scale-calibration", "scope-identification"],
      suites: ["div9-ranked v1.0"],
      blurb: "The first live vertical. Deep flooring takeoff — area by room and material, transitions and base, and scope pulled from the finish schedule." },
    { code: "00", name: "Generalist Takeoff", trackId: "generalist", status: "live",
      specialty: "Broad quantity takeoff across trades",
      competencies: ["area-takeoff", "fixture-count", "scale-calibration", "scope-identification", "general-takeoff"],
      suites: ["generalist-ranked v1.0"],
      blurb: "The “can it take off at all” bar — mixed plansets across trades, with no vertical assumptions baked in." },
    { code: "03", name: "Concrete", trackId: "div3", status: "coming",
      specialty: "Slabs, footings & walls, formwork, reinforcement",
      competencies: ["area-takeoff", "scale-calibration", "scope-identification"],
      suites: ["div3-practice (draft)"],
      blurb: "Area and volume takeoff for cast-in-place concrete, with formwork and rebar scope off the structural set." },
    { code: "23", name: "HVAC (Mechanical)", trackId: "div23", status: "request",
      specialty: "Ductwork runs, equipment & terminal counts",
      competencies: ["fixture-count", "scale-calibration", "scope-identification"],
      suites: [],
      blurb: "Linear duct takeoff, equipment and diffuser/register counts, and mechanical scope off the M-series." },
    { code: "26", name: "Electrical", trackId: "div26", status: "request",
      specialty: "Device & fixture counts, homerun lengths, panel scope",
      competencies: ["fixture-count", "scale-calibration", "scope-identification"],
      suites: [],
      blurb: "Receptacle / switch / fixture counts, conduit and homerun lengths, and panel-schedule scope." },
    { code: "22", name: "Plumbing", trackId: "div22", status: "request",
      specialty: "Fixture counts, waste & supply pipe runs",
      competencies: ["fixture-count", "scale-calibration", "scope-identification"],
      suites: [],
      blurb: "Plumbing fixture counts and pipe run lengths, with fixture-schedule scope identification." }
  ];

  function normalizeDivisions(data) {
    var arr;
    if (Array.isArray(data)) arr = data;
    else if (data && Array.isArray(data.divisions)) arr = data.divisions;
    else if (data && typeof data === "object") {
      arr = Object.keys(data).map(function (k) { return data[k]; })
        .filter(function (v) { return v && typeof v === "object" && (v.code || v.name || v.trackId); });
    } else arr = [];
    return arr.filter(function (d) { return d && (d.code || d.name); });
  }

  function loadDivisions() {
    return fetch("./divisions.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("no file"); return r.json(); })
      .then(function (j) {
        var a = normalizeDivisions(j);
        if (!a.length) throw new Error("empty");
        return { divs: a, fallback: false };
      })
      .catch(function () { return { divs: FALLBACK_DIVISIONS.slice(), fallback: true }; });
  }

  function renderDivisions(payload) {
    var host = document.getElementById("div-board");
    if (!host) return;
    var divs = (payload && payload.divs) || [];
    var sample = document.getElementById("div-sample");
    if (sample) sample.hidden = !(payload && payload.fallback);

    if (!divs.length) { host.innerHTML = '<div class="comp-empty">No divisions published yet</div>'; return; }

    var rank = { live: 0, coming: 1, request: 2 };
    divs = divs.slice().sort(function (a, b) {
      var ra = rank[(a.status || "request").toLowerCase()];
      var rb = rank[(b.status || "request").toLowerCase()];
      if (ra == null) ra = 3; if (rb == null) rb = 3;
      if (ra !== rb) return ra - rb;
      return String(a.code || "").localeCompare(String(b.code || ""), undefined, { numeric: true });
    });

    host.innerHTML = divs.map(function (d) {
      var status = (d.status || "request").toLowerCase();
      var meta = STATUS_META[status] || STATUS_META.request;
      var isLive = status === "live";
      var comps = Array.isArray(d.competencies) ? d.competencies : (d.competencies ? [d.competencies] : []);
      var suitesRaw = Array.isArray(d.suites) ? d.suites : (d.suites ? [d.suites] : []);
      var suites = suitesRaw.map(suiteLabel).filter(function (x) { return x; });
      var codeStr = esc(d.code || "—");
      var nameStr = esc(d.name || "");

      var href, ctaLabel = meta.cta;
      if (isLive) {
        // live: jump to the leaderboard, optionally scoped to this track
        href = "index.html?track=" + encodeURIComponent(d.trackId || "") + "#crew";
      } else {
        // coming / request: pre-address the certification request to this division
        href = "request-certification.html?division=" + encodeURIComponent(d.code || "") +
          "&track=" + encodeURIComponent(d.trackId || "");
      }

      var chips = comps.map(function (c) {
        return '<span class="div-comp">' + esc(divCompLabel(c)) + '</span>';
      }).join("");

      return '<a class="div-card ' + meta.cls + '" href="' + href + '">' +
        '<div class="div-top">' +
          '<span class="div-code" aria-hidden="true">' + codeStr + '</span>' +
          '<div class="div-headings">' +
            '<h3 class="div-name">' + codeStr + ' &middot; ' + nameStr + '</h3>' +
            (d.specialty ? '<p class="div-spec">' + esc(d.specialty) + '</p>' : '') +
          '</div>' +
          '<span class="div-pill ' + meta.cls + '">' + esc(meta.label) + '</span>' +
        '</div>' +
        (d.blurb ? '<p class="div-blurb">' + esc(d.blurb) + '</p>' : '') +
        (chips ? '<div class="div-comps"><span class="div-lbl">Competencies</span><div class="div-chips">' + chips + '</div></div>' : '') +
        (suites.length ? '<p class="div-suites"><span class="div-lbl">Suites</span> ' + suites.map(esc).join(" &middot; ") + '</p>' : '') +
        '<span class="div-go">' + esc(ctaLabel) + ' <span class="arrow" aria-hidden="true">&#9656;</span></span>' +
      '</a>';
    }).join("");
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    injectScene();
    var page = document.body.getAttribute("data-page");
    if (page === "cert") {
      loadLeaderboard().then(renderCert);
    } else if (page === "home") {
      loadLeaderboard().then(renderIndex).catch(function (e) {
        var crew = document.getElementById("crew-body");
        if (crew) crew.innerHTML = '<tr><td colspan="8">Could not load leaderboard data.</td></tr>';
      });
      loadDivisions().then(renderDivisions).catch(function () {
        var db = document.getElementById("div-board");
        if (db) db.innerHTML = '<div class="comp-empty">Could not load divisions</div>';
      });
    }
    // how-to / request pages: scene only, page-specific static content.
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
