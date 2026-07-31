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
  // Defaults target ~1,000 fresh leads/day: 24 ticks/day × 5 categories × ~20
  // businesses ≈ ~120 searches/day (~3,600/mo) — inside Google's $200/mo free
  // credit. Turn these DOWN to spend less, UP (with billing) to find more.
  autoScan: /^(1|true|yes|on)$/i.test(process.env.AUTO_SCAN || ''),
  autoScanIntervalMin: Number(process.env.AUTO_SCAN_INTERVAL_MIN) || 60,
  autoScanChunk: Number(process.env.AUTO_SCAN_CHUNK) || 5, // categories per tick
  autoScanMaxPerCity: Number(process.env.AUTO_SCAN_MAX) || 20,
  // After each auto-scan, also find emails + verify + owners (ON by default;
  // set AUTO_ENRICH=false to disable). autoEnrichLimit caps how many leads get
  // enriched per tick; the daily search cap still bounds paid API usage.
  autoEnrich: !/^(0|false|no|off)$/i.test(process.env.AUTO_ENRICH || ''),
  autoEnrichLimit: Number(process.env.AUTO_ENRICH_LIMIT) || 120,
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

  // ── Special Requests enrichment sources (all key-gated; no-op without keys) ──
  // Google Programmable Search (Custom Search JSON API): structured web results
  // for finding a company's website, owner, or email. 100 queries/day free,
  // then ~$5/1,000. Needs BOTH an API key and a Search-Engine ID (cx).
  googleCseApiKey: process.env.GOOGLE_CSE_API_KEY?.trim() || '',
  googleCseCx: process.env.GOOGLE_CSE_CX?.trim() || '',
  // Crunchbase: estimated revenue *range* for private companies it covers.
  crunchbaseApiKey: process.env.CRUNCHBASE_API_KEY?.trim() || '',
  // SEC EDGAR: exact reported revenue for PUBLIC US companies (free, no key).
  // Off by default since local trades are private; flip on for big-company runs.
  edgarEnabled: /^(1|true|yes|on)$/i.test(process.env.EDGAR_ENABLED || ''),
  edgarUserAgent: process.env.EDGAR_USER_AGENT?.trim() || 'Launch Media Prospector christian@wearelaunchmedia.com',
  // Twilio Lookup — line-type (mobile / landline / voip) so SMS only goes to
  // textable mobiles. Protects sender reputation. Basic Auth = SID + token.
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID?.trim() || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN?.trim() || '',
  // HARD daily ceiling on Twilio lookups so a bug/loop/repeat-click can never
  // run up a bill again. At ~$0.008 each, the default 1,000/day caps spend at
  // ~$8/day no matter what. Persisted across restarts. Raise it deliberately if
  // you ever need a bigger one-time batch. 0 is treated as this default, never
  // "unlimited" — over-spend protection can't be turned off by accident.
  twilioDailyLookupCap: Number(process.env.TWILIO_DAILY_LOOKUP_CAP) || 1000,
  // Apollo.io — B2B people data: owner/decision-maker name, title, email, phone.
  apolloApiKey: process.env.APOLLO_API_KEY?.trim() || '',
  // Supabase — durable cloud Postgres for leads (survives any droplet death,
  // no more OOM). The SERVICE key is a secret (full DB access) — .env / GitHub
  // Secrets only, NEVER committed (the repo is public).
  supabaseUrl: process.env.SUPABASE_URL?.trim() || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '',
  // HARD DAILY ceiling on Google Places search operations. Applies to BOTH the
  // always-on droplet auto-scanner (persisted per-day in a local file) AND the
  // cloud hunt (persisted per-day in Supabase). Once hit, scanning stops until
  // tomorrow so an unattended server can never bill past a safe daily rate. The
  // TRUE guarantee is still a daily quota set on the Places API in Google Cloud
  // itself (Google refuses calls past it) — this is the in-app companion.
  // Default 30/day (~900/mo) keeps usage inside the ~1,000/mo Enterprise free
  // tier for the website/rating search SKU. Raise with PLACES_DAILY_CALL_CAP.
  placesDailyCap: Number(process.env.PLACES_DAILY_CALL_CAP) || 30,

  // ── FREE discovery sources (OpenStreetMap + government open data) ────────────
  // These find businesses at $0 cost, so the scanner can run all day without
  // touching the paid Google Places SKU. Each is on by default and key-free.
  //   overpass — OpenStreetMap Overpass API (nationwide, no key)
  //   socrata  — Socrata open-data license datasets (no key; token raises limits)
  //   arcgis   — ArcGIS FeatureServer license datasets (no key)
  overpassEnabled: !/^(0|false|no|off)$/i.test(process.env.OVERPASS_ENABLED || ''),
  overpassRadiusMi: Number(process.env.OVERPASS_RADIUS_MI) || 25,
  socrataEnabled: !/^(0|false|no|off)$/i.test(process.env.SOCRATA_ENABLED || ''),
  socrataAppToken: process.env.SOCRATA_APP_TOKEN?.trim() || '',
  arcgisEnabled: !/^(0|false|no|off)$/i.test(process.env.ARCGIS_ENABLED || ''),
  // Ordered list of discovery sources the scanner uses. Google Places is
  // deliberately LEFT OUT of the default so the always-on scan is 100% free;
  // add 'google-places' here (and set a key) to include it as a gap-filler.
  discoverySources: (process.env.DISCOVERY_SOURCES || 'overpass,socrata,arcgis')
    .split(',').map((s) => s.trim()).filter(Boolean),

  // Stripe — the ONLY place a customer's card is ever handled. When these are
  // set, the "Create Customer" flow can generate a secure Stripe payment/
  // subscription link. The card is entered on Stripe's page and never touches
  // this app. Leave blank until you have the keys from your Stripe dashboard.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY?.trim() || '',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim() || '',
  stripePriceId: process.env.STRIPE_PRICE_ID?.trim() || '', // recurring plan price id

  // Netlify — auto-publishes a generated demo website for a lead ("I already
  // built you one"). The token is a secret; keep it in .env only, never in the
  // repo. From Netlify → User settings → Applications → Personal access tokens.
  netlifyToken: process.env.NETLIFY_TOKEN?.trim() || process.env.NETLIFY_AUTH_TOKEN?.trim() || '',

  // Sales reps — the people who can be assigned to a lead ("who called them").
  // Change the roster with SALES_REPS="Christian,Ethan,Jackson" in .env.
  reps: (process.env.SALES_REPS || 'Christian,Ethan,Jackson')
    .split(',').map((s) => s.trim()).filter(Boolean),
};

/** True when we have a real Places key; otherwise we run on demo data. */
export const isLive = () => Boolean(config.placesApiKey);
