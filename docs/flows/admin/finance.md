# Flow: Admin Finance

> The platform-economics console: revenue by month, subscription MRR, services and
> featured income, a transaction ledger, GST accounting and the plan book.
> **Status:** documented from React source - **Primary role(s):** admin (with the Finance module)

---

## 1. Purpose & user problem
- **Persona:** a finance / growth lead who owns the platform P&L.
- **Job-to-be-done:** "Show me what PuneNest earned this month, where it came from
  (subscriptions vs services vs featured), what GST we collected,
  and let me drill into individual transactions."
- **Why it matters:** this is the money view of the marketplace. It rolls up the
  monetisation from every other flow (owner/seeker plans, service tickets, featured
  boosts) into revenue, MRR and net-retained figures. It sits at
  the bottom of the funnel that [`enquiries-funnel.md`](./enquiries-funnel.md) tracks.

## 2. Entry points
- **Routes:** `/admin/finance` (single page, no tabs). The Dashboard "Revenue (this month)"
  glance tile links to `/admin/settings`, but Finance itself is opened from the sidebar
  and cross-linked from the "Deal Pipeline" card to `/admin/enquiries`.
- **Tiles / triggers:** 6 KPI tiles, a Revenue-by-month bar chart with a 6/12/24-month
  window selector, a revenue-mix doughnut, an MRR line, Subscriptions and Net-position
  panels, and a filterable transactions table with a per-row detail modal. The console's
  composition today is: subscriptions, featured listings, services, refunds, MRR,
  ARPU/ARPPU and the plan book - no rent band, no rent-pay fee tile, no payouts.
- **Source components:**
  - `src/pages/admin/AdminFinance.jsx` - KPIs, charts, panels, transaction table + modal, CSV export.
  - `src/lib/data/finance-admin.js` - `buildTransactions()`, `buildRevenueSeries()`.
  - Chart primitives `src/components/charts/index.jsx`; money formatting `src/lib/format.js` (`fmtINR`, `fmtNum`).

## 3. Actors & roles
- **Operator = admin** with the `finance` module. `finance:read` is one of the six
  administrator-only atoms, so it can never be granted to an operations account. The module is gated by the
  `finance` admin flag (`ADMIN_MODULES` in `src/lib/adminModules.js`, `flagKey: 'finance'`);
  when the flag is off the module is hidden from nav and route.
- Sub-panels are further gated by admin option flags read via `useAdminFlags().optionEnabled`:
  `finance.charts`, `finance.models`, `finance.transactions` (all default `true` in the seed).
- Guards are UX-only (mock RBAC) - see [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1.

## 4. Entities touched
- [`settings.fees`](../../system/data-model.md) - **read** (fee schedule + `gstPercent`).
- [`analytics.revenue`](../../system/data-model.md) - **read** (per-month subscriptions/services/featured series).
- [`deals`](../../system/data-model.md), [`tickets`](../../system/data-model.md) (status `done`),
  [`listings`](../../system/data-model.md) (`featured`), `users` - **read** to synthesise the transaction ledger and ARPU.
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
`gstPercent: 18`.
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

### 5.5 Commission, GST, net position
- `partnerPayout = round(month.services * 0.65)` (partners keep 65% of services revenue).
- `commission    = month.services - partnerPayout` (platform keeps the remaining 35%).
- `netRetained   = monthTotal - partnerPayout`.
- `gstAmount     = round(monthTotal * gstRate)`.
- **Net position panel:** revenue in, refunds out. "Partner payouts (65%)" and "Platform
  commission (35%)" were a split of a figure that was itself fabricated, and the payouts,
  GST-held-on-rent and unsettled-gateway-fee rows were all facts about the tenant-to-owner rent
  rail. That rail was withdrawn, so those rows are **gone** rather than pinned at a zero an
  operator would read as a quiet month. Refunds keep the marker that says no refund path exists.

### 5.6 ARPU and ARPPU
- `users = db.users.length`; `arpu = round(monthTotal / max(1, users))` (the ARPU KPI).
- `arppu = round(monthTotal / max(1, payingUsers))` (the ARPPU KPI). The two are separate tiles
  because one figure under an unqualified label invites the reader to assume it is the other.

### 5.7 KPI tiles (6)
| KPI | Value | MoM delta |
|-----|-------|-----------|
| MRR (subscriptions) | `month.subscriptions` | `pct(subs, prev.subs)` |
| Revenue this month | `monthTotal` | `pct(monthTotal, prevTotal)` |
| Services revenue | `month.services` | `pct(services, prev.services)` |
| Featured revenue | `month.featured` | `pct(featured, prev.featured)` |
| Revenue (12 mo) | `ytd` | none |
| ARPU / ARPPU | `arpu`, `arppu` | none |

### 5.8 Transaction ledger (`buildTransactions`)
A synthetic ledger built from existing collections, newest-first (sorted by `date` desc):
- **Deals** (first 8): `party = listing || customer`, `type = 'Rent agreement'` when
  `deal === 'rent'` else `'Sale facilitation'`; `amount = fees.rentAgreementPlatform || 999`
  for rent, else `round(deal.value * 0.005)` (0.5% sale-facilitation fee). IDs `TX4000+`.
- **Tickets** with `status === 'done'` (first 8): `type = ticket.service`, `amount = ticket.value || 0`. IDs `TX5000+`.
- **Featured listings** (first 6): `type = 'Featured listing'`, `amount = fees.featuredListing || 5000`
  (seed makes this `999`). IDs `TX6000+`.
- **Status decoration** (deals/tickets/featured): cycled from
  `STAT = [closed, closed, closed, pending, closed, refunded, closed, closed, failed, closed]`
  by index. When status is
  `refunded` the amount is flipped negative (`-abs(amount)`). There is no `method` column: it was
  invented here and never sourced, and the rent rail it decorated is gone.
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
- The transaction ledger is **fabricated** from unrelated collections (deals/tickets/featured)
  with cycled status - it is not a real payments table. A backend must own an
  immutable transactions table with real gateway status, GST and refund records.
- GST and net-retained are computed in the browser from `monthTotal` and must be
  authoritative server figures.

### 5.11 Disclosed figures: what is measured and what is a structural zero (D63, D65)

Two of the money lines on this screen describe paths the platform **does not have**. Until this
section shipped, they rendered as ordinary numbers, and a structural zero and a measured zero look
identical to an operator:

| Figure | Reality today | Evidence |
| --- | --- | --- |
| `refunds` (server) / **Refunds (recent)** (screen) | The platform has no refund path at all, so no refund can be recorded. | A literal `0L` in `AdminFinanceService.finance()`. The screen's own figure is derived from *mock* transaction statuses and is not a receipt. |
| Services marketplace inside **revenue** | Excluded. `service_orders.amount` is a quote, and the table carries no column saying money arrived - no `paid_at`, no `paid` status (`V11__DDL_engagement_billing.sql`, folded from the old `V8`, with the status vocabulary widened by the old `V57`). | `AdminMetricsRepository.REVENUE_BY_SOURCE` unions subscriptions + boosts only. |

There used to be a third: `payoutsCompleted` / **Partner payouts**. Both the figure and its
disclosure are gone. `payout_accounts` stored *where* a remittance to an owner would go and nothing
ever wrote one; the rail that would have was withdrawn in V127, taking `payoutsMeasured`,
`payoutsCompleted`, `payoutsDue`, `gstCollected` and `pendingSettlement` with it, along with the
`rent` band in the revenue series. A disclosure explaining why a figure is zero is only worth
carrying while the figure has a reason to be on the screen at all.

**Why disclosed rather than omitted.** Dropping a figure the screen has a slot for makes a rendering
bug and an absent money path into the same blank cell. Keeping the number and attaching a reason
makes the gap legible: the operator sees `₹0`, sees *why* it is zero, and cannot mistake it for a
quiet month. Removing the slot **as well as** the figure, as the payout rows show, is the other
honest option — and the right one once the path is not merely unbuilt but abandoned.

**Which flag turns each one on.** The disclosures are configuration, not data - nothing in the
schema can distinguish "no refunds this month" from "this platform cannot refund", so the answer is
a fact about which slices have shipped. Defaults are today's truth.

| Property (`application.properties`) | Env override | Default | Turns off the disclosure for |
| --- | --- | --- | --- |
| `punenest.finance.refunds-measured` | `FINANCE_REFUNDS_MEASURED` | `false` | `refunds` / **Refunds (recent)** |
| `punenest.finance.service-orders-counted` | `FINANCE_SERVICE_ORDERS_COUNTED` | `false` | services inside **revenue** / **Gross revenue** / **Services revenue** KPI |

They are read in `AdminFinanceService`'s constructor via `@Value` and travel on the `AdminFinance`
response as `refundsMeasured` and `serviceOrdersCounted`. Three tests hold the
promise "set the property, no code change" together, and it takes all three:
`AdminFinanceDisclosureTest` pins the defaults; `AdminFinanceDisclosureEnabledTest` proves the
properties actually flip the response; and `AdminFinancePropertyContractTest` reads the real
`src/main/resources/application.properties` off disk and checks it spells the keys the way the
annotations read them - without it, `src/test/resources/application.properties` shadows the deployed
file, so a typo there (`refund-measured` for `refunds-measured`) would leave the first two green
while the env override did nothing in production.

**They disclose; they do not enable.** Setting one `true` does not create the money path behind it -
it only stops the screen from warning that the path is missing. Turning one on before the thing it
describes exists puts the dashboard back to lying quietly, which is the state this section ends.

**Frontend delivery, and its known gap.** `/admin/finance` (the React page) does not call the
backend endpoint - it is entirely mock-driven (`getSettings()` + `rawDb()`), and there is no admin
seam in `src/services/providers/**` (see [`../../system/frontend-data-seam.md`](../../system/frontend-data-seam.md);
a `financeService.js` was deleted for having zero importers). So the page reads the same three flags
from the settings document it already loads:

```
settings.finance.refundsMeasured        // absent or non-true => disclose
settings.finance.serviceOrdersCounted
```

Absent means "not measured" deliberately: a disclosure that defaults to *measured* is an affirmative
claim about a figure, made by a typo. **When the admin http provider lands, these two keys should
be fed from the endpoint's `refundsMeasured` / `serviceOrdersCounted` fields**,
at which point the server property becomes the single source of truth for both halves.

## 6. Maker-checker / approval
- **Applicable: no.** Finance is a read-only reporting surface today - no proposal/approval
  states, no mutations, no audit writes. Refunds are only *displayed*, not initiated
  here. A real backend would introduce maker-checker on refunds (see
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2).

## 7. State machine
- No entity lifecycle is owned by this page. The only "states" are transaction **status**
  values surfaced from the synthetic ledger: `closed`, `pending`, `refunded`, `failed`.
  These are display categories, not transitions the
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
