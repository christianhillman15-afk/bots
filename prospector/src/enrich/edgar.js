import { config } from '../config.js';

/*
 * SEC EDGAR — exact reported revenue for PUBLIC U.S. companies (free, no key).
 *
 * EDGAR only covers companies that file with the SEC, i.e. public companies —
 * so it will NOT match private local home-services firms. It's here for the
 * big-company use case (Big Guys / national brands). Off by default
 * (EDGAR_ENABLED=true to turn on). Always returns null on any miss/error.
 *
 * SEC asks for a descriptive User-Agent with contact info on every request.
 */

let tickerCache = null; // { normalizedTitle -> cik10 }

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|co|corp|company|ltd|group|the)\b/g, '').replace(/\s+/g, ' ').trim();

async function loadTickers() {
  if (tickerCache) return tickerCache;
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': config.edgarUserAgent, Accept: 'application/json' },
    });
    if (!res.ok) return (tickerCache = {});
    const data = await res.json();
    const map = {};
    for (const row of Object.values(data)) {
      const cik10 = String(row.cik_str).padStart(10, '0');
      map[norm(row.title)] = cik10;
    }
    return (tickerCache = map);
  } catch {
    return (tickerCache = {});
  }
}

/** Latest annual revenue for a public company by name, or null. */
export async function enrichEdgar(business) {
  if (!config.edgarEnabled) return null; // gated: only for big-company runs
  const key = norm(business.name);
  if (!key) return null;
  try {
    const tickers = await loadTickers();
    const cik = tickers[key];
    if (!cik) return null; // not public / no exact match
    const CONCEPTS = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'];
    for (const concept of CONCEPTS) {
      const res = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`, {
        headers: { 'User-Agent': config.edgarUserAgent, Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const annual = (data.units?.USD || []).filter((u) => u.form === '10-K' && u.fp === 'FY' && typeof u.val === 'number');
      if (!annual.length) continue;
      annual.sort((a, b) => (a.end || '').localeCompare(b.end || ''));
      const latest = annual[annual.length - 1];
      return { revenueUsd: latest.val, fiscalYear: (latest.end || '').slice(0, 4), cik, source: 'sec-edgar' };
    }
    return null;
  } catch {
    return null;
  }
}
