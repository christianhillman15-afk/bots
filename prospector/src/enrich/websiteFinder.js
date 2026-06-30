import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { mapLimit } from '../util.js';
import { auditBusiness, isLead } from '../audit/audit.js';
import { scoreLead } from '../scoring/leadScore.js';
import { stripAudit } from '../scan.js';
import { STRICT_OUTREACH_STATES } from '../data/metros.js';

/*
 * Daily free-tier guard. Every web search (website-verify + owner lookup) goes
 * through one counter persisted to disk. Once we hit config.searchDailyCap in a
 * given day we stop making calls and resume tomorrow — so we can never spill
 * past the provider's free daily allowance and get billed. 0 = no cap.
 */
const usageFile = () => join(config.dataDir, 'search-usage.json');
function today() {
  return new Date().toISOString().slice(0, 10);
}
function readUsage() {
  try {
    const u = JSON.parse(readFileSync(usageFile(), 'utf8'));
    if (u && u.date === today()) return { date: u.date, count: Number(u.count) || 0 };
  } catch {
    /* missing/old file -> fresh day */
  }
  return { date: today(), count: 0 };
}
/** Reserve one search if we're under the cap. Returns true if allowed. */
function reserveSearch() {
  const cap = Number(config.searchDailyCap) || 0;
  const u = readUsage();
  if (cap > 0 && u.count >= cap) return false;
  u.count += 1;
  try {
    writeFileSync(usageFile(), JSON.stringify(u));
  } catch {
    /* if we can't persist, fail safe by NOT allowing the call */
    return false;
  }
  return true;
}
/** Public: today's usage for the dashboard ({ used, cap, remaining }). */
export function searchUsage() {
  const cap = Number(config.searchDailyCap) || 0;
  const used = readUsage().count;
  return { used, cap, remaining: cap > 0 ? Math.max(0, cap - used) : null };
}

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
    if (!res.ok) return { ok: false, url: null };
    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return { ok: true, url: parseUrl(text) };
  } catch {
    return { ok: false, url: null };
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
    if (!res.ok) return { ok: false, url: null };
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text)
      .filter(Boolean)
      .join(' ')
      .trim();
    return { ok: true, url: parseUrl(text) };
  } catch {
    return { ok: false, url: null };
  } finally {
    clearTimeout(t);
  }
}

/** True if any web-search provider is configured. */
export const searchReady = () => Boolean(config.anthropicApiKey || config.geminiApiKey);

/** Find a business's real website via Claude (preferred) or Gemini. */
export async function findWebsite(business) {
  if (!config.anthropicApiKey && !config.geminiApiKey)
    throw new Error('No web-search key set (ANTHROPIC_API_KEY or GEMINI_API_KEY)');
  if (!reserveSearch()) return { ok: false, url: null, capped: true }; // daily cap hit
  if (config.anthropicApiKey) return findWebsiteClaude(business);
  return findWebsiteGemini(business);
}

// ── Generic grounded search (returns raw text), used for owner lookup ───────
async function runSearchClaude(prompt) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 40_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, text: '' };
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    return { ok: true, text };
  } catch {
    return { ok: false, text: '' };
  } finally {
    clearTimeout(t);
  }
}
async function runSearchGemini(prompt) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(endpoint(config.geminiModel), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, text: '' };
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join(' ').trim();
    return { ok: true, text };
  } catch {
    return { ok: false, text: '' };
  } finally {
    clearTimeout(t);
  }
}
function runSearch(prompt) {
  if (!config.anthropicApiKey && !config.geminiApiKey) throw new Error('No web-search key set');
  if (!reserveSearch()) return Promise.resolve({ ok: false, text: '', capped: true }); // daily cap hit
  if (config.anthropicApiKey) return runSearchClaude(prompt);
  return runSearchGemini(prompt);
}

function parseName(text) {
  if (!text) return null;
  let s = text.trim().replace(/^["'\s]+|["'.\s]+$/g, '');
  if (/^none$/i.test(s) || /\b(could not|couldn't|not find|no specific|unknown|unable)\b/i.test(s)) return null;
  // take first line, strip a trailing title/role after a comma/dash
  s = s.split('\n')[0].split(/[,–—-]/)[0].trim();
  const words = s.split(/\s+/);
  if (words.length < 1 || words.length > 4) return null; // likely a sentence, not a name
  if (!/^[A-Za-z][A-Za-z.'-]*(\s+[A-Za-z][A-Za-z.'-]*)*$/.test(s)) return null;
  return s;
}

/** Find the owner/principal's name for a business, or null. */
export async function findOwner(business) {
  const q = [business.name, business.city, business.state].filter(Boolean).join(', ');
  const phone = business.phone ? ` Their phone is ${business.phone}.` : '';
  const prompt =
    `Search the web for the OWNER, founder, or principal of this local business: "${q}"` +
    `${business.categoryLabel ? ` (a ${business.categoryLabel})` : ''}.${phone}\n` +
    `Reply with ONLY that person's full name (e.g. "Mike Rodriguez"). If you can't find a specific person, reply exactly: NONE`;
  const { ok, text } = await runSearch(prompt);
  if (!ok) return { ok: false, name: null };
  return { ok: true, name: parseName(text) };
}

const needsOwner = (l) => l.business && !l.business.ownerName && !l.business.ownerChecked;

/** Enrich leads with owner names (Claude/Gemini), re-scoring so openers update. */
export async function enrichOwners({ store, limit = 0, onProgress = () => {} }) {
  const targets = store.all().filter(needsOwner);
  const slice = limit > 0 ? targets.slice(0, limit) : targets;
  let found = 0;
  let failed = 0;
  let done = 0;
  await mapLimit(slice, 2, async (lead) => {
    let r = { ok: false, name: null };
    try {
      r = await findOwner(lead.business);
    } catch {
      r = { ok: false, name: null };
    }
    if (!r.ok) {
      failed++;
    } else {
      lead.business.ownerChecked = true;
      if (r.name) {
        lead.business.ownerName = r.name;
        if (lead.audit) lead.score = scoreLead(lead.business, lead.audit); // refresh openers w/ name
        found++;
      }
    }
    done++;
    onProgress({ done, total: slice.length, found, failed });
  });
  store.save();
  return { processed: slice.length, found, failed, remaining: Math.max(0, targets.length - slice.length) };
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
  let failed = 0;
  let done = 0;

  // Gentle concurrency keeps us under free-tier rate limits.
  await mapLimit(slice, 2, async (lead) => {
    let r = { ok: false, url: null };
    try {
      r = await findWebsite(lead.business);
    } catch {
      r = { ok: false, url: null };
    }

    if (!r.ok) {
      // search errored/throttled — leave unverified so a later run retries it
      failed++;
    } else if (r.url) {
      lead.business.websiteVerified = true;
      lead.business.website = r.url;
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
      lead.business.websiteVerified = true; // confirmed: no website of their own
      confirmedNone++;
    }
    done++;
    onProgress({ done, total: slice.length, foundSites, removedOk, confirmedNone, failed });
  });

  store.save();
  return {
    processed: slice.length,
    foundSites,
    removedOk,
    confirmedNone,
    failed,
    remaining: Math.max(0, targets.length - slice.length),
  };
}
