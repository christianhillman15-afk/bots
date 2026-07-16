/*
 * Lead qualification — turns an audit into a clear, defensible verdict so the
 * top of the call list is genuinely the businesses worth calling first, not a
 * business flagged "hot" over one tiny website nit.
 *
 * We separate issues by severity and require a real problem (or a broken/absent
 * site) before a lead is treated as high priority. A weak site with only a
 * cosmetic issue stays in the database but ranked low.
 */

/** Is this phone string actually dialable (>= 10 US digits)? */
export function hasUsablePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10;
}

/** Is there a usable, non-risky email? */
export function hasUsableEmail(business) {
  const email = (business.email || '').trim();
  if (!email || !email.includes('@')) return false;
  return business.emailStatus !== 'risky' && business.emailStatus !== 'undeliverable';
}

/**
 * Bucket audit problems into critical/high/medium/low counts, then derive a
 * qualification status + the specific reasons it qualified. Presence class
 * carries the "critical" signal (no site / broken / social-only); the graded
 * problem list (severity 3/2/1) carries high/medium/low.
 */
export function qualify(business, audit) {
  const problems = audit.problems || [];
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  const reasons = [];

  // Presence-level critical signals (the strongest, most truthful pitch).
  if (audit.presence === 'none') { critical += 1; reasons.push('No website found in public data'); }
  else if (audit.presence === 'social_only') { critical += 1; reasons.push('Only a social page — no owned website'); }
  else if (audit.presence === 'broken') { critical += 1; reasons.push('Website is down, parked, or broken'); }

  // Graded problems from the audit (severity 3 = high, 2 = medium, 1 = low).
  for (const p of problems) {
    if (p.severity >= 3) { high += 1; }
    else if (p.severity === 2) { medium += 1; }
    else { low += 1; }
  }
  if (high) reasons.push(`${high} high-severity website issue${high > 1 ? 's' : ''}`);
  if (medium) reasons.push(`${medium} medium-severity issue${medium > 1 ? 's' : ''}`);

  // Verdict. Auto-qualify absent/broken/social sites. A merely "weak" site must
  // clear a real bar (one high OR two mediums) to be qualified — one small nit
  // is explicitly NOT enough for the top of the list.
  let status;
  if (critical > 0) status = 'high_priority';
  else if (high >= 1 || medium >= 2) status = 'qualified';
  else if (medium === 1 || low > 0) status = 'low_priority';
  else status = 'needs_review'; // weak but no assessable issue (e.g. robots-blocked)

  // Contactability is a gate, not a bonus: a lead nobody can reach isn't a lead.
  const contactable = hasUsablePhone(business.phone) || hasUsableEmail(business);
  if (!contactable) reasons.push('No usable phone or email yet — verify before calling');

  return {
    status,
    reasons,
    contactable,
    criticalIssueCount: critical,
    highIssueCount: high,
    mediumIssueCount: medium,
    lowIssueCount: low,
  };
}
