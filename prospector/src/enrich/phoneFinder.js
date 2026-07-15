import { config } from '../config.js';
import { mapLimit } from '../util.js';
import { lookupPhone, twilioReady } from './twilio.js';
import { twilioUsage } from './twilioUsage.js';

/*
 * Line-type the leads' phone numbers via Twilio Lookup so cold SMS only goes to
 * textable mobiles. Result is cached on the lead (business.lineType +
 * lineTypeChecked) so every number is billed at most once, and the Daily Phones
 * export can filter out landlines automatically.
 */

/** A lead worth looking up: has a phone, not line-typed yet. */
function needsLineType(l) {
  return Boolean(l.business?.phone) && !l.business?.lineTypeChecked;
}

export { needsLineType, twilioReady };

export async function verifyPhones({ store, limit = 0, onProgress = () => {} }) {
  if (!twilioReady()) return { processed: 0, mobile: 0, landline: 0, other: 0, remaining: 0, noKey: true };
  const targets = store.all().filter(needsLineType);
  // Never attempt more than today's remaining Twilio budget allows — a second,
  // batch-level guard on top of the per-lookup reserve, so we don't even spin up
  // work we can't pay for.
  const budget = twilioUsage().remaining;
  const want = limit > 0 ? Math.min(limit, targets.length) : targets.length;
  const slice = targets.slice(0, Math.min(want, budget));
  let mobile = 0, landline = 0, other = 0, billed = 0, capped = 0, done = 0;
  await mapLimit(slice, Math.min(10, config.auditConcurrency), async (lead) => {
    const r = await lookupPhone(lead.business.phone);
    if (r?.capped) {
      capped++; // daily cap hit mid-run — no charge, leave unchecked to retry later
    } else if (r) {
      lead.business.lineType = r.lineType;
      lead.business.carrier = r.carrier;
      lead.business.lineTypeChecked = true;
      billed++;
      if (r.lineType === 'mobile') mobile++;
      else if (r.lineType === 'landline') landline++;
      else other++;
    }
    // if r is null (transient error), leave unchecked so a later run retries
    done++;
    onProgress({ done, total: slice.length, mobile, landline, other });
  });
  if (slice.length) store.save();
  const u = twilioUsage();
  return {
    processed: billed,
    mobile, landline, other,
    remaining: Math.max(0, targets.length - billed),
    capHit: capped > 0 || budget <= want && budget < targets.length,
    dailyUsed: u.used, dailyCap: u.cap, dailyRemaining: u.remaining,
  };
}
