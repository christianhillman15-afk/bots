#!/usr/bin/env node
import { config, isLive } from '../src/config.js';
import { runScan } from '../src/scan.js';
import { LeadStore } from '../src/store.js';
import { METROS, topMetros, findMetro } from '../src/data/metros.js';
import { CATEGORIES, findCategory, defaultCategories } from '../src/data/categories.js';
import { startServer } from '../src/server.js';
import { writeCsv } from '../src/export.js';
import { scoreLead } from '../src/scoring/leadScore.js';
import { enrichEmails } from '../src/enrich/emailFinder.js';
import { verifyMissingWebsites, enrichOwners, searchReady, findWebsite, guessWebsite } from '../src/enrich/websiteFinder.js';
import { log, color } from '../src/logger.js';
import { usd } from '../src/util.js';
import { syncLeads, countLeads, supabaseReady, syncSpecialRequests } from '../src/supabase.js';
import { SpecialRequestStore } from '../src/specialRequests.js';

// ── tiny arg parser ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        opts[key] = true;
      } else {
        // collect repeated flags (e.g. --city) into arrays
        if (opts[key] !== undefined) {
          opts[key] = Array.isArray(opts[key]) ? [...opts[key], next] : [opts[key], next];
        } else {
          opts[key] = next;
        }
        i++;
      }
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function resolveMetros(opts) {
  const cityFlags = asArray(opts.city);
  if (cityFlags.length) {
    const out = [];
    for (const raw of cityFlags) {
      const [city, state] = raw.split(',').map((s) => s.trim());
      const m = findMetro(city, state);
      if (m) out.push(m);
      else if (isLive())
        out.push({ city, state: state || '', lat: null, lng: null, metroPopulation: 500000, population: 250000 });
      else log.warn(`Unknown city "${raw}" (not in demo dataset) — skipping.`);
    }
    return out;
  }
  const n = Number(opts.cities) || 5;
  return topMetros(n);
}

function resolveCategories(opts) {
  const raw = opts.categories || opts.category;
  if (raw === 'all' || opts.all) return CATEGORIES;
  if (raw && raw !== true) {
    const keys = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const found = keys.map((k) => findCategory(k)).filter(Boolean);
    if (found.length) return found;
    log.warn(`No categories matched "${raw}" — using defaults.`);
  }
  return defaultCategories();
}

// ── commands ────────────────────────────────────────────────────────────
async function cmdScan(opts) {
  if (opts.full) config.auditMode = 'full';
  const metros = resolveMetros(opts);
  const categories = resolveCategories(opts);
  const maxPerCity = Number(opts.max) || 20;
  const minScore = Number(opts['min-score']) || 0;

  log.title('LAUNCH MEDIA PROSPECTOR — scan');
  if (!isLive()) {
    log.warn(color.yellow('DEMO MODE') + ' — no GOOGLE_PLACES_API_KEY set. Using realistic sample data.');
    log.info(color.gray('Set the key in .env to hunt real businesses nationwide.'));
  } else {
    log.ok(`Live mode · Google Places · audit=${config.auditMode}`);
  }
  log.info(
    `${metros.length} metro(s) × ${categories.length} categor(ies) · up to ${maxPerCity}/city`
  );

  const tty = process.stdout.isTTY;
  const { leads, stats } = await runScan({
    metros,
    categories,
    maxPerCity,
    minScore,
    onProgress: (p) => {
      if (!tty) return; // keep piped/log output clean
      if (p.phase === 'search') {
        process.stdout.write('\r' + `  ${color.cyan('search')} ${p.category.label} in ${p.metro.city}, ${p.metro.state}`.padEnd(70));
      } else if (p.phase === 'audit' && p.done % 5 === 0) {
        process.stdout.write('\r' + `  ${color.cyan('audit')} ${p.done}/${p.total} sites`.padEnd(70));
      }
    },
  });
  if (tty) process.stdout.write('\r'.padEnd(72) + '\r');

  log.ok(
    `Found ${stats.found} businesses → ${color.bold(stats.leads + ' leads')} ` +
      `(${stats.newLeads} new). ${color.red(stats.byTier.hot + ' 🔥 hot')}, ` +
      `${stats.byTier.warm} 🟠 warm, ${stats.byTier.cool} 🔵 cool.`
  );
  printPresence(stats.byPresence);
  console.log();
  printLeads(leads.slice(0, Number(opts.limit) || 15));
  log.info(color.gray(`\nSaved to ${config.dataDir}/leads.json · run "npm run serve" for the dashboard.`));
}

function cmdList(opts) {
  const store = new LeadStore();
  const rows = store.query({
    minScore: Number(opts['min-score']) || 0,
    state: opts.state,
    category: opts.category,
    presence: opts.presence,
    status: opts.status,
    sort: opts.sort || 'score',
    limit: Number(opts.limit) || 25,
  });
  if (opts.tier) {
    const filtered = rows.filter((l) => l.score?.tier === opts.tier);
    printLeads(filtered);
  } else {
    printLeads(rows);
  }
  log.info(color.gray(`${store.size} total leads stored.`));
}

function cmdStats() {
  const store = new LeadStore();
  const all = store.all();
  if (!all.length) return log.warn('No leads yet. Run a scan first: npm run scan');
  const byTier = { hot: 0, warm: 0, cool: 0, cold: 0 };
  const byPresence = {};
  const byState = {};
  let opp = 0;
  for (const l of all) {
    byTier[l.score?.tier] = (byTier[l.score?.tier] || 0) + 1;
    byPresence[l.presence] = (byPresence[l.presence] || 0) + 1;
    byState[l.business?.state] = (byState[l.business?.state] || 0) + 1;
    opp += l.score?.opportunityUsd || 0;
  }
  log.title('LEAD PIPELINE STATS');
  console.log(`  Total leads:        ${color.bold(all.length)}`);
  console.log(`  🔥 Hot / 🟠 Warm:    ${color.red(byTier.hot)} / ${byTier.warm}`);
  console.log(`  🔵 Cool / ⚪ Cold:    ${byTier.cool} / ${byTier.cold}`);
  console.log(`  Est. monthly opp.:  ${color.green(usd(opp))}/mo across pipeline`);
  printPresence(byPresence);
  const topStates = Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('  Top states:         ' + topStates.map(([s, n]) => `${s}(${n})`).join('  '));
}

function cmdExport(opts) {
  const store = new LeadStore();
  const rows = store.query({
    minScore: Number(opts['min-score']) || 0,
    state: opts.state,
    category: opts.category,
    presence: opts.presence,
    sort: opts.sort || 'score',
  });
  const tierRows = opts.tier ? rows.filter((l) => l.score?.tier === opts.tier) : rows;
  const file = writeCsv(tierRows, opts.out);
  log.ok(`Exported ${tierRows.length} leads → ${file}`);
}

function cmdServe(opts) {
  if (opts.port) config.port = Number(opts.port);
  startServer();
}

// Visit each lead's website and pull a contact email into the record.
async function cmdFindEmails(opts) {
  const store = new LeadStore();
  const tty = process.stdout.isTTY;
  log.title('LAUNCH MEDIA PROSPECTOR — find emails');
  log.info('Visiting lead websites to pull contact emails (sites only; no-website leads are phone-only)…');
  const res = await enrichEmails({
    store,
    limit: Number(opts.limit) || 0,
    onProgress: (p) => {
      if (tty && p.done % 5 === 0) process.stdout.write('\r' + `  checked ${p.done}/${p.total} · found ${p.found}`.padEnd(60));
    },
  });
  if (tty) process.stdout.write('\r'.padEnd(62) + '\r');
  log.ok(`Found ${res.found} emails (checked ${res.processed} sites)${res.remaining ? ` · ${res.remaining} still to check — run again` : ''}.`);
}

// Verify "no website" leads by actually searching Google (Gemini grounding).
async function cmdVerifyWebsites(opts) {
  const store = new LeadStore();
  const tty = process.stdout.isTTY;
  log.title('LAUNCH MEDIA PROSPECTOR — verify missing websites');
  if (!searchReady()) {
    log.err('No web-search key set. Add ANTHROPIC_API_KEY (Claude) or GEMINI_API_KEY to .env.');
    return;
  }
  log.info('Searching the web (by name + phone) for each "no website" lead to confirm or find their real site…');
  const res = await verifyMissingWebsites({
    store,
    limit: Number(opts.limit) || 0,
    onProgress: (p) => {
      if (tty && p.done % 3 === 0) process.stdout.write('\r' + `  checked ${p.done}/${p.total} · found ${p.foundSites} · removed ${p.removedOk}`.padEnd(64));
    },
  });
  if (tty) process.stdout.write('\r'.padEnd(66) + '\r');
  log.ok(`Done: ${res.foundSites} actually had sites (re-audited), ${res.removedOk} had fine sites (removed), ${res.confirmedNone} confirmed no website.`);
  if (res.failed) log.warn(`${res.failed} were throttled/errored — run again to retry them (free tier rate-limits; that's normal).`);
  if (res.remaining) log.info(`${res.remaining} leads still to check — run again.`);
}

// Find owner/principal names for leads (Gemini/Claude), personalizing openers.
async function cmdFindOwners(opts) {
  const store = new LeadStore();
  if (!searchReady()) {
    log.err('No web-search key set. Add GEMINI_API_KEY (or ANTHROPIC_API_KEY) to .env.');
    return;
  }
  log.title('LAUNCH MEDIA PROSPECTOR — find owner names');
  const res = await enrichOwners({
    store,
    limit: Number(opts.limit) || 0,
    onProgress: (p) => {
      if (process.stdout.isTTY && p.done % 3 === 0) process.stdout.write('\r' + `  checked ${p.done}/${p.total} · found ${p.found}`.padEnd(56));
    },
  });
  if (process.stdout.isTTY) process.stdout.write('\r'.padEnd(58) + '\r');
  log.ok(`Found ${res.found} owner names (checked ${res.processed}).`);
  if (res.failed) log.warn(`${res.failed} throttled — run again to retry.`);
  if (res.remaining) log.info(`${res.remaining} still to check — run again.`);
}

// Spot-check whether ONE business has a website — for verifying the detector.
//   node bin/prospector.js check --name "King Auto Collision Inc" --phone "718-..." --city Brooklyn --state NY
async function cmdCheck(opts) {
  const business = {
    name: opts.name || opts._.slice(1).join(' ') || '',
    phone: opts.phone || '',
    city: opts.city || '',
    state: opts.state || '',
    categoryLabel: opts.category || '',
  };
  if (!business.name) { log.err('Give a name: check --name "Business Name" [--phone .. --city .. --state ..]'); return; }
  log.title('LAUNCH MEDIA PROSPECTOR — website spot-check');
  log.info(`Business: ${business.name}${business.city ? ` · ${business.city}, ${business.state}` : ''}${business.phone ? ` · ${business.phone}` : ''}`);

  log.info('1) Free domain guess (name → domain, probe & confirm)…');
  const guess = await guessWebsite(business).catch(() => null);
  log.ok(`   guess: ${guess || 'nothing'}`);

  if (!searchReady()) {
    log.warn('No web-search key set — skipping grounded search. Add GEMINI_API_KEY or ANTHROPIC_API_KEY for the full check.');
  } else {
    log.info('2) Grounded web search (answer + mined sources)…');
    const r = await findWebsite(business).catch((e) => ({ ok: false, url: null, sources: [], error: e.message }));
    if (r.capped) log.warn('   search skipped — daily cap reached.');
    else if (!r.ok) log.warn('   search errored/throttled — try again.');
    else {
      log.ok(`   search answer: ${r.url || 'NONE'}`);
      const src = (r.sources || []).slice(0, 8);
      log.info(`   search saw ${src.length} source(s):`);
      for (const s of src) console.log('     • ' + s);
    }
  }
  const verdict = guess;
  console.log('');
  if (verdict) log.ok(`VERDICT: has a website → ${verdict}`);
  else log.warn('VERDICT: no website found by the free guess (grounded search results above may still reveal one).');
}

// Re-score every stored lead in place — regenerates openers + full call script
// from saved data. No API calls; keeps status, notes, and first-seen dates.
function cmdRescore() {
  const store = new LeadStore();
  const all = store.all();
  let n = 0;
  for (const lead of all) {
    if (!lead.business || !lead.audit) continue;
    lead.score = scoreLead(lead.business, lead.audit);
    lead.updatedAt = new Date().toISOString();
    n++;
  }
  store.save();
  log.ok(`Re-scored ${n} of ${all.length} leads — every one now has the latest openers + full call script.`);
}

// Push EVERY lead to Supabase (idempotent upsert), then VERIFY the count in
// Supabase matches the local count so we're certain nothing was missed.
async function cmdSyncSupabase() {
  if (!supabaseReady()) {
    log.err('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env first, then re-run.');
    process.exit(1);
  }
  const store = new LeadStore();
  const local = store.size;
  log.info(`Syncing ${local} leads to Supabase…`);
  const { sent, skipped } = await syncLeads({
    store,
    onProgress: ({ done, total }) => process.stdout.write(`\r  processed ${done}/${total}   `),
  });
  process.stdout.write('\n');
  if (skipped) log.warn(`${skipped} lead(s) skipped (corrupt characters in their data) — see the ⚠ lines above. The rest synced fine.`);
  // Special-request profiles too (best effort).
  try {
    const srStore = new SpecialRequestStore();
    const sr = await syncSpecialRequests({ srStore });
    if (sr.sent) log.ok(`Synced ${sr.sent} special-request profile(s).`);
  } catch { /* non-fatal */ }
  // VERIFY — the whole point: does Supabase now hold every lead?
  const remote = await countLeads();
  log.ok(`Pushed ${sent} leads. Supabase now holds ${remote} lead rows.`);
  const expected = local - skipped; // corrupt rows we deliberately skipped don't count
  if (remote >= expected) {
    log.ok(`✓ VERIFIED — Supabase has all ${expected} syncable leads${skipped ? ` (${skipped} skipped as corrupt)` : ''}. Nothing was missed.`);
  } else {
    log.warn(`⚠ Supabase has ${remote}, expected ${expected}. Re-run "npm run sync-supabase" — it's safe to repeat and will fill any gaps.`);
    process.exit(2);
  }
}

// ── pretty printers ───────────────────────────────────────────────────────
function printPresence(byPresence) {
  const labels = {
    none: 'No website',
    social_only: 'Social-only',
    broken: 'Broken/parked',
    weak: 'Weak site',
    ok: 'Fine (skipped)',
  };
  const parts = Object.entries(byPresence)
    .filter(([k]) => labels[k])
    .map(([k, n]) => `${labels[k]}: ${color.bold(n)}`);
  if (parts.length) console.log('  ' + parts.join('   '));
}

function printLeads(leads) {
  if (!leads.length) return log.warn('No matching leads.');
  const rows = leads.map((l) => [
    `${l.score.emoji}${String(l.score.value).padStart(3)}`,
    truncate(l.business.name, 26),
    truncate(`${l.business.city || ''}, ${l.business.state || ''}`, 18),
    truncate(l.business.categoryLabel || l.business.category || '', 16),
    presenceShort(l.presence),
    String(l.business.reviewCount ?? 0).padStart(4) + '★',
    usd(l.score.opportunityUsd).padStart(9),
    l.business.phone || '',
  ]);
  const headers = ['SCORE', 'BUSINESS', 'LOCATION', 'CATEGORY', 'PROBLEM', 'REVS', 'OPP/MO', 'PHONE'];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => stripAnsi(r[i]).length)));
  const fmt = (cells) =>
    cells.map((c, i) => c + ' '.repeat(Math.max(0, widths[i] - stripAnsi(c).length))).join('  ');
  console.log('  ' + color.gray(fmt(headers)));
  for (const r of rows) console.log('  ' + fmt(r));
}
const presenceShort = (p) =>
  ({ none: 'NO SITE', social_only: 'social-only', broken: 'BROKEN', weak: 'weak site', ok: 'ok' }[p] || p);
const truncate = (s, n) => (!s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s);
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

// ── help ───────────────────────────────────────────────────────────────────
function help() {
  console.log(`
${color.bold('Launch Media Prospector')} — find businesses with no/bad websites that can afford Launch Media.

${color.bold('Usage:')} prospector <command> [options]

${color.bold('Commands:')}
  scan      Hunt for leads across US metros × categories
  list      Show stored leads (filterable)
  stats     Summary of the lead pipeline
  export    Write leads to CSV for outreach
  rescore   Regenerate openers + full script on ALL stored leads (no API calls)
  find-emails  Visit lead websites and pull contact emails (--limit N optional)
  verify-websites  Google-search "no website" leads to confirm/find real sites (needs GEMINI_API_KEY)
  find-owners  Find owner/principal names to personalize outreach (needs GEMINI/ANTHROPIC key)
  check     Spot-check if ONE business has a website — check --name "Biz" [--phone .. --city .. --state ..]
  serve     Launch the web dashboard

${color.bold('scan options:')}
  --cities N            Use the top-N most populous metros (default 5)
  --city "Austin, TX"   Target a specific metro (repeatable)
  --category <key>      One category key (e.g. roofing). Repeatable / comma list.
  --categories all      Scan every category
  --max N               Max businesses per city per category (default 20)
  --min-score N         Only keep leads scoring >= N
  --full                Deep audit (PageSpeed Insights) for live sites
  --limit N             How many to print after scanning (default 15)

${color.bold('list / export options:')}
  --min-score N   --state TX   --category roofing   --tier hot
  --presence none|social_only|broken|weak   --sort score|opportunity|reviews|recent
  --limit N   --out <file.csv>   --status new|contacted|won|dead

${color.bold('Examples:')}
  npm run scan -- --cities 10 --categories all --max 20
  npm run scan -- --city "Houston, TX" --category roofing --full
  npm run list -- --tier hot --state TX
  npm run export -- --tier hot --out exports/hot-leads.csv
  npm run serve

Category keys: ${color.gray(CATEGORIES.map((c) => c.key).join(', '))}
`);
}

// ── dispatch ───────────────────────────────────────────────────────────────
const opts = parseArgs(process.argv.slice(2));
const cmd = opts._[0];
const run = {
  scan: () => cmdScan(opts),
  list: () => cmdList(opts),
  stats: () => cmdStats(opts),
  export: () => cmdExport(opts),
  serve: () => cmdServe(opts),
  rescore: () => cmdRescore(opts),
  'find-emails': () => cmdFindEmails(opts),
  'verify-websites': () => cmdVerifyWebsites(opts),
  'find-owners': () => cmdFindOwners(opts),
  'sync-supabase': () => cmdSyncSupabase(opts),
  check: () => cmdCheck(opts),
};
(async () => {
  if (!cmd || opts.help || cmd === 'help') return help();
  const fn = run[cmd];
  if (!fn) {
    log.err(`Unknown command "${cmd}"`);
    return help();
  }
  try {
    await fn();
  } catch (err) {
    log.err(err.message);
    if (opts.debug) console.error(err);
    process.exit(1);
  }
})();
