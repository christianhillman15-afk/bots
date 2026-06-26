#!/usr/bin/env node
import { config, isLive } from '../src/config.js';
import { runScan } from '../src/scan.js';
import { LeadStore } from '../src/store.js';
import { METROS, topMetros, findMetro } from '../src/data/metros.js';
import { CATEGORIES, findCategory, defaultCategories } from '../src/data/categories.js';
import { startServer } from '../src/server.js';
import { writeCsv } from '../src/export.js';
import { log, color } from '../src/logger.js';
import { usd } from '../src/util.js';

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

  log.title('SURGE PROSPECTOR — scan');
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
${color.bold('SURGE Prospector')} — find businesses with no/bad websites that can afford SURGE.

${color.bold('Usage:')} prospector <command> [options]

${color.bold('Commands:')}
  scan      Hunt for leads across US metros × categories
  list      Show stored leads (filterable)
  stats     Summary of the lead pipeline
  export    Write leads to CSV for outreach
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
