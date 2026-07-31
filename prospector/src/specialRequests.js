import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, isLive } from './config.js';
import { discover, activeSources } from './providers/discovery.js';
import { placesCallsSince } from './providers/places.js';
import { getPlacesUsage, addPlacesUsage } from './placesUsage.js';
import * as demo from './providers/demo.js';
import { auditBusiness } from './audit/audit.js';
import { stripAudit } from './scan.js';
import { findOwner, findEmailWeb, guessWebsite, searchReady } from './enrich/websiteFinder.js';
import { findEmail, verifyMx } from './enrich/emailFinder.js';
import { findCategory, CATEGORIES } from './data/categories.js';
import { mapLimit, leadId } from './util.js';
import { log } from './logger.js';
import { enrichCrunchbase } from './enrich/crunchbase.js';
import { enrichEdgar } from './enrich/edgar.js';
import { findWebsiteGoogle, findOwnerGoogle, findEmailGoogle } from './enrich/googleSearch.js';
import { enrichApollo } from './enrich/apollo.js';

/*
 * Special Requests — bespoke, criteria-driven lead pulls that live in their own
 * tab, separate from the always-on Prospector scan. Each "request" is a saved
 * profile (location + categories + revenue band + how many) plus the leads it
 * produced, so a run can be organized, re-run, and exported on its own.
 */

const MILES_TO_M = 1609.34;

/*
 * Regions — named multi-metro coverage areas. A request can target a single
 * point+radius (the classic path) OR a whole region, in which case the run
 * sweeps every metro in the region across every chosen category. The Midwest
 * region spans the 12 US Census "Midwest" states, ~2 metros per state so the
 * coverage is even instead of Chicago-heavy.
 */
export const MIDWEST_METROS = [
  { city: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298 },
  { city: 'Springfield', state: 'IL', lat: 39.7817, lng: -89.6501 },
  { city: 'Indianapolis', state: 'IN', lat: 39.7684, lng: -86.1581 },
  { city: 'Fort Wayne', state: 'IN', lat: 41.0793, lng: -85.1394 },
  { city: 'Detroit', state: 'MI', lat: 42.3314, lng: -83.0458 },
  { city: 'Grand Rapids', state: 'MI', lat: 42.9634, lng: -85.6681 },
  { city: 'Columbus', state: 'OH', lat: 39.9612, lng: -82.9988 },
  { city: 'Cleveland', state: 'OH', lat: 41.4993, lng: -81.6944 },
  { city: 'Cincinnati', state: 'OH', lat: 39.1031, lng: -84.512 },
  { city: 'Milwaukee', state: 'WI', lat: 43.0389, lng: -87.9065 },
  { city: 'Madison', state: 'WI', lat: 43.0731, lng: -89.4012 },
  { city: 'Minneapolis', state: 'MN', lat: 44.9778, lng: -93.265 },
  { city: 'Saint Paul', state: 'MN', lat: 44.9537, lng: -93.09 },
  { city: 'Des Moines', state: 'IA', lat: 41.5868, lng: -93.625 },
  { city: 'Cedar Rapids', state: 'IA', lat: 41.9779, lng: -91.6656 },
  { city: 'Kansas City', state: 'MO', lat: 39.0997, lng: -94.5786 },
  { city: 'St. Louis', state: 'MO', lat: 38.627, lng: -90.1994 },
  { city: 'Wichita', state: 'KS', lat: 37.6872, lng: -97.3301 },
  { city: 'Overland Park', state: 'KS', lat: 38.9822, lng: -94.6708 },
  { city: 'Omaha', state: 'NE', lat: 41.2565, lng: -95.9345 },
  { city: 'Lincoln', state: 'NE', lat: 40.8136, lng: -96.7026 },
  { city: 'Fargo', state: 'ND', lat: 46.8772, lng: -96.7898 },
  { city: 'Bismarck', state: 'ND', lat: 46.8083, lng: -100.7837 },
  { city: 'Sioux Falls', state: 'SD', lat: 43.5446, lng: -96.7311 },
  { city: 'Rapid City', state: 'SD', lat: 44.0805, lng: -103.231 },
];

// Nationwide coverage — the major US metros where agencies concentrate. Used by
// the "USA" region (e.g. the Agencies tab). ~28 metros spanning every region.
export const USA_METROS = [
  { city: 'New York', state: 'NY', lat: 40.7128, lng: -74.006 },
  { city: 'Los Angeles', state: 'CA', lat: 34.0522, lng: -118.2437 },
  { city: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298 },
  { city: 'San Francisco', state: 'CA', lat: 37.7749, lng: -122.4194 },
  { city: 'Dallas', state: 'TX', lat: 32.7767, lng: -96.797 },
  { city: 'Houston', state: 'TX', lat: 29.7604, lng: -95.3698 },
  { city: 'Atlanta', state: 'GA', lat: 33.749, lng: -84.388 },
  { city: 'Boston', state: 'MA', lat: 42.3601, lng: -71.0589 },
  { city: 'Miami', state: 'FL', lat: 25.7617, lng: -80.1918 },
  { city: 'Seattle', state: 'WA', lat: 47.6062, lng: -122.3321 },
  { city: 'Washington', state: 'DC', lat: 38.9072, lng: -77.0369 },
  { city: 'Denver', state: 'CO', lat: 39.7392, lng: -104.9903 },
  { city: 'Austin', state: 'TX', lat: 30.2672, lng: -97.7431 },
  { city: 'Phoenix', state: 'AZ', lat: 33.4484, lng: -112.074 },
  { city: 'Philadelphia', state: 'PA', lat: 39.9526, lng: -75.1652 },
  { city: 'San Diego', state: 'CA', lat: 32.7157, lng: -117.1611 },
  { city: 'Minneapolis', state: 'MN', lat: 44.9778, lng: -93.265 },
  { city: 'Detroit', state: 'MI', lat: 42.3314, lng: -83.0458 },
  { city: 'Charlotte', state: 'NC', lat: 35.2271, lng: -80.8431 },
  { city: 'Nashville', state: 'TN', lat: 36.1627, lng: -86.7816 },
  { city: 'Portland', state: 'OR', lat: 45.5152, lng: -122.6784 },
  { city: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398 },
  { city: 'Tampa', state: 'FL', lat: 27.9506, lng: -82.4572 },
  { city: 'Orlando', state: 'FL', lat: 28.5383, lng: -81.3792 },
  { city: 'St. Louis', state: 'MO', lat: 38.627, lng: -90.1994 },
  { city: 'Columbus', state: 'OH', lat: 39.9612, lng: -82.9988 },
  { city: 'Indianapolis', state: 'IN', lat: 39.7684, lng: -86.1581 },
  { city: 'Salt Lake City', state: 'UT', lat: 40.7608, lng: -111.891 },
];

export const REGIONS = {
  midwest: {
    key: 'midwest',
    label: 'Midwest US (12 states)',
    states: ['IL', 'IN', 'MI', 'OH', 'WI', 'MN', 'IA', 'MO', 'KS', 'NE', 'ND', 'SD'],
    metros: MIDWEST_METROS,
  },
  usa: {
    key: 'usa',
    label: 'USA (28 major metros)',
    states: ['NationWide'],
    metros: USA_METROS,
  },
};

// Annual revenue is not exposed by Google. We estimate it from lifetime Google
// reviews × the category's typical job value. The factor turns "lifetime
// reviews" into a rough annual-jobs figure (only a few % of jobs get reviewed,
// accumulated over a few years). It's a PROXY for banding, clearly labelled as
// an estimate everywhere it surfaces — not a verified financial.
const REVENUE_PER_REVIEW = 8;

export function estimateRevenue(business) {
  const cat = findCategory(business.category);
  const ticket = business.avgTicketUsd || cat?.avgTicketUsd || 1500;
  const reviews = business.reviewCount || 0;
  return Math.round(ticket * reviews * REVENUE_PER_REVIEW);
}

/** The seeded requests: the Midwest home-services pull (Special Requests tab)
 * and the USA media-buying agency pull (Agencies tab). `kind` routes each to
 * its tab: 'special' (default) vs 'agency'. */
function seedRequests() {
  return [
    {
      id: 'sr-agencies-media-buying-usa',
      kind: 'agency',
      title: 'Advertising Agency Owners — Media Buying (USA)',
      description:
        'Advertising & media-buying agency owners across the USA (28 major metros). Owner name, agency address, direct phone, email & website. No revenue filter — every size, sort by fit yourself.',
      criteria: {
        location: { label: REGIONS.usa.label },
        region: 'usa',
        metros: REGIONS.usa.metros,
        categories: ['media-buying', 'advertising-agency'],
        revenueMin: 0,
        revenueMax: 0, // no band — pull all sizes
        targetCount: 500,
        fields: ['company', 'owner', 'phone', 'email', 'address', 'website'],
      },
      status: 'new',
      createdAt: new Date().toISOString(),
      progress: null,
      runStats: null,
      leads: [],
    },
    {
      id: 'sr-midwest-home-services',
      kind: 'special',
      title: 'Home-Services Leads — Midwest US',
      description:
        'Plumbing, HVAC, roofing & remodeling companies estimated at $2–10M/yr across the entire Midwest — all 12 states (IL, IN, MI, OH, WI, MN, IA, MO, KS, NE, ND, SD).',
      criteria: {
        location: { label: REGIONS.midwest.label },
        region: 'midwest',
        metros: REGIONS.midwest.metros,
        categories: ['plumbing', 'hvac', 'roofing', 'remodeling'],
        revenueMin: 2_000_000,
        revenueMax: 10_000_000,
        targetCount: 500,
        fields: ['company', 'owner', 'email', 'phone', 'address', 'website'],
      },
      status: 'new', // new | running | done | error
      createdAt: new Date().toISOString(),
      progress: null,
      runStats: null,
      leads: [],
    },
  ];
}

export class SpecialRequestStore {
  constructor(file) {
    this.file = file || resolve(config.dataDir, 'special-requests.json');
    this.requests = [];
    this._load();
  }

  _load() {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'));
        this.requests = Array.isArray(raw.requests) ? raw.requests : [];
      }
    } catch (err) {
      log.warn(`special-requests load failed: ${err.message}`);
      this.requests = [];
    }
    // One-time migration: the original seed was a single-city Woodbury, MN pull.
    // It's superseded by the Midwest region seed below. Drop the old one only if
    // it was never run / never customized (no leads) so we never destroy work.
    const old = this.requests.find((r) => r.id === 'sr-woodbury-home-services');
    if (old && !(old.leads || []).length && old.status !== 'done') {
      this.requests = this.requests.filter((r) => r.id !== old.id);
    }
    // Ensure the seeded Midwest request always exists (adds it once).
    for (const seed of seedRequests()) {
      if (!this.requests.some((r) => r.id === seed.id)) this.requests.push(seed);
    }
  }

  save() {
    if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(this.file, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), requests: this.requests }));
  }

  /** Lightweight list (no lead rows) for the tab's request cards. */
  list() {
    return this.requests.map((r) => ({
      id: r.id,
      kind: r.kind || 'special',
      title: r.title,
      description: r.description,
      criteria: r.criteria,
      status: r.status,
      createdAt: r.createdAt,
      progress: r.progress,
      runStats: r.runStats,
      leadCount: (r.leads || []).length,
    }));
  }

  get(id) {
    return this.requests.find((r) => r.id === id) || null;
  }

  create({ title, description, kind, location, region, metros, categories, revenueMin, revenueMax, targetCount, fields }) {
    const id = 'sr-' + Math.random().toString(36).slice(2, 9); // eslint-disable-line -- id only, not crypto
    // A named region preset (e.g. "midwest", "usa") expands into its metro list.
    const preset = region && REGIONS[region];
    const metroList = Array.isArray(metros) && metros.length ? metros : preset ? preset.metros : null;
    const req = {
      id,
      kind: kind === 'agency' ? 'agency' : 'special',
      title: title || 'Untitled request',
      description: description || '',
      criteria: {
        location: location || (preset ? { label: preset.label } : undefined),
        region: preset ? preset.key : undefined,
        metros: metroList || undefined,
        categories: Array.isArray(categories) ? categories : [],
        revenueMin: Number(revenueMin) || 0,
        revenueMax: Number(revenueMax) || 0,
        targetCount: Number(targetCount) || 50,
        fields: fields || ['company', 'owner', 'email', 'phone', 'address', 'website'],
      },
      status: 'new',
      createdAt: new Date().toISOString(),
      progress: null,
      runStats: null,
      leads: [],
    };
    this.requests.push(req);
    this.save();
    return req;
  }

  remove(id) {
    const before = this.requests.length;
    this.requests = this.requests.filter((r) => r.id !== id);
    if (this.requests.length !== before) this.save();
    return before !== this.requests.length;
  }
}

/** Turn an enriched business into the flat lead row the tab shows/exports. */
function toRow(b) {
  return {
    company: b.name || '',
    owner: b.ownerName || '',
    email: b.email || '',
    emailStatus: b.emailStatus || '',
    phone: b.phone || '',
    address: b.address || '',
    website: b.website || '',
    city: b.city || '',
    state: b.state || '',
    category: b.categoryLabel || b.category || '',
    reviews: b.reviewCount || 0,
    rating: b.rating || null,
    estRevenueUsd: b.estRevenueUsd || estimateRevenue(b),
    presence: b.presence || '',
    crunchbase: b.crunchbase || null,
    edgar: b.edgar || null,
  };
}

/** Contact-enrich one business in place: owner, website (if missing), email.
 * Sources are tried cheapest-first, each a best-effort no-op if not configured:
 *   website: HTTP-probe guess → Gemini/Claude → Google CSE
 *   owner:   Gemini/Claude → Google CSE
 *   email:   scrape site → web-search → Google CSE
 *   revenue: Crunchbase range + SEC EDGAR (public) annotations
 */
async function enrichBusiness(b) {
  // Apollo first — the strongest source for owner/decision-maker + direct
  // contact. Needs a domain, so guess the website first if Places has none.
  if (!b.website) {
    try { const g = await guessWebsite(b); if (g?.website) b.website = g.website; } catch { /* best effort */ }
  }
  try {
    const a = await enrichApollo(b);
    if (a) {
      if (a.owner) { b.ownerName = a.owner; b.ownerTitle = a.title; }
      if (a.email && !b.email) { b.email = a.email; b.emailSource = 'apollo'; }
      if (a.phone && !b.directPhone) b.directPhone = a.phone;
      b.apollo = { title: a.title, linkedin: a.linkedin };
    }
  } catch { /* best effort */ }
  // Website: guess one if Google Places has none.
  if (!b.website) {
    try {
      const g = await guessWebsite(b);
      if (g?.website) b.website = g.website;
    } catch { /* best effort */ }
    if (!b.website) {
      try {
        const w = await findWebsiteGoogle(b); // Google Custom Search JSON API
        if (w) b.website = w;
      } catch { /* best effort */ }
    }
  }
  // Owner name — personalization for outreach.
  if (!b.ownerName && searchReady()) {
    try {
      const o = await findOwner(b);
      if (o?.name) b.ownerName = o.name;
    } catch { /* best effort */ }
  }
  if (!b.ownerName) {
    try {
      const o = await findOwnerGoogle(b);
      if (o) b.ownerName = o;
    } catch { /* best effort */ }
  }
  // Email: scrape the site, else web-search, else mine Google CSE snippets.
  if (!b.email && b.website) {
    try {
      const r = await findEmail(b.website);
      if (r?.email) { b.email = r.email; b.emailSource = r.source; }
    } catch { /* best effort */ }
  }
  if (!b.email && searchReady()) {
    try {
      const r = await findEmailWeb(b);
      if (r?.ok && r.email) { b.email = r.email; b.emailSource = 'web-search'; }
    } catch { /* best effort */ }
  }
  if (!b.email) {
    try {
      const e = await findEmailGoogle(b);
      if (e) { b.email = e; b.emailSource = 'google-cse'; }
    } catch { /* best effort */ }
  }
  if (b.email) b.emailStatus = await verifyMx(b.email).catch(() => '');
  // Revenue annotations (key/flag-gated, silent no-ops otherwise).
  try {
    const cb = await enrichCrunchbase(b);
    if (cb) b.crunchbase = cb;
  } catch { /* best effort */ }
  try {
    const ed = await enrichEdgar(b);
    if (ed) b.edgar = ed;
  } catch { /* best effort */ }
}

/**
 * Run a special request end-to-end: location-scoped Places search across the
 * chosen categories → estimate revenue and keep the target band → cap to
 * targetCount → audit + contact-enrich each. Progress is written onto the
 * request object and persisted so the tab can poll it. Fire-and-forget safe:
 * always resolves, marking the request 'done' or 'error'.
 */
export async function runSpecialRequest({ srStore, request, onProgress = () => {} }) {
  const setProgress = (p) => {
    request.progress = p;
    onProgress(p);
    srStore.save();
  };
  try {
    request.status = 'running';
    request.leads = [];

    const cats = request.criteria.categories.map(findCategory).filter(Boolean);

    // Build the list of metros to sweep. A region request carries an explicit
    // metro list; a classic request has a single point+radius, which becomes a
    // one-metro sweep so the gather loop below is identical for both.
    const loc = request.criteria.location || {};
    let metros;
    if (Array.isArray(request.criteria.metros) && request.criteria.metros.length) {
      metros = request.criteria.metros.map((m) => ({
        city: m.city, state: m.state, lat: m.lat, lng: m.lng,
        metroPopulation: m.metroPopulation || 750_000, population: m.population || 100_000,
      }));
    } else {
      const [city, st] = String(loc.label || '').split(',').map((s) => s.trim());
      metros = [{ city: city || 'Demo City', state: st || 'MN', lat: loc.lat, lng: loc.lng, metroPopulation: 500_000, population: 75_000 }];
    }

    setProgress({ phase: 'search', done: 0, total: metros.length * cats.length, found: 0 });

    // 1) gather across metros × categories, deduped. Discovery goes through the
    // SAME orchestrator as the main scan, so it respects DISCOVERY_SOURCES: free
    // by default (OpenStreetMap + government data), and Google Places only if
    // it's been explicitly opted in — no surprise charges from a Special Request.
    const sources = activeSources();
    const usesPaidPlaces = sources.includes('google-places');
    if (usesPaidPlaces) {
      // Respect the daily Places cap on this path too (it previously bypassed it).
      const budget = getPlacesUsage();
      if (budget.remaining <= 0) {
        log.warn(`special-request: daily Places cap reached (${budget.used}/${budget.cap}).`);
      }
      placesCallsSince(true); // reset the billable counter for this run
    }
    const seen = new Set();
    const businesses = [];
    let step = 0;
    const totalSteps = metros.length * cats.length;
    for (const metro of metros) {
      for (const category of cats) {
        let found = [];
        try {
          found = sources.length
            ? await discover({ category, metro, maxResults: 60 })
            : demo.search({ category, metro, maxResults: 40 });
        } catch (err) {
          log.warn(`special-request search failed (${category.label} @ ${metro.city}, ${metro.state}): ${err.message}`);
        }
        for (const b of found) {
          b.category = category.key;
          b.categoryLabel = category.label;
          b.avgTicketUsd = category.avgTicketUsd;
          b.affordability = category.affordability;
          b.tier = category.tier;
          const id = leadId(b);
          if (seen.has(id)) continue;
          seen.add(id);
          businesses.push(b);
        }
        step++;
        setProgress({ phase: 'search', done: step, total: totalSteps, found: businesses.length });
      }
    }
    // Record any billable Places calls this run made against the daily cap.
    if (usesPaidPlaces) addPlacesUsage(placesCallsSince(true));

    // 2) estimate revenue, keep the target band, rank by fit, cap
    const { revenueMin, revenueMax, targetCount } = request.criteria;
    const mid = (revenueMin + revenueMax) / 2 || 1;
    const inBand = businesses
      .map((b) => { b.estRevenueUsd = estimateRevenue(b); return b; })
      .filter((b) => b.estRevenueUsd >= revenueMin && (!revenueMax || b.estRevenueUsd <= revenueMax))
      // closest to the middle of the band first, then most-reviewed
      .sort((a, b) =>
        Math.abs(a.estRevenueUsd - mid) - Math.abs(b.estRevenueUsd - mid) ||
        (b.reviewCount || 0) - (a.reviewCount || 0));
    const picked = inBand.slice(0, targetCount);

    // 3) audit web presence (also feeds website-guessing) + contact-enrich
    let done = 0;
    setProgress({ phase: 'enrich', done: 0, total: picked.length, found: picked.length });
    await mapLimit(picked, config.auditConcurrency, async (b) => {
      try {
        const audit = await auditBusiness(b);
        b.presence = audit.presence;
        b._audit = stripAudit(audit);
      } catch { /* audit best effort */ }
      await enrichBusiness(b);
      done++;
      if (done % 5 === 0 || done === picked.length) {
        setProgress({ phase: 'enrich', done, total: picked.length, found: picked.length });
      }
    });

    request.leads = picked.map(toRow);
    request.status = 'done';
    request.runStats = {
      searchedCategories: cats.length,
      searchedMetros: metros.length,
      gathered: businesses.length,
      inBand: inBand.length,
      kept: picked.length,
      withEmail: request.leads.filter((l) => l.email).length,
      withOwner: request.leads.filter((l) => l.owner).length,
      withWebsite: request.leads.filter((l) => l.website).length,
      finishedAt: new Date().toISOString(),
      live: isLive(),
    };
    request.progress = null;
    srStore.save();
    return request;
  } catch (err) {
    log.warn(`special-request run failed: ${err.message}`);
    request.status = 'error';
    request.progress = { phase: 'error', message: err.message };
    srStore.save();
    return request;
  }
}

export const HOME_SERVICE_CATEGORIES = CATEGORIES.filter((c) =>
  ['plumbing', 'hvac', 'roofing', 'remodeling', 'electrical', 'concrete', 'painting', 'landscaping', 'fencing', 'garage-door', 'siding', 'windows', 'gutters', 'flooring', 'water-restoration'].includes(c.key)
).map((c) => ({ key: c.key, label: c.label }));

/** Agency-vertical categories for the Agencies tab's new-list form. */
export const AGENCY_CATEGORIES = CATEGORIES.filter((c) => c.vertical === 'agency')
  .map((c) => ({ key: c.key, label: c.label }));
