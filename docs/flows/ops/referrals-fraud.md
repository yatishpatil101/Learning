# Flow: Ops Referral Verification (fraud-review queue)

> The ops desk that keeps the refer-a-friend program honest. Every referral lands here as a
> record with background-check signals; a reviewer approves (release reward), rejects, or claws
> back - the **reward payout** is gated on identity verification + uniqueness. Under **ADR-019
> (badge-not-gate)** this identity/uniqueness check is legitimate here because it guards **money at
> risk (a reward payout)** inside the opt-in reward flow (L2/L3) — it is **not** a browse/post/contact
> gate (those stay at L1 mobile; see [`../../system/platform-architecture.md`](../../system/platform-architecture.md) §6.4 / ADR-019).
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) · **live-only
> since wave 2c (2026-08-14)** - **Primary role(s):** ops staff / admin (any ops user)

> **The identity gate is the server's rule now.** Until wave 2c it existed only as a greyed-out
> button in the browser, under the banner above calling it mandatory, while
> `POST /referrals/{id}/approve` released the money to anyone who called it. `ReferralService.approve`
> now refuses with a 409 naming the reason, and the button is a mirror.

---

## 1. Purpose & user problem
- **Persona:** an ops/trust reviewer responsible for the referral rewards budget.
- **Job-to-be-done:** "Before we pay a referral reward, confirm the referred user is a real,
  identity-verified, unique person - and flag self-referrals, duplicate-device, and reward-farming
  before any credit is released."
- **Why it matters:** referral rewards (owner contacts, free rent agreements) are a real cost and
  a classic fraud target. This queue is the checker gate between "invite sent" and "reward paid".
  It pairs with the consumer refer-a-friend flow in
  [`../consumer/plans-billing-refer.md`](../consumer/plans-billing-refer.md).

## 2. Entry points
- **Route:** `/ops/referrals` (under `RoleRoute roles=['staff','admin']` + `AdminLayout variant="ops"`;
  **no** `TeamRoute`, so any ops user can open it - it is not scoped to a single team).
- **Tiles / triggers:** the ops sidebar "Referrals" item (`AdminLayout`), the admin command-palette
  entry "Referrals (Ops)" (`AdminTopbarTools`), and the four stat cards on the page (which double as
  tab switches).
- **Source components:**
  - `src/pages/ops/OpsReferrals.jsx` - the entire queue (stats, tabs, table, actions, export).
  - Data: `src/services/referralService.js` → `providers/http/referralProvider.js` → `GET /referrals`
    and the three decision endpoints.

  - **The funnel had no entrance until D233.** `POST /referrals/redeem` had shipped and nothing in
    the product called it: `Refer.jsx` minted its own code in the browser, so the codes users
    shared were strings the server could not resolve, and every row this desk has ever reviewed was
    seeded. `Signup.jsx` now redeems on `?ref=`.

## 3. Actors & roles
- **Any ops user (staff or admin)** can review referrals - unlike the service desks, there is **no**
  team gate on this route. All referral records are visible to every ops user.
- **Reviewer actions** are the same for all: Approve, Reject, Clawback.
- See [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1 for the role model.
  As with all ops guards, this is UX-only and MUST be re-enforced server-side (section 11).

## 4. Entities touched
Link definitions: [`../../system/data-model.md`](../../system/data-model.md).

- **Referral** (`referrals` in Postgres, read through `referralService.js`) - read (list) and
  updated (status + `handledBy` + `handledAt`). Never hard-deleted; state is a status flag. Fields
  as they arrive on `ReferralDto`:
  - Identity: `id` (UUID, not `RF####`), `referrer` (name) + `referrerMobile`, `referred` (name) +
    `referredMobile`, `channel` (`seeker` | `owner`), `shareChannel`.
  - **Both mobiles are masked, and stay masked.** A privileged *list* is masked platform-wide, and
    the contract declares no unmasked single-record read for referrals — so a checker decides on
    the signals, which are computed server-side from the unmasked data. The checker sees the
    finding without seeing the evidence.
  - Reward: `reward` (human string, `"+15 owner contacts"`) and `rewardAmount` (an integer **count of
    owner contacts**, from `settings.fees.referralContactBonus` at redeem time). Since **D31b** the
    reward is not money: it was ₹500 of platform credit, which nothing could be spent on, and is now
    the unit the scheme always advertised. Surfaced to the referrer as `contactsEarned` /
    `contactsPending` on `GET /me/referrals`, and as spendable balance on `GET /me/entitlements`.
    Do not format `rewardAmount` as currency.
  - Signals: `identityVerified`, `identityUnique`, `activated`, `sameDevice`, `sameIp`,
    `velocityHigh` (booleans); `risk` (`low | medium | high`, computed by `ReferralService.risk`).
    `identity_verified` and `identity_unique` are `updatable = false` — they are a snapshot of the
    redeem moment, which is why the approve gate reads the referred party's *current* badge
    instead (§5.2).
  - Lifecycle: `status`, `at` (redeemed), `qualifiedAt`, `handledBy`, `handledAt`.
- **The referrer's reward balance** - owner contacts, reported by `GET /me/entitlements` and derived
  from the referrals that justify it on every read (`count(qualified or rewarded) ×
  settings.fees.referralContactBonus`). There is no balance column and no grant ledger, which is
  precisely what makes **clawback** whole: reversing the referral reverses the contacts, with nothing
to un-increment by hand.

## 5. Business rules & logic  *(the meat)*

### 5.1 Background-check signals
Rendered as pills (`SIGNALS` in `OpsReferrals.jsx`). Each has a "good when true" polarity:

| Signal | Field | Good when | Meaning if bad |
|--------|-------|-----------|----------------|
| Identity verified | `identityVerified` | present | referred user holds no reviewed Verified badge |
| Identity unique | `identityUnique` | present | that document is already verified on another account |
| Activated | `activated` | present | referred user never became active |
| Same device | `sameDevice` | absent | referrer and referred share a device fingerprint |
| Same IP | `sameIp` | absent | shared IP address |
| High velocity | `velocityHigh` | absent | burst of referrals in a short window (farming) |

A pill is green when the "good" condition holds, red otherwise. `risk` is computed by
`ReferralService.risk` from three inputs — velocity, the identity badge, and device/IP correlation —
and read, not derived, by the component.

Note what correlation does: it raises the band to `medium` rather than refusing anything. A couple
sharing a flat and a router is the platform's most common genuine referral, so device/IP
correlation is a reason for a human to look, which is what a risk band is.

### 5.2 The mandatory qualification gate
**The rule lives in `ReferralService.approve`.** Approving a referral whose referred party holds no
identity badge is answered `409` with:

> The referred party is not identity-verified, so this reward cannot be released.

The gate reads the referred party's **current** badge, via `UserRepository.findByMobile`, and not
the `identity_verified` column on the referral — that column is `updatable = false`, a snapshot of
the redeem moment, and the ordinary order of events is redeem first, verify later. Gating on the
snapshot would have permanently refused exactly the referrals the scheme exists for. **That gap is
now wider, not narrower:** the badge is granted by a human reviewer working a queue, so "verify
later" can mean hours later. A referee who is not in the user table at all is refused too: "cannot
check" is not "checked out".

The browser still greys the button out:
```js
function canQualify(r) { return !!(r.identityVerified && r.identityUnique); }
```
That is now a **mirror** of the server rule, sparing the desk a pointless round trip, rather than
the rule itself. `identityUnique` is checked alongside because the desk's banner promises both, even
though the server derives the second from the first (a second account cannot be approved against an
identity hash the platform already holds — `409 identity_already_registered`). The other signals
(device/IP/velocity) inform `risk` but do not by themselves block approval.

This gate applies **only to releasing a referral reward** — it never affects anyone's ability to
browse, post, or contact (those stay at L1 mobile, ADR-019). The uniqueness check is the same keyed
`identity_hash` invariant (ADR-009b) that caps one Verified badge per document, applied here
at the reward layer where money is at risk.

### 5.3 Buckets, tabs & stats
- **Stat cards:** Pending, High risk, Rewarded, Refused. **Tabs:** Pending, High risk, Rewarded,
  All. The first three cards double as tab switches.
- **Bucketing:**
  - Pending = `status === 'pending' || status === 'qualified'` — both are decidable.
  - High risk = `risk === 'high'`.
  - Rewarded = `status === 'rewarded'`.
  - Refused (card only) = `rejected` or `clawed-back`.
- **There is no Flagged tab.** `ReferralStatuses` has no `flagged`, so the old tab would have sat
  permanently empty — a fraud desk being told there is nothing suspicious. **High risk** asks the
  question it was reaching for, using a field the server already computes.
- The desk pulls a **window** of the 100 newest referrals and counts what is in hand. When the
  server's total is larger a banner says so, because a fraud queue that size is a queue with a
  problem and the desk should be told rather than shown the first hundred as if that were all.

### 5.4 Reviewer actions (`doAction`)
- **Approve** (shown for `pending` / `qualified`, enabled when `canQualify`):
  `POST /referrals/{id}/approve` → `rewarded`, and the server credits the referrer's rupee balance.
- **Reject** (shown for `pending` / `qualified`): `POST /referrals/{id}/reject` → `rejected`.
- **Clawback** (shown for `rewarded` only): `POST /referrals/{id}/clawback` → `clawed-back`.
- Both refusal endpoints accept an optional `reason`; a blank reason is sent as no body rather than
  as `""`.
- **A refusal is shown verbatim.** The server's 409 messages name the reason — an unverified
  referee, or a state this decision cannot be made from — and paraphrasing them in the browser
  would lose that. `ReferralService.decide` returns a *sentence* rather than a boolean for exactly
  this reason: its generic "Referral is pending and cannot be rewarded" is right for an illegal
  transition but actively misleading for the identity refusal, since `pending` *is* the state
  approve works from.
- `handledBy` and `handledAt` are stamped server-side.
- After any action the list reloads, moving the row into its new tab.

### 5.5 Reward release
- **The desk cannot address a referrer by phone number.** `referrerMobile` is masked and there is no
  unmasked read, so a reward grant keyed on the referrer's mobile is not available here and must not
  be attempted.
- **Corrected by D31b.** This section used to end "the server models the reward as money, not as a
  perk", and recorded the perk grant as intentionally dropped. That was the wrong half to drop. The
  perk was the product — owner contacts are what the scheme advertises — and the ₹500 of platform
  credit was a currency with nothing to spend it on. The server now pays owner contacts, so the
  grant is neither dropped nor device-local: approving moves the referral into a status
  `EntitlementService` counts, and the referrer's `GET /me/entitlements` reflects it on the next
  read. **Clawback** takes it back the same way, with no ledger entry to reverse.

### 5.6 Export
CSV of the current tab's rows including all six signals, the reward amount and the redeemed date
(`draazy-referrals.csv`).

## 6. Maker-checker / approval
Applicable - this queue is a checker gate. See
[`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.

- **Maker (proposer):** the **referrer** (and the system), by inviting a friend on the consumer
  refer-a-friend flow; the referee redeems the code and the record is created in `pending`. There
  is no auto-`flagged` state — risk is a band, not a status.
- **Checker (approver):** the **ops reviewer**, who approves (releases reward), rejects (no reward),
  or claws back a previously released reward.
- **Approval side-effect:** status `-> rewarded`, an audit entry, and the referrer's rupee balance
  credited. Rejection has no reward side-effect. Clawback reverses a prior release.
- **Hard gate:** approval has an extra precondition the **server** enforces — the referred party
  must hold a current identity badge (§5.2).

## 7. State machine
```
   pending  --(approve, server checks the badge)-->  rewarded  --(clawback)-->  clawed-back
     |                                                |
     |--(reject)---------------------------------> rejected

  qualified  --(approve / reject)--> as pending above
```
- **States:** `pending`, `qualified`, `rewarded`, `rejected`, `clawed-back` (`ReferralStatuses`).
- **Reviewable:** `pending` and `qualified` offer Approve + Reject. Only `rewarded` offers
  Clawback. `rejected` and `clawed-back` are terminal (no action - shows a dash).
- **`clawed-back` is not `rejected`.** A fraud desk needs the one
  distinction between a reward that was never paid and one that was paid and
  recovered. `Badge` gives it its own tone for the same reason.
- Any other transition is a 409 naming the current status.

## 8. Edge cases, validation & error states
- **Read failed:** "The queue could not be read." plus the server's message and a Try again button.
  A fraud queue that renders a failed read as "no referrals here" is worse than one that says it
  could not look.
- **Empty tab:** table shows "No referrals here" (gift emoji).
- **Loading:** `<Loading />` until the first page arrives.
- **Approve blocked:** disabled "Blocked" button in the browser, **and** a 409 from the endpoint if
  anything goes round it. The toast shows the server's own sentence.
- **Clawback confirmation:** none - a single click reverses the reward. The endpoint takes an
  optional reason the UI does not yet collect; both are worth adding.
- **Windowing, not paging:** the 100 newest are fetched and a banner appears when the server holds
  more. Server-side `status` / `risk` filters exist on `GET /referrals` and are not yet wired to
  the tabs.
- **Concurrency:** decisions are single server-side transitions; a second decision on an already
  decided referral is refused with a 409 rather than silently overwriting.


## Appendix: implementation rationale (moved from source Javadoc)

### Reward is two fields, and the unit changed
`Referral.reward` is the human label ("+15 owner contacts"); `Referral.rewardAmount` is its
magnitude (15). Before spec fix S54 only the label existed, so the summary had nothing to add up
and a checker was asked to approve a grant without seeing its size.

The unit was rupees until D31b; it is now owner contacts. `V91` restated the undecided rows and
left decided ones alone — a `rewarded` row records what a person actually released at the time,
and re-denominating it after the fact would rewrite history. `reward` is therefore free text, not
an enum: the column has to hold two eras of the offer at once. `rewardAmount` is frozen at
redemption rather than rendered from settings on every read, so a campaign that changes the bonus
does not silently restate what someone was offered last month.

### Correlation signals (D55, V64) and ninety-day retention
`same_device` / `same_ip` require both sides of a comparison, so the platform stores a salted
digest of the referee's address and User-Agent on `referrals`, and of the referrer's on
`ReferralCode`. A code minted before V64 or a request without a `User-Agent` produces no digest
and the signal stays `false` — a fraud signal that is wrong is worse than one that is absent,
because a checker who trusts it stops looking.

The digests are personal data, kept for one purpose (fraud detection), never on the wire, and
blanked by `ReferralSignalRetention` ninety days after capture. Ninety days is long enough for a
desk to correlate a cluster and to answer a challenge weeks later, short enough that the evidence
is gone well before the referral row itself, which stays because the reward and its decision are
financial records with their own retention.

The findings outlive the evidence, on purpose: `same_device` and `same_ip` are outcomes (like
`identity_verified` recording that a check passed), not identifiers, and erasing a desk's
conclusions along with its working is not what a retention limit asks for.

The digests are stored rather than compared-and-discarded because the interesting pattern is one
referrer whose referees all share an address — a question only answerable against rows that kept
the digest. That also makes `same_ip` auditable rather than an unbackable boolean. The columns
have no getters: nothing in Java needs to read them, and not having one is the cheapest guarantee
they never reach a DTO.

`ReferralSignalRetention.RETENTION` is public so a test can prove the expiry against the real
window rather than against a number retyped beside it — the two drifting apart is exactly how a
retention promise quietly stops being kept. The two tables are cleared in one transaction: they
hold the two halves of the same signal and a partial run would leave a comparison nobody can
reproduce. The expiry is split from its scheduled trigger (`ReferralSignalRetentionSweep`) so the
cutoff is a test parameter, not the wall clock. `expireNow()` carries its own `@Transactional`
because it calls the annotated method on `this` — the proxy is bypassed on self-calls, and every
scheduled tick was silently failing with `InvalidDataAccessApiUsageException` while the unit test
(which went through the proxy) stayed green.

Time-based expiry is a different mechanism from a subject's erasure request; neither substitutes
for the other. The overlap is disclosed in `ErasureRetention#knownGaps()`.

### Redeem: refusal indistinguishability
Every refusal from `POST /referrals/redeem` is the same 409 with the same message. An unknown
code, the caller's own code, and a mobile already referred are indistinguishable to the caller.
Distinct messages would turn the endpoint into an oracle for "is `PUNE-XXXX` a real code?" — the
reconnaissance step before farming one. The `DataIntegrityViolationException` catch on
`uq_referrals_referred_mobile` is safe only because nothing below it touches the DB (the
persistence context is unusable after a constraint fires), and it exists so the racing loser's
refusal is byte-identical to every other one.

Document uniqueness is enforced at approval time: a second account cannot complete a badge
against an identity hash already held (`IdentityAlreadyRegisteredException`), so a verified
referred party is a unique one by construction — no check is needed at redemption.

### Approve / clawback / decide
Approval reads the referred party's **current** identity badge, not the snapshot on
`Referral.identityVerified` (`updatable = false`). The ordinary path is to redeem first and
verify afterwards; gating on the snapshot would permanently refuse the very referrals the scheme
is for. A referee who has since disappeared from `users` is refused — "cannot check" and "checked
out" are not the same answer to a question about money. Uniqueness is not re-checked here for the
same reason as in redeem.

Clawback is only allowed on a `rewarded` row: clawing back a referral that was never paid would
rewrite history to say it had been.

`decide` is the one place a referral changes state. Its `refusal` function returns `null` to
allow or the sentence to return; it returns the sentence rather than a boolean because approve
can refuse for two different reasons and a desk told "Referral is pending and cannot be rewarded"
about a verification problem would go looking for a status bug that is not there — `pending` is
precisely the state approve works from. The row is loaded under a write lock via
`ReferralRepository#findForDecision`. The audit key is `contacts`, not `amount`: an append-only
trail whose values changed from rupees to contacts must name the unit or somebody reads it wrong
in a year (D31b); older records keep the older key.

### Code minting and normalisation
The alphabet excludes `I`, `O`, `0`, `1` because codes are read off phone screens and dictated
over calls, and a referrer whose reward hinges on someone typing `0` instead of `O` loses it.
Codes are minted on first read of `GET /me/referrals`, not at signup: pre-generating for every
existing user would need a migration and would cost an insert for the majority who never open the
screen. Codes are normalised (trim + upper) because they are dictated and pasted with stray
spaces. Collisions are avoided by looking before leaping: a constraint violation poisons the
persistence context, so no retry is available once one fires. A genuine concurrent collision
still hits the index and returns 409 — a re-tap at one-in-a-million per attempt, not a design.

### Channel and risk (queue read paths)
`ReferralService.channelOf` snapshots at redemption for evidence, but the desk's queue reads the
referred party's current tally via `ReferralMapper.channelOf` — the redemption snapshot always
says `seeker` because redemption fires from `Signup.jsx` in the same handler as registration.
`listingsCount` is the right question (the lifetime tally): somebody whose first listing was
rejected still joined on the owner side. Reading `role` was structurally unreachable — nothing in
the application assigns `Roles.Wire.OWNER`; only demo seed data set it directly. Not to be
confused with `Referral.shareChannel` (how the link travelled, D60).

Risk has three inputs since V64: referrer velocity, whether the referee is identity-verified, and
D55 correlation. Correlation raises the band rather than refusing anything — a couple sharing a
flat and a router is the platform's most common genuine referral, and treating that as fraud
would reject exactly the people the scheme is for.

### Queue paging
`ReferralService.queue` uses `mapper.toDtos(page.getContent())` rather than `page.map(mapper::toDto)`
because the latter would resolve the referrer's name one row at a time; `toDtos` resolves the
whole page in a single query.

### Q17: auto-qualify semantics
`Referral.qualifiedAt` moves from null exactly once, when the referee's **first** listing passes
ownership verification. Because it can only move once per row and `uq_referrals_referred_mobile`
admits one row per referred mobile, "one credit per referee, ever" needs no further constraint.
Since D31b, `qualifiedAt` is also the moment the grant becomes spendable, so this field is now
load-bearing for entitlement and not only for a checker's confidence.

`qualify()` returns whether anything changed — that return value is the idempotency. The
announcement runs inside the verification write's transaction, so a retried write announces
again, and a second verified listing by the same owner announces a different property against the
same referral; both must mint exactly nothing the second time. Guarding on `qualifiedAt == null`
rather than the property id makes that true for both cases. Only a `pending` referral qualifies:
a rejected row must not be resurrected by a later verification, and a rewarded row has nothing to
gain — the caller checks status because it also decides whether to consume a slot in the
referrer's monthly allowance.

`activated` is updatable since V64. It used to sit alongside `status = 'qualified'` and was
produced by nothing, so the desk read `false` on every row including the ones it had just
approved. Q17 supplies the activation event, and `activated` and `status` now move together in
`qualify` — a row saying `qualified` while claiming the referee never activated contradicts
itself on the desk's own screen.

### DTO masking
`ReferralMapper.masked` is hand-written and private per api-standards §8.1: a public
`String → String` helper gets adopted as an implicit converter by generators and silently applied
to unrelated fields. Both mobiles go through it and nothing in the class returns a raw one.
