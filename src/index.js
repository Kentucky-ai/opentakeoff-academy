// src/index.js
//
// Public SDK surface for OpenTakeoff Academy. Re-exports the runner, bundle
// signer, scorer, and cert issuer, and adds two conveniences used by the CLI,
// tests, and examples: `validateBundle` (ajv 2020-12) and `sampleTask`
// (a self-contained practice fixture so the harness runs end-to-end offline).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

import { sha256Hex } from './bundle.js';

// --- re-exports -------------------------------------------------------------
export {
  canonicalize, sha256Hex, sha256File, computeBundleHash,
  buildBundle, signBundle, academyCosign, verifyBundle,
  generateKeypairPem, newRunId,
} from './bundle.js';
export { runSuite, loadTasks, SDK_VERSION, BUILTIN_TOOLS, BUILTIN_TOOL_NAMES } from './runner.js';
export { scoreBundle, formatReport, METRIC_DEFAULTS } from './score.js';
export { applyGroundTruth, loadGroundTruthIndex, hasGroundTruth } from './groundtruth.js';
export { issueCert, renderBadgeSvg, verifyCert } from './cert.js';
export { connectMcp, mcpToolsToOpenAI } from './mcp.js';
export { createEnvironment, SvgGeometryBackend, OpenTakeoffBackend } from './environment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(__dirname, '..', 'schema');

// The 2020 build sometimes surfaces the class as a default/interop wrapper.
const Ajv = Ajv2020.default || Ajv2020;

let _validator = null;
/** Lazily compile the run-bundle validator (ajv 2020-12). */
function bundleValidator() {
  if (_validator) return _validator;
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, 'run-bundle.schema.json'), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  _validator = ajv.compile(schema);
  return _validator;
}

/**
 * Validate a run-bundle against schema/run-bundle.schema.json.
 * @param {object} bundle
 * @returns {{valid: boolean, errors: Array}}
 */
export function validateBundle(bundle) {
  const validate = bundleValidator();
  const valid = validate(bundle);
  return { valid: !!valid, errors: validate.errors || [] };
}

/** Load a schema file by name (e.g. 'task', 'cert', 'run-bundle'). */
export function loadSchema(name) {
  const file = name.endsWith('.json') ? name : `${name}.schema.json`;
  return JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8'));
}

/** Generic ajv validation against any Academy schema. */
export function validateAgainst(schemaName, obj) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(loadSchema(schemaName));
  const valid = validate(obj);
  return { valid: !!valid, errors: validate.errors || [] };
}

/**
 * A self-contained practice task (conforms to task.schema.json) used by the
 * example agent and `npm test`. The prompt carries the calibration + room
 * geometry in plain text so a NO-LLM deterministic agent can solve it exactly:
 *   scale bar 200 px = 20 ft  →  10 px/ft
 *   RM-101 rectangle 340 px × 250 px  →  34 ft × 25 ft  →  850 sf
 * @returns {object} task
 */
export function sampleTask() {
  const assetHash = sha256Hex('opentakeoff-academy::sample::rm101-planset::v1');
  return {
    taskVersion: '1.0',
    taskId: 'div9-area-rm101',
    track: 'div9',
    kind: 'area-takeoff',
    suite: { id: 'div9-area-practice-v1', version: '1.0.0' },
    title: 'RM-101 LVT area takeoff (practice sample)',
    prompt: [
      'Measure the finished flooring area of room RM-101 from the plan and report it in square feet (sf).',
      'Calibration: the scale bar spans 200 px = 20 ft.',
      'RM-101 is drawn as a rectangle 340 px wide by 250 px tall.',
      'Set the scale with set_scale, measure the area with measure_area, then emit the LVT area with emit_quantity.',
    ].join(' '),
    planset: {
      assetRef: 'sample/rm101.png',
      assetHash,
      pages: [1],
      knownScale: null,
      units: 'imperial',
    },
    toolset: ['set_scale', 'measure_area', 'emit_quantity'],
    budget: { maxSteps: 12, maxTokens: 100000, maxWallMs: 30000 },
    metric: { type: 'ape', tolerance: 6.0 },
    groundTruth: {
      quantities: [{ item: 'RM-101 LVT area', value: 850, unit: 'sf', roomId: 'RM-101' }],
      validatedBy: 'reference-fixture',
    },
  };
}
