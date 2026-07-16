import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

/*
 * Customers — when a prospect says "yes" on a call, the rep turns that lead into
 * a Customer here: business + contact info are copied over and saved, plus the
 * deal (plan + monthly price) and a payment status.
 *
 * SECURITY: this store NEVER holds raw card data. Payment is collected through
 * Stripe (the card is entered on Stripe's secure page), and we keep only the
 * non-sensitive Stripe identifiers + a status. There is intentionally no field
 * for a card number, CVV, or expiry — storing those would be a PCI violation.
 */

function newId() {
  // No Math.random/Date.now restrictions here (runs on the server), but keep it
  // simple and collision-safe enough for a single-tenant tool.
  return 'cust-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
}

export class CustomerStore {
  constructor(file) {
    this.file = file || resolve(config.dataDir, 'customers.json');
    this.customers = [];
    this._load();
  }

  _load() {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'));
        this.customers = Array.isArray(raw.customers) ? raw.customers : [];
      }
    } catch (err) {
      log.warn(`customers load failed: ${err.message}`);
      this.customers = [];
    }
  }

  save() {
    if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(this.file, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), customers: this.customers }));
  }

  all() {
    return this.customers.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  get(id) {
    return this.customers.find((c) => c.id === id) || null;
  }

  /** Create a customer from a lead + deal details. Strips any stray card fields. */
  create(input = {}) {
    const now = new Date().toISOString();
    const c = {
      id: newId(),
      leadId: input.leadId || null,
      businessName: (input.businessName || '').trim(),
      ownerName: (input.ownerName || '').trim(),
      phone: (input.phone || '').trim(),
      email: (input.email || '').trim(),
      website: (input.website || '').trim(),
      address: (input.address || '').trim(),
      city: (input.city || '').trim(),
      state: (input.state || '').trim(),
      plan: (input.plan || '').trim(),
      monthlyPrice: Number(input.monthlyPrice) || 0,
      status: 'pending', // pending | active | canceled
      // Payment is Stripe-only. Never store a PAN/CVV/expiry here.
      paymentStatus: 'not_collected', // not_collected | link_sent | paid | active_subscription
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      notes: (input.notes || '').trim(),
      createdAt: now,
      updatedAt: now,
      activity: [{ at: now, text: 'Customer created from lead' }],
    };
    if (!c.businessName) throw new Error('Business name is required to create a customer.');
    this.customers.push(c);
    this.save();
    return c;
  }

  update(id, patch = {}) {
    const c = this.get(id);
    if (!c) return null;
    // Whitelist updatable fields — and hard-block any attempt to persist card data.
    const allowed = ['ownerName', 'phone', 'email', 'website', 'address', 'city', 'state', 'plan', 'monthlyPrice', 'status', 'paymentStatus', 'stripeCustomerId', 'stripeSubscriptionId', 'notes'];
    for (const k of allowed) {
      if (patch[k] !== undefined) c[k] = k === 'monthlyPrice' ? Number(patch[k]) || 0 : patch[k];
    }
    if (typeof patch.activityNote === 'string' && patch.activityNote.trim()) {
      c.activity.push({ at: new Date().toISOString(), text: patch.activityNote.trim() });
    }
    c.updatedAt = new Date().toISOString();
    this.save();
    return c;
  }

  remove(id) {
    const i = this.customers.findIndex((c) => c.id === id);
    if (i === -1) return false;
    this.customers.splice(i, 1);
    this.save();
    return true;
  }
}
