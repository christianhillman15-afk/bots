import { config } from '../config.js';
import { mapLimit } from '../util.js';
import { auditBusiness, isLead } from '../audit/audit.js';
import { scoreLead } from '../scoring/leadScore.js';
import { stripAudit } from '../scan.js';
import { STRICT_OUTREACH_STATES } from '../data/metros.js';

/*
 * Verifies "no website" / social-only leads by actually searching Google
 * (via Gemini with Search grounding). Google Places often lacks a website even
 * when the business has one, so this catches those false positives:
 *   - real site found  -> set it, re-audit + re-score (proper classification)
 *   - fine site found  -> remove the lead (not a prospect)
 *   - nothing found    -> mark verified so the "no website" flag is trustworthy
 */

const endpoint = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const BAD_HOSTS = [
  'facebook.com', 'instagram.com', 'yelp.com', 'google.com', 'mapquest.com',
  'bbb.org', 'nextdoor.com', 'linkedin.com', 'tripadvisor.com', 'foursquare.com',
  'yellowpages.com', 'angi.com', 'angieslist.com', 'thumbtack.com', 'birdeye.com',
  'manta.com', 'chamberofcommerce.com', 'houzz.com', 'porch.com', 'expertise.com',
];

function parseUrl(text) {
  if (!text || /^\s*none\s*$/i.test(text.trim())) return null;
  let m = text.match(/https?:\/\/[^\s)"'<>]+/i);
  let url = m ? m[0] : null;
  if (!url) {
    const m2 = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)"'<>]*)?/i);
    if (m2) url = 'https://' + m2[0];
  }
  if (!url) return null;
  url = url.replace(/[.,)\]]+$/, '');
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (BAD_HOSTS.some((b) => host === b || host.endsWith('.' + b))) return null;
  } catch {
    return null;
  }
  return url;
}

function buildPrompt(business) {
  const q = [business.name, business.city, business.state].filter(Boolean).join(', ');
  const cat = business.categoryLabel ? ` (a ${business.categoryLabel})` : '';
  const phoneLine = business.phone ? `\n  Phone: ${business.phone}` : '';
  return (
    `Find the official website for this local business. Search BOTH by its name and by its ` +
    `phone number — a reverse phone-number lookup often reveals the site even when the name search doesn't.\n\n` +
    `  Business: "${q}"${cat}${phoneLine}\n\n` +
    `Guidelines:\n` +
    `- The name does NOT have to match exactly — small differences (LLC, "&", DBA, abbreviations, extra words) are fine. ` +
    `If the phone number, address, or city lines up, treat it as the same business.\n` +
    `- Return the homepage URL of a website the business owns (e.g. https://theirname.com).\n` +
    `- Skip Facebook, Instagram, Yelp, Google, MapQuest, BBB, Nextdoor and other directories/aggregators ` +
    `(those don't count as their own website).\n` +
    `- Only reply NONE if you genuinely can't find a website they own.\n` +
    `Reply with just the URL or NONE — nothing else.`
  );
}

/** Claude with its web search tool. */
async function findWebsiteClaude(business) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 40_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 256,
        messages: [{ role: 'user', content: buildPrompt(business) }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return parseUrl(text);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Gemini grounded in Google Search. */
async function findWebsiteGemini(business) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(endpoint(config.geminiModel), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(business) }] }],
        tools: [{ google_search: {} }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text)
      .filter(Boolean)
      .join(' ')
      .trim();
    return parseUrl(text);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** True if any web-search provider is configured. */
export const searchReady = () => Boolean(config.anthropicApiKey || config.geminiApiKey);

/** Find a business's real website via Claude (preferred) or Gemini. */
export async function findWebsite(business) {
  if (config.anthropicApiKey) return findWebsiteClaude(business);
  if (config.geminiApiKey) return findWebsiteGemini(business);
  throw new Error('No web-search key set (ANTHROPIC_API_KEY or GEMINI_API_KEY)');
}

const needsVerify = (l) =>
  (l.presence === 'none' || l.presence === 'social_only') && !l.business?.websiteVerified;

/**
 * Verify missing-website leads. `limit` caps how many to process this run.
 * Gemini grounding has a cost, so keep concurrency low.
 */
export async function verifyMissingWebsites({ store, limit = 0, onProgress = () => {} }) {
  const targets = store.all().filter(needsVerify);
  const slice = limit > 0 ? targets.slice(0, limit) : targets;
  let foundSites = 0;
  let removedOk = 0;
  let confirmedNone = 0;
  let done = 0;

  await mapLimit(slice, Math.min(4, config.auditConcurrency), async (lead) => {
    let url = null;
    try {
      url = await findWebsite(lead.business);
    } catch {
      /* leave for a later run */
    }
    lead.business.websiteVerified = true;

    if (url) {
      lead.business.website = url;
      const audit = await auditBusiness(lead.business);
      const score = scoreLead(lead.business, audit);
      if (!isLead(audit)) {
        store.remove(lead.id); // they actually have a fine website — not a prospect
        removedOk++;
      } else {
        lead.presence = audit.presence;
        lead.audit = stripAudit(audit);
        lead.score = score;
        lead.compliance = { strictOutreachState: STRICT_OUTREACH_STATES.has(lead.business.state) };
        foundSites++;
      }
    } else {
      confirmedNone++;
    }
    done++;
    onProgress({ done, total: slice.length, foundSites, removedOk, confirmedNone });
  });

  store.save();
  return {
    processed: slice.length,
    foundSites,
    removedOk,
    confirmedNone,
    remaining: Math.max(0, targets.length - slice.length),
  };
}
