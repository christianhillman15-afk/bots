import { config } from '../config.js';
import { reserveLookup } from './twilioUsage.js';

/*
 * Twilio Lookup — line-type intelligence (key-gated).
 *
 * Tells us whether a phone number is a mobile, landline, or VoIP line so cold
 * SMS only goes to textable mobiles. Texting landlines wastes sends and is a
 * known cause of carrier filtering/suspension — so this directly protects the
 * SMS campaign's deliverability.
 *
 * No-op (returns null) until TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are set.
 * Never throws into a run.
 *
 * Cost note: the line_type_intelligence field is a paid add-on (~$0.008 each);
 * basic validation is free. So we only look up numbers once and cache the
 * result on the lead.
 */

const BASE = 'https://lookups.twilio.com/v2/PhoneNumbers/';

export const twilioReady = () => Boolean(config.twilioAccountSid && config.twilioAuthToken);

/** Normalize a US phone to E.164 (+1XXXXXXXXXX), or '' if not 10/11 digits. */
export function toE164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '';
}

/**
 * Look up one number. Returns { valid, lineType, carrier, mobile } or null.
 * lineType is 'mobile' | 'landline' | 'voip' | 'unknown'. `mobile` is true only
 * when Twilio positively says it's a mobile line (safe to text).
 */
export async function lookupPhone(phone) {
  if (!twilioReady()) return null;
  const e164 = toE164(phone);
  if (!e164) return { valid: false, lineType: 'unknown', carrier: '', mobile: false };
  // HARD SPEND GUARD: reserve a slot under today's cap BEFORE any billable call.
  // If the daily cap is reached, refuse — no Twilio request, no charge. Nothing
  // can bypass this because every lookup goes through here.
  if (!reserveLookup()) return { capped: true };
  try {
    const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
    const res = await fetch(`${BASE}${encodeURIComponent(e164)}?Fields=line_type_intelligence`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const lti = data.line_type_intelligence || {};
    const type = (lti.type || 'unknown').toLowerCase();
    // Twilio types: mobile, landline, voip, fixedVoip, nonFixedVoip, tollFree...
    const lineType = type.includes('mobile') ? 'mobile'
      : type.includes('landline') ? 'landline'
      : type.includes('voip') ? 'voip'
      : type === 'unknown' || !type ? 'unknown' : type;
    return {
      valid: Boolean(data.valid),
      lineType,
      carrier: lti.carrier_name || '',
      mobile: lineType === 'mobile',
    };
  } catch {
    return null;
  }
}
