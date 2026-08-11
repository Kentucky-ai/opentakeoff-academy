# The Sealed-Container Runner

For companies that won't expose an endpoint but will hand over a Docker image: the Academy runs your container against the [Environment API](./ENVIRONMENT-API.md) on a network where **the only reachable thing is the Academy endpoint**. Your image can contain anything — your model, your prompts, your RAG, your orchestration, your tools, your MCP servers, five models behind an internal gateway. The Academy doesn't need to know what's inside and can't see in. It cares about one thing: how your box operates the takeoff tools.

```
opentakeoff-academy proctor --track div9 --suite ranked --image yourco/takeoff-agent:1.4 --out run.bundle.json
```

## The contract your image signs up for

**Input.** Five environment variables, injected at start:

| Variable | Meaning |
|---|---|
| `ACADEMY_ENV_URL` | Base URL of the Environment API, e.g. `http://academy.internal:49321/v1` |
| `ACADEMY_SESSION_TOKEN` | Bearer token for every authenticated route |
| `ACADEMY_TRACK` | Track being certified, e.g. `div9` |
| `ACADEMY_SUITE` | Suite id, e.g. `ranked` |
| `ACADEMY_PROTOCOL` | Wire protocol id — `ota-env/1` |

**Behavior.** On start, your entrypoint drives the session: `GET /v1/session` → work the task with `POST /v1/tools/*` → `POST /v1/task/done` → repeat → exit 0 when `suiteComplete` is true. That's the whole lifecycle. The [reference adapter](../examples/container/agent.mjs) does it in ~80 lines.

**Output.** None. No files, no stdout parsing, no upload. Your answers are the `emit_quantity` calls you made; the Academy already recorded them.

## The runtime your image runs in

Locked, and identical for every entrant:

- **No internet.** A dedicated bridge network with IP masquerade disabled — outbound traffic to the world has nowhere to go. The Academy endpoint (via the `academy.internal` host alias) is the only reachable service. If your agent needs a hosted LLM API at inference time, the container path is not for you — use the [remote-env path](./ENVIRONMENT-API.md#who-hosts-what), where your stack stays on your infra.
- **Read-only root filesystem**, with a 512 MB tmpfs at `/tmp` for scratch.
- **No capabilities** (`--cap-drop ALL`), no privilege escalation (`no-new-privileges`).
- **Resource caps:** 4 GB memory, 2 CPUs, 512 pids by default (raisable per engagement — say so when you request the session).
- **Hard wall clock.** The suite's summed task budgets plus one minute of grace; past it the container is killed and the run finalizes as-is. A hung container is a scored container.

Ship your weights **inside the image**. Images can be large; that's expected and fine.

## What binds the run to your image

The bundle's attestation carries `endpointFingerprint` = sha256 of the resolved image ID, so the certificate is bound to the exact bits that were proctored — retag it, and the fingerprint changes. Combined with the Academy co-signature over the bundle hash, a certified score can't be transplanted onto a different build.

## What the Academy sees and doesn't

Sees: your image ID, your container's tool calls with arguments and results, wall-clock, exit code, and stdout/stderr (logged for debugging — don't print secrets).

Doesn't see, by construction: anything that never crosses the five routes. There is no volume mount, no exec into the container, no image layer inspection as part of scoring. If your legal team wants more comfort: the runner source is [`src/container.js`](../src/container.js), Apache-2.0, short enough to read in one sitting.

## Testing locally before you submit

You can run the exact proctor flow against the public practice suite yourself — same command, same isolation, public answer keys:

```
git clone https://github.com/Kentucky-ai/opentakeoff-academy && cd opentakeoff-academy
npm install
docker build -t my-agent examples/container   # or your own image
node src/cli.js proctor --track div9 --suite practice --image my-agent --out ./runs/local.bundle.json
node src/cli.js score ./runs/local.bundle.json --track div9 --suite practice
```

If that passes locally, the certified run is the same machinery pointed at a held-out suite you've never seen.
