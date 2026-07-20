# OpenTakeoff Academy — static site

The public face of the Academy: the **certification leaderboard**, **verifiable
cert pages**, the **"Enter the Academy"** onboarding, and the embeddable
**"OpenTakeoff Certified"** badge. It is a normally-served static site (plain
HTML/CSS/JS, no build step) and reads its data from JSON at runtime.

## Pages

| File | What it is |
|---|---|
| `index.html` | Leaderboard + academy homepage. Renders the crew leaderboard, Cert Wall, tier ladder, **Divisions / Specialist-Tracks board**, and provenance card from `leaderboard.json` + `divisions.json`. |
| `cert.html` | Public, verifiable single-cert page. Loads `?id=OTA-…` → `certs/<id>.json`, shows model / track / competency / tier, score-vs-baseline, the run-bundle hash + signature, and copy-paste embeds (Hugging Face, GitHub, LinkedIn). |
| `how-to-enter.html` | The certification flow, the two trust tiers, the quickstart commands, and the "what stays private" guarantee. |
| `request-certification.html` | **Request-Certification intake** — a Netlify Forms form (name, email, org, model/system, division/track, endpoint type, Self-Reported vs Proctored, notes) with an inline thank-you state. Linked from the index CTA and the Coming/Request division cards. |
| `styles.css` | Shared construction-site design system. |
| `app.js` | Shared logic: injects the decorative scene, loads data, renders the index + cert pages. |
| `badge.js` | Dependency-free shields-style badge generator (browser **and** Node). |
| `badge-template.svg` | Hand-editable badge template (see the generator for real output). |
| `certs/<id>.json` | Verifiable credentials (conform to `../schema/cert.schema.json`). |
| `certs/<id>.badge.svg` | Pre-rendered per-cert badge that README / model-card / LinkedIn embeds point at. |

## Data contract

The site is **data-driven**. `index.html` fetches `./leaderboard.json`:

```jsonc
{
  "updatedAt": "2026-07-19T18:30:00Z",
  "recertAt":  "2026-07-27T06:00:00Z",
  "suites": {
    "div9": { "id": "div9-ranked", "version": "2026.07",
              "track": "Vertical-Specialist · Division 9 (flooring)",
              "baseline": 5.2, "nRanked": 12,
              "thresholds": { "area-takeoff": 6.0, "scale-calibration": 1.5,
                              "fixture-count": 3.0, "scope-identification": 5.0 } }
  },
  "rows": [
    { "rank": 0, "modelId": "human/senior-estimator", "contestant": "The Estimator",
      "track": "div9", "competency": "area-takeoff", "tier": "bar",
      "medianApe": 5.2, "nRanked": 12, "attestation": "certified", "movement": "flat" },
    { "rank": 1, "modelId": "reference/agent-d", "contestant": "Reference Agent D",
      "track": "div9", "competency": "area-takeoff", "tier": "journeyman",
      "medianApe": 4.6, "nRanked": 12, "attestation": "certified",
      "movement": "up", "certId": "OTA-D9A-0047", "url": "https://…" }
  ]
}
```

- `tier` ∈ `apprentice | journeyman | master | bar` — the human baseline row uses
  `bar` and is pinned to the top of the leaderboard.
- `attestation` ∈ `certified | self_reported` — rendered visually distinct
  everywhere (chips, badges, cert paper).
- `movement` ∈ `up | down | flat | new`.
- `certId` (optional) links a row to `certs/<certId>.json` and `cert.html?id=…`.

`leaderboard.json` is produced by the scoring CI (see the repo root README). **This
directory does not commit `leaderboard.json`** — if it is absent (e.g. a clean
checkout or standalone preview) the site falls back to an embedded sample dataset
so it still renders. A small "sample data" flag shows when the fallback is used.

### `divisions.json` (Divisions / Specialist-Tracks board)

`index.html` also fetches `./divisions.json` at runtime to render the **Divisions /
Specialist-Tracks** board. It is an array (or `{ "divisions": [ … ] }`, or a keyed
map) of divisions, each:

```jsonc
{
  "code": "09",                       // CSI-style division number
  "name": "Finishes",                 // rendered as "09 · Finishes"
  "trackId": "div9",                  // matches a leaderboard suite/track id
  "specialty": "Flooring, resilient & tile, carpet, wall finishes",
  "status": "live",                   // "live" | "coming" | "request"
  "competencies": ["area-takeoff", "fixture-count", "scale-calibration", "scope-identification"],
  "suites": ["div9-ranked v1.0"],
  "blurb": "Deep flooring takeoff — area by room and material, transitions, base, and scope."
}
```

- `status` drives the pill and the card link: **`live`** → the leaderboard
  (`index.html?track=<trackId>#crew`); **`coming` / `request`** → the
  Request-Certification form, pre-addressed with `?division=<code>&track=<trackId>`.
- Like `leaderboard.json`, **this directory does not commit `divisions.json`** — if
  it is absent the board falls back to an embedded sample set (with a small "sample
  tracks" flag) so it still renders. Unknown competency keys are prettified
  gracefully, so the board tolerates whatever the authored file ships.

## Preview locally

Because the pages `fetch()` JSON, open them through a **web server**, not
`file://`. Any static server works:

```bash
# from the repo root
cd site

# Python (bundled on macOS)
python3 -m http.server 8080

# …or Node
npx serve -l 8080 .
```

Then open:

- Leaderboard — <http://localhost:8080/index.html>
- A cert — <http://localhost:8080/cert.html?id=OTA-D9A-0047>
- A self-reported cert — <http://localhost:8080/cert.html?id=OTA-SI-0071>
- Cert-not-found (graceful) — <http://localhost:8080/cert.html?id=OTA-XXX-9999>
- Enter the Academy — <http://localhost:8080/how-to-enter.html>
- Request Certification — <http://localhost:8080/request-certification.html>
- Request, pre-addressed to a division — <http://localhost:8080/request-certification.html?division=03&track=div3>

## Certs + badges

`certs/<id>.json` are verifiable credentials that conform to
`../schema/cert.schema.json` (checked structurally: required keys,
`additionalProperties:false`, enums, patterns, consts). The sample set mirrors
the cert IDs in `leaderboard.json` so every ticket links to a real credential,
and includes one **self-reported** cert (`OTA-SI-0071`) to exercise that variant.

Each `certs/<id>.badge.svg` is the exact output of
`OTABadge.svg({ competency, tier, attestation })` from `badge.js` — the same
generator the cert page uses for its live badge. In production the issuer's cert
issuer (see `../src/`) writes these files; the committed samples were produced by
that same `badge.js` with real `sha256` hashes.

## Deploy (Netlify)

Static site, no build. Point Netlify at this `site/` directory:

```toml
# netlify.toml (repo root)
[build]
  publish = "site"
  command = ""            # nothing to build
```

Or drag-and-drop / CLI:

```bash
# from the repo root
netlify deploy --dir=site --prod
```

Notes:

- **SPA-style cert URLs**: `cert.html?id=…` works out of the box (query string,
  no rewrite needed). If you want pretty `/cert/OTA-…` paths, add a redirect:
  `/cert/*  /cert.html?id=:splat  200`.
- **`leaderboard.json` on deploy**: publish the file produced by the scoring CI
  into `site/` before/at deploy so the live board is real data; without it the
  page shows the embedded sample set.
- Everything is self-contained — inline SVG scene, no external CDNs, no web fonts
  — so it renders offline and under a strict CSP.

### Netlify Forms — the `request-certification` form (important gotcha)

`request-certification.html` uses **Netlify Forms**. Netlify only registers a form
when its **post-processing bots detect the static form markup at deploy** — so the
markup must be plain HTML in the deployed file (it is: the `<form
name="request-certification" data-netlify="true" netlify-honeypot="bot-field">`
with a hidden `<input type="hidden" name="form-name" value="request-certification">`
and a hidden `bot-field` honeypot). The page also submits via `fetch()` for the
inline thank-you, but the detectable static form is what registers it.

**Gotcha:** sites created via the CLI/API ship with form detection **OFF**
(`processing_settings.ignore_html_forms: true`). While it's off, `data-netlify`
forms are never registered — `listSiteForms` returns `[]` and POSTs to the form
endpoint **404**. Flipping the flag alone is not enough: **detection runs in
post-processing, so you must redeploy after enabling it.** On an existing site:

1. Get the CLI token: `~/.config/netlify/config.json` → `users.*.auth.token`.
2. Enable detection with a **direct PATCH** (the `netlify api updateSite` wrapper
   silently drops the nested field):
   ```bash
   curl -X PATCH "https://api.netlify.com/api/v1/sites/{SITE_ID}" \
     -H "Authorization: Bearer $NETLIFY_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"processing_settings":{"ignore_html_forms":false}}'
   ```
3. **Redeploy** so detection re-runs: `netlify deploy --dir=site --prod`.
4. Confirm: `listSiteForms` now returns `request-certification` with its `id`; a
   test `POST` of `form-name=request-certification` + fields returns **200** and
   shows under Forms → submissions.
5. (Optional) Email notification: `POST /api/v1/hooks` with
   `{site_id, form_id, type:"email", event:"submission_created", data:{email}}`
   — `form_id` is **required** (site-wide gives "Unprocessable Entity").

New Netlify sites where forms are enabled from the first deploy skip steps 1–3 —
the form registers automatically on that first deploy.
