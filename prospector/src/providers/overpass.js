import { config } from '../config.js';
import { sleep } from '../util.js';
import { OSM_TAGS } from '../data/osmTags.js';
import { log } from '../logger.js';

/*
 * OpenStreetMap Overpass provider — FREE business discovery, nationwide, no key.
 *
 * A single geographic query returns many businesses at once (far cheaper than
 * one call per lead). Overpass is a shared community service, so we are a polite
 * citizen: rotate across public endpoints, cap concurrency to 1 (a module-level
 * queue), back off hard on errors/429, cache identical queries for the process
 * lifetime, and keep queries reasonably sized.
 */

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
let endpointIx = 0;
const nextEndpoint = () => {
  const e = ENDPOINTS[endpointIx % ENDPOINTS.length];
  endpointIx += 1;
  return e;
};

const cache = new Map(); // query string → businesses[]

// Serialize all Overpass requests through one queue so we never hammer a shared
// server with parallel load, no matter how many scan workers call us.
let chain = Promise.resolve();
function enqueue(fn) {
  const run = chain.then(fn, fn);
  // keep the chain alive even if one call rejects
  chain = run.catch(() => {});
  return run;
}

export const overpassReady = () => config.overpassEnabled;

/** Build an Overpass QL query for a category around a point. */
function buildQuery(tags, lat, lng, radiusM) {
  const clauses = tags
    .flatMap(([k, v]) => [
      `node["${k}"="${v}"](around:${radiusM},${lat},${lng});`,
      `way["${k}"="${v}"](around:${radiusM},${lat},${lng});`,
    ])
    .join('\n');
  return `[out:json][timeout:40];\n(\n${clauses}\n);\nout center tags 200;`;
}

function normalize(el) {
  const t = el.tags || {};
  const houseNumber = t['addr:housenumber'] || '';
  const street = t['addr:street'] || '';
  const addr = [houseNumber, street].filter(Boolean).join(' ').trim();
  return {
    placeId: null, // OSM is not a Google place
    source: 'overpass',
    sourceId: `${el.type}/${el.id}`,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name: t.name || t.operator || '',
    address: addr,
    city: t['addr:city'] || null,
    state: t['addr:state'] || null,
    zip: t['addr:postcode'] || null,
    phone: t.phone || t['contact:phone'] || '',
    website: t.website || t['contact:website'] || '',
    rating: null,
    reviewCount: 0,
    businessStatus: 'OPERATIONAL',
    lat: el.lat ?? el.center?.lat ?? null,
    lng: el.lon ?? el.center?.lon ?? null,
  };
}

/**
 * search({ category, metro, maxResults }) → [business]
 * Returns free OSM businesses for the category around the metro center.
 */
export async function searchOverpass({ category, metro, maxResults = 200 }) {
  if (!overpassReady()) return [];
  const tags = OSM_TAGS[category.key];
  if (!tags) return []; // no OSM coverage for this category — skip (not an error)

  // Need real coordinates. A custom city not in METROS carries null lat/lng,
  // which would build an invalid `(around:R,null,null)` query that every
  // endpoint rejects — skip cleanly instead of hammering the shared servers.
  if (!Number.isFinite(metro.lat) || !Number.isFinite(metro.lng)) return [];

  const radiusM = Math.round((config.overpassRadiusMi || 25) * 1609.34);
  const query = buildQuery(tags, metro.lat, metro.lng, radiusM);
  if (cache.has(query)) return cloneRows(cache.get(query), maxResults);

  const result = await enqueue(() => runWithRetry(query));
  // Cache ONLY a successful result. runWithRetry returns null when it gave up
  // after exhausting retries — caching that would poison this query with an
  // empty result for the whole process lifetime even after the service recovers.
  if (result !== null) cache.set(query, result);
  return cloneRows(result || [], maxResults);
}

/* Return shallow COPIES so callers (scan.js sets category/city/topCompetitor,
 * discovery.merge sets sources/website) never mutate the shared cached objects,
 * which would leak state across categories in one tick and across ticks. */
function cloneRows(list, maxResults) {
  return list.slice(0, maxResults).map((b) => ({ ...b }));
}

async function runWithRetry(query, attempt = 0) {
  const endpoint = nextEndpoint();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'User-Agent': config.userAgent,
      },
      body: Buffer.from(query, 'utf8'),
      signal: AbortSignal.timeout(50_000),
    });
    if (res.status === 429 || res.status === 504) throw new Error(`busy ${res.status}`);
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const data = await res.json();
    const els = data.elements || [];
    // Only businesses with a name are useful leads.
    const out = els.map(normalize).filter((b) => b.name);
    // Be nice: brief pause between successful hits to the shared service.
    await sleep(1000);
    return out;
  } catch (err) {
    if (attempt < 2) {
      const backoff = 2000 * 2 ** attempt; // 2s, 4s
      log.warn(`overpass ${endpoint.split('/')[2]} failed (${err.message}); retrying in ${backoff / 1000}s`);
      await sleep(backoff);
      return runWithRetry(query, attempt + 1);
    }
    log.warn(`overpass: giving up on this query after ${attempt + 1} tries (${err.message})`);
    return null; // signal FAILURE (not an empty result) so we don't cache it
  }
}
