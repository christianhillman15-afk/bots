import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';

const HOUR = 60 * 60 * 1000;
const KEEP_SNAPSHOTS = 48; // ~2 days of hourly history

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

  /** The full store as a plain object (used for save + download backups). */
  serialize() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      count: this.leads.size,
      leads: [...this.leads.values()],
    };
  }

  save() {
    if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.serialize(), null, 2));
    this._snapshotIfDue();
  }

  /** Keep a rolling set of timestamped snapshots so a bad write or accidental
   * wipe never costs everything. Throttled to ~hourly; oldest are pruned. */
  _snapshotIfDue() {
    const now = Date.now();
    if (this._lastSnap && now - this._lastSnap < HOUR) return;
    this._lastSnap = now;
    try {
      const dir = resolve(config.dataDir, 'backups');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      writeFileSync(resolve(dir, `leads-${stamp}.json`), JSON.stringify(this.serialize()));
      const files = readdirSync(dir)
        .filter((f) => f.startsWith('leads-') && f.endsWith('.json'))
        .sort();
      for (const f of files.slice(0, Math.max(0, files.length - KEEP_SNAPSHOTS))) {
        try { unlinkSync(resolve(dir, f)); } catch { /* ignore */ }
      }
    } catch {
      /* snapshots are best-effort; never block a save */
    }
  }

  /** Restore from a backup. mode 'merge' adds missing leads (default, safe);
   * 'replace' swaps the whole set. Returns { before, after, added }. */
  restore(leads, mode = 'merge') {
    const before = this.leads.size;
    if (mode === 'replace') this.leads = new Map();
    let added = 0;
    for (const l of Array.isArray(leads) ? leads : []) {
      if (!l || !l.id) continue;
      if (!this.leads.has(l.id)) added++;
      if (mode === 'replace' || !this.leads.has(l.id)) this.leads.set(l.id, l);
    }
    this.save();
    return { before, after: this.leads.size, added };
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

  remove(id) {
    return this.leads.delete(id);
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
