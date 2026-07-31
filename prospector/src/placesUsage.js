import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';

/*
 * Local per-DAY counter of billable Google Places search requests, persisted to
 * a small JSON file so it survives restarts. This is the droplet's in-app quota:
 * once the day's cap is hit, the auto-scanner stops scanning until tomorrow, so
 * an unattended server can never bill past a safe daily rate.
 *
 * (The cloud hunt has the same guard backed by Supabase; this is the file-backed
 * twin for the always-on droplet, which previously had NO daily Places cap.)
 */
const file = () => resolve(config.dataDir, 'places-usage.json');
const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function read() {
  try {
    const s = JSON.parse(readFileSync(file(), 'utf8'));
    if (s && s.day === today()) return { day: s.day, used: Number(s.used) || 0 };
  } catch { /* missing/corrupt → fresh day */ }
  return { day: today(), used: 0 };
}

function write(state) {
  try {
    if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(file(), JSON.stringify(state));
  } catch { /* non-fatal: in-memory guard still holds for this process */ }
}

/** { day, used, cap, remaining } for today. Cap = config.placesDailyCap. */
export function getPlacesUsage() {
  const { day, used } = read();
  const cap = config.placesDailyCap;
  return { day, used, cap, remaining: Math.max(0, cap - used) };
}

/** Record n billable Places requests against today's counter. */
export function addPlacesUsage(n) {
  if (!n) return;
  const s = read();
  s.used += n;
  write(s);
}
