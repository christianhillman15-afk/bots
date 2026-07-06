import { config } from '../config.js';
import { probeSite } from './fetchSite.js';
import { pageSpeed } from './pagespeed.js';
import { clamp, round } from '../util.js';

/**
 * Presence categories, worst→best. The `severity` weight feeds the lead
 * score: the worse the web presence, the bigger the opportunity for Launch Media.
 */
export const PRESENCE = {
  none: { label: 'No website at all', severity: 1.0 },
  social_only: { label: 'Social page only (no real site)', severity: 0.92 },
  broken: { label: 'Website broken / down / parked', severity: 0.88 },
  weak: { label: 'Has a site, but it’s hurting them', severity: 0.45 }, // floor for unassessable sites
  ok: { label: 'Site is fine — not a fit', severity: 0.05 },
};

/** Turn a problem list into a 0..1 severity weight. */
function severityFromProblems(problems) {
  const w = { 3: 0.34, 2: 0.18, 1: 0.07 };
  const sum = problems.reduce((acc, p) => acc + (w[p.severity] || 0), 0);
  return clamp(sum, 0, 0.85);
}

/**
 * Assemble a final audit object from a presence class + problem list.
 * Shared by the live auditor and the demo provider so both score identically.
 */
export function finalizeAudit(presence, problems, { probe = null, pagespeed = null } = {}) {
  let severity;
  if (presence === 'none') severity = PRESENCE.none.severity;
  else if (presence === 'social_only') severity = PRESENCE.social_only.severity;
  else if (presence === 'broken') severity = PRESENCE.broken.severity;
  else if (presence === 'ok') severity = PRESENCE.ok.severity;
  else {
    // weak: problem-driven, but a site we *couldn't* assess (robots.txt
    // blocked) is still a valid lead, so floor it at the weak baseline
    // instead of the near-zero a single minor problem would produce.
    severity = severityFromProblems(problems);
    if (probe?.robotsBlocked) severity = Math.max(severity, PRESENCE.weak.severity);
  }

  let healthScore;
  if (pagespeed?.performance !== null && pagespeed?.performance !== undefined) {
    healthScore = round(0.6 * pagespeed.performance + 0.4 * (100 * (1 - severity)));
  } else {
    healthScore = round(100 * (1 - severity));
  }

  const headline =
    presence === 'weak'
      ? problems[0]?.label || PRESENCE.weak.label
      : PRESENCE[presence].label;

  return { presence, headline, severity, healthScore, problems, probe, pagespeed };
}

/**
 * Audit a single business's web presence (live).
 * `full` mode adds a PageSpeed Insights pass on reachable sites.
 */
export async function auditBusiness(business, { mode = config.auditMode } = {}) {
  const website = (business.website || '').trim();

  // ── No website listed at all — the cleanest, hottest signal ─────────────
  if (!website) {
    return finalizeAudit('none', [
      {
        code: 'no_website',
        label: 'No website listed',
        severity: 3,
        detail:
          'Google has no website for this business. In a busy market that means every searcher who wants to vet them online comes up empty — and calls a competitor instead.',
      },
    ]);
  }

  const probe = await probeSite(website);
  const problems = [...probe.problems];
  let pagespeed = null;

  // Deep audit only for sites that actually load (saves PSI quota & time).
  const loads =
    probe.reachable && !probe.socialOnly && !probe.parked && (probe.status ?? 500) < 400;
  if (mode === 'full' && loads) {
    pagespeed = await pageSpeed(probe.finalUrl || website, { strategy: 'mobile' });
    if (pagespeed?.problems?.length) {
      for (const p of pagespeed.problems) {
        if (!problems.some((x) => x.code === p.code)) problems.push(p);
      }
    }
  }

  // ── Classify presence ───────────────────────────────────────────────────
  let presence;
  if (probe.socialOnly) presence = 'social_only';
  else if (probe.robotsBlocked) presence = 'weak'; // couldn't assess; still a lead
  else if (!probe.reachable) presence = 'broken';
  else if (probe.parked) presence = 'broken';
  else if ((probe.status ?? 500) >= 400) presence = 'broken';
  else presence = problems.length ? 'weak' : 'ok';

  return finalizeAudit(presence, problems, { probe, pagespeed });
}

/** A business is a lead only if its web presence is actually a problem. */
export const isLead = (audit) => audit.presence !== 'ok';
