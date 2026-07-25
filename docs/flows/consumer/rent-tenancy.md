# Flow: Rent Payment & Tenancy Management

> The recurring side of renting: a tenant pays monthly rent (and optionally finances the deposit)
> through PuneNest, a platform fee + GST is charged, an HRA receipt is generated, the owner's rent
> ledger is credited, and both sides see a live tenancy (dues, autopay mandate, history).
> **Status:** documented from React source - **Primary role(s):** tenant (payer), owner (payee /
> ledger), platform (fee revenue)

---

## 1. Purpose & user problem
- **Persona:** an active tenant who wants a clean, receipted way to pay rent online; the owner who
  wants an auditable rent ledger and payout; the platform earning a small transaction fee.
- **Job-to-be-done (tenant):** "Pay this month's rent (or set autopay), optionally finance my deposit
  in EMIs, and get an HRA-ready receipt."
- **Job-to-be-done (owner):** "See who has paid, what's due, and get paid out."
- **Why it matters:** it monetizes the *post*-deal relationship (transaction fee + GST) and closes the
  rent loop that [`./rent-agreement.md`](./rent-agreement.md) opens. It is the only place PuneNest
  moves recurring money, so the fee math and ledgers must be server-owned.

## 2. Entry points
- **Routes:** `/pay-rent` - a `ProtectedRoute`, further gated by the `onlineRentPayment` flag: on ->
  `PayRent.jsx`; off -> `PayRentComingSoon.jsx`. The owner-facing tenancy/dues surfaces live in the
  dashboard "My Rental" / property-finance widgets.
- **Tiles / triggers:** dashboard "Pay rent" / "My Rental" cards; the tenancy row created when a rent
  deal is finalized; reminders/toasts near the due day.
- **Source components:** `pages/consumer/PayRent.jsx`, `PayRentComingSoon.jsx`; stores
  `src/lib/store/rent.js` (fees, ledgers, tenancies, mandates, payouts, tenant profile),
  `src/lib/rentPay.js` (the single `pay()` engine), `src/lib/data/tenancy.js` (load/status/seed);
  owner-side property finance `src/services/financeService.js` +
  `providers/mock/financeProvider.js`; HRA receipts (`generateSingle`); fees `getFees`
  (`src/lib/store/billing.js`).

## 3. Actors & roles
- **Tenant (payer):** pays rent/deposit, sets autopay, downloads receipts. Must be signed in
  (ProtectedRoute).
- **Owner (payee):** sees the rent ledger/dues for their properties, manages the payout account. Owner
  finance uses a separate `financeService` (getTenant/getDues) keyed to the owner's properties.
- **Platform:** records the fee + GST as revenue (`pnRentFeeLedger`).
- **Guards:** `/pay-rent` is a `ProtectedRoute` **and** flag-gated; all cross-actor writes
  (owner ledger, tenancy) are UX-only today and MUST be server-authorized
  ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1).

## 4. Entities touched
Link to [`../../system/domain-model.md`](../../system/domain-model.md).
- **Rent payment (tenant history)** - `pnRentPayments:<tenantMobile>` via `addRentPayment`
  (`{ month:'YYYY-MM', amount, fee, gst, total, propId, ownerMobile, ts, receiptId }`).
- **Rent ledger (owner credit)** - `pnRentLedger:<ownerMobile>` via `addRentLedger` (the owner's
  received-rent view / payout basis).
- **Platform fee ledger (revenue)** - `pnRentFeeLedger` via `addPlatformRentFee` (`fee + gst`).
- **Tenancy** - `pnTenancies:<mobile>` via `addTenancy` (upsert by `propId + ownerMobile`), written
  cross-actor when a rent deal is finalized.
- **Rent mandate (autopay)** - `pnRentMandate:<tenantMobile>` via `setRentMandate`
  (`{ active, dayOfMonth:5, amount, propId, ownerMobile }`).
- **HRA receipt** - `generateSingle(...)` receipt doc (downloadable, `receiptId`).
- **Payout account** - `pnPayout:<ownerMobile>` (owner bank/UPI for settlement).
- **Tenant profile** - `pnTenantProfile:<mobile>` (KYC/employment/income used for `tenantScore`).
- **Fees config** - `getFees()` -> `rentPayPercent` (2), `gstPercent` (18).

## 5. Business rules & logic  *(the meat - fee math)*

### 5.1 Rent platform fee + GST (`calcRentFee` in `src/lib/store/rent.js`)
The core money math (indicative to the user, canonical on the server):
```
pct    = fees.rentPayPercent ?? 2      // platform fee %
gstPct = fees.gstPercent     ?? 18     // GST % on the fee
fee      = round(amount * pct / 100)
gst      = round(fee * gstPct / 100)
platform = fee + gst                   // total platform charge
total    = amount + fee + gst          // what the tenant pays
```
- Fees come from admin `settings.fees` via `getFees()`; the `?? 2 / ?? 18` are fallbacks only. The
  fee display on `PayRent` shows rent, fee, GST and grand total line-by-line.

### 5.2 The single payment engine (`pay(o)` in `src/lib/rentPay.js`)
One code path so every payment is consistent and fully recorded. Given
`{ tenantMobile, ownerMobile, propId, amount, month, autopay }`:
1. **`addRentPayment`** -> tenant history (`pnRentPayments:<tenantMobile>`), stamping the
   `calcRentFee` breakdown and `month` (default `thisMonth()` = current `YYYY-MM`).
2. **`addRentLedger`** -> credit the owner (`pnRentLedger:<ownerMobile>`).
3. **`addPlatformRentFee`** -> record `fee + gst` as revenue (`pnRentFeeLedger`).
4. **`setRentMandate`** (only if `autopay`) -> enable autopay for next months (`dayOfMonth: 5`).
5. **`generateSingle`** -> create the HRA receipt; return its `receiptId`.
   The function returns the payment record (with `receiptId`) so the UI can show/download the receipt.

### 5.3 Deposit financing EMI (`PayRent.jsx`)
For paying the security deposit in installments:
```
emi   = round((a + a * 0.015 * n) / n)   // 1.5% per month flat interest
total = emi * n
```
- `a` = deposit amount, `n` = tenure in months. Tenure options: 3 / 6 / 12 months. This is a flat-rate
  (not reducing-balance) financing quote; the platform/lender funds the deposit and the tenant repays
  `emi` for `n` months.

### 5.4 Tenancy status (`tenancyStatus(t)` / `loadTenancies` in `src/lib/data/tenancy.js`)
- A **tenancy** binds tenant, owner, property, rent, deposit, `dueDay` (default 5) and start date.
  `addTenancy` upserts by `propId + ownerMobile` (no duplicate tenancy for the same flat/owner).
- `tenancyStatus` derives: `paidThisMonth` (does a `pnRentPayments` record exist for `thisMonth()`?),
  and `nextDue` = the `dueDay` of the current month if unpaid, else of next month. Drives the
  "Paid / Due on 5th" chips and reminder copy.

### 5.5 Tenant profile score (`tenantScore` in `src/lib/store/rent.js`)
Reputation signal shown to owners:
```
score = (idVerified ? 30 : 0) + (employment ? 20 : 0) + (income ? 15 : 0)
      + (priorLandlord ? 15 : 0) + (about ? 10 : 0) + (occupants ? 10 : 0)   // capped at 100
```

### 5.6 Owner-side property finance (`src/services/financeService.js`)
Separate from the tenant's rent history: for an owner's rented-out property, the finance provider
exposes `getTenant`, `getDues`, ledger and payout helpers so the owner dashboard shows current tenant,
dues and received rent. Async (provider seam,
[`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 6).

### 5.7 Coming-soon gate
When `onlineRentPayment` is off, `/pay-rent` renders `PayRentComingSoon` (value prop + waitlist)
instead of the live flow; no money moves.

## 6. Maker-checker / approval
- **Rent payment:** no maker-checker - it is an immediate transaction (in production, gated by a real
  PSP authorization instead of the mock).
- **Tenancy creation:** *is* the downstream of a maker-checker - it is written when a rent deal /
  agreement is finalized (owner accepts), i.e. approval happened upstream in
  [`./rent-agreement.md`](./rent-agreement.md). Payout account changes should be treated as
  sensitive (verification) server-side.

## 7. State machine
```
Tenancy:        pending-setup --deal finalized--> active --(lease end / vacate)--> ended
Month cycle:    due --tenant pays (pay())--> paid_this_month --(1st of next month)--> due
Autopay:        off --setRentMandate(active)--> on (auto-charge on dayOfMonth 5) --disable--> off
Deposit EMI:    quoted --start--> repaying (n months) --last emi--> closed
Payment record: created (immutable) -> receipt generated
```
- `tenancyStatus` computes the `due <-> paid_this_month` position each render from the payment history
  (no stored flag). Payment records are append-only.

## 8. Edge cases, validation & error states
- **Not signed in / flag off:** `/pay-rent` redirects (ProtectedRoute) or shows `PayRentComingSoon`.
- **No active tenancy:** PayRent falls back to `seedDemoTenancy` demo data (DEMO_PROP_ID
  `PN-RENT-DEMO`, owner Rahul Deshmukh 9820011234, rent 28000, deposit = rent*3, two past payments +
  a partial tenant profile) so the page is explorable; a real backend would show an empty state.
- **Duplicate/late payment:** `addTenancy` upserts by `propId+ownerMobile`; `paidThisMonth` prevents
  showing "due" after a same-month payment. Nothing stops a second manual payment (server must
  enforce idempotency per month).
- **Fee/GST config missing:** `calcRentFee` falls back to 2% / 18%.
- **Rounding:** `fee` and `gst` are independently `round`ed; the server must use the same order
  (round fee, then round GST on the rounded fee) to match receipts.
- **Autopay:** mandate fixes `dayOfMonth = 5`; disabling clears it. The mock does not actually
  auto-charge - production needs a scheduler + PSP mandate.
- **Deposit EMI:** flat 1.5%/month; guard `n > 0` and positive `a`.
- **Cross-actor writes:** owner ledger + tenancy are written from the tenant/owner client via
  localStorage keys - trivially forgeable; must be server-side and authorized.

## 9. Current mock implementation
- **Fees/ledgers/tenancy/mandate/profile:** `src/lib/store/rent.js` (`calcRentFee`, `addRentPayment`,
  `addRentLedger`, `addPlatformRentFee`, `addTenancy`, `setRentMandate`, `getPayout`/`setPayout`,
  `tenantScore`, `thisMonth`).
- **Payment engine:** `src/lib/rentPay.js` `pay(o)` (the 5-step single path) + `generateSingle` HRA
  receipt.
- **Tenancy data/status/seed:** `src/lib/data/tenancy.js` (`loadTenancies`, `tenancyStatus`,
  `seedDemoTenancy`, DEMO constants).
- **Owner property finance:** `src/services/financeService.js` +
  `src/services/providers/mock/financeProvider.js` (`getTenant`, `getDues`, ...).
- **UI:** `pages/consumer/PayRent.jsx` (tabs `pay` / `deposit` / `history`, fee breakdown lines,
  deposit EMI calc) and `PayRentComingSoon.jsx`.
- **Fees config:** `getFees` + `FEE_DEFAULTS` (`rentPayPercent:2`, `gstPercent:18`) in
  `src/lib/store/billing.js`.
- **Storage keys:** `pnRentPayments:<mobile>`, `pnRentLedger:<mobile>`, `pnRentFeeLedger`,
  `pnTenancies:<mobile>`, `pnRentMandate:<mobile>`, `pnPayout:<mobile>`, `pnTenantProfile:<mobile>`.

## 10. Target API endpoints
Map to [`../../system/api-contract.md`](../../system/api-contract.md):
- Rent payments (section 17): `POST /me/rent-payments` (make a payment -> returns breakdown + receipt),
  `GET /me/rent-payments` (history), `GET /me/rent-payments/:id/receipt` (HRA receipt).
- Tenancies (section 18): `GET /me/tenancies`, `GET /me/tenancies/:id` (status/dues), owner view of
  a property's tenancy/ledger; `PUT /me/tenancies/:id/mandate` (autopay).
- Tenant profiles (section 19): `GET/PUT /me/tenant-profile` (score inputs).
- Fees (section 33): `GET /fees` (`rentPayPercent`, `gstPercent`).
- Payout account: `GET/PUT /me/payout` (owner settlement).
- **Missing but implied:** deposit-financing endpoints (quote + schedule), a PSP/mandate webhook for
  autopay execution, and the platform-fee revenue ledger (internal).

## 11. Backend responsibilities
- **Own the fee math:** compute `fee` (rentPayPercent) and `gst` (gstPercent) server-side with the
  same rounding order; never trust client-sent `fee`/`gst`/`total`. Charge exactly `amount + fee +
  gst` via the PSP.
- **Atomic, idempotent payment:** the 5 effects of `pay()` (tenant history, owner ledger, revenue
  ledger, optional mandate, receipt) must be one transaction, idempotent per `(tenant, propId,
  month)` to prevent double charges/receipts.
- **Authorize cross-actor writes:** only the paying tenant writes their payment; the owner ledger and
  tenancy are derived server-side, not client-posted; payout-account changes require identity
  verification.
- **Autopay:** store the mandate with a real PSP token, run a scheduler on `dayOfMonth`, and record
  outcomes (success/failure/retry) - not a localStorage flag.
- **Receipts:** generate tamper-evident HRA receipts server-side and store them; expose read-only.
- **Deposit financing:** if offered, own the 1.5%/month (or corrected) quote, the repayment schedule,
  and the credit decision; never let the client set the EMI.
- **Audit & notify:** write an audit row per payment/mandate/payout change and notify both parties
  (cross-cutting sections 4 & 7).
