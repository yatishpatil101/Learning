# Flow: Rent & Tenancy Management

> The recurring side of renting, minus the money. **No rent moves through PuneNest.** A tenant
> records one rental of their own and the server derives their yearly and lifetime totals from it;
> an owner keeps an auditable per-property rent ledger; both sides see a live tenancy. The
> tenant-to-owner payment rail that once sat here — payments, autopay mandates, payout accounts and
> a platform fee — was withdrawn in V127.
> **Status:** documented from React source - **Primary role(s):** tenant (records), owner (ledger)

---

## 1. Purpose & user problem
- **Persona:** an active tenant who wants their yearly rent total and an HRA-ready figure without
  keeping a spreadsheet; the owner who wants an auditable rent ledger for a property they let.
- **Job-to-be-done (tenant):** "Tell PuneNest what I pay, once, and let it do the arithmetic my
  employer's HRA form and my own budgeting need."
- **Job-to-be-done (owner):** "See who my tenant is, what is due, and keep a ledger of received rent."
- **Why it matters:** it keeps the *post*-deal relationship legible and closes the rent loop that
  [`./rent-agreement.md`](./rent-agreement.md) opens. It deliberately does **not** monetize that
  relationship: PuneNest is not a payments business, and a dormant money path costs more to keep
  honest than it earns.

## 2. Entry points
- **Routes:** `/pay-rent` - a `ProtectedRoute` that renders `PayRentComingSoon.jsx`
  unconditionally. The page is static: it calls no API and moves no money. It survives as a route
  because the dashboard's "rent due soon" row needs an honest destination, not because anything is
  waiting behind it.
- **Tiles / triggers:** the dashboard **Rent Wallet** (Finances tab, tenant side) and "My Rental"
  cards; the tenancy row created when a rent deal is finalized.
- **Source components:** `pages/consumer/PayRentComingSoon.jsx` (the whole of `/pay-rent`);
  `components/dashboard/TenantFinancesTab.jsx` (the Rent Wallet);
  `components/dashboard/MyRentalPanel.jsx`; `src/services/rentService.js` +
  `providers/http/rentProvider.js` / `rentMapper.js` (`toRentalViewModel`);
  `src/lib/data/tenantFinance.js` (`hraExemption`, `depositInfo`, `fyLabel`);
  owner-side property finance `src/services/financeService.js`; HRA receipts (`generateSingle`).

## 3. Actors & roles
- **Tenant:** records one rental (address, landlord, rent, deposit, lease dates), reads the derived
  totals, edits or archives it. Must be signed in (`ProtectedRoute`); every read and write is scoped
  to the caller's token, and there is no path by which one tenant reaches another's rental.
- **Owner (payee):** sees the rent ledger/dues for their properties. Owner finance uses a separate
  `financeService` (`getTenant`/`getDues`) keyed to the owner's properties. **There is no owner-side
  view of `tenant_rentals` at all** — an owner who wants to know what their tenant believes the rent
  to be has to ask them.
- **Platform:** earns nothing here. There is no fee, no GST and no revenue ledger on this flow.
- **Guards:** `/pay-rent` is a `ProtectedRoute`; the tenancy write is cross-actor and server-authorized
  ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1).

## 4. Entities touched
Link to [`../../system/data-model.md`](../../system/data-model.md).
- **Tenant rental (the tenant's own record)** - `tenant_rentals` (V128), read and written through
  `GET|POST /me/rentals` and `PATCH|DELETE /me/rentals/{rentalId}` (soft delete). Columns: `address`,
  `landlord_name`, `monthly_rent`, `deposit`, `lease_start`, `lease_end`, `status`
  (`active`/`ended`), plus soft-delete and audit. **No `property_id`, deliberately** — the home a
  tenant rents is usually not a PuneNest listing. `address` and `landlord_name` are personal data,
  so the table is wired into DSAR export (`DataExportScope`) and account erasure (`ErasureService`).
- **Tenancy** - `tenancies`, written cross-actor when a rent deal is finalized on this platform.
  A relationship, not a schedule: it carries no instalments.
- **Owner rent ledger** - `transactions` under `/me/finances/{propId}/*`. Untouched by any of this,
  and still the owner's record of recurring rent income (section 5.6).
- **HRA receipt** - `generateSingle(...)` receipt doc (downloadable, `receiptId`).
- **Tenant profile** - `tenant_profiles` (occupation/income/occupants/prior landlord/about). Read
  and written through `GET|PUT /me/tenant-profile`; the score is computed server-side from these
  fields (section 5.5). The `pnTenantProfile:<mobile>` key is the mock provider's store only.
- **Fees config** - `getFees()` -> `gstPercent` (18). There is no rent-payment percentage: the key
  `fees.rentPayPercent` was deleted with the rail.

## 5. Business rules & logic  *(the meat)*

### 5.1 The tenant declares once; the server derives the rest
There is no fee math on this flow any more. A rental is written **once** — address, landlord name,
monthly rent, deposit, lease start, optional lease end — and the server computes everything the
Rent Wallet shows from instalments elapsed since `leaseStart`:

```
monthsPaid  = whole instalments elapsed since leaseStart (bounded by leaseEnd)
totalPaid   = monthlyRent * monthsPaid            // lifetime
fyPaid      = monthlyRent * months within the current April-March year
```

- These arrive **already computed** on the DTO. The financial year is defined once, on the server,
  so the screen and any export cannot drift apart by a month.
- There is no month-by-month entry and there are no payment records. Marking an individual month
  paid would imply the platform knew it had been, which it does not.
- `monthly_rent` is whole rupees (`bigint`), bounded by a check constraint. `monthlyRent * months`
  is rendered as a headline figure, so an absurd value produces an absurd dashboard rather than an
  error anyone would notice.

### 5.2 The Rent Wallet (`components/dashboard/TenantFinancesTab.jsx`)
Reads `/me/rentals` and **nothing else**. From the single self-declared record it shows: the
financial-year total, the lifetime total, months counted, the deposit's opportunity cost, and the
HRA exemption (`hraExemption` in `src/lib/data/tenantFinance.js`, against a basic-salary figure the
tenant types and which never leaves the device).

The point of the screen is that it works for the tenant who found their home through a broker, a
friend or a noticeboard — which is almost every Indian renter, and none of whom have a `tenancy`
row. The old rail would not have helped them either; it only ever described money that moved through
the platform.

### 5.3 The Rent Passport is sealed, on purpose
The Passport is the portable document a tenant hands a prospective landlord, and its header reads
**"Verified rent-payment record"**. It is therefore **not** generated from the self-declared rental,
and must never be: every value on a rental is typed in by the person it flatters, and nothing checks
any of it. Scoring a credential from it would make the platform the author of a forgery. It stays
locked until rent PuneNest has actually seen move exists to build it from. The Wallet says so on the
card rather than hiding the section, because an absent panel and a withheld one read identically.

### 5.4 Tenancy status
- A **tenancy** binds tenant, owner, property, rent, deposit and start date, and is created when a
  rent deal closes on this platform (`TenancyService.openFromClosedDeal`). It is upserted per
  property/owner pair, so there is no duplicate tenancy for the same flat.
- It carries **no instalments and no paid/unpaid position**, because nothing on the platform can
  observe one. The dashboard's rent-due row is derived from the lease's due day alone, and its only
  action is "Coming soon".


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

### 5.7 `/pay-rent` is a static page
`/pay-rent` renders `PayRentComingSoon` (value prop + waitlist) and nothing else. It calls no API.
Any network request originating from that route is a regression.

### 5.8 Ruling: the rent-payment rail was withdrawn (2026-08-24, executed at V127)

Online rent payment was first ruled **concept-only**: the flag stayed off, the route's real behaviour
was already the coming-soon page, and the engine behind the flag existed to demonstrate an idea
rather than to move money. That state was unstable — wired-but-dormant code has to be kept honest by
tests, parity harnesses and reviewers, and it earns nothing while it waits. So it went: the
controller, the fee calculator, the payment/mandate/payout DTOs and the three tables
(`rent_payments`, `rent_mandates`, `payout_accounts`) were deleted, along with `fees.rentPayPercent`,
the `onlineRentPayment` app flag, the `finance.rentPay` admin flag and every admin-finance figure
that described the rail. Dropping them beat leaving them empty: an empty `rent_payments` reads to
the next person as a rail that exists and has no traffic.

Three consequences that are easy to get wrong:

- **Do not build backend for it, and do not rebuild it by halves.** Fragments of the old rail were
  visibly incomplete — a payout account could be linked and edited but never *unlinked*, and the
  paid-then-settled transition had no PSP behind it. Those were symptoms of a feature nobody was
  finishing, not gaps to fill.
- **`/me/rentals` is not that rail returning under a new name.** It is a note the tenant writes about
  a home they rent somewhere else. Nothing on it moves money, nothing on it is evidence, and it has
  no owner-facing side.
- **Nothing derived from it may reach the Rent Passport** (section 5.3).

What *is* live and must keep working is the surrounding tenancy rail, which is a different thing:
tenancies and tenant profiles, the owner P&L in `MeFinancesController`, the tenant's own
`/me/rentals`, and the tenant-side reads their specs cover.

## 6. Maker-checker / approval
- **Recording a rental:** no maker-checker, and no counterparty. It is the tenant's own note about
  their own home; nobody else reads it, so there is nobody to approve it.
- **Tenancy creation:** *is* the downstream of a maker-checker - it is written when a rent deal /
  agreement is finalized (owner accepts), i.e. approval happened upstream in
  [`./rent-agreement.md`](./rent-agreement.md).

## 7. State machine
```
Tenancy:        pending-setup --deal finalized--> active --(lease end / vacate)--> ended
Tenant rental:  (none) --POST /me/rentals--> active --PATCH status--> ended
                                                   --DELETE--> archived (soft delete)
```
- Neither has a month cycle. `monthsPaid` / `totalPaid` / `fyPaid` are **derived on every read** from
  `leaseStart` and the clock; there is no stored position and no per-month row to transition.

## 8. Edge cases, validation & error states
- **Not signed in:** `/pay-rent` and the Rent Wallet redirect (`ProtectedRoute`).
- **No rental recorded:** the Rent Wallet shows an honest empty state with the form to add one. This
  is the common case, not the exception — most tenants arrive with no `tenancy` row either.
- **No active tenancy:** the rent surfaces show an honest empty state. This used to fall back to
  `seedDemoTenancy` — fabricated data (`PN-RENT-DEMO`, owner Rahul Deshmukh 9820011234, rent 28000,
  two past payments and a partial tenant profile) written into the same localStorage keys a real
  tenancy used, with a "Load a demo rental" button on the panel. Against the API those keys are not
  read at all, so the affordance could only ever show a tenant a tenancy that does not exist while
  their real one sat one fetch away. The seeder and both buttons are gone.
- **A rental with no `leaseEnd`:** the normal state of an open tenancy. Guessing eleven months would
  put a date in front of the tenant that neither party agreed to, so the totals simply run to today.
- **Deposit not remembered:** `deposit` is nullable, and zero is a *different* answer from unknown —
  the deposit panel says which it has rather than defaulting to `0`.
- **A typo in `leaseStart`:** bounded by a check constraint (no earlier than 1970), because a bad
  start date silently inflates every total on the page rather than erroring.
- **Editing rent mid-lease:** a `PATCH` changes the figure for the whole derivation, since there is
  no per-month history to preserve. That is a known simplification of a self-declared record and the
  Wallet does not claim otherwise.
- **HRA receipts:** `generateSingle` still renders a receipt document, but the figures on it are the
  tenant's own. An HRA claim is already self-reported to an employer; a *credential* is not, which is
  the line section 5.3 draws.
- **Cross-actor writes:** the tenancy is written server-side on deal close and authorized there. The
  tenant's rental has no cross-actor write at all — `tenant_id` is the caller, always.

