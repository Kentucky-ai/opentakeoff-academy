# Commonwealth Agent Union: agent discovery and participation

Prepared 2026-10-23. Objective: bring independent construction-agent operators to a useful real-plan workflow and turn visits into evidence submissions and review requests. Raw crawler requests are a separate operational metric, not the success measure.

## Baseline observed

- The public homepage is fetchable. robots.txt returns HTTP 200 and welcomes crawlers; sitemap.xml returns HTTP 200 with 13 URLs. No crawler-policy expansion is needed for this release.
- The published dataset contains one self-reported reference result, zero independent results, and zero certified results. This is evidence inventory, not a traffic baseline.
- Before this change the initial homepage HTML contained a loading row and placeholder counts. The agent guide also described flood-fill, electrical availability, and credential behavior beyond the current real-plan starting workflow.
- Analytics totals, search indexing coverage, bot identities, conversion rates, and AI referrals have not been verified. Traffic growth cannot yet be measured or forecast.

## Release 1: useful discovery foundation (implemented in this branch)

1. Generate homepage evidence HTML from the published dataset before Netlify deployment. Keep the snapshot on refresh failure; activate filters after live JSON loads.
2. Correct the agent guide: source drawings → local engine/tools → evidence → human review. Preserve the current brand and actual availability.
3. Provide a linked, site-specific JSON start manifest containing the exact drawing URL/hash, expected evidence, limitations, and working destinations. This is a convenience for integrations, not a standard protocol or a ranking signal.
4. Remove misleading benchmark/HowTo structured claims; keep factual page metadata.
5. Verify source hashes, links, crawler-readable evidence, browser filtering, no-JavaScript behavior, failed refresh, and mobile layout.

Acceptance: one real published row is readable without JS, certified/independent counts remain zero, a failed JSON refresh preserves evidence, and the manifest resolves to the exact public PDF accepted by the lab. See [review evidence](evidence/agent-discovery/README.md).

## Release 2: measurement and search coverage (next; estimate 1–2 engineering days after account access)

- Inspect existing Netlify traffic/log capabilities and analytics before adding a service. Do not purchase a plan or duplicate tracking.
- Verify the domain in Google Search Console and Bing Webmaster Tools using existing account access, submit the existing sitemap, and inspect the homepage, agent guide, lab, and certification pages. Verification may require the owner's account or DNS access.
- Audit canonical URLs, redirects, response headers, broken links, structured data, and the stale division catalog across the remaining site.
- Define events: agent-guide view, challenge download, lab start, draft export, review request accepted, and membership application accepted. Form completion requires a successful response, not a button click. Local exports are not submissions.
- Capture aggregate referral source/campaign and page/event only; do not capture draft contents, contact fields, private plans, tokens, or full arbitrary query strings.
- Keep server-side crawler requests separate from browser sessions. User-agent names are claims; use published verification mechanisms where available. AI referrals can be undercounted when clients omit referrers; do not invent attribution.

Acceptance: a dated baseline report with data provenance, event definitions, test events excluded, referral categories, and seven days of comparable measurements. If logs or search accounts are unavailable, state that explicitly.

## Release 3: a complete agent participation path (estimate 2–4 engineering days)

- Publish a versioned JSON schema for unverified drafts and a CLI validator compatible with the browser lab; use real drawings exclusively.
- Add an explicit, reviewable submission workflow with receipt/status. Decide storage, size limits, authentication, rate limits, retention, and private/public field boundaries before exposing a write API.
- Start with the existing local MCP engine and review intake. A hosted MCP service is justified only when a concrete remote tool workflow needs it; discovery files alone do not create agent traffic.
- Run a clean-checkout onboarding trial with independent operators. Record setup failures and completion time. No new model spending is assumed.

Acceptance: an independent operator can obtain the drawing, produce a valid evidence draft, submit through the documented route, and receive a receipt without being told they earned certification. Publication still requires consent/review.

## Release 4: distribution and repeat participation (first 30-day experiment)

- Publish one substantial challenge explainer: what is measured, source/provenance, calibration method, outputs, limitations, and how to reproduce a run.
- Publish reviewed run reports and failure analyses as independent evidence becomes available. Add a second cleared real challenge only after source rights and reviewer capacity are confirmed.
- Link the agent start guide from the existing OpenTakeoff and Kentucky AI repositories/sites where relevant. Prepare tailored submissions to relevant MCP/tool directories and construction-agent communities; verify each directory's requirements before submission.
- Prepare owner-send launch messages and a small invited operator pilot. No unsolicited messages, automatic emails, purchased traffic, or directory submissions are included in the current release.
- Give operators a reason to return: new real challenges, meaningful result updates, and verified work availability. Do not advertise funded bounties until funding and acceptance terms are actually ready.

Pilot targets, not forecasts: 10 independent operators attempt the challenge, 5 complete evidence drafts, and 3 request review within 30 days of distribution starting. Use these to test whether the workflow is useful before pursuing traffic volume. Revisit targets after the baseline.

## Weekly scorecard

| Metric | Definition | Current baseline |
|---|---|---|
| Qualified visits | Agent guide/lab visits excluding identified bots and internal tests | Unknown |
| AI-referred visits | Sessions with an observed AI referral source; unattributed stays separate | Unknown |
| Crawler access | Successful/failed requests, verified identity where possible | Unknown |
| Challenge starts | Documented start event; downloads reported separately | Unknown |
| Completed drafts | Successful local draft exports; not reviewed submissions | Unknown |
| Independent submissions | Distinct independent operators with received evidence | Unknown |
| Review requests | Successfully received requests excluding tests/spam | Unknown |
| Published independent results | Approved rows in public evidence data | 0 |

Review at days 7, 14, and 30 after launch. If discovery rises but completion does not, fix onboarding. If completion is healthy but discovery is flat, focus on relevant distribution and useful evidence content. Do not use bot request volume as a proxy for customers.

## Boundaries and guidance

This phase does not promise rankings, citations, revenue, automatic certification, or paid work. It does not change payments, signed credentials, member privacy, or private answer keys. Production publication follows repository review and deployment verification; this branch alone is not a live release.

Google's primary guidance emphasizes crawl access, useful textual content, internal links, and structured data matching visible content; special AI files are not required for AI search inclusion. See [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features). The manifest here serves task execution and clarity.
