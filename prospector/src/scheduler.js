import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { METROS } from './data/metros.js';
import { CATEGORIES } from './data/categories.js';
import { runScan } from './scan.js';
import { verifyMissingWebsites, enrichOwners, searchReady } from './enrich/websiteFinder.js';
import { enrichEmails, verifyEmails } from './enrich/emailFinder.js';
import { log } from './logger.js';

/**
 * Auto-pilot scanner. On a timer it scans the next slice of the
 * metros × categories matrix, then advances a cursor — sweeping the whole
 * country over time and accumulating leads with no manual clicks. The cursor
 * is persisted so it keeps its place across restarts.
 *
 * Shares the `isBusy/setBusy` flag with the manual scan endpoint so the two
 * never run at once.
 */
export function createScheduler({ store, isBusy, setBusy }) {
  const cursorFile = resolve(config.dataDir, 'cursor.json');
  let metroIndex = 0;
  let catIndex = 0;
  let lastRunAt = null;
  let lastResult = null;
  let lastTickMs = 0;
  let timer = null;

  if (existsSync(cursorFile)) {
    try {
      const s = JSON.parse(readFileSync(cursorFile, 'utf8'));
      metroIndex = s.metroIndex || 0;
      catIndex = s.catIndex || 0;
      lastRunAt = s.lastRunAt || null;
      lastResult = s.lastResult || null;
    } catch {
      /* start fresh */
    }
  }

  function save() {
    try {
      if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
      writeFileSync(cursorFile, JSON.stringify({ metroIndex, catIndex, lastRunAt, lastResult }, null, 2));
    } catch {
      /* non-fatal */
    }
  }

  async function tick() {
    if (!config.autoScan) return;
    if (isBusy()) {
      log.info('auto-scan: a scan is already running — skipping this tick');
      return;
    }
    const metro = METROS[metroIndex % METROS.length];
    const cats = CATEGORIES.slice(catIndex, catIndex + config.autoScanChunk);
    lastTickMs = Date.now();
    if (cats.length) {
      setBusy(true);
      try {
        log.step(`auto-scan: ${metro.city}, ${metro.state} · ${cats.map((c) => c.label).join(', ')}`);
        const { stats } = await runScan({
          metros: [metro],
          categories: cats,
          maxPerCity: config.autoScanMaxPerCity,
          store,
        });
        lastRunAt = new Date().toISOString();
        lastResult = {
          metro: `${metro.city}, ${metro.state}`,
          categories: cats.map((c) => c.label),
          found: stats.found,
          leads: stats.leads,
          newLeads: stats.newLeads,
        };
        log.ok(`auto-scan: +${stats.newLeads} new (${stats.leads} leads / ${stats.found} businesses)`);

        // Auto-clean + enrich: verify missing websites, then find emails.
        if (config.autoEnrich) {
          try {
            if (searchReady()) {
              const v = await verifyMissingWebsites({ store, limit: config.autoEnrichLimit });
              if (v.foundSites || v.removedOk) log.ok(`auto-verify: ${v.foundSites} real sites found, ${v.removedOk} removed (had fine sites)`);
              const o = await enrichOwners({ store, limit: config.autoEnrichLimit });
              if (o.found) log.ok(`auto-owners: +${o.found} owner names`);
            }
            const e = await enrichEmails({ store, limit: config.autoEnrichLimit });
            if (e.found) log.ok(`auto-emails: +${e.found} contact emails`);
            const ev = await verifyEmails({ store, limit: config.autoEnrichLimit });
            if (ev.processed) log.ok(`auto-verify-email: ${ev.valid} deliverable, ${ev.risky} risky`);
          } catch (err) {
            log.warn(`auto-enrich skipped: ${err.message}`);
          }
        }
      } catch (err) {
        log.err(`auto-scan failed: ${err.message}`);
      } finally {
        setBusy(false);
      }
    }
    // Advance the cursor BREADTH-FIRST: hit a different metro every tick so each
    // scan lands on fresh geography (all-new businesses), instead of grinding one
    // city's ~30 categories for a day before moving on. Only after sweeping the
    // same category block across every metro do we move to the next block.
    metroIndex += 1;
    if (metroIndex >= METROS.length) {
      metroIndex = 0;
      catIndex += config.autoScanChunk;
      if (catIndex >= CATEGORIES.length) catIndex = 0;
    }
    save();
  }

  function start() {
    if (!config.autoScan) return;
    const ms = Math.max(1, config.autoScanIntervalMin) * 60 * 1000;
    log.ok(
      `Auto-scan ON · every ${config.autoScanIntervalMin} min · ${config.autoScanChunk} categories/tick`
    );
    setTimeout(tick, 20_000); // first run shortly after boot so you see it work
    timer = setInterval(tick, ms);
    if (timer.unref) timer.unref();
  }

  function status() {
    const metro = METROS[metroIndex % METROS.length];
    return {
      enabled: config.autoScan,
      autoEnrich: config.autoEnrich,
      intervalMin: config.autoScanIntervalMin,
      chunk: config.autoScanChunk,
      maxPerCity: config.autoScanMaxPerCity,
      position: { metro: `${metro.city}, ${metro.state}` },
      lastRunAt,
      lastResult,
      nextRunAt:
        config.autoScan && lastTickMs
          ? new Date(lastTickMs + config.autoScanIntervalMin * 60 * 1000).toISOString()
          : null,
    };
  }

  return { start, status, tick };
}
