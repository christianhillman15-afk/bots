import { config } from '../config.js';
import { isAllowed } from './robots.js';

/* Hosts that mean "they don't really have a website — just a social page." */
const SOCIAL_HOSTS = [
  'facebook.com', 'fb.com', 'm.facebook.com', 'instagram.com', 'linktr.ee',
  'yelp.com', 'twitter.com', 'x.com', 'tiktok.com', 'nextdoor.com',
  'business.site', 'g.page', 'maps.google.com', 'goo.gl', 'linkedin.com',
];

/* Free/builder subdomains => low investment, usually weak & generic. */
const BUILDER_SUFFIXES = [
  'wixsite.com', 'weebly.com', 'squarespace.com', 'godaddysites.com',
  'square.site', 'webflow.io', 'wordpress.com', 'blogspot.com',
  'jimdosite.com', 'webnode.com', 'webs.com', 'mystrikingly.com',
  'site123.me', 'yolasite.com',
];

/* Strings that scream "parked / default / broken hosting page". */
const PARKED_SIGNS = [
  'domain is for sale', 'buy this domain', 'this domain is parked',
  'future home of something', 'domain for sale', 'is parked free',
  'apache2 ubuntu default page', 'welcome to nginx', 'index of /',
  'default web page', 'this site can’t be reached', 'account suspended',
  'website coming soon', 'under construction', 'godaddy.com',
  'sedoparking', 'hugedomains',
];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function endsWithAny(host, suffixes) {
  return suffixes.some((s) => host === s || host.endsWith('.' + s));
}

/**
 * Fetch a business website and run fast, quota-free quality checks.
 * Returns a structured probe with a list of `problems`.
 */
export async function probeSite(rawUrl) {
  const problems = [];
  const probe = {
    inputUrl: rawUrl,
    reachable: false,
    finalUrl: null,
    status: null,
    https: false,
    redirected: false,
    responseMs: null,
    bytes: null,
    hasTitle: false,
    title: null,
    mobileViewport: false,
    builder: null,
    socialOnly: false,
    parked: false,
    mixedContent: false,
    staleCopyright: null,
    problems,
  };

  // Normalize: add scheme if missing.
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const host = hostOf(url);

  // A "website" that's actually just a social profile = effectively no site.
  if (endsWithAny(host, SOCIAL_HOSTS)) {
    probe.socialOnly = true;
    problems.push({
      code: 'social_only',
      label: 'No real website — social page only',
      severity: 3,
      detail: `Their "website" points to ${host}. They have no site they own or control.`,
    });
    return probe;
  }

  if (endsWithAny(host, BUILDER_SUFFIXES)) {
    probe.builder = host.split('.').slice(-2).join('.');
    problems.push({
      code: 'free_builder',
      label: 'Free website-builder subdomain',
      severity: 1,
      detail: `Hosted on a free ${probe.builder} subdomain — a low-investment, hard-to-rank setup.`,
    });
  }

  // Be a polite citizen: honor robots.txt before fetching the homepage.
  if (!(await isAllowed(url))) {
    probe.robotsBlocked = true;
    problems.push({
      code: 'robots_blocked',
      label: 'Audit blocked by robots.txt',
      severity: 1,
      detail: 'Their site disallows automated fetching, so we could not assess page quality. Their Google listing is still a valid lead.',
    });
    return probe;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.auditTimeoutMs);
  const started = Date.now();
  try {
    let res;
    try {
      res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': config.userAgent, Accept: 'text/html,*/*' },
      });
    } catch (httpsErr) {
      // HTTPS failed outright — retry plain HTTP to learn whether the site
      // exists at all but lacks TLS (a serious trust/SEO problem in itself).
      if (url.startsWith('https://')) {
        const httpUrl = url.replace(/^https:/, 'http:');
        res = await fetch(httpUrl, {
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'User-Agent': config.userAgent, Accept: 'text/html,*/*' },
        });
        problems.push({
          code: 'no_https',
          label: 'No working HTTPS / insecure',
          severity: 3,
          detail: 'Site does not serve a valid HTTPS certificate. Browsers flag it "Not Secure" and Google demotes it.',
        });
      } else {
        throw httpsErr;
      }
    }

    probe.responseMs = Date.now() - started;
    probe.status = res.status;
    probe.finalUrl = res.url;
    probe.https = res.url.startsWith('https://');
    probe.redirected = res.redirected;
    probe.reachable = true;

    if (!probe.https && !problems.some((p) => p.code === 'no_https')) {
      problems.push({
        code: 'no_https',
        label: 'No HTTPS / insecure',
        severity: 3,
        detail: 'Final page is served over plain HTTP. Browsers mark it "Not Secure".',
      });
    }

    if (res.status >= 400) {
      problems.push({
        code: 'http_error',
        label: `Site returns HTTP ${res.status}`,
        severity: 3,
        detail: `The homepage responds with an error status (${res.status}). Customers hit a broken page.`,
      });
      clearTimeout(timer);
      return probe;
    }

    const html = (await res.text()) || '';
    probe.bytes = Buffer.byteLength(html);

    // Title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    probe.title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ').slice(0, 160) : null;
    probe.hasTitle = Boolean(probe.title);
    if (!probe.hasTitle) {
      problems.push({
        code: 'no_title',
        label: 'Missing page <title>',
        severity: 1,
        detail: 'No title tag — invisible/blank in Google results and browser tabs.',
      });
    }

    // Mobile viewport
    probe.mobileViewport = /<meta[^>]+name=["']?viewport["']?/i.test(html);
    if (!probe.mobileViewport) {
      problems.push({
        code: 'not_mobile',
        label: 'Not mobile-friendly',
        severity: 2,
        detail: 'No mobile viewport tag. Over half of local searches are on phones — this site breaks for them.',
      });
    }

    // Parked / default page — a known parking signature, OR a near-empty
    // page (tiny + no real title). Guard the byte floor so genuinely minimal
    // but real pages aren't flagged.
    const lower = html.toLowerCase();
    const nearEmpty = probe.bytes < 400 || (probe.bytes < 1500 && !probe.hasTitle);
    if (nearEmpty || PARKED_SIGNS.some((s) => lower.includes(s))) {
      probe.parked = true;
      problems.push({
        code: 'parked',
        label: 'Parked / placeholder / near-empty page',
        severity: 3,
        detail: 'The page looks parked, default, or essentially empty — there is no real website here.',
      });
    }

    // Mixed content on an HTTPS page (insecure assets)
    if (probe.https && /(src|href)=["']http:\/\//i.test(html)) {
      probe.mixedContent = true;
      problems.push({
        code: 'mixed_content',
        label: 'Insecure mixed content',
        severity: 1,
        detail: 'Loads some assets over plain HTTP on a secure page — triggers browser warnings.',
      });
    }

    // Slow first response
    if (probe.responseMs > 5000) {
      problems.push({
        code: 'slow',
        label: `Very slow (${(probe.responseMs / 1000).toFixed(1)}s to first byte)`,
        severity: 2,
        detail: '53% of mobile visitors abandon a page that takes over 3s. This one is much slower.',
      });
    }

    // Stale copyright (heuristic: latest 19xx/20xx year in footer area)
    const years = [...lower.matchAll(/(?:©|copyright|&copy;)[^0-9]{0,12}(20\d{2})/g)].map((m) =>
      Number(m[1])
    );
    if (years.length) {
      const newest = Math.max(...years);
      probe.staleCopyright = newest;
      const thisYear = new Date().getFullYear();
      if (thisYear - newest >= 2) {
        problems.push({
          code: 'stale',
          label: `Stale site (©${newest})`,
          severity: 1,
          detail: `Copyright stops at ${newest} — a strong sign the site is neglected and unmaintained.`,
        });
      }
    }
  } catch (err) {
    probe.reachable = false;
    probe.error = err.name === 'AbortError' ? 'timeout' : err.message;
    problems.push({
      code: 'unreachable',
      label: 'Website down / unreachable',
      severity: 3,
      detail:
        probe.error === 'timeout'
          ? `Homepage did not respond within ${config.auditTimeoutMs / 1000}s.`
          : `Could not load the site (${probe.error}). It may be down or misconfigured.`,
    });
  } finally {
    clearTimeout(timer);
  }

  return probe;
}
