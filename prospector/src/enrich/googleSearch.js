import { config } from '../config.js';

/*
 * Google Programmable Search — Custom Search JSON API (key-gated).
 *
 * Returns web results as JSON, so we can programmatically find a company's
 * official website, owner name, or a contact email without an LLM. 100
 * queries/day free, then ~$5/1,000. Needs GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX
 * (a Programmable Search Engine set to "search the entire web").
 *
 * Every function is a no-op (returns null/[]) until both keys are set and never
 * throws into a run.
 */

const ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
const SOCIAL = ['facebook.com', 'instagram.com', 'yelp.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'mapquest.com', 'bbb.org', 'angi.com', 'thumbtack.com', 'houzz.com', 'nextdoor.com', 'youtube.com'];

export const googleSearchReady = () => Boolean(config.googleCseApiKey && config.googleCseCx);

/** Raw web search → [{ title, link, snippet }]. Empty on any miss/error. */
export async function googleSearch(query, num = 5) {
  if (!googleSearchReady() || !query) return [];
  try {
    const url = `${ENDPOINT}?key=${encodeURIComponent(config.googleCseApiKey)}&cx=${encodeURIComponent(config.googleCseCx)}&num=${Math.min(10, num)}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((it) => ({ title: it.title || '', link: it.link || '', snippet: it.snippet || '' }));
  } catch {
    return [];
  }
}

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}
const isSocial = (h) => SOCIAL.some((s) => h === s || h.endsWith('.' + s));

/** Find a business's most likely official website via web search. */
export async function findWebsiteGoogle(business) {
  const q = [business.name, business.city, business.state].filter(Boolean).join(' ');
  const items = await googleSearch(q + ' official website', 6);
  for (const it of items) {
    const h = host(it.link);
    if (h && !isSocial(h)) return `https://${h}`;
  }
  return null;
}

/** Mine result snippets for a contact email on the business's domain. */
export async function findEmailGoogle(business) {
  const domain = business.website ? host(business.website) : '';
  const q = [business.name, business.city].filter(Boolean).join(' ');
  const items = await googleSearch(q + ' email contact', 8);
  const emails = new Set();
  for (const it of items) {
    for (const m of `${it.title} ${it.snippet}`.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      const e = m[0].toLowerCase();
      if (/\.(png|jpg|jpeg|gif|webp)$/.test(e)) continue;
      emails.add(e);
    }
  }
  if (!emails.size) return null;
  const list = [...emails];
  // prefer an address on the company's own domain
  if (domain) list.sort((a, b) => Number(b.endsWith('@' + domain)) - Number(a.endsWith('@' + domain)));
  return list[0];
}

/** Look for an owner / principal name in result snippets. */
export async function findOwnerGoogle(business) {
  const q = [business.name, business.city, business.state].filter(Boolean).join(' ');
  const items = await googleSearch(q + ' owner OR founder OR president', 6);
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+)\b(?=[^.]*\b(?:owner|founder|president|principal|CEO)\b)/;
  for (const it of items) {
    const m = `${it.title}. ${it.snippet}`.match(re);
    if (m) return m[1];
  }
  return null;
}
