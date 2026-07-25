/* Rent reminders & receipts — the owner retention hook.

   For a rented managed property the owner sets a monthly rent + due day and a
   tenant name. This module tracks which months have been received and generates
   an instant HRA rent receipt on "Mark received" (reusing the existing receipt
   generator). It is intentionally offline-first: no payment rails, no fees — the
   owner is simply recording rent they collected however they collected it.

   Stored per-user, keyed by property id. Prototype only (localStorage). */

import { readUser } from '../auth.js';
import { generateSingle } from '../rentReceipt.js';

const key = () => 'puneNestRentLog:' + ((readUser() || {}).mobile || 'anon');

const get = (k, def) => {
  try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch { return def; }
};
const set = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ }
  return v;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ymKey(d = new Date()) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}
export function ymLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS[(Number(m) || 1) - 1]} ${y}`;
}

/** All received-rent records for a property: { 'YYYY-MM': {paidAt, amount, receiptId} } */
export function getRentLog(propId) {
  return get(key(), {})[propId] || {};
}

export function isMonthPaid(propId, ym) {
  return !!getRentLog(propId)[ym];
}

/**
 * Status of a property's CURRENT month rent.
 * @returns {{ym:string, label:string, paid:boolean, overdue:boolean, dueDate:Date, dueDay:number}}
 */
export function currentDueStatus(prop) {
  const now = new Date();
  const ym = ymKey(now);
  const dueDay = Math.min(28, Math.max(1, Number(prop.dueDay) || 5));
  const dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
  const paid = isMonthPaid(prop.id, ym);
  const overdue = !paid && now.getDate() > dueDay;
  return { ym, label: ymLabel(ym), paid, overdue, dueDate, dueDay };
}

/** Last `n` months (most recent first) with paid/amount info for a mini ledger. */
export function recentMonths(prop, n = 6) {
  const log = getRentLog(prop.id);
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const ym = ymKey(new Date(d.getFullYear(), d.getMonth() - i, 1));
    const rec = log[ym] || null;
    out.push({ ym, label: ymLabel(ym), paid: !!rec, amount: rec ? rec.amount : (Number(prop.monthlyRent) || 0) });
  }
  return out;
}

/**
 * Record rent received for a month (offline — no payment rails).
 * @returns {{ok:boolean, ym:string}}
 */
export function markRentReceived(prop, ym = ymKey()) {
  const amount = Number(prop.monthlyRent) || 0;
  if (!amount) return { ok: false, ym };

  const all = get(key(), {});
  if (!all[prop.id]) all[prop.id] = {};
  all[prop.id][ym] = { paidAt: Date.now(), amount };
  set(key(), all);

  try {
    const notifs = JSON.parse(localStorage.getItem('puneNestNotifications') || '[]');
    notifs.unshift({ id: 'n' + Date.now(), type: 'rent', title: 'Rent recorded', desc: `${ymLabel(ym)} rent for ${prop.title || 'your property'} marked received.`, time: 'Just now', link: '/dashboard#owner-hub', unread: true });
    localStorage.setItem('puneNestNotifications', JSON.stringify(notifs));
  } catch { /* quota */ }

  return { ok: true, ym };
}

export function undoRentReceived(propId, ym) {
  const all = get(key(), {});
  if (all[propId]) { delete all[propId][ym]; set(key(), all); }
}

/** Generate + download an HRA rent receipt PDF for a given month. */
export function downloadReceipt(prop, ym = ymKey()) {
  const u = readUser() || {};
  return generateSingle({
    tenant: prop.tenantName || 'Tenant',
    landlord: u.name || 'Owner',
    address: prop.loc || prop.locality || '',
    rent: Number(prop.monthlyRent) || 0,
    mode: 'Cash / Bank',
    month: ym,
    txnRef: 'RCPT' + Date.now(),
    paidOnline: false,
  });
}
