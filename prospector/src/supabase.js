import { config } from './config.js';
import { log } from './logger.js';

/*
 * Minimal Supabase client over PostgREST (no npm dependency — just fetch).
 * Uses the service_role key, so it bypasses RLS and can read/write everything.
 * Server-side only; the key is a secret and lives in .env / GitHub Secrets.
 */

export const supabaseReady = () => Boolean(config.supabaseUrl && config.supabaseServiceKey);

function headers(extra = {}) {
  return {
    apikey: config.supabaseServiceKey,
    Authorization: `Bearer ${config.supabaseServiceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

const rest = (path) => `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/${path}`;

/** Flatten one stored lead into a `leads` table row (+ full object in `data`). */
function leadRow(l) {
  const b = l.business || {};
  return {
    id: l.id,
    name: b.name || null,
    phone: b.phone || null,
    email: b.email || null,
    website: b.website || null,
    city: b.city || null,
    state: b.state || null,
    category: b.category || null,
    tier: l.score?.tier || null,
    presence: l.presence || null,
    status: l.status || 'new',
    score_value: l.score?.value ?? null,
    opportunity_usd: l.score?.opportunityUsd ?? null,
    line_type: b.lineType || null,
    email_status: b.emailStatus || null,
    email_saved_at: l.emailSavedAt || null,
    phone_saved_at: l.phoneSavedAt || null,
    line_type_checked: Boolean(b.lineTypeChecked),
    first_seen: l.firstSeen || null,
    last_seen: l.lastSeen || null,
    data: l, // full lead object — nothing is lost
    updated_at: new Date().toISOString(),
  };
}

/** Upsert a batch of leads (conflict on id → update). Returns count sent.
 * If the batch is too large for Supabase's request limit (400 "invalid json"),
 * it splits in half and retries — so it auto-adapts to however big the leads
 * are and no single oversized batch can stall the whole sync. */
async function upsertBatch(rows) {
  if (!rows.length) return 0;
  const res = await fetch(rest('leads?on_conflict=id'), {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    // Encode as a UTF-8 Buffer, not a string: lead scripts contain non-Latin1
    // characters (•, ·, em-dashes) and older Node's fetch throws a ByteString
    // error on string bodies with those. A Buffer sends the bytes directly.
    body: Buffer.from(JSON.stringify(rows), 'utf8'),
  });
  if (res.ok) return rows.length;
  const t = await res.text().catch(() => '');
  // Oversized body (or a request limit) → split and retry the halves.
  if ((res.status === 400 || res.status === 413) && rows.length > 1) {
    const mid = Math.ceil(rows.length / 2);
    return (await upsertBatch(rows.slice(0, mid))) + (await upsertBatch(rows.slice(mid)));
  }
  throw new Error(`Supabase upsert ${res.status}: ${t.slice(0, 300)}`);
}

/**
 * Push EVERY lead in the store to Supabase, in batches, idempotently (upsert by
 * id — safe to re-run). Returns { sent, total }. onProgress({sent,total}).
 */
export async function syncLeads({ store, batchSize = 200, onProgress = () => {} }) {
  if (!supabaseReady()) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.');
  const leads = store.all();
  let sent = 0;
  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize).map(leadRow);
    await upsertBatch(batch);
    sent += batch.length;
    onProgress({ sent, total: leads.length });
  }
  return { sent, total: leads.length };
}

/** How many lead rows are in Supabase right now (for verification). */
export async function countLeads() {
  const res = await fetch(rest('leads?select=id'), {
    method: 'HEAD',
    headers: headers({ Prefer: 'count=exact', Range: '0-0' }),
  });
  if (!res.ok && res.status !== 206) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase count ${res.status}: ${t.slice(0, 200)}`);
  }
  // PostgREST returns the total in the Content-Range header: "0-0/1234"
  const cr = res.headers.get('content-range') || '';
  const total = Number(cr.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

/** Upsert the special-request profiles too. */
export async function syncSpecialRequests({ srStore }) {
  if (!supabaseReady() || !srStore) return { sent: 0 };
  const rows = (srStore.requests || []).map((r) => ({
    id: r.id, title: r.title, description: r.description, status: r.status,
    criteria: r.criteria || {}, run_stats: r.runStats || null, progress: r.progress || null,
    leads: r.leads || [], updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return { sent: 0 };
  const res = await fetch(rest('special_requests?on_conflict=id'), {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: Buffer.from(JSON.stringify(rows), 'utf8'),
  });
  if (!res.ok) { log.warn(`special_requests sync ${res.status}`); return { sent: 0 }; }
  return { sent: rows.length };
}
