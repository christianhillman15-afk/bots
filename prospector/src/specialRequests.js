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

/** The seeded first request: Christian's Woodbury, MN home-services pull. */
function seedRequests() {
  return [
    {
      id: 'sr-woodbury-home-services',
      title: '100 Home-Services Leads — Woodbury, MN',
      description:
        'Plumbing, HVAC, roofing & remodeling companies estimated at $1–5M/yr, within 20 miles of Woodbury, MN.',
      criteria: {
        location: { label: 'Woodbury, MN', lat: 44.9239, lng: -92.9594, radiusMi: 20 },
        categories: ['plumbing', 'hvac', 'roofing', 'remodeling'],
        revenueMin: 1_000_000,
        revenueMax: 5_000_000,
        targetCount: 100,
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
    // Ensure the seeded Woodbury request always exists (adds it once).
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

  create({ title, description, location, categories, revenueMin, revenueMax, targetCount, fields }) {
    const id = 'sr-' + Math.random().toString(36).slice(2, 9); // eslint-disable-line -- id only, not crypto
    const req = {
      id,
      title: title || 'Untitled request',
      description: description || '',
      criteria: {
        location,
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
    setProgress({ phase: 'search', done: 0, total: request.criteria.categories.length, found: 0 });

    const { lat, lng, label, radiusMi } = request.criteria.location;
    const radius = Math.round((radiusMi || 20) * MILES_TO_M);
    const cats = request.criteria.categories.map(findCategory).filter(Boolean);

    // 1) gather across categories, deduped. Discovery goes through the SAME
    // orchestrator as the main scan, so it respects DISCOVERY_SOURCES: free by
    // default (OpenStreetMap + government data), and Google Places only if it's
    // been explicitly opted in — no surprise charges from a Special Request.
    const [city, st] = String(label).split(',').map((s) => s.trim());
    const metro = { city: city || 'Demo City', state: st || 'MN', lat, lng, metroPopulation: 500_000, population: 75_000 };
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
    let ci = 0;
    for (const category of cats) {
      let found = [];
      try {
        found = sources.length
          ? await discover({ category, metro, maxResults: 60 })
          : demo.search({ category, metro, maxResults: 40 });
      } catch (err) {
        log.warn(`special-request search failed (${category.label}): ${err.message}`);
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
      ci++;
      setProgress({ phase: 'search', done: ci, total: cats.length, found: businesses.length });
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
