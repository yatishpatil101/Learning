# Flow: Ops Referral Verification (fraud-review queue)

> The ops desk that keeps the refer-a-friend program honest. Every referral lands here as a
> record with background-check signals; a reviewer approves (release reward), rejects, or claws
> back - the **reward payout** is gated on Aadhaar verification + uniqueness. Under **ADR-019
> (badge-not-gate)** this identity/uniqueness check is legitimate here because it guards **money at
> risk (a reward payout)** inside the opt-in reward flow (L2/L3) — it is **not** a browse/post/contact
> gate (those stay at L1 mobile; see [`../../system/trust-and-verification-model.md`](../../system/trust-and-verification-model.md)).
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** ops staff / admin (any ops user)

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
  - Data: `src/lib/mockApi/collections.js` `listReferrals`; mutations via `mutateDb` + `logAudit`
    (`src/lib/mockApi/core.js`, `src/lib/mockApi/audit.js`).

## 3. Actors & roles
- **Any ops user (staff or admin)** can review referrals - unlike the service desks, there is **no**
  team gate on this route. All referral records are visible to every ops user.
- **Reviewer actions** are the same for all: Approve, Reject, Clawback.
- See [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1 for the role model.
  As with all ops guards, this is UX-only and MUST be re-enforced server-side (section 11).

## 4. Entities touched
Link definitions: [`../../system/data-model.md`](../../system/data-model.md).

- **Referral** (`db.referrals`) - read (list) and updated (status + `handledAt`). Never
  hard-deleted; state is a status flag. Fields:
  - Identity: `id` (`RF####`), `referrer` (name) + `referrerMobile`, `referred` (name) +
    `referredMobile`, `channel` (`seeker` | `owner`).
  - Reward: `reward` (human string, for example `"+15 owner contacts"` or
    `"Free rent agreement (1/3)"`).
  - Signals: `aadhaarVerified`, `aadhaarUnique`, `activated`, `sameDevice`, `sameIp`,
    `velocityHigh` (booleans); `risk` (`low | medium | high`, precomputed).
  - Lifecycle: `status`, `at` (created ms), `handledBy` (string), `handledAt` (ms).
- **Reward side-effect target** - the referrer's non-monetary rewards (owner contacts / free
  agreements). In the mock these live **separately** in the referrer's own device store
  (`src/lib/store/referrals.js`, `pnReferralStats:<mobile>`) and are **not** actually credited by an
  ops approval (honest gap, section 6/11).
- **Audit log** (`db.auditLog`) - every decision writes an entry via `logAudit('Referrals', ...)`.

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

A pill is green when the "good" condition holds, red otherwise. `risk` (low/medium/high) is a
separate precomputed rollup shown as a colored label, not derived in this component.

### 5.2 The mandatory qualification gate
```js
function canQualify(r) { return !!(r.aadhaarVerified && r.aadhaarUnique); }
```
A referral can be **approved only if** the referred user is Aadhaar-verified **and** that Aadhaar is
unique. When `canQualify` is false the Approve button is replaced by a disabled "Blocked" button
(tooltip: "Aadhaar verify + uniqueness required"); attempting approve anyway shows the error toast
"Blocked - needs Aadhaar verification + uniqueness". The other signals (device/IP/velocity) inform
`risk` and the flagged bucket but do not by themselves block approval in code.

This gate applies **only to releasing a referral reward** — it never affects anyone's ability to
browse, post, or contact (those stay at L1 mobile, ADR-019). The Aadhaar uniqueness check is the same
composite `identity_hash` invariant (ADR-009b) that caps one Verified badge per human, applied here
at the reward/deal layer where money is at risk.

### 5.3 Buckets, tabs & stats
- **Stat cards / tabs:** Pending, Flagged, Qualified, Rejected, plus an "All" tab.
- **Bucketing:**
  - Pending = `status === 'pending'`.
  - Flagged = `status === 'flagged'`.
  - Qualified = `status === 'qualified'` **or** `status === 'rewarded'` (both count as "qualified"
    in stats and the Qualified tab).
  - Rejected = `status === 'rejected'`.
- Counts are computed client-side over the full referral list (no team scoping).

### 5.4 Reviewer actions (`doAction`)
- **Approve** (only shown for `pending` / `flagged`, and only enabled when `canQualify`):
  `setReferralStatus(id, 'rewarded')` + `logAudit('Referrals', 'Approved <id>')` +
  toast "Approved - reward granted".
- **Reject** (shown for `pending` / `flagged`): `setReferralStatus(id, 'rejected')` +
  `logAudit('Referrals', 'Rejected <id>')`.
- **Clawback** (shown for `qualified` / `rewarded`): reverses a paid reward -
  `setReferralStatus(id, 'rejected')` + `logAudit('Referrals', 'Clawback <id>')` +
  toast "Reward clawed back".
- `setReferralStatus(id, status)` = `mutateDb` sets `r.status` and stamps `r.handledAt = Date.now()`.
  (Note: `handledBy` is **not** written here - the reviewer identity is captured only in the audit
  log via `logAudit`'s `currentAdminName()`. A backend should set `handledBy` too.)
- After any action the list reloads (`reload()`), moving the row into its new bucket/tab.

### 5.5 Reward release - what actually happens vs. what should
- In the mock, "approve" only flips `status -> rewarded` and writes an audit line. It does **not**
  increment the referrer's owner-contact balance or free-agreement counter - those counters live in
  the referrer's own `localStorage` (`store/referrals.js`) and are device-local.
- The real backend MUST, on approval, atomically credit the referrer's reward ledger (contacts /
  free agreement) and, on clawback, debit it back. See section 11.

### 5.6 Export
CSV of the current tab's rows including all six signals and both Aadhaar flags
(`punenest-referrals.csv`).

## 6. Maker-checker / approval
Applicable - this queue is a checker gate. See
[`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.

- **Maker (proposer):** the **referrer** (and the system), by inviting a friend on the consumer
  refer-a-friend flow; the referral record is created in `pending` (or auto-`flagged` when risk
  signals fire).
- **Checker (approver):** the **ops reviewer**, who approves (releases reward), rejects (no reward),
  or claws back a previously released reward.
- **Approval side-effect:** status `-> rewarded`, an audit entry, and (backend) crediting the
  referrer's reward ledger. Rejection has no reward side-effect. Clawback reverses a prior release.
- **Hard gate:** unlike the generic pattern, approval here has an extra precondition
  (`canQualify`) that must pass before the checker may approve at all.

## 7. State machine
```
                 (approve, requires canQualify)
   pending  ------------------------------------->  rewarded
     |  \                                              |
     |   \--(reject)------------------------------> rejected
     |                                                 ^ (clawback)
   flagged --(approve, requires canQualify)--> rewarded|
     |    \--(reject)-----------------------------> rejected
     |
  qualified --(clawback)-----------------------> rejected
   (seeded pre-qualified records behave like rewarded: only Clawback is offered)
```
- **States:** `pending`, `flagged`, `qualified`, `rewarded`, `rejected`.
- **Actionable:** `pending` and `flagged` offer Approve + Reject; `qualified` and `rewarded` offer
  Clawback; `rejected` is terminal (no action - shows a dash).
- **Note:** Approve jumps straight to `rewarded` (it never routes through `qualified`); `qualified`
  appears only from seed data and is treated as an already-rewarded/clawback-able state.

## 8. Edge cases, validation & error states
- **Empty tab:** table shows "No referrals here" (gift emoji).
- **Loading:** `<Loading />` until `listReferrals()` resolves (`all === null`).
- **Approve blocked:** disabled "Blocked" button + guard in `doAction` (double protection) when
  `canQualify` is false; the error toast explains why.
- **Rejected rows:** no actions rendered (terminal).
- **Clawback confirmation:** none in the mock - a single click reverses the reward (a backend should
  require confirmation + reason, and the UI ideally should too).
- **`handledBy` not persisted** on the record (only audit) - reviewer attribution gap.
- **No pagination:** the full list renders; fine for the seed, needs paging server-side at scale.
- **Concurrency:** read-modify-write on shared editable `localStorage`; last write wins.

## 9. Current mock implementation
- **Service / read:** `src/lib/mockApi/collections.js` -> `listReferrals` (`collGetter('referrals')`,
  filters out `archived`). Re-exported via `src/lib/mockApi.js`.
- **Mutation:** local helper `setReferralStatus(id, status)` in `OpsReferrals.jsx` calling
  `mutateDb` (`src/lib/mockApi/core.js`); audit via `logAudit` (`src/lib/mockApi/audit.js`).
- **Data/seed:** `src/data/db.json` -> `referrals[]` (`RF3000..RF3007`), covering every status and a
  mix of clean, flagged (same device / same IP / high velocity / duplicate Aadhaar), and rejected
  self-clone cases; channels `seeker` and `owner`.
- **Consumer counterpart:** `src/lib/store/referrals.js` (`referralCode`, `referralLink`,
  `getReferralStats`, `addReferralInvite`, `referralContactsEarned`, `referralFreeAgreements`,
  `setReferredBy`) and the `src/pages/consumer/Refer.jsx` page.
- **Key handlers:** `OpsReferrals.jsx` `doAction`, `setReferralStatus`, `canQualify`, `SIGNALS`,
  `stats`, `rows` (tab filter), `doExport`.

## 10. Target API endpoints
Map to the [OpenAPI spec](../../../backend/src/main/resources/static/openapi/punenest-api.yaml) (tag: Billing & Growth).

- `GET /referrals` (admin/staff) - list for the review queue. Delta: add `status` / `risk` filters
  and pagination; return the signal fields.
- **New endpoints implied** (not yet in the contract):
  - `POST /referrals/:id/approve` - checker approves; server re-checks `canQualify`, flips to
    `rewarded`, credits the referrer's reward ledger, writes audit + `handledBy`.
  - `POST /referrals/:id/reject` - checker rejects (optional reason).
  - `POST /referrals/:id/clawback` - reverse a released reward; debits the ledger.
- Consumer side already mapped: `GET /me/referral/code`, `GET /me/referral/stats`,
  `POST /me/referral/invite`.

## 11. Backend responsibilities
- **Recompute signals + risk server-side** from real device/IP/velocity/Aadhaar data. The client
  must never send `aadhaarVerified`, `aadhaarUnique`, or `risk` as trusted input.
- **Enforce the qualification gate on the server** (`aadhaarVerified && aadhaarUnique`) on the
  approve endpoint - not just via a disabled button.
- **Atomic reward ledger updates.** On approve, credit the referrer's contacts / free-agreement
  balance in the same transaction as the status flip; on clawback, debit it. Prevent double-credit
  (idempotency by referral id).
- **Reviewer attribution + audit.** Persist `handledBy` and `handledAt` on the record and write an
  immutable audit entry (who / when / what) - see
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 4.
- **Authorization.** Only authorized ops/trust reviewers may approve/reject/clawback; today the route
  has no team gate, so the server must enforce the role explicitly.
- **Duplicate / velocity detection** belongs server-side (cross-account Aadhaar uniqueness, device
  fingerprint, IP, referral rate limits), feeding the auto-`flagged` state.
- **Not client-trusted:** signal values, risk, status transitions, reward crediting, and reviewer
  identity.
