// src/env-serve.js
//
// The Academy environment as an HTTP API — the endpoint a bring-your-own-
// everything entrant points their harness (or sealed container) at. The wire
// protocol is deliberately boring: five JSON routes, bearer-token auth, no
// SDK required (docs/ENVIRONMENT-API.md). Whatever sits on the other side —
// one model, five models behind a gateway, a multi-agent system — the Academy
// sees only tool calls, and records every one server-side (src/env-session.js).
//
//   GET  /v1/protocol      discovery (no auth): protocol id, routes, suite info
//   GET  /v1/session       current task (sanitized — never ground truth) + budgets
//   GET  /v1/planset       current task's planset asset bytes
//   POST /v1/tools/<name>  invoke one built-in tool; body = args, response = result
//   POST /v1/task/done     close the current task, advance to the next
//   POST /v1/run/complete  finalize early (partial suites score as-is)
//
// Built on node:http — zero new dependencies.

import { createServer } from 'node:http';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { extname } from 'node:path';

export const PROTOCOL_ID = 'ota-env/1';
const BODY_LIMIT = 1_000_000; // 1 MB of JSON args is far beyond any real tool call

const ASSET_TYPES = { '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.png': 'image/png', '.json': 'application/json' };

/**
 * Serve a session over HTTP.
 * @param {object} opts
 * @param {object} opts.session - a session from createSession()
 * @param {number} [opts.port=0] - 0 = ephemeral
 * @param {string} [opts.host='127.0.0.1'] - bind address ('0.0.0.0' for the container path)
 * @param {string} [opts.token] - bearer token; generated when omitted
 * @param {function} [opts.onComplete] - called once, with the finalized bundle
 * @param {function} [opts.log]
 * @returns {Promise<{url: string, port: number, token: string, close: function}>}
 */
export function serveSession(opts) {
  const session = opts.session;
  const log = opts.log || (() => {});
  const token = opts.token || randomBytes(24).toString('base64url');
  const tokenDigest = sha256(token);
  let completed = false;

  const complete = () => {
    const bundle = session.finalize();
    if (!completed) { completed = true; opts.onComplete?.(bundle); }
    return bundle;
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const route = `${req.method} ${url.pathname}`;

      if (route === 'GET /v1/protocol') {
        return sendJson(res, 200, {
          protocol: PROTOCOL_ID,
          service: 'opentakeoff-academy environment',
          track: session.track,
          suite: session.suiteId,
          taskCount: session.taskCount,
          auth: 'Authorization: Bearer <ACADEMY_SESSION_TOKEN>',
          routes: [
            'GET /v1/session', 'GET /v1/planset', 'POST /v1/tools/{set_scale|measure_area|measure_length|count|identify_scope|emit_quantity}',
            'POST /v1/task/done', 'POST /v1/run/complete',
          ],
          docs: 'https://github.com/Kentucky-ai/opentakeoff-academy/blob/main/docs/ENVIRONMENT-API.md',
        });
      }

      if (!authorized(req, tokenDigest)) return sendJson(res, 401, { ok: false, error: 'unauthorized', note: 'send Authorization: Bearer <ACADEMY_SESSION_TOKEN>' });

      if (route === 'GET /v1/session') {
        // First contact auto-starts the first task, so a harness can just GET
        // /v1/session and go — one less call to get wrong.
        if (!session.complete && session.state().task === null) await session.nextTask();
        return sendJson(res, 200, { ok: true, ...session.state() });
      }

      if (route === 'GET /v1/planset') {
        const asset = session.plansetAsset();
        if (!asset) return sendJson(res, 404, { ok: false, error: 'no-planset', note: 'no active task, or its asset is not distributable' });
        res.writeHead(200, { 'content-type': ASSET_TYPES[extname(asset.ref).toLowerCase()] || 'application/octet-stream', 'content-length': asset.bytes.length });
        return res.end(asset.bytes);
      }

      if (req.method === 'POST' && url.pathname.startsWith('/v1/tools/')) {
        const name = url.pathname.slice('/v1/tools/'.length);
        const args = await readJsonBody(req);
        if (args === undefined) return sendJson(res, 400, { ok: false, error: 'bad-json', note: `body must be a JSON object of tool args (≤ ${BODY_LIMIT} bytes)` });
        const result = session.invoke(name, args || {});
        return sendJson(res, 200, result);
      }

      if (route === 'POST /v1/task/done') {
        await readJsonBody(req); // drain
        if (session.complete) return sendJson(res, 200, { ok: true, ...session.state() });
        session.closeTask();
        if (session.complete) { complete(); return sendJson(res, 200, { ok: true, ...session.state() }); }
        await session.nextTask();
        return sendJson(res, 200, { ok: true, ...session.state() });
      }

      if (route === 'POST /v1/run/complete') {
        await readJsonBody(req); // drain
        complete();
        return sendJson(res, 200, { ok: true, ...session.state() });
      }

      return sendJson(res, 404, { ok: false, error: 'not-found', note: 'see GET /v1/protocol' });
    } catch (e) {
      log(`request error: ${e?.message || e}`);
      return sendJson(res, 500, { ok: false, error: 'internal', note: String(e?.message || e) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, opts.host || '127.0.0.1', () => {
      const addr = server.address();
      const host = opts.host && opts.host !== '0.0.0.0' ? opts.host : '127.0.0.1';
      const url = `http://${host}:${addr.port}`;
      log(`environment serving ${session.track}/${session.suiteId} at ${url}/v1 (${session.taskCount} task(s))`);
      resolve({
        url,
        port: addr.port,
        token,
        complete,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// --- helpers ---------------------------------------------------------------

function sha256(s) { return createHash('sha256').update(s, 'utf8').digest(); }

/** Constant-time bearer check over digests (no length leak). */
function authorized(req, tokenDigest) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return false;
  return timingSafeEqual(sha256(m[1]), tokenDigest);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

/** Read a JSON object body; {} for empty, undefined for malformed/oversized. */
function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) { req.destroy(); resolve(undefined); }
      else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const v = JSON.parse(raw);
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : undefined);
      } catch { resolve(undefined); }
    });
    req.on('error', () => resolve(undefined));
  });
}
