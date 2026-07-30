/* Special Requests — bespoke, criteria-driven lead pulls. Talks to
 * /api/special-requests/*. Each request is a saved profile with its own
 * results, runnable and exportable on its own. */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const usdShort = (n) => {
  n = Number(n) || 0;
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return '$' + n;
};
const safeUrl = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9]/i.test(s) && /\./.test(s.split(/[/?#]/)[0])) return 'https://' + s;
  return '';
};

let META = { homeServiceCategories: [], live: false, regions: [] };
let pollTimer = null;

async function load() {
  const data = await fetch('/api/special-requests').then((r) => r.json());
  META = data;
  $('#srMode').textContent = data.live ? 'LIVE' : 'DEMO';
  $('#srMode').className = 'badge ' + (data.live ? 'badge--live' : 'badge--demo');
  renderSources(data.sources);
  renderCards(data.requests || []);
  buildCategoryChecks(data.homeServiceCategories || []);
  buildCoverageOptions(data.regions || []);
}

/* Coverage dropdown: a single point, or any named multi-metro region preset. */
function buildCoverageOptions(regions) {
  const sel = $('#nrCoverage');
  if (!sel) return;
  // keep the first "Single city" option, append region presets
  sel.querySelectorAll('option[data-region]').forEach((o) => o.remove());
  for (const r of regions) {
    const o = document.createElement('option');
    o.value = 'region:' + r.key; o.dataset.region = r.key;
    o.textContent = `${r.label} · ${r.metroCount} metros`;
    sel.appendChild(o);
  }
}

/* Show which enrichment sources are connected so a new key is visibly "on"
 * after a restart (instead of guessing). */
function renderSources(s) {
  const el = $('#srSources');
  if (!el || !s) return;
  const chip = (ok, label, tipOn, tipOff) =>
    `<span class="sr-src ${ok ? 'sr-src--on' : ''}" title="${esc(ok ? tipOn : tipOff)}">${ok ? '●' : '○'} ${esc(label)}</span>`;
  el.innerHTML =
    'Sources: ' +
    chip(s.places, 'Google Places', 'Live business search is on.', 'No GOOGLE_PLACES_API_KEY — runs use demo data.') +
    chip(s.webSearch, 'Web search (Gemini/Claude)', 'Owner/email/website web lookups are on.', 'Add GEMINI_API_KEY or ANTHROPIC_API_KEY to enable web lookups.') +
    chip(s.googleCse, 'Google Custom Search', 'Custom Search JSON API is connected (100 free queries/day).', 'Add GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX to enable.') +
    chip(s.apollo, 'Apollo.io', 'Owner/decision-maker names + direct contacts are on.', 'Add APOLLO_API_KEY to enable owner + direct-contact lookups.') +
    chip(s.crunchbase, 'Crunchbase', 'Revenue-range enrichment is on.', 'Add CRUNCHBASE_API_KEY to enable (paid plan).') +
    chip(s.edgar, 'SEC EDGAR', 'Public-company revenue lookups are on.', 'Set EDGAR_ENABLED=true for public-company runs (not useful for local trades).') +
    chip(s.twilio, 'Twilio (phone line-type)', 'Mobile-vs-landline detection is on — Daily Phones skips landlines.', 'Add TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN to filter landlines from SMS.');
}

function renderCards(requests) {
  const el = $('#srCards');
  if (!requests.length) {
    el.innerHTML = '<div class="sr-empty">No special requests yet. Click “＋ New request” to create one.</div>';
    return;
  }
  el.innerHTML = requests.map((r) => {
    const c = r.criteria || {};
    const cats = (c.categories || []).join(', ');
    const rev = c.revenueMin || c.revenueMax
      ? `${usdShort(c.revenueMin)}–${usdShort(c.revenueMax)}` : 'any revenue';
    return `<div class="sr-card" data-id="${esc(r.id)}">
      <h3>${esc(r.title)}</h3>
      <div class="sr-card__desc">${esc(r.description || '')}</div>
      <div class="sr-card__meta">
        <span class="sr-chip">${c.metros?.length ? '🗺' : '📍'} ${esc(c.location?.label || '—')}${c.metros?.length ? ` · ${c.metros.length} metros` : ''}</span>
        <span class="sr-chip">🎯 ${esc(cats || '—')}</span>
        <span class="sr-chip">💰 ${esc(rev)}</span>
        <span class="sr-chip">#${esc(String(c.targetCount || '—'))}</span>
      </div>
      <div class="sr-card__foot">
        <span class="sr-card__count">${r.leadCount}<small> / ${esc(String(c.targetCount || '?'))} leads</small></span>
        <span class="sr-status sr-status--${esc(r.status)}">${statusLabel(r)}</span>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.sr-card').forEach((card) =>
    card.addEventListener('click', () => openDetail(card.dataset.id)));
}

function statusLabel(r) {
  if (r.status === 'running') {
    const p = r.progress;
    if (p?.phase === 'enrich') return `Enriching ${p.done}/${p.total}…`;
    if (p?.phase === 'search') return `Searching ${p.done}/${p.total}…`;
    return 'Running…';
  }
  return { new: 'Not run yet', done: 'Complete', error: 'Error' }[r.status] || r.status;
}

async function openDetail(id) {
  const { request: r, running } = await fetch('/api/special-requests/' + id).then((x) => x.json());
  if (!r) return;
  $('#srCards').hidden = true;
  $('.sr-intro').hidden = true;
  const detail = $('#srDetail');
  detail.hidden = false;
  const c = r.criteria || {};
  const isRunning = running || r.status === 'running';

  const stats = r.runStats ? `<div class="sr-runstats">
    <div><b>${r.runStats.kept}</b>leads kept</div>
    <div><b>${r.runStats.withEmail}</b>with email</div>
    <div><b>${r.runStats.withOwner}</b>with owner</div>
    <div><b>${r.runStats.withWebsite}</b>with website</div>
    <div><b>${r.runStats.gathered}</b>scanned</div>
    ${r.runStats.searchedMetros ? `<div><b>${r.runStats.searchedMetros}</b>metros swept</div>` : ''}
  </div>` : '';

  const prog = isRunning ? `<div class="sr-progress"><span class="spinner"></span>
    <span>${esc(statusLabel({ status: 'running', progress: r.progress }))} — this can take several minutes for ${esc(String(c.targetCount))} leads.</span></div>` : '';

  detail.innerHTML = `
    <button class="sr-back">← All requests</button>
    <div class="sr-detail__head">
      <div>
        <h2>${esc(r.title)}</h2>
        <div class="muted">${esc(r.description || '')}</div>
        <div class="sr-card__meta" style="margin-top:10px">
          <span class="sr-chip">${c.metros?.length ? '🗺' : '📍'} ${esc(c.location?.label || '—')} · ${c.metros?.length ? esc(String(c.metros.length)) + ' metros' : esc(String(c.location?.radiusMi || '?')) + ' mi'}</span>
          <span class="sr-chip">🎯 ${esc((c.categories || []).join(', '))}</span>
          <span class="sr-chip">💰 ${usdShort(c.revenueMin)}–${usdShort(c.revenueMax)} (est.)</span>
          <span class="sr-chip">Target ${esc(String(c.targetCount))}</span>
        </div>
      </div>
      <div class="sr-detail__actions">
        <button class="btn btn--red" id="srRun" ${isRunning ? 'disabled' : ''}>${r.leads?.length ? '↻ Re-run' : '▶ Run search'}</button>
        <a class="btn btn--ghost" href="/api/special-requests/${esc(r.id)}/export.csv">⬇ Export CSV</a>
        <button class="btn btn--ghost" id="srDelete">🗑 Delete</button>
      </div>
    </div>
    ${prog}${stats}
    ${renderTable(r.leads || [])}`;

  detail.querySelector('.sr-back').addEventListener('click', closeDetail);
  detail.querySelector('#srRun').addEventListener('click', () => runRequest(r.id));
  detail.querySelector('#srDelete').addEventListener('click', () => deleteRequest(r.id, r.title));

  if (isRunning) pollDetail(id);
}

function renderTable(leads) {
  if (!leads.length) {
    return '<div class="sr-empty">No results yet. Hit <b>Run search</b> to pull leads for this request.</div>';
  }
  const rows = leads.map((l) => {
    const site = safeUrl(l.website);
    const cb = l.crunchbase?.revenueRange ? `<span class="sr-badge sr-badge--cb" title="Crunchbase estimated range">CB ${esc(l.crunchbase.revenueRange)}</span>` : '';
    const ed = l.edgar?.revenueUsd ? `<span class="sr-badge sr-badge--edgar" title="SEC EDGAR reported revenue">SEC ${usdShort(l.edgar.revenueUsd)}</span>` : '';
    return `<tr>
      <td>${esc(l.company)}</td>
      <td>${esc(l.owner) || '<span class="muted">—</span>'}</td>
      <td>${l.email ? esc(l.email) + (l.emailStatus === 'risky' ? ' <span class="muted">(risky)</span>' : '') : '<span class="muted">—</span>'}</td>
      <td>${esc(l.phone) || '<span class="muted">—</span>'}</td>
      <td>${esc(l.address) || '<span class="muted">—</span>'}</td>
      <td>${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(l.website)}</a>` : '<span class="muted">none</span>'}</td>
      <td class="sr-rev">${usdShort(l.estRevenueUsd)}${cb}${ed}</td>
    </tr>`;
  }).join('');
  return `<div class="sr-table-wrap"><table class="sr-table">
    <thead><tr><th>Company</th><th>Owner</th><th>Email</th><th>Phone</th><th>Address</th><th>Website</th><th>Est. revenue</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function closeDetail() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  $('#srDetail').hidden = true;
  $('#srCards').hidden = false;
  $('.sr-intro').hidden = false;
  load();
}

async function runRequest(id) {
  let res = await fetch('/api/special-requests/' + id + '/run', { method: 'POST' });
  // 423 = Emergency Stop is engaged. The Resume button lives on the Prospector
  // tab, so offer to release + retry right here instead of dead-ending.
  if (res.status === 423) {
    if (!confirm('The Emergency Stop is ON, so scanning and paid API calls are blocked. Resume the prospector and run this request now?')) return;
    await fetch('/api/emergency-stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stopped: false }) });
    res = await fetch('/api/special-requests/' + id + '/run', { method: 'POST' });
  }
  if (!res.ok) { alert((await res.json().catch(() => ({}))).error || 'Could not start the run.'); return; }
  openDetail(id); // re-render into running state + start polling
}

function pollDetail(id) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    const { request: r, running } = await fetch('/api/special-requests/' + id).then((x) => x.json());
    if (!r) return;
    if (running || r.status === 'running') {
      // update just the progress line + count without losing scroll
      const prog = $('#srDetail .sr-progress span:last-child');
      if (prog) prog.textContent = `${statusLabel({ status: 'running', progress: r.progress })} — this can take several minutes.`;
      pollDetail(id);
    } else {
      openDetail(id); // finished — full re-render with results
    }
  }, 2500);
}

async function deleteRequest(id, title) {
  if (!confirm(`Delete “${title}” and its results? This can't be undone.`)) return;
  const res = await fetch('/api/special-requests/' + id, { method: 'DELETE' });
  if (!res.ok) { alert((await res.json()).error || 'Could not delete.'); return; }
  closeDetail();
}

/* ── new-request modal ─────────────────────────────────────────────────── */
function buildCategoryChecks(cats) {
  const preset = new Set(['plumbing', 'hvac', 'roofing', 'remodeling']);
  $('#nrCats').innerHTML = cats.map((c) =>
    `<label><input type="checkbox" value="${esc(c.key)}" ${preset.has(c.key) ? 'checked' : ''}/> ${esc(c.label)}</label>`
  ).join('');
}
function openModal() { $('#srModal').hidden = false; }
function closeModal() { $('#srModal').hidden = true; }

/** Selected region key ("" when the coverage is a single point). */
function selectedRegion() {
  const v = $('#nrCoverage')?.value || 'point';
  return v.startsWith('region:') ? v.slice('region:'.length) : '';
}

/** Show/hide the lat/lng/radius fields depending on coverage mode. */
function onCoverageChange() {
  const region = selectedRegion();
  $('#nrPointFields').hidden = !!region;
  const note = $('#nrRegionNote');
  const meta = (META.regions || []).find((r) => r.key === region);
  if (region && meta) {
    note.hidden = false;
    note.textContent = `Sweeps all ${meta.metroCount} metros across ${meta.states.length} states (${meta.states.join(', ')}). A live run makes many searches — the daily Places cap still applies.`;
  } else {
    note.hidden = true;
  }
}

async function createRequest() {
  const cats = [...document.querySelectorAll('#nrCats input:checked')].map((i) => i.value);
  if (!cats.length) { alert('Pick at least one category.'); return; }
  const region = selectedRegion();
  const body = {
    title: $('#nrTitle').value || 'Untitled request',
    description: '',
    categories: cats,
    revenueMin: Number($('#nrRevMin').value) || 0,
    revenueMax: Number($('#nrRevMax').value) || 0,
    targetCount: Number($('#nrCount').value) || 50,
  };
  if (region) {
    body.region = region; // engine expands this into the region's metro list
  } else {
    const lat = parseFloat($('#nrLat').value), lng = parseFloat($('#nrLng').value);
    if (Number.isNaN(lat) || Number.isNaN(lng)) { alert('Enter the location latitude and longitude (from Google Maps).'); return; }
    body.location = { label: $('#nrLoc').value || 'Custom area', lat, lng, radiusMi: Number($('#nrRadius').value) || 20 };
  }
  const res = await fetch('/api/special-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { alert((await res.json()).error || 'Could not create the request.'); return; }
  closeModal();
  load();
}

// Guard every binding with ?. so a single missing element (e.g. a stale cached
// HTML after a deploy) can never throw and halt the script — that would leave
// the page blank and unable to refresh. The page still loads and works.
$('#srNewBtn')?.addEventListener('click', openModal);
$('#nrCoverage')?.addEventListener('change', onCoverageChange);
$('#nrCancel')?.addEventListener('click', closeModal);
$('#nrCreate')?.addEventListener('click', createRequest);
$('#srModal')?.addEventListener('click', (e) => { if (e.target.id === 'srModal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#srModal')?.hidden) closeModal(); });

load().catch((err) => console.error('special-requests load failed:', err));
