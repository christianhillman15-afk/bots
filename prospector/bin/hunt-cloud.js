#!/usr/bin/env node
/*
 * Cloud hunt — one scan "tick" designed to run from GitHub Actions (free),
 * with NO local server. It reads its place in the country from Supabase, scans
 * the next metro × category chunk with Google Places, enriches emails via the
 * free path (site-scraping + role/owner patterns), then upserts everything to
 * Supabase (preserving each lead's first-seen date + human status/notes) and
 * advances the cursor. Stateless: safe to run on a schedule forever.
 *
 * Required env (GitHub Secrets): SUPABASE_URL, SUPABASE_SERVICE_KEY,
 * GOOGLE_PLACES_API_KEY. Optional: GEMINI_API_KEY (adds web-search owner/email
 * — note the daily search cap is NOT persisted across Action runs, so leave it
 * off unless you accept that).
 */
import { config, isLive } from '../src/config.js';
import { LeadStore } from '../src/store.js';
import { runScan } from '../src/scan.js';
import { METROS } from '../src/data/metros.js';
import { CATEGORIES } from '../src/data/categories.js';
import { enrichEmails, verifyEmails } from '../src/enrich/emailFinder.js';
import { enrichOwners, verifyMissingWebsites, searchReady } from '../src/enrich/websiteFinder.js';
import { supabaseReady, getScanCursor, setScanCursor, fetchExistingMeta, pushLeads, countLeads } from '../src/supabase.js';
import { log } from '../src/logger.js';

async function main() {
  if (!supabaseReady()) { log.err('SUPABASE_URL + SUPABASE_SERVICE_KEY are required.'); process.exit(1); }
  if (!isLive()) { log.err('GOOGLE_PLACES_API_KEY is required for a live hunt.'); process.exit(1); }

  const cur = await getScanCursor();
  const metro = METROS[cur.metroIndex % METROS.length];
  const cats = CATEGORIES.slice(cur.catIndex, cur.catIndex + config.autoScanChunk);
  if (!cats.length) { log.warn('No categories at this cursor — resetting.'); await setScanCursor({ metroIndex: 0, catIndex: 0 }); return; }

  log.step(`cloud-hunt: ${metro.city}, ${metro.state} · ${cats.map((c) => c.label).join(', ')}`);

  // Ephemeral in-memory store just for this chunk (file lives in the throwaway
  // Action runner; the real persistence is Supabase).
  const store = new LeadStore('/tmp/hunt-scratch.json');
  const { stats } = await runScan({ metros: [metro], categories: cats, maxPerCity: config.autoScanMaxPerCity, store });

  // Enrich this chunk. With no GEMINI key, searchReady() is false → emails come
  // only from the FREE scrape/pattern path and the paid steps are skipped, so a
  // scheduled hunt can't run up a bill.
  if (config.autoEnrich) {
    try {
      const e = await enrichEmails({ store, limit: config.autoEnrichLimit });
      await verifyEmails({ store, limit: config.autoEnrichLimit });
      log.ok(`cloud-hunt: +${e.found || 0} emails (free path)`);
      if (searchReady()) {
        await enrichOwners({ store, limit: config.autoEnrichLimit });
        await verifyMissingWebsites({ store, limit: config.autoEnrichLimit });
      }
    } catch (err) { log.warn(`enrich skipped: ${err.message}`); }
  }

  // Preserve first-seen + human status/notes for leads that already exist.
  const chunkLeads = store.all();
  if (chunkLeads.length) {
    const existing = await fetchExistingMeta(chunkLeads.map((l) => l.id));
    for (const l of chunkLeads) {
      const m = existing.get(l.id);
      if (m) {
        if (m.firstSeen) l.firstSeen = m.firstSeen;
        if (m.status) l.status = m.status;
        if (m.notes != null) { l.notes = m.notes; if (l.business) l.business.notes = m.notes; }
      }
    }
    const { sent, skipped } = await pushLeads(chunkLeads);
    log.ok(`cloud-hunt: pushed ${sent} leads to Supabase${skipped ? ` (${skipped} skipped)` : ''} · +${stats.newLeads} new this chunk`);
  } else {
    log.info('cloud-hunt: no leads this chunk.');
  }

  // Advance the cursor breadth-first (new geography each tick), same as the
  // droplet scheduler.
  let { metroIndex, catIndex } = cur;
  metroIndex += 1;
  if (metroIndex >= METROS.length) {
    metroIndex = 0;
    catIndex += config.autoScanChunk;
    if (catIndex >= CATEGORIES.length) catIndex = 0;
  }
  await setScanCursor({ metroIndex, catIndex });
  const total = await countLeads().catch(() => null);
  log.ok(`cloud-hunt: cursor → metro ${metroIndex}/${METROS.length}, cat ${catIndex}/${CATEGORIES.length}${total != null ? ` · ${total} leads in Supabase` : ''}`);
}

main().catch((err) => { log.err(err.message); process.exit(1); });
