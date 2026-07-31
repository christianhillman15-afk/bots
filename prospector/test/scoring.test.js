import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead } from '../src/scoring/leadScore.js';
import { finalizeAudit } from '../src/audit/audit.js';
import { qualify, hasUsablePhone, hasUsableEmail } from '../src/scoring/qualify.js';

const biz = (over = {}) => ({
  name: 'Test Co',
  categoryLabel: 'Plumbing',
  avgTicketUsd: 600,
  affordability: 0.85,
  metroPopulation: 2960000,
  reviewCount: 120,
  rating: 4.6,
  businessStatus: 'OPERATIONAL',
  phone: '612-443-9490',
  ...over,
});
const noSite = () => finalizeAudit('none', [{ code: 'no_website', label: 'No website listed', severity: 3 }]);
const weakMinor = () => finalizeAudit('weak', [{ code: 'old_copyright', label: 'Old copyright year', severity: 1 }]);
const weakHigh = () => finalizeAudit('weak', [{ code: 'no_https', label: 'No HTTPS', severity: 3 }]);

test('hasUsablePhone requires 10+ digits', () => {
  assert.equal(hasUsablePhone('612-443-9490'), true);
  assert.equal(hasUsablePhone('123'), false);
  assert.equal(hasUsablePhone(''), false);
  assert.equal(hasUsablePhone(null), false);
});

test('hasUsableEmail rejects risky/empty', () => {
  assert.equal(hasUsableEmail({ email: 'a@b.com' }), true);
  assert.equal(hasUsableEmail({ email: 'a@b.com', emailStatus: 'risky' }), false);
  assert.equal(hasUsableEmail({ email: '' }), false);
  assert.equal(hasUsableEmail({}), false);
});

test('a strong, contactable no-website lead is HOT', () => {
  const s = scoreLead(biz(), noSite());
  assert.equal(s.tier, 'hot');
  assert.ok(s.value >= 75);
  assert.equal(s.qualificationStatus, 'high_priority');
});

test('an uncontactable lead is CAPPED below hot/warm', () => {
  const s = scoreLead(biz({ phone: '', email: '' }), noSite());
  assert.ok(s.value <= 45, `expected <=45, got ${s.value}`);
  assert.notEqual(s.tier, 'hot');
  assert.ok(s.scorePenalties.some((p) => /phone or email/i.test(p)));
});

test('a weak site with only a MINOR issue cannot be hot', () => {
  const s = scoreLead(biz(), weakMinor());
  assert.equal(s.qualificationStatus, 'low_priority');
  assert.ok(s.value <= 50, `expected <=50, got ${s.value}`);
  assert.notEqual(s.tier, 'hot');
});

test('a weak site with a HIGH-severity issue qualifies', () => {
  const s = scoreLead(biz(), weakHigh());
  assert.equal(s.qualificationStatus, 'qualified');
  assert.ok(s.highIssueCount >= 1);
});

test('a permanently closed business is heavily penalized', () => {
  const s = scoreLead(biz({ businessStatus: 'CLOSED_PERMANENTLY' }), noSite());
  assert.ok(s.value <= 15, `expected <=15, got ${s.value}`);
  assert.ok(s.scorePenalties.some((p) => /status/i.test(p)));
});

test('opportunity is a range with a confidence label, never a fake exact loss', () => {
  const s = scoreLead(biz(), noSite());
  assert.ok(s.estimatedOpportunityLow <= s.opportunityUsd);
  assert.ok(s.estimatedOpportunityHigh >= s.opportunityUsd);
  assert.ok(['very_low', 'low', 'medium', 'high'].includes(s.opportunityConfidence));
});

test('qualify buckets issues by severity', () => {
  const q = qualify(biz(), finalizeAudit('weak', [
    { severity: 3 }, { severity: 2 }, { severity: 2 }, { severity: 1 },
  ]));
  assert.equal(q.highIssueCount, 1);
  assert.equal(q.mediumIssueCount, 2);
  assert.equal(q.lowIssueCount, 1);
  assert.equal(q.status, 'qualified'); // one high OR two mediums clears the bar
});
