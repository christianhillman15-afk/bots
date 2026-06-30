import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..');

export const config = {
  placesApiKey: process.env.GOOGLE_PLACES_API_KEY?.trim() || '',
  pagespeedApiKey: process.env.PAGESPEED_API_KEY?.trim() || '',
  auditMode: (process.env.AUDIT_MODE || 'light').toLowerCase(),
  port: Number(process.env.PORT) || 4317,
  userAgent:
    process.env.AUDIT_USER_AGENT ||
    'OxsomeProspectorBot/1.0 (+https://oxsome.com; website quality audit)',
  auditConcurrency: Number(process.env.AUDIT_CONCURRENCY) || 6,
  auditTimeoutMs: Number(process.env.AUDIT_TIMEOUT_MS) || 12000,
  // DATA_DIR lets a host mount a persistent disk so leads survive restarts.
  dataDir: process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(ROOT, 'data'),
  exportDir: resolve(ROOT, 'exports'),
  publicDir: resolve(ROOT, 'public'),
  // Dashboard login. If DASHBOARD_PASSWORD is set, the dashboard requires it
  // (use this whenever the tool is reachable over the internet). Unset = open
  // (fine for running privately on your own machine).
  dashboardUser: process.env.DASHBOARD_USER?.trim() || 'surge',
  dashboardPassword: process.env.DASHBOARD_PASSWORD?.trim() || '',
  // Auto-pilot: when on, the app scans on a schedule, rotating across all
  // metros × categories so leads keep accumulating with no manual clicks.
  // Defaults are tuned to stay inside Google's free 1,000 searches/month.
  autoScan: /^(1|true|yes|on)$/i.test(process.env.AUTO_SCAN || ''),
  autoScanIntervalMin: Number(process.env.AUTO_SCAN_INTERVAL_MIN) || 180,
  autoScanChunk: Number(process.env.AUTO_SCAN_CHUNK) || 3, // categories per tick
  autoScanMaxPerCity: Number(process.env.AUTO_SCAN_MAX) || 20,
};

/** True when we have a real Places key; otherwise we run on demo data. */
export const isLive = () => Boolean(config.placesApiKey);
