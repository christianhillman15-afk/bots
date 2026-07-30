import express from 'express';
import { timingSafeEqual, createHmac } from 'node:crypto';
import { config, isLive } from './config.js';
import { LeadStore } from './store.js';
import { runScan } from './scan.js';
import { activeSources } from './providers/discovery.js';
import { placesCallsSince } from './providers/places.js';
import { getPlacesUsage, addPlacesUsage } from './placesUsage.js';
import { writeCsv } from './export.js';
import { METROS, topMetros, findMetro } from './data/metros.js';
import { CATEGORIES, findCategory, defaultCategories } from './data/categories.js';
import { toCsv } from './util.js';
import { scoreLead } from './scoring/leadScore.js';
import { enrichEmails, verifyEmails } from './enrich/emailFinder.js';
import { verifyMissingWebsites, enrichOwners, searchReady, searchUsage, recheckLead } from './enrich/websiteFinder.js';
import { createScheduler } from './scheduler.js';
import { SpecialRequestStore, runSpecialRequest, HOME_SERVICE_CATEGORIES, REGIONS } from './specialRequests.js';
import { CustomerStore } from './customers.js';
import { buildSiteHtml, fetchHeroDataUri } from './siteTemplate.js';
import { deploySite, netlifyReady } from './netlify.js';
import { googleSearchReady } from './enrich/googleSearch.js';
import { crunchbaseReady } from './enrich/crunchbase.js';
import { apolloReady } from './enrich/apollo.js';
import { verifyPhones, twilioReady, needsLineType } from './enrich/phoneFinder.js';
import { twilioUsage } from './enrich/twilioUsage.js';
import { syncLeads, syncSpecialRequests, countLeads, supabaseReady, getHuntControl, setHuntControl } from './supabase.js';
import { isStopped, stopState, engage, release } from './killSwitch.js';
import { log } from './logger.js';

/* Constant-time string compare to avoid leaking the password via timing. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/* Password-only login (no username). We set a stateless cookie = HMAC of a
 * constant keyed by the password; changing the password invalidates it. */
function authToken() {
  return createHmac('sha256', config.dashboardPassword || 'none').update('surge-prospector-v1').digest('hex');
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isAuthed(req) {
  if (!config.dashboardPassword) return true; // open in private/local use
  const tok = parseCookies(req).sp_auth;
  return Boolean(tok) && safeEqual(tok, authToken());
}
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
  return res.redirect('/login');
}
function loginPage(error = false) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Launch Media Prospector — Login</title><style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    background:radial-gradient(1000px 500px at 70% -10%,rgba(139,61,255,.18),transparent 60%),#07080f;color:#e9ebf5}
  .box{background:#0e1019;border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:34px 30px;width:320px;
    text-align:center;box-shadow:0 24px 60px -20px rgba(0,0,0,.6)}
  .mark{font-size:26px}h1{font-size:20px;margin:8px 0 2px;letter-spacing:-.02em;font-weight:800}
  .sub{color:#9298b1;font-size:13px;margin-bottom:20px}
  input{width:100%;box-sizing:border-box;background:#07080f;border:1px solid rgba(255,255,255,.12);
    border-radius:10px;padding:12px 14px;color:#e9ebf5;font-size:15px;outline:none}
  input:focus{border-color:#8b3dff}
  button{width:100%;margin-top:12px;border:none;border-radius:999px;padding:12px;font-weight:700;font-size:15px;
    color:#fff;cursor:pointer;background:linear-gradient(120deg,#ff2d4d,#8b3dff)}
  .err{color:#ff5d76;font-size:13px;margin-top:12px}
</style></head><body>
<form class="box" method="POST" action="/login">
  <div class="mark">⚡</div>
  <h1>Launch <span style="color:#ff2d4d">Media</span> Prospector</h1>
  <div class="sub">Enter your password to continue</div>
  <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password"/>
  <button type="submit">Unlock →</button>
  ${error ? '<div class="err">Wrong password — try again.</div>' : ''}
</form></body></html>`;
}

export function startServer() {
  const app = express();
  const store = new LeadStore();
  let scanning = false;
  const isBusy = () => scanning;
  const setBusy = (v) => {
    scanning = v;
  };
  const scheduler = createScheduler({ store, isBusy, setBusy });
  const srStore = new SpecialRequestStore();
  const srRunning = new Set(); // request ids currently running
  const custStore = new CustomerStore();

  // Health check for hosting platforms — must stay public (before auth).
  app.get('/healthz', (_req, res) => res.json({ ok: true, leads: store.size, live: isLive() }));

  // Password-only login page (no username).
  app.get('/login', (req, res) => {
    if (isAuthed(req)) return res.redirect('/');
    res.type('html').send(loginPage(req.query.e === '1'));
  });
  app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
    if (!config.dashboardPassword || safeEqual(req.body.password || '', config.dashboardPassword)) {
      res.cookie('sp_auth', authToken(), {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });
      return res.redirect('/');
    }
    res.redirect('/login?e=1');
  });
  app.get('/logout', (_req, res) => {
    res.clearCookie('sp_auth');
    res.redirect('/login');
  });

  app.use(requireAuth); // everything below requires the password (if set)
  app.use(express.json({ limit: '96mb' })); // large enough to restore a full backup

  // EMERGENCY STOP gate: while engaged, block every route that could make a
  // paid API call (scanning, verifying, special-request runs). Read-only routes,
  // exports, and the stop-control route itself stay available so you can still
  // see your leads and release the stop. Kept BEFORE express.static so it also
  // guards the API cleanly.
  const PAID_PATHS = [
    '/api/scan', '/api/verify-websites', '/api/find-owners',
    '/api/find-emails', '/api/verify-phones',
  ];
  app.use((req, res, next) => {
    if (!isStopped()) return next();
    const p = req.path;
    const isPaid = PAID_PATHS.includes(p)
      || /^\/api\/special-requests\/[^/]+\/run$/.test(p)
      || /^\/api\/leads\/[^/]+\/recheck$/.test(p);
    if (isPaid) {
      return res.status(423).json({ error: 'Emergency stop is engaged — scanning and paid API calls are blocked. Release it to run again.', stopped: true });
    }
    next();
  });
  app.use(express.static(config.publicDir, {
    // Always revalidate HTML and JS (cheap 304s via ETag) so a freshly deployed
    // page shell can never run a stale cached script — a mismatch there can
    // leave the page blank and unable to refresh. Other assets cache normally.
    setHeaders(res, path) {
      if (/\.(html|js)$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // Metadata for the UI (filters, categories, metros, mode)
  app.get('/api/meta', (_req, res) => {
    res.json({
      live: isLive(),
      provider: isLive() ? 'google-places' : 'demo',
      searchReady: searchReady(),
      searchUsage: searchUsage(),
      auditMode: config.auditMode,
      categories: CATEGORIES.map((c) => ({ key: c.key, label: c.label, tier: c.tier })),
      metros: METROS.map((m) => ({ city: m.city, state: m.state, metroPopulation: m.metroPopulation })),
      states: [...new Set(STATES())].sort(),
      reps: config.reps,
      autoScan: scheduler.status(),
    });
    function STATES() {
      return store.all().map((l) => l.business?.state).filter(Boolean);
    }
  });

  // Auto-pilot status
  app.get('/api/auto', (_req, res) => res.json(scheduler.status()));

  // Turn the auto-scanner on/off from the dashboard (persists across restarts).
  app.post('/api/auto/toggle', (req, res) => {
    scheduler.setEnabled(Boolean(req.body?.enabled));
    res.json({ ok: true, ...scheduler.status() });
  });

  // ── EMERGENCY STOP: one button that halts the whole prospector ─────────────
  // Engaging it (1) blocks every paid route via the middleware above, (2) turns
  // the auto-scanner off, and (3) turns the cloud hunt off in Supabase. Nothing
  // can bill you until you deliberately release it.
  app.get('/api/emergency-stop', (_req, res) => res.json(stopState()));
  app.post('/api/emergency-stop', async (req, res) => {
    const on = Boolean(req.body?.stopped);
    if (on) {
      engage('Emergency stop engaged from the dashboard.');
      scheduler.setEnabled(false); // stop the droplet auto-scanner
      if (supabaseReady()) {
        try {
          const cur = await getHuntControl();
          await setHuntControl({ enabled: false, stopAfter: cur.stopAfter });
        } catch (err) { log.warn(`emergency-stop: could not disable cloud hunt: ${err.message}`); }
      }
    } else {
      release();
    }
    res.json({ ok: true, ...stopState() });
  });

  // ── Cloud hunt control (the month-long blitz kill switch + auto-stop date) ──
  // These read/write the shared Supabase record the GitHub-Actions hunt obeys,
  // so the buttons work even while this droplet is the thing that's down.
  app.get('/api/hunt/control', async (_req, res) => {
    if (!supabaseReady()) return res.json({ available: false });
    try {
      const c = await getHuntControl();
      res.json({ available: true, ...c });
    } catch (err) { res.status(502).json({ available: true, error: err.message }); }
  });
  app.post('/api/hunt/control', async (req, res) => {
    if (!supabaseReady()) return res.status(400).json({ error: 'Supabase not configured.' });
    try {
      const enabled = Boolean(req.body?.enabled);
      // stopAfter: 'YYYY-MM-DD' or null. Keep the existing date if not supplied.
      let stopAfter = req.body?.stopAfter;
      if (stopAfter === undefined) stopAfter = (await getHuntControl()).stopAfter;
      if (stopAfter && !/^\d{4}-\d{2}-\d{2}$/.test(stopAfter)) return res.status(400).json({ error: 'stopAfter must be YYYY-MM-DD.' });
      const out = await setHuntControl({ enabled, stopAfter: stopAfter || null });
      res.json({ ok: true, ...out });
    } catch (err) { res.status(502).json({ error: err.message }); }
  });

  // ── Customers (a lead who said "yes") ──────────────────────────────────────
  // Contact + deal info only. Payment is collected through Stripe — this store
  // never holds a card number (see customers.js). stripeReady tells the UI
  // whether the "Send payment link" action can work yet.
  app.get('/api/customers', (_req, res) => {
    res.json({ customers: custStore.all(), stripeReady: Boolean(config.stripeSecretKey) });
  });
  app.post('/api/customers', (req, res) => {
    try {
      const c = custStore.create(req.body || {});
      res.json({ ok: true, customer: c });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.patch('/api/customers/:id', (req, res) => {
    const c = custStore.update(req.params.id, req.body || {});
    if (!c) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ ok: true, customer: c });
  });
  app.delete('/api/customers/:id', (req, res) => {
    const ok = custStore.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ ok: true });
  });
  // Create a secure Stripe payment/subscription link for a customer. The card is
  // entered on Stripe's hosted page — never here. Requires STRIPE_SECRET_KEY +
  // STRIPE_PRICE_ID; until those exist it returns a clear "set up Stripe" message.
  app.post('/api/customers/:id/payment-link', async (req, res) => {
    const c = custStore.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Customer not found.' });
    if (!config.stripeSecretKey || !config.stripePriceId) {
      return res.status(400).json({ error: 'Stripe isn\'t set up yet. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to enable payment links.' });
    }
    try {
      // Stripe Payment Links API — form-encoded, no SDK needed. Creates a
      // reusable hosted checkout for the recurring plan price.
      const body = new URLSearchParams();
      body.set('line_items[0][price]', config.stripePriceId);
      body.set('line_items[0][quantity]', '1');
      const r = await fetch('https://api.stripe.com/v1/payment_links', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || `Stripe ${r.status}`);
      custStore.update(c.id, { paymentStatus: 'link_sent', activityNote: `Payment link created: ${d.url}` });
      res.json({ ok: true, url: d.url });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // ── Generate + publish a demo website for a lead (Netlify) ─────────────────
  // "I already built you one — here's the link." Builds a self-contained,
  // theme-varied one-pager from the lead's real info and publishes it to
  // Netlify. Needs NETLIFY_TOKEN. Stores the URL on the lead so it persists.
  app.post('/api/leads/:id/website', async (req, res) => {
    const lead = store.get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!netlifyReady()) {
      return res.status(400).json({ error: 'Netlify isn\'t set up yet. Add NETLIFY_TOKEN to .env to publish sites.' });
    }
    try {
      const biz = { ...(lead.business || {}), id: lead.id };
      // Embed the hero photo in the HTML so the page's key visual is guaranteed
      // (hotlinks remain the fallback for the rest of the imagery).
      biz._heroDataUri = await fetchHeroDataUri(biz.category);
      const html = buildSiteHtml(biz);
      const deployed = await deploySite({ files: { '/index.html': html } });
      // Persist the URL on the lead so the dashboard shows "View site" next time.
      lead.business = lead.business || {};
      lead.business.demoSiteUrl = deployed.url;
      lead.business.demoSiteAt = new Date().toISOString();
      store.save();
      // AUTO-CREATE the customer record too (one click = site + customer). If a
      // customer already exists for this lead, just attach the site URL to it —
      // never a duplicate.
      let customer = custStore.findByLead(lead.id);
      if (customer) {
        custStore.update(customer.id, { demoSiteUrl: deployed.url, activityNote: `Demo website generated: ${deployed.url}` });
      } else {
        const b = lead.business;
        customer = custStore.create({
          leadId: lead.id,
          businessName: b.name || '',
          ownerName: b.ownerName || '',
          phone: b.phone || '',
          email: b.email || '',
          website: b.website || '',
          address: b.address || '',
          city: b.city || '',
          state: b.state || '',
          demoSiteUrl: deployed.url,
          notes: `Auto-created when their demo website was generated (${deployed.url}).`,
        });
      }
      res.json({ ok: true, url: deployed.url, adminUrl: deployed.adminUrl, customerId: customer.id });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // Re-score every stored lead in place (regenerate openers + full script).
  // No API calls; preserves status/notes/first-seen.
  app.post('/api/rescore', (_req, res) => {
    let n = 0;
    for (const lead of store.all()) {
      if (!lead.business || !lead.audit) continue;
      lead.score = scoreLead(lead.business, lead.audit);
      n++;
    }
    store.save();
    res.json({ ok: true, rescored: n });
  });

  // Verify "no website" leads by searching Google (Gemini grounding).
  app.post('/api/verify-websites', async (_req, res) => {
    if (!searchReady()) return res.status(400).json({ error: 'No web-search key set (ANTHROPIC_API_KEY or GEMINI_API_KEY).' });
    if (scanning) return res.status(409).json({ error: 'Busy — a scan is running.' });
    scanning = true;
    try {
      const result = await verifyMissingWebsites({ store, limit: 100 });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      scanning = false;
    }
  });

  // Find owner names (batched).
  app.post('/api/find-owners', async (_req, res) => {
    if (!searchReady()) return res.status(400).json({ error: 'No web-search key set (ANTHROPIC_API_KEY or GEMINI_API_KEY).' });
    if (scanning) return res.status(409).json({ error: 'Busy — a scan is running.' });
    scanning = true;
    try {
      const result = await enrichOwners({ store, limit: 100 });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      scanning = false;
    }
  });

  // Force a fresh website check on ONE lead (per-lead "re-check" button).
  app.post('/api/leads/:id/recheck', async (req, res) => {
    if (!searchReady()) return res.status(400).json({ error: 'No web-search key set (ANTHROPIC_API_KEY or GEMINI_API_KEY).' });
    if (scanning) return res.status(409).json({ error: 'Busy — a scan is running.' });
    scanning = true;
    try {
      const result = await recheckLead({ store, id: req.params.id });
      if (!result.ok) return res.status(404).json(result);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      scanning = false;
    }
  });

  // Find contact emails on lead websites (batched so the request returns).
  app.post('/api/find-emails', async (_req, res) => {
    if (scanning) return res.status(409).json({ error: 'Busy — a scan is running.' });
    scanning = true;
    try {
      const result = await enrichEmails({ store, limit: 250 });
      const verified = await verifyEmails({ store }); // MX-check any unverified emails (free)
      res.json({ ok: true, ...result, verified });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      scanning = false;
    }
  });

  // How many numbers still need line-typing — powers the cost preview so a run
  // can never surprise-bill. Twilio charges ~$0.008 per line-type lookup.
  const TWILIO_COST_PER = 0.008;
  const PHONE_BATCH_MAX = 250; // hard cap per call so one click can't drain a balance
  app.get('/api/verify-phones/pending', (_req, res) => {
    const pending = store.all().filter(needsLineType).length;
    const u = twilioUsage(); // today's hard daily budget
    res.json({
      pending, ready: twilioReady(), costPer: TWILIO_COST_PER, batchMax: PHONE_BATCH_MAX,
      dailyUsed: u.used, dailyCap: u.cap, dailyRemaining: u.remaining,
    });
  });

  // Line-type phone numbers via Twilio so cold SMS skips landlines/VoIP.
  // HARD-CAPPED per call so a single click can never run away with cost.
  app.post('/api/verify-phones', async (req, res) => {
    if (!twilioReady()) return res.status(400).json({ error: 'Add TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN to .env and restart to line-type phones.' });
    if (scanning) return res.status(409).json({ error: 'Busy — a scan is running.' });
    const limit = Math.min(Math.max(1, Number(req.query?.limit) || PHONE_BATCH_MAX), PHONE_BATCH_MAX);
    scanning = true;
    try {
      const result = await verifyPhones({ store, limit });
      const remaining = store.all().filter(needsLineType).length;
      res.json({ ok: true, ...result, remaining, spentUsd: +(result.processed * TWILIO_COST_PER).toFixed(2) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      scanning = false;
    }
  });

  // Filtered leads + facet counts
  app.get('/api/leads', (req, res) => {
    const q = req.query;
    // Translate the dashboard's "view" tabs into concrete filters so paging
    // happens server-side (was client-side over the whole 10k set — the reason
    // the page loaded slowly). Only the requested page is serialized + sent.
    const view = q.view || 'all';
    const viewFilters = {};
    if (['new', 'called', 'no_answer', 'callback'].includes(view === 'tocall' ? 'new' : view === 'noanswer' ? 'no_answer' : view)) {
      viewFilters.status = view === 'tocall' ? 'new' : view === 'noanswer' ? 'no_answer' : view;
    } else if (view === 'numbers') viewFilters.hasPhone = true;
    else if (view === 'emails') viewFilters.hasEmail = true;
    else if (view === 'social') viewFilters.presence = 'social_only';

    const limit = Math.min(Number(q.limit) || 200, 500);
    const offset = Math.max(Number(q.offset) || 0, 0);
    // A search should look across everything, ignoring the view tab.
    const useView = !q.search;
    const { total, rows } = store.query({
      minScore: Number(q.minScore) || 0,
      state: q.state || undefined,
      category: q.category || undefined,
      presence: (useView && viewFilters.presence) || q.presence || undefined,
      status: useView ? viewFilters.status : undefined,
      tier: q.tier || undefined,
      rep: q.rep || undefined,
      hasPhone: useView ? viewFilters.hasPhone : undefined,
      hasEmail: useView ? viewFilters.hasEmail : undefined,
      problem: q.problem || undefined,
      search: q.search || undefined,
      sort: q.sort || 'score',
      limit,
      offset,
      withTotal: true,
    });
    // Cheap counts for the view tabs (numbers/emails/social) so the tabs stay
    // accurate even though we only ship one page of leads.
    const all = store.all();
    const viewCounts = {
      numbers: all.filter((l) => l.business?.phone).length,
      emails: all.filter((l) => l.business?.email && l.business?.emailStatus !== 'risky').length,
      social: all.filter((l) => l.presence === 'social_only').length,
    };
    res.json({ total, count: rows.length, offset, limit, leads: rows, facets: facets(all), viewCounts });
  });

  // Full single lead (used if the list ever goes light; also handy for deep links).
  app.get('/api/leads/:id', (req, res) => {
    const l = store.get(req.params.id);
    if (!l) return res.status(404).json({ error: 'not found' });
    res.json(l);
  });

  // ── Special Requests: bespoke, criteria-driven lead pulls (own tab) ────────
  app.get('/api/special-requests', (_req, res) => {
    res.json({
      requests: srStore.list(),
      homeServiceCategories: HOME_SERVICE_CATEGORIES,
      // Named multi-metro coverage presets (e.g. Midwest) for the new-request form.
      regions: Object.values(REGIONS).map((r) => ({ key: r.key, label: r.label, states: r.states, metroCount: r.metros.length })),
      live: isLive(),
      // Which enrichment sources are connected, so the tab can show status
      // instead of the user guessing whether a key took effect.
      sources: {
        places: isLive(),
        webSearch: searchReady(), // Gemini/Claude grounding
        googleCse: googleSearchReady(),
        apollo: apolloReady(),
        crunchbase: crunchbaseReady(),
        edgar: config.edgarEnabled,
        twilio: twilioReady(),
      },
    });
  });

  app.get('/api/special-requests/:id', (req, res) => {
    const r = srStore.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    res.json({ request: r, running: srRunning.has(r.id) });
  });

  app.post('/api/special-requests', (req, res) => {
    const b = req.body || {};
    const hasMetros = (Array.isArray(b.metros) && b.metros.length) || (b.region && REGIONS[b.region]);
    const hasPoint = b.location && b.location.lat != null && b.location.lng != null;
    if (!hasMetros && !hasPoint) {
      return res.status(400).json({ error: 'Provide a location with lat/lng, or a region/metros list.' });
    }
    const r = srStore.create(b);
    res.json({ ok: true, request: r });
  });

  app.delete('/api/special-requests/:id', (req, res) => {
    if (srRunning.has(req.params.id)) return res.status(409).json({ error: 'That request is still running.' });
    res.json({ ok: srStore.remove(req.params.id) });
  });

  // Kick off a run in the background; the tab polls GET /:id for progress.
  app.post('/api/special-requests/:id/run', (req, res) => {
    const r = srStore.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (srRunning.has(r.id)) return res.status(409).json({ error: 'Already running.' });
    srRunning.add(r.id);
    runSpecialRequest({ srStore, request: r })
      .catch((err) => log.warn(`special-request ${r.id} failed: ${err.message}`))
      .finally(() => srRunning.delete(r.id));
    res.json({ ok: true, status: 'running' });
  });

  app.get('/api/special-requests/:id/export.csv', (req, res) => {
    const r = srStore.get(req.params.id);
    if (!r) return res.status(404).send('Request not found');
    const cols = [
      { header: 'company_name', get: (l) => l.company },
      { header: 'owner', get: (l) => l.owner },
      { header: 'email', get: (l) => l.email },
      { header: 'email_status', get: (l) => l.emailStatus },
      { header: 'phone', get: (l) => l.phone },
      { header: 'address', get: (l) => l.address },
      { header: 'website', get: (l) => l.website },
      { header: 'city', get: (l) => l.city },
      { header: 'state', get: (l) => l.state },
      { header: 'category', get: (l) => l.category },
      { header: 'reviews', get: (l) => l.reviews },
      { header: 'rating', get: (l) => l.rating ?? '' },
      { header: 'est_revenue_usd', get: (l) => l.estRevenueUsd || '' },
      { header: 'crunchbase_revenue', get: (l) => l.crunchbase?.revenueRange || '' },
      { header: 'edgar_revenue_usd', get: (l) => l.edgar?.revenueUsd || '' },
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = (r.title || 'special-request').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-${stamp}.csv"`);
    res.send(toCsv(r.leads || [], cols));
  });

  app.get('/api/stats', (_req, res) => res.json(summary(store.all())));

  // Download a full backup of every lead (save it off-server so a lost droplet
  // never wipes your list again).
  app.get('/api/backup.json', (_req, res) => {
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="launchmedia-leads-backup-${stamp}.json"`);
    res.send(JSON.stringify(store.serialize()));
  });

  // One-click push of every lead to Supabase (durable cloud copy). Idempotent —
  // safe to click anytime; it upserts by id and verifies the row count.
  app.post('/api/sync-supabase', async (_req, res) => {
    if (!supabaseReady()) return res.status(400).json({ error: 'Add SUPABASE_URL + SUPABASE_SERVICE_KEY to .env and restart first.' });
    if (scanning) return res.status(409).json({ error: 'Busy — a scan is running.' });
    scanning = true;
    try {
      const { sent, total } = await syncLeads({ store });
      try { await syncSpecialRequests({ srStore }); } catch { /* non-fatal */ }
      const remote = await countLeads();
      res.json({ ok: true, sent, total, remote, verified: remote >= total });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      scanning = false;
    }
  });

  // Restore leads from an uploaded backup. Default 'merge' only ADDS leads you
  // don't already have (never deletes); 'replace' swaps the whole set.
  app.post('/api/restore', (req, res) => {
    if (scanning) return res.status(409).json({ error: 'Busy — a scan is running.' });
    const body = req.body || {};
    const leads = Array.isArray(body) ? body : body.leads;
    if (!Array.isArray(leads)) return res.status(400).json({ error: 'That file has no leads — is it a Launch Media backup?' });
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const result = store.restore(leads, mode);
    res.json({ ok: true, mode, ...result });
  });

  // Update outreach status / notes
  app.patch('/api/leads/:id', (req, res) => {
    const patch = {};
    if (typeof req.body.status === 'string') patch.status = req.body.status;
    if (typeof req.body.notes === 'string') patch.notes = req.body.notes;
    // Which sales rep is working / called this lead.
    if (typeof req.body.rep === 'string') patch.rep = req.body.rep;
    const updated = store.update(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: 'not found' });
    res.json(updated);
  });

  // Trigger a scan from the dashboard
  app.post('/api/scan', async (req, res) => {
    if (scanning) return res.status(409).json({ error: 'A scan is already running.' });
    // If Google Places is an opted-in source, enforce + record the daily Places
    // cap here too (this endpoint previously bypassed both). Free sources are
    // unaffected.
    const usesPaidPlaces = activeSources().includes('google-places');
    if (usesPaidPlaces) {
      const budget = getPlacesUsage();
      if (budget.remaining <= 0) {
        return res.status(429).json({ error: `Daily Google Places cap reached (${budget.used}/${budget.cap}). Try again tomorrow or scan with free sources.` });
      }
      placesCallsSince(true);
    }
    scanning = true;
    try {
      const { cities, cityList, categories, max, minScore, full } = req.body || {};
      if (full) config.auditMode = 'full';
      const metros = resolveMetros({ cities, cityList });
      const cats = resolveCats(categories);
      const { stats } = await runScan({
        metros,
        categories: cats,
        maxPerCity: Number(max) || 20,
        minScore: Number(minScore) || 0,
        store,
      });
      res.json({ ok: true, stats });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      if (usesPaidPlaces) addPlacesUsage(placesCallsSince(true));
      scanning = false;
    }
  });

  // CSV download honoring the active filters
  app.get('/api/export.csv', (req, res) => {
    const q = req.query;
    const leads = store.query({
      minScore: Number(q.minScore) || 0,
      state: q.state || undefined,
      category: q.category || undefined,
      presence: q.presence || undefined,
      status: q.status || undefined,
      sort: q.sort || 'score',
    });
    const cols = [
      { header: 'score', get: (l) => l.score?.value },
      { header: 'tier', get: (l) => l.score?.tier },
      { header: 'business', get: (l) => l.business?.name },
      { header: 'owner', get: (l) => l.business?.ownerName },
      { header: 'category', get: (l) => l.business?.categoryLabel },
      { header: 'city', get: (l) => l.business?.city },
      { header: 'state', get: (l) => l.business?.state },
      { header: 'phone', get: (l) => l.business?.phone },
      { header: 'email', get: (l) => l.business?.email },
      { header: 'website', get: (l) => l.business?.website },
      { header: 'presence', get: (l) => l.presence },
      { header: 'top_problem', get: (l) => l.audit?.problems?.[0]?.label },
      { header: 'reviews', get: (l) => l.business?.reviewCount },
      { header: 'rating', get: (l) => l.business?.rating },
      { header: 'est_opportunity_mo', get: (l) => l.score?.opportunityUsd },
      { header: 'google_maps', get: (l) => l.business?.googleMapsUri },
      { header: 'call_script', get: (l) => csvOpener(l, 'call') },
      { header: 'email_opener', get: (l) => csvOpener(l, 'email') },
      { header: 'sms_opener', get: (l) => csvOpener(l, 'sms') },
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="launchmedia-leads.csv"');
    res.send(toCsv(leads, cols));
  });

  // Shared column set for cold-email exports (email service-ready).
  const coldEmailCols = [
    { header: 'email', get: (l) => l.business.email },
    { header: 'email_status', get: (l) => l.business?.emailStatus || 'unverified' },
    { header: 'email_source', get: (l) => l.business?.emailSource || '' },
    { header: 'first_name', get: (l) => (l.business?.ownerName || '').split(/\s+/)[0] },
    { header: 'owner', get: (l) => l.business?.ownerName },
    { header: 'company_name', get: (l) => l.business?.name },
    { header: 'phone', get: (l) => l.business?.phone },
    { header: 'website', get: (l) => l.business?.website },
    { header: 'city', get: (l) => l.business?.city },
    { header: 'state', get: (l) => l.business?.state },
    { header: 'problem', get: (l) => l.audit?.problems?.[0]?.label },
    { header: 'est_opportunity_mo', get: (l) => l.score?.opportunityUsd },
    { header: 'icebreaker', get: (l) => icebreaker(l) },
    { header: 'full_email', get: (l) => csvOpener(l, 'email') },
  ];
  // A lead ready to be cold-emailed: has an email that isn't a known-dead domain
  // (keeps guaranteed bounces out and protects sender reputation).
  const emailable = (l) => l.business?.email && l.business?.emailStatus !== 'risky';

  // Instantly-ready export: ALL emailable leads (their service can suppress dupes).
  app.get('/api/export-instantly.csv', (req, res) => {
    const leads = store
      .query({
        minScore: Number(req.query.minScore) || 0,
        state: req.query.state || undefined,
        category: req.query.category || undefined,
        sort: 'score',
      })
      .filter(emailable);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="launchmedia-leads-instantly.csv"');
    res.send(toCsv(leads, coldEmailCols));
  });

  // Full daily columns — everything a sender/caller needs: contact, context, and
  // the complete email, SMS, and call scripts. Used for both daily lists.
  const dailyCols = [
    { header: 'company_name', get: (l) => l.business?.name },
    { header: 'first_name', get: (l) => (l.business?.ownerName || '').split(/\s+/)[0] },
    { header: 'owner', get: (l) => l.business?.ownerName },
    { header: 'email', get: (l) => l.business?.email },
    { header: 'email_status', get: (l) => l.business?.emailStatus || '' },
    { header: 'email_source', get: (l) => l.business?.emailSource || '' },
    { header: 'phone', get: (l) => l.business?.phone },
    { header: 'website', get: (l) => l.business?.website },
    { header: 'city', get: (l) => l.business?.city },
    { header: 'state', get: (l) => l.business?.state },
    { header: 'problem', get: (l) => l.audit?.problems?.[0]?.label },
    { header: 'reviews', get: (l) => l.business?.reviewCount },
    { header: 'rating', get: (l) => l.business?.rating },
    { header: 'score', get: (l) => l.score?.value },
    { header: 'tier', get: (l) => l.score?.tier },
    { header: 'est_opportunity_mo', get: (l) => l.score?.opportunityUsd },
    { header: 'icebreaker', get: (l) => icebreaker(l) },
    { header: 'email_script', get: (l) => csvOpener(l, 'email') },
    { header: 'sms_script', get: (l) => csvOpener(l, 'sms') },
    { header: 'call_script', get: (l) => l.score?.script || csvOpener(l, 'call') },
  ];
  const dailyEmailCols = dailyCols;
  // Phones list carries the line type so the sender can see mobile vs landline.
  const dailyPhoneCols = [...dailyCols, { header: 'line_type', get: (l) => l.business?.lineType || '' }];
  // "Fresh for this channel" = has the contact + we haven't saved it before.
  // Phones also skip numbers Twilio flagged as landline/VoIP (not textable). This
  // is a no-op until phones are line-typed, so it never hides numbers by default.
  const emailFresh = (l) => emailable(l) && !l.emailSavedAt;
  const textable = (l) => l.business?.lineType !== 'landline' && l.business?.lineType !== 'voip';
  const phoneFresh = (l) => l.business?.phone && !l.phoneSavedAt && textable(l);

  function sendDaily(res, ready, mark, cols, label) {
    const now = new Date().toISOString();
    for (const l of ready) l[mark] = now; // mark saved so it never repeats
    if (ready.length) store.save();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="launchmedia-daily-${label}-${now.slice(0, 10)}.csv"`);
    res.send(toCsv(ready, cols));
  }

  // DAILY EMAILS: only emailable leads whose email we haven't saved yet.
  app.get('/api/export-daily-emails.csv', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const ready = store.all().filter(emailFresh)
      .sort((a, b) => (b.score?.value ?? 0) - (a.score?.value ?? 0)).slice(0, limit);
    sendDaily(res, ready, 'emailSavedAt', dailyEmailCols, 'emails');
  });

  // DAILY PHONES: only leads whose phone number we haven't saved yet.
  app.get('/api/export-daily-phones.csv', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const ready = store.all().filter(phoneFresh)
      .sort((a, b) => (b.score?.value ?? 0) - (a.score?.value ?? 0)).slice(0, limit);
    sendDaily(res, ready, 'phoneSavedAt', dailyPhoneCols, 'phones');
  });

  // Counts for the dashboard button labels.
  app.get('/api/daily-count', (_req, res) => {
    const all = store.all();
    res.json({ emailsReady: all.filter(emailFresh).length, phonesReady: all.filter(phoneFresh).length });
  });

  // Undo: clear the 'saved' marks for a channel ('email' | 'phone' | 'all').
  app.post('/api/reset-exported', (req, res) => {
    const channel = req.query.channel || 'all';
    let n = 0;
    for (const l of store.all()) {
      if ((channel === 'all' || channel === 'email') && l.emailSavedAt) { delete l.emailSavedAt; n++; }
      if ((channel === 'all' || channel === 'phone') && l.phoneSavedAt) { delete l.phoneSavedAt; n++; }
    }
    store.save();
    res.json({ ok: true, reset: n, channel });
  });

  // Refresh every lead's openers/script on boot so a deploy always applies the
  // latest scoring + outreach logic (pure CPU, no API calls; leaves status/notes
  // untouched). This is what makes "git pull && restart" enough — no button click.
  let refreshed = 0;
  for (const lead of store.all()) {
    if (!lead.business || !lead.audit) continue;
    lead.score = scoreLead(lead.business, lead.audit);
    refreshed++;
  }
  if (refreshed) store.save();

  // 0.0.0.0 so it's reachable when hosted (containers/PaaS), not just locally.
  app.listen(config.port, '0.0.0.0', () => {
    log.title('LAUNCH MEDIA PROSPECTOR — dashboard');
    log.ok(`http://localhost:${config.port}`);
    if (!isLive()) log.warn('DEMO MODE (no Places key). Scans use sample data.');
    if (config.dashboardPassword) log.ok('Password login required.');
    else log.warn('No DASHBOARD_PASSWORD set — dashboard is open. Set one before hosting publicly.');
    log.info(`${store.size} leads loaded (${refreshed} scripts refreshed) · data in ${config.dataDir}`);
    scheduler.start(); // no-op unless AUTO_SCAN is enabled
  });
}

// ── helpers shared with the CLI semantics ─────────────────────────────────
function resolveMetros({ cities, cityList }) {
  if (Array.isArray(cityList) && cityList.length) {
    return cityList
      .map((raw) => {
        const [city, state] = String(raw).split(',').map((s) => s.trim());
        return (
          findMetro(city, state) ||
          (isLive() ? { city, state: state || '', lat: null, lng: null, metroPopulation: 500000, population: 250000 } : null)
        );
      })
      .filter(Boolean);
  }
  return topMetros(Number(cities) || 5);
}
function resolveCats(categories) {
  if (categories === 'all') return CATEGORIES;
  if (Array.isArray(categories) && categories.length) {
    const found = categories.map((k) => findCategory(k)).filter(Boolean);
    if (found.length) return found;
  }
  return defaultCategories();
}

function facets(all) {
  const f = { tier: {}, presence: {}, state: {}, category: {}, problem: {}, status: {} };
  for (const l of all) {
    inc(f.tier, l.score?.tier);
    inc(f.presence, l.presence);
    inc(f.state, l.business?.state);
    inc(f.category, l.business?.categoryLabel);
    inc(f.status, l.status || 'new');
    for (const p of l.audit?.problems || []) inc(f.problem, p.code);
  }
  return f;
}
const inc = (obj, k) => {
  if (k) obj[k] = (obj[k] || 0) + 1;
};

/** Pull a channel's opener text for CSV (falls back to the primary pitch). */
function csvOpener(l, channel) {
  const found = (l.score?.openers || []).find((o) => o.channel === channel);
  return found?.text || (channel === 'call' ? l.score?.pitch || '' : '');
}

/** A short, personalized first line for Instantly's {{icebreaker}} variable. */
function icebreaker(l) {
  const email = (l.score?.openers || []).find((o) => o.channel === 'email')?.text || '';
  if (email) {
    // email = "Subject: ...\n\nHi {name},\n\n<first body paragraph>\n\n..."
    const para = email.split('\n\n')[2];
    if (para && para.trim()) return para.trim();
  }
  return l.score?.pitch || '';
}

function summary(all) {
  const s = {
    total: all.length,
    byTier: { hot: 0, warm: 0, cool: 0, cold: 0 },
    byPresence: {},
    opportunityUsd: 0,
    noWebsite: 0,
  };
  for (const l of all) {
    if (l.score?.tier) s.byTier[l.score.tier]++;
    s.byPresence[l.presence] = (s.byPresence[l.presence] || 0) + 1;
    s.opportunityUsd += l.score?.opportunityUsd || 0;
    if (l.presence === 'none' || l.presence === 'social_only') s.noWebsite++;
  }
  return s;
}
