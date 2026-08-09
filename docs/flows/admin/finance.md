# Flow: Admin Finance

> The platform-economics console: revenue by month, subscription MRR, services and
> featured income, a transaction ledger, GST/payout accounting and platform commission.
> **Status:** documented from React source - **Primary role(s):** admin / manager (with the Finance module)

---

## 1. Purpose & user problem
- **Persona:** a finance / growth lead who owns the platform P&L.
- **Job-to-be-done:** "Show me what PuneNest earned this month, where it came from
  (subscriptions vs services vs featured), what we owe partners, what GST we collected,
  and let me drill into individual transactions."
- **Why it matters:** this is the money view of the marketplace. It rolls up the
  monetisation from every other flow (owner/seeker plans, service tickets, featured
  boosts, rent-pay fees) into revenue, MRR, payouts and net-retained figures. It sits at
  the bottom of the funnel that [`enquiries-funnel.md`](./enquiries-funnel.md) tracks.

## 2. Entry points
- **Routes:** `/admin/finance` (single page, no tabs). The Dashboard "Revenue (this month)"
  glance tile links to `/admin/settings`, but Finance itself is opened from the sidebar
  and cross-linked from the "Deal Pipeline" card to `/admin/enquiries`.
- **Tiles / triggers:** 7 KPI tiles, a Revenue-by-month bar chart with a 6/12/24-month
  window selector, a revenue-mix doughnut, an MRR line, Subscriptions / Net-position /
  Payouts panels, and a filterable transactions table with a per-row detail modal.
- **Source components:**
  - `src/pages/admin/AdminFinance.jsx` - KPIs, charts, panels, transaction table + modal, CSV export.
  - `src/lib/data/finance-admin.js` - `buildTransactions()`, `buildRevenueSeries()`, `rentFeeRevenue()`.
  - Chart primitives `src/components/charts/index.jsx`; money formatting `src/lib/format.js` (`fmtINR`, `fmtNum`).

## 3. Actors & roles
- **Operator = admin / manager** with the `finance` module. The module is gated by the
  `finance` admin flag (`ADMIN_MODULES` in `src/lib/adminModules.js`, `flagKey: 'finance'`);
  when the flag is off the module is hidden from nav and route.
- Sub-panels are further gated by admin option flags read via `useAdminFlags().optionEnabled`:
  `finance.charts`, `finance.models`, `finance.transactions` (all default `true` in the seed;
  `finance.rentPay` exists in the seed but only the derived rent-pay KPI is shown today).
- Guards are UX-only (mock RBAC) - see [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1.

## 4. Entities touched
- [`settings.fees`](../../system/data-model.md) - **read** (fee schedule + `gstPercent`, `rentPayPercent`).
- [`analytics.revenue`](../../system/data-model.md) - **read** (per-month subscriptions/services/featured series).
- [`deals`](../../system/data-model.md), [`tickets`](../../system/data-model.md) (status `done`),
  [`listings`](../../system/data-model.md) (`featured`), `rentFeeLedger`, `users` - **read** to synthesise the transaction ledger and ARPU.
- Nothing is written here - Finance is entirely read/aggregate today (no audit rows, no mutations).

## 5. Business rules & logic  *(the meat)*

### 5.1 Source series
- `series = buildRevenueSeries(24)` returns 24 monthly rows `{ month, subscriptions, services, featured }`.
  - If `db.analytics.revenue` has at least `months` rows it uses the **seed** series (`analytics.json`), taking the last `months`.
  - Otherwise it generates a **deterministic** series keyed on `seed = year*100 + month`:
    - `subscriptions = 120000 + ((seed * 7919) % 80000)`
    - `services      = 40000  + ((seed * 5381) % 60000)`
    - `featured      = 15000  + ((seed * 3137) % 25000)`
  - `month` label = `toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })`.
- `month = series[last]`, `prev = series[last-1] || month`.
- `slicedSeries = series.slice(-range)` where `range` in {6, 12, 24} drives the bar chart / MRR line.

### 5.2 Headline aggregates
- `monthTotal = month.subscriptions + month.services + month.featured`.
- `prevTotal  = prev.subscriptions + prev.services + prev.featured`.
- `ytd = sum over the last 12 rows of (subscriptions + services + featured)` (the "Revenue (12 mo)" KPI).
- `pct(cur, prev)` MoM delta = `round((cur - prev) / prev * 1000) / 10`, rendered as `+/-N%`;
  returns `null` (no delta shown) when `prev` is falsy.

### 5.3 Fee schedule inputs (`settings.fees`)
Seed values (`src/data/settings.json`): `ownerPlanYearly: 999`, `ownerProYearly: 2499`,
`rentAgreementPlatform: 500`, `seekerPlusTopup: 199`, `featuredListing: 999`,
`gstPercent: 18`, `rentPayPercent: 2`.
- `gstRate = (fees.gstPercent || 18) / 100`.
- `ownerPlan = fees.ownerPlanMonthly || round(fees.ownerPlanYearly / 12 || 500)`
  (with the seed, `ownerPlanMonthly` is absent so `ownerPlan = round(999/12) = 83`).
- `seekerPlan = fees.seekerPlanMonthly || 299` (seed has no monthly, so `299`).

### 5.4 Subscription split (modelled, not stored)
The subscription line is split into owner vs seeker by a **fixed 55/45 heuristic**:
- `ownerShare = round(month.subscriptions * 0.55)`.
- `ownerSubs  = max(0, round(ownerShare / max(1, ownerPlan)))`.
- `seekerSubs = max(0, round((month.subscriptions - ownerShare) / max(1, seekerPlan)))`.
- The Subscriptions panel renders each row as `count active . fmtINR(price)/mo` and `count * price`,
  and shows `MRR total = month.subscriptions`.

### 5.5 Payouts, commission, GST, net position
- `partnerPayout = round(month.services * 0.65)` (partners keep 65% of services revenue).
- `commission    = month.services - partnerPayout` (platform keeps the remaining 35%).
- `netRetained   = monthTotal - partnerPayout`.
- `gstAmount     = round(monthTotal * gstRate)`.
- **Net position panel:** Gross revenue = `monthTotal`; GST collected (`gstPercent`%) = `gstAmount`;
  Partner payouts = `partnerPayout` (shown negative); Net retained = `netRetained` (total row).
- **Payouts & outstanding panel:** Partner payouts (65%) = `partnerPayout`;
  Platform commission (35%) = `commission`; Outstanding (pending) = `pending`; Refunds (recent) = `refunds`.

### 5.6 ARPU and rent-pay fees
- `users = db.users.length`; `arpu = round(monthTotal / max(1, users))` (the ARPU KPI).
- `rentFee = rentFeeRevenue(db) = sum over db.rentFeeLedger of Number(entry.platform || 0)`.
  `rentFeeLedger` is not in the base seed, so today `rentFee = 0` until rent-pay entries exist.

### 5.7 KPI tiles (7)
| KPI | Value | MoM delta |
|-----|-------|-----------|
| MRR (subscriptions) | `month.subscriptions` | `pct(subs, prev.subs)` |
| Revenue this month | `monthTotal` | `pct(monthTotal, prevTotal)` |
| Services revenue | `month.services` | `pct(services, prev.services)` |
| Featured revenue | `month.featured` | `pct(featured, prev.featured)` |
| Revenue (12 mo) | `ytd` | none |
| Rent-pay fees | `rentFee` | none |
| ARPU | `arpu` | none |

### 5.8 Transaction ledger (`buildTransactions`)
A synthetic ledger built from existing collections, newest-first (sorted by `date` desc):
- **Deals** (first 8): `party = listing || customer`, `type = 'Rent agreement'` when
  `deal === 'rent'` else `'Sale facilitation'`; `amount = fees.rentAgreementPlatform || 999`
  for rent, else `round(deal.value * 0.005)` (0.5% sale-facilitation fee). IDs `TX4000+`.
- **Tickets** with `status === 'done'` (first 8): `type = ticket.service`, `amount = ticket.value || 0`. IDs `TX5000+`.
- **Featured listings** (first 6): `type = 'Featured listing'`, `amount = fees.featuredListing || 5000`
  (seed makes this `999`). IDs `TX6000+`.
- **Rent-fee ledger** (first 20): `type = 'Rent payment (fee)'`, `amount = Number(entry.platform)`,
  status forced `closed`. IDs `RP7000+`.
- **Status/method decoration** (deals/tickets/featured only): cycled from
  `STAT = [closed, closed, closed, pending, closed, refunded, closed, closed, failed, closed]`
  and `METHODS = [UPI, Card, Net banking, UPI, Wallet, Card]` by index. When status is
  `refunded` the amount is flipped negative (`-abs(amount)`).
- **Derived outstanding/refunds:** iterate the ledger - `refunds += abs(amount)` for `refunded`,
  `pending += abs(amount)` for `pending`.

### 5.9 Table filtering & export
- `txRows` applies: type filter (`r.type === txType`), status filter (`r.status === txStatus`),
  and free-text search over `(id + party + type).toLowerCase()`.
- `txTypes` = distinct sorted `type` values for the filter dropdown.
- Revenue CSV = the full 24-month `series`; Transactions CSV = the current `txRows`.

### 5.10 What MUST move server-side
- The 55/45 owner/seeker subscription split, the 65/35 partner/commission split, the 0.5%
  sale-facilitation rate and the deterministic revenue fallback are **client-side heuristics**
  that must be replaced by real ledger/subscription accounting on the server.
- The transaction ledger is **fabricated** from unrelated collections (deals/tickets/featured/rent-fee)
  with cycled status/method - it is not a real payments table. A backend must own an
  immutable transactions table with real gateway status, method, GST and refund records.
- GST, payouts and net-retained are computed in the browser from `monthTotal` and must be
  authoritative server figures.

## 6. Maker-checker / approval
- **Applicable: no.** Finance is a read-only reporting surface today - no proposal/approval
  states, no mutations, no audit writes. Refunds/payouts are only *displayed*, not initiated
  here. A real backend would introduce maker-checker on payouts and refunds (see
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2).

## 7. State machine
- No entity lifecycle is owned by this page. The only "states" are transaction **status**
  values surfaced from the synthetic ledger: `closed`, `pending`, `refunded`, `failed`
  (plus rent-fee rows pinned to `closed`). These are display categories, not transitions the
  page can drive.

## 8. Edge cases, validation & error states
- **Loading:** `<Loading />` until `getSettings()` resolves.
- **Flag-gated sections:** charts / models / transactions blocks render only when their
  `finance.*` option flag is on; the whole module is hidden when the `finance` admin flag is off.
- **Divide-by-zero guards:** `arpu` uses `max(1, users)`; `ownerSubs`/`seekerSubs` use `max(1, price)`;
  `pct()` returns `null` when `prev` is 0/undefined.
- **Empty ledger:** table shows "No transactions match." when filters exclude everything.
- **Refund sign:** refunded rows carry a negative `amount` and render red; `abs()` is used for the
  refunds/pending rollups so totals stay positive.
- **Missing fees:** every fee read has a fallback default, so a partial `settings.fees` still renders.
- **Concurrency:** shared in-memory store; values recompute on mount only (`useMemo` with static deps).
