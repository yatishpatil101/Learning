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
Link to [`../../system/data-model.md`](../../system/data-model.md).
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
- **Tenant profile** - `tenant_profiles` (occupation/income/occupants/prior landlord/about). Read
  and written through `GET|PUT /me/tenant-profile`; the score is computed server-side from these
  fields (section 5.5). The `pnTenantProfile:<mobile>` key is the mock provider's store only.
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

### 5.5 Tenant profile score (`TenantProfileService.score`, server-owned)
Reputation signal shown to owners, computed by the server and returned on `GET /me/tenant-profile`:
```
score = (verified ? 30 : 0) + (occupation ? 20 : 0) + (income ? 15 : 0)
      + (priorLandlord ? 15 : 0) + (about ? 10 : 0) + (occupants ? 10 : 0)   // capped at 100
```
The client no longer computes this. Two numbers for one profile is worse than one number somebody
disagrees with, and the number an owner screens on cannot be one the applicant's browser produced —
`score` and `verified` are absent from the write shape (`TenantProfileUpdate`), not merely ignored.

`score` is **`null`, not `0`, when the tenant has never saved a profile.** "Not assessed" and
"assessed, scored nothing" are different claims about a person: the Verified-Tenant meter renders a
dash for the first and a 0% bar for the second. A saved-but-empty profile does score 0, which is the
distinction the tests hold in place.

### 5.6 Owner-side property finance (`src/services/financeService.js`)
Separate from the tenant's rent history: for an owner's rented-out property, the finance provider
exposes `getTenant`, `getDues`, ledger and payout helpers so the owner dashboard shows current tenant,
dues and received rent. Async (provider seam,
[`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 6).

### 5.7 Coming-soon gate
When `onlineRentPayment` is off, `/pay-rent` renders `PayRentComingSoon` (value prop + waitlist)
instead of the live flow; no money moves.

### 5.8 Ruling: online rent payment is a **concept-only** feature (2026-08-24)

`/pay-rent` is deliberately **not** being built out. `onlineRentPayment` stays off, the route's real
behaviour is `PayRentComingSoon`, and the payment engine behind the flag exists to demonstrate the
idea, not to move money. Three consequences that are easy to get wrong:

- **Do not build backend for it.** The gaps a reader will notice are real but will not be filled:
  `PayoutAccountUpdateRequest` is `@NotBlank accountHolder`, so a payout account can be linked and
  edited but never *unlinked*; there is no `DELETE /me/payout-account`. The paid-then-settled
  transition has no PSP behind it. Both are intentional.
- **`e2e/tests/consumer/account/pay-rent.spec.js` is mock-only for a product reason, not a
  technical one.** Earlier notes in `tasks/todo.md` said the API "cannot fixture or express" these
  states; that framing was wrong and led to the feature being queued for backend work it does not
  want. The correct reason is that there is nothing live to assert, because the feature is off.
- **At mock deletion (P5c) that spec retires with the mock**, and the surviving live claim is the
  coming-soon state itself. Do not port the fee-breakdown or receipt assertions to a `live-` twin:
  they would assert an engine no user reaches.

What *is* live and must keep working is the surrounding tenancy money rail, which is a different
thing: `RentController` (`/me/rent/payments`, `/me/rent/ledger`, `/me/rent/mandate`), the owner P&L
in `MeFinancesController`, and the tenant-side reads covered by `live-tenant-finances.spec.js` and
`live-my-rental.spec.js`.

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
- **No active tenancy:** the rent surfaces show an honest empty state. This used to fall back to
  `seedDemoTenancy` — fabricated data (`PN-RENT-DEMO`, owner Rahul Deshmukh 9820011234, rent 28000,
  two past payments and a partial tenant profile) written into the same localStorage keys a real
  tenancy used, with a "Load a demo rental" button on the panel. Against the API those keys are not
  read at all, so the affordance could only ever show a tenant a tenancy that does not exist while
  their real one sat one fetch away. The seeder and both buttons are gone.
- **A payment that did not settle:** the ledger keeps failed charges, and every rent surface treats
  "a payment row exists" as *not* "money moved". A `failed` row is excluded from lifetime rent, from
  the on-time count and from the Rent Passport PDF, is rendered struck-through with the failure
  reason, and offers no HRA receipt — an HRA receipt is a tax document, and issuing one for money
  that never left the tenant's account is a false statement to their employer.
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
