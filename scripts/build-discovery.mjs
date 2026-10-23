// Materialize published data into HTML so discovery never requires JavaScript.
import { readFileSync, writeFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const data = JSON.parse(read('site/leaderboard.json'));
if (!Array.isArray(data.rows)) throw new Error('Published leaderboard rows missing');
const reference = row => /^(reference|human)\//.test(row.modelId || '');
const rows = data.rows.map(r => {
  const evidence = r.modelId === 'reference/opentakeoff-oneclick' ? '<a href="inspect.html">Inspect run →</a>' : r.certId ? `<a href="cert.html?id=${encodeURIComponent(r.certId)}">Verify certificate →</a>` : 'Bundle not linked';
  return `<tr><td><b>${esc(r.contestant || r.modelId)}</b><small><span class="pill ${reference(r) ? 'reference' : ''}">${reference(r) ? 'Reference run' : 'Independent agent'}</span></small></td><td>${esc(data.suites?.[r.track]?.title || r.track)}<small>${esc((r.competency || '').replaceAll('-', ' '))}</small></td><td><b>${Number.isFinite(r.medianApe) ? r.medianApe.toFixed(2) + '%' : 'Not scored'}</b><small>${r.attestation === 'certified' ? 'Certified' : 'Self-reported'}</small></td><td>${esc(r.nRanked ?? '—')}<small>as reported in source data</small></td><td>${evidence}</td></tr>`;
}).join('') || '<tr><td colspan="5">No published results yet.</td></tr>';
let html = read('site/index.html');
function replace(pattern, value) {
  if (!pattern.test(html)) throw new Error('Missing homepage target: ' + pattern);
  html = html.replace(pattern, () => value);
}
replace(/<tbody id="results-body">[\s\S]*?<\/tbody>/, `<tbody id="results-body">${rows}</tbody>`);
for (const [id, count] of [['published-count', data.rows.length], ['independent-count', data.rows.filter(r => !reference(r)).length], ['certified-count', data.rows.filter(r => r.attestation === 'certified').length]]) {
  replace(new RegExp(`<b id="${id}">[^<]*</b>`), `<b id="${id}">${count}</b>`);
}
replace(/<p class="table-note" id="board-disclaimer">[\s\S]*?<\/p>/, `<p class="table-note" id="board-disclaimer">${esc(data.disclaimer || 'Results reflect published source data. Inspect each run before drawing conclusions.')}</p>`);
replace(/<p class="table-note" id="result-count" role="status">[\s\S]*?<\/p>/, `<p class="table-note" id="result-count" role="status">${data.rows.length} published results. Snapshot included in this page; filters activate when current data loads.</p>`);
const target = new URL('../site/index.html', import.meta.url);
if (process.argv.includes('--check')) {
  if (html !== read('site/index.html')) throw new Error('Stale discovery snapshot; run npm run build:discovery');
  console.log(`Discovery snapshot matches ${data.rows.length} published rows; independent=${data.rows.filter(r => !reference(r)).length}, certified=${data.rows.filter(r => r.attestation === 'certified').length}`);
} else { writeFileSync(target, html); console.log('Published discovery snapshot generated'); }
