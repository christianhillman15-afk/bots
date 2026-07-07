import { promises as dns } from 'node:dns';
import { config } from '../config.js';
import { isAllowed } from '../audit/robots.js';
import { mapLimit } from '../util.js';
import { findEmailWeb, searchReady } from './websiteFinder.js';

/* Deliverability check: does the email's domain actually accept mail? We look up
 * MX records (and fall back to an A record). Domains with neither are dead — the
 * email would bounce, so we flag it 'risky' and keep it out of cold campaigns.
 * Returns 'valid' | 'risky'. Pure DNS, free, no API. */
export async function verifyMx(email) {
  const domain = (email || '').split('@')[1];
  if (!domain) return 'risky';
  const mx = await dns.resolveMx(domain).catch(() => []);
  if (mx && mx.length) return 'valid';
  const a = await dns.resolve(domain).catch(() => []); // some tiny domains take mail on the A record
  return a && a.length ? 'valid' : 'risky';
}

/*
 * Best-effort contact-email finder. Two sources, in order:
 *   1. Scrape the lead's real website (homepage + common contact pages),
 *      decoding obfuscated addresses (info [at] shop [dot] com, HTML entities).
 *   2. If that finds nothing (or the lead has no scrapable site), web-search
 *      for the email — this reaches the "no website" leads too.
 */

const SOCIAL = ['facebook.com', 'instagram.com', 'yelp.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'business.site', 'g.page'];
const ASSET_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'css', 'js', 'ico', 'mp4', 'pdf']);
const NOISE = ['example.com', 'sentry.io', 'wixpress.com', 'w3.org', 'schema.org', 'googleapis.com', 'gstatic.com', 'yourdomain.com', 'domain.com', 'email.com', 'sentry.wixpress.com'];
const PATHS = ['', '/contact', '/contact-us', '/contact.html', '/about', '/about-us', '/get-a-quote', '/quote', '/estimate', '/book', '/appointment'];

// Small shops hide emails from scrapers ("info [at] shop [dot] com", HTML
// entities, (at)/(dot)). Decode the common tricks before extracting.
function deobfuscate(html) {
  return html
    .replace(/&#0*64;|&#x0*40;|&commat;/gi, '@')
    .replace(/&#0*46;|&#x0*2e;|&period;/gi, '.')
    .replace(/\s*[[({]\s*(?:at|@)\s*[\])}]\s*/gi, '@')
    .replace(/\s*[[({]\s*(?:dot|\.)\s*[\])}]\s*/gi, '.')
    .replace(/([a-z0-9._%+-]+)\s+at\s+([a-z0-9-]+)\s+dot\s+([a-z]{2,})/gi, '$1@$2.$3');
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.auditTimeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': config.userAgent, Accept: 'text/html,*/*' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractEmails(rawHtml, siteHost) {
  const html = deobfuscate(rawHtml);
  const set = new Set();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) set.add(m[1]);
  for (const m of html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) set.add(m[0]);

  const root = siteHost.split('.').slice(-2).join('.');
  const cleaned = [...set]
    .map((e) => e.toLowerCase().trim().replace(/[.,;:]+$/, ''))
    .filter((e) => {
      const tld = e.split('.').pop();
      if (ASSET_TLDS.has(tld)) return false; // logo@2x.png etc.
      if (e.length > 60 || e.includes('..')) return false;
      if (NOISE.some((n) => e.endsWith('@' + n) || e.endsWith('.' + n))) return false;
      if (/^(noreply|no-reply|donotreply)/.test(e)) return false;
      return true;
    });

  // Prefer an address on the business's own domain.
  cleaned.sort((a, b) => Number(b.endsWith('@' + root) || b.includes(root)) - Number(a.endsWith('@' + root) || a.includes(root)));
  return [...new Set(cleaned)];
}

/** Find the best contact email for one website, or null. */
export async function findEmail(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const host = hostOf(url);
  if (!host || SOCIAL.some((s) => host === s || host.endsWith('.' + s))) return null;

  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  if (!(await isAllowed(url))) return null;

  for (const path of PATHS) {
    const html = await fetchText(origin + path);
    if (!html) continue;
    const emails = extractEmails(html, host);
    if (emails.length) return { email: emails[0], all: emails.slice(0, 3), source: origin + path };
  }
  return null;
}

/** True if the lead has a real (non-social) website we can scrape. */
function scrapableSite(l) {
  const w = l.business?.website || '';
  if (!w) return '';
  const host = hostOf(/^https?:\/\//i.test(w) ? w : 'https://' + w);
  return host && !SOCIAL.some((s) => host === s || host.endsWith('.' + s)) ? w : '';
}

/** A business's own mail domain from its website (skips social/dead hosts). */
function domainOf(website) {
  const w = (website || '').trim();
  if (!w) return '';
  try {
    const host = new URL(/^https?:\/\//i.test(w) ? w : 'https://' + w).hostname.replace(/^www\./, '').toLowerCase();
    if (!host.includes('.') || SOCIAL.some((s) => host === s || host.endsWith('.' + s))) return '';
    return host;
  } catch { return ''; }
}

/** Best-guess address on the business's OWN domain — owner-name@ if we know the
 * owner, else info@ — kept only if that domain actually accepts mail. A standard,
 * legitimate B2B fallback when a site publishes no address. */
async function patternEmail(business) {
  const domain = domainOf(business.website);
  if (!domain) return null;
  if ((await verifyMx('x@' + domain)) !== 'valid') return null;
  const first = ((business.ownerName || '').trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, '');
  const local = first.length >= 3 ? first : 'info';
  return `${local}@${domain}`;
}

/** A lead worth checking: no email yet, not checked, and reachable by scrape,
 * a domain pattern, or web search. */
function needsEmail(l) {
  if (!l.business || l.business.email || l.business.emailChecked) return false;
  return Boolean(scrapableSite(l)) || Boolean(domainOf(l.business?.website)) || searchReady();
}

/**
 * Enrich stored leads with contact emails (bounded concurrency).
 *   1. scrape a real website if the lead has one
 *   2. otherwise (or if scraping finds nothing) web-search for the email
 * `limit` caps how many to process this run (0 = all). Marks misses as checked
 * so repeated runs don't repeat dead ends; a rate-limited search is left to retry.
 */
export async function enrichEmails({ store, limit = 0, onProgress = () => {} }) {
  const targets = store.all().filter(needsEmail);
  const slice = limit > 0 ? targets.slice(0, limit) : targets;
  let found = 0;
  let done = 0;
  await mapLimit(slice, config.auditConcurrency, async (lead) => {
    const site = scrapableSite(lead);
    let email = null;
    let source = null;

    if (site) {
      const r = await findEmail(site);
      if (r?.email) { email = r.email; source = r.source; }
    }
    // Free fallback: a role/owner address on their own domain (site-having leads).
    if (!email) {
      const p = await patternEmail(lead.business);
      if (p) { email = p; source = 'pattern'; }
    }
    // Paid fallback: web-search for the email (reaches no-website leads too).
    if (!email && searchReady()) {
      const r = await findEmailWeb(lead.business);
      if (!r.ok) { done++; onProgress({ done, total: slice.length, found }); return; } // capped/throttled — retry later
      if (r.email) { email = r.email; source = 'web-search'; }
    }

    if (email) {
      lead.business.email = email;
      lead.business.emailSource = source;
      lead.business.emailStatus = await verifyMx(email); // deliverability check
      found++;
    } else {
      lead.business.emailChecked = true; // don't retry dead ends next run
    }
    done++;
    onProgress({ done, total: slice.length, found });
  });
  store.save();
  return { processed: slice.length, found, remaining: Math.max(0, targets.length - slice.length) };
}

/** MX-check emails that were found before verification existed (free, no API). */
export async function verifyEmails({ store, limit = 0, onProgress = () => {} }) {
  const targets = store.all().filter((l) => l.business?.email && !l.business?.emailStatus);
  const slice = limit > 0 ? targets.slice(0, limit) : targets;
  let valid = 0, risky = 0, done = 0;
  await mapLimit(slice, 8, async (lead) => {
    const status = await verifyMx(lead.business.email);
    lead.business.emailStatus = status;
    status === 'valid' ? valid++ : risky++;
    done++;
    onProgress({ done, total: slice.length, valid, risky });
  });
  if (slice.length) store.save();
  return { processed: slice.length, valid, risky, remaining: Math.max(0, targets.length - slice.length) };
}

export { needsEmail };
