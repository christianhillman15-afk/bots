import { clamp, round, usd } from '../util.js';

/*
 * The SURGE Fit Score answers one question:
 *   "How much money is this business losing to a bad/no website RIGHT NOW,
 *    and can they afford to pay us to fix it?"
 *
 * It's the intersection of three signals:
 *   1. PRESENCE PROBLEM  — how broken/absent their web presence is (the pain)
 *   2. AFFORDABILITY     — do they look established enough to pay $750–2,500/mo
 *   3. MARKET DEMAND     — how busy/populated their market is (size of the leak)
 *
 * A high-demand, well-reviewed business in a major metro with NO website is
 * the textbook "in shambles because of it" lead — and scores near 100.
 */

const WEIGHTS = { presence: 0.42, affordability: 0.32, market: 0.26 };

/** Reviews are the best free proxy we have for real revenue/volume. */
function reviewScore(reviewCount = 0) {
  if (reviewCount <= 0) return 0;
  // log-scaled: ~50 reviews ≈ 0.69, ~300 ≈ 1.0
  return clamp(Math.log10(reviewCount + 1) / Math.log10(301), 0, 1);
}

/** Metro population, log-scaled between ~100k and ~5M. */
function marketScore(metroPopulation = 0) {
  if (metroPopulation <= 0) return 0.3;
  const lo = 5; // log10(100k)
  const hi = Math.log10(5_000_000);
  return clamp((Math.log10(metroPopulation) - lo) / (hi - lo), 0, 1);
}

export function scoreLead(business, audit) {
  const reviews = business.reviewCount || 0;
  const rScore = reviewScore(reviews);
  const ratingScore = business.rating ? clamp((business.rating - 2.5) / 2.5, 0, 1) : 0.4;
  const catAfford = clamp(business.affordability ?? 0.5, 0, 1);
  const market = marketScore(business.metroPopulation);
  const severity = clamp(audit.severity ?? 0, 0, 1);

  // Affordability: established (lots of reviews) + reputable + lucrative trade.
  const affordability = clamp(0.5 * rScore + 0.2 * ratingScore + 0.3 * catAfford, 0, 1);

  const raw =
    WEIGHTS.presence * severity +
    WEIGHTS.affordability * affordability +
    WEIGHTS.market * market;
  const value = round(raw * 100);

  // ── Opportunity estimate (transparent, for the outreach pitch) ──────────
  // Deliberately conservative so the number stays credible in a cold pitch.
  // Realistic monthly jobs this business could book from online search...
  const estMonthlyLeads = round(2 + market * 12 + rScore * 16); // ~2–30
  // ...a broken/absent site forfeits ~25% of those would-be jobs...
  const lostJobs = estMonthlyLeads * severity * 0.25;
  // ...valued at the job ticket, but capped so $450k custom-home tickets
  // don't produce absurd figures. Whole estimate capped at $50k/mo.
  const effectiveTicket = Math.min(business.avgTicketUsd || 350, 12000);
  const opportunityUsd = clamp(round((lostJobs * effectiveTicket) / 100) * 100, 0, 50000);

  const tier =
    value >= 75 ? 'hot' : value >= 58 ? 'warm' : value >= 40 ? 'cool' : 'cold';
  const tierMeta = {
    hot: { emoji: '🔥', label: 'Hot' },
    warm: { emoji: '🟠', label: 'Warm' },
    cool: { emoji: '🔵', label: 'Cool' },
    cold: { emoji: '⚪', label: 'Cold' },
  }[tier];

  return {
    value,
    tier,
    emoji: tierMeta.emoji,
    label: tierMeta.label,
    breakdown: {
      presence: round(severity * 100),
      affordability: round(affordability * 100),
      market: round(market * 100),
    },
    estMonthlyLeads,
    opportunityUsd,
    reasons: buildReasons(business, audit, { affordability, market, reviews }),
    pitch: buildPitch(business, audit, { opportunityUsd }),
  };
}

function buildReasons(business, audit, { affordability, market, reviews }) {
  const r = [];
  // Pain
  if (audit.presence === 'none') {
    r.push(`No website at all — invisible to everyone who searches for ${business.categoryLabel?.toLowerCase() || 'them'} online.`);
  } else if (audit.presence === 'social_only') {
    r.push('Only has a social page — no real site they own, control, or can rank.');
  } else if (audit.presence === 'broken') {
    r.push('Their website is down, parked, or broken — customers hit a dead end.');
  } else {
    const top = (audit.problems || []).slice(0, 2).map((p) => p.label.toLowerCase());
    if (top.length) r.push(`Website problems: ${top.join('; ')}.`);
  }
  // Affordability / legitimacy
  if (reviews >= 100) r.push(`Established & busy — ${reviews} Google reviews (${business.rating || '?'}★) signals real, steady revenue.`);
  else if (reviews >= 25) r.push(`${reviews} reviews (${business.rating || '?'}★) — a real, operating business with cash flow.`);
  else if (reviews > 0) r.push(`${reviews} reviews — operating, worth a look.`);
  if ((business.avgTicketUsd || 0) >= 1500) r.push(`High-ticket trade (~${usd(business.avgTicketUsd)}/job) — one recovered customer pays for months of SURGE.`);
  // Market
  if (market >= 0.6) r.push(`Big, busy market (${business.city}, ${business.state}) — lots of demand leaking to competitors.`);
  return r;
}

function buildPitch(business, audit, { opportunityUsd }) {
  const name = business.name || 'there';
  const city = business.city ? ` in ${business.city}` : '';
  if (audit.presence === 'none') {
    return `Hey ${name} — I searched for ${business.categoryLabel?.toLowerCase() || 'your service'}${city} and couldn't find a website for you, just your Google listing. With ${business.reviewCount || 'your'} reviews you clearly do great work, but everyone comparing options online is landing on competitors instead. I can have a site that rings your phone live in ~14 days, $0 down. Worth a 10-min look?`;
  }
  if (audit.presence === 'social_only') {
    return `Hey ${name} — noticed your only web presence is a social page. You don't own or control it, and it can't rank on Google. For a business with your reviews that's leaving real money on the table${city}. Mind if I send a quick teardown + what a real site would do for you?`;
  }
  if (audit.presence === 'broken') {
    return `Hey ${name} — heads up, your website appears to be down/broken right now (${audit.problems?.[0]?.label?.toLowerCase() || 'not loading'}). Anyone who clicks it bounces straight to a competitor. I can show you exactly what's happening and rebuild it, $0 down. Want the 3-minute audit?`;
  }
  const top = audit.problems?.[0]?.label?.toLowerCase() || 'some issues';
  return `Hey ${name} — I ran a quick audit of your site and found ${top} (and a couple more). Quietly, that's costing you calls${city} — roughly ${usd(opportunityUsd)}/mo in jobs by my estimate. I made a short teardown video showing the fixes. Want me to send it over?`;
}
