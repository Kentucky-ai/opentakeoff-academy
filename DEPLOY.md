# DEPLOY — OpenTakeoff Academy Launch Runbook

> **These steps are held until launch. Nothing here has been run.** This file is
> the copy‑paste checklist for taking the repo public and putting the site live
> at **`aec.kentucky-ai.com`**. Read the **LAUNCH GATE** at the bottom first — it
> governs whether you should run any of this yet.

Repo: `Kentucky-ai/opentakeoff-academy` · Site host: `aec.kentucky-ai.com`
(subdomain of `kentucky-ai.com`, DNS on Cloudflare) · Hosting: Netlify (static).

---

## 0. Pre-flight (already green in this repo)

```bash
npm test                              # expect 16/16 self-test checks pass
node scripts/regen-sample-data.mjs    # expect "6/6 certs verify" (hash ok · sig ok)
```

The board ships with **placeholder reference agents + illustrative scores**
(`site/leaderboard.json` carries a `disclaimer`). No real model is attributed.

---

## 1. Flip the repo public

```bash
gh repo edit Kentucky-ai/opentakeoff-academy --visibility public
```

(Confirm the `plans/` held-out material is gitignored and was never committed —
`git ls-files plans/` must return nothing.)

---

## 2. Netlify — deploy the static site

Static site, **no build command**; `netlify.toml` sets `publish = "site"` and the
`/cert/:id → /cert.html?id=:id` rewrite.

**Option A — connect the repo (recommended, continuous deploy):**
In Netlify → *Add new site* → *Import from Git* → pick
`Kentucky-ai/opentakeoff-academy`. Build command: *(none)*. Publish directory:
`site`. Netlify reads `netlify.toml` automatically.

**Option B — CLI one-shot:**
```bash
netlify deploy --prod --dir=site
```

Then set the custom domain:
Netlify → *Domain settings* → *Add a domain* → `aec.kentucky-ai.com`.

---

## 3. DNS — Cloudflare

Add a CNAME for the `aec` subdomain pointing at the Netlify site, **DNS-only
(grey cloud — proxy OFF)** so Netlify can provision and serve TLS directly:

| Type  | Name  | Target                         | Proxy       |
|-------|-------|--------------------------------|-------------|
| CNAME | `aec` | `<your-site>.netlify.app`      | **DNS only (grey cloud)** |

> Cloudflare is DNS-only here; Netlify terminates HTTPS and **auto-provisions the
> Let's Encrypt certificate** for `aec.kentucky-ai.com` once the CNAME resolves.
> Do **not** turn the orange proxy cloud on — it breaks Netlify's cert issuance
> and its edge/redirect handling.

Verify: `dig +short aec.kentucky-ai.com CNAME` resolves to the Netlify host, then
load `https://aec.kentucky-ai.com/` and a cert page
`https://aec.kentucky-ai.com/cert/OTA-D9A-0047`.

---

## 4. Netlify Forms — register the Request-Certification form

**New Netlify sites ship with form detection OFF** (`ignore_html_forms: true`).
While it's off, the `data-netlify` form never registers: `listSiteForms` returns
`[]` and POSTs to the form endpoint **404**. Flipping the flag alone is not
enough — **detection runs in post-processing, so you must redeploy after enabling
it.**

```bash
# 1. Get the CLI token (or use `netlify login`):
#    ~/.config/netlify/config.json → users.*.auth.token
NETLIFY_TOKEN="…"; SITE_ID="…"

# 2. Enable form detection with a DIRECT PATCH (the `netlify api updateSite`
#    wrapper silently drops this nested field):
curl -X PATCH "https://api.netlify.com/api/v1/sites/${SITE_ID}" \
  -H "Authorization: Bearer ${NETLIFY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"processing_settings":{"ignore_html_forms":false}}'

# 3. Redeploy so detection re-runs over the static markup:
netlify deploy --prod --dir=site
```

Confirm: `listSiteForms` now returns **both** `request-certification` and
`contribute-plan` with an `id`; a test `POST` of `form-name=request-certification`
(or `form-name=contribute-plan`) + fields returns **200** and shows under
*Forms → submissions*. (`contribute-plan` is `multipart/form-data` and accepts an
optional planset upload — file submissions appear as download links in the
dashboard.)

(Optional email notification:
`POST /api/v1/hooks` with `{site_id, form_id, type:"email", event:"submission_created", data:{email:"…"}}`
— `form_id` is **required**; a site-wide hook returns "Unprocessable Entity".)

---

## 5. Gmail — cert-requests folder (MANUAL)

The connected Gmail is **read/draft-only** from tooling, so this is a manual,
one-time setup in the Gmail UI:

1. Create the labels **`OpenTakeoff Academy/Cert Requests`** and
   **`OpenTakeoff Academy/Plan Submissions`** (nested under `OpenTakeoff Academy`).
2. Create filters on the Netlify form-notification sender (e.g.
   `forms-noreply@netlify.com`). If you set a per-form notification email (below),
   filter by the form name / subject so **request-certification** → *Cert Requests*
   and **contribute-plan** → *Plan Submissions* (optionally *Skip the Inbox* /
   *Mark as important*).

This routes every certification request and every contributed-plan submission
into its own reviewable folder. (Per-form email hooks are set in §4's optional
step — pass each form's `form_id`.)

---

## 6. npm — publish the SDK/CLI (NOT currently authed here)

npm is **not** logged in in this environment. When ready:

```bash
npm login
npm whoami                 # confirm the Kentucky-ai / owner account
npm publish --access public
```

The package is publish-ready (`package.json`: `version 0.1.0`, `files` whitelist =
`src/ schema/ README.md LICENSE`, `repository`/`homepage`/`bugs` set). Sanity-check
the tarball contents first — it must include `src/` + `schema/` + `README.md` +
`LICENSE` and exclude `node_modules/`, `plans/`, `runs/`:

```bash
npm pack --dry-run
```

---

## 🚦 LAUNCH GATE — read before doing ANY of the above

**Do NOT go public until the first real Division 9 ranked suite has
estimator-validated ground truth.**

Until a licensed/expert estimator has established and held out the Div‑9 ranked
ground truth (see `tasks/div9/ranked/`), **the leaderboard is framework +
demo data only** — placeholder reference agents with illustrative scores. Shipping
it publicly before real ranked results exist would present sample data as if it
were a live, scored benchmark.

Launch sequence, in order:

1. Estimator establishes + holds out the Div‑9 ranked ground truth (private,
   gitignored `plans/` + `$OTA_GROUNDTRUTH_DIR`).
2. Real ranked runs are scored → `site/leaderboard.json` carries real rows.
3. **Then** run §1–§6 above.
