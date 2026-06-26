const $ = (sel) => document.querySelector(sel);
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Only allow http(s) URLs into href attributes — blocks javascript:/data: schemes.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '');

let META = {};
const state = { tier: '', presence: '', state: '', category: '', sort: 'score', search: '' };

async function boot() {
  META = await fetch('/api/meta').then((r) => r.json());
  const badge = $('#modeBadge');
  if (META.live) { badge.textContent = 'LIVE · Google Places'; badge.className = 'badge badge--live'; }
  else { badge.textContent = 'DEMO MODE'; badge.className = 'badge badge--demo'; $('#scanHint').textContent = 'Demo mode: realistic sample data. Add a Places API key in .env for real businesses.'; }

  // populate category filter (value = key, which matches business.category)
  for (const c of META.categories) {
    const o = document.createElement('option'); o.value = c.key; o.textContent = c.label; $('#fCategory').appendChild(o);
  }
  wireFilters();
  $('#scanBtn').addEventListener('click', runScan);
  $('#exportBtn').addEventListener('click', () => { window.location = '/api/export.csv?' + qs(); });
  await refresh();
}

function wireFilters() {
  const map = { fSearch: 'search', fTier: 'tier', fPresence: 'presence', fState: 'state', fCategory: 'category', fSort: 'sort' };
  for (const [id, key] of Object.entries(map)) {
    const el = $('#' + id);
    el.addEventListener('input', () => { state[key] = el.value; refresh(); });
  }
}

function qs() {
  const p = new URLSearchParams();
  if (state.state) p.set('state', state.state);
  if (state.presence) p.set('presence', state.presence);
  if (state.category) p.set('category', state.category);
  if (state.search) p.set('search', state.search);
  p.set('sort', state.sort);
  return p.toString();
}

async function refresh() {
  const [stats, data] = await Promise.all([
    fetch('/api/stats').then((r) => r.json()),
    fetch('/api/leads?' + qs()).then((r) => r.json()),
  ]);
  renderStats(stats);
  // populate state filter from facets once
  if (data.facets?.state && $('#fState').options.length <= 1) {
    for (const st of Object.keys(data.facets.state).sort()) {
      const o = document.createElement('option'); o.value = st; o.textContent = st; $('#fState').appendChild(o);
    }
    if (state.state) $('#fState').value = state.state;
  }
  let leads = data.leads;
  if (state.tier) leads = leads.filter((l) => l.score?.tier === state.tier);
  $('#resultCount').textContent = `${leads.length} lead${leads.length === 1 ? '' : 's'}`;
  renderLeads(leads);
}

function renderStats(s) {
  const cards = [
    { num: s.total, label: 'Total leads', cls: '' },
    { num: s.byTier.hot, label: '🔥 Hot leads', cls: 'statcard--hot' },
    { num: s.noWebsite, label: 'No real website', cls: '' },
    { num: usd(s.opportunityUsd), label: 'Est. monthly opportunity', cls: 'statcard--opp' },
  ];
  $('#stats').innerHTML = cards.map((c) =>
    `<div class="statcard ${c.cls}"><div class="statcard__num">${esc(c.num)}</div><div class="statcard__label">${c.label}</div></div>`
  ).join('');
}

function renderLeads(leads) {
  const root = $('#leads');
  if (!leads.length) { root.innerHTML = '<div class="empty">No leads match. Run a scan or loosen the filters.</div>'; return; }
  root.innerHTML = leads.map(leadCard).join('');
  root.querySelectorAll('.lead__row').forEach((row) => {
    row.addEventListener('click', (e) => { if (e.target.closest('a,button,select')) return; row.parentElement.classList.toggle('open'); });
  });
  root.querySelectorAll('.copybtn').forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard.writeText(b.dataset.pitch).then(() => { b.textContent = '✓ Copied'; setTimeout(() => (b.textContent = '⧉ Copy pitch'), 1500); });
  }));
  root.querySelectorAll('.statussel').forEach((sel) => sel.addEventListener('change', () => {
    fetch('/api/leads/' + encodeURIComponent(sel.dataset.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: sel.value }),
    });
  }));
}

function leadCard(l) {
  const b = l.business, s = l.score, a = l.audit;
  const tier = s.tier;
  const problems = (a.problems || []).map((p) =>
    `<div class="problem"><span class="problem__sev sev${p.severity}"></span><div><b>${esc(p.label)}</b><span>${esc(p.detail || '')}</span></div></div>`
  ).join('');
  const statusOpts = ['new', 'contacted', 'interested', 'won', 'dead']
    .map((o) => `<option ${((l.status || 'new') === o) ? 'selected' : ''}>${o}</option>`).join('');
  const siteHref = safeUrl(b.website);
  const site = b.website
    ? (siteHref
        ? `<a href="${siteHref}" target="_blank" rel="noopener">${esc(b.website)}</a>`
        : `<span>${esc(b.website)}</span>`)
    : '<span class="muted">none</span>';
  const mapsHref = safeUrl(b.googleMapsUri);
  return `
  <div class="lead">
    <div class="lead__row">
      <div class="score score--${tier}"><span class="score__val">${s.value}</span><span class="score__emoji">${s.emoji}</span></div>
      <div>
        <div class="lead__name">${esc(b.name)}</div>
        <div class="lead__meta">
          <span class="tag tag--${l.presence}">${esc(a.headline)}</span>
          <span>${esc(b.categoryLabel || b.category || '')}</span>
          <span>· ${esc(b.city || '')}, ${esc(b.state || '')}</span>
        </div>
      </div>
      <div class="lead__revs hide-sm"><span class="n">${b.reviewCount ?? 0}</span> ★${b.rating ? ' ' + b.rating : ''}<div class="muted" style="font-size:11px">reviews</div></div>
      <div class="lead__opp hide-sm"><span class="n">${usd(s.opportunityUsd)}</span><div class="l">est. lost /mo</div></div>
      <div class="chevron">›</div>
    </div>
    <div class="lead__detail">
      <div class="detail__grid">
        <div>
          <h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px">Why this is a lead</h4>
          <div class="problems">${problems}</div>
          ${(s.reasons || []).length ? `<ul style="margin:14px 0 0 16px;color:var(--muted);font-size:13px;line-height:1.6">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        </div>
        <div class="detail__side">
          <h4>Contact</h4>
          <div class="kv">📞 ${esc(b.phone || '—')}</div>
          <div class="kv">🌐 ${site}</div>
          <div class="kv">📍 ${esc(b.address || '')}</div>
          ${mapsHref ? `<div class="kv"><a href="${mapsHref}" target="_blank" rel="noopener">View on Google Maps ↗</a></div>` : ''}
          <h4 style="margin-top:14px">Score breakdown</h4>
          <div class="kv">Problem severity: <b>${s.breakdown.presence}</b> · Affordability: <b>${s.breakdown.affordability}</b> · Market: <b>${s.breakdown.market}</b></div>
          <h4 style="margin-top:14px">Suggested opener</h4>
          <div class="pitch">${esc(s.pitch)}</div>
        </div>
      </div>
      <div class="detail__actions">
        <button class="btn btn--ghost copybtn" data-pitch="${esc(s.pitch)}">⧉ Copy pitch</button>
        ${b.website ? `<a class="linkbtn" href="https://pagespeed.web.dev/report?url=${encodeURIComponent(b.website)}" target="_blank" rel="noopener">Run PageSpeed ↗</a>` : ''}
        ${l.compliance?.strictOutreachState ? '<span class="strict">⚠ Strict call/SMS state — email or manual landline only</span>' : ''}
        <select class="statussel" data-id="${esc(l.id)}">${statusOpts}</select>
      </div>
    </div>
  </div>`;
}

async function runScan() {
  const btn = $('#scanBtn'); const box = $('#scanStatus');
  btn.disabled = true;
  box.hidden = false; box.className = 'scanstatus running';
  box.innerHTML = '<span class="spinner"></span>Hunting… searching Google & auditing websites. This can take a minute.';
  try {
    const body = {
      cities: $('#scanCities').value,
      categories: $('#scanCats').value === 'all' ? 'all' : 'default',
      max: $('#scanMax').value,
      full: $('#scanFull').checked,
    };
    const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Scan failed');
    const s = data.stats;
    box.className = 'scanstatus done';
    box.textContent = `✓ Scanned ${s.found} businesses → ${s.leads} leads (${s.newLeads} new). ${s.byTier.hot} 🔥 hot, ${s.byTier.warm} 🟠 warm.`;
    await refresh();
  } catch (e) {
    box.className = 'scanstatus error'; box.textContent = '✗ ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

boot();
