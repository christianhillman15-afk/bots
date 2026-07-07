import { clamp, round, usd } from '../util.js';

/*
 * The Launch Media Fit Score answers one question:
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
  const hooks = buildHooks(business, audit);
  const script = buildScript(business, audit, { opportunityUsd });

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
    hooks,
    script,
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
  if ((business.avgTicketUsd || 0) >= 1500) r.push(`High-ticket trade (~${usd(business.avgTicketUsd)}/job) — one recovered customer pays for months of Launch Media.`);
  // Market
  if (market >= 0.6) r.push(`Big, busy market (${business.city}, ${business.state}) — lots of demand leaking to competitors.`);
  // Competitor angle
  if (business.topCompetitor?.name) r.push(`Competitor "${business.topCompetitor.name}" (${business.topCompetitor.reviewCount || 'many'} reviews) is outranking them and taking these customers.`);
  return r;
}

/*
 * Build a set of ready-to-use outreach openers for Launch Media — one per channel,
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
  const owner = (business.ownerName || '').trim().split(/\s+/)[0] || '';
  const comp = business.topCompetitor;
  const competitorLine = comp?.name
    ? ` Meanwhile ${comp.name} (${comp.reviewCount ? comp.reviewCount + '+ ' : ''}reviews) is showing up first and pulling in those customers.`
    : '';

  // The pain, phrased per presence type
  let problemShort; // for short channels
  let problemLong; // for email/call
  if (audit.presence === 'none') {
    problemShort = `I couldn't find a website for you anywhere — just your Google listing`;
    problemLong = `I went looking for your website and couldn't find one anywhere — just your Google Business listing`;
  } else if (audit.presence === 'social_only') {
    problemShort = `the only web presence I could find for you is a social page you don't actually own`;
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

  const offer = `At Launch Media we build you a modern, mobile, conversion-built website at $0 down, and our AI runs your SEO, Google Ads, and social posts from one place — so the phone actually rings. You only keep going if it's bringing you business.`;

  // ── Channel-specific openers ────────────────────────────────────────────
  const callScript =
    `Hi, is this ${owner || name}? Great — my name's Christian with Launch Media, we're a web & marketing company. ` +
    `I'll be quick: I was looking up ${cat}${cityPhrase} and ${problemShort}. ${proof}, so it stood out to me — ${cost}.${competitorLine} ` +
    `The reason I'm calling: we build small businesses a brand-new website at $0 down and our AI handles the SEO, Google Ads and social media so you get more calls. ` +
    `I'd love to send you a free 3-minute video showing exactly what I'd fix first — what's the best email or cell to send that to?`;

  const email =
    `Subject: ${name} — quick note about your ${cat} website\n\n` +
    `Hi ${owner || name},\n\n` +
    `I came across ${name} while looking at ${cat}${cityPhrase}, and ${problemLong}. ${proof} — which is exactly why it caught my eye, because ${cost}.${competitorLine}\n\n` +
    `I run Launch Media (wearelaunchmedia.com), a web & marketing agency that builds high-converting websites for local businesses. ${offer}\n\n` +
    `Can I send over a free 3-minute video teardown of what I'd fix first? No obligation either way.\n\n` +
    `— Christian, Launch Media\n(612) 443-9490 · https://wearelaunchmedia.com`;

  const sms =
    `Hi ${owner || name}, this is Christian with Launch Media. I was looking at ${cat}${cityPhrase} and ${problemShort} — ` +
    `for a shop with ${reviews} reviews that's costing you calls. We build sites $0 down + our AI runs your SEO/ads/social. ` +
    `Can I text you a free 60-second audit?`;

  const videoHook =
    `Hey ${owner || name} — I recorded you a free 3-minute video showing a few things on your online presence that are quietly ` +
    `sending ${cat} customers to your competitors${cityPhrase} (starting with: ${topProblem}). ` +
    `Want me to send it over? No pitch — just the teardown so you can fix it yourself or have us do it.`;

  // Warm, compliment-first message for social-media-only businesses: praise the
  // following they've built, then frame the gap as "you don't OWN that audience."
  const socialWarm =
    `Hey ${owner || name} — first off, genuinely love what you've built on social; you've clearly got a real audience${cityPhrase}. ` +
    `The only gap I noticed: that's rented land. Right now if someone Googles "${cat}${cityPhrase}" you don't really come up, ` +
    `and if the platform changes its algorithm (or locks your page) tomorrow, all that audience disappears with it. ` +
    `We'd give you a home base you actually own — a modern site at $0 down that shows up on Google and turns those followers into booked jobs. ` +
    `Want me to send a free 3-minute video showing exactly what it'd look like for ${name}? No pressure either way.`;

  const openers = [
    { channel: 'call', label: '📞 Cold call / voicemail script', text: callScript },
    { channel: 'email', label: '✉️ Cold email', text: email },
    { channel: 'sms', label: '💬 Text message', text: sms },
    { channel: 'video', label: '🎬 Loom / DM video hook', text: videoHook },
  ];
  if (audit.presence === 'social_only') {
    openers.push({ channel: 'social', label: '🤝 Warm message (social-only lead)', text: socialWarm });
  }
  return openers;
}

/* A few alternative one-line openers so the rep can pick the angle that fits. */
function buildHooks(business, audit) {
  const name = (business.ownerName || '').trim().split(/\s+/)[0] || business.name || 'there';
  const cat = (business.categoryLabel || 'business').toLowerCase();
  const cityPhrase = business.city ? ` in ${business.city}` : '';
  const reviews = business.reviewCount || 0;
  const rating = business.rating ? `${business.rating}★` : 'your reviews';
  const topProblem = audit.problems?.[0]?.label?.toLowerCase() || 'a few issues';
  let problem;
  if (audit.presence === 'none') problem = `I couldn't find a website for you anywhere`;
  else if (audit.presence === 'social_only') problem = `the only thing online for you is a social page`;
  else if (audit.presence === 'broken') problem = `your website looks like it's down right now`;
  else problem = `I spotted ${topProblem} on your site`;

  return [
    { label: 'Curiosity', text: `Hey ${name}, quick one — are you still taking on new ${cat} work${cityPhrase}? Reason I ask: ${problem}, and I figured you'd want to know.` },
    { label: 'Honest cold call', text: `Hi ${name}, I'll be upfront — this is a cold call, but a relevant one. I help ${cat}${cityPhrase} get more calls online, and ${problem}. Can I take 30 seconds to explain why I reached out?` },
    { label: 'Compliment-first', text: `Hey ${name}, honestly impressed — ${reviews} reviews at ${rating} puts you among the best ${cat}${cityPhrase}. That's exactly why I'm calling: ${problem}, and it's costing you customers who never get to see how good you are.` },
    { label: 'Problem-first', text: `Hi ${name}, I'll keep it quick — ${problem}, and for a shop with your reputation that's leaking real money every week. Mind if I show you what I mean?` },
  ];
}

/* A complete, structured cold-call script the rep can read top to bottom. */
function buildScript(business, audit, { opportunityUsd }) {
  const name = business.name || 'there';
  const owner = (business.ownerName || '').trim().split(/\s+/)[0] || '';
  const askFor = owner ? `Hi, could I grab ${owner} for a sec?` : `Hi, is this ${name}?`;
  const cat = (business.categoryLabel || 'business').toLowerCase();
  const cityPhrase = business.city ? ` in ${business.city}, ${business.state || ''}`.trimEnd() : '';
  const reviews = business.reviewCount || 0;
  const rating = business.rating ? `${business.rating}★` : 'strong reviews';
  const topProblem = audit.problems?.[0]?.label?.toLowerCase() || 'a few issues';
  const comp = business.topCompetitor;
  const competitorLine = comp?.name
    ? ` Honestly, right now ${comp.name} is showing up ahead of you and pulling in a lot of those customers.`
    : '';
  let problemLong;
  if (audit.presence === 'none') problemLong = `when I went looking I couldn't find a website for you anywhere — just your Google listing`;
  else if (audit.presence === 'social_only') problemLong = `the only thing I could find online for you is a social page — no website of your own that you control`;
  else if (audit.presence === 'broken') problemLong = `your website is currently down or broken (${topProblem})`;
  else problemLong = `your website has ${topProblem} that's quietly costing you customers`;
  // If our "no website" read is ever wrong (their site just isn't on Google),
  // this line lets the rep recover gracefully instead of getting caught flat.
  const siteRecovery =
    audit.presence === 'none' || audit.presence === 'social_only'
      ? `\n• "Actually, we DO have a website." → "Oh perfect — I couldn't find it when I searched, and honestly that's half the problem: if it's not coming up when I look for ${cat}${cityPhrase}, your customers probably aren't finding it either. What's the web address? … Mind if I take a quick look and send you a free teardown of what'd help it actually show up and bring in calls?"`
      : '';
  const costLine =
    opportunityUsd >= 500
      ? `By my rough math that's around ${usd(opportunityUsd)} a month in jobs going to competitors who just show up better online.`
      : `That's sending business to competitors who simply show up better online.`;

  return [
    `▸ OPENING\n"${askFor} Hey, my name's Christian with Launch Media — we're a web & marketing company. Did I catch you at an okay time for 60 seconds? I promise to be quick."\n(If "I'm busy" → "Totally get it — 30 seconds, and if it's not relevant I'll let you go. Fair?")`,

    `▸ THE REASON FOR THE CALL (HOOK)\n"So the reason I'm calling specifically — I was looking at ${cat}${cityPhrase} and noticed ${problemLong}. And with ${reviews} reviews at ${rating}, you're clearly one of the better shops around, which is exactly why it jumped out at me. ${costLine}${competitorLine}"`,

    `▸ CREDIBILITY\n"Quick background so you know I'm legit — Launch Media builds websites and runs marketing for local businesses, and we work with a lot of ${cat} and home-service companies just like you. You can check out our work at wearelaunchmedia.com."`,

    `▸ DISCOVERY QUESTIONS (let them talk)\n• "Right now, where do most of your new customers come from — word of mouth, Google, something else?"\n• "Have you ever had a real website, or run any Google Ads before?"\n• "If I could get your phone ringing with more ${cat} jobs, do you have the capacity to take them on?"`,

    `▸ THE PITCH\n"Here's what we do, in plain English: we build you a brand-new, modern website at ZERO dollars down. Then our AI runs your SEO, your Google Ads, and your social media all from one place — so instead of a website that just sits there, you get one that actually brings in calls and booked jobs. It's a simple monthly rate, and you stay only as long as it's making you money."`,

    `▸ THE CLOSE (book the next step)\n"I don't want to take more of your time on the phone. What I'd love to do is record you a free 3-minute video showing exactly what I'd fix first and what it'd look like — no charge, no obligation. What's the best email or cell to send that to?"\n(Then: "Perfect — and if it makes sense after you watch it, we hop on a quick 15-minute call. Sound fair?")`,

    `▸ COMMON OBJECTIONS${siteRecovery}\n• "I already have a website / a guy." → "Love that — most sites we take over were quietly losing the owner calls. I'll still send the free teardown; if yours is already crushing it, you get a free second opinion."\n• "I'm too busy / not interested." → "Completely understand — that's the point. You run the business, we handle the marketing. Can I just send the free video and you look when you have a sec?"\n• "How much is it?" → "Plans start around $750/month with $0 down to build — but I don't want to talk price until I show you what we'd do and what it's worth. Fair?"\n• "Just send me info." → "Will do — what's the best email? I'll send a personalized 3-minute teardown, not a generic brochure."`,

    `▸ VOICEMAIL (if no answer)\n"Hi ${name}, this is Christian with Launch Media — we build websites and run marketing for ${cat}${cityPhrase}. I noticed ${problemLong} and put together a quick free teardown for you. You can look us up at wearelaunchmedia.com, or give me a call back at (612) 443-9490. Thanks!"`,

    `▸ FOLLOW-UP TEXT (same day)\n"Hi ${name}, Christian with Launch Media here — just left you a voicemail. I made a free 3-min video on your online presence (starting with ${topProblem}). Want me to send it? No pitch, just the teardown."`,
  ].join('\n\n');
}
