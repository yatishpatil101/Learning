/* Finance helpers — generates mock transaction ledger from existing DB collections. */
import { rawDb } from '../mockApi.js';

export function buildTransactions() {
  const db = rawDb();
  const fees = db.settings?.fees || {};
  const STAT = ['closed', 'closed', 'closed', 'pending', 'closed', 'refunded', 'closed', 'closed', 'failed', 'closed'];
  const METHODS = ['UPI', 'Card', 'Net banking', 'UPI', 'Wallet', 'Card'];
  let idx = 0;
  const tx = [];
  const push = (o) => {
    o.status = STAT[idx % STAT.length];
    o.method = METHODS[idx % METHODS.length];
    if (o.status === 'refunded') o.amount = -Math.abs(o.amount);
    tx.push(o);
    idx++;
  };
  (db.deals || []).slice(0, 8).forEach((d, i) =>
    push({ id: `TX${4000 + i}`, date: d.at, party: d.listing || d.customer, type: d.deal === 'rent' ? 'Rent agreement' : 'Sale facilitation', amount: d.deal === 'rent' ? (fees.rentAgreementPlatform || 999) : Math.round((d.value || 0) * 0.005) }),
  );
  (db.tickets || []).filter((t) => t.status === 'done').slice(0, 8).forEach((t, i) =>
    push({ id: `TX${5000 + i}`, date: t.createdAt, party: t.customer, type: t.service, amount: t.value || 0 }),
  );
  (db.listings || []).filter((l) => l.featured).slice(0, 6).forEach((l, i) =>
    push({ id: `TX${6000 + i}`, date: l.createdAt, party: l.owner || 'Owner', type: 'Featured listing', amount: fees.featuredListing || 5000 }),
  );
  (db.rentFeeLedger || []).slice(0, 20).forEach((e, i) =>
    tx.push({ id: `RP${7000 + i}`, date: e.at, party: e.party || 'Tenant', type: 'Rent payment (fee)', amount: Number(e.platform) || 0, method: e.method || 'UPI', status: 'closed' }),
  );
  return tx.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function buildRevenueSeries(months = 24) {
  const db = rawDb();
  // Use analytics revenue if available, else generate deterministic series
  if (db.analytics?.revenue?.length >= months) return db.analytics.revenue.slice(-months);
  const now = new Date();
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const mo = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    const seed = d.getFullYear() * 100 + d.getMonth();
    const subs = 120000 + ((seed * 7919) % 80000);
    const services = 40000 + ((seed * 5381) % 60000);
    const featured = 15000 + ((seed * 3137) % 25000);
    return { month: mo, subscriptions: subs, services, featured };
  });
}

export function rentFeeRevenue(db) {
  return (db?.rentFeeLedger || []).reduce((s, e) => s + (Number(e.platform) || 0), 0);
}
