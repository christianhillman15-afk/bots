import { isLive } from '../config.js';
import { searchBusinesses } from './places.js';
import * as demo from './demo.js';
import { auditBusiness } from '../audit/audit.js';

/**
 * Returns a provider with a uniform interface:
 *   search({ category, metro, maxResults }) -> [business]
 *   audit(business)                         -> auditResult
 *
 * Live mode (GOOGLE_PLACES_API_KEY set): real Google Places + live website
 * audits. Otherwise: the built-in demo dataset with synthesized audits.
 */
export function getProvider() {
  if (isLive()) {
    return {
      name: 'google-places',
      live: true,
      async search({ category, metro, maxResults = 60 }) {
        return searchBusinesses({
          searchTerm: category.searchTerm,
          includedType: category.placesType,
          lat: metro.lat,
          lng: metro.lng,
          cityLabel: `${metro.city}, ${metro.state}`,
          maxResults,
        });
      },
      audit: (business) => auditBusiness(business),
    };
  }
  return {
    name: 'demo',
    live: false,
    search: ({ category, metro, maxResults }) => demo.search({ category, metro, maxResults }),
    audit: (business) => demo.audit(business),
  };
}
