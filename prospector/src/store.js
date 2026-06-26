import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';

/**
 * Dependency-free JSON-backed lead store.
 *
 * Leads are keyed by a stable id (see util.leadId) so repeated scans UPDATE
 * existing rows instead of creating duplicates. Plenty fast for tens of
 * thousands of leads; swap for SQLite/Postgres behind this same interface
 * if the list ever grows past that.
 */
export class LeadStore {
  constructor(file = resolve(config.dataDir, 'leads.json')) {
    this.file = file;
    this.leads = new Map();
    this._load();
  }

  _load() {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const lead of raw.leads || []) this.leads.set(lead.id, lead);
    } catch (err) {
      console.error(`Could not read lead store at ${this.file}: ${err.message}`);
    }
  }

  save() {
    if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      count: this.leads.size,
      leads: [...this.leads.values()],
    };
    writeFileSync(this.file, JSON.stringify(payload, null, 2));
  }

  /** Insert or merge a lead, preserving first-seen and outreach state. */
  upsert(lead) {
    const existing = this.leads.get(lead.id);
    if (existing) {
      const merged = {
        ...existing,
        ...lead,
        firstSeen: existing.firstSeen,
        lastSeen: new Date().toISOString(),
        // never clobber human-managed outreach state on a re-scan
        status: existing.status || lead.status || 'new',
        notes: existing.notes ?? lead.notes ?? '',
      };
      this.leads.set(lead.id, merged);
      return { lead: merged, isNew: false };
    }
    const now = new Date().toISOString();
    const fresh = {
      status: 'new',
      notes: '',
      ...lead,
      firstSeen: now,
      lastSeen: now,
    };
    this.leads.set(fresh.id, fresh);
    return { lead: fresh, isNew: true };
  }

  get(id) {
    return this.leads.get(id);
  }

  update(id, patch) {
    const existing = this.leads.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    this.leads.set(id, updated);
    this.save();
    return updated;
  }

  all() {
    return [...this.leads.values()];
  }

  get size() {
    return this.leads.size;
  }

  /** Filtered + sorted query for the dashboard / CLI. */
  query({
    minScore = 0,
    state,
    category,
    city,
    problem,
    status,
    presence,
    search,
    sort = 'score',
    limit = 0,
  } = {}) {
    let rows = this.all().filter((l) => (l.score?.value ?? 0) >= minScore);
    if (state) rows = rows.filter((l) => l.business?.state === state);
    if (city) rows = rows.filter((l) => (l.business?.city || '').toLowerCase() === city.toLowerCase());
    if (category)
      rows = rows.filter(
        (l) => l.business?.category === category || l.business?.categoryLabel === category
      );
    if (status) rows = rows.filter((l) => (l.status || 'new') === status);
    if (presence) rows = rows.filter((l) => l.presence === presence);
    if (problem) rows = rows.filter((l) => (l.audit?.problems || []).some((p) => p.code === problem));
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((l) =>
        [l.business?.name, l.business?.address, l.business?.website, l.business?.category]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q))
      );
    }
    const sorters = {
      score: (a, b) => (b.score?.value ?? 0) - (a.score?.value ?? 0),
      opportunity: (a, b) => (b.score?.opportunityUsd ?? 0) - (a.score?.opportunityUsd ?? 0),
      reviews: (a, b) => (b.business?.reviewCount ?? 0) - (a.business?.reviewCount ?? 0),
      recent: (a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''),
    };
    rows.sort(sorters[sort] || sorters.score);
    return limit > 0 ? rows.slice(0, limit) : rows;
  }
}
