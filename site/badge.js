/* ============================================================
   OpenTakeoff Academy — embeddable "OpenTakeoff Certified" badge.
   Self-contained, dependency-free, shields-style SVG generator.
   Certified and Self-Reported marks are visibly distinct.

   Works in the browser (attaches window.OTABadge) and in Node
   (module.exports) so the same source pre-generates the static
   per-cert badge SVGs committed under site/certs/<id>.badge.svg.

   Usage:
     OTABadge.svg({ competency:'area-takeoff', tier:'journeyman',
                    attestation:'certified' })            -> "<svg …>"
     OTABadge.dataUri({ … })                              -> "data:image/svg+xml;base64,…"
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.OTABadge = api;
})(this, function () {
  "use strict";

  var COMPETENCY_LABEL = {
    "scale-calibration": "Scale Calibration",
    "fixture-count": "Fixture Count",
    "area-takeoff": "Area Takeoff",
    "scope-identification": "Scope ID",
    "general-takeoff": "General Takeoff"
  };
  var TIER_LABEL = {
    apprentice: "Apprentice",
    journeyman: "Journeyman",
    master: "Master",
    bar: "Baseline"
  };
  // tier accent (right segment) — matches the site palette
  var TIER_COLOR = {
    apprentice: "#ff7a1a",
    journeyman: "#1f9dd6",
    master: "#f2b100",
    bar: "#ffd21e"
  };

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  // choose readable text color over a given accent
  function inkFor(hex) {
    var yellowish = ["#f2b100", "#ffd21e", "#ff7a1a", "#ffe05a"];
    return yellowish.indexOf(hex.toLowerCase()) >= 0 ? "#191510" : "#ffffff";
  }
  // approximate Verdana 11px advance width; textLength then forces exact fit
  function textWidth(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 32) w += 3.4;            // space
      else if (c < 65) w += 5.6;         // digits / punctuation
      else if (c >= 97 && c <= 122) w += 6.2; // lowercase
      else w += 7.1;                     // uppercase / wide
    }
    return w;
  }

  function svg(opts) {
    opts = opts || {};
    var competency = opts.competency || "area-takeoff";
    var tier = opts.tier || "journeyman";
    var attestation = opts.attestation === "certified" ? "certified" : "self_reported";
    var certified = attestation === "certified";

    var accent = opts.color || TIER_COLOR[tier] || "#1f9dd6";
    var label = opts.label || (certified ? "OpenTakeoff Certified" : "OpenTakeoff · Self-Reported");
    var message = opts.message ||
      ((COMPETENCY_LABEL[competency] || competency) + " · " + (TIER_LABEL[tier] || tier));

    var H = 20, PAD = 11, GAP = 6;
    var hatW = 15;                                  // hard-hat glyph zone (left)
    var markW = certified ? 15 : 0;                 // check-seal zone (right, certified only)
    var lw = Math.round(textWidth(label));
    var mw = Math.round(textWidth(message));
    var leftW = hatW + PAD + lw + PAD;
    var rightW = PAD + mw + PAD + markW;
    var W = leftW + rightW;

    var labelInk = "#ffe05a";                       // brand yellow on hazard-black
    var msgInk = certified ? inkFor(accent) : "#f4efe0";
    var rightBg = certified ? accent : "#57503f";   // muted slate for self-reported

    var lx = hatW + PAD + lw / 2;                   // label text center
    var mx = leftW + PAD + mw / 2 + (certified ? 0 : 0); // message text center (mark sits after pad)

    var title = esc(label + " — " + message);

    var stripes = certified ? "" :
      '<rect x="' + leftW + '" width="' + rightW + '" height="' + H + '" fill="url(#ota-str)"/>';

    var check = certified ?
      ('<g transform="translate(' + (W - markW + 1) + ',0)">' +
        '<circle cx="6.5" cy="10" r="6" fill="rgba(255,255,255,0.9)"/>' +
        '<path d="M3.6 10.2 L5.6 12.2 L9.4 7.6" fill="none" stroke="#1e7a45" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</g>') : "";

    // hard-hat glyph (left)
    var hat =
      '<g transform="translate(4,4.5)" fill="' + labelInk + '">' +
        '<path d="M0.5 9 H10.5 V10.2 H0.5 Z"/>' +
        '<path d="M5.5 1.4 C2.9 1.4 1.4 3.4 1.4 6 V7.4 H9.6 V6 C9.6 3.4 8.1 1.4 5.5 1.4 Z"/>' +
        '<rect x="4.7" y="0.2" width="1.6" height="1.8" rx="0.4"/>' +
      '</g>';

    return '' +
'<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + title + '">' +
  '<title>' + title + '</title>' +
  '<defs>' +
    '<linearGradient id="ota-sh" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".9" stop-color="#000" stop-opacity=".12"/></linearGradient>' +
    '<pattern id="ota-str" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="' + rightBg + '"/><rect width="3.2" height="7" fill="#3f3a2d"/></pattern>' +
    '<clipPath id="ota-r"><rect width="' + W + '" height="' + H + '" rx="3"/></clipPath>' +
  '</defs>' +
  '<g clip-path="url(#ota-r)">' +
    '<rect width="' + leftW + '" height="' + H + '" fill="#191510"/>' +
    '<rect x="' + leftW + '" width="' + rightW + '" height="' + H + '" fill="' + rightBg + '"/>' +
    stripes +
    (certified ? '' : '<rect x="' + (leftW + 0.5) + '" y="0.5" width="' + (rightW - 1) + '" height="' + (H - 1) + '" fill="none" stroke="#f4efe0" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3 2"/>') +
    '<rect width="' + W + '" height="' + H + '" fill="url(#ota-sh)"/>' +
  '</g>' +
  hat +
  check +
  '<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11" font-weight="bold">' +
    '<text x="' + lx.toFixed(1) + '" y="14.5" fill="#000" fill-opacity="0.35" textLength="' + lw + '" lengthAdjust="spacingAndGlyphs">' + esc(label) + '</text>' +
    '<text x="' + lx.toFixed(1) + '" y="13.5" fill="' + labelInk + '" textLength="' + lw + '" lengthAdjust="spacingAndGlyphs">' + esc(label) + '</text>' +
    '<text x="' + mx.toFixed(1) + '" y="14.5" fill="#000" fill-opacity="0.3" textLength="' + mw + '" lengthAdjust="spacingAndGlyphs">' + esc(message) + '</text>' +
    '<text x="' + mx.toFixed(1) + '" y="13.5" fill="' + msgInk + '" textLength="' + mw + '" lengthAdjust="spacingAndGlyphs">' + esc(message) + '</text>' +
  '</g>' +
'</svg>';
  }

  function b64(str) {
    if (typeof Buffer !== "undefined") return Buffer.from(str, "utf8").toString("base64");
    // browser: handle unicode safely
    return btoa(unescape(encodeURIComponent(str)));
  }
  function dataUri(opts) {
    return "data:image/svg+xml;base64," + b64(svg(opts));
  }

  return {
    svg: svg,
    dataUri: dataUri,
    COMPETENCY_LABEL: COMPETENCY_LABEL,
    TIER_LABEL: TIER_LABEL,
    TIER_COLOR: TIER_COLOR
  };
});
