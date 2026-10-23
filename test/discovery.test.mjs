import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SOURCE } from '../site/lab-model.js';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('site/agent-start.json'));
test('agent download is the exact real drawing accepted by the lab', () => {
 const pdf = readFileSync(new URL('../site/' + SOURCE.pdf, import.meta.url));
 assert.equal(createHash('sha256').update(pdf).digest('hex'), manifest.challenge.sha256);
 assert.equal(manifest.challenge.sha256, SOURCE.sha256);
 assert.deepEqual(manifest.challenge.sheets, SOURCE.sheets);
 assert.equal(new URL(manifest.challenge.pdf).pathname, '/' + SOURCE.pdf);
});
test('manifest local destinations exist and do not advertise a submission API', () => {
 for (const value of [manifest.url, manifest.challenge.pdf, manifest.challenge.sourceRecord, ...Object.values(manifest.links)]) {
  const url = new URL(value);
  if (url.host === 'union.kentucky-ai.com') assert.ok(existsSync(new URL('../site' + url.pathname, import.meta.url)), value);
 }
 assert.equal(manifest.availability.publicSubmissionApi, 'not available');
});
test('crawler HTML exposes real evidence and its limitations without executing JS', () => {
 const html = read('site/index.html');
 const data = JSON.parse(read('site/leaderboard.json'));
 assert.equal((html.match(/<tbody id="results-body">([\s\S]*?)<\/tbody>/)[1].match(/<tr>/g) || []).length, data.rows.length);
 assert.ok(html.includes('Self-reported'));
 assert.ok(html.includes('ONE REAL RUN.'));
 assert.ok(!html.includes('Loading published results'));
 assert.ok(html.includes('id="certified-count">0</b>'));
});
