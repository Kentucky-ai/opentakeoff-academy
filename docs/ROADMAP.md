# OpenTakeoff, Rusty and Union roadmap

Working priorities, October 24, 2026. This is a proposed sequence, not promised release dates. A feature moves forward when its acceptance check passes.

## Where each repository fits

| Repository | Responsibility | Current foundation |
|---|---|---|
| OpenTakeoff | The estimator's workspace and reviewed takeoff record | PDF canvas, quantities, estimate/proposal tools, MCP; dependency security refresh |
| OpenTakeoff Rusty | Bounded native computation for demanding agent jobs | Geometry, text-layer PDF index, source citations, queued MCP workers, cancellation and resource limits |
| Commonwealth Agent Union / Academy | Discover useful agents, inspect evidence, connect tools and qualify work | Marketplace catalog and discovery MCP, connection review, existing qualification and bounty workflows |

Keep the boundaries simple: OpenTakeoff owns estimator review; Rusty computes and cites evidence; Union discovers offerings and records their terms. None of those roles substitutes for another.

## 1. Make one real agent job dependable

| Repo | Next feature | Done when |
|---|---|---|
| OpenTakeoff | Recoverable agent sessions and explicit proposed changes | A disconnected/retried job cannot duplicate measurements; the estimator can inspect, accept, reject and undo its changes |
| Rusty | A stable adapter into OpenTakeoff | Representative public plans preserve geometry contracts; every refusal is explicit; callers can cancel without leaving workers running |
| Union | First installable, tested agent/tool offerings | An operator can find an offering, inspect exact version/access/cost/evidence, and connect it; withdrawal blocks new connections |

**Shared milestone:** choose a real public plan, discover the tool in Union, run a bounded job through Rusty where supported, and review its cited results in OpenTakeoff. Publish reproducible evidence; do not imply a live-model accuracy result from a scripted tool test.

## 2. Handle larger plan sets and longer work

| Repo | Next feature | Done when |
|---|---|---|
| OpenTakeoff | Revision-aware document references and result review | Replacing a sheet identifies affected measurements and evidence; stale results cannot silently appear current |
| Rusty | Incremental indexing, OCR/vector-text adapters and resumable jobs | Unchanged source is reused; unread pages stay visible; a worker restart resumes or explicitly fails a job without duplicate output |
| Union | Publisher accounts and immutable version submissions | Publishers submit privately; reviewers approve public fields and provenance; every version has an inspectable review and revocation history |

Start with measured problem cases. Rusty's current index is text-layer-only; OCR, drawing coordinates, schedule linking and complete document understanding are future work. Reuse Premium concepts only after compatibility and licensing review.

## 3. Run paid jobs with enforceable controls

| Repo | Next feature | Done when |
|---|---|---|
| OpenTakeoff | Scoped project access for external agents | Access can be revoked; external writes require the defined approval; the record identifies the operator and source |
| Rusty | Restricted worker execution and per-project resource budgets | Tests show filesystem/network restrictions, cancellation, limits and separation between customers are enforced |
| Union | Job execution, spending limits and durable receipts | One job has a bounded budget, clear status, cancellation and a durable result receipt; retries cannot bill twice |
| Union | Offers, customer acceptance and settlement | Provider setup, refund/dispute rules and acceptance are implemented and tested before payments are enabled |

Local MCP permission descriptions are disclosures today, not an OS sandbox. A listing is not an Academy credential. Qualification remains separate from publisher claims, and payment never creates a credential.

## Defer until the above works

- A separate agent framework or custom model-hosting platform.
- Automatic acceptance of takeoff quantities or unreviewed project writes.
- Broad platform integrations without a tested operator need.
- Marketplace ranking, reviews and revenue claims before real consenting users and completed jobs exist.

## Reference to evaluate: TakeoffBeam

[TakeoffBeam / Takeoff Desk](https://github.com/constructionlive/takeoffbeam) documents a native Rust desktop app, local models, MCP, a document map, model-specific coordinate conversion and reviewable AI marks. Useful comparisons: OpenTakeoff's agent review/follow view, Rusty's document indexing and rendering boundaries, and Union's ability to connect independently operated MCP tools. Benchmark the same public plans before comparing performance; its published timings are author-reported. Inspect actual permissions and compatibility before considering a listing. No integration or endorsement is implied, and no source has been copied.

## Keep every release maintainable

Keep dependency updates, lockfiles and vulnerability checks current. Link review evidence to each change. Use public or permissioned plans, and keep private plans, credentials and prices out of evidence. Test interrupted jobs and restores alongside successful runs. Measure accuracy, latency, memory and cost on named workloads before making product claims.
