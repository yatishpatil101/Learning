/* Tenant-side "My Rental" data layer.

   A tenant's rented home lives in `pnTenancies:<mobile>` (written cross-actor when
   an owner accepts a finalize request). This module reads that single source of
   truth and derives the rent status the My Rental hub shows, and provides a
   one-click demo seeder so every tenant feature is testable without needing a
   full finalize handshake between two accounts. */

import { digits, myMobile } from '../contact.js';
import {
  getTenancies, addTenancy, savePayoutAccount, addRentPayment, getRentPayments,
  addRentAgreement, saveTenantProfile, setRentMandate,
} from '../store.js';
import { thisMonth } from '../rentPay.js';

const DEMO_PROP_ID = 'PN-RENT-DEMO';

/* A `YYYY-MM` string N months before the current month. */
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

/* The current user's finalised rentals, normalised for the hub (defaults filled
   so a lean tenancy record still renders a complete card). */
export function loadTenancies(user) {
  const mine = digits(user?.mobile).slice(-10);
  return getTenancies()
    .filter((t) => {
      // Tenancies are stored under the tenant's own key, so they're already
      // scoped; the guard just drops any stray record with a mismatched mobile.
      const who = digits(t.tenantMobile || user?.mobile).slice(-10);
      return !who || !mine || who === mine;
    })
    .map((t) => ({
      id: t.id,
      propId: t.propId || '',
      title: t.title || 'Rented home',
      address: t.address || t.locality || 'Pune',
      locality: t.locality || '',
      bhk: t.bhk || '',
      image: t.image || t.img || 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=80',
      ownerName: t.ownerName || 'Your landlord',
      ownerMobile: digits(t.ownerMobile || ''),
      rent: Number(t.rent) || 0,
      deposit: Number(t.deposit) || 0,
      dueDay: Number(t.dueDay) || 5,
      leaseStart: t.leaseStart || '',
      leaseEnd: t.leaseEnd || '',
      status: t.status || 'active',
      demo: !!t.demo,
    }));
}

/* Rent status for a tenancy: whether THIS month is already paid, and the next due
   date. Read from the tenant's own rent-payment history (matched by property). */
export function tenancyStatus(t) {
  const month = thisMonth();
  const paidThisMonth = getRentPayments().some(
    (p) => p.month === month
      && (!t.propId || p.propId === t.propId || !p.propId),
  );
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth() + (paidThisMonth ? 1 : 0), t.dueDay || 5);
  return {
    month,
    paidThisMonth,
    nextDue: due,
    nextDueLabel: due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
  };
}

/* True when the current user already has the seeded demo rental. */
export function hasDemoTenancy() {
  return getTenancies().some((t) => t.propId === DEMO_PROP_ID);
}

/* One-click prototype seed: a fully-featured tenancy plus the surrounding records
   (owner payout, a couple of past payments + HRA receipts, a registered rent
   agreement, and a partial Verified-Tenant profile) so the hub's every feature is
   populated and testable. Idempotent — re-running is a no-op. */
export function seedDemoTenancy(user) {
  const mine = digits(user?.mobile);
  if (!mine) return false;
  if (hasDemoTenancy()) return false;

  const OWNER_MOBILE = '9820011234';
  const OWNER_NAME = 'Rahul Deshmukh';
  const RENT = 28000;
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  const lease = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-01';
  const end = new Date(start);
  end.setMonth(end.getMonth() + 11);

  addTenancy(mine, {
    tenantMobile: mine,
    ownerMobile: OWNER_MOBILE,
    ownerName: OWNER_NAME,
    propId: DEMO_PROP_ID,
    title: '2 BHK in Rohan Leher, Baner',
    address: 'B-1204, Rohan Leher, Baner, Pune 411045',
    locality: 'Baner',
    bhk: '2 BHK',
    image: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=80',
    rent: RENT,
    deposit: RENT * 3,
    dueDay: 5,
    leaseStart: lease(start),
    leaseEnd: lease(end),
    deal: 'rent',
    demo: true,
  });

  // Owner payout account so a real Pay-rent settles to the landlord.
  savePayoutAccount({ name: OWNER_NAME, vpa: 'rahul@okhdfcbank' }, OWNER_MOBILE);

  // Two past months already paid → history + HRA receipts to download.
  [2, 1].forEach((n) => {
    addRentPayment({
      type: 'rent', to: OWNER_NAME, tenant: user?.name || 'Tenant', ownerMobile: OWNER_MOBILE,
      propId: DEMO_PROP_ID, address: 'B-1204, Rohan Leher, Baner, Pune 411045',
      month: monthsAgo(n), amount: RENT, method: 'UPI', pan: 'ABCDE1234F',
    });
  });

  // A registered rent agreement on record.
  addRentAgreement({
    id: 'ra-demo-' + Date.now(), propId: DEMO_PROP_ID, landlord: OWNER_NAME,
    tenant: user?.name || 'Tenant', rent: RENT, deposit: RENT * 3,
    status: 'registered', startDate: lease(start), endDate: lease(end), at: Date.now(),
  });

  // A partial Verified-Tenant profile so the score card is non-trivial.
  saveTenantProfile({ idVerified: true, employment: 'Salaried', income: '8–12 LPA' });

  // Autopay left OFF so the "set up autopay" affordance is testable.
  setRentMandate(null);

  return true;
}

/* Remove the demo tenancy (and its autopay mandate) — lets the empty state be
   re-tested. Leaves payment history/receipts, which are harmless and realistic. */
export function clearDemoTenancy(user) {
  const mine = digits(user?.mobile) || myMobile();
  const key = 'pnTenancies:' + (mine || 'anon');
  try {
    const arr = JSON.parse(localStorage.getItem(key) || '[]').filter((t) => t.propId !== DEMO_PROP_ID);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch { /* ignore */ }
  setRentMandate(null);
}
