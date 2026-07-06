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
    'LaunchMediaProspectorBot/1.0 (+https://wearelaunchmedia.com; website quality audit)',
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
  // After each auto-scan, also verify missing websites + find emails (ON by
  // default; set AUTO_ENRICH=false to disable). autoEnrichLimit caps how many
  // leads get enriched per tick to stay within free quotas.
  autoEnrich: !/^(0|false|no|off)$/i.test(process.env.AUTO_ENRICH || ''),
  autoEnrichLimit: Number(process.env.AUTO_ENRICH_LIMIT) || 40,
  // Website verification — searches the live web to catch real sites Google
  // Places didn't list, so "no website" leads are accurate. Works with EITHER
  // Claude (web search tool) or Gemini (Google Search grounding); Claude wins
  // if both keys are set.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || '',
  anthropicModel: process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5',
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || '',
  geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
  // Hard cap on web searches (website-verify + owner lookup combined) to keep
  // usage safely inside the provider's FREE grounding allowance so you're never
  // billed. Gemini 2.5 free grounding is DAILY (1,500/day, billed per lead), so
  // we default to a daily cap of 1,400. For Gemini 3.x (MONTHLY 5,000/mo, billed
  // per query) set SEARCH_CAP_PERIOD=month and SEARCH_CAP=1500. SEARCH_CAP=0
  // disables the cap.
  searchCapPeriod:
    process.env.SEARCH_CAP_PERIOD?.toLowerCase() === 'month' ? 'month' : 'day',
  searchCap:
    process.env.SEARCH_CAP !== undefined ? Number(process.env.SEARCH_CAP)
    : process.env.SEARCH_DAILY_CAP !== undefined ? Number(process.env.SEARCH_DAILY_CAP)
    : process.env.SEARCH_MONTHLY_CAP !== undefined ? Number(process.env.SEARCH_MONTHLY_CAP)
    : 1400,
};

/** True when we have a real Places key; otherwise we run on demo data. */
export const isLive = () => Boolean(config.placesApiKey);
