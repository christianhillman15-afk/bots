import { config, isLive } from '../config.js';
import { leadId } from '../util.js';
import { searchOverpass, overpassReady } from './overpass.js';
import { searchSocrata, socrataReady } from './socrata.js';
import { searchArcgis, arcgisReady } from './arcgis.js';
import { searchBusinesses } from './places.js';
import { log } from '../logger.js';

/*
 * Discovery orchestrator. Gathers businesses for one metro × category from many
 * sources, normalizes to one shape, and de-duplicates/merges across sources.
 *
 * Google Places is SELECTIVE by design: the free sources (Overpass + government
 * license data) run first and cost nothing. Places only runs if it's explicitly
 * in the source list AND a key is set — so the always-on auto-scan defaults to
 * free-only and never bills, while a manual scan can opt Places back in.
 */

const FREE = {
  overpass: { ready: overpassReady, run: searchOverpass },
  socrata: { ready: socrataReady, run: searchSocrata },
  arcgis: { ready: arcgisReady, run: searchArcgis },
};

/** Which sources are active right now, given config + keys. */
export function activeSources() {
  const list = config.discoverySources;
  const active = [];
  for (const name of list) {
    if (name === 'google-places') { if (isLive()) active.push(name); continue; }
    const p = FREE[name];
    if (p && p.ready()) active.push(name);
  }
  return active;
}

/** Merge b2 into b1, preferring non-empty contact fields; track all sources. */
function merge(b1, b2) {
  b1.website = b1.website || b2.website || '';
  b1.phone = b1.phone || b2.phone || '';
  b1.address = b1.address || b2.address || '';
  b1.city = b1.city || b2.city || null;
  b1.state = b1.state || b2.state || null;
  b1.zip = b1.zip || b2.zip || null;
  if ((b2.reviewCount || 0) > (b1.reviewCount || 0)) { b1.reviewCount = b2.reviewCount; b1.rating = b2.rating; }
  if (b2.placeId && !b1.placeId) b1.placeId = b2.placeId;
  b1.lat = b1.lat ?? b2.lat ?? null;
  b1.lng = b1.lng ?? b2.lng ?? null;
  b1.sources = Array.from(new Set([...(b1.sources || [b1.source]), b2.source]));
  return b1;
}

/**
 * discover({ category, metro, maxResults, sources }) → [business]
 * sources overrides config.discoverySources when provided.
 */
export async function discover({ category, metro, maxResults = 60, sources } = {}) {
  const names = (sources || activeSources()).filter((n) =>
    n === 'google-places' ? isLive() : FREE[n]?.ready()
  );
  if (!names.length) return [];

  // Run FREE sources concurrently (they hit unrelated hosts). Google is added
  // only if requested; it runs alongside but its cost is gated by the caller.
  const jobs = names.map(async (name) => {
    try {
      if (name === 'google-places') {
        return await searchBusinesses({
          searchTerm: category.searchTerm,
          includedType: category.placesType,
          lat: metro.lat,
          lng: metro.lng,
          cityLabel: `${metro.city}, ${metro.state}`,
          maxResults,
        }).then((rows) => rows.map((r) => ({ ...r, source: 'google-places' })));
      }
      return await FREE[name].run({ category, metro, maxResults });
    } catch (err) {
      log.warn(`discovery: source ${name} failed: ${err.message}`);
      return [];
    }
  });

  const perSource = await Promise.all(jobs);

  // De-dupe + merge across sources by lead identity.
  const byId = new Map();
  for (const rows of perSource) {
    for (const b of rows) {
      if (!b?.name) continue;
      b.sources = b.sources || [b.source];
      const id = leadId(b);
      const existing = byId.get(id);
      if (existing) merge(existing, b);
      else byId.set(id, b);
    }
  }
  return Array.from(byId.values());
}
