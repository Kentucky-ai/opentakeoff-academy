// src/ot-mcp-client.js
//
// A robust stdio MCP client for the REAL OpenTakeoff engine (`opentakeoff-mcp`,
// the server that lives in the OpenTakeoff repo at `mcp/server.ts`). This is the
// plumbing the certified-path OpenTakeoffBackend drives — it does NOT modify the
// OpenTakeoff source; it operates the published engine over its stdio contract,
// exactly as any MCP client would.
//
// Robustness this layer owns (so callers don't have to):
//   - locates the engine (explicit dir → $OTA_MCP_DIR → repo sibling → ~/dev),
//     and fails with an actionable message when it isn't installed;
//   - a bounded connect with a timeout and a clean teardown on failure;
//   - per-call timeouts, so a hung engine can never hang a run;
//   - the engine's own error contract honored: a tool `isError` result carries a
//     human-readable message (`fail(...)` in the engine), which we surface as a
//     thrown OtEngineError instead of silently returning junk;
//   - text content parsed from JSON when the tool returns JSON, else the raw text.
//
// Everything here is deterministic: no Date.now(), no Math.random().

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));      // <repo>/src
const REPO = resolve(HERE, '..');                          // <repo>

/** Thrown when the engine reports a tool failure or a call times out. */
export class OtEngineError extends Error {
  constructor(message, { tool, code } = {}) {
    super(message);
    this.name = 'OtEngineError';
    this.tool = tool;
    this.code = code;
  }
}

/**
 * Resolve the OpenTakeoff MCP engine directory (the folder containing
 * `server.ts`). Search order, first hit wins:
 *   1. an explicit path argument
 *   2. $OTA_MCP_DIR
 *   3. a sibling checkout next to this repo:  <repo>/../opentakeoff/mcp
 *   4. the conventional dev location:         ~/dev/opentakeoff/mcp
 * @param {string} [explicit]
 * @returns {string} absolute path to the engine dir
 * @throws {OtEngineError} with install guidance when none resolve
 */
export function resolveMcpDir(explicit) {
  const candidates = [
    explicit,
    process.env.OTA_MCP_DIR,
    resolve(REPO, '..', 'opentakeoff', 'mcp'),
    join(homedir(), 'dev', 'opentakeoff', 'mcp'),
  ].filter(Boolean);

  for (const c of candidates) {
    const dir = resolve(c);
    if (existsSync(join(dir, 'server.ts')) && statSync(dir).isDirectory()) return dir;
  }

  throw new OtEngineError(
    'OpenTakeoff engine (opentakeoff-mcp) not found. Looked for server.ts in: ' +
      candidates.map((c) => resolve(c)).join(', ') +
      '. Clone the OpenTakeoff repo and set OTA_MCP_DIR to its mcp/ directory ' +
      '(the folder with server.ts), or pass { mcpDir } explicitly.',
    { code: 'engine-not-found' },
  );
}

/** Race a promise against a timeout; reject with a labeled OtEngineError. */
function withTimeout(promise, ms, label) {
  if (!(ms > 0)) return promise;
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new OtEngineError(`${label} timed out after ${ms}ms`, { code: 'timeout' })), ms);
    // Do not keep the event loop alive solely for this timer.
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * A connected handle to the OpenTakeoff engine. One instance == one live server
 * subprocess. Construct via {@link connectOtEngine}; always `close()` it.
 */
export class OtMcpClient {
  /** @param {Client} client @param {StdioClientTransport} transport @param {object} opts */
  constructor(client, transport, opts = {}) {
    this.client = client;
    this.transport = transport;
    this.mcpDir = opts.mcpDir;
    this.callTimeoutMs = opts.callTimeoutMs ?? 60000;
    this._closed = false;
  }

  /**
   * Call an engine tool and return its parsed result. JSON text content is
   * parsed to an object; otherwise the raw text is returned. A tool that reports
   * `isError` (the engine's readable "you clicked in hatching" style messages)
   * throws {@link OtEngineError} carrying that message.
   * @param {string} name @param {object} [args] @param {{timeoutMs?:number}} [opts]
   */
  async call(name, args = {}, opts = {}) {
    if (this._closed) throw new OtEngineError('engine client is closed', { tool: name, code: 'closed' });
    const timeoutMs = opts.timeoutMs ?? this.callTimeoutMs;
    let res;
    try {
      res = await withTimeout(
        this.client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs }),
        timeoutMs,
        `engine tool '${name}'`,
      );
    } catch (e) {
      if (e instanceof OtEngineError) { e.tool = e.tool || name; throw e; }
      throw new OtEngineError(`engine tool '${name}' failed: ${e?.message || e}`, { tool: name });
    }

    const text = Array.isArray(res?.content)
      ? res.content.find((c) => c?.type === 'text')?.text
      : undefined;
    const parsed = parseMaybeJson(text);

    if (res?.isError) {
      const msg = typeof parsed === 'string' ? parsed : (parsed?.error || parsed?.message || text || 'unknown engine error');
      throw new OtEngineError(String(msg), { tool: name, code: 'tool-error' });
    }
    return parsed;
  }

  /** List the engine's tool names (for preflight / diagnostics). */
  async listToolNames() {
    const r = await withTimeout(this.client.listTools(), this.callTimeoutMs, 'listTools');
    return (r?.tools || []).map((t) => t.name);
  }

  /** Terminate the server subprocess and release the transport. Idempotent. */
  async close() {
    if (this._closed) return;
    this._closed = true;
    try { await this.client.close(); } catch { /* already gone */ }
    try { await this.transport.close?.(); } catch { /* already gone */ }
  }
}

/**
 * Spawn + connect to the OpenTakeoff engine over stdio.
 * @param {object} [opts]
 * @param {string} [opts.mcpDir] - engine dir (else auto-resolved)
 * @param {number} [opts.connectTimeoutMs=30000]
 * @param {number} [opts.callTimeoutMs=60000] - default per-call timeout
 * @param {object} [opts.env] - extra env vars for the subprocess
 * @returns {Promise<OtMcpClient>}
 */
export async function connectOtEngine(opts = {}) {
  const mcpDir = resolveMcpDir(opts.mcpDir);
  const connectTimeoutMs = opts.connectTimeoutMs ?? 30000;

  // `node --import tsx server.ts` is the whole invocation (per the engine's
  // MCP.md). cwd MUST be the engine dir so `tsx` resolves from its node_modules,
  // and so `npm start`'s stdout banner never touches the JSON-RPC wire.
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--import', 'tsx', 'server.ts'],
    cwd: mcpDir,
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  });
  const client = new Client({ name: 'opentakeoff-academy', version: '0.1.0' }, { capabilities: {} });

  try {
    await withTimeout(client.connect(transport), connectTimeoutMs, 'engine connect');
  } catch (e) {
    try { await transport.close?.(); } catch { /* ignore */ }
    if (e instanceof OtEngineError) throw e;
    throw new OtEngineError(`could not start the OpenTakeoff engine in ${mcpDir}: ${e?.message || e}`, { code: 'connect-failed' });
  }

  return new OtMcpClient(client, transport, { mcpDir, callTimeoutMs: opts.callTimeoutMs });
}

/** Parse text as JSON when it looks like JSON; otherwise return it verbatim. */
function parseMaybeJson(text) {
  if (typeof text !== 'string') return text ?? null;
  const t = text.trim();
  if (!t) return '';
  if (t[0] === '{' || t[0] === '[') { try { return JSON.parse(t); } catch { return text; } }
  return text;
}
