import express from 'express';
import { config, isLive } from './config.js';
import { LeadStore } from './store.js';
import { runScan } from './scan.js';
import { writeCsv } from './export.js';
import { METROS, topMetros, findMetro } from './data/metros.js';
import { CATEGORIES, findCategory, defaultCategories } from './data/categories.js';
import { toCsv } from './util.js';
import { log } from './logger.js';

export function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(config.publicDir));

  const store = new LeadStore();
  let scanning = false;

  // Metadata for the UI (filters, categories, metros, mode)
  app.get('/api/meta', (_req, res) => {
    res.json({
      live: isLive(),
      provider: isLive() ? 'google-places' : 'demo',
      auditMode: config.auditMode,
      categories: CATEGORIES.map((c) => ({ key: c.key, label: c.label, tier: c.tier })),
      metros: METROS.map((m) => ({ city: m.city, state: m.state, metroPopulation: m.metroPopulation })),
      states: [...new Set(STATES())].sort(),
    });
    function STATES() {
      return store.all().map((l) => l.business?.state).filter(Boolean);
    }
  });

  // Filtered leads + facet counts
  app.get('/api/leads', (req, res) => {
    const q = req.query;
    const leads = store.query({
      minScore: Number(q.minScore) || 0,
      state: q.state || undefined,
      category: q.category || undefined,
      presence: q.presence || undefined,
      status: q.status || undefined,
      problem: q.problem || undefined,
      search: q.search || undefined,
      sort: q.sort || 'score',
      limit: Number(q.limit) || 0,
    });
    res.json({ count: leads.length, leads, facets: facets(store.all()) });
  });

  app.get('/api/stats', (_req, res) => res.json(summary(store.all())));

  // Update outreach status / notes
  app.patch('/api/leads/:id', (req, res) => {
    const patch = {};
    if (typeof req.body.status === 'string') patch.status = req.body.status;
    if (typeof req.body.notes === 'string') patch.notes = req.body.notes;
    const updated = store.update(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: 'not found' });
    res.json(updated);
  });

  // Trigger a scan from the dashboard
  app.post('/api/scan', async (req, res) => {
    if (scanning) return res.status(409).json({ error: 'A scan is already running.' });
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
      { header: 'category', get: (l) => l.business?.categoryLabel },
      { header: 'city', get: (l) => l.business?.city },
      { header: 'state', get: (l) => l.business?.state },
      { header: 'phone', get: (l) => l.business?.phone },
      { header: 'website', get: (l) => l.business?.website },
      { header: 'presence', get: (l) => l.presence },
      { header: 'top_problem', get: (l) => l.audit?.problems?.[0]?.label },
      { header: 'reviews', get: (l) => l.business?.reviewCount },
      { header: 'rating', get: (l) => l.business?.rating },
      { header: 'est_opportunity_mo', get: (l) => l.score?.opportunityUsd },
      { header: 'google_maps', get: (l) => l.business?.googleMapsUri },
      { header: 'pitch', get: (l) => l.score?.pitch },
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="surge-leads.csv"');
    res.send(toCsv(leads, cols));
  });

  app.listen(config.port, () => {
    log.title('SURGE PROSPECTOR — dashboard');
    log.ok(`http://localhost:${config.port}`);
    if (!isLive()) log.warn('DEMO MODE (no Places key). Scans use sample data.');
    log.info(`${store.size} leads loaded.`);
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
