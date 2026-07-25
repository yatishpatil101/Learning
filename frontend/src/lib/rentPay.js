/* Shared rent-payment engine (prototype). ESM port of pn-rent-pay.js.
   One code path so a rent payment always: (1) records the tenant's payment history,
   (2) credits the owner's rent ledger, (3) records platform convenience-fee revenue,
   (4) optionally sets an autopay mandate, (5) generates an instant HRA receipt. */

import { digits, myMobile, calcRentFee, addRentPayment, addRentLedger, addPlatformRentFee, setRentMandate } from './store.js';
import { readUser } from './auth.js';
import { generateSingle } from './rentReceipt.js';

export function thisMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

export function pay(o) {
  o = o || {};
  const amount = Math.round(Number(o.amount) || 0);
  if (!amount) return { ok: false, error: 'amount' };
  const ownerMobile = digits(o.ownerMobile || '');
  if (!ownerMobile) return { ok: false, error: 'owner' };

  const b = calcRentFee(amount);
  const u = readUser() || {};
  const tenant = o.tenant || u.name || 'Tenant';
  const month = o.month || thisMonth();
  const method = o.method || 'UPI';
  const landlord = o.landlord || 'Landlord';
  const address = o.address || '';

  const rec = addRentPayment({
    type: 'rent', to: landlord, tenant, ownerMobile, propId: o.propId || '', address, month,
    amount, method, pct: b.pct, fee: b.fee, gst: b.gst, platform: b.platform, total: b.total, pan: o.pan || '',
  });
  addRentLedger(ownerMobile, {
    from: tenant, fromMobile: myMobile(), landlord, address, propId: o.propId || '',
    month, amount, method, settlement: 'settled', paymentId: rec.id,
  });
  addPlatformRentFee({ party: tenant, ownerMobile, amount, fee: b.fee, gst: b.gst, platform: b.platform, method, paymentId: rec.id });
  if (o.autopay || method === 'UPI Autopay') {
    setRentMandate({ ownerMobile, landlord, amount, dayOfMonth: 5, method, propId: o.propId || '' });
  }
  let receipt = null;
  if (o.receipt !== false) {
    try {
      receipt = generateSingle({ tenant, landlord, address, rent: amount, pan: o.pan || '', mode: method, month, txnRef: rec.id, paidOnline: true });
    } catch {
      receipt = null;
    }
  }
  return { ok: true, rec, breakdown: b, receipt, month };
}
