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

### Entitlements / gating
- **Listing quota (server-side since D234).** The plan's cap lives in `plans.listing_limit`
  (`free`/`owner-free` = 1, `owner2` = 2, `owner5` = 5) and the referral bonus is derived from
  qualified referrals; `GET /me/entitlements` returns their sum as `listings.allowance`, alongside
  the `listings.referralBonus` already contained in it. The count measured against it is
  `GET /me/listings` filtered to the statuses that occupy a slot — pending, approved, flagged, sold,
  rented. **Rejected does not count**: a listing moderation refused is not occupying anything the
  owner can use, and charging a slot for it would let a moderator permanently spend a free-tier
  owner's whole allowance. Flatmate posts never consume quota, and editing an existing listing never
  does either — only a genuinely new property.

  The refusal is a **422 `listing_quota_exhausted`** from `POST /me/listings`, whose message names
  the arithmetic ("You already have 1 of 1 listings live"). The wizard's paywall
  (`lib/data/listingQuota.js`) is a **mirror** of that gate, there so the owner sees the ceiling
  before filling in three steps of a form; every failure path in it is permissive, because the
  server says no anyway.

  This replaces `canPostListing()` in `lib/store/billing.js`, which compared a count of the listings
  *this browser's localStorage happened to hold* against a limit that added a locally-minted
  referral bonus. Both halves were a browser's opinion and they were wrong in opposite directions:
  an owner who posted from their laptop and opened the wizard on their phone had a used-count of
  zero, while an owner who cleared site data lost slots they had genuinely earned. The endpoint
  itself accepted any number of listings from anyone, so the paywall was in practice a paywall
  against clearing your cookies.

  **The exit is `DELETE /me/listings/{id}`** — the owner takes their own listing down, soft-archived
  with the reason recorded, and the slot is free immediately. It had to be built alongside the gate:
  `ListingUpdate` deliberately omits `status` so a `PATCH` cannot self-escalate, so before D234 an
  owner had no way back under the ceiling at all, and the new limit would have meant one listing
  *ever*. There is no button for it yet; the endpoint is ahead of the UI.
- **Featuring/boost:** `PAID_OWNER_PLANS = ['owner2', 'owner5']`; `isPaidOwnerPlan()` gates self-serve
  promotion. Free plans (`free`/`owner-free`) must upgrade first (MyListingsPanel "Feature" action).
  `boostListing(id, days=7)` writes an expiry to `pnBoosts:<mobile>`; `isBoosted(id)` = expiry >
  `Date.now()`.
- **Owner-contact quota (server-side since D31b).** The free tier is 15 owner contacts
  (`settings.fees.freeContactLimit`), a "contact" is the right to open one `contact_requests` row,
  and the three priced plans carry `plans.unlimited_contacts = true` (V91). The numbers are read
  from `GET /me/entitlements`; the refusal is a **422 `contact_quota_exhausted`** from
  `POST /contacts/request`. `used` is `count(contact_requests where requester = me)` rather than a
  stored counter, so a repeat press on the same listing costs nothing and a refused press costs
  nothing. This replaces the old `lib/store/contactQuota.js` — a `pnContactsUsed:<mobile>` counter
  that the browser wrote, added a locally-minted referral bonus to, and enforced *before* making any
  request. Clearing site data restored it in full and a second device never knew about the first.
  The old module now lives at `services/providers/mock/contactQuota.js`, where it is the **mock
  server's** state and is not importable from `lib/store.js`.

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

> **Corrected 2026 (D233).** The two bullets below used to read, without qualification:
>
> > **Code:** `referralCode()` = up-to-4 uppercase letters from the user's name (else `PUNE`) + last
> > 4 digits of mobile (or a random 4-digit number), persisted at `pnReferralCode:<mobile>`.
> >
> > **Stats:** `pnReferralStats:<mobile> = { invited, joined, listed }`.
>
> That described the whole product, and it was the bug. The server mints its own permanent code in
> `referral_codes` (V23), format `PUNE-AB12`, and `POST /referrals/redeem` resolves only that one —
> so every link the product produced pointed at a scheme that could not recognise it. `Refer.jsx`
> now reads `code` and `invited` from `GET /me/referrals`. What is described below is the **mock
> build's** behaviour, which is also what the mock provider serves.

- **Code (mock build):** `referralCode()` = up-to-4 uppercase letters from the user's name (else
  `PUNE`) + last 4 digits of mobile (or a random 4-digit number), persisted at
  `pnReferralCode:<mobile>`. Deliberately **not** reshaped to imitate the server's `PUNE-AB12`: on a
  mock build there is no server to agree with, and a code that passes for real is worse than one
  that is visibly its own.
- **Code (live build):** `GET /me/referrals` → `{ code, invited, converted, contactsEarned,
  contactsPending }`. The page renders nothing in the share card until it resolves, because a Copy
  button that writes `""` and then reports "Copied" is the quiet kind of wrong.
- **Link:** `referralLink(code)` = `<origin>/signup?ref=<code>` (drives `?ref` capture on signup).
- **Redemption:** `Signup.jsx` calls `POST /referrals/redeem` when a `?ref=` is present, alongside
  the local `setReferredBy`. Un-awaited and silent on failure — a 409 means the code was unknown,
  self-referred or already used, none of which the new account holder chose or can fix.
- **Stats:** the whole progress narrative is the server's since D234. `invited` is
  `ReferralSummaryDto.invited` (people who have redeemed the code), `listed` is `converted` (those
  that qualified or were approved). `pnReferralStats:<mobile> = { invited, joined, listed }` survives
  only as the **mock provider's** own state — read by `providers/mock/{contactQuota,referralProvider}`
  and seeded directly by the e2e harness, written by nothing. Its incrementers are gone:
  `addReferralInvite` counted button presses under the name "You've invited N", and
  `addReferralJoin` / `addReferralListing` were ungated ways to mint quota that nothing ever called.
- **Invite counting is honest:** a share opens WhatsApp or the OS sheet and then simply re-reads
  `GET /me/referrals`. Nothing this page does to itself moves the number — previously a completed
  share bumped a local tally, which drifted further from the truth the more the page was used.
  Copying the code or link has never counted, for the same reason.
- **Reward rules (targets in code):**
  - `referralListingsTarget = 3` — **owner track:** every 3 qualified referrals = 1 free rent
    agreement, reported as `agreements.free` on `GET /me/entitlements` and derived per request like
    every other bonus, so a clawback takes it back. The progress bar shows `converted % 3 / 3`.
    Until D234 this was `floor(listed / 3)` over a localStorage counter — it survived clawbacks and
    could be re-minted by clearing site data. **There is no `used` or `remaining`**, deliberately:
    agreements are not sold through this codebase yet, so a consumption tally would be a number
    nothing decrements. `REFERRALS_PER_FREE_AGREEMENT` is a separate constant from
    `REFERRALS_PER_LISTING_SLOT` even though both are 3, because they are two offers sharing a
    divisor rather than one offer read twice.
  - `referralContactsPerReward = 15` - **seeker track:** each qualified referral = **+15 owner
    contacts**, and since D31b that grant is the server's. `GET /me/entitlements` reports
    `contacts.referralBonus`, derived as `count(referrals that are qualified or rewarded) ×
    settings.fees.referralContactBonus` — recomputed on every read rather than added to a balance,
    which is what makes a clawback whole: there is no grant to reverse. The listing-slot bonus is
    `count / 3` from the same read.
  - **Currency, settled (D31b).** The server used to pay ₹500 of platform credit, which nothing could
    be spent on, while this page granted quota — "two different currencies, and no arithmetic turns
    one into the other" (register item 31). It was closed by moving the server onto the browser's
    unit rather than the reverse: `referrals.reward_amount` is now a **count of owner contacts** and
    `reward` reads `"+15 owner contacts"`. `settings.fees.referralReward` is gone; `freeContactLimit`
    and `referralContactBonus` replace it.
- **Attribution honesty:** `setReferredBy(code)` records who referred a new signup
  (`pnReferredBy:<mobile>`) and deliberately credits nobody. `POST /referrals/redeem` carries the
  attribution, and `ReferralQualification` credits the referrer when the referee's first listing
  passes ownership verification — "the only qualifying action a browser cannot fake". D234 removed
  the browser-side credit ledger that used to sit alongside it (`creditReferrerForJoin` on signup,
  `creditReferrerForListing` on a first post, drained by `claimReferralCredits()` in `AuthContext`):
  it granted quota on the same machine that spent it, paid twice if the referee posted from a second
  device, and went on paying forever after the fraud desk clawed the referral back.

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
- **Listing paywall:** the wizard blocks a new listing and routes to upgrade when
  `GET /me/listings` count ≥ `GET /me/entitlements` allowance; `POST /me/listings` refuses it with
  `422 listing_quota_exhausted` regardless of what the wizard did.
- **Featuring on a free plan:** blocked by `isPaidOwnerPlan()`; user prompted to upgrade.
- **Referral vanity guard:** nothing the page does moves the invite count — it is the server's count
  of redeemed codes, so neither a copy nor a completed share nor a cancelled OS share can inflate it.
- **Cross-device attribution:** closed. Referrer counters and every earned balance are derived from
  the server's referral rows, so a friend signing up on another device counts and clearing site data
  loses nothing.
- **Fee source fallback:** if the admin DB is unreadable, fees fall back to `FEE_DEFAULTS` (never
  zero/blank).
- **Prototype payments** are simulated; the success screen still renders for a purchase just made this
  session (guard is `!paid`).
