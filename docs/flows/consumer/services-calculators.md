# Flow: Services Hub & Financial Calculators

> The `/services` marketplace hub and its sub-service pages (home loans, legal, packers, interior,
> valuation, rent agreement), plus the client-side financial calculators (EMI, affordability,
> stamp-duty, moving-cost, valuation) that anchor each page. Every calculator's math is captured here
> because it must move server-side verbatim.
> **Status:** documented from React source - **Primary role(s):** buyer/tenant/owner (all consumers)

> **Runtime correction (2026-08-28).** References below to the former `serviceFlow.js` browser
> workflow are historical. Service requests are now server-owned behind `serviceRequestService.js`;
> the client no longer writes a concierge workflow or ticket mirror to `localStorage`.

---

## 1. Purpose & user problem
- **Persona:** any consumer who, alongside buying/renting, needs the *adjacent* services -
  a home loan, legal/registration help, movers, interiors, a valuation report, or a rent agreement.
- **Job-to-be-done:** "Estimate a cost instantly (EMI, stamp duty, moving cost, property value),
  then hand off a lead to the right PuneNest ops team."
- **Why it matters:** the "everything under one roof, zero brokerage" promise. Calculators are the
  free, high-trust "customer touch" that converts a browser into a service lead; each page ends in a
  `createServiceRequest` into the ops queue. The calculators are pure functions today so they are
  testable - and portable to the backend unchanged.

## 2. Entry points
- **Routes (from `src/App.jsx`):**
  - `/services` - hub (`Services.jsx`).
  - `/home-loans` - home loans page with `LoanEmiCalc` (`services/HomeLoans.jsx`).
  - `/emi-calculator` - full EMI calculator, behind `AppFlagRoute flag="emiCalculator"`
    (`EmiCalculator.jsx`).
  - `/services/property-legal` - legal page with `LegalCostCalc` (`services/PropertyLegal.jsx`).
  - `/services/packers-movers` - packers page with `PackersEstimator` (`services/PackersMovers.jsx`).
  - `/services/interior-renovation` (`services/InteriorRenovation.jsx`).
  - `/services/property-valuation` - valuation page with an inline instant estimator
    (`services/PropertyValuation.jsx`).
  - `/services/rent-agreement` - see [`./rent-agreement.md`](./rent-agreement.md).
- **Tiles / triggers:** the hub's 9 service cards (`SERVICES` array) deep-link to each page/listing
  filter; the Move-in Pack bundle sits in the hub; each calculator's CTA opens a lead form or the
  full EMI page (`/emi-calculator`, gated by flag).
- **Source components:** `Services.jsx`, `EmiCalculator.jsx`, `services/LoanEmiCalc.jsx`,
  `services/LegalCostCalc.jsx`, `services/PackersEstimator.jsx`, `services/PropertyValuation.jsx`;
  catalog `src/data/services.json`; service requests through
  `src/services/serviceRequestService.js`.

## 3. Actors & roles
- **All consumers** can open every calculator and see instant figures **without signing in** (the
  math is public). Submitting a *certified/lead* request requires sign-in:
  `navigate('/signin?reason=service&next=<path>')` (draft restored on return). The Move-in Pack
  `bookPack` and rent-agreement generate also require sign-in.
- **Ops/staff** (team-scoped) consume the resulting tickets/requests in the back-office (out of scope
  here). No consumer route here is a `ProtectedRoute`; the sign-in gate is in-handler.

## 4. Entities touched
Link to [`../../system/data-model.md`](../../system/data-model.md).
- **Service ticket** - `createServiceRequest({ team, service, customer, mobile, detail, value, ref })`
  in `mockApi` -> admin/ops services queue. Created by every lead form (legal/packers/valuation/
  interior/rent-agreement/move-in-pack + waitlist).
- **Service workflow request** - a server `service_requests` record for the customer tracker
  (valuation, rent agreement). See section 5 and [`./rent-agreement.md`](./rent-agreement.md).
- **Service order** - `addServiceOrder({ type:'move-in-pack', items, total })`
  (`pnServiceOrders:<mobile>`) for the Move-in Pack bundle.
- **Fees config** - `getFees()` (`settings.fees`, admin-controlled) supplies `rentAgreementPlatform`
  and any dynamic charges; the Move-in Pack prices come from `settings.movePack.items`.
- **Services catalog** - `src/data/services.json` (6 rows) drives the ops/admin service list.

## 5. Business rules & logic  *(the meat - calculator math)*

All formulas below are computed **client-side today** and MUST be re-implemented on the server
(indicative figures shown to the user, so no trust is placed in them - but the server should own the
canonical numbers to avoid drift and to gate any that become billable).

### 5.1 EMI calculator - full page (`EmiCalculator.jsx`) and card (`LoanEmiCalc.jsx`)
Inputs: `P` = loan amount, `annualRate` %, `years` tenure.
```
n = years * 12                       (months)
r = annualRate / 12 / 100            (monthly rate)
EMI = r == 0 ? P / n
             : P * r * (1+r)^n / ((1+r)^n - 1)
total    = EMI * n
interest = max(total - P, 0)
```
- Full page clamps: amount 5L..5Cr (step 1L, default 80L), rate 5..15% (step 0.05, default 8.5),
  tenure 1..30y (default 20). Non-finite/negative EMI -> 0. Lender chips
  (SBI 8.5, HDFC 8.6, ICICI 8.65, Axis 8.75, LIC HFL 8.45) just set the rate.
- **Year-wise amortization schedule** (full page): iterate months, `interest = balance*r`,
  `principal = min(EMI-interest, balance)`, `balance -= principal`; aggregate per year into
  `{ principal, interest, balance }`.
- Card version (`computeEmi` in `LoanEmiCalc.jsx`) is the same formula with `n = max(years,1)*12`
  and rounded outputs; ranges amount 5L..3Cr, rate 7..12%, tenure 5..30y (defaults 50L/8.5/20).
  Its CTA to the full page shows only when `flagEnabled('emiCalculator')`.

### 5.2 Legal stamp-duty & registration (`LegalCostCalc.jsx`, `computeStampDuty`)
Maharashtra ready-reckoner-style estimate for a *purchase*:
```
rate = max(ratePct - (femaleConcession ? 1 : 0), 1)   // 1% women concession (residential)
stamp = round(value * rate / 100)
reg   = min(round(value * 0.01), 30000)               // registration 1%, capped at Rs 30,000
total = stamp + reg
```
- `ratePct` by area: Municipal Corporation (Pune/PCMC) = 6, Municipal Council/Nagar Panchayat = 5,
  Gram Panchayat (rural) = 4. Buyer: "Female (sole owner)" applies the 1% concession.
- Default property value 75L; slider 10L..5Cr.

### 5.3 Packers moving-cost estimator (`PackersEstimator.jsx`, `estimateMove`)
```
base = BASE[size]                         // [lo, hi] Rs
factor = DIST[dist] * PACK[pack] * LIFT[lift]
lo = round(base[0] * factor / 500) * 500  // rounded to nearest Rs 500
hi = round(base[1] * factor / 500) * 500
```
- `BASE` (Rs lo-hi): 1 RK 4000-7000, 1 BHK 6000-12000, 2 BHK 9000-18000, 3 BHK 14000-26000,
  4 BHK/Villa 22000-40000, Few items only 2000-5000.
- `DIST` multipliers: within Pune 1, <500 km 2.2, 500-1200 km 3, >1200 km 3.8.
- `PACK`: Standard 1, Premium/fragile-safe 1.18. `LIFT`: lift/ground 1, upper-no-lift 1.08.
- Output is a *range*; the real quote comes from the hero lead form (`#quote`).

### 5.4 Property valuation instant estimate (`PropertyValuation.jsx`, `est`)
```
base   = RATES[loc] ?? PUNE_AVG_RATE            // Rs/sq.ft
rate   = base * typeM * ageM * floorM * 1.15    // 1.15 = market/premium uplift
mid    = rate * area                            // area in sq.ft; null if area == 0
range  = fmtShort(mid*0.93) .. fmtShort(mid*1.07)   // +/- 7% band
trend  = '+' + (YOY[loc] ?? PUNE_AVG_YOY) '%'
comps  = min(180, 24 + round(area/40) + round(base/1000))
conf   = clamp(72..95) of 92, minus 12 if area<400 or >3000, minus 3 if ageM<0.9, minus 8 if unknown locality
```
- Multipliers: **type** Flat 1 / Villa 1.18 / Plot 0.55 (plot forces `floorM = 1`); **age** New 1.05
  / 0-5y 1 / 5-10y 0.92 / 10y+ 0.82; **floor** Ground 0.98 / Mid 1 / High 1.05 / Top 1.10.
- `RATES` cover 13 hand-tuned localities; any other Pune locality (curated or user-minted) uses
  `PUNE_AVG_RATE`/`PUNE_AVG_YOY` (means of the tuned sets). The estimate is public; the certified
  report is a signed-in lead.

### 5.5 Services hub - Move-in Pack bundle (`Services.jsx`)
- Prices come from admin config `settings.movePack.items` (fallback `DEFAULT_PACK_PRICES` = movers
  8000, clean 2500, agreement 1500, paint 6000, verify 999, internet 500) via `useMovePackConfig()`,
  which live-reacts to `punenest-settings-change` and `storage` events.
- **Bundle math:**
  ```
  total = sum of selected item prices
  save  = round(total * 0.12)     // 12% bundle discount
  net   = total - save            // "You pay"
  ```
- `bookPack`: requires >=1 item and sign-in; persists `addServiceOrder({ type:'move-in-pack', items,
  total: net })` AND `createServiceRequest({ team:'packers', service:'Move-in Pack', value: net })`.
- When `settings.movePack.enabled` is false the section runs in "coming soon" mode: prices hidden,
  `submitNotify` captures a waitlist lead (valid mobile only, no forced sign-up) via
  `createServiceRequest({ service:'Move-in Pack - waitlist' })`.
- The hub's animated stat counters (`Counter`) use an eased ramp (`1-(1-p)^3`) - display only.

### 5.6 Lead submission & the ops workflow bridge (shared)
- Service submissions create a server-owned request through `serviceRequestService.js`.
- The richer pages (valuation, rent agreement) create the same request the customer tracker and the
  drafting desk later read; no browser ticket mirror or client-side status synchronisation exists.
  See [`./rent-agreement.md`](./rent-agreement.md).
- The workflow status ladder (shared): `STEPS = [Submitted, Documents, Draft & approval,
  Registration, Ready]`; `progressPct` maps Submitted 25% -> Draft 50% -> Registration 75% ->
  Ready 100%. `isActive(status)` = not completed/cancelled.
- `createServiceRequest` reference values seen: legal Rs 2499, valuation Rs 499, rent agreement Rs 999
  (from `services.json`); interior/packers are quote-based (price 0).

## 6. Maker-checker / approval
- The calculators themselves are stateless (no approval). The **service requests** they create are the
  start of a maker-checker/ops flow: customer proposes (create), staff progress the request, and for
  valuation/rent-agreement the customer approves the drafted document
  ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2). Details in
  [`./rent-agreement.md`](./rent-agreement.md).

## 7. State machine
- **Calculators:** none - pure input -> output on every render (`useMemo`).
- **Lead / ticket:** `new -> in_progress -> done | cancelled` (admin ticket, via `TICKET_STATUS` map).
- **Workflow request (valuation/rent agreement):** `submitted -> docs_review -> draft_shared ->
  (changes_requested | approved) -> registration -> completed` (or `cancelled`); co-fill adds
  `awaiting_party` at the front. See [`./rent-agreement.md`](./rent-agreement.md) section 7.
- **Move-in Pack order:** `placed` (single state today).

## 8. Edge cases, validation & error states
- **Zero/edge inputs:** EMI guards `n>0`, `r==0` (simple division), and non-finite results -> 0;
  valuation returns `null` (no estimate) when area is 0; packers rounds to Rs 500 and clamps unknown
  keys to factor 1.
- **Unknown locality (valuation):** falls back to city-average rate/YoY and drops confidence by 8.
- **Sign-in gate on submit:** valuation `submit` and rent-agreement `generate` bounce to
  `/signin?reason=service&next=...`; the autosaved draft (`pnDraft:*`, `useFormDraft`) is restored on
  return. `bookPack`/`waitlist` also gate/limit appropriately.
- **Field validation:** valuation lead requires name, valid mobile `^[6-9]\d{9}$`, and a purpose;
  Move-in waitlist requires a valid mobile (`isValidMobile`).
- **Admin config unavailable:** Move-in Pack uses `DEFAULT_PACK_PRICES` until `settings.movePack`
  loads; if `enabled` is false the whole section is a waitlist.
- **Feature flags:** `/emi-calculator` and the card's "open full" CTA require `emiCalculator`;
  the flag being off hides the deep link but the card math still works.
