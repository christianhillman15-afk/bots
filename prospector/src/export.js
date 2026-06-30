import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { toCsv } from './util.js';

const COLUMNS = [
  { header: 'score', get: (l) => l.score?.value },
  { header: 'tier', get: (l) => l.score?.tier },
  { header: 'business', get: (l) => l.business?.name },
  { header: 'category', get: (l) => l.business?.categoryLabel },
  { header: 'city', get: (l) => l.business?.city },
  { header: 'state', get: (l) => l.business?.state },
  { header: 'phone', get: (l) => l.business?.phone },
  { header: 'website', get: (l) => l.business?.website },
  { header: 'presence', get: (l) => l.presence },
  { header: 'top_problem', get: (l) => l.audit?.problems?.[0]?.label },
  { header: 'all_problems', get: (l) => (l.audit?.problems || []).map((p) => p.label).join(' | ') },
  { header: 'reviews', get: (l) => l.business?.reviewCount },
  { header: 'rating', get: (l) => l.business?.rating },
  { header: 'est_opportunity_mo', get: (l) => l.score?.opportunityUsd },
  { header: 'google_maps', get: (l) => l.business?.googleMapsUri },
  { header: 'status', get: (l) => l.status },
  { header: 'strict_outreach_state', get: (l) => (l.compliance?.strictOutreachState ? 'yes' : '') },
  { header: 'call_script', get: (l) => opener(l, 'call') },
  { header: 'email_opener', get: (l) => opener(l, 'email') },
  { header: 'sms_opener', get: (l) => opener(l, 'sms') },
];

/** Pull a specific channel's opener text (falls back to the primary pitch). */
function opener(l, channel) {
  const found = (l.score?.openers || []).find((o) => o.channel === channel);
  return found?.text || (channel === 'call' ? l.score?.pitch || '' : '');
}

export function writeCsv(leads, outPath) {
  if (!existsSync(config.exportDir)) mkdirSync(config.exportDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = outPath
    ? resolve(process.cwd(), outPath)
    : resolve(config.exportDir, `oxsome-leads-${stamp}.csv`);
  writeFileSync(file, toCsv(leads, COLUMNS));
  return file;
}
