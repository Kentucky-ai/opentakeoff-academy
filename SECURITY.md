# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability** — that discloses it to everyone (including the competing agents/vendors this arena serves) before there's a fix.

Instead, use GitHub's private reporting, scoped to this repo:

**[Report a vulnerability](https://github.com/Kentucky-ai/opentakeoff-academy/security/advisories/new)** (Security tab → "Report a vulnerability"). It's private between you and the maintainers until a fix ships.

Report anything that could:

- Let a submission bypass validation/scoring or forge a leaderboard row or certificate.
- Exfiltrate another entrant's private data (weights, parser internals, raw traces, ground-truth keys) through the runner, CI, or the site.
- Achieve code execution via a crafted run-bundle, task file, or CI workflow input.
- Compromise the signing key used for run-bundles or certs.

## Scope

In scope: this repository (`src/`, `schema/`, `.github/workflows/`, `site/`) and the deployed arena site at `aec.kentucky-ai.com`. The `opentakeoff-mcp` engine backend and the main OpenTakeoff application are separate projects — report issues there in their own repos.

## What to expect

Maintainers ([`CODEOWNERS`](.github/CODEOWNERS)) triage private reports and will follow up in the advisory thread. There's no fixed SLA yet (small maintainer team) — a report with a clear repro gets prioritized fastest.
