import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

/*
 * Emergency stop for the WHOLE prospector. One flag, persisted to disk so it
 * survives restarts. When engaged, every code path that could spend money
 * (manual scan, auto-scan tick, special-request runs, website/phone verify)
 * refuses to run. It's the single big red button: flip it and nothing can bill
 * you until you deliberately flip it back.
 */
const file = () => resolve(config.dataDir, 'emergency-stop.json');
let stopped = existsSync(file());
let reason = '';
try {
  if (stopped) reason = JSON.parse(readFileSync(file(), 'utf8')).reason || '';
} catch { /* flag file present = stopped, details optional */ }

export function isStopped() {
  return stopped;
}

export function stopState() {
  return { stopped, reason };
}

export function engage(why = 'Emergency stop engaged from the dashboard.') {
  stopped = true;
  reason = why;
  try {
    if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(file(), JSON.stringify({ stopped: true, reason: why, at: new Date().toISOString() }));
  } catch { /* in-memory flag still holds for this process */ }
  log.warn(`🛑 EMERGENCY STOP engaged — all scanning + paid API calls blocked. ${why}`);
  return stopState();
}

export function release() {
  stopped = false;
  reason = '';
  try { if (existsSync(file())) rmSync(file()); } catch { /* non-fatal */ }
  log.ok('Emergency stop released — scanning can run again.');
  return stopState();
}

/** Throw if stopped — call at the top of any paid endpoint. */
export function assertNotStopped() {
  if (stopped) {
    const err = new Error('Emergency stop is engaged — all scanning and paid API calls are blocked. Release it on the dashboard to run again.');
    err.code = 'EMERGENCY_STOP';
    throw err;
  }
}
