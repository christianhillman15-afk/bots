import { config } from '../config.js';

/*
 * Crunchbase revenue-range enrichment (key-gated).
 *
 * Crunchbase's API returns an ESTIMATED revenue *range* for many private
 * companies (e.g. "$1M to $10M"). It's a good refinement for the companies it
 * covers — but coverage of small local home-services firms is thin, so this is
 * a supplement to the review-based estimate, not a replacement.
 *
 * No-op until CRUNCHBASE_API_KEY is set, so the app runs fine without it and
 * Crunchbase "turns on" the moment a key is added. Always returns null on any
 * miss/error — never throws into the run.
 */

// Crunchbase revenue_range enum → human label.
const REVENUE_RANGE = {
  r_00000000: 'Less than $1M',
  r_00001000: '$1M–$10M',
  r_00010000: '$10M–$50M',
  r_00050000: '$50M–$100M',
  r_00100000: '$100M–$500M',
  r_00500000: '$500M–$1B',
  r_01000000: '$1B–$10B',
  r_10000000: '$10B+',
};

export const crunchbaseReady = () => Boolean(config.crunchbaseApiKey);

export async function enrichCrunchbase(business) {
  if (!config.crunchbaseApiKey) return null; // key-gated: silent no-op
  const name = (business.name || '').trim();
  if (!name) return null;
  try {
    const res = await fetch('https://api.crunchbase.com/api/v4/searches/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-cb-user-key': config.crunchbaseApiKey },
      body: JSON.stringify({
        field_ids: ['identifier', 'revenue_range', 'website_url', 'short_description', 'location_identifiers'],
        query: [{ type: 'predicate', field_id: 'identifier', operator_id: 'contains', values: [name] }],
        limit: 1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const props = data?.entities?.[0]?.properties;
    if (!props) return null;
    return {
      matched: props.identifier?.value || name,
      revenueRange: REVENUE_RANGE[props.revenue_range] || props.revenue_range || null,
      website: props.website_url || null,
      description: props.short_description || null,
      source: 'crunchbase',
    };
  } catch {
    return null;
  }
}
