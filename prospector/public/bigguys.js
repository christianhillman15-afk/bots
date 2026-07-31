/* Big Guys — hand-researched, high-value prospects modeled on the
 * Jonathan Keith / DK3 Construction profile. Data lives in bigguys-data.js
 * (static, curated by research — not the automated scanner). */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '');

const STATUS_LABEL = {
  none: '🚩 NO WEBSITE',
  social_only: 'Social-only',
  broken: 'Broken / parked',
  template: 'Cheap template',
  outdated: 'Outdated site',
};

const state = { search: '', status: '', state: '', field: '' };

function boot() {
  renderProfile();
  populateFilters();
  wire();
  render();
}

function renderProfile() {
  const p = BIG_GUYS.profile;
  $('#targetProfile').innerHTML = `
    <div class="target__head">
      <h2>${esc(p.title)}</h2>
      <span class="target__tag">The target profile</span>
    </div>
    <p class="target__intro">${p.intro}</p>
    <div class="target__grid">
      ${p.traits.map((t) => `
        <div class="target__item"><b>${esc(t.label)}</b><p>${t.text}</p></div>
      `).join('')}
    </div>`;
}

function populateFilters() {
  const states = [...new Set(BIG_GUYS.prospects.map((x) => x.state))].sort();
  for (const s of states) {
    const o = document.createElement('option'); o.value = s; o.textContent = s; $('#bgState').appendChild(o);
  }
  const fields = [...new Set(BIG_GUYS.prospects.map((x) => x.field))].sort();
  for (const f of fields) {
    const o = document.createElement('option'); o.value = f; o.textContent = f; $('#bgField').appendChild(o);
  }
}

function wire() {
  $('#bgSearch').addEventListener('input', (e) => { state.search = e.target.value.toLowerCase(); render(); });
  $('#bgStatus').addEventListener('change', (e) => { state.status = e.target.value; render(); });
  $('#bgState').addEventListener('change', (e) => { state.state = e.target.value; render(); });
  $('#bgField').addEventListener('change', (e) => { state.field = e.target.value; render(); });
  $('#bgExportBtn').addEventListener('click', exportCsv);
}

function filtered() {
  return BIG_GUYS.prospects.filter((x) => {
    if (state.status && x.webStatus !== state.status) return false;
    if (state.state && x.state !== state.state) return false;
    if (state.field && x.field !== state.field) return false;
    if (state.search) {
      const hay = [x.company, x.owner, x.city, x.state, x.field].join(' ').toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });
}

function render() {
  const list = filtered();
  renderStats();
  $('#bgCount').textContent = `${list.length} of ${BIG_GUYS.prospects.length} big guys`;
  $('#bgList').innerHTML = list.map(card).join('') ||
    `<div class="panel muted">Nothing matches those filters.</div>`;
}

function renderStats() {
  const all = BIG_GUYS.prospects;
  const none = all.filter((x) => x.webStatus === 'none').length;
  const social = all.filter((x) => x.webStatus === 'social_only').length;
  const withEmail = all.filter((x) => x.email).length;
  $('#bgStats').innerHTML = `
    <div class="statcard"><div class="statcard__num">${all.length}</div><div class="statcard__label">Big Guys found</div></div>
    <div class="statcard statcard--hot"><div class="statcard__num">${none + social}</div><div class="statcard__label">🚩 No real website (${none} none · ${social} social-only)</div></div>
    <div class="statcard"><div class="statcard__num">${withEmail}</div><div class="statcard__label">With an email address</div></div>
    <div class="statcard statcard--opp"><div class="statcard__num">${[...new Set(all.map((x) => x.state))].length}</div><div class="statcard__label">States covered</div></div>`;
}

function card(x) {
  const status = STATUS_LABEL[x.webStatus] || x.webStatus;
  const tel = String(x.phone || '').replace(/[^\d+]/g, '');
  const contacts = [
    x.phone ? `<a class="bg__contact" href="tel:${esc(tel)}">📞 ${esc(x.phone)}</a>` : '',
    x.email ? `<a class="bg__contact" href="mailto:${esc(x.email)}">✉️ ${esc(x.email)}${x.emailConfidence === 'guessed' ? '<span class="bg__conf">(pattern — verify)</span>' : ''}</a>` : '',
    x.website && safeUrl(x.website) ? `<a class="bg__contact bg__contact--dim" href="${safeUrl(x.website)}" target="_blank" rel="noopener">🌐 their site</a>` : '',
    ...(x.socials || []).map((s) => safeUrl(s) ? `<a class="bg__contact bg__contact--dim" href="${safeUrl(s)}" target="_blank" rel="noopener">${socialIcon(s)}</a>` : ''),
  ].filter(Boolean).join('');
  return `
  <article class="bg ${x.webStatus === 'none' ? 'bg--flag' : ''}">
    <div class="bg__top">
      <span class="bg__name">${esc(x.company)}</span>
      ${x.owner ? `<span class="bg__owner">· ${esc(x.owner)}</span>` : ''}
      <span class="bg__loc">${esc(x.city)}, ${esc(x.state)}</span>
    </div>
    <span class="bg__field">${esc(x.field)}</span>
    <span class="bg__status bg__status--${esc(x.webStatus)}">${esc(status)}</span>
    <p class="bg__why"><b>Why they're a big guy:</b> ${esc(x.whyBig)}</p>
    <p class="bg__problem"><b>Their web problem:</b> ${esc(x.webProblem)}</p>
    <div class="bg__contacts">${contacts}</div>
    ${(x.sources || []).length ? `<div class="bg__sources">sources: ${x.sources.map((s, i) => safeUrl(s) ? `<a href="${safeUrl(s)}" target="_blank" rel="noopener">[${i + 1}]</a>` : '').join('')}</div>` : ''}
  </article>`;
}

function socialIcon(url) {
  if (/instagram/i.test(url)) return '📸 Instagram';
  if (/facebook/i.test(url)) return '👥 Facebook';
  if (/linkedin/i.test(url)) return '💼 LinkedIn';
  if (/houzz/i.test(url)) return '🏠 Houzz';
  if (/youtube/i.test(url)) return '▶️ YouTube';
  return '🔗 profile';
}

function exportCsv() {
  const cols = ['company', 'owner', 'field', 'city', 'state', 'phone', 'email', 'emailConfidence', 'website', 'webStatus', 'socials', 'whyBig', 'webProblem'];
  const cell = (v) => `"${String(Array.isArray(v) ? v.join(' ') : v ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.join(','), ...filtered().map((x) => cols.map((c) => cell(x[c])).join(','))];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'launchmedia-big-guys.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

boot();
