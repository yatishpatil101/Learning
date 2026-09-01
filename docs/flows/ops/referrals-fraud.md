# Flow: Ops Referral Verification (fraud-review queue)

> The ops desk that keeps the refer-a-friend program honest. Every referral lands here as a
> record with background-check signals; a reviewer approves (release reward), rejects, or claws
> back - the **reward payout** is gated on Aadhaar verification + uniqueness. Under **ADR-019
> (badge-not-gate)** this identity/uniqueness check is legitimate here because it guards **money at
> risk (a reward payout)** inside the opt-in reward flow (L2/L3) — it is **not** a browse/post/contact
> gate (those stay at L1 mobile; see [`../../system/trust-and-verification-model.md`](../../system/trust-and-verification-model.md)).
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) · **live-only
> since wave 2c (2026-08-14)** - **Primary role(s):** ops staff / admin (any ops user)

> **The Aadhaar gate is the server's rule now.** Until wave 2c it existed only as a greyed-out
> button in the browser, under the banner above calling it mandatory, while
> `POST /referrals/{id}/approve` released the money to anyone who called it. `ReferralService.approve`
> now refuses with a 409 naming the reason, and the button is a mirror. This is the only *backend*
> change the mock-retirement migration has made.

---

## 1. Purpose & user problem
- **Persona:** an ops/trust reviewer responsible for the referral rewards budget.
- **Job-to-be-done:** "Before we pay a referral reward, confirm the referred user is a real,
  Aadhaar-verified, unique person - and flag self-referrals, duplicate-device, and reward-farming
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
    and the three decision endpoints. **The desk is live-only**: the mock provider's four desk
    methods throw, and the page renders an explanatory panel instead of a queue when `referral` is
    not in `VITE_API_DOMAINS`. The mock store disagreed with the server about what a referral *is*
    (see §5.7), so translating it would have meant maintaining a second fraud vocabulary by hand.

    > **Corrected (D233).** This bullet used to say "**Live-only**: there is no mock provider."
    > There is one now — `providers/mock/referralProvider.js` — but it carries only the *consumer*
    > half of the resource (`GET /me/referrals`, `POST /referrals/redeem`), which
    > `ReferralsController` calls out as the second audience on it. None of the three disagreements
    > in §5.7 is about "what is my code"; all three are about the desk, and all three still hold.

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
  - Signals: `aadhaarVerified`, `aadhaarUnique`, `activated`, `sameDevice`, `sameIp`,
    `velocityHigh` (booleans); `risk` (`low | medium | high`, computed by `ReferralService.risk`).
    `aadhaar_verified` and `aadhaar_unique` are `updatable = false` — they are a snapshot of the
    redeem moment, which is why the approve gate reads the referred party's *current* badge
    instead (§5.2).
  - Lifecycle: `status`, `at` (redeemed), `qualifiedAt`, `handledBy`, `handledAt`.
- **The referrer's reward balance** - owner contacts, reported by `GET /me/entitlements` and derived
  from the referrals that justify it on every read (`count(qualified or rewarded) ×
  settings.fees.referralContactBonus`). There is no balance column and no grant ledger, which is
  precisely what makes **clawback** whole: reversing the referral reverses the contacts, with nothing
  to un-increment by hand. The mock's device-local perk counters
  (`services/providers/mock/contactQuota.js`, `pnContactsUsed:<mobile>`) are the *mock server's*
  equivalent of the same arithmetic; see §5.5.
- **Audit log** - decisions are audited server-side (`referral.approve` / `.reject` / `.clawback`).

## 5. Business rules & logic  *(the meat)*

### 5.1 Background-check signals
Rendered as pills (`SIGNALS` in `OpsReferrals.jsx`). Each has a "good when true" polarity:

| Signal | Field | Good when | Meaning if bad |
|--------|-------|-----------|----------------|
| Aadhaar verified | `aadhaarVerified` | present | referred user has not completed Aadhaar KYC |
| Aadhaar unique | `aadhaarUnique` | present | that Aadhaar is already used by another account |
| Activated | `activated` | present | referred user never became active |
| Same device | `sameDevice` | absent | referrer and referred share a device fingerprint |
| Same IP | `sameIp` | absent | shared IP address |
| High velocity | `velocityHigh` | absent | burst of referrals in a short window (farming) |

A pill is green when the "good" condition holds, red otherwise. `risk` is computed by
`ReferralService.risk` from three inputs — velocity, the Aadhaar badge, and device/IP correlation —
and read, not derived, by the component.

Note what correlation does: it raises the band to `medium` rather than refusing anything. A couple
sharing a flat and a router is the platform's most common genuine referral, so device/IP
correlation is a reason for a human to look, which is what a risk band is.

### 5.2 The mandatory qualification gate
**The rule lives in `ReferralService.approve`.** Approving a referral whose referred party holds no
Aadhaar badge is answered `409` with:

> The referred party is not Aadhaar-verified, so this reward cannot be released.

The gate reads the referred party's **current** badge, via `UserRepository.findByMobile`, and not
the `aadhaar_verified` column on the referral — that column is `updatable = false`, a snapshot of
the redeem moment, and the ordinary order of events is redeem first, verify later. Gating on the
snapshot would have permanently refused exactly the referrals the scheme exists for. A referee who
is not in the user table at all is refused too: "cannot check" is not "checked out".

The browser still greys the button out:
```js
function canQualify(r) { return !!(r.aadhaarVerified && r.aadhaarUnique); }
```
That is now a **mirror** of the server rule, sparing the desk a pointless round trip, rather than
the rule itself. `aadhaarUnique` is checked alongside because the desk's banner promises both, even
though the server derives the second from the first (a second account cannot verify an identity
hash the platform already holds). The other signals (device/IP/velocity) inform `risk` but do not
by themselves block approval.

This gate applies **only to releasing a referral reward** — it never affects anyone's ability to
browse, post, or contact (those stay at L1 mobile, ADR-019). The Aadhaar uniqueness check is the same
composite `identity_hash` invariant (ADR-009b) that caps one Verified badge per human, applied here
at the reward/deal layer where money is at risk.

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
  transition but actively misleading for the Aadhaar refusal, since `pending` *is* the state
  approve works from.
- `handledBy` and `handledAt` are stamped server-side, closing the mock's reviewer-attribution gap.
- After any action the list reloads, moving the row into its new tab.

### 5.5 Reward release - what the mock could not do
- The mock's Approve called `creditReferrer({ mobile: r.referrerMobile, ... })` to grant a listing
  slot or +15 contacts. That call is gone: `referrerMobile` is masked and there is no unmasked read,
  so the desk cannot address a referrer by phone number and must not try.
- **Corrected by D31b.** This section used to end "the server models the reward as money, not as a
  perk", and recorded the perk grant as intentionally dropped. That was the wrong half to drop. The
  perk was the product — owner contacts are what the scheme advertises — and the ₹500 of platform
  credit was a currency with nothing to spend it on. The server now pays owner contacts, so the
  grant is neither dropped nor device-local: approving moves the referral into a status
  `EntitlementService` counts, and the referrer's `GET /me/entitlements` reflects it on the next
  read. **Clawback** takes it back the same way, with no ledger entry to reverse.

### 5.6 Export
CSV of the current tab's rows including all six signals, the reward amount and the redeemed date
(`punenest-referrals.csv`).

### 5.7 What the mock disagreed about
Three disagreements, not three formatting differences — which is why this desk is live-only:

| | mock (`lib/mockApi.js`) | server |
|---|---|---|
| statuses | `pending`, `flagged`, `qualified`, `rewarded`, `rejected` | `pending`, `qualified`, `rewarded`, `rejected`, `clawed-back` |
| mobiles | both in full | both masked, no unmasked read |
| approve pays | a perk, device-locally | owner contacts, on the account (D31b) |
| clawback leaves | `rejected` | `clawed-back` |
| Aadhaar gate | the button | the endpoint |

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
  must hold a current Aadhaar badge (§5.2).

## 7. State machine
```
   pending  --(approve, server checks Aadhaar)-->  rewarded  --(clawback)-->  clawed-back
     |                                                |
     |--(reject)---------------------------------> rejected

  qualified  --(approve / reject)--> as pending above
```
- **States:** `pending`, `qualified`, `rewarded`, `rejected`, `clawed-back` (`ReferralStatuses`).
- **Reviewable:** `pending` and `qualified` offer Approve + Reject. Only `rewarded` offers
  Clawback. `rejected` and `clawed-back` are terminal (no action - shows a dash).
- **`clawed-back` is not `rejected`.** The mock wrote `rejected` for both and lost the one
  distinction a fraud desk needs: a reward that was never paid, versus one that was paid and
  recovered. `Badge` gives it its own tone for the same reason.
- Any other transition is a 409 naming the current status.

## 8. Edge cases, validation & error states
- **Not live:** an explanatory panel replaces the queue, naming the three disagreements (§5.7),
  rather than a table of referrals the desk could not stand behind.
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
