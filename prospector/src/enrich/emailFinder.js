import { config } from '../config.js';
import { isAllowed } from '../audit/robots.js';
import { mapLimit } from '../util.js';

/*
 * Best-effort contact-email finder. Visits a lead's real website (homepage +
 * a few common contact pages) and extracts an email address. Only works for
 * leads that HAVE a real site — "no website" and social-only leads have no
 * email to find (reach those by phone).
 */

const SOCIAL = ['facebook.com', 'instagram.com', 'yelp.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'business.site', 'g.page'];
const ASSET_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'css', 'js', 'ico', 'mp4', 'pdf']);
const NOISE = ['example.com', 'sentry.io', 'wixpress.com', 'w3.org', 'schema.org', 'googleapis.com', 'gstatic.com', 'yourdomain.com', 'domain.com', 'email.com', 'sentry.wixpress.com'];
const PATHS = ['', '/contact', '/contact-us', '/about', '/about-us', '/contact.html'];

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

function extractEmails(html, siteHost) {
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

/** A lead worth checking: has a real (non-social) site and isn't checked yet. */
function needsEmail(l) {
  const w = l.business?.website || '';
  if (!w || l.business?.email || l.business?.emailChecked) return false;
  const host = hostOf(/^https?:\/\//i.test(w) ? w : 'https://' + w);
  return host && !SOCIAL.some((s) => host === s || host.endsWith('.' + s));
}

/**
 * Enrich stored leads with contact emails (bounded concurrency).
 * `limit` caps how many to process this run (0 = all). Marks misses as
 * checked so repeated runs don't re-fetch the same dead ends.
 */
export async function enrichEmails({ store, limit = 0, onProgress = () => {} }) {
  const targets = store.all().filter(needsEmail);
  const slice = limit > 0 ? targets.slice(0, limit) : targets;
  let found = 0;
  let done = 0;
  await mapLimit(slice, config.auditConcurrency, async (lead) => {
    const r = await findEmail(lead.business.website);
    if (r?.email) {
      lead.business.email = r.email;
      lead.business.emailSource = r.source;
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

export { needsEmail };
