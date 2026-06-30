import { clamp, round, usd } from '../util.js';

/*
 * The Oxsome Fit Score answers one question:
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
  // Rating is a weak legitimacy signal for affordability. Treat it as
  // positive-only (more stars = more established) with a neutral floor, so an
  // unrated business never scores higher than a real, modestly-rated one.
  const NEUTRAL_RATING = 0.5;
  const ratingScore = business.rating
    ? Math.max(clamp((business.rating - 2.5) / 2.5, 0, 1), NEUTRAL_RATING)
    : NEUTRAL_RATING;
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

  const openers = buildOpeners(business, audit, { opportunityUsd, estMonthlyLeads });

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
    openers,
    pitch: openers[0]?.text || '', // primary opener, kept for CSV/back-compat
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
  if ((business.avgTicketUsd || 0) >= 1500) r.push(`High-ticket trade (~${usd(business.avgTicketUsd)}/job) — one recovered customer pays for months of Oxsome.`);
  // Market
  if (market >= 0.6) r.push(`Big, busy market (${business.city}, ${business.state}) — lots of demand leaking to competitors.`);
  return r;
}

/*
 * Build a set of ready-to-use outreach openers for Oxsome — one per channel,
 * each personalized with the business's name, trade, market, reviews, the exact
 * web problem, and the estimated money being lost. The first one is the primary
 * "pitch" used in CSV exports.
 */
function buildOpeners(business, audit, { opportunityUsd, estMonthlyLeads }) {
  const name = business.name || 'there';
  const cat = (business.categoryLabel || 'business').toLowerCase();
  const cityPhrase = business.city ? ` in ${business.city}, ${business.state || ''}`.trimEnd() : '';
  const reviews = business.reviewCount || 0;
  const rating = business.rating ? `${business.rating}★` : 'great reviews';
  const topProblem = audit.problems?.[0]?.label?.toLowerCase() || 'a few issues';
  const extraCount = Math.max(0, (audit.problems?.length || 1) - 1);
  const andMore = extraCount ? ` (plus ${extraCount} more)` : '';

  // The pain, phrased per presence type
  let problemShort; // for short channels
  let problemLong; // for email/call
  if (audit.presence === 'none') {
    problemShort = `I couldn't find a website for you anywhere — just your Google listing`;
    problemLong = `I went looking for your website and couldn't find one anywhere — just your Google Business listing`;
  } else if (audit.presence === 'social_only') {
    problemShort = `your only web presence is a social page you don't actually own`;
    problemLong = `the only web presence I could find is a social page — which you don't own, can't customize, and Google won't rank`;
  } else if (audit.presence === 'broken') {
    problemShort = `your website looks broken right now (${topProblem})`;
    problemLong = `your website appears to be down or broken right now (${topProblem}) — so anyone who clicks it hits a dead end and calls someone else`;
  } else {
    problemShort = `I ran a quick audit and your site has ${topProblem}${andMore}`;
    problemLong = `I ran a quick audit of your site and found ${topProblem}${andMore} — the kind of thing that quietly sends mobile visitors to a competitor`;
  }

  const proof =
    reviews >= 100
      ? `With ${reviews} reviews at ${rating}, you're clearly one of the busier ${cat}${cityPhrase}`
      : reviews >= 10
      ? `With ${reviews} reviews (${rating}) you're clearly doing real work${cityPhrase}`
      : `You're up and running${cityPhrase}`;

  const cost =
    opportunityUsd >= 500
      ? `my rough estimate is that's costing you around ${usd(opportunityUsd)}/month in jobs slipping to competitors`
      : `that's quietly sending customers to competitors who show up better online`;

  const offer = `At Oxsome we build you a modern, mobile, conversion-built website at $0 down, and our AI runs your SEO, Google Ads, and social posts from one place — so the phone actually rings. You only keep going if it's bringing you business.`;

  // ── Channel-specific openers ────────────────────────────────────────────
  const callScript =
    `Hi, is this ${name}? Great — my name's [your name] with Oxsome, we're a Minnesota web & marketing company. ` +
    `I'll be quick: I was looking up ${cat}${cityPhrase} and ${problemShort}. ${proof}, so it stood out to me — ${cost}. ` +
    `The reason I'm calling: we build small businesses a brand-new website at $0 down and our AI handles the SEO, Google Ads and social media so you get more calls. ` +
    `I'd love to send you a free 3-minute video showing exactly what I'd fix first — what's the best email or cell to send that to?`;

  const email =
    `Subject: ${name} — quick note about your ${cat} website\n\n` +
    `Hi ${name},\n\n` +
    `I came across ${name} while looking at ${cat}${cityPhrase}, and ${problemLong}. ${proof} — which is exactly why it caught my eye, because ${cost}.\n\n` +
    `I run Oxsome, a Minnesota agency that's built sites for 500+ small businesses (named the state's Best Web Designer three years running). ${offer}\n\n` +
    `Can I send over a free 3-minute video teardown of what I'd fix first? No obligation either way.\n\n` +
    `— [Your name], Oxsome\n612-261-0955 · oxsome.com`;

  const sms =
    `Hi ${name}, this is [your name] with Oxsome. I was looking at ${cat}${cityPhrase} and ${problemShort} — ` +
    `for a shop with ${reviews} reviews that's costing you calls. We build sites $0 down + our AI runs your SEO/ads/social. ` +
    `Can I text you a free 60-second audit?`;

  const videoHook =
    `Hey ${name} — I recorded you a free 3-minute video showing a few things on your online presence that are quietly ` +
    `sending ${cat} customers to your competitors${cityPhrase} (starting with: ${topProblem}). ` +
    `Want me to send it over? No pitch — just the teardown so you can fix it yourself or have us do it.`;

  return [
    { channel: 'call', label: '📞 Cold call / voicemail script', text: callScript },
    { channel: 'email', label: '✉️ Cold email', text: email },
    { channel: 'sms', label: '💬 Text message', text: sms },
    { channel: 'video', label: '🎬 Loom / DM video hook', text: videoHook },
  ];
}
