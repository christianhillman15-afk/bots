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

// ── Free domain guessing (no API quota) ─────────────────────────────────────
// Grounded search sometimes misses a small business whose domain is literally
// their name (e.g. "King Auto Collision Inc" -> kingautocollisioninc.com). So
// before ever trusting "no site found", we also guess the obvious domains and
// HTTP-probe them. We only accept a hit when the page proves it's really them
// (their phone number, or several name words + their city on the page).
const NAME_STOP = new Set([
  'inc', 'llc', 'corp', 'co', 'ltd', 'the', 'company', 'companies', 'group',
  'services', 'service', 'and', 'of', 'a',
]);

function nameWords(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function candidateDomains(business) {
  const all = nameWords(business.name);
  if (!all.length) return [];
  const noStop = all.filter((w) => !NAME_STOP.has(w));
  const bases = new Set();
  const addBase = (toks) => {
    if (!toks.length) return;
    bases.add(toks.join('')); // kingautocollisioninc
    if (toks.length > 1) bases.add(toks.join('-')); // king-auto-collision
  };
  addBase(all); // keeps the suffix (matches kingautocollisioninc.com)
  addBase(noStop); // drops Inc/LLC (matches kingautocollision.com)
  addBase(noStop.slice(0, 3));
  addBase(noStop.slice(0, 2));
  const out = [];
  for (const b of bases) {
    if (b.length < 4 || b.length > 40) continue;
    out.push(`${b}.com`, `${b}.net`);
  }
  // .com first, then cap the number of probes per lead
  return [...new Set(out)].sort((a, z) => Number(z.endsWith('.com')) - Number(a.endsWith('.com'))).slice(0, 8);
}

function pageProvesIdentity(html, business) {
  const text = html.toLowerCase();
  const phone = (business.phone || '').replace(/\D/g, '').slice(-10);
  if (phone.length === 10 && text.replace(/\D/g, '').includes(phone)) return true; // strongest signal
  const words = nameWords(business.name).filter((w) => !NAME_STOP.has(w) && w.length >= 4);
  const nameHits = words.filter((w) => text.includes(w)).length;
  const cityHit = business.city ? text.includes(business.city.toLowerCase()) : false;
  return nameHits >= 3 || (nameHits >= 2 && cityHit);
}

async function probeCandidate(url, business) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; OxsomeProspector/1.0)' },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const finalHost = new URL(res.url || url).hostname.replace(/^www\./, '').toLowerCase();
    if (BAD_HOSTS.some((b) => finalHost === b || finalHost.endsWith('.' + b))) return null; // redirected to social/dir
    const html = (await res.text()).slice(0, 300000);
    if (!pageProvesIdentity(html, business)) return null;
    try { return new URL(res.url || url).origin; } catch { return url; }
  } catch {
    return null;
  }
}

/** Guess + verify a business's website for free (no API). Returns URL or null. */
export async function guessWebsite(business) {
  for (const host of candidateDomains(business)) {
    const hit = (await probeCandidate('https://' + host, business)) ||
                (await probeCandidate('http://' + host, business));
    if (hit) return hit;
  }
  return null;
}

// A lead still needs verifying until BOTH the free domain guess and a grounded
// search have had a turn — so leads wrongly marked "confirmed none" by an older
// run get re-checked by the free guess (which catches name-as-domain sites).
const needsVerify = (l) =>
  (l.presence === 'none' || l.presence === 'social_only') &&
  !(l.business?.websiteVerified && l.business?.guessChecked);

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
    const biz = lead.business;
    let url = null;
    let groundedSaidNone = false;

    // 1) FREE domain guess first (catches name-as-domain sites grounding misses,
    //    and re-checks leads an older run wrongly marked "confirmed none").
    if (!biz.guessChecked) {
      try { url = await guessWebsite(biz); } catch { url = null; }
      biz.guessChecked = true;
    }

    // 2) Only spend a grounded search if the guess found nothing AND we haven't
    //    already done a grounded search for this lead.
    if (!url && !biz.websiteVerified) {
      let r = { ok: false, url: null };
      try { r = await findWebsite(biz); } catch { r = { ok: false, url: null }; }
      if (r.ok && r.url) url = r.url;
      else if (r.ok) groundedSaidNone = true; // searched, genuinely nothing
      // r.ok === false => throttled/capped => leave for retry (not confirmed)
    }

    if (url) {
      biz.website = url;
      biz.websiteVerified = true;
      const audit = await auditBusiness(biz);
      const score = scoreLead(biz, audit);
      if (!isLead(audit)) {
        store.remove(lead.id); // they actually have a real website — not a prospect
        removedOk++;
      } else {
        lead.presence = audit.presence;
        lead.audit = stripAudit(audit);
        lead.score = score;
        lead.compliance = { strictOutreachState: STRICT_OUTREACH_STATES.has(biz.state) };
        foundSites++;
      }
    } else if (groundedSaidNone) {
      biz.websiteVerified = true; // guess + grounded search both came up empty -> trustworthy
      confirmedNone++;
    } else if (!biz.websiteVerified) {
      failed++; // capped/throttled — try again next run
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
