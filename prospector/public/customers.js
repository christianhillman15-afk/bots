const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

let ALL = [];
let stripeReady = false;
const state = { search: '', status: '', pay: '', hasSite: '', sort: 'newest' };

const STATUS_LABELS = { pending: '🟡 Pending', active: '🟢 Active', canceled: '⚪ Canceled' };
const PAY_LABELS = {
  not_collected: '💳 Not collected',
  link_sent: '📨 Link sent',
  paid: '✅ Paid',
  active_subscription: '🔁 Subscription',
};

async function load() {
  const d = await fetch('/api/customers').then((r) => r.json());
  stripeReady = Boolean(d.stripeReady);
  ALL = d.customers || [];
  const badge = $('#payBadge');
  if (stripeReady) { badge.textContent = 'Stripe connected'; badge.className = 'badge badge--live'; }
  else { badge.textContent = 'Stripe not connected'; badge.className = 'badge badge--demo'; }
  renderStats();
  render();
}

function renderStats() {
  const mrr = ALL.filter((c) => c.status === 'active').reduce((s, c) => s + (Number(c.monthlyPrice) || 0), 0);
  const pipeline = ALL.filter((c) => c.status === 'pending').reduce((s, c) => s + (Number(c.monthlyPrice) || 0), 0);
  $('#custStats').innerHTML = [
    { num: ALL.length, label: 'Customers', cls: '' },
    { num: ALL.filter((c) => c.status === 'active').length, label: '🟢 Active', cls: '' },
    { num: usd(mrr), label: 'Monthly revenue (active)', cls: 'statcard--opp' },
    { num: usd(pipeline), label: 'Pipeline (pending)', cls: '' },
  ].map((c) => `<div class="statcard ${c.cls}"><div class="statcard__num">${esc(c.num)}</div><div class="statcard__label">${esc(c.label)}</div></div>`).join('');
}

function filtered() {
  let rows = ALL.slice();
  if (state.status) rows = rows.filter((c) => c.status === state.status);
  if (state.pay) rows = rows.filter((c) => (c.paymentStatus || 'not_collected') === state.pay);
  if (state.hasSite === 'yes') rows = rows.filter((c) => c.demoSiteUrl);
  if (state.hasSite === 'no') rows = rows.filter((c) => !c.demoSiteUrl);
  if (state.search) {
    const q = state.search.toLowerCase();
    const qd = q.replace(/\D/g, '');
    rows = rows.filter((c) => {
      const hay = [c.businessName, c.ownerName, c.email, c.phone, c.website, c.address, c.city, c.state, c.plan, c.notes]
        .filter(Boolean).join(' ␟ ').toLowerCase();
      if (hay.includes(q)) return true;
      if (qd.length >= 3) {
        const pd = (c.phone || '').replace(/\D/g, '');
        if (pd && pd.includes(qd)) return true;
      }
      return false;
    });
  }
  const sorters = {
    newest: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
    name: (a, b) => (a.businessName || '').localeCompare(b.businessName || ''),
    price: (a, b) => (Number(b.monthlyPrice) || 0) - (Number(a.monthlyPrice) || 0),
    status: (a, b) => (a.status || '').localeCompare(b.status || '') || (b.createdAt || '').localeCompare(a.createdAt || ''),
  };
  rows.sort(sorters[state.sort] || sorters.newest);
  return rows;
}

function render() {
  const rows = filtered();
  $('#cCount').textContent = `${rows.length} of ${ALL.length} customer${ALL.length === 1 ? '' : 's'}`;
  const list = $('#custList');
  if (!ALL.length) {
    list.innerHTML = `<div class="empty">No customers yet. On the Prospector tab, open a lead who said "yes" and click <b>✅ Create Customer</b> — or generate their demo website (that creates the customer automatically).</div>`;
    return;
  }
  if (!rows.length) {
    list.innerHTML = `<div class="empty">No customers match these filters.</div>`;
    return;
  }
  list.innerHTML = rows.map(card).join('');
  wire(list);
}

function card(c) {
  const loc = [c.city, c.state].filter(Boolean).join(', ');
  const created = c.createdAt ? new Date(c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const demoLink = c.demoSiteUrl && /^https:\/\//.test(c.demoSiteUrl)
    ? `<a class="linkbtn" href="${esc(c.demoSiteUrl)}" target="_blank" rel="noopener">🌐 Demo site ↗</a>` : '';
  const payBtn = stripeReady && c.paymentStatus !== 'active_subscription' && c.paymentStatus !== 'paid'
    ? `<button class="actbtn act-paylink" data-id="${esc(c.id)}">📨 Send payment link</button>` : '';
  const contact = [
    c.ownerName ? `👤 <b>${esc(c.ownerName)}</b>` : '',
    c.phone ? `📞 <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '',
    c.email ? `✉️ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '',
    loc ? `📍 ${esc(loc)}` : '',
  ].filter(Boolean).join('<span class="csep">·</span>');
  const activity = (c.activity || []).slice(-6).reverse().map((a) =>
    `<div class="cact"><span class="cact__at">${a.at ? new Date(a.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span>${esc(a.text)}</div>`
  ).join('');

  return `
  <div class="lead cust">
    <div class="lead__row cust__row">
      <div class="cust__main">
        <div class="lead__name">${esc(c.businessName)}
          <span class="tag cust-tag--${esc(c.status)}">${STATUS_LABELS[c.status] || esc(c.status)}</span>
          <span class="tag">${PAY_LABELS[c.paymentStatus] || esc(c.paymentStatus)}</span>
        </div>
        <div class="lead__meta cust__contact">${contact || '<span class="muted">no contact info yet</span>'}</div>
        <div class="lead__meta">
          ${c.plan ? `<span>📦 ${esc(c.plan)}</span>` : '<span class="muted">no plan set</span>'}
          ${c.monthlyPrice ? `<span class="cust__price">${usd(c.monthlyPrice)}/mo</span>` : ''}
          ${created ? `<span class="muted">since ${esc(created)}</span>` : ''}
          ${demoLink}
        </div>
      </div>
      <div class="lead__end cust__end">
        <select class="cust-status" data-id="${esc(c.id)}" title="Deal status">
          ${['pending', 'active', 'canceled'].map((s) => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
        ${payBtn}
        <span class="chevron">›</span>
      </div>
    </div>
    <div class="lead__detail cust__detail">
      <div class="cust__cols">
        <div>
          <h4 class="detail__h">Notes</h4>
          <textarea class="notesbox cnotes" data-id="${esc(c.id)}" placeholder="Plan details, follow-ups, what they agreed to…">${esc(c.notes || '')}</textarea>
          <button class="btn btn--ghost csave" data-id="${esc(c.id)}">💾 Save note</button>
        </div>
        <div>
          <h4 class="detail__h">Activity</h4>
          ${activity || '<div class="muted" style="font-size:13px">No activity yet.</div>'}
          <div class="cust__danger">
            <button class="actbtn cust-del" data-id="${esc(c.id)}" title="Delete customer">🗑 Delete customer</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function wire(root) {
  root.querySelectorAll('.cust__row').forEach((row) => row.addEventListener('click', (e) => {
    if (e.target.closest('a,button,select,textarea')) return;
    row.parentElement.classList.toggle('open');
  }));
  root.querySelectorAll('.cust-status').forEach((sel) => sel.addEventListener('change', async () => {
    await fetch('/api/customers/' + encodeURIComponent(sel.dataset.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: sel.value }),
    });
    load();
  }));
  root.querySelectorAll('.csave').forEach((b) => b.addEventListener('click', async () => {
    const box = root.querySelector(`.cnotes[data-id="${b.dataset.id}"]`);
    b.disabled = true;
    await fetch('/api/customers/' + encodeURIComponent(b.dataset.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: box.value }),
    });
    b.textContent = '✓ Saved'; setTimeout(() => { b.textContent = '💾 Save note'; b.disabled = false; }, 1400);
  }));
  root.querySelectorAll('.cust-del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this customer record? (This does not cancel any Stripe subscription.)')) return;
    await fetch('/api/customers/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
    load();
  }));
  root.querySelectorAll('.act-paylink').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.disabled = true;
    const orig = b.textContent; b.textContent = 'Creating link…';
    try {
      const r = await fetch('/api/customers/' + encodeURIComponent(b.dataset.id) + '/payment-link', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      if (d.url) {
        await navigator.clipboard.writeText(d.url).catch(() => {});
        b.textContent = '✓ Link copied — text it to them';
        setTimeout(load, 1500);
      }
    } catch (err) {
      b.textContent = '✗ ' + err.message;
      setTimeout(() => { b.textContent = orig; b.disabled = false; }, 2500);
    }
  }));
}

function wireFilters() {
  $('#cSearch').addEventListener('input', () => {
    state.search = $('#cSearch').value;
    $('#cClear').hidden = !state.search;
    render();
  });
  $('#cClear').addEventListener('click', () => {
    $('#cSearch').value = ''; state.search = ''; $('#cClear').hidden = true; $('#cSearch').focus(); render();
  });
  for (const [id, key] of [['cStatus', 'status'], ['cPay', 'pay'], ['cHasSite', 'hasSite'], ['cSort', 'sort']]) {
    $('#' + id).addEventListener('input', () => { state[key] = $('#' + id).value; render(); });
  }
}

wireFilters();
load();
