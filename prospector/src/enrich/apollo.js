import { config } from '../config.js';

/*
 * Apollo.io — B2B people enrichment (key-gated).
 *
 * Finds the owner / decision-maker at a company: name, title, and (when the
 * plan allows) a direct email and phone. This is the strongest source for the
 * "owner name" gap on local businesses, which Places and web search rarely fill.
 *
 * No-op (returns null) until APOLLO_API_KEY is set. Never throws into a run.
 */

const SEARCH = 'https://api.apollo.io/v1/mixed_people/search';
// Prefer the actual owner/founder; fall back to any senior leader.
const SENIORITIES = ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head'];

export const apolloReady = () => Boolean(config.apolloApiKey);

function domainOf(website) {
  try {
    const w = (website || '').trim();
    if (!w) return '';
    return new URL(/^https?:\/\//i.test(w) ? w : 'https://' + w).hostname.replace(/^www\./, '').toLowerCase();
  } catch { return ''; }
}

/**
 * Find the top decision-maker for a business. Returns
 * { owner, title, email, phone, linkedin, source } or null.
 * Needs a website domain to match on (that's how Apollo keys companies).
 */
export async function enrichApollo(business) {
  if (!apolloReady()) return null;
  const domain = domainOf(business.website);
  if (!domain) return null;
  try {
    const res = await fetch(SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': config.apolloApiKey },
      body: JSON.stringify({
        q_organization_domains: domain,
        person_seniorities: SENIORITIES,
        page: 1,
        per_page: 1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = (data.people && data.people[0]) || (data.contacts && data.contacts[0]);
    if (!p) return null;
    const name = p.name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (!name) return null;
    // Apollo masks emails ("email_not_unlocked@domain.com") unless revealed.
    const email = p.email && !/not_unlocked|email_not/i.test(p.email) ? p.email : '';
    const phone = p.phone_numbers?.[0]?.sanitized_number || p.organization?.phone || '';
    return {
      owner: name,
      title: p.title || '',
      email,
      phone,
      linkedin: p.linkedin_url || '',
      source: 'apollo',
    };
  } catch {
    return null;
  }
}
