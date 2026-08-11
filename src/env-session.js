// src/env-session.js
//
// A PROCTORED SUITE SESSION: the inversion of src/runner.js. The runner drives
// the entrant's model; a session lets the ENTRANT'S OWN HARNESS drive the
// Academy's environment — over the HTTP surface in src/env-serve.js — while the
// Academy records the complete provenance trace on ITS side. That server-side
// trace is what makes a bring-your-own-harness run certifiable: the entrant
// never writes the bundle, they only operate the tools.
//
// One session = one suite run: it walks the suite's tasks in order, builds a
// fresh environment per task (same backends as the runner: SVG geometry, or the
// real OpenTakeoff engine for the certified path), enforces each task's
// step/wall budgets, collects emit_quantity calls into the answer block, and
// finalizes a schema-valid run-bundle — Academy-co-signed when a key is given.
//
// The session knows nothing about HTTP or Docker; env-serve.js and container.js
// compose it.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildBundle, academyCosign, signBundle, sha256File, newRunId } from './bundle.js';
import { createEnvironment } from './environment.js';
import { createOpenTakeoffBackend } from './ot-backend.js';
import { BUILTIN_TOOL_NAMES } from './runner.js';

const BUILTIN_SET = new Set(BUILTIN_TOOL_NAMES);

/**
 * Create a proctored suite session.
 * @param {object} opts
 * @param {string} opts.track
 * @param {string} opts.suite - suite folder name ('practice' | 'ranked' | id)
 * @param {Array<object>} opts.tasks - tasks loaded via loadTasks() (carry __dir)
 * @param {object} [opts.contestant] - { name, modelId, harness, adapter, contact }
 * @param {'proctored'|'self_reported'} [opts.attestationMode='proctored']
 * @param {object} [opts.proctor] - { proctorId, deliveredSuiteVersion, endpointFingerprint, ... }
 * @param {'svg'|'opentakeoff'} [opts.engine='svg'] - environment backend
 * @param {string} [opts.mcpDir] - opentakeoff-mcp dir override (engine path)
 * @param {string} [opts.now] - ISO start timestamp (informational)
 * @param {string} [opts.academyKeyPem] - co-sign the finalized bundle
 * @param {string} [opts.privateKeyPem] - entrant key (self-hosted serve mode)
 * @param {function} [opts.log]
 */
export function createSession(opts) {
  if (!Array.isArray(opts.tasks) || opts.tasks.length === 0) throw new Error('session needs a non-empty task list');
  const log = opts.log || (() => {});

  const s = {
    runId: newRunId(),
    taskIndex: -1,       // advanced by nextTask()
    current: null,       // per-task state (see startTask)
    results: [],         // finished bundle task entries
    finalized: null,     // the finalized bundle, once complete
  };

  /** Strip everything an entrant must never see from a task file. */
  function publicTask(task) {
    const { groundTruth, __dir, ...rest } = task;
    return structuredClone(rest);
  }

  /** Provenance anchor: resolve + hash the planset asset (mirrors the runner). */
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
    return { assetHash: declared, verified: null, path: null };
  }

  async function startTask(task) {
    const t0 = performance.now();
    const trace = [];
    let seq = 0;
    const push = (entry) => trace.push({ seq: seq++, tOffsetMs: Math.max(0, Math.round(performance.now() - t0)), ...entry });

    const anchor = resolveAsset(task);
    push({
      type: 'tool_result',
      tool: 'planset',
      args: { assetRef: task.planset.assetRef },
      result: { assetRef: task.planset.assetRef, assetHash: anchor.assetHash, declaredHash: task.planset.assetHash, verified: anchor.verified },
    });

    let backend = null;
    if (opts.engine === 'opentakeoff') {
      if (!anchor.path) throw new Error(`opentakeoff engine requires the planset asset on disk; ${task.taskId} has none resolvable`);
      log(`[${task.taskId}] building OpenTakeoff engine backend on ${anchor.path} …`);
      backend = await createOpenTakeoffBackend({ plansetPath: anchor.path, mcpDir: opts.mcpDir, rooms: task.planset?.rooms, log });
      push({
        type: 'tool_result',
        tool: 'engine',
        args: { engine: 'opentakeoff-mcp', sheet: backend.engine.sheet },
        result: { engine: 'opentakeoff-mcp', upp: backend.engine.upp, scaleLabel: backend.engine.scaleLabel, roomsResolved: backend.getFeatures().rooms.length, unresolved: backend.unresolvedRooms() },
      });
    }
    const env = createEnvironment({
      task,
      assetPath: anchor.path,
      assetContent: backend ? null : (anchor.path ? readFileSync(anchor.path, 'utf8') : null),
      ...(backend ? { backend } : {}),
    });

    s.current = {
      task, env, anchor, trace, push, t0,
      answer: { quantities: [] },
      toolCalls: 0,
      allowed: new Set((task.toolset || BUILTIN_TOOL_NAMES).filter((n) => BUILTIN_SET.has(n))),
      maxSteps: task.budget?.maxSteps ?? 60,
      maxWallMs: task.budget?.maxWallMs ?? 180000,
    };
    log(`task ${task.taskId} started (${s.current.allowed.size} tool(s), ${s.current.maxSteps} steps / ${s.current.maxWallMs} ms)`);
  }

  const session = {
    runId: s.runId,
    track: opts.track,
    suiteId: opts.tasks[0]?.suite?.id || opts.suite,

    /** How many tasks the suite carries. */
    taskCount: opts.tasks.length,

    /** True once every task is closed and the bundle is built. */
    get complete() { return !!s.finalized; },
    get bundle() { return s.finalized; },

    /**
     * The entrant-facing session state: the current task (sanitized — no
     * ground truth, ever) plus progress. Null task once the suite completes.
     */
    state() {
      if (s.finalized) return { suiteComplete: true, runId: s.runId, taskCount: opts.tasks.length, tasksDone: s.results.length };
      if (!s.current) return { suiteComplete: false, runId: s.runId, taskCount: opts.tasks.length, tasksDone: s.results.length, task: null, note: 'call nextTask()' };
      const c = s.current;
      return {
        suiteComplete: false,
        runId: s.runId,
        taskCount: opts.tasks.length,
        tasksDone: s.results.length,
        task: publicTask(c.task),
        budgetRemaining: {
          steps: Math.max(0, c.maxSteps - c.toolCalls),
          wallMs: Math.max(0, Math.round(c.maxWallMs - (performance.now() - c.t0))),
        },
        quantitiesEmitted: c.answer.quantities.length,
      };
    },

    /** Advance to the next task (also used for the first). No-op when done. */
    async nextTask() {
      if (s.finalized) return session.state();
      if (s.current) session.closeTask();               // implicit close
      if (s.finalized) return session.state();          // closeTask may finalize
      s.taskIndex++;
      await startTask(opts.tasks[s.taskIndex]);
      return session.state();
    },

    /** The current task's planset asset bytes (for GET /v1/planset). */
    plansetAsset() {
      const c = s.current;
      if (!c || !c.anchor.path) return null;
      return { path: c.anchor.path, ref: c.task.planset.assetRef, bytes: readFileSync(c.anchor.path) };
    },

    /**
     * Invoke one built-in tool for the current task, recording the call and
     * its REAL result in the server-side trace. Budget violations and
     * disallowed tools are recorded too — a refusal is provenance.
     */
    invoke(name, args = {}) {
      const c = s.current;
      if (!c) return { ok: false, error: s.finalized ? 'suite-complete' : 'no-active-task' };

      if (performance.now() - c.t0 > c.maxWallMs) {
        const r = { ok: false, error: 'wall-budget-exceeded' };
        c.push({ type: 'error', tool: name, result: r });
        return r;
      }
      if (c.toolCalls >= c.maxSteps) {
        const r = { ok: false, error: 'step-budget-exceeded' };
        c.push({ type: 'error', tool: name, result: r });
        return r;
      }
      if (!c.allowed.has(name)) {
        const r = { ok: false, error: 'tool-not-allowed', note: `this task allows: ${[...c.allowed].join(', ')}` };
        c.push({ type: 'error', tool: name, args, result: r });
        return r;
      }

      c.toolCalls++;
      c.push({ type: 'tool_call', tool: name, args });
      const result = c.env.invoke(name, args);
      if (name === 'emit_quantity' && result?.ok && result.recorded) c.answer.quantities.push(result.recorded);
      c.push({ type: 'tool_result', tool: name, result });
      return result;
    },

    /** Close the current task into the results; finalize after the last one. */
    closeTask() {
      const c = s.current;
      if (!c) return session.state();
      const wallMs = Math.round(performance.now() - c.t0);
      s.results.push({
        taskId: c.task.taskId,
        answer: c.answer,
        trace: c.trace,
        telemetry: { steps: c.toolCalls, wallMs, toolCalls: c.toolCalls },
      });
      log(`task ${c.task.taskId} closed — ${c.answer.quantities.length} quantit(ies), ${c.toolCalls} tool call(s), ${wallMs} ms`);
      s.current = null;
      if (s.results.length === opts.tasks.length) session.finalize();
      return session.state();
    },

    /** Build (and sign) the run-bundle. Idempotent; partial suites finalize too. */
    finalize() {
      if (s.finalized) return s.finalized;
      if (s.current) session.closeTask();
      if (s.finalized) return s.finalized;   // closeTask finalizes full suites

      const total = (f) => s.results.reduce((a, t) => a + (t.telemetry[f] || 0), 0);
      const firstTask = opts.tasks[0];
      const mode = firstTask?.suite?.mode || (opts.suite === 'ranked' ? 'ranked' : 'practice');
      const attestationMode = opts.attestationMode || 'proctored';

      const parts = {
        runId: s.runId,
        track: opts.track,
        suite: { id: firstTask?.suite?.id || opts.suite, version: firstTask?.suite?.version || '0', mode },
        contestant: pruneUndefined({
          name: opts.contestant?.name || 'anonymous',
          modelId: opts.contestant?.modelId || 'undisclosed',
          harness: opts.contestant?.harness,
          adapter: opts.contestant?.adapter || 'remote-env',
          contact: opts.contestant?.contact,
        }),
        attestation: attestationMode === 'proctored'
          ? { mode: 'proctored', proctor: pruneUndefined({ proctorId: 'opentakeoff-academy-env', deliveredSuiteVersion: firstTask?.suite?.version, ...opts.proctor }) }
          : { mode: 'self_reported' },
        tasks: s.results,
        telemetry: pruneUndefined({
          sdkVersion: '1.0.0',
          totalSteps: total('steps'),
          totalWallMs: total('wallMs'),
          startedAt: opts.now,
        }),
      };

      let bundle = buildBundle(parts);
      if (opts.privateKeyPem) bundle = signBundle(bundle, opts.privateKeyPem);
      if (opts.academyKeyPem) bundle = academyCosign(bundle, opts.academyKeyPem);
      s.finalized = bundle;
      log(`run finalized — ${s.results.length}/${opts.tasks.length} task(s), bundleHash ${bundle.integrity.bundleHash.slice(0, 12)}…`);
      return bundle;
    },
  };

  return session;
}

function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}
