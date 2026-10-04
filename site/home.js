(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isReference = row => /^(reference|human)\//.test(row.modelId || '');
  let rows = [], suites = {};
  function render() {
    const query = $('agent-search').value.trim().toLowerCase();
    const track = $('track-filter').value, type = $('entry-filter').value;
    const visible = rows.filter(r => (!track || r.track === track) &&
      (!query || [r.contestant, r.modelId, r.competency].join(' ').toLowerCase().includes(query)) &&
      (!type || (type === 'reference' ? isReference(r) : type === 'independent' ? !isReference(r) : r.attestation === 'certified')));
    $('results-body').innerHTML = visible.length ? visible.map(r => {
      const reference = isReference(r);
      // Known bundle mapping only. Never invent an inspectable bundle from a name.
      const evidence = r.modelId === 'reference/opentakeoff-oneclick'
        ? '<a href="inspect.html">Inspect run →</a>'
        : r.certId ? `<a href="cert.html?id=${encodeURIComponent(r.certId)}">Verify certificate →</a>` : 'Bundle not linked';
      const score = Number.isFinite(r.medianApe) ? r.medianApe.toFixed(2) + '%' : 'Not scored';
      return `<tr><td><b>${esc(r.contestant || r.modelId)}</b><small><span class="pill ${reference ? 'reference' : ''}">${reference ? 'Reference run' : 'Independent agent'}</span></small></td><td>${esc(suites[r.track]?.title || r.track)}<small>${esc((r.competency || '').replaceAll('-', ' '))}</small></td><td><b>${score}</b><small>${r.attestation === 'certified' ? 'Certified' : 'Self-reported'}</small></td><td>${esc(r.nRanked ?? '—')}<small>as reported in source data</small></td><td>${evidence}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-state">No published results match these filters. Reset the filters or <a href="self-test.html">prepare your takeoff evidence</a>.</td></tr>';
    $('result-count').textContent = `${visible.length} of ${rows.length} published results shown. Lab drafts stay on your device.`;
  }
  for (const id of ['agent-search','track-filter','entry-filter']) $(id).addEventListener('input', render);
  $('reset-filters').addEventListener('click', () => {
    $('agent-search').value = ''; $('track-filter').value = ''; $('entry-filter').value = ''; render();
    history.replaceState(null, '', location.pathname + '#crew');
  });
  async function load() {
    try {
      const response = await fetch('leaderboard.json', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Leaderboard unavailable');
      const data = await response.json();
      if (!Array.isArray(data.rows)) throw new Error('Invalid data');
      rows = data.rows; suites = data.suites || {};
      $('published-count').textContent = rows.length;
      $('independent-count').textContent = rows.filter(r => !isReference(r)).length;
      $('certified-count').textContent = rows.filter(r => r.attestation === 'certified').length;
      const requested = new URLSearchParams(location.search).get('track');
      const tracks = [...new Set([...Object.keys(suites), ...rows.map(r => r.track), ...(requested ? [requested] : [])])];
      for (const track of tracks) $('track-filter').add(new Option(suites[track]?.title || track, track));
      if (requested) $('track-filter').value = requested;
      $('board-disclaimer').textContent = data.disclaimer || 'Results reflect the published source data. Inspect each run before drawing conclusions.';
      render();
    } catch {
      $('results-body').innerHTML = '<tr><td colspan="5" class="empty-state">Published results could not be loaded. <button class="button secondary" id="retry-data" type="button">Try again</button></td></tr>';
      $('board-disclaimer').textContent = 'Data is unavailable. No sample scores are substituted. The real-plan lab is still available.';
      $('retry-data').addEventListener('click', load);
    }
  }
  load();
})();
