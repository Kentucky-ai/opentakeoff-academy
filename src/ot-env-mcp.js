#!/usr/bin/env node
// src/ot-env-mcp.js
//
// Exposes the OpenTakeoff environment (src/environment.js) as an MCP stdio
// server, so a BRING-YOUR-OWN-HARNESS agent can reach the REAL takeoff sandbox
// over MCP instead of through the built-in runner loop. The tools are exactly
// the built-in takeoff ops (set_scale, measure_area, measure_length, count,
// identify_scope, emit_quantity); every call runs against the planset geometry
// and returns a real measurement. Scale state persists across calls, so a client
// drives set_scale → measure_* like operating a live tool.
//
// One server instance = one planset/environment. Point it at a task or asset:
//
//   node src/ot-env-mcp.js --task tasks/div9/practice/d9-area-1.task.json
//   node src/ot-env-mcp.js --asset tasks/div9/practice/assets/d9-area-1.svg --unit ft
//   node src/ot-env-mcp.js                # explicit-geometry only (no asset)
//
// The certified path points this same server at a deployed OpenTakeoff instance
// via the OpenTakeoffBackend seam (see src/environment.js) — same tools, same
// contract, no OpenTakeoff source changes.
//
// Built on the official @modelcontextprotocol/sdk low-level Server API.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { createEnvironment } from './environment.js';
import { createOpenTakeoffBackend } from './ot-backend.js';
import { BUILTIN_TOOLS, BUILTIN_TOOL_NAMES } from './runner.js';

/** Resolve the task + planset asset path from CLI flags (--task | --asset | none). */
function resolveTaskAndAsset(flags) {
  let task;
  let assetPath = null;
  if (flags.task) {
    const taskPath = resolve(flags.task);
    task = JSON.parse(readFileSync(taskPath, 'utf8'));
    const ref = task.planset?.assetRef;
    if (ref) { const p = resolve(dirname(taskPath), ref); if (existsSync(p)) assetPath = p; }
  } else if (flags.asset) {
    assetPath = resolve(flags.asset);
    task = { planset: { assetRef: flags.asset, units: flags.unit === 'm' ? 'metric' : 'imperial' } };
  } else {
    task = { planset: { assetRef: null, units: flags.unit === 'm' ? 'metric' : 'imperial' } };
  }
  return { task, assetPath };
}

/** True when CLI flags select the real OpenTakeoff engine backend. */
function wantsOpenTakeoff(flags) {
  return flags.backend === 'opentakeoff' || flags.engine === 'opentakeoff' || flags.opentakeoff === true;
}

/**
 * Build the environment described by CLI flags, SVG backend (--task | --asset |
 * none — the explicit-geometry sandbox). Synchronous; the certified engine
 * backend is built by {@link buildEnvFromArgsAsync}.
 */
export function buildEnvFromArgs(argv = []) {
  const flags = parseFlags(argv);
  const { task, assetPath } = resolveTaskAndAsset(flags);
  const assetContent = assetPath ? readFileSync(assetPath, 'utf8') : null;
  const env = createEnvironment({ task, assetPath, assetContent, unit: flags.unit });
  return { env, task, assetPath };
}

/**
 * Build the environment, honoring `--backend opentakeoff` (the CERTIFIED path):
 * drives the real opentakeoff-mcp engine on the planset PDF. Falls through to the
 * synchronous SVG builder otherwise. `--mcp-dir` overrides engine auto-discovery.
 */
export async function buildEnvFromArgsAsync(argv = []) {
  const flags = parseFlags(argv);
  if (!wantsOpenTakeoff(flags)) return buildEnvFromArgs(argv);

  const { task, assetPath } = resolveTaskAndAsset(flags);
  if (!assetPath) {
    throw new Error('the opentakeoff backend needs a planset PDF on disk: pass --task <task.json> (PDF assetRef) or --asset <plan.pdf>');
  }
  const backend = await createOpenTakeoffBackend({
    plansetPath: assetPath,
    mcpDir: flags['mcp-dir'],
    rooms: task.planset?.rooms,
    unit: flags.unit === 'm' ? 'm' : 'ft',
    log: (m) => process.stderr.write(`[ot-env-mcp] ${m}\n`),
  });
  const env = createEnvironment({ task, assetPath, backend });
  return { env, task, assetPath, backend };
}

/** MCP tool descriptors derived from the built-in Academy toolset. */
export function environmentToolDescriptors() {
  return BUILTIN_TOOL_NAMES.map((name) => ({
    name,
    description: BUILTIN_TOOLS[name].function.description,
    inputSchema: BUILTIN_TOOLS[name].function.parameters,
  }));
}

async function main() {
  const { env, assetPath } = await buildEnvFromArgsAsync(process.argv.slice(2));

  const server = new Server(
    { name: 'opentakeoff-environment', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  const tools = environmentToolDescriptors();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (!BUILTIN_TOOL_NAMES.includes(name)) {
      return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
    }
    const result = env.invoke(name, args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: result?.ok === false };
  });

  await server.connect(new StdioServerTransport());
  process.stderr.write(`[ot-env-mcp] OpenTakeoff environment ready — planset: ${assetPath || '(explicit-geometry only)'}\n`);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) flags[k] = true; else { flags[k] = n; i++; } }
  }
  return flags;
}

// Run as a server unless imported (the helpers above are importable for tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { process.stderr.write(`[ot-env-mcp] fatal: ${e?.stack || e}\n`); process.exit(1); });
}
