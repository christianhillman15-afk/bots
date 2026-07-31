import { config } from '../config.js';
import { SOCRATA_DATASETS, SOCRATA_CATEGORY_KEYWORDS } from '../data/socrataDatasets.js';
import { log } from '../logger.js';

/*
 * Socrata Open Data provider — FREE government business/contractor-license data.
 * One bulk SoQL query per dataset returns many businesses. A free app token
 * (SOCRATA_APP_TOKEN) just raises throttling limits; anonymous works too.
 *
 * We only query datasets whose state matches the metro being scanned, and we
 * push the city + category filters into SoQL so the server does the work and we
 * pull a small, relevant slice — not the whole dataset.
 */

export const socrataReady = () => config.socrataEnabled && SOCRATA_DATASETS.length > 0;

function headers() {
  const h = { Accept: 'application/json', 'User-Agent': config.userAgent };
  if (config.socrataAppToken) h['X-App-Token'] = config.socrataAppToken;
  return h;
}

const esc = (s) => String(s).replace(/'/g, "''"); // SoQL string literal escape

function buildWhere(ds, metro, category) {
  const clauses = [];
  const f = ds.fields;
  if (ds.cityField && metro.city) clauses.push(`upper(${ds.cityField})='${esc(metro.city.toUpperCase())}'`);
  if (ds.activeOnly) clauses.push(`upper(${ds.activeOnly.field})='${esc(String(ds.activeOnly.equals).toUpperCase())}'`);
  const kws = SOCRATA_CATEGORY_KEYWORDS[category.key];
  if (f.category && kws?.length) {
    const ors = kws.map((k) => `upper(${f.category}) like '%${esc(k.toUpperCase())}%'`).join(' OR ');
    clauses.push(`(${ors})`);
  }
  return clauses.join(' AND ');
}

function normalizeRow(ds, row) {
  const f = ds.fields;
  const val = (key) => (key && row[key] != null ? String(row[key]).trim() : '');
  const name = val(f.name);
  if (!name) return null;
  return {
    placeId: null,
    source: 'socrata',
    sourceId: `${ds.domain}/${ds.datasetId}/${val(f.name)}-${val(f.address)}`.slice(0, 200),
    sourceUrl: `https://${ds.domain}/resource/${ds.datasetId}.json`,
    name,
    address: val(f.address),
    city: val(f.city) || null,
    state: val(f.state) || ds.state || null,
    zip: val(f.zip) || null,
    phone: val(f.phone),
    website: '', // license data rarely lists a website — that's the whole point
    rating: null,
    reviewCount: 0,
    businessStatus: 'OPERATIONAL',
    licenseStatus: val(f.status) || null,
    licenseCategory: val(f.category) || null,
  };
}

export async function searchSocrata({ category, metro, maxResults = 200 }) {
  if (!socrataReady()) return [];
  const datasets = SOCRATA_DATASETS.filter((d) => !d.state || d.state === metro.state);
  if (!datasets.length) return []; // no dataset covers this metro's state

  const out = [];
  for (const ds of datasets) {
    if (out.length >= maxResults) break;
    const where = buildWhere(ds, metro, category);
    const params = new URLSearchParams({ $limit: String(Math.min(maxResults, 1000)) });
    if (where) params.set('$where', where);
    const url = `https://${ds.domain}/resource/${ds.datasetId}.json?${params.toString()}`;
    try {
      const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(30_000) });
      if (!res.ok) { log.warn(`socrata ${ds.jurisdiction} ${res.status}`); continue; }
      const rows = await res.json();
      for (const r of rows) {
        const b = normalizeRow(ds, r);
        if (b) out.push(b);
      }
    } catch (err) {
      log.warn(`socrata ${ds.jurisdiction} failed: ${err.message}`);
    }
  }
  return out.slice(0, maxResults);
}
