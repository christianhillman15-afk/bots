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
    'SurgeProspectorBot/1.0 (+https://wearelaunchmedia.com; website quality audit)',
  auditConcurrency: Number(process.env.AUDIT_CONCURRENCY) || 6,
  auditTimeoutMs: Number(process.env.AUDIT_TIMEOUT_MS) || 12000,
  dataDir: resolve(ROOT, 'data'),
  exportDir: resolve(ROOT, 'exports'),
  publicDir: resolve(ROOT, 'public'),
};

/** True when we have a real Places key; otherwise we run on demo data. */
export const isLive = () => Boolean(config.placesApiKey);
