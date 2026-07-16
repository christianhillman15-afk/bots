const $ = (sel) => document.querySelector(sel);
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Turn a stored website into a safe, clickable href.
// - already-absolute http(s) URLs pass through
// - a bare domain ("shop.com", "www.shop.com/contact") gets https:// added so it
//   actually opens instead of rendering as dead text
// - anything with a non-http scheme (javascript:, data:, mailto:, ftp:) is rejected
const safeUrl = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return esc(s);
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):/i); // real schemes have no dot; "shop.com:8080" does
  if (scheme && !scheme[1].includes('.')) return '';
  const bare = s.replace(/^\/+/, '');
  if (/^[a-z0-9]/i.test(bare) && /\./.test(bare.split(/[/?#]/)[0])) return esc('https://' + bare);
  return '';
};

let META = {};
const state = { tier: '', presence: '', state: '', category: '', sort: 'score', search: '', view: 'all' };

/** Update a lead's call status (called / no_answer / new). */
function setStatus(id, status) {
  return fetch('/api/leads/' + encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
  });
}

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
  $('#instantlyBtn').addEventListener('click', () => { window.location = '/api/export-instantly.csv?' + qs(); });
  $('#rescoreBtn').addEventListener('click', rescoreAll);
  $('#emailBtn').addEventListener('click', findEmails);
  $('#phoneBtn').addEventListener('click', verifyPhonesBtn);
  $('#verifyBtn').addEventListener('click', verifyWebsites);
  $('#ownersBtn').addEventListener('click', findOwners);
  $('#backupBtn').addEventListener('click', () => { window.location = '/api/backup.json'; });
  $('#supabaseBtn').addEventListener('click', syncSupabase);
  $('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
  $('#restoreFile').addEventListener('change', handleRestore);
  // Tools drawer (hamburger menu)
  const drawer = $('#drawer');
  const openDrawer = () => { drawer.hidden = false; requestAnimationFrame(() => drawer.classList.add('open')); };
  const closeDrawer = () => { drawer.classList.remove('open'); setTimeout(() => { drawer.hidden = true; }, 200); };
  $('#menuBtn')?.addEventListener('click', openDrawer);
  $('#drawerClose')?.addEventListener('click', closeDrawer);
  drawer?.addEventListener('click', (e) => { if (e.target === drawer) closeDrawer(); });
  drawer?.querySelectorAll('.drawer__btn').forEach((b) => b.addEventListener('click', () => setTimeout(closeDrawer, 150)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });
  // Create Customer modal
  $('#custClose')?.addEventListener('click', closeCustomerModal);
  $('#custCancel')?.addEventListener('click', closeCustomerModal);
  $('#custSave')?.addEventListener('click', saveCustomer);
  $('#custModal')?.addEventListener('click', (e) => { if (e.target === $('#custModal')) closeCustomerModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#custModal').hidden) closeCustomerModal(); });
  fetch('/api/customers').then((r) => r.json()).then((d) => { custStripeReady = Boolean(d.stripeReady); }).catch(() => {});
  $('#dailyEmailBtn').addEventListener('click', () => {
    window.location = '/api/export-daily-emails.csv?limit=1000';
    setTimeout(() => { renderDailyCount(); refresh(); }, 2000); // emails get marked saved
  });
  $('#dailyPhoneBtn').addEventListener('click', () => {
    window.location = '/api/export-daily-phones.csv?limit=1000';
    setTimeout(() => { renderDailyCount(); refresh(); }, 2000); // phones get marked saved
  });
  $('#resetDailyLink').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('Reset BOTH daily send-lists (emails + phones)?\n\nThis clears the "already saved" marks so every email and phone can be pulled into a Daily CSV again. Use this if you need to re-pull.')) return;
    const r = await fetch('/api/reset-exported?channel=all', { method: 'POST' });
    const d = await r.json();
    alert(`Reset ${d.reset} saved marks — those leads can go in the next Daily CSVs again.`);
    renderDailyCount(); refresh();
  });
  await renderUsage();
  await renderDailyCount();
  await refresh();
  // Status panels (auto-scan / cloud hunt / emergency stop) refresh on their own
  // slow timer, decoupled from the lead list and the search box.
  renderStatusPanels();
  setInterval(renderStatusPanels, 30_000);
}

/** Show how many fresh emails / phones are queued for each daily list. */
async function renderDailyCount() {
  try {
    const { emailsReady, phonesReady } = await fetch('/api/daily-count').then((r) => r.json());
    const eb = $('#dailyEmailBtn');
    if (eb) { eb.textContent = `📤 Daily Emails${emailsReady ? ` (${emailsReady})` : ''}`; eb.title = `${emailsReady} new emails not yet saved. Downloads them and marks them saved so no email repeats.`; }
    const pb = $('#dailyPhoneBtn');
    if (pb) { pb.textContent = `📞 Daily Phones${phonesReady ? ` (${phonesReady})` : ''}`; pb.title = `${phonesReady} new phone numbers not yet saved. Downloads them and marks them saved so no number repeats.`; }
  } catch { /* leave default labels */ }
}

/** Restore leads from a backup file the user picks (merge — only adds missing). */
async function handleRestore(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // let the same file be picked again later
  if (!file) return;
  if (!confirm(`Restore leads from "${file.name}"?\n\nThis ADDS any leads from the backup you don't already have. It will NOT delete or overwrite your current leads.`)) return;
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { alert("That file isn't a valid backup — couldn't read it as JSON."); return; }
  const btn = $('#restoreBtn'); const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⤒ Restoring…';
  try {
    const r = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    alert(`✅ Restored! Added ${d.added} leads you were missing — you now have ${d.after} total.`);
    await refresh();
  } catch (err) {
    alert('Restore failed: ' + (err.message || 'unknown error'));
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

/** Show today's web-search usage vs the safety cap so the user knows they're free. */
async function renderUsage() {
  const el = $('#usageBadge');
  if (!el) return;
  try { META.searchUsage = (await fetch('/api/meta').then((r) => r.json())).searchUsage; } catch {}
  const u = META.searchUsage;
  if (!META.searchReady || !u) { el.hidden = true; return; }
  el.hidden = false;
  const when = u.period === 'day' ? 'today' : 'this month';
  if (u.cap) {
    el.textContent = `🔎 ${u.used}/${u.cap} ${when}`;
    el.title = `Web searches used ${when}: ${u.used} of your ${u.cap}/${u.period} safety cap. Resets each ${u.period}. While under the free limit you can't be billed.`;
    el.classList.toggle('usage--full', u.remaining === 0);
  } else {
    el.textContent = `🔎 ${u.used} ${when}`;
    el.title = `Web searches used ${when} (no cap set).`;
    el.classList.remove('usage--full');
  }
}

async function findOwners() {
  const btn = $('#ownersBtn');
  if (!META.searchReady) { alert('Add a Gemini (or Claude) key to .env and restart to find owner names.'); return; }
  if (!confirm('Search the web for owner/principal names to personalize your outreach? Runs in batches of 100.')) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '👤 Finding…';
  try {
    const r = await fetch('/api/find-owners', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    btn.textContent = `✓ +${d.found} owners`;
    if (d.remaining > 0) btn.title = `${d.remaining} leads left — click again`;
    await renderUsage();
    await refresh();
    setTimeout(() => (btn.textContent = original), 2500);
  } catch (e) {
    btn.textContent = '✗ ' + (e.message || 'Failed'); setTimeout(() => (btn.textContent = original), 2500);
  } finally {
    btn.disabled = false;
  }
}

async function verifyWebsites() {
  const btn = $('#verifyBtn');
  if (!META.searchReady) {
    alert('To verify websites, add a Claude key (ANTHROPIC_API_KEY) or Gemini key to your .env and restart, then try again.');
    return;
  }
  if (!confirm('Web-search EVERY "no website" lead (by name + phone) to confirm or find their real site? This processes your whole list and may take a few minutes.')) return;
  const original = btn.textContent;
  btn.disabled = true;
  let found = 0, removed = 0, confirmed = 0, lastRemaining = Infinity;
  try {
    // Loop through the whole list, one batch at a time, until none are left.
    for (let i = 0; i < 60; i++) {
      btn.textContent = `🔍 Verifying… (${found + removed + confirmed} done)`;
      const r = await fetch('/api/verify-websites', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      found += d.foundSites || 0; removed += d.removedOk || 0; confirmed += d.confirmedNone || 0;
      if (!d.remaining) break;
      // Stop only if the backlog stopped shrinking (everything left is rate-limited),
      // NOT just because a batch found no new sites — re-checking old leads is progress.
      if (d.remaining >= lastRemaining) {
        btn.title = `${d.remaining} left — rate-limited; click again in a minute (or tomorrow if you hit the daily cap)`;
        break;
      }
      lastRemaining = d.remaining;
    }
    btn.textContent = `✓ ${found} had sites · ${confirmed} confirmed no-site`;
    await renderUsage();
    await refresh();
    setTimeout(() => (btn.textContent = original), 4000);
  } catch (e) {
    btn.textContent = '✗ ' + (e.message || 'Failed'); setTimeout(() => (btn.textContent = original), 3000);
  } finally {
    btn.disabled = false;
  }
}

async function findEmails() {
  const btn = $('#emailBtn');
  if (!confirm('Find contact emails? Scrapes lead websites AND web-searches for emails on no-website leads (uses your daily search budget). This can take a few minutes.')) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '✉️ Finding…';
  try {
    const r = await fetch('/api/find-emails', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    btn.textContent = `✓ +${d.found} emails`;
    if (d.remaining > 0) btn.title = `${d.remaining} sites left — click again to continue`;
    await refresh();
    setTimeout(() => (btn.textContent = original), 2500);
  } catch (e) {
    btn.textContent = '✗ ' + (e.message || 'Failed'); setTimeout(() => (btn.textContent = original), 2500);
  } finally {
    btn.disabled = false;
  }
}

async function verifyPhonesBtn() {
  const btn = $('#phoneBtn');
  // Cost preview FIRST — never run without showing exactly how many + $ it bills.
  let info;
  try { info = await fetch('/api/verify-phones/pending').then((r) => r.json()); } catch { info = null; }
  if (!info) { alert('Could not reach the server.'); return; }
  if (!info.ready) { alert('Add Twilio keys (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN) to .env and restart first.'); return; }
  if (!info.pending) { alert('All phone numbers are already line-typed — nothing to check (and nothing to bill).'); return; }
  const dailyLeft = info.dailyRemaining ?? info.batchMax ?? 250;
  if (dailyLeft <= 0) {
    alert(`Daily Twilio safety cap reached (${info.dailyCap}/day). No more lookups today — resets tomorrow. Raise TWILIO_DAILY_LOOKUP_CAP in .env only if you deliberately need more.`);
    return;
  }
  // Batch is the SMALLEST of: what's pending, the per-click cap, and today's
  // remaining daily budget — so a click can never exceed any limit.
  const batch = Math.min(info.pending, info.batchMax || 250, dailyLeft);
  const cost = (batch * (info.costPer || 0.008)).toFixed(2);
  const ok = confirm(
    `Line-type ${batch} phone number${batch === 1 ? '' : 's'} now?\n\n` +
    `• Twilio bills ~$${(info.costPer || 0.008).toFixed(3)} each → about $${cost} for this batch.\n` +
    `• Daily safety cap: ${info.dailyUsed}/${info.dailyCap} used, ${dailyLeft} left today (~$${(dailyLeft * (info.costPer || 0.008)).toFixed(2)} max).\n` +
    `• ${info.pending} numbers still need checking overall.\n\n` +
    `Tip: you only need to line-type numbers you're about to TEXT, not your whole list.`
  );
  if (!ok) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '📱 Checking…';
  try {
    const r = await fetch('/api/verify-phones?limit=' + batch, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    btn.textContent = `✓ ${d.mobile} mobile / ${d.landline} landline ($${d.spentUsd})`;
    if (d.remaining > 0) btn.title = `${d.remaining} numbers left — click again for the next ${info.batchMax || 250}`;
    await refresh();
    setTimeout(() => (btn.textContent = original), 4500);
  } catch (e) {
    btn.textContent = '✗ ' + (e.message || 'Failed'); setTimeout(() => (btn.textContent = original), 3500);
  } finally {
    btn.disabled = false;
  }
}

async function syncSupabase() {
  const btn = $('#supabaseBtn');
  if (!confirm('Push every lead to your Supabase cloud database? This is safe to run anytime — it updates existing rows and adds new ones. Your leads then survive any server problem.')) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '☁️ Syncing…';
  try {
    const r = await fetch('/api/sync-supabase', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    btn.textContent = d.verified ? `✓ ${d.remote} leads in Supabase` : `⚠ sent ${d.sent}, Supabase has ${d.remote}`;
    setTimeout(() => (btn.textContent = original), 5000);
  } catch (e) {
    btn.textContent = '✗ ' + (e.message || 'Failed'); setTimeout(() => (btn.textContent = original), 4000);
  } finally {
    btn.disabled = false;
  }
}

async function rescoreAll() {
  const btn = $('#rescoreBtn');
  if (!confirm('Regenerate the openers + full call script on ALL existing leads? This keeps their status and notes.')) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '↻ Refreshing…';
  try {
    const r = await fetch('/api/rescore', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    btn.textContent = `✓ ${d.rescored} updated`;
    await refresh();
    setTimeout(() => (btn.textContent = original), 2000);
  } catch (e) {
    btn.textContent = '✗ Failed'; setTimeout(() => (btn.textContent = original), 2000);
  } finally {
    btn.disabled = false;
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function wireFilters() {
  const map = { fSearch: 'search', fTier: 'tier', fPresence: 'presence', fState: 'state', fCategory: 'category', fSort: 'sort' };
  // The text search fires on every keystroke — debounce it so we don't refetch +
  // re-render the whole list on each letter (that was the main source of jank).
  const debouncedRefresh = debounce(refresh, 250);
  for (const [id, key] of Object.entries(map)) {
    const el = $('#' + id);
    const instant = el.tagName === 'SELECT'; // dropdowns fire once — no need to wait
    el.addEventListener('input', () => {
      state[key] = el.value;
      if (instant) refresh(); else debouncedRefresh();
    });
  }
}

function qs() {
  const p = new URLSearchParams();
  if (state.state) p.set('state', state.state);
  if (state.presence) p.set('presence', state.presence);
  if (state.category) p.set('category', state.category);
  if (state.tier) p.set('tier', state.tier);
  if (state.search) p.set('search', state.search);
  p.set('sort', state.sort);
  return p.toString();
}

async function refresh() {
  // The server now does ALL filtering + paging (was client-side over the whole
  // 10k set — the reason it "took forever"). We fetch just one page.
  const url = `/api/leads?${qs()}&view=${encodeURIComponent(state.view)}&limit=200`;
  const [stats, data] = await Promise.all([
    fetch('/api/stats').then((r) => r.json()),
    fetch(url).then((r) => r.json()),
  ]);
  renderStats(stats);
  // populate state filter from facets once
  if (data.facets?.state && $('#fState').options.length <= 1) {
    for (const st of Object.keys(data.facets.state).sort()) {
      const o = document.createElement('option'); o.value = st; o.textContent = st; $('#fState').appendChild(o);
    }
    if (state.state) $('#fState').value = state.state;
  }
  renderViewTabs(data.facets, data.viewCounts || {});
  const leads = data.leads || [];
  const total = data.total ?? leads.length;
  $('#resultCount').textContent = total > leads.length
    ? `${total.toLocaleString()} leads (showing top ${leads.length})`
    : `${total.toLocaleString()} lead${total === 1 ? '' : 's'}`;
  renderLeads(leads);
  // NOTE: the auto/hunt/emergency status panels are intentionally NOT fetched
  // here — refresh() runs on every search keystroke, and those calls (esp. the
  // Supabase-backed hunt control) made typing glitchy. They refresh on their own
  // slow timer (renderStatusPanels) and after their own button actions instead.
}

// Status panels poll on a slow, independent timer so they never stutter the
// lead list or the search box.
function renderStatusPanels() {
  renderAuto();
  renderHuntControl();
  renderEmergency();
}

async function renderEmergency() {
  const el = $('#emergency');
  if (!el) return;
  try {
    const s = await fetch('/api/emergency-stop').then((r) => r.json());
    if (s.stopped) {
      el.className = 'emergency emergency--on';
      el.innerHTML = `🛑 <b>EMERGENCY STOP is ON</b> — all scanning and paid API calls are blocked. Nothing can bill you. <button id="emResume" class="btn">Resume the prospector</button>`;
      $('#emResume')?.addEventListener('click', () => setEmergency(false));
    } else {
      el.className = 'emergency';
      el.innerHTML = `<button id="emStop" class="btn btn--danger">🛑 EMERGENCY STOP — halt everything</button> <span class="emergency__hint">Instantly stops all scanning + paid API calls (droplet + cloud hunt).</span>`;
      $('#emStop')?.addEventListener('click', () => setEmergency(true));
    }
  } catch { el.innerHTML = ''; }
}

async function setEmergency(stopped) {
  if (stopped && !confirm('EMERGENCY STOP: instantly halt ALL scanning and every paid API call (the auto-scanner and the cloud hunt). Nothing will be able to bill you until you press Resume. Continue?')) return;
  const btn = $('#emStop') || $('#emResume');
  if (btn) btn.disabled = true;
  try {
    await fetch('/api/emergency-stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stopped }) });
    await renderEmergency();
    renderAuto();
    renderHuntControl();
  } catch { if (btn) btn.disabled = false; alert('Could not reach the server.'); }
}

function renderViewTabs(facets, viewCounts = {}) {
  const c = facets?.status || {};
  const tabs = [
    ['all', '📋 All', ''],
    ['numbers', '📞 Numbers', viewCounts.numbers || 0],
    ['emails', '✉️ Emails', viewCounts.emails || 0],
    ['social', '📱 Social only', viewCounts.social || 0],
    ['tocall', 'To Call', c.new || 0],
    ['called', '✅ Called', c.called || 0],
    ['noanswer', '📵 No Answer', c.no_answer || 0],
    ['callback', '📅 Call Back', c.callback || 0],
  ];
  $('#viewTabs').innerHTML = tabs
    .map(([key, label, count]) =>
      `<button class="viewtab ${state.view === key ? 'active' : ''}" data-view="${key}">${label}${count !== '' ? ` <span class="vcount">${count}</span>` : ''}</button>`
    )
    .join('');
  $('#viewTabs').querySelectorAll('.viewtab').forEach((b) =>
    b.addEventListener('click', () => { state.view = b.dataset.view; refresh(); })
  );
}

async function renderAuto() {
  const el = $('#autoStatus');
  if (!el) return;
  try {
    const a = await fetch('/api/auto').then((r) => r.json());
    const btn = `<button id="autoToggle" class="btn btn--ghost autobtn" data-enabled="${a.enabled}" style="margin-left:10px">${a.enabled ? '⏸ Pause scanning' : '▶ Resume scanning'}</button>`;
    if (a.enabled) {
      const last = a.lastResult ? `Last: +${a.lastResult.newLeads} new from ${esc(a.lastResult.metro)}.` : 'Warming up…';
      const next = a.nextRunAt ? ` Next ~${new Date(a.nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : '';
      const pt = a.placesToday
        ? ` <span class="quota-pill">Daily quota: ${a.placesToday.used}/${a.placesToday.cap} Google searches${a.placesToday.remaining <= 0 ? ' — capped, paused till tomorrow' : ''}</span>`
        : '';
      el.innerHTML = `🔄 <b>Auto-scan ON</b> — sweeping every ${a.intervalMin} min, around <b>${esc(a.position?.metro || '')}</b>. ${last}${next}${pt}${btn}`;
    } else {
      el.innerHTML = `⏸ <b>Auto-scan OFF</b> — not scanning, so no Places API calls and no cost.${btn}`;
    }
    el.hidden = false;
    $('#autoToggle')?.addEventListener('click', toggleAuto);
  } catch { el.hidden = true; }
}

async function toggleAuto() {
  const btn = $('#autoToggle');
  const turnOn = btn.dataset.enabled !== 'true';
  if (!turnOn && !confirm('Pause the auto-scanner? It stops finding new leads AND stops any Google Places cost. You can resume anytime with this same button.')) return;
  btn.disabled = true;
  try {
    await fetch('/api/auto/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: turnOn }) });
    await renderAuto();
  } catch { btn.disabled = false; }
}

async function renderHuntControl() {
  const el = $('#huntControl');
  if (!el) return;
  try {
    const c = await fetch('/api/hunt/control').then((r) => r.json());
    if (!c.available) { el.hidden = true; return; }
    const dateStr = c.stopAfter
      ? new Date(c.stopAfter + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    if (c.enabled) {
      const until = dateStr ? ` — auto-stops after <b>${esc(dateStr)}</b>` : ' — running until you stop it';
      el.innerHTML = `☁️ <b>Cloud hunt ON</b>${until}. <button id="huntStop" class="btn btn--ghost autobtn" style="margin-left:10px">⏹ Stop the hunt now</button>`;
    } else {
      const why = c.expired ? ` (reached its ${esc(dateStr || 'end')} date)` : '';
      el.innerHTML = `⏹ <b>Cloud hunt OFF</b>${why} — not scanning, no Google cost. <button id="huntStart" class="btn btn--ghost autobtn" style="margin-left:10px">▶ Start the hunt</button>`;
    }
    el.hidden = false;
    $('#huntStop')?.addEventListener('click', () => setHunt(false));
    $('#huntStart')?.addEventListener('click', () => setHunt(true));
  } catch { el.hidden = true; }
}

async function setHunt(enabled) {
  if (!enabled && !confirm('Stop the month-long cloud hunt now? It stops finding new leads AND stops all Google Places cost immediately. You can start it again anytime with this button.')) return;
  let stopAfter;
  if (enabled) {
    const ans = prompt('Auto-stop date (YYYY-MM-DD) — the hunt stops itself after this day. Leave blank to run until you stop it manually.', '');
    if (ans === null) return; // cancelled
    stopAfter = ans.trim() || null;
  }
  try {
    await fetch('/api/hunt/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enabled ? { enabled, stopAfter } : { enabled }),
    });
    await renderHuntControl();
  } catch { alert('Could not reach the hunt control. Try again.'); }
}

// ── Create Customer modal ───────────────────────────────────────────────────
let custStripeReady = false;
function openCustomerModal(data) {
  const setv = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
  setv('#cBusiness', data.businessName);
  setv('#cOwner', data.ownerName);
  setv('#cPhone', data.phone);
  setv('#cEmail', data.email);
  setv('#cWebsite', data.website);
  setv('#cAddress', data.address);
  setv('#cCity', data.city);
  setv('#cState', data.state);
  setv('#cPlan', '');
  setv('#cPrice', '');
  setv('#cNotes', '');
  $('#custModal').dataset.leadId = data.leadId || '';
  $('#custMsg').textContent = '';
  renderPayBody();
  $('#custModal').hidden = false;
}
function closeCustomerModal() { $('#custModal').hidden = true; }

function renderPayBody() {
  const el = $('#custPayBody');
  if (!el) return;
  el.innerHTML = custStripeReady
    ? `Stripe is connected. After you save, you'll get a secure payment link to text or email the customer — they enter their card on Stripe's page, and the sale is done. <b>No card details are entered or stored here.</b>`
    : `Stripe isn't connected yet (your boss will add the key). For now this saves the customer as <b>payment pending</b>. The moment the Stripe key is in, a <b>Send payment link</b> button appears here and you collect the card securely through Stripe. <b>We never store card numbers.</b>`;
}

async function saveCustomer() {
  const val = (id) => ($(id)?.value || '').trim();
  const business = val('#cBusiness');
  if (!business) { $('#custMsg').textContent = 'Business name is required.'; return; }
  const btn = $('#custSave');
  btn.disabled = true;
  const payload = {
    leadId: $('#custModal').dataset.leadId || null,
    businessName: business,
    ownerName: val('#cOwner'), phone: val('#cPhone'), email: val('#cEmail'),
    website: val('#cWebsite'), address: val('#cAddress'), city: val('#cCity'), state: val('#cState'),
    plan: val('#cPlan'), monthlyPrice: val('#cPrice'), notes: val('#cNotes'),
  };
  try {
    const r = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed to save');
    // Also mark the source lead as won, so it leaves the call list.
    if (payload.leadId) { try { await setStatus(payload.leadId, 'won'); } catch { /* non-fatal */ } }
    $('#custMsg').textContent = '✓ Saved! Opening Customers…';
    setTimeout(() => { window.location.href = '/customers.html'; }, 700);
  } catch (e) {
    $('#custMsg').textContent = '✗ ' + e.message;
    btn.disabled = false;
  }
}

function renderStats(s) {
  const cards = [
    { num: s.total, label: 'Total leads', cls: '', tip: 'Every business found that has a website problem worth calling.' },
    { num: s.byTier.hot, label: '🔥 Hot leads', cls: 'statcard--hot', tip: 'The best-fit leads — call these first.' },
    { num: s.noWebsite, label: 'No real website', cls: '', tip: 'Businesses with no site at all or only a social page — your easiest pitch.' },
    { num: usd(s.opportunityUsd), label: 'Est. monthly opportunity', cls: 'statcard--opp', tip: 'Rough total $/month your whole list is leaving on the table — your pipeline size, not one customer.' },
  ];
  $('#stats').innerHTML = cards.map((c) =>
    `<div class="statcard ${c.cls}" title="${esc(c.tip)}"><div class="statcard__num">${esc(c.num)}</div><div class="statcard__label">${c.label}</div></div>`
  ).join('');
}

const RENDER_CAP = 300; // don't build more than this many cards at once (DOM perf)
function renderLeads(leads) {
  const root = $('#leads');
  if (!leads.length) { root.innerHTML = '<div class="empty">No leads match. Run a scan or loosen the filters.</div>'; return; }
  // Rendering all ~10k leads as DOM nodes made scrolling/typing glitchy. Cap the
  // rendered set; the count above still shows the true total, and search/filters
  // narrow to what you need. Sorting means the top (best) leads show first.
  const shown = leads.slice(0, RENDER_CAP);
  const note = leads.length > RENDER_CAP
    ? `<div class="rendernote">Showing the top ${RENDER_CAP} of ${leads.length.toLocaleString()} — use search or filters to narrow.</div>`
    : '';
  root.innerHTML = note + shown.map(leadCard).join('');
  root.querySelectorAll('.lead__row').forEach((row) => {
    row.addEventListener('click', (e) => { if (e.target.closest('a,button,select')) return; row.parentElement.classList.toggle('open'); });
  });
  root.querySelectorAll('.copybtn').forEach((b) => b.addEventListener('click', () => {
    const original = b.textContent;
    navigator.clipboard.writeText(b.dataset.copy || '').then(() => {
      b.textContent = '✓ Copied'; setTimeout(() => (b.textContent = original), 1500);
    });
  }));
  root.querySelectorAll('.statussel').forEach((sel) => sel.addEventListener('change', () => {
    fetch('/api/leads/' + encodeURIComponent(sel.dataset.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: sel.value }),
    });
  }));
  root.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    const detail = t.closest('.lead__detail');
    detail.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    detail.querySelectorAll('.tabpane').forEach((p) => (p.hidden = p.dataset.pane !== t.dataset.tab));
  }));
  root.querySelectorAll('.actbtn').forEach((b) => b.addEventListener('click', async (e) => {
    if (b.classList.contains('act-recheck')) return; // handled separately below
    if (b.classList.contains('act-customer')) return; // handled separately below
    if (b.classList.contains('act-website')) return; // handled separately below
    e.stopPropagation();
    b.disabled = true;
    await setStatus(b.dataset.id, b.dataset.status);
    refresh();
  }));
  root.querySelectorAll('.act-website').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const orig = b.textContent;
    b.disabled = true; b.textContent = '🌐 Building your site…';
    try {
      const r = await fetch('/api/leads/' + encodeURIComponent(b.dataset.id) + '/website', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      await navigator.clipboard.writeText(d.url).catch(() => {});
      b.textContent = '✓ Live — link copied!';
      window.open(d.url, '_blank');
      setTimeout(refresh, 1400);
    } catch (err) {
      b.textContent = '✗ ' + (err.message || 'Failed');
      setTimeout(() => { b.textContent = orig; b.disabled = false; }, 3500);
    }
  }));
  root.querySelectorAll('.act-customer').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    let data = {};
    try { data = JSON.parse(b.dataset.cust || '{}'); } catch { /* ignore */ }
    openCustomerModal(data);
  }));
  root.querySelectorAll('.act-recheck').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const orig = b.textContent;
    b.disabled = true; b.textContent = '🔍 Checking…';
    try {
      const r = await fetch('/api/leads/' + encodeURIComponent(b.dataset.id) + '/recheck', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      if (d.removed) { b.textContent = '✅ Has a site — removing'; await renderUsage(); setTimeout(refresh, 900); return; }
      if (d.found) { b.textContent = '✅ Found their site'; await renderUsage(); setTimeout(refresh, 900); return; }
      b.textContent = '✓ Confirmed no site';
      await renderUsage();
      setTimeout(() => { b.textContent = orig; b.disabled = false; }, 2500);
    } catch (err) {
      b.textContent = '✗ ' + (err.message || 'Failed'); setTimeout(() => { b.textContent = orig; b.disabled = false; }, 2500);
    }
  }));
  root.querySelectorAll('.savenote').forEach((b) => b.addEventListener('click', async () => {
    const ta = root.querySelector(`.notesbox[data-id="${CSS.escape(b.dataset.id)}"]`);
    b.disabled = true;
    await fetch('/api/leads/' + encodeURIComponent(b.dataset.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: ta.value }),
    });
    b.textContent = '✓ Saved'; setTimeout(() => { b.textContent = '💾 Save note'; b.disabled = false; }, 1500);
  }));
}

function leadCard(l) {
  const b = l.business, s = l.score, a = l.audit;
  const tier = s.tier;
  const problems = (a.problems || []).map((p) =>
    `<div class="problem"><span class="problem__sev sev${p.severity}"></span><div><b>${esc(p.label)}</b><span>${esc(p.detail || '')}</span></div></div>`
  ).join('');
  const statusOpts = ['new', 'called', 'no_answer', 'callback', 'interested', 'won', 'dead', 'has_site']
    .map((o) => `<option ${((l.status || 'new') === o) ? 'selected' : ''}>${o}</option>`).join('');

  // Verified vs unverified "no website" — so a rep never claims "you have no site"
  // on a lead we only assume is missing one (Google often just omits the URL).
  const noSiteClaim = l.presence === 'none' || l.presence === 'social_only';
  const verifyBadge = noSiteClaim
    ? (b.websiteVerified
        ? `<span class="vbadge vbadge--ok" title="We web-searched their name + phone and confirmed they have no website of their own. Safe to mention on the call.">✓ Confirmed no site</span>`
        : `<span class="vbadge vbadge--warn" title="This is only Google's data — Google often omits a business's real website. Click 'Verify websites' before claiming they have no site, or ask on the call instead of stating it.">⚠ Unconfirmed — verify first</span>`)
    : '';

  // Call-tracking row buttons (based on the lead's current status)
  const callStatus = l.status || 'new';
  let rowActions;
  if (callStatus === 'new') {
    rowActions =
      `<button class="actbtn act-call" data-id="${esc(l.id)}" data-status="called" title="I called them">📞 Called</button>` +
      `<button class="actbtn act-no" data-id="${esc(l.id)}" data-status="no_answer" title="They didn't answer">📵 No answer</button>` +
      `<button class="actbtn act-cb" data-id="${esc(l.id)}" data-status="callback" title="Call back later">📅 Later</button>`;
  } else {
    const lbl = callStatus === 'called' ? '✅ Called' : callStatus === 'no_answer' ? '📵 No answer' : callStatus === 'callback' ? '📅 Call back' : callStatus === 'has_site' ? '🌐 Has a site' : esc(callStatus);
    rowActions =
      `<span class="statuslbl statuslbl--${esc(callStatus)}">${lbl}</span>` +
      `<button class="actbtn act-back" data-id="${esc(l.id)}" data-status="new" title="Move back to To-Call (undo)">↩</button>`;
  }
  const siteHref = safeUrl(b.website);
  const site = b.website
    ? (siteHref
        ? `<a href="${siteHref}" target="_blank" rel="noopener">${esc(b.website)}</a>`
        : `<span>${esc(b.website)}</span>`)
    : '<span class="muted">none</span>';
  const mapsHref = safeUrl(b.googleMapsUri);

  // Openers: use the new multi-opener list, fall back to the single pitch.
  const openers = (s.openers && s.openers.length)
    ? s.openers
    : (s.pitch ? [{ label: 'Suggested opener', text: s.pitch }] : []);
  const openersHtml = openers.map((o) => `
    <div class="opener">
      <div class="opener__head">
        <span class="opener__label">${esc(o.label)}</span>
        <button class="btn btn--ghost copybtn" data-copy="${esc(o.text)}">⧉ Copy</button>
      </div>
      <div class="pitch">${esc(o.text).replace(/\n/g, '<br>')}</div>
    </div>`).join('');

  // Alternative one-line opening hooks (new richer openers)
  const hooks = s.hooks || [];
  const hooksHtml = hooks.length ? `
    <div class="hint-line">Alternative opening lines — pick the angle that fits:</div>
    <div class="hooks">
      ${hooks.map((h) => `
        <div class="hook">
          <div class="hook__top">
            <span class="hook__label">${esc(h.label)}</span>
            <button class="btn btn--ghost copybtn" data-copy="${esc(h.text)}">⧉ Copy</button>
          </div>
          <div class="hook__text">${esc(h.text)}</div>
        </div>`).join('')}
    </div>` : '';

  // Full call script (new tab)
  const scriptHtml = s.script
    ? `<div class="opener__head"><span class="opener__label">📋 Full cold-call script</span>
         <button class="btn btn--ghost copybtn" data-copy="${esc(s.script)}">⧉ Copy full script</button></div>
       <div class="pitch script">${esc(s.script).replace(/\n/g, '<br>')}</div>`
    : `<div class="muted" style="font-size:13px">Re-scan this lead to generate the full call script.</div>`;

  // Business + audit facts for the profile
  const priceMap = ['Free', '$', '$$', '$$$', '$$$$'];
  const facts = [];
  facts.push(['Rating', `${b.rating ? b.rating + '★' : '—'} · ${b.reviewCount ?? 0} reviews`]);
  facts.push(['Category', `${esc(b.categoryLabel || b.category || '—')}${b.tier ? ` · ${b.tier} tier` : ''}`]);
  if (b.avgTicketUsd) facts.push(['Typical job value', `~${usd(b.avgTicketUsd)}`]);
  facts.push(['Market', `${esc(b.city || '')}, ${esc(b.state || '')}${b.metroPopulation ? ` · metro ~${Number(b.metroPopulation).toLocaleString()}` : ''}`]);
  if (b.topCompetitor?.name) facts.push(['Top competitor', `${esc(b.topCompetitor.name)} — ${b.topCompetitor.reviewCount ?? '?'} reviews`]);
  facts.push(['Est. opportunity', `${usd(s.opportunityUsd)}/mo · ~${s.estMonthlyLeads ?? '?'} online leads/mo`]);
  if (b.businessStatus && b.businessStatus !== 'OPERATIONAL') facts.push(['Status', esc(b.businessStatus)]);
  if (b.priceLevel != null && priceMap[b.priceLevel]) facts.push(['Price level', priceMap[b.priceLevel]]);
  const factsHtml = facts.map(([k, v]) => `<div class="kv"><span class="muted">${k}:</span> <b>${v}</b></div>`).join('');

  // Audit detail
  const aud = [];
  aud.push(['Web presence', esc(a.headline || l.presence)]);
  if (typeof a.healthScore === 'number') aud.push(['Site health', `${a.healthScore}/100`]);
  if (a.probe) {
    const p = a.probe;
    const bits = [];
    if (p.responseMs) bits.push(`loads in ${(p.responseMs / 1000).toFixed(1)}s`);
    bits.push(`HTTPS ${p.https ? '✓' : '✗'}`);
    if (p.status) bits.push(`HTTP ${p.status}`);
    aud.push(['Site check', bits.join(' · ')]);
    if (p.title) aud.push(['Page title', esc(p.title)]);
  }
  if (a.pagespeed) {
    const ps = a.pagespeed;
    const bits = [];
    if (ps.performance != null) bits.push(`Speed ${ps.performance}`);
    if (ps.seo != null) bits.push(`SEO ${ps.seo}`);
    if (ps.bestPractices != null) bits.push(`Best-practices ${ps.bestPractices}`);
    if (bits.length) aud.push(['PageSpeed', bits.join(' · ') + ' /100']);
  }
  const firstSeen = l.firstSeen ? new Date(l.firstSeen).toLocaleDateString() : null;
  if (firstSeen) aud.push(['First found', firstSeen]);
  const auditHtml = aud.map(([k, v]) => `<div class="kv"><span class="muted">${k}:</span> <b>${v}</b></div>`).join('');

  return `
  <div class="lead">
    <div class="lead__row">
      <div class="score score--${tier}" title="Fit score 0–100 (${s.label}). Higher = better lead. Blends their web problem, ability to pay, and market size."><span class="score__val">${s.value}</span><span class="score__emoji">${s.emoji}</span></div>
      <div>
        <div class="lead__name">${esc(b.name)}</div>
        <div class="lead__meta">
          <span class="tag tag--${l.presence}" title="What's wrong with their web presence.">${esc(a.headline)}</span>
          ${verifyBadge}
          <span>${esc(b.categoryLabel || b.category || '')}</span>
          <span>· ${esc(b.city || '')}, ${esc(b.state || '')}</span>
        </div>
      </div>
      <div class="lead__revs hide-sm" title="Google reviews — our stand-in for how busy/established (and able to pay) they are."><span class="n">${b.reviewCount ?? 0}</span> ★${b.rating ? ' ' + b.rating : ''}<div class="muted" style="font-size:11px">reviews</div></div>
      <div class="lead__opp hide-sm" title="Rough estimate of money they're leaving on the table each month from their web problem. Say 'around $X' — it's an estimate, not exact."><span class="n">${usd(s.opportunityUsd)}</span><div class="l">est. lost /mo</div></div>
      <div class="lead__end">${rowActions}<span class="chevron">›</span></div>
    </div>
    <div class="lead__detail">
      <div class="detail__grid">
        <div>
          <h4 class="detail__h">Why this is a lead</h4>
          <div class="problems">${problems}</div>
          ${(s.reasons || []).length ? `<ul class="reasons">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
          <h4 class="detail__h" style="margin-top:16px">Website audit</h4>
          ${auditHtml}
        </div>
        <div class="detail__side">
          <h4 class="detail__h">Contact</h4>
          <div class="kv">👤 ${b.ownerName ? `<b>${esc(b.ownerName)}</b>` : '<span class="muted">owner not found yet</span>'}</div>
          <div class="kv">📞 ${esc(b.phone || '—')}${l.phoneSavedAt ? ' <span class="vbadge vbadge--saved" title="This phone number was already included in a Daily Phones export">✓ saved</span>' : ''}</div>
          <div class="kv">✉️ ${b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>${b.emailStatus === 'valid' ? ' <span class="vbadge vbadge--ok" title="Domain accepts mail — safe to send">✓ deliverable</span>' : b.emailStatus === 'risky' ? ' <span class="vbadge vbadge--warn" title="Domain has no mail server — this would bounce, kept out of exports">⚠ risky</span>' : ''}${l.emailSavedAt ? ' <span class="vbadge vbadge--saved" title="This email was already included in a Daily Emails export">✓ saved</span>' : ''}` : '<span class="muted">no email found — use phone</span>'}</div>
          <div class="kv">🌐 ${site}</div>
          <div class="kv">📍 ${esc(b.address || '')}</div>
          ${mapsHref ? `<div class="kv"><a href="${mapsHref}" target="_blank" rel="noopener">View on Google Maps ↗</a></div>` : ''}
          <h4 class="detail__h" style="margin-top:16px">Business</h4>
          ${factsHtml}
          <h4 class="detail__h" style="margin-top:16px">Score breakdown</h4>
          <div class="kv">Problem <b>${s.breakdown.presence}</b> · Affordability <b>${s.breakdown.affordability}</b> · Market <b>${s.breakdown.market}</b></div>
        </div>
      </div>

      <div class="tabs">
        <button class="tab active" data-tab="openers">✍️ Suggested openers</button>
        <button class="tab" data-tab="script">📋 Full call script</button>
      </div>
      <div class="tabpane" data-pane="openers">
        ${hooksHtml}
        <div class="hint-line">Or send a ready-made message — pick a channel &amp; copy:</div>
        <div class="openers">${openersHtml}</div>
      </div>
      <div class="tabpane" data-pane="script" hidden>${scriptHtml}</div>

      <div class="notes">
        <h4 class="detail__h" style="margin-top:18px">Notes</h4>
        <textarea class="notesbox" data-id="${esc(l.id)}" placeholder="Jot what they said on the call, follow-up dates, etc.">${esc(l.notes || '')}</textarea>
        <button class="btn btn--ghost savenote" data-id="${esc(l.id)}">💾 Save note</button>
      </div>

      <div class="detail__actions">
        <button class="actbtn act-customer" data-cust="${esc(JSON.stringify({ leadId: l.id, businessName: b.name || '', ownerName: b.ownerName || '', phone: b.phone || '', email: b.email || '', website: b.website || '', address: b.address || '', city: b.city || '', state: b.state || '' }))}" title="They said yes on the call — create a customer and set up payment">✅ Create Customer</button>
        <button class="actbtn act-website" data-id="${esc(l.id)}" title="Generate a professional demo website for this business and publish it live — great to show on a call">🌐 Create Website</button>
        ${b.demoSiteUrl ? `<a class="linkbtn" href="${safeUrl(b.demoSiteUrl) || '#'}" target="_blank" rel="noopener">🌐 View live site ↗</a>` : ''}
        ${b.website ? `<a class="linkbtn" href="https://pagespeed.web.dev/report?url=${encodeURIComponent(b.website)}" target="_blank" rel="noopener">Run PageSpeed ↗</a>` : ''}
        ${noSiteClaim ? `<button class="actbtn act-recheck" data-id="${esc(l.id)}" title="Search the web again right now to double-check whether this business has a website">🔍 Re-check website</button>` : ''}
        ${noSiteClaim ? `<button class="actbtn act-hassite" data-id="${esc(l.id)}" data-status="has_site" title="You found out they DO have a website — pull this lead out of your call list">🌐 They have a site — remove</button>` : ''}
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
