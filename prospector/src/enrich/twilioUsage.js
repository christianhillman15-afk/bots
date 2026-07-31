import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';

/*
 * Hard, persisted daily cap on Twilio Lookup calls — the guardrail that makes a
 * runaway bill (like the accidental 8,800-number line-type) impossible.
 *
 * reserveLookup() is the single chokepoint: EVERY Twilio lookup must reserve a
 * slot first, and once the day's cap is hit it returns false and no API call is
 * made. Reads/writes are synchronous with no await in between, so concurrent
 * lookups can't race past the cap. Reserving up front (and not refunding failed
 * lookups) errs toward UNDER-spending — never over.
 */

const file = () => resolve(config.dataDir, 'twilio-usage.json');
const today = () => new Date().toISOString().slice(0, 10);

function read() {
  try {
    const d = JSON.parse(readFileSync(file(), 'utf8'));
    return d && d.day === today() ? { day: d.day, used: Number(d.used) || 0 } : { day: today(), used: 0 };
  } catch {
    return { day: today(), used: 0 };
  }
}

function write(d) {
  try {
    if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(file(), JSON.stringify(d));
  } catch { /* best effort — if we can't persist, reserve() still refuses below */ }
}

export function twilioUsage() {
  const d = read();
  const cap = config.twilioDailyLookupCap;
  return { day: d.day, used: d.used, cap, remaining: Math.max(0, cap - d.used) };
}

/** Reserve one lookup. Returns true (and records it) only if under today's cap. */
export function reserveLookup() {
  const d = read();
  if (d.used >= config.twilioDailyLookupCap) return false;
  d.used += 1;
  write(d);
  // Verify the write actually stuck; if persistence failed and we somehow
  // exceeded the cap in memory, refuse. (Defensive — write() is best-effort.)
  return read().used <= config.twilioDailyLookupCap;
}

/** How many more lookups are allowed today (for previews/UI). */
export function twilioRemaining() {
  return twilioUsage().remaining;
}
