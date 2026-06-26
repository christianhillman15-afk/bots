/* Small shared helpers, no dependencies. */

/** Run async `fn` over `items` with a bounded number in flight. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length || 0)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stable id for a business so re-scans dedupe instead of duplicating. */
export function leadId(business) {
  if (business.placeId) return `place:${business.placeId}`;
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `name:${norm(business.name)}|${norm(business.address)}`;
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const round = (n, d = 0) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

/** Format an integer as US currency without cents. */
export const usd = (n) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

/** Escape a value for CSV. */
export function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const head = columns.map((col) => csvCell(col.header)).join(',');
  const body = rows
    .map((row) => columns.map((col) => csvCell(col.get(row))).join(','))
    .join('\n');
  return head + '\n' + body + '\n';
}
