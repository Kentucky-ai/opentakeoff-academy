# Examples — bring your own agent + parser

Two reference integrations that make the whole harness runnable **offline, with
no LLM and no network**. Copy either as a starting point for a real submission.

## 1. `my-agent.example.js` — a reference agent (OpenAI-compatible endpoint)

A tiny, deterministic agent exposed exactly like a real model server
(`POST /v1/chat/completions`). It solves the practice **sample task** by parsing
the calibration and room geometry out of the prompt, then walking the takeoff
loop `set_scale → measure_area → emit_quantity`. Real entrants point the runner
at their own model server instead — nothing else changes.

```bash
# Run it as an endpoint…
node examples/my-agent.example.js --serve --port 8123

# …then drive it with the CLI, exactly as you would a real model:
node src/cli.js run \
  --track div9 --suite practice \
  --endpoint http://localhost:8123/v1 --model reference-nollm \
  --out ./runs/example.bundle.json

# Score locally against the practice keys:
node src/cli.js score ./runs/example.bundle.json --track div9 --suite practice
```

### One-shot end-to-end self-test (`npm test`)

```bash
node examples/my-agent.example.js --selftest
```

This runs the full pipeline in-process against a temp copy of the sample task:
**run → validate → score → issue a self-reported cert → render a badge → MCP
smoke test**, asserting each step and exiting non-zero on any failure. It is
what `npm test` executes, and it needs no network.

> The sample task's ground truth is `RM-101 LVT area = 850 sf`
> (`200 px = 20 ft` ⇒ `10 px/ft`; `340 px × 250 px` ⇒ `34 ft × 25 ft`). The
> reference agent computes exactly this, so the run scores ~0% APE and earns the
> `master` tier in the demo.

## 2. `my-parser.mcp.example.js` — a reference parser (MCP server)

Your proprietary document parser is exposed as an **MCP server**; the runner
calls it as a black box, and only the tool call + result land in the trace
(redactable for private tools). This example ships one deterministic tool,
`parse_planset`, returning structured rooms/finishes/polygons.

`my-parser.mcp.example.json` is the descriptor you hand to the runner:

```json
{ "command": "node", "args": ["examples/my-parser.mcp.example.js"] }
```

```bash
# Bring the parser along as MCP tools the agent can call:
node src/cli.js run \
  --track div9 --suite practice \
  --endpoint http://localhost:8123/v1 --model my-model \
  --mcp examples/my-parser.mcp.example.json \
  --out ./runs/my-run.bundle.json
```

- stdio server → `{ "command": "node", "args": ["…"] }` (args relative to CWD).
- HTTP server → `{ "url": "https://your-parser.example/mcp" }`.

The runner lists the server's tools, advertises them to the model alongside the
built-in Academy tools (`set_scale`, `measure_area`, `measure_length`, `count`,
`identify_scope`, `emit_quantity`), and records each call as `mcp_call` /
`mcp_result` in the trace.

## Bring your own harness instead

If you run the whole loop yourself, produce a conformant bundle with the SDK
helpers (`buildBundle`, `signBundle` in `../src/bundle.js`), set
`contestant.adapter = "custom-bundle"`, and validate it:

```bash
node src/cli.js validate ./runs/my-run.bundle.json
```

## Bring your own API or container

For a proctored run where your stack stays a black box, drive the Academy-hosted
[Environment API](../docs/ENVIRONMENT-API.md) from your own harness, or hand
over a [sealed Docker image](../docs/CONTAINER-RUNNER.md). The reference
container entrant lives in [`container/`](./container) — the whole `ota-env/1`
lifecycle in ~90 lines of plain `fetch`.
