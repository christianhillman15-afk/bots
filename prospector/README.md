# ⚡ SURGE Prospector

**A lead-finding engine for [SURGE](../website).** It hunts the entire United States for local
businesses that are **bleeding money because of their website** — the ones with **no site at all**,
a **social page masquerading as a website**, a **broken/parked domain**, or a **slow, insecure,
not-mobile, un-rankable site** — and surfaces only the ones that look **established enough to afford
SURGE** ($750–$2,500/mo).

It answers the exact pitch on the SURGE homepage — *"your competitor is stealing your calls"* — by
handing your sales process a ranked, filterable list of businesses for whom that's literally true,
each with the audit findings, an opportunity estimate, and a ready-to-send opener.

> Works with **zero setup** in a realistic **demo mode**. Add a Google API key to hunt real
> businesses nationwide.

---

## The thesis

A busy, well-reviewed business in a major metro **with no/bad website** is leaving real money on the
table every day — *"in shambles because of it."* That's the textbook SURGE customer. Prospector
scores every business on the **intersection of three signals**:

| Signal | What it measures | Source |
|---|---|---|
| 🔴 **Presence problem** | How broken/absent their web presence is (the pain) | Live website audit |
| 💰 **Affordability** | Do they look established enough to pay? | Google review count (revenue proxy), rating, category ticket size |
| 📈 **Market demand** | How busy/populated their market is (size of the leak) | City + metro population |

A `🔥 Hot` lead = severe web problem **×** clearly affordable **×** big market.

---

## Quick start (demo mode — no keys needed)

```bash
cd prospector
npm install

# Hunt the 10 biggest US cities across every category
npm run scan -- --cities 10 --categories all --max 15

# Launch the dashboard
npm run serve         # → http://localhost:4317
```

Demo mode generates **realistic sample businesses** (the same distribution you'd find on Google
Maps — lots with no site, social-only pages, broken domains, weak builder sites) so you can see the
entire pipeline — search → audit → score → dashboard → CSV — before spending a cent.

## Going live (real businesses nationwide)

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/) and enable:
   - **Places API (New)** — the lead source (required)
   - **PageSpeed Insights API** — deeper website audits (optional)
2. Copy `.env.example` → `.env` and paste your key(s):
   ```bash
   cp .env.example .env
   # GOOGLE_PLACES_API_KEY=AIza...
   ```
3. Scan for real:
   ```bash
   npm run scan -- --city "Houston, TX" --category roofing --full
   ```

The badge in the dashboard flips to **LIVE · Google Places** automatically when a key is present.

---

## CLI

```
prospector scan      Hunt for leads across US metros × categories
prospector list      Show stored leads (filterable)
prospector stats     Summary of the lead pipeline
prospector export    Write leads to CSV for outreach
prospector serve     Launch the web dashboard
```

**Scan options**

| Flag | Meaning |
|---|---|
| `--cities N` | Use the top-N most populous US cities (default 5) |
| `--city "Austin, TX"` | Target a specific metro (repeatable) |
| `--category <key>` | One category (repeatable, or comma list) |
| `--categories all` | Scan every category |
| `--max N` | Max businesses per city per category (default 20, Places caps at 60) |
| `--min-score N` | Only keep leads scoring ≥ N |
| `--full` | Deep audit with PageSpeed Insights (live sites only) |

**Examples**

```bash
npm run scan -- --cities 25 --categories all --max 20      # broad national sweep
npm run scan -- --city "Phoenix, AZ" --category hvac --full # one trade, one metro, deep audit
npm run list -- --tier hot --state TX --sort opportunity    # review the best TX leads
npm run export -- --tier hot --out exports/hot-leads.csv     # hand off to outreach
```

Category keys: `hvac, roofing, remodeling, custom-home-builder, water-restoration,
personal-injury-attorney, dentist, orthodontist, med-spa, electrical, plumbing, paving, pest-control,
chiropractor, cpa-accounting, law-firm, veterinary, garage-door, fencing, tree-service, pool-service,
concrete, auto-body, epoxy-flooring, auto-repair, painting, landscaping, junk-removal, locksmith,
appliance-repair`

---

## Dashboard

`npm run serve` launches a SURGE-branded control room:

- **Pipeline stats** — total leads, 🔥 hot count, businesses with no real website, total estimated
  monthly opportunity.
- **Run a hunt** — kick off a scan (pick metros, categories, depth) without touching the terminal.
- **Filter & sort** — by tier, problem type, state, category, reviews, opportunity, or free-text.
- **Lead cards** — expand any lead to see every audit problem, why it's a lead, full contact info, a
  one-click **PageSpeed report** link, a **copy-the-pitch** button, and a status dropdown
  (`new → contacted → interested → won/dead`) that persists.
- **Export CSV** — downloads exactly what's on screen (filters applied), ready for your CRM / cold-email tool.

---

## What counts as a "bad website"

The auditor runs fast, quota-free checks on every site first, and (in `--full` mode) layers Google
Lighthouse scores on top:

| Problem | Severity | How it's detected |
|---|---|---|
| **No website listed** | 🔴 critical | Google has no `websiteUri` for the business |
| **Social page only** | 🔴 critical | "Website" points to facebook.com / instagram.com / yelp.com / a Google business.site, etc. |
| **Down / unreachable** | 🔴 critical | Homepage times out or the connection fails |
| **HTTP error** | 🔴 critical | Homepage returns 4xx/5xx |
| **No HTTPS / insecure** | 🔴 critical | No valid TLS — browsers show "Not Secure" |
| **Parked / placeholder** | 🔴 critical | Known parking signatures or a near-empty page |
| **Not mobile-friendly** | 🟠 major | No mobile viewport tag |
| **Very slow** | 🟠 major | Slow first byte, or PageSpeed LCP > 4s |
| **Failing performance / SEO** | 🟠 major | Lighthouse performance < 50 or SEO < 70 (`--full`) |
| **Free-builder subdomain** | ⚪ minor | `*.wixsite.com`, `*.weebly.com`, etc. |
| **Missing title / stale / mixed content** | ⚪ minor | No `<title>`, copyright ≥ 2 years old, insecure assets |

A business is only kept as a lead if its presence is actually a problem — sites that audit clean are
filtered out automatically.

---

## Architecture

```
bin/prospector.js        CLI dispatch (scan / list / stats / export / serve)
src/
  config.js              env + mode (live vs demo)
  scan.js                orchestrator: search → audit → score → store
  store.js               JSON-backed lead store (upsert, dedupe, query)
  data/
    metros.js            75 most populous US cities (+ strict-outreach states)
    categories.js        30 target categories (ticket size, affordability)
  providers/
    places.js            Google Places API (New) — Text Search
    demo.js              deterministic sample data + synthesized audits
    index.js             provider factory (live vs demo)
  audit/
    fetchSite.js         fast HTTP/SSL/mobile/parked/social checks
    pagespeed.js         Google PageSpeed Insights (Lighthouse)
    robots.js            polite robots.txt honoring
    audit.js             presence classification + severity
  scoring/leadScore.js   SURGE Fit Score + opportunity estimate + pitch
  server.js / export.js  dashboard API + CSV
public/                  the dashboard (SURGE-branded)
```

No build step, native modules, or database — just Node 18+ and two pure-JS deps (`express`,
`dotenv`).

---

## What does live mode cost?

Google retired the flat $200/mo credit in March 2025; each Places SKU now has its own monthly free
allowance. Because Prospector needs the website, rating, review-count, and phone fields, each Text
Search call bills at the **Text Search Enterprise** SKU:

- **1,000 free Text Search requests/month**, then **~$35 per 1,000**.
- Each scan request returns up to 20 businesses; up to 3 pages (60 results) per city × category.
- **PageSpeed Insights** is free up to **25,000 requests/day** with a key.

So a sweep of *10 cities × 5 categories × 1 page* = 50 requests — comfortably inside the free tier.
A *25 cities × all 30 categories × 3 pages* sweep ≈ 2,250 requests ≈ **~$44/mo**. Start narrow,
widen as needed. (Pricing per Google's [usage & billing docs](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing); verify current rates.)

---

## Compliance & Guardrails

This tool surfaces **publicly available business information** for legitimate **B2B sales
prospecting**, and builds in the following guardrails. **This is not legal advice — confirm with
counsel before launching outreach, especially phone/SMS.**

**Google Places API terms.** Google's terms restrict long-term storage of Places "Content"; only the
`place_id` may be stored indefinitely, and cached lat/long must be dropped within 30 days. Prospector
keys every lead on its `place_id`, timestamps `firstSeen`/`lastSeen` so staleness is visible, and
treats the local store as a **refreshable working cache** — re-scan to refresh, and don't redistribute
the data or build a competing dataset from it.

**Polite website auditing.** The auditor reads each site's `robots.txt` and honors `Disallow` for its
user-agent, identifies itself honestly (`AUDIT_USER_AGENT`), fetches **only the public homepage**,
rate-limits with bounded concurrency, and backs off on errors. It never bypasses logins or anti-bot gates.

**US cold-outreach law.**
- **Email (CAN-SPAM)** is the safest cold channel — it's opt-out, B2B-friendly. Every send still
  needs accurate headers, a physical postal address, and a working unsubscribe honored within 10
  business days.
- **Phone/SMS (TCPA)** is strict: **there is no general B2B exemption for cell phones.** Do **not**
  autodial or cold-text business mobile numbers. Manually dialing a published business **landline** for
  B2B sales is generally permissible. Honor every opt-out / STOP promptly.
- **State "mini-TCPA" laws** (FL, OK, WA, TX and others) are stricter and carry class-action
  exposure. Prospector **flags leads in those states** (`strict_outreach_state` in exports, a ⚠ badge
  in the dashboard) so you route them to email or manual landline calls only.

Maintain a global suppression/opt-out list and scrub against it before every send.

Sources: [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms) ·
[Places API Policies](https://developers.google.com/maps/documentation/places/web-service/policies) ·
[FTC CAN-SPAM Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) ·
[TCPA / DNC B2B](https://www.dnc.com/faq/are-b2b-calls-exempt-tcpa-regulations) ·
[RFC 9309 robots.txt](https://www.rfc-editor.org/rfc/rfc9309.html)

---

## Limitations & notes

- **Opportunity ($/mo) is a deliberately conservative estimate** for the pitch (capped at $50k/mo),
  derived from market size, review volume, and ticket size — not a guarantee.
- Demo data is **synthetic** — names, phones, and reviews are generated, not real businesses.
- Places caps results at 60 per query (3 pages). To go deeper in one metro, scan multiple categories
  or sub-areas.
- Review count is a proxy for revenue, not a precise figure; pair it with judgment before outreach.
