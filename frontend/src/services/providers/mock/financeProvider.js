/**
 * Mock finance provider — the offline counterpart to `providers/http/financeProvider.js`.
 *
 * ## This mock is deliberately sparse, and that is the point
 *
 * It replaces `lib/data/finance-admin.js`, which fabricated the entire finance console: a
 * twenty-four month revenue curve from a seeded pseudo-random function, a ledger whose statuses came
 * from rotating `['closed','closed','closed','pending','closed','refunded',…]`, and partner payouts
 * as a flat 65% of that invented figure. Every one of those numbers looked measured.
 *
 * So the rule here is the one `tasks/lessons.md` paid for: **a mock must copy the server's rules,
 * not improve on them.** The server counts exactly three revenue sources — rent convenience fees,
 * subscriptions and boosts — and the mock store has records for only one of them:
 *
 * | Source | Mock store | Reported |
 * |---|---|---|
 * | boosts / featured | `listings[].featured` × `settings.fees.featuredListing` | real |
 * | rent fees | no rent-payment collection exists | ₹0 |
 * | subscriptions | no subscription collection exists; `plans` is a price list, not a book of sales | ₹0 |
 * | services | structurally excluded, exactly as on the server | ₹0 |
 *
 * The two zeros are the honest answer for a store with no such rows, and they are the same answer
 * the live API gives on a fresh install. Inventing a subscription book here would recreate the bug
 * this domain was built to remove — and it would do it in the one place where nobody would look for
 * it, because a mock has no reason to disagree with itself.
 *
 * The practical consequence: the subscriptions panel renders its empty state offline, and the
 * ledger carries one row per featured listing — enough to exercise filtering, paging, search, the
 * CSV export and the detail modal, which is what a mock spec can honestly claim to prove.
 *
 * ## The disclosure flags still come from the settings document
 *
 * Live they are server configuration (`punenest.finance.*`). Offline they are `settings.finance.*`,
 * read with `=== true` so that anything but an explicit true means "not measured". That mirrors the
 * server's default and keeps the toggles in `admin/finance-disclosure.spec.js` meaningful.
 */
import { rawDb } from '../../../lib/mockApi.js';

/** Default when the fee table has no featured price, matching `AdminFinance.jsx`'s old fallback. */
const DEFAULT_FEATURED_FEE = 999;

/** `YYYY-MM-01` for any ISO-ish date string, or null when the row carries no usable date. */
function monthOf(value) {
  const iso = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(0, 7)}-01` : null;
}

/** The current month as `YYYY-MM-01`, on the browser's calendar. */
function thisMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Every featured listing as a settled boost purchase.
 *
 * The one revenue source the mock store can evidence. A listing is marked featured, the fee table
 * says what featuring costs, so the platform took that much — which is the same shape the server
 * reads from `boosts` joined to `boost_packs`.
 */
function featuredPurchases() {
  const db = rawDb();
  const fee = Number(db.settings?.fees?.featuredListing) || DEFAULT_FEATURED_FEE;
  return (db.listings || [])
    .filter((l) => l.featured)
    .map((l) => {
      const month = monthOf(l.createdAt);
      return {
        id: String(l.id),
        /* Never null. The contract declares `date` as a `format: date` string and the server
           always has one — it falls back to the due date for an unsettled row — so a mock that
           emitted null would be producing a shape the live API cannot, which is the one thing
           this file's header forbids. A listing with no usable date falls back to today. */
        date: month ? String(l.createdAt).slice(0, 10) : new Date().toISOString().slice(0, 10),
        month: month || thisMonth(),
        // The owner id where the store has one, so two owners who share a display name are two
        // paying customers — `payingUsers` is a count of people, not of names.
        payer: String(l.ownerId ?? l.owner ?? 'owner'),
        party: l.owner || 'Owner',
        kind: 'featured',
        amount: fee,
        status: 'paid',
        method: undefined,
      };
    });
}

function disclosures() {
  const finance = rawDb().settings?.finance || {};
  return {
    payoutsMeasured: finance.payoutsMeasured === true,
    refundsMeasured: finance.refundsMeasured === true,
    serviceOrdersCounted: finance.serviceOrdersCounted === true,
  };
}

export async function getFinanceOverview() {
  const db = rawDb();
  const purchases = featuredPurchases();
  const featured = purchases.reduce((sum, p) => sum + p.amount, 0);
  const current = thisMonth();
  const thisMonthPurchases = purchases.filter((p) => p.month === current);

  return {
    revenue: featured,
    payoutsDue: 0,
    payoutsCompleted: 0,
    refunds: 0,
    /* All three sources, always — the server's query is a `union all` with `coalesce`, so a source
       that earned nothing is a zero row rather than a missing one, and the console's breakdown must
       not change shape between providers. Sorted by name, as the server sorts it. */
    breakdown: [
      { source: 'boosts', amount: featured },
      { source: 'rent', amount: 0 },
      { source: 'subscriptions', amount: 0 },
    ],
    ...disclosures(),
    // No subscription records offline, so no run rate and no book. See the header.
    mrr: 0,
    plans: [],
    monthRevenue: thisMonthPurchases.reduce((sum, p) => sum + p.amount, 0),
    users: (db.users || []).length,
    payingUsers: new Set(thisMonthPurchases.map((p) => p.payer)).size,
    // GST is stored per rent payment on the server; with no rent rail offline there is none.
    gstCollected: 0,
    pendingSettlement: 0,
  };
}

export async function getFinanceSeries(months = 12) {
  const byMonth = new Map();
  for (const p of featuredPurchases()) {
    if (p.month) byMonth.set(p.month, (byMonth.get(p.month) || 0) + p.amount);
  }

  /* Every bucket in the window, including the empty ones — the server fills them for the same
     reason: a gap in a stacked bar chart is not a visible gap, it is a month that silently never
     happened. */
  const now = new Date();
  const points = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    points.push({
      month: key,
      rent: 0,
      subscriptions: 0,
      featured: byMonth.get(key) || 0,
      services: 0,
    });
  }
  return points;
}

export async function listFinanceTransactions({
  kind, status, q, page = 0, size = 20,
} = {}) {
  let rows = featuredPurchases()
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (status) rows = rows.filter((r) => r.status === status);
  if (q && q.trim()) {
    const needle = q.trim().toLowerCase();
    rows = rows.filter((r) => String(r.party).toLowerCase().includes(needle));
  }

  const total = rows.length;
  const start = page * size;
  return {
    /* `month` is an internal bucketing key, not part of the wire shape — the live provider never
       carries it, so the mock must not either. Listed field by field rather than destructured away,
       because "which fields exist" is exactly what a mock is for. */
    items: rows.slice(start, start + size).map((r) => ({
      id: r.id,
      date: r.date,
      party: r.party,
      kind: r.kind,
      amount: r.amount,
      status: r.status,
      method: r.method,
    })),
    page,
    size,
    total,
    totalPages: size > 0 ? Math.ceil(total / size) : 0,
  };
}


