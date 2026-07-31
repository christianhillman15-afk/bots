import { config } from '../config.js';
import { ARCGIS_DATASETS, ARCGIS_CATEGORY_KEYWORDS } from '../data/arcgisDatasets.js';
import { log } from '../logger.js';

/*
 * ArcGIS REST FeatureServer provider — FREE government contractor/license data
 * for the many portals that publish on ArcGIS instead of Socrata. One paged
 * query returns many businesses. We push city/category filters into the `where`
 * clause so the server returns a small relevant slice, and cap the pull so a
 * scan tick stays fast.
 */

export const arcgisReady = () => config.arcgisEnabled && ARCGIS_DATASETS.length > 0;

const escLike = (s) => String(s).replace(/'/g, "''");

function buildWhere(ds, metro, category) {
  const clauses = [];
  const f = ds.fields;
  // Geographic scope (required): a city column, OR "CITY, ST" embedded in the
  // address. Without one, we'd return the same wrong-location rows for every
  // metro — so the caller skips such datasets entirely.
  if (ds.cityField && metro.city) {
    clauses.push(`UPPER(${ds.cityField})='${escLike(metro.city.toUpperCase())}'`);
  } else if (ds.addressField && metro.city && metro.state) {
    clauses.push(`UPPER(${ds.addressField}) LIKE '%${escLike(metro.city.toUpperCase())}, ${escLike(metro.state.toUpperCase())}%'`);
  }
  if (ds.activeOnly) clauses.push(`UPPER(${ds.activeOnly.field})='${escLike(String(ds.activeOnly.equals).toUpperCase())}'`);
  const kws = ARCGIS_CATEGORY_KEYWORDS[category.key];
  if (f.category && kws?.length) {
    const ors = kws.map((k) => `UPPER(${f.category}) LIKE '%${escLike(k.toUpperCase())}%'`).join(' OR ');
    clauses.push(`(${ors})`);
  }
  return clauses.length ? clauses.join(' AND ') : '1=1';
}

function normalizeRow(ds, attrs) {
  const f = ds.fields;
  const val = (key) => (key && attrs[key] != null ? String(attrs[key]).trim() : '');
  const name = val(f.name);
  if (!name) return null;
  return {
    placeId: null,
    source: 'arcgis',
    sourceId: `${ds.jurisdiction}/${val(f.name)}-${val(f.address)}`.slice(0, 200),
    sourceUrl: ds.url,
    name,
    address: val(f.address),
    city: val(f.city) || null,
    state: val(f.state) || ds.state || null,
    zip: val(f.zip) || null,
    phone: val(f.phone),
    website: '',
    rating: null,
    reviewCount: 0,
    businessStatus: 'OPERATIONAL',
    licenseStatus: val(f.status) || null,
    licenseCategory: val(f.category) || null,
  };
}

export async function searchArcgis({ category, metro, maxResults = 200 }) {
  if (!arcgisReady()) return [];
  const datasets = ARCGIS_DATASETS
    .filter((d) => !d.state || d.state === metro.state)
    // Only datasets we can geographically scope to this metro (never mislabel).
    .filter((d) => (d.cityField && metro.city) || (d.addressField && metro.city && metro.state));
  if (!datasets.length) return [];

  const out = [];
  for (const ds of datasets) {
    if (out.length >= maxResults) break;
    const where = buildWhere(ds, metro, category);
    const params = new URLSearchParams({
      where,
      outFields: '*',
      returnGeometry: 'false',
      resultRecordCount: String(Math.min(maxResults, 1000)),
      f: 'json',
    });
    try {
      const res = await fetch(`${ds.url}/query?${params.toString()}`, {
        headers: { Accept: 'application/json', 'User-Agent': config.userAgent },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) { log.warn(`arcgis ${ds.jurisdiction} ${res.status}`); continue; }
      const data = await res.json();
      if (data.error) { log.warn(`arcgis ${ds.jurisdiction}: ${data.error?.message || 'query error'}`); continue; }
      for (const feat of data.features || []) {
        const b = normalizeRow(ds, feat.attributes || {});
        if (b) out.push(b);
      }
    } catch (err) {
      log.warn(`arcgis ${ds.jurisdiction} failed: ${err.message}`);
    }
  }
  return out.slice(0, maxResults);
}
