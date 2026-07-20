// src/runner.js
//
// The conformance runner. For each task in a suite it drives an agent loop
// against an OpenAI-compatible endpoint, executing built-in Academy tools and
// (optionally) the entrant's MCP tools, recording the COMPLETE ordered trace
// required by schema/run-bundle.schema.json, and collecting the quantities the
// agent emits. It then rolls up telemetry and finalizes a signed run-bundle.
//
// The built-in tools (set_scale, measure_area, measure_length, count,
// identify_scope) are backed by the REAL OpenTakeoff environment
// (src/environment.js): every measurement is COMPUTED from the planset geometry
// at the agent's calibrated scale, so the trace carries real tool results and
// agents are scored on OPERATING the tool. emit_quantity records the agent's
// final reported quantity into the answer block. The CLI contract and the
// run-bundle trace format are unchanged — only the tool bodies compute real
// geometry now.
//
// The environment's backend is pluggable: the SvgGeometryBackend answers the
// practice suites, and the OpenTakeoffBackend seam drives a deployed OpenTakeoff
// instance for the certified path (same interface, no source changes).

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildBundle, signBundle, sha256File, newRunId } from './bundle.js';
import { connectMcp, mcpToolsToOpenAI } from './mcp.js';
import { createEnvironment } from './environment.js';
import { createOpenTakeoffBackend } from './ot-backend.js';

export const SDK_VERSION = '1.0.0';

// Names of the built-in tools the Academy hands to every agent.
export const BUILTIN_TOOL_NAMES = ['set_scale', 'measure_area', 'measure_length', 'count', 'identify_scope', 'emit_quantity'];
const BUILTIN_SET = new Set(BUILTIN_TOOL_NAMES);

/** OpenAI-format function-tool definitions for the built-in toolset. */
export const BUILTIN_TOOLS = {
  set_scale: {
    type: 'function',
    function: {
      name: 'set_scale',
      description: "Calibrate the drawing scale before measuring — this is REAL: the scale you set is applied to every later measurement, so a wrong calibration yields wrong areas. Calibrate any of three ways: pass pxPerUnit directly; pass a measured reference (referencePx + referenceLength); or calibrate off the plan's graphic scale bar with from:'scale-bar'.",
      parameters: {
        type: 'object',
        properties: {
          pxPerUnit: { type: 'number', description: 'Pixels per real-world unit (e.g. px per foot).' },
          referencePx: { type: 'number', description: 'Length in pixels of a known reference (e.g. a scale bar).' },
          referenceLength: { type: 'number', description: 'Real-world length of that reference.' },
          from: { type: 'string', description: "Set to 'scale-bar' to calibrate off the drawing's graphic scale bar." },
          unit: { type: 'string', description: "Real-world unit, e.g. 'ft' or 'm'." },
          note: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
  },
  measure_area: {
    type: 'function',
    function: {
      name: 'measure_area',
      description: 'Measure the REAL area of a region on the calibrated plan (area = pixel area ÷ scale²). Identify the region by a roomId, or by tracing it as region.points (polygon in px) or a region rectangle {x,y,width,height} in px.',
      parameters: {
        type: 'object',
        properties: {
          roomId: { type: 'string', description: 'Name a room on the plan to measure its footprint.' },
          region: { description: 'Region to measure: { points: [[x,y],…] } polygon, or { x,y,width,height } rectangle, or { roomId } — all in px.' },
          label: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
  },
  measure_length: {
    type: 'function',
    function: {
      name: 'measure_length',
      description: 'Measure a linear length (e.g. base/transition) on the calibrated plan.',
      parameters: {
        type: 'object',
        properties: {
          roomId: { type: 'string' },
          region: { description: 'Polyline (points in px).' },
          label: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
  },
  count: {
    type: 'function',
    function: {
      name: 'count',
      description: 'Count fixtures/symbols of a given type within a region.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          region: { description: 'Region to count within (px).' },
        },
        additionalProperties: true,
      },
    },
  },
  identify_scope: {
    type: 'function',
    function: {
      name: 'identify_scope',
      description: 'Identify scope items (finish types, assemblies) present in a region or on a sheet.',
      parameters: {
        type: 'object',
        properties: {
          region: { description: 'Region/sheet to inspect.' },
        },
        additionalProperties: true,
      },
    },
  },
  emit_quantity: {
    type: 'function',
    function: {
      name: 'emit_quantity',
      description: 'Record ONE final takeoff quantity. Call once per quantity in your answer. When you have emitted every quantity, reply with a short summary and NO further tool calls.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: "What was measured, e.g. 'RM-101 LVT area'." },
          value: { type: 'number' },
          unit: { type: 'string', description: "e.g. 'sf', 'lf', 'ea'." },
          roomId: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['item', 'value', 'unit'],
        additionalProperties: false,
      },
    },
  },
};

const SYSTEM_PROMPT = [
  'You are a construction takeoff agent competing in the OpenTakeoff Academy.',
  'Measure the requested quantities off the plan using the provided tools.',
  'Calibrate the scale first when needed (set_scale), then measure (measure_area / measure_length / count) or identify scope.',
  'Record every final quantity with emit_quantity(item, value, unit). Call emit_quantity once per quantity.',
  'When every quantity has been emitted, reply with a one-line summary and DO NOT call any more tools.',
].join(' ');

/**
 * Load a suite's tasks from disk: <tasksDir>/<track>/<suite>/*.task.json.
 * @param {string} tasksDir - root tasks directory (e.g. './tasks')
 * @param {string} track
 * @param {string} suite - suite folder name ('practice' | 'ranked' | a suite id)
 * @returns {Array<object>} parsed task objects, sorted by taskId for determinism
 */
export function loadTasks(tasksDir, track, suite) {
  const dir = join(tasksDir, track, suite);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`no task directory at ${dir} (expected <tasksDir>/<track>/<suite>/*.task.json)`);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.task.json')).sort();
  if (files.length === 0) throw new Error(`no *.task.json files in ${dir}`);
  return files.map((f) => {
    const task = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    task.__dir = dir; // internal: used to resolve the planset asset for hashing
    return task;
  });
}

/**
 * Run a suite and return a finalized (optionally signed) run-bundle.
 * @param {object} opts
 * @param {string} opts.track
 * @param {string} opts.suite - suite folder ('practice'|'ranked'|id)
 * @param {string} opts.endpoint - OpenAI-compatible base URL (…/v1)
 * @param {string} [opts.model]
 * @param {object} [opts.mcpDescriptor] - entrant MCP server descriptor
 * @param {string} [opts.tasksDir='./tasks']
 * @param {Array<object>} [opts.tasks] - pre-loaded tasks (skips disk load; used by tests)
 * @param {object} [opts.contestant] - { name, modelId, harness, adapter, contact }
 * @param {'self_reported'|'proctored'} [opts.attestationMode='self_reported']
 * @param {'practice'|'ranked'} [opts.mode] - suite mode (inferred from `suite` if omitted)
 * @param {string} [opts.now] - ISO start timestamp (informational)
 * @param {string} [opts.privateKeyPem] - entrant key to sign the bundle
 * @param {function} [opts.fetchImpl] - override fetch (tests)
 * @param {function} [opts.log] - progress logger
 * @returns {Promise<object>} run-bundle
 */
export async function runSuite(opts) {
  const log = opts.log || (() => {});
  const tasksDir = opts.tasksDir || './tasks';
  const tasks = opts.tasks || loadTasks(tasksDir, opts.track, opts.suite);

  // Wire up MCP (entrant parser) if a descriptor was supplied.
  let mcp = null;
  let mcpOpenAITools = [];
  let mcpToolSet = new Set();
  if (opts.mcpDescriptor) {
    mcp = await connectMcp(opts.mcpDescriptor);
    const listed = await mcp.listTools();
    const conv = mcpToolsToOpenAI(listed);
    mcpOpenAITools = conv.tools;
    mcpToolSet = conv.names;
    log(`connected MCP server '${mcp.serverId}' — ${listed.length} tool(s): ${listed.map((t) => t.name).join(', ')}`);
  }

  const ctx = {
    endpoint: opts.endpoint,
    model: opts.model || 'default',
    fetchImpl: opts.fetchImpl || globalThis.fetch,
    mcp,
    mcpOpenAITools,
    mcpToolSet,
    mcpServerId: mcp?.serverId,
    // Environment backend: 'svg' (default; parses the practice planset) or
    // 'opentakeoff' (the CERTIFIED path — drives the real opentakeoff-mcp engine).
    engine: opts.engine || 'svg',
    mcpDir: opts.mcpDir,
    log,
  };

  const taskResults = [];
  try {
    for (const task of tasks) {
      log(`running task ${task.taskId} …`);
      taskResults.push(await runTask(task, ctx));
    }
  } finally {
    if (mcp) await mcp.close();
  }

  // Run-level telemetry rollups.
  const total = (f) => taskResults.reduce((a, t) => a + (t.telemetry[f] || 0), 0);
  const firstTask = tasks[0];
  const mode = opts.mode || (opts.suite === 'ranked' ? 'ranked' : 'practice');

  const parts = {
    runId: newRunId(),
    track: opts.track,
    suite: {
      id: firstTask?.suite?.id || opts.suite,
      version: firstTask?.suite?.version || '0',
      mode,
    },
    contestant: pruneUndefined({
      name: opts.contestant?.name || 'anonymous',
      modelId: opts.contestant?.modelId || ctx.model,
      harness: opts.contestant?.harness,
      adapter: opts.contestant?.adapter || (mcp ? 'mcp' : 'openai-endpoint'),
      contact: opts.contestant?.contact,
    }),
    attestation: { mode: opts.attestationMode || 'self_reported' },
    tasks: taskResults,
    telemetry: pruneUndefined({
      sdkVersion: SDK_VERSION,
      totalSteps: total('steps'),
      totalTokensIn: total('tokensIn'),
      totalTokensOut: total('tokensOut'),
      totalWallMs: total('wallMs'),
      startedAt: opts.now,
    }),
  };

  const bundle = buildBundle(parts);
  return signBundle(bundle, opts.privateKeyPem);
}

/** Run one task's agent loop and return its bundle entry. */
async function runTask(task, ctx) {
  const t0 = performance.now();
  const trace = [];
  let seq = 0;
  const push = (entry) => {
    trace.push({ seq: seq++, tOffsetMs: Math.max(0, Math.round(performance.now() - t0)), ...entry });
  };

  // --- provenance anchor: bind the run to the exact planset ----------------
  const anchor = resolveAsset(task);
  push({
    type: 'tool_result',
    tool: 'planset',
    args: { assetRef: task.planset.assetRef },
    result: { assetRef: task.planset.assetRef, assetHash: anchor.assetHash, declaredHash: task.planset.assetHash, verified: anchor.verified },
  });

  // --- the REAL OpenTakeoff environment, backed by the planset geometry -----
  // Default: SvgGeometryBackend over the planset markup. Certified path
  // (ctx.engine === 'opentakeoff'): drive the real opentakeoff-mcp engine on the
  // plan PDF — same environment/tool surface, real engine geometry underneath.
  let otBackend = null;
  if (ctx.engine === 'opentakeoff') {
    if (!anchor.path) throw new Error(`opentakeoff engine requires the planset asset on disk; ${task.taskId} has none resolvable`);
    ctx.log?.(`[${task.taskId}] building OpenTakeoff engine backend on ${anchor.path} …`);
    otBackend = await createOpenTakeoffBackend({
      plansetPath: anchor.path,
      mcpDir: ctx.mcpDir,
      rooms: task.planset?.rooms,
      log: ctx.log,
    });
    push({
      type: 'tool_result',
      tool: 'engine',
      args: { engine: 'opentakeoff-mcp', sheet: otBackend.engine.sheet },
      result: { engine: 'opentakeoff-mcp', upp: otBackend.engine.upp, scaleLabel: otBackend.engine.scaleLabel, roomsResolved: otBackend.getFeatures().rooms.length, unresolved: otBackend.unresolvedRooms() },
    });
  }
  const env = createEnvironment({
    task,
    assetPath: anchor.path,
    assetContent: otBackend ? null : readAssetContent(anchor.path),
    ...(otBackend ? { backend: otBackend } : {}),
  });

  const answer = { quantities: [] };
  let tokensIn = 0, tokensOut = 0, toolCalls = 0, mcpCalls = 0, steps = 0;

  // Advertise only this task's allowed built-ins, plus any MCP tools.
  const allowed = (task.toolset || BUILTIN_TOOL_NAMES).filter((n) => BUILTIN_SET.has(n));
  const tools = [...allowed.map((n) => BUILTIN_TOOLS[n]), ...ctx.mcpOpenAITools];

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(task) },
  ];

  const maxSteps = task.budget?.maxSteps ?? 20;
  const maxWallMs = task.budget?.maxWallMs ?? 60000;

  while (steps < maxSteps) {
    if (performance.now() - t0 > maxWallMs) { push({ type: 'error', result: { error: 'wall-budget-exceeded' } }); break; }
    steps++;

    let resp;
    try {
      resp = await chatCompletion(ctx, messages, tools);
    } catch (e) {
      push({ type: 'error', result: { error: `endpoint: ${e.message || e}` } });
      break;
    }

    const usage = resp.usage || {};
    tokensIn += usage.prompt_tokens || 0;
    tokensOut += usage.completion_tokens || 0;
    const msg = resp.choices?.[0]?.message || {};

    push({
      type: 'model_message',
      args: { role: 'assistant' },
      result: { content: msg.content ?? null, tool_calls: (msg.tool_calls || []).map((t) => ({ id: t.id, name: t.function?.name })) },
      tokens: { in: usage.prompt_tokens || 0, out: usage.completion_tokens || 0 },
    });

    // Echo the assistant turn back into the conversation.
    messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });

    const calls = msg.tool_calls || [];
    if (calls.length === 0) break; // agent is done

    for (const tc of calls) {
      const name = tc.function?.name;
      const args = parseArgs(tc.function?.arguments);

      if (ctx.mcpToolSet.has(name)) {
        // --- entrant MCP tool (black box) ---
        mcpCalls++;
        push({ type: 'mcp_call', tool: name, server: ctx.mcpServerId, args });
        let result;
        try {
          result = await ctx.mcp.callTool(name, args);
        } catch (e) {
          result = { error: String(e.message || e) };
          push({ type: 'error', tool: name, server: ctx.mcpServerId, result });
        }
        push({ type: 'mcp_result', tool: name, server: ctx.mcpServerId, result });
        pushToolMessage(messages, tc.id, result);
      } else if (name === 'emit_quantity') {
        // --- record a produced quantity ---
        toolCalls++;
        push({ type: 'tool_call', tool: 'emit_quantity', args });
        const q = normalizeQuantity(args);
        if (q) answer.quantities.push(q);
        const ack = { ok: !!q, recorded: q || null, ...(q ? {} : { error: 'emit_quantity requires item(string), value(number), unit(string)' }) };
        push({ type: 'tool_result', tool: 'emit_quantity', result: ack });
        pushToolMessage(messages, tc.id, ack);
      } else if (BUILTIN_SET.has(name)) {
        // --- built-in measurement tool: REAL geometry from the environment ---
        toolCalls++;
        push({ type: 'tool_call', tool: name, args });
        const result = env.invoke(name, args);
        push({ type: 'tool_result', tool: name, result });
        pushToolMessage(messages, tc.id, result);
      } else {
        push({ type: 'error', tool: name, args, result: { error: 'unknown-tool' } });
        pushToolMessage(messages, tc.id, { error: `unknown tool: ${name}` });
      }
    }
  }

  const wallMs = Math.round(performance.now() - t0);
  return {
    taskId: task.taskId,
    answer,
    trace,
    telemetry: { steps, tokensIn, tokensOut, wallMs, toolCalls, mcpCalls },
  };
}

/** POST a chat.completions request to the OpenAI-compatible endpoint. */
async function chatCompletion(ctx, messages, tools) {
  const url = `${String(ctx.endpoint).replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: ctx.model,
    messages,
    tools,
    tool_choice: 'auto',
    temperature: 0,
    stream: false,
  };
  const res = await ctx.fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.OPENAI_API_KEY ? { authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function safeText(res) { try { return await res.text(); } catch { return ''; } }

/** Resolve + hash the planset asset (for the provenance anchor + environment). */
function resolveAsset(task) {
  const declared = task.planset?.assetHash;
  const ref = task.planset?.assetRef;
  if (ref && task.__dir) {
    const p = join(task.__dir, ref);
    if (existsSync(p) && statSync(p).isFile()) {
      const h = sha256File(p);
      return { assetHash: h, verified: h === declared, path: p };
    }
  }
  // Asset not resolvable locally (URL, or ranked asset withheld): record the
  // declared hash and mark unverifiable. A mismatch can only be flagged when
  // the asset is present.
  return { assetHash: declared, verified: null, path: null };
}

/** Read the planset asset's text content (for SVG-geometry backends); null if absent. */
function readAssetContent(path) {
  if (!path) return null;
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

/** Build the user-facing task prompt with planset context + tool list. */
function userPrompt(task) {
  const p = task.planset || {};
  const scale = p.knownScale ? `Known scale: ${p.knownScale}.` : 'Scale is NOT given — calibrate it yourself with set_scale.';
  return [
    task.prompt,
    '',
    `Planset: ${p.assetRef} (${p.units || 'imperial'} units). ${scale}`,
    `Allowed tools: ${(task.toolset || BUILTIN_TOOL_NAMES).join(', ')}.`,
    `Budget: ${task.budget?.maxSteps} steps / ${task.budget?.maxWallMs} ms.`,
  ].join('\n');
}

// ---- small helpers ---------------------------------------------------------

function parseArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return { _raw: String(raw) }; }
}

function normalizeQuantity(args) {
  if (!args || typeof args !== 'object') return null;
  const value = typeof args.value === 'number' ? args.value : Number(args.value);
  if (!args.item || typeof args.item !== 'string' || !Number.isFinite(value) || !args.unit || typeof args.unit !== 'string') return null;
  const q = { item: args.item, value, unit: args.unit };
  if (args.roomId) q.roomId = String(args.roomId);
  if (typeof args.confidence === 'number') q.confidence = Math.max(0, Math.min(1, args.confidence));
  return q;
}

function pushToolMessage(messages, toolCallId, result) {
  messages.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(result).slice(0, 8000) });
}

function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}
