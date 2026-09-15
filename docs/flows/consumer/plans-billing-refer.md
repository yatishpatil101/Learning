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
- User plan (runtime `dzPlan:<mobile>`, ids `free`/`owner-free`/`owner2`/`owner5`) - read + written
  by Checkout (`setPlan`).
- Platform fees / `settings.fees` (admin DB, read via `getFees`) - read.
- `service_orders` (runtime `dzServiceOrders:<mobile>`) - created by Checkout (`addServiceOrder`).
- Owner boosts (runtime `dzBoosts:<mobile>`) - entitlement gate for featuring.
- `referrals` (seed `referrals.json`, `RF3###`; runtime stats `dzReferralStats:<mobile>`) - read +
  incremented; plus `dzReferralCode:<mobile>` and `dzReferredBy:<mobile>` capture.
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
  `draazyAdminDB_v7` fallback, over `FEE_DEFAULTS = { ownerPlanYearly: 999, ownerProYearly: 2499,
  rentAgreementPlatform: 500, seekerPlusTopup: 199, featuredListing: 999, gstPercent: 18 }`.
  `fee(key)` formats as `Rs N` (`en-IN`).
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
  `boostListing(id, days=7)` writes an expiry to `dzBoosts:<mobile>`; `isBoosted(id)` = expiry >
  `Date.now()`.
- **Owner-contact quota (server-side since D31b).** The free tier is 15 owner contacts
  (`settings.fees.freeContactLimit`), a "contact" is the right to open one `contact_requests` row,
  and the three priced plans carry `plans.unlimited_contacts = true` (V91). The numbers are read
  from `GET /me/entitlements`; the refusal is a **422 `contact_quota_exhausted`** from
  `POST /contacts/request`. `used` is `count(contact_requests where requester = me)` rather than a
  stored counter, so a repeat press on the same listing costs nothing and a refused press costs
  nothing. This replaces the old `lib/store/contactQuota.js` — a `dzContactsUsed:<mobile>` counter
  that the browser wrote, added a locally-minted referral bonus to, and enforced *before* making any
  request. Clearing site data restored it in full and a second device never knew about the first.
  The old module now lives at `services/providers/mock/contactQuota.js`, where it is the **mock
  server's** state. It was never importable from the `lib/store.js` barrel, which has itself since
  been deleted — its last two importers now name the `lib/store/*` slices directly.

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

### The Cashfree webhook signature (`WebhookSignature`)

HMAC-SHA256 is the only thing between "this order was paid" and "anyone on the internet can grant
themselves a paid plan".

- **Signed material is `x-webhook-timestamp + rawBody`,** in that order, no separator. The timestamp
  is inside the signature so a captured payload cannot be re-signed under a different time, and the
  body must be the *raw* bytes: parsing and re-serialising JSON reorders keys and normalises
  whitespace, which changes the digest and would make every genuine callback look forged.
- **A ±5 minute freshness window.** The signature proves authenticity, not freshness; without a
  window a payload captured once is replayable forever.
- **Constant-time comparison,** so a valid signature cannot be recovered byte by byte from timing.
- **A blank secret is rejected at construction.** An empty HMAC key still produces a perfectly valid,
  publicly-computable signature, so `CASHFREE_WEBHOOK_SECRET=""` would turn verification into a
  formality rather than failing loudly.
- **The committed default refuses to boot in two situations.** Either the live gateway is switched on
  under any profile — real money on a published key is the same mistake whether or not the profile is
  called prod — or any profile other than `local` is active, gateway flag or not. The second arm is
  an allowlist rather than a check for `prod`, because a container named `staging`, `preview` or
  nothing at all is the ordinary state of a first deploy. The webhook route is `permitAll` and gets
  its own rate-limit budget rather than an exemption — 50× the write allowance, sized for a provider
  replaying a backlog, since it can neither share a bucket with users nor be exempt while anonymous
  (the enabled flag gates only the *outbound* client) — so anyone holding
  this repository could sign a `PAYMENT_SUCCESS` for an order id the API had just handed them. Both
  arms still apply under `dev`: pointing at the Cashfree sandbox means receiving callbacks from
  outside the machine. The reason is returned as a string, not a boolean, so the boot failure names
  which trigger fired.
- **A failed verification answers 200 and drops the payload**, telling a prober nothing — but it no
  longer tells *us* nothing either. The refusal is a named reason, not a boolean: `MISSING_HEADER`
  (not a Cashfree call at all), `MALFORMED` (a non-numeric timestamp or a non-Base64 signature),
  `MISMATCH` (well-formed, wrong key) and `STALE` (correctly signed, outside the five-minute
  window). The undifferentiated "not verified" this replaces is what made the timestamp-unit bug
  expensive: it named the secret as the suspect while the secret was correct.
  Freshness is checked *after* the HMAC, so `STALE` means "we signed this" and is the one refusal
  logged at `error` — an anonymous caller cannot manufacture it, and a genuine callback refused on
  the clock is money that will not be reconciled. `MISMATCH` is `warn` precisely because anyone can
  reach it. A crypto failure is no longer in this list at all: an unavailable HMAC-SHA256 is a fault
  in this JVM, not a bad callback, so it throws rather than posing as the sender's mistake.
- **The address Cashfree posts to is sent per order** as `order_meta.notify_url`, from
  `CASHFREE_NOTIFY_URL`, rather than relying on the single endpoint the dashboard holds. It is
  validated at boot as an absolute `https` URL — blank is legal and means "use the dashboard
  endpoint" — so a cleartext or relative address is a startup failure instead of a silent
  non-delivery.

`application-prod.properties` separately binds a bare `${CASHFREE_WEBHOOK_SECRET}`, so a prod boot
with the variable unset fails in the binder first — but that only fires for a deploy naming `prod`
and reading that file; the constructor check is what states the rule.

### Billing view (`BillingPanel.jsx`)
- Current plan from `getPlan()` (single source of truth, not inferred from inventory). Sub-line
  depends on `isPaidOwnerPlan()` / `isOwner`. Payment history is the static `BILLING_HISTORY` seed
  (`INV-2041` owner yearly Rs 999, `INV-1980` featured Rs 999, `INV-1899` rent agreement Rs 500, all
  "Paid"). "Change plan ->" links to `/plans`.

### Referral program (`Refer.jsx` + `store/referrals.js`)

> **Corrected 2026 (D233).** The two bullets below used to read, without qualification:
>
> > **Code:** `referralCode()` = up-to-4 uppercase letters from the user's name (else `PUNE`) + last
> > 4 digits of mobile (or a random 4-digit number), persisted at `dzReferralCode:<mobile>`.
> >
> > **Stats:** `dzReferralStats:<mobile> = { invited, joined, listed }`.
>
> That described the whole product, and it was the bug. The server mints its own permanent code in
> `referral_codes` (V23), format `PUNE-AB12`, and `POST /referrals/redeem` resolves only that one —
> so every link the product produced pointed at a scheme that could not recognise it. `Refer.jsx`
> now reads `code` and `invited` from `GET /me/referrals`. What is described below is the **mock
> build's** behaviour, which is also what the mock provider serves.

- **Code (mock build):** `referralCode()` = up-to-4 uppercase letters from the user's name (else
  `PUNE`) + last 4 digits of mobile (or a random 4-digit number), persisted at
  `dzReferralCode:<mobile>`. Deliberately **not** reshaped to imitate the server's `PUNE-AB12`: on a
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
  that qualified or were approved). `dzReferralStats:<mobile> = { invited, joined, listed }` survives
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
  (`dzReferredBy:<mobile>`) and deliberately credits nobody. `POST /referrals/redeem` carries the
  attribution, and `ReferralQualification` credits the referrer when the referee's first listing
  passes ownership verification — "the only qualifying action a browser cannot fake". D234 removed
  the browser-side credit ledger that used to sit alongside it (`creditReferrerForJoin` on signup,
  `creditReferrerForListing` on a first post, drained by `claimReferralCredits()` in `AuthContext`):
  it granted quota on the same machine that spent it, paid twice if the referee posted from a second
  device, and went on paying forever after the fraud desk clawed the referral back.

### Referral fraud signals
Each referral carries the fields an ops fraud queue scores on: `risk` (low/high), `channel`
(owner/seeker), `reward`, `identityVerified`, `identityUnique`, `sameDevice`, `sameIp`, `velocityHigh`,
`activated`, and `status` (`qualified` -> `rewarded`, or `pending`/`flagged`/`rejected`), plus
`handledBy`/`handledAt`. These drive the admin/ops referrals-fraud review (self-clone, the same
document behind two accounts, same-device/IP, high velocity = flagged/rejected). The identity check
here is a **reward-payout uniqueness** guard (`identity_hash`), part of the opt-in reward flow (L2/L3)
— **not** a browse/post/contact gate, which stay at L1 mobile (ADR-019).

## 6. Maker-checker / approval
- **Plans/checkout:** no maker-checker (self-serve purchase).
- **Referral rewards:** effectively maker-checker at the ops layer - the consumer records the
  invite/join/listing (maker), but qualifying and paying out a reward is gated by fraud review
  (checker) before `status` moves to `qualified`/`rewarded`. See
  [`../ops/referrals-fraud.md`](../ops/referrals-fraud.md) (planned) and
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.

## 7. State machine
```
User plan:      free/owner-free  --Checkout pay (owner2/owner5)-->  paid (persists via dzPlan)
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


## Appendix: entitlement and plan-model rationale (moved from source Javadoc)

### Entitlements are derived, not stored
`EntitlementService` computes every allowance on each call from rows that already exist for other
reasons: the caller's subscription and the `granting` referrals count. There is no allowance
column, no balance, no grant ledger. A stored balance has to be written by every code path that
could change it and is wrong forever the first time one of them forgets; a derived balance is
right by construction, and a clawed-back referral withdraws its contacts the moment the fraud
desk records the decision — with no compensating write to remember.

This replaced a quota that lived in `localStorage` under a key derived from the caller's own
mobile, computed by a module whose header said in as many words that it was not real security.
The referral bonus that topped it up was computed the same way, from counters the client
incremented for itself, which meant the referral scheme paid out a reward the platform never
actually granted.

`EntitlementService` implements `ContactAllowanceLookup` (consumed by `leads`) and consumes
`ContactUsageLookup` from `leads`. Neither feature imports the other; both import the kernel.

### The reward "ledger" is the referrals table itself
Approve and clawback are described as crediting and debiting a ledger; that ledger is
`sum(reward_amount) group by status`. A separate double-entry table was considered and rejected:
nothing external moves this rail, the amount is frozen on the row at redemption, and every
mutation carries who, when and why. `finance.ledger.Transaction` is the **user's own** rent-and-
expense book and would be actively wrong as a home for platform-side credits.

### Free tier is a settings value, not a plan row
A caller with no subscription has nothing in `plans` to read, so `SubscriptionService#entitlingPlan`
returning empty is the normal case rather than an error. The defaults in `EntitlementService`
(`DEFAULT_FREE_LISTING_LIMIT = 1`) are what "no purchase" is worth. Seeding a synthetic Owner
Free row into every entitlement check was the alternative and was rejected: it would put the free
tier on the public pricing list as a thing to subscribe to.

`DEFAULT_FREE_LISTING_LIMIT` mirrors `listing_limit` on the seeded Owner Free plan but is
duplicated as a constant because the free tier is defined by the *absence* of a subscription.
It is also what a plan with a `null` `listing_limit` is worth: `Optional.map` over a null column
collapses to empty and lands on this same default, so a null limit grants the free floor rather
than lifting the ceiling — the safe direction, and the one V24 writes down.

### Referral bonuses
`REFERRALS_PER_LISTING_SLOT = 3` matches the "refer three owners, list one free" offer. Integer
division: the fourth referral earns nothing extra until the sixth — the offer is a whole slot or
none.

`REFERRALS_PER_FREE_AGREEMENT = 3` matches the "refer three, get an agreement free" track. It is
a separate constant from the listing one even though the values are equal today: they are two
offers, and pricing may move either without meaning to move the other.

`forUser` computes both halves together so the contact and listing sides come from one plan read
and one referral count. Splitting into two endpoints would run the same two queries twice and
could straddle a change between them. The unlimited-contacts branch still reports the bonus: a
subscriber who also referred people has earned those contacts, and hiding the number while the
plan makes it moot would make the Refer page look broken to exactly the users who used it most.
It reappears the day they downgrade.

`listingAllowance` / `contactAllowance` are narrower than `forUser` because each gate is about to
count the caller's own usage anyway and does not need the other halves. `contactAllowance`
deliberately does not call `forUser` and read one field: doing so would make every contact
request pay for a count of the caller's own contact requests that the gate does not use.

### `converted` counts what pays, not what a human blessed (D31b)
`ReferralSummaryDto.converted` used to mean `rewarded` alone, which was correct while a checker
was the only thing releasing a reward. Now that `QUALIFIED` grants on its own, a referrer whose
friend has verified a listing would otherwise read "0 converted" beside fifteen contacts they can
already spend. The two numbers on the Refer screen have to be able to explain each other.

### Referral scheme: automatic qualification (Q17, D31b)
The reward is owner contacts, not money (D31b). Redemption stamps a label and a magnitude onto
the row and those two are what the fraud desk reads and the audit trail records; nothing here
pays anything out. The referrer's actual entitlement is derived from these rows by
`billing.entitlement`, by counting the ones `ReferralStatuses#isGranting` accepts.

Q17's automatic `QUALIFIED` transition — the referee's first listing passing ownership
verification — used to be a hint for the checker and is now the grant point. `approve` still
matters: a fraud desk uses it to bless a referral that did not qualify on its own, and `clawback`
takes a grant back. What changed is that an honest referrer no longer waits in a queue for
something the platform already verified for itself. The exposure is bounded by the D61 monthly
cap and by what is being handed over: the right to ask fifteen owners a question.

### Plan model
`Plan` maps `plans` (V8), seeded as reference data. Read-only from the app's point of view:
nothing creates or edits a plan, because a price list is a business decision made in the back
office and a migration. Plan administration belongs under `/admin/` with an audit trail. A
`price` of zero is a real plan, not a missing one — "Owner Free" is what every owner is on until
they upgrade, and `SubscriptionService` keys the entire payment decision off this being zero.

`Plan.listingLimit` is the paywall's real ceiling, kept as a number rather than parsed out of
`features` prose (D109). `null` means the plan grants no listing allowance of its own; every
reader resolves it to the free-tier floor of one. It is not a licence: an effectively uncapped
plan states a large number, and V24's CHECK forbids an owner plan from leaving it unstated at all.

`Plan.unlimitedContacts` (V91, D31b) is a separate column from `contactLimit` rather than a
convention over it, because `contactLimit` is nullable and its own comment admits `null` means
"unlimited or not-applicable" — two different answers stored identically, which is exactly the
question an entitlement check asks. `contactLimit` stayed as display data on the pricing page;
nothing reads it to decide anything. `unlimitedContacts` is `false` on Owner Free and `true` on
the three priced plans. Set from seeded ids rather than from `price > 0`: priced and unlimited
coincide today but are two decisions, and a promotional free month must not withdraw the
entitlement it is promoting.

### Contract DTOs
`PlanDto` mirrors `plans` on the wire: `price` is whole rupees per `billingCycle` (`0` is the
free tier); `listingLimit` resolves to the free-tier floor of one when null and is never
unlimited; `contactLimit` is null for unlimited / not-applicable.

`ReferralDto` is the admin/ops fraud-desk view (spec fixes S52, S53, S54). Both mobiles are
masked because it is a paginated privileged list, following the same rule as `UserAdminService`
— unmasked reads are a separate, audited, single-record operation the contract does not declare
for referrals. `rewardAmount` is a count of owner contacts, not money (was rupees pre-D31b — see
`Referral` rationale for the two-era column). `channel` is which side the referred party joined
on (not `shareChannel`, which is how the link travelled — D60). `sameDevice` / `sameIp` false
means "no evidence", never "proved different" — a code minted before V64 or a request without a
User-Agent produces no digest. `qualifiedAt` (Q17) is null until the referee's first listing
passes ownership verification.
