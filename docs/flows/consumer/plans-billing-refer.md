# Flow: Plans, Billing & Refer-a-Friend

> The monetisation and growth surface: subscription tiers (owner + seeker), a simulated checkout, the
> per-user billing view, platform fees, and a two-track referral program with non-monetary rewards.
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** owner + seeker (buyer/tenant)

---

## 1. Purpose & user problem
- **Persona:** an owner who needs more listing slots / featuring / a free rent agreement; a seeker who
  wants more owner contacts; any user who wants to earn rewards by inviting friends.
- **Job-to-be-done:** "Understand what I get on each plan, upgrade if it's worth it, see my billing,
  and get rewarded for bringing friends who list or search."
- **Why it matters:** this is how zero-brokerage is funded (platform fees, plans, service orders) and
  how the marketplace grows virally. Entitlements (listing limits, featuring, contact unlocks) are the
  levers that turn free users into paying ones.

## 2. Entry points
- **Routes:** `/plans` (public), `/checkout?plan=<id>` (`ProtectedRoute`; redirects to
  `/signin?next=...` if signed out), `/refer` (signed-in), and the Dashboard "Plan & Billing" tab
  (`#billing`).
- **Tiles / triggers:** BillingPanel "Change plan ->" (`/plans`); each plan card CTA (free plans link
  to `/list-property` or `/listings`, paid plans link to `/checkout?plan=...`); Refer page share
  buttons; the Plans "Create rent agreement" CTA (`/services/rent-agreement`); the Checkout success
  screen links to `/dashboard#billing`.
- **Source components:** `src/pages/consumer/Plans.jsx`, `src/pages/consumer/Checkout.jsx`,
  `src/pages/consumer/Refer.jsx`, `src/pages/consumer/dashboard/BillingPanel.jsx`,
  `src/lib/store/billing.js`, `src/lib/store/referrals.js`.
- **Data/seed:** `src/data/plans.json`, `src/data/referrals.json`,
  `src/pages/consumer/dashboard/constants.js` (`BILLING_HISTORY`).

## 3. Actors & roles
- **Seeker vs owner plans** are shown side by side; the mobile view toggles persona (defaults to the
  user's `role`, seeker-first for signed-out visitors).
- **Checkout** requires sign-in. **Referral rewards** are role-tracked (owner track vs seeker track).
- **Fraud review** of referrals is an ops/admin responsibility (see
  [`../ops/referrals-fraud.md`](../ops/referrals-fraud.md), planned) - the consumer app only records
  invites/joins/listings and never self-awards across devices.

## 4. Entities touched
Links go to [`../../system/data-model.md`](../../system/data-model.md).
- `plans` (seed `plans.json`, `PL1..PL4`) - read (catalog metadata).
- User plan (runtime `pnPlan:<mobile>`, ids `free`/`owner-free`/`owner2`/`owner5`) - read + written
  by Checkout (`setPlan`).
- Platform fees / `settings.fees` (admin DB, read via `getFees`) - read.
- `service_orders` (runtime `pnServiceOrders:<mobile>`) - created by Checkout (`addServiceOrder`).
- Owner boosts (runtime `pnBoosts:<mobile>`) - entitlement gate for featuring.
- `referrals` (seed `referrals.json`, `RF3###`; runtime stats `pnReferralStats:<mobile>`) - read +
  incremented; plus `pnReferralCode:<mobile>` and `pnReferredBy:<mobile>` capture.
- `BILLING_HISTORY` (static seed constant) - read for the payment-history table.

## 5. Business rules & logic  *(the meat)*

### Plan catalog (`Plans.jsx`)
The page renders two hardcoded plan sets (not directly from `plans.json`), priced via `fee()`:
- **Seeker:** `seeker-free` (Rs 0) and `seeker-plus` (`fee('seekerPlusTopup')` = Rs 199, one-time;
  "Unlock 15 owner contacts", priority visits, no-spam).
- **Owner:** `owner-free` (Rs 0, 1 listing), `owner2` (`fee('ownerPlanYearly')` = Rs 999/yr, 5
  listings + 7-day featuring + unlimited contacts), `owner5` (`fee('ownerProYearly')` = Rs 2499/yr,
  unlimited listings + always featured + dedicated manager + free rent agreement).
- The active plan (`getPlan().id`) is marked "Current plan"; a **paid** current plan locks its CTA
  against re-purchase; a free current plan keeps the CTA actionable (default id is `free` for all).
- `plans.json` (`PL1 Owner Basic`, `PL2 Owner Plus`, `PL3 Owner Pro`, `PL4 Seeker Plus`) is the
  data-model catalog; note prices there (999/2499/199) match the fee defaults but the runtime plan
  ids differ (`owner2`/`owner5`/`seeker-plus`).

### Platform fees (`store/billing.js`)
- Single source of truth = admin DB `settings.fees` (read via `rawDb()`), with a legacy
  `puneNestAdminDB_v7` fallback, over `FEE_DEFAULTS = { ownerPlanYearly: 999, ownerProYearly: 2499,
  rentAgreementPlatform: 500, seekerPlusTopup: 199, featuredListing: 999, gstPercent: 18,
  rentPayPercent: 2 }`. `fee(key)` formats as `Rs N` (`en-IN`).
- (Note: `data-model.md` shows a different sample `ownerPlanYearly` value; the
  authoritative default in code is 999, overridable by admin settings.)

### Entitlements / gating (`store/billing.js`)
- **Listing quota:** `PLAN_LISTING_LIMITS = { free: 1, 'owner-free': 1, owner2: 2, owner5: 5 }`.
  `listingLimit()` returns the cap (default 1). `activeListingCount()` = the user's non-deleted /
  non-archived property listings (excludes flatmate posts). `canPostListing()` =
  `activeListingCount() < listingLimit()` - the paywall enforced in the List-Property wizard. Editing
  an existing listing never consumes quota; only a genuinely new property does.
- **Featuring/boost:** `PAID_OWNER_PLANS = ['owner2', 'owner5']`; `isPaidOwnerPlan()` gates self-serve
  promotion. Free plans (`free`/`owner-free`) must upgrade first (MyListingsPanel "Feature" action).
  `boostListing(id, days=7)` writes an expiry to `pnBoosts:<mobile>`; `isBoosted(id)` = expiry >
  `Date.now()`.
- Seeker Plus entitlement ("15 owner contacts") is thematic in the prototype - not enforced as a hard
  counter in this layer.

### Checkout (`Checkout.jsx`)
- Reads `?plan=` (`seeker-plus` | `owner2` | `owner5`); unknown -> `Navigate('/plans')`. Requires
  sign-in -> else redirect to `/signin?next=/checkout?plan=...`.
- `pay()` simulates a gateway round-trip (`setTimeout 900ms`), then: for `kind: 'plan'` calls
  `setPlan({ id: planId, name: P.planName })`; always records a `service_order` via `addServiceOrder({
  type: plan?'subscription':'topup', plan, title, amount, method })` and shows the order ref.
- **Re-purchase guard:** `alreadyOnThisPlan = kind==='plan' && !paid && getPlan().id === planId`
  short-circuits to an "already active" screen. Subscriptions persist via `getPlan()`; the one-time
  Seeker Plus top-up has no lasting ownership, so it stays **re-purchasable**.
- Payment methods: `UPI` (default), `Card`, `Netbanking`. Taxes shown as "included" (GST is a fee
  field, not added on top here). Prototype does not take real payment.

### Billing view (`BillingPanel.jsx`)
- Current plan from `getPlan()` (single source of truth, not inferred from inventory). Sub-line
  depends on `isPaidOwnerPlan()` / `isOwner`. Payment history is the static `BILLING_HISTORY` seed
  (`INV-2041` owner yearly Rs 999, `INV-1980` featured Rs 999, `INV-1899` rent agreement Rs 500, all
  "Paid"). "Change plan ->" links to `/plans`.

### Referral program (`Refer.jsx` + `store/referrals.js`)
- **Code:** `referralCode()` = up-to-4 uppercase letters from the user's name (else `PUNE`) + last 4
  digits of mobile (or a random 4-digit number), persisted at `pnReferralCode:<mobile>`.
- **Link:** `referralLink(code)` = `<origin>/signup?ref=<code>` (drives `?ref` capture on signup).
- **Stats:** `pnReferralStats:<mobile> = { invited, joined, listed }`. `addReferralInvite` /
  `addReferralJoin` / `addReferralListing` increment.
- **Invite counting is honest:** only a genuine share counts (`shareNative` on OS share success, or
  `shareWA` opening WhatsApp). **Copying the code/link does NOT count** an invite (would inflate a
  vanity metric).
- **Reward rules (targets in code):**
  - `referralListingsTarget = 3` - **owner track:** every 3 referred friends who LIST a property = 1
    free rent agreement. `referralFreeAgreements() = floor(listed / 3)`. The progress bar shows
    `listed % 3 / 3`.
  - `referralContactsPerReward = 15`, `referralJoinsTarget = 1` - **seeker track:** each referred
    friend who JOINS/searches = +15 owner contacts. `referralContactsEarned() = floor(joined / 1) *
    15` (i.e. 15 per join).
- **Attribution honesty:** `setReferredBy(code)` records who referred a new signup
  (`pnReferredBy:<mobile>`) but **does NOT credit the referrer's counters** - real cross-device
  attribution needs a backend. So in the prototype the referrer's stats only move via their own
  device actions.

### Referral fraud signals (seed `referrals.json`)
Each seeded referral carries the fields an ops fraud queue scores on: `risk` (low/high), `channel`
(owner/seeker), `reward`, `aadhaarVerified`, `aadhaarUnique`, `sameDevice`, `sameIp`, `velocityHigh`,
`activated`, and `status` (`qualified` -> `rewarded`, or `pending`/`flagged`/`rejected`), plus
`handledBy`/`handledAt`. These drive the admin/ops referrals-fraud review (self-clone, duplicate
Aadhaar, same-device/IP, high velocity = flagged/rejected). The Aadhaar check here is a **reward-payout
uniqueness** guard (`identity_hash`), part of the opt-in reward flow (L2/L3) — **not** a browse/post/
contact gate, which stay at L1 mobile (ADR-019).

## 6. Maker-checker / approval
- **Plans/checkout:** no maker-checker (self-serve purchase).
- **Referral rewards:** effectively maker-checker at the ops layer - the consumer records the
  invite/join/listing (maker), but qualifying and paying out a reward is gated by fraud review
  (checker) before `status` moves to `qualified`/`rewarded`. See
  [`../ops/referrals-fraud.md`](../ops/referrals-fraud.md) (planned) and
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.

## 7. State machine
```
User plan:      free/owner-free  --Checkout pay (owner2/owner5)-->  paid (persists via pnPlan)
                seeker-plus: one-time top-up, no lasting plan state (re-purchasable)
Checkout:       select plan -> (guard: alreadyOnThisPlan?) -> paying -> paid (order ref)
Boost:          none --boostListing(days)--> boosted until expiry --(time)--> expired
Referral:       (per RF row) pending -> qualified -> rewarded
                            \-> flagged -> rejected   (fraud signals)
```

## 8. Edge cases, validation & error states
- **Unknown/missing `?plan=`** -> redirect to `/plans`. **Signed-out checkout** -> redirect to signin
  with `next`.
- **Already on a paid plan** -> both Plans (locked CTA) and Checkout (already-active screen) prevent
  double-purchase; Seeker Plus stays re-purchasable by design.
- **Listing paywall:** `canPostListing()` false -> the wizard blocks a new listing and routes to
  upgrade (quota by plan).
- **Featuring on a free plan:** blocked by `isPaidOwnerPlan()`; user prompted to upgrade.
- **Referral vanity guard:** copy != invite; OS-share cancel != invite (`shareNative` only counts on
  success).
- **Cross-device attribution gap:** referrer counters do not move from a friend's signup on another
  device - honest limitation flagged for the backend.
- **Fee source fallback:** if the admin DB is unreadable, fees fall back to `FEE_DEFAULTS` (never
  zero/blank).
- **Prototype payments** are simulated; the success screen still renders for a purchase just made this
  session (guard is `!paid`).
