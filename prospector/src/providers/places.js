import { config } from '../config.js';
import { sleep } from '../util.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

/* Field mask — no spaces. Includes Enterprise fields (website, rating,
 * reviews, phone) which we need to find & score leads. A request with these
 * bills at the Text Search Enterprise SKU (1,000 free/mo, then ~$35/1k). */
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.priceLevel',
  'places.primaryType',
  'places.types',
  'places.location',
  'places.googleMapsUri',
  'nextPageToken',
].join(',');

const PRICE_MAP = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function pick(components, type) {
  const c = (components || []).find((x) => (x.types || []).includes(type));
  return c?.shortText || c?.longText || null;
}

function normalize(place) {
  return {
    placeId: place.id,
    name: place.displayName?.text || '(unnamed)',
    address: place.formattedAddress || '',
    city: pick(place.addressComponents, 'locality'),
    state: pick(place.addressComponents, 'administrative_area_level_1'),
    zip: pick(place.addressComponents, 'postal_code'),
    phone: place.nationalPhoneNumber || '',
    website: place.websiteUri || '',
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviewCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : 0,
    businessStatus: place.businessStatus || 'OPERATIONAL',
    priceLevel: place.priceLevel ? PRICE_MAP[place.priceLevel] ?? null : null,
    primaryType: place.primaryType || null,
    types: place.types || [],
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    googleMapsUri: place.googleMapsUri || null,
  };
}

// Counts every BILLABLE Places request made, so the cloud hunt can enforce a
// hard daily cap on real API calls. Read+reset with placesCallsSince(true).
let _placesCalls = 0;
export function placesCallsSince(reset = false) {
  const n = _placesCalls;
  if (reset) _placesCalls = 0;
  return n;
}

async function postPage(body, attempt = 0) {
  if (attempt === 0) _placesCalls++; // count the billable request once (not retries)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.placesApiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429 && attempt < 4) {
    await sleep(1000 * 2 ** attempt); // backoff on rate limit
    return postPage(body, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Places API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Search a single category in one location. Returns up to `maxResults`
 * (Places caps at 60 / 3 pages). `includedType` is optional.
 */
export async function searchBusinesses({
  searchTerm,
  includedType = '',
  lat,
  lng,
  radius = 25000,
  maxResults = 60,
  cityLabel,
}) {
  if (!config.placesApiKey) throw new Error('GOOGLE_PLACES_API_KEY is not set');

  const baseBody = {
    textQuery: cityLabel ? `${searchTerm} in ${cityLabel}` : searchTerm,
    pageSize: 20,
    rankPreference: 'RELEVANCE',
    regionCode: 'US',
    languageCode: 'en',
  };
  if (lat != null && lng != null) {
    baseBody.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius } };
  }
  if (includedType) baseBody.includedType = includedType;

  const out = [];
  let pageToken;
  let triedWithoutType = false;
  for (let page = 0; page < 3 && out.length < maxResults; page++) {
    const body = pageToken ? { ...baseBody, pageToken } : baseBody;
    let data;
    try {
      data = await postPage(body);
    } catch (err) {
      const invalid = /INVALID_ARGUMENT|400/.test(err.message);
      // An invalid includedType fails the whole search — drop it and rely on
      // the (already specific) textQuery instead of losing the category.
      if (invalid && baseBody.includedType && !triedWithoutType && page === 0) {
        triedWithoutType = true;
        delete baseBody.includedType;
        page = -1; // restart the loop from the first page
        continue;
      }
      // A freshly-issued nextPageToken can need a moment to become valid.
      if (invalid && pageToken) {
        await sleep(1500);
        data = await postPage(body);
      } else {
        throw err;
      }
    }
    for (const place of data.places || []) out.push(normalize(place));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out.slice(0, maxResults);
}

export const providerName = 'google-places';
