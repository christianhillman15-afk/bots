import { finalizeAudit } from '../audit/audit.js';

/*
 * Demo provider: deterministic, realistic sample businesses so the whole
 * pipeline (search → audit → score → dashboard) runs with ZERO API keys.
 * It reproduces the real distribution you'd find on Google Maps — lots of
 * shops with no site, social-only pages, broken/parked domains, and weak
 * builder sites, mixed with some perfectly fine ones (which get filtered out).
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

const SURNAMES = ['Alvarez', 'Becker', 'Caldwell', 'Diaz', 'Ellison', 'Franklin', 'Garza', 'Hoffman', 'Iverson', 'Jennings', 'Koch', 'Lambert', 'Mancini', 'Nguyen', 'Okafor', 'Patel', 'Quintero', 'Reyes', 'Salinas', 'Thompson', 'Underwood', 'Vargas', 'Whitaker', 'Yates'];
const ADJ = ['Elite', 'Premier', 'All-Star', 'Five Star', 'Reliable', 'Hometown', 'Summit', 'Liberty', 'Apex', 'Pioneer', 'Cornerstone', 'Bluebird', 'Ironclad', 'Evergreen'];
const SUFFIX = ['Co.', 'LLC', 'Services', 'Pros', '& Sons', 'Group', 'Inc.'];

/* Reads naturally in a business name, per category. */
const NOUN = {
  dentist: 'Dental', orthodontist: 'Orthodontics', chiropractor: 'Chiropractic',
  'med-spa': 'Med Spa', 'law-firm': 'Law', 'personal-injury-attorney': 'Injury Law',
  'cpa-accounting': 'Accounting', veterinary: 'Veterinary', 'auto-body': 'Auto Body',
  'auto-repair': 'Auto Repair', 'water-restoration': 'Restoration',
  'custom-home-builder': 'Custom Homes', 'epoxy-flooring': 'Epoxy Floors',
};
function nounFor(category) {
  if (NOUN[category.key]) return NOUN[category.key];
  return category.label.split(/ [&/]| and /)[0].trim();
}

function makeName(rand, category, metro) {
  const noun = nounFor(category);
  const style = Math.floor(rand() * 4);
  if (style === 0) return `${pick(rand, SURNAMES)} ${noun}`;
  if (style === 1) return `${pick(rand, ADJ)} ${noun} ${pick(rand, SUFFIX)}`;
  if (style === 2) return `${metro.city} ${noun} ${pick(rand, SUFFIX)}`;
  return `${pick(rand, ADJ)} ${noun}`;
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);

/* Weighted presence outcomes mirroring real Google Maps distributions. */
const PRESENCE_ROLL = [
  ['none', 0.34],
  ['social_only', 0.12],
  ['broken', 0.1],
  ['weak', 0.24],
  ['ok', 0.2],
];
function rollPresence(rand) {
  let r = rand();
  for (const [p, w] of PRESENCE_ROLL) {
    if (r < w) return p;
    r -= w;
  }
  return 'ok';
}

/* Problem palettes for synthesized "weak"/"broken" demo sites. */
const WEAK_SETS = [
  [
    { code: 'not_mobile', label: 'Not mobile-friendly', severity: 2, detail: 'No mobile viewport — breaks on phones, where most local searches happen.' },
    { code: 'no_https', label: 'No HTTPS / insecure', severity: 3, detail: 'Served over plain HTTP. Browsers flag it "Not Secure" and Google demotes it.' },
  ],
  [
    { code: 'free_builder', label: 'Free website-builder subdomain', severity: 1, detail: 'Hosted on a free wixsite.com subdomain — low-investment and hard to rank.' },
    { code: 'slow', label: 'Very slow (6.8s to first byte)', severity: 2, detail: '53% of mobile visitors abandon a page that takes over 3s. This is far slower.' },
    { code: 'stale', label: 'Stale site (©2016)', severity: 1, detail: 'Copyright stops at 2016 — a clear sign the site is neglected.' },
  ],
  [
    { code: 'low_performance', label: 'Failing performance score (31/100)', severity: 2, detail: 'Google grades mobile speed 31/100. Slow sites lose calls and rank lower.' },
    { code: 'low_seo', label: 'Weak SEO score (52/100)', severity: 2, detail: "Lighthouse SEO score 52/100 — the site isn't built to be found." },
    { code: 'not_mobile', label: 'Not mobile-friendly', severity: 2, detail: 'No mobile viewport tag — unusable on phones.' },
  ],
  [
    { code: 'no_title', label: 'Missing page <title>', severity: 1, detail: 'No title tag — blank in Google results and browser tabs.' },
    { code: 'slow', label: 'Very slow (5.4s to first byte)', severity: 2, detail: 'Painfully slow on mobile connections.' },
  ],
];
const BROKEN_SETS = [
  [{ code: 'unreachable', label: 'Website down / unreachable', severity: 3, detail: 'Homepage does not respond. The site is effectively offline.' }],
  [{ code: 'parked', label: 'Parked / placeholder page', severity: 3, detail: 'Domain shows a parking/placeholder page — there is no real website here.' }],
  [{ code: 'http_error', label: 'Site returns HTTP 500', severity: 3, detail: 'The homepage responds with a server error. Customers hit a broken page.' }],
];

/** Build one demo business + its baked-in audit scenario. */
function makeBusiness(rand, category, metro, idx) {
  const name = makeName(rand, category, metro);
  const s = slug(name);
  const presence = rollPresence(rand);

  // Reviews: log-ish spread, independent of presence so we get juicy
  // high-review / no-website "in shambles" leads.
  const reviewCount = Math.floor(2 + rand() ** 2.2 * 480);
  const rating = Math.round((3.6 + rand() * 1.4) * 10) / 10;

  let website = '';
  let scenario = { presence, problems: [] };
  if (presence === 'social_only') {
    website = `https://facebook.com/${s}`;
    scenario.problems = [{ code: 'social_only', label: 'No real website — social page only', severity: 3, detail: `Their "website" points to facebook.com. They own/control no site of their own.` }];
  } else if (presence === 'broken') {
    website = `https://${s}.com`;
    scenario.problems = pick(rand, BROKEN_SETS);
  } else if (presence === 'weak') {
    const set = pick(rand, WEAK_SETS);
    website = set.some((p) => p.code === 'free_builder') ? `https://${s}.wixsite.com/home` : `https://${s}.com`;
    scenario.problems = set;
  } else if (presence === 'ok') {
    website = `https://${s}.com`;
  } // none => no website

  const lat = metro.lat + (rand() - 0.5) * 0.18;
  const lng = metro.lng + (rand() - 0.5) * 0.18;
  return {
    placeId: `demo:${hash(s + metro.city + category.key + idx).toString(36)}`,
    name,
    address: `${100 + Math.floor(rand() * 8900)} ${pick(rand, ['Main', 'Oak', 'Elm', 'Commerce', 'Industrial', 'Market', 'Sunset'])} ${pick(rand, ['St', 'Ave', 'Blvd', 'Dr'])}, ${metro.city}, ${metro.state}`,
    city: metro.city,
    state: metro.state,
    zip: null,
    phone: `(${200 + Math.floor(rand() * 700)}) ${100 + Math.floor(rand() * 800)}-${1000 + Math.floor(rand() * 8999)}`,
    website,
    rating,
    reviewCount,
    businessStatus: 'OPERATIONAL',
    priceLevel: null,
    primaryType: category.placesType || category.key,
    types: [category.placesType || category.key],
    lat,
    lng,
    googleMapsUri: `https://maps.google.com/?q=${encodeURIComponent(name + ' ' + metro.city)}`,
    _demo: scenario,
  };
}

/** Provider.search — generate businesses for a city+category. */
export function search({ category, metro, maxResults = 14 }) {
  const seed = hash(`${metro.city}|${metro.state}|${category.key}`);
  const rand = mulberry32(seed);
  const n = Math.min(maxResults, 8 + Math.floor(rand() * 8)); // 8–15
  const out = [];
  for (let i = 0; i < n; i++) out.push(makeBusiness(rand, category, metro, i));
  return out;
}

/** Provider.audit — synthesize the audit from the baked-in scenario. */
export function audit(business) {
  const d = business._demo || { presence: business.website ? 'ok' : 'none', problems: [] };
  let problems = d.problems;
  if (d.presence === 'none' && !problems.length) {
    problems = [{ code: 'no_website', label: 'No website listed', severity: 3, detail: 'Google has no website for this business — invisible to everyone searching online.' }];
  }
  const probe = business.website
    ? { reachable: d.presence !== 'broken', finalUrl: business.website, https: business.website.startsWith('https'), responseMs: 800 + Math.floor(Math.random() * 4000), title: d.presence === 'ok' ? business.name : null }
    : null;
  return finalizeAudit(d.presence, problems, { probe });
}

export const providerName = 'demo';
