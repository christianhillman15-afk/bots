import { config } from '../config.js';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/**
 * Run Google PageSpeed Insights (Lighthouse) against a URL and pull the
 * high-signal scores. PSI is slow (~10–30s) and quota-bounded, so callers
 * should gate this behind the cheap probeSite() checks.
 *
 * Scores come back as 0..1 floats; we surface them as 0..100 integers.
 * Returns null on any failure so the audit can fall back to light checks.
 */
export async function pageSpeed(url, { strategy = 'mobile' } = {}) {
  const params = new URLSearchParams();
  params.set('url', url);
  params.set('strategy', strategy);
  for (const cat of ['PERFORMANCE', 'SEO', 'BEST_PRACTICES', 'ACCESSIBILITY']) {
    params.append('category', cat);
  }
  if (config.pagespeedApiKey) params.set('key', config.pagespeedApiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000); // PSI is slow
  try {
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const lr = data.lighthouseResult;
    if (!lr) return null;

    const cat = lr.categories || {};
    const audits = lr.audits || {};
    const pct = (c) => (c && typeof c.score === 'number' ? Math.round(c.score * 100) : null);
    const num = (id) =>
      audits[id] && typeof audits[id].numericValue === 'number' ? audits[id].numericValue : null;

    const result = {
      strategy,
      performance: pct(cat.performance),
      seo: pct(cat.seo),
      bestPractices: pct(cat['best-practices']),
      accessibility: pct(cat.accessibility),
      lcpMs: num('largest-contentful-paint'),
      fcpMs: num('first-contentful-paint'),
      cls: num('cumulative-layout-shift'),
      totalBytes: num('total-byte-weight'),
      serverMs: num('server-response-time'),
      viewportOk: audits.viewport ? audits.viewport.score === 1 : null,
      httpsOk: audits['is-on-https'] ? audits['is-on-https'].score === 1 : null,
      fieldCategory: data.loadingExperience?.overall_category ?? null,
      problems: [],
    };

    const p = result.problems;
    if (result.performance !== null && result.performance < 50) {
      p.push({
        code: 'low_performance',
        label: `Failing performance score (${result.performance}/100)`,
        severity: 2,
        detail: `Google grades this site's mobile speed ${result.performance}/100. Slow sites lose calls and rank lower.`,
      });
    }
    if (result.seo !== null && result.seo < 70) {
      p.push({
        code: 'low_seo',
        label: `Weak SEO score (${result.seo}/100)`,
        severity: 2,
        detail: `Lighthouse SEO score is ${result.seo}/100 — the site isn't built to be found on Google.`,
      });
    }
    if (result.lcpMs !== null && result.lcpMs > 4000) {
      p.push({
        code: 'slow_lcp',
        label: `Slow load (LCP ${(result.lcpMs / 1000).toFixed(1)}s)`,
        severity: 2,
        detail: `Main content takes ${(result.lcpMs / 1000).toFixed(1)}s to appear on mobile (good is <2.5s).`,
      });
    }
    if (result.totalBytes !== null && result.totalBytes > 4_000_000) {
      p.push({
        code: 'heavy_page',
        label: `Bloated page (${(result.totalBytes / 1_048_576).toFixed(1)} MB)`,
        severity: 1,
        detail: 'Homepage is very heavy — punishing on phones and slow connections.',
      });
    }
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
