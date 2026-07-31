import { discover, activeSources } from './providers/discovery.js';
import { auditBusiness, isLead } from './audit/audit.js';
import * as demo from './providers/demo.js';
import { scoreLead } from './scoring/leadScore.js';
import { LeadStore } from './store.js';
import { config } from './config.js';
import { mapLimit, leadId } from './util.js';
import { STRICT_OUTREACH_STATES } from './data/metros.js';
import { log } from './logger.js';

/**
 * Run a full scan over the given metros × categories.
 * Returns the matched leads and a stats summary.
 */
export async function runScan({
  metros,
  categories,
  maxPerCity = 20,
  minScore = 0,
  store = new LeadStore(),
  onProgress = () => {},
} = {}) {
  // FREE discovery by default (OpenStreetMap + government open data). Falls back
  // to the built-in demo dataset only when literally no source is configured.
  const sources = activeSources();
  const useFree = sources.length > 0;
  const search = useFree
    ? (opts) => discover(opts)
    : (opts) => demo.search(opts);
  const audit = useFree
    ? (b) => auditBusiness(b)
    : (b) => demo.audit(b);
  const stats = {
    provider: useFree ? sources.join('+') : 'demo',
    live: useFree,
    searched: 0,
    found: 0,
    audited: 0,
    leads: 0,
    newLeads: 0,
    byPresence: {},
    byTier: { hot: 0, warm: 0, cool: 0, cold: 0 },
    startedAt: new Date().toISOString(),
  };

  // ── 1. Gather businesses across every metro × category ──────────────────
  const seen = new Set();
  const businesses = [];
  for (const metro of metros) {
    for (const category of categories) {
      stats.searched++;
      onProgress({ phase: 'search', metro, category, stats });
      let found = [];
      try {
        found = await search({ category, metro, maxResults: maxPerCity });
      } catch (err) {
        log.warn(`search failed (${category.label} in ${metro.city}): ${err.message}`);
        continue;
      }
      // The market leader = most-reviewed business in this city+category.
      // It's the "competitor stealing your calls" — captured free from the scan.
      const leader = found.reduce(
        (best, b) => ((b.reviewCount || 0) > (best?.reviewCount || 0) ? b : best),
        null
      );
      for (const b of found) {
        // enrich with the scoring metadata
        b.category = category.key;
        b.categoryLabel = category.label;
        b.avgTicketUsd = category.avgTicketUsd;
        b.affordability = category.affordability;
        b.tier = category.tier;
        b.city = b.city || metro.city;
        b.state = b.state || metro.state;
        b.metroPopulation = metro.metroPopulation;
        b.population = metro.population;
        if (leader && leader.placeId !== b.placeId && (leader.reviewCount || 0) > (b.reviewCount || 0)) {
          b.topCompetitor = { name: leader.name, rating: leader.rating, reviewCount: leader.reviewCount };
        }
        const id = leadId(b);
        if (seen.has(id)) continue;
        seen.add(id);
        b._id = id;
        businesses.push(b);
      }
      stats.found += found.length;
    }
  }

  // ── 2. Audit each business' web presence (bounded concurrency) ──────────
  let done = 0;
  const audited = await mapLimit(businesses, config.auditConcurrency, async (b) => {
    const auditResult = await audit(b);
    stats.audited++;
    done++;
    onProgress({ phase: 'audit', done, total: businesses.length, business: b, audit: auditResult, stats });
    return { business: b, audit: auditResult };
  });

  // ── 3. Score, filter to real leads, persist ─────────────────────────────
  const leads = [];
  for (const { business, audit } of audited) {
    stats.byPresence[audit.presence] = (stats.byPresence[audit.presence] || 0) + 1;
    if (!isLead(audit)) continue; // skip businesses whose site is fine

    const score = scoreLead(business, audit);
    if (score.value < minScore) continue;

    const lead = {
      id: business._id,
      score,
      presence: audit.presence,
      business: stripBusiness(business),
      audit: stripAudit(audit),
      compliance: {
        strictOutreachState: STRICT_OUTREACH_STATES.has(business.state),
      },
    };
    const { isNew } = store.upsert(lead);
    if (isNew) stats.newLeads++;
    stats.leads++;
    stats.byTier[score.tier]++;
    leads.push(store.get(lead.id));
  }

  store.save();
  stats.finishedAt = new Date().toISOString();
  leads.sort((a, b) => (b.score?.value ?? 0) - (a.score?.value ?? 0));
  return { leads, stats, store };
}

/* Keep the persisted record lean & free of internal scratch fields. */
function stripBusiness(b) {
  const { _demo, _id, ...rest } = b;
  return rest;
}
export function stripAudit(a) {
  return {
    presence: a.presence,
    headline: a.headline,
    severity: a.severity,
    healthScore: a.healthScore,
    problems: a.problems,
    pagespeed: a.pagespeed
      ? {
          performance: a.pagespeed.performance,
          seo: a.pagespeed.seo,
          bestPractices: a.pagespeed.bestPractices,
          accessibility: a.pagespeed.accessibility,
          lcpMs: a.pagespeed.lcpMs,
        }
      : null,
    probe: a.probe
      ? {
          finalUrl: a.probe.finalUrl,
          status: a.probe.status,
          https: a.probe.https,
          responseMs: a.probe.responseMs,
          title: a.probe.title,
        }
      : null,
  };
}
