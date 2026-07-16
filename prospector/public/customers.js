const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

let stripeReady = false;

const STATUS_LABELS = { pending: '🟡 Pending', active: '🟢 Active', canceled: '⚪ Canceled' };
const PAY_LABELS = {
  not_collected: '💳 Payment not collected',
  link_sent: '📨 Payment link sent',
  paid: '✅ Paid',
  active_subscription: '🔁 Active subscription',
};

async function load() {
  const d = await fetch('/api/customers').then((r) => r.json());
  stripeReady = Boolean(d.stripeReady);
  const badge = $('#payBadge');
  if (stripeReady) { badge.textContent = 'Stripe connected'; badge.className = 'badge badge--live'; }
  else { badge.textContent = 'Stripe not connected'; badge.className = 'badge badge--demo'; }
  render(d.customers || []);
}

function render(customers) {
  const mrr = customers.filter((c) => c.status === 'active').reduce((s, c) => s + (Number(c.monthlyPrice) || 0), 0);
  const pipeline = customers.filter((c) => c.status === 'pending').reduce((s, c) => s + (Number(c.monthlyPrice) || 0), 0);
  $('#custStats').innerHTML = [
    { num: customers.length, label: 'Customers' },
    { num: customers.filter((c) => c.status === 'active').length, label: '🟢 Active' },
    { num: usd(mrr), label: 'Monthly revenue (active)' },
    { num: usd(pipeline), label: 'Pipeline (pending)' },
  ].map((c) => `<div class="statcard"><div class="statcard__num">${esc(c.num)}</div><div class="statcard__label">${esc(c.label)}</div></div>`).join('');

  const list = $('#custList');
  if (!customers.length) {
    list.innerHTML = `<div class="empty">No customers yet. On the Prospector tab, open a lead who said "yes" and click <b>✅ Create Customer</b>.</div>`;
    return;
  }
  list.innerHTML = customers.map(card).join('');
  wire(list);
}

function card(c) {
  const contact = [
    c.ownerName ? `👤 ${esc(c.ownerName)}` : '',
    c.phone ? `📞 ${esc(c.phone)}` : '',
    c.email ? `✉️ ${esc(c.email)}` : '',
    c.website ? `🌐 ${esc(c.website)}` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const loc = [c.city, c.state].filter(Boolean).join(', ');
  const payBtn = stripeReady && c.paymentStatus !== 'active_subscription' && c.paymentStatus !== 'paid'
    ? `<button class="btn btn--red act-paylink" data-id="${esc(c.id)}">📨 Send payment link</button>`
    : (!stripeReady ? `<span class="muted" style="font-size:12px">Connect Stripe to collect payment</span>` : '');
  return `
  <div class="lead">
    <div class="lead__row">
      <div>
        <div class="lead__name">${esc(c.businessName)}</div>
        <div class="lead__meta">
          <span class="tag">${STATUS_LABELS[c.status] || esc(c.status)}</span>
          <span>${PAY_LABELS[c.paymentStatus] || esc(c.paymentStatus)}</span>
          ${c.plan ? `<span>· ${esc(c.plan)}</span>` : ''}
          ${c.monthlyPrice ? `<span>· ${usd(c.monthlyPrice)}/mo</span>` : ''}
          ${loc ? `<span>· ${esc(loc)}</span>` : ''}
        </div>
        <div class="lead__meta" style="margin-top:6px">${contact || '<span class="muted">no contact info</span>'}</div>
      </div>
      <div class="lead__end">
        <select class="cust-status" data-id="${esc(c.id)}" title="Deal status">
          ${['pending', 'active', 'canceled'].map((s) => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
        ${payBtn}
        <button class="actbtn cust-del" data-id="${esc(c.id)}" title="Delete customer">🗑</button>
      </div>
    </div>
    ${c.notes ? `<div class="lead__detail" style="max-height:none;padding:12px 16px"><b>Notes:</b> ${esc(c.notes)}</div>` : ''}
  </div>`;
}

function wire(root) {
  root.querySelectorAll('.cust-status').forEach((sel) => sel.addEventListener('change', async () => {
    await fetch('/api/customers/' + encodeURIComponent(sel.dataset.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: sel.value }),
    });
    load();
  }));
  root.querySelectorAll('.cust-del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this customer record? (This does not cancel any Stripe subscription.)')) return;
    await fetch('/api/customers/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
    load();
  }));
  root.querySelectorAll('.act-paylink').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    const orig = b.textContent; b.textContent = 'Creating link…';
    try {
      const r = await fetch('/api/customers/' + encodeURIComponent(b.dataset.id) + '/payment-link', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      if (d.url) {
        await navigator.clipboard.writeText(d.url).catch(() => {});
        b.textContent = '✓ Link copied — text it to them';
        load();
      }
    } catch (e) {
      b.textContent = '✗ ' + e.message;
      setTimeout(() => { b.textContent = orig; b.disabled = false; }, 2500);
    }
  }));
}

load();
