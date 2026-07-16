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
import { supabaseReady, getScanCursor, setScanCursor, fetchExistingMeta, pushLeads, countLeads, getPlacesUsage, addPlacesUsage } from '../src/supabase.js';
import { placesCallsSince } from '../src/providers/places.js';
import { log } from '../src/logger.js';

async function main() {
  if (!supabaseReady()) { log.err('SUPABASE_URL + SUPABASE_SERVICE_KEY are required.'); process.exit(1); }
  if (!isLive()) { log.err('GOOGLE_PLACES_API_KEY is required for a live hunt.'); process.exit(1); }

  // DAILY PLACES BUDGET GUARD: stop scanning once today's cap is reached so the
  // hunt never bills past the free tier. (The hard guarantee is the daily quota
  // set on the Places API in Google Cloud; this is the in-app companion.)
  const budget = await getPlacesUsage();
  if (budget.remaining <= 0) {
    log.warn(`cloud-hunt: daily Places cap reached (${budget.used}/${budget.cap}). Skipping scan until tomorrow. No charge.`);
    return;
  }

  const cur = await getScanCursor();
  const metro = METROS[cur.metroIndex % METROS.length];
  const cats = CATEGORIES.slice(cur.catIndex, cur.catIndex + config.autoScanChunk);
  if (!cats.length) { log.warn('No categories at this cursor — resetting.'); await setScanCursor({ metroIndex: 0, catIndex: 0 }); return; }

  log.step(`cloud-hunt: ${metro.city}, ${metro.state} · ${cats.map((c) => c.label).join(', ')} · Places ${budget.used}/${budget.cap} today`);

  // Ephemeral in-memory store just for this chunk (file lives in the throwaway
  // Action runner; the real persistence is Supabase).
  placesCallsSince(true); // reset the billable-request counter for this tick
  const store = new LeadStore('/tmp/hunt-scratch.json');
  // Keep each tick small & fast so it always finishes and pushes (a scheduled
  // job should never be a long-running grind).
  const { stats } = await runScan({ metros: [metro], categories: cats, maxPerCity: 12, store });
  // Record the ACTUAL billable Places requests this tick made against the cap.
  await addPlacesUsage(placesCallsSince(true));

  // Light, FAST, FREE email pass only (bounded). Emails come from site-scraping
  // + role patterns — no Gemini owner/website lookups, which are slow and would
  // use an uncapped search budget in an ephemeral Action. Deeper enrichment is a
  // separate step; keeping the tick quick means it always finishes and pushes.
  if (config.autoEnrich) {
    try {
      const e = await enrichEmails({ store, limit: 40 });
      await verifyEmails({ store, limit: 40 });
      log.ok(`cloud-hunt: +${e.found || 0} emails (free scrape)`);
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
