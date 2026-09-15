# Flow: Contact Reveal & Leads (Enquiries)

> How an owner's phone number stays masked behind an **owner-approval** gate, how a buyer's request
> becomes a lead, and how the owner triages that lead. Contact is **L1-only** (signed in with
> mobile OTP) under the **badge-not-gate** model — **no identity verification is required to
> contact an owner** (ADR-019; see [`../../system/platform-architecture.md`](../../system/platform-architecture.md) §6.4
> and [`../../system/platform-architecture.md`](../../system/platform-architecture.md) §5.6).
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** buyer/tenant (maker), owner (checker)

---

## 1. Purpose & user problem
- **Persona:** a buyer/tenant who wants to reach the owner; the owner who wants genuine, spam-free
  leads and control over who gets their number.
- **Job-to-be-done (buyer):** "Get the owner's number / start a chat about this listing." **(owner):**
  "Only share my number with people I approve (and optionally only Verified-badge users), and manage
  every incoming request in one inbox."
- **Why it matters:** this is the conversion event of the whole product - the zero-brokerage promise
  is "connect directly with owners." The gate that protects owner privacy and lead quality is the
  **request → owner-approval + masked-number** model — **not** an identity wall; the
  lead inbox is the owner's CRM.

## 2. Entry points
- **Buyer side (create a request):** the property detail page - `ContactBox.jsx` ("Request number")
  and `ContactOwnerModal.jsx` ("Send enquiry"), and the sticky mobile CTA + map detail panel. Route:
  `/property/:id`.
- **Opt-in Verified-badge hand-off:** `src/components/auth/VerifyIdentityRedirect.jsx` — mounted
  **only** when an owner accepts "verified contacts only". It renders nothing of its own: it sends the
  requester to `/verify-identity`, where they photograph a document and record a live selfie for a
  reviewer. It is a badge earn, not a gate.
- **Owner side (triage leads):** dashboard Enquiries/Leads tab -
  `src/pages/consumer/dashboard/EnquiriesPanel.jsx` + `LeadSheet.jsx`, fed by
  `useDashboardData.js`. Route: `/dashboard` (owner view), `ProtectedRoute`.
- **Core logic:** `src/lib/contact.js`, `src/lib/store/listings.js` (opt-in Verified-badge helpers),
  `src/services/contactService.js`, `src/services/providers/mock/contactProvider.js`.

## 3. Actors & roles
- **Maker = buyer/tenant** (signed in at **L1** — mobile OTP; no badge needed) requests the number
  or sends an enquiry.
- **Checker = owner** approves/declines from the dashboard.
- **`isOwnerViewer`** (viewer mobile == owner mobile) always sees the full number (`status:'owner'`).
- The gate is defined once in [`../../system/cross-cutting.md`](../../system/cross-cutting.md)
  (section 3); this doc is the flow-level detail.

## 4. Entities touched
- [`contact_requests`](../../system/data-model.md) - created by the buyer, decided by the owner.
  Runtime store, key `draazyContactReq:<ownerDigits>` (shared with the HTML prototype).
- [`identity_verifications`](../../system/data-model.md) - read **only** as the opt-in Verified
  badge, and used solely by the owner "verified contacts only" path; written when a **staff reviewer
  approves** a submitted document + selfie (key `draazyIdentity:<mobile>`, `{ verified: true, … }`).
  It is **never** a prerequisite for the contact gate itself.
- [`enquiries`](../../system/data-model.md) - the owner's "Enquiries" tab is **seed-only** today
  (`src/data/enquiries.json`); the buyer contact flow does **not** create rows here (see edge cases).
- Owner privacy prefs (`dzOwnerPrefs:<mobile>`, `hideNumber`) and lead annotations
  (`leadNotes`, private note + follow-up date) are read/written on the owner side.

## 5. Business rules & logic  *(the meat)*

### The contact gate (from `src/lib/contact.js`)
Under **ADR-019 (badge-not-gate)** contact is **L1-only**: the sole floor is being signed in
(mobile-OTP). There is **no identity gate** on contacting an owner. The real "gate" is the
**request → owner-approval + masked-number** model, plus one narrow opt-in exception.

**Floor - signed in (L1).**
`requestContact(ownerMobile, propId)`:
- Returns `'login'` if no signed-in user (the UI prompts sign-in). This is the only hard prerequisite
  to create a request.

**Narrow exception - owner "verified contacts only" (opt-in badge, L2).**
- If, and only if, the owner has opted into `verifiedContactOnly` (`ownerVerifiedOnly(ownerMobile)`)
  **and** the requester lacks the Verified badge (`isViewerVerified` reads `draazyIdentity:<buyerDigits>`),
  `requestContact` returns `'verification_required'`.
- The UI (`ContactBox.request` / `ContactOwnerModal.request`) then mounts `VerifyIdentityRedirect`,
  which hands the requester to `/verify-identity` — **one document, one selfie, checked by a person
  on our team** — and resumes the request once the badge is issued. This is the **sole** path that
  turns a contact request into `verification_required`.
- **Not the norm:** for the vast majority of listings (no `verifiedContactOnly` pref) any signed-in
  user reaches the owner-approval step directly. Verification is a **badge, never a wall** — and no
  verification nudge precedes this value moment.
- **Asynchronous by design:** submitting is not passing. `POST /me/verification/identity` answers
  **202** and a reviewer decides later, so the resumed request may be minutes or hours away. The UI
  must not promise an instant unlock.

**Owner approval (maker-checker).**
Once past the floor (and the exception, if any), `requestContact`:
- If a request already exists for this buyer+property, returns its current `status` (idempotent).
- Otherwise unshifts a new record and returns `'pending'`:
  ```
  { id: 'c'+Date.now(), propId, buyerName, buyerMobile: <digits>, status: 'pending', requestedAt: Date.now() }
  ```
- The owner's number stays **masked** (`maskPhone` -> `+91 98xxx xxxx02`) until approved.
- If a request already exists for this buyer+property, returns its current `status` (idempotent).
- Otherwise unshifts a new record and returns `'pending'`:
  ```
  { id: 'c'+Date.now(), propId, buyerName, buyerMobile: <digits>, status: 'pending', requestedAt: Date.now() }
  ```
- The owner's number stays **masked** (`maskPhone` -> `+91 98xxx xxxx02`) until approved.

### The quota, which is a second gate and is the server's (D31b)
Being signed in gets you *to* the request; it does not get you an unlimited number of them. The free
tier is **15 owner contacts** (`settings.fees.freeContactLimit`), the three priced plans are
unlimited (`plans.unlimited_contacts`, V91), and a qualified referral adds 15 more.

- **The refusal is a response, not a pre-check.** `POST /contacts/request` returns **422
  `contact_quota_exhausted`**; `ContactBox` and `ContactOwnerModal` open `ContactsExhaustedModal` on
  that error code. They deliberately do **not** read the remaining count and skip the request — that
  was the old behaviour (`canRevealContact()` in `lib/store/contactQuota.js`, evaluated before any
  network call), and it put the limit in the place with the least reason to respect it.
- **What a contact costs.** `used` is `count(contact_requests where requester = me)`, so the price is
  paid on the transition to a new row and nothing else: a repeat press on the same listing is the
  same door and is free, a refused press is free, and an owner's approval or decline changes nothing.
- **Reading the balance.** `GET /me/entitlements` → `{ contacts: { unlimited, used, allowance,
  remaining, referralBonus }, listings: { … } }`. `allowance` and `remaining` are **`null`** when
  `unlimited` — branch on the flag, never on `remaining > 0`.

### Status model (`contactStatus`)
`'owner' | 'approved' | 'pending' | 'declined' | 'none'`:
- `owner` - viewer is the owner; full number always.
- `pending` - request created, awaiting owner; masked.
- `approved` - owner approved; number can unmask (subject to privacy pref).
- `declined` - owner declined; stays masked.
- `none` - no request yet.

### Reveal rule (`ContactBox` / `ContactOwnerModal`)
`revealed = status === 'owner' || (status === 'approved' && !ownerHidesNumber(ownerMobile))`.
- **Owner privacy override:** `ownerHidesNumber` (from `dzOwnerPrefs.hideNumber`) keeps the number
  masked even after approval; the buyer is routed to in-app chat/callback ("approved - prefers
  chat"). This sits on top of the always-on request gate, it does not replace it.

### Owner decision (`setContactStatus`)
- `setContactStatus(ownerMobile, reqId, 'approved'|'declined')` flips the stored request's `status`.
- On the dashboard, `decideContact(reqId, decision)` (in `useDashboardData.js`) calls
  `setContactStatus`, re-reads `getContactReqs`, and toasts ("Your number is now shared..." /
  "Request declined - your number stays private.").
- `pendingContactCount(ownerMobile)` powers the owner's "waiting on you" badge.

### The enquiry variant (`ContactOwnerModal.sendEnquiry`)
- "Send enquiry" is also "contacting the owner", so like the number request it is **L1-only** (any
  signed-in user; no badge). If `inAppMessaging` is on it `queueOwnerChat(p, { firstMessage })`
  (a real chat request the owner accepts in Messages); if off it just toasts "enquiry sent". It does
  **not** create a `contact_request` or an `enquiries` row.

### Owner lead inbox (`EnquiriesPanel.jsx`)
- Aggregates several request types into one normalized **lead descriptor** and a priority queue
  (attention-first, then longest-waiting):
  - **Number requests** (`contact_requests`) - approve = "Share", decline; approved reveals the
    buyer's mobile for Call/WhatsApp.
  - **Photo requests**, **Document requests** (grouped per buyer+property; grant/decline all),
    **Flatmate requests** (accept/decline), and **Enquiries** (seed).
- **Triage math:** `waitingOnYou` = pending contacts + pending flatmates + photo reqs + pending doc
  groups; `totalLeads` = all requests + enquiries; oldest-waiting age drives an urgency chip and a
  "reply within an hour" nudge. Per-row `waitPill`: `>=24h`/`>=1h` -> hot, fresh -> "new".
- **LeadSheet.jsx:** per-lead detail with a private note and a follow-up date
  (`leadNotes` / `getLeadAnnotations` / `setLeadAnnotation`, keyed by owner mobile + stable lead id),
  plus Approve/Decline, the type's primary action, and Call/WhatsApp when a mobile is available.

### Owner-side record shape (number request)
Stored under the owner's key; each item: `{ id, propId, buyerName, buyerMobile, status, requestedAt }`.
The buyer's mobile is only surfaced to the owner for Call/WhatsApp **after** approval
(`contactMobile: r.status === 'approved' ? r.buyerMobile : undefined`).

## 6. Maker-checker / approval
- **Yes - this is a canonical maker-checker.** Maker = buyer (creates a `pending` request), Checker =
  owner (approves/declines). On approval the side-effect is the number unmasking for that buyer
  (subject to `hideNumber`); on decline it stays masked. Reject is not resubmit-locked - a buyer's
  existing record simply returns its status. Defined once in
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) (section 2, and the contact row in
  the table in 2.4; the gate itself in section 3).

## 7. State machine
```
Contact request (per buyer+property):
  none --requestContact--> pending --owner approve--> approved --> number unmasks*
                              |                                   (*unless owner hideNumber -> chat)
                              +--owner decline--> declined (masked, terminal)
  owner viewer -> always 'owner' (full number)

  Floor: sign in (L1). If the owner accepts verified contacts only AND the requester
  lacks the Verified badge, requestContact returns 'verification_required' (opt-in
  badge flow) instead of creating the request. Otherwise no verification is involved.
```
- **Terminal:** `approved` and `declined`. A re-request while a record exists returns the current
  status (no duplicate).

## 8. Edge cases, validation & error states
- **Not signed in:** `requestContact` returns `'login'`; UI toasts "sign in to request the number".
- **Owner accepts verified contacts only & requester unverified:** `'verification_required'` -> the
  opt-in Verified-badge modal (not a request). For every other owner, no verification is involved.
- **Mobile-match:** a **soft** trust signal at MVP (ADR-009a) — never blocks contact and triggers no
  re-auth/redirect; the hard `403 mobile_match_required` applies only at the deal step (L3).
- **Duplicate request:** idempotent - returns the existing status instead of creating a second row.
- **Owner viewing own listing:** always sees the full number; requests are moot.
- **Approved but owner hides number:** number stays masked; buyer routed to chat/callback.
- **Enquiries tab is seed-only:** `useDashboardData` loads `listEnquiries().slice(0, 8)` from
  `src/data/enquiries.json`; those rows are **not** owner-scoped and are **not** produced by the live
  buyer contact/enquiry flow. Real buyer intent today materialises as **contact_requests** (and chat
  requests), not `enquiries`. This is a notable gap to close server-side.
- **Cross-prototype storage:** the `draazyContactReq:<ownerDigits>` key is shared with the HTML
  prototype, so requests must stay compatible.
- **`pn:store` event:** owner-pref changes dispatch a `pn:store` CustomEvent so open tabs re-render
  without reload (a lightweight in-app pub/sub the backend would replace with push).

## Service

Rationale relocated from `ContactService` and `ContactController` Javadoc.

### Badge-not-gate (ADR-019)
Asking for contact requires only L1 (a mobile-OTP account). The L2 Verified badge is a trust
*signal*, never a wall, with exactly one exception: an owner may opt into
`users.verified_contact_only`, and only then does a badge-less caller get
`403 verification_required`. No other code path in this slice may 403 on a missing badge. The badge
is read live from `users.verified` rather than the JWT claim, because a token minted before the
badge was earned would 403 someone who is in fact verified.

### API surface
Both `/contacts` routes are authenticated by the default-deny posture in `SecurityConfig` - the
contract's `401` is that filter-chain response, not a check in the controller. There is no
`@PreAuthorize` role guard, and that is correct rather than an oversight: the spec carries no
`x-roles` on these operations and any signed-in user may ask for contact, so a role restriction
would block the common case of an owner enquiring about somebody else's listing. Identity always
comes from `AuthPrincipal`, never from the body. `requestContact` answers `200` rather than
`201` because the contract models it as "tell me where I now stand" and a repeat call is
idempotent.

### Cross-context reads
The service reads `catalog.property` and `identity.user` repositories directly.
`package-structure.md` section 5 asks features not to import each other, but `leads` is
inherently a *join* context (it relates a listing to a user), so inverting these two reads would cost
three interfaces and two adapters for no behavioural change. A deliberate, reviewed exception,
alongside the existing `security.JwtService -> identity.user.User` precedent. The one direction
that *is* inverted is the security-critical one: `catalog` reaches this feature only through the
`common.trust.ContactGate` port.

### requestContact outcomes, in decision order
1. The caller owns the listing -> `OWNER`, and no row is written (asking yourself for your own
   number is not a lead).
2. The owner accepts verified contacts only and the caller has no badge -> `403
   verification_required`, the single legitimate badge 403.
3. Otherwise the existing request is returned unchanged, or a new `pending` one is created - and
   creating one spends an owner contact, which can run out.

**Idempotent by design.** Re-requesting returns the current state rather than inserting a second row,
so a double-tap cannot flood an owner's inbox and, more importantly, cannot reset a `declined`
request back to `pending`, which would turn "no" into a retry loop. Two genuinely concurrent taps
can both miss the read, so `uq_contact_requests_requester_property` is the real guarantee and the
loser of the race simply re-reads the winner's row.

**The quota is checked last, and only on the insert branch.** Order matters twice over. An owner
looking at their own listing never spends a contact, because outcome 1 returns before the check. A
caller re-reading a conversation they already opened never spends one either, because the
existing-row probe short-circuits: running out of contacts stops you approaching a *new* owner, it
does not close doors you already walked through. That is also what makes idempotency survive the
quota.

**The quota counts rows rather than reading a stored balance**, which is what makes it safe under
concurrency without a lock: the count and the spend are the same fact, and the unique constraint
settles a tie by failing the loser's insert. Two simultaneous requests against two *different*
listings could both pass a check at the last contact and both insert - one contact over. Accepted
knowingly: the remedy is a lock on every contact request, out of all proportion to the harm. The
refusal message names the two ways out, because a refusal that does not is a dead end.

### Owner inbox
Strictly owner-scoped: the id set comes from `properties.owner_id`, so a caller can never see a
request against someone else's listing, and an owner with no listings gets an empty array without a
second query. N+1-safe at three queries - listing ids, requests, requesters - regardless of inbox
size, and the verified badge on each party is one more query for the whole page.

`myPendingContactCount` is an endpoint rather than a client-side filter. Counting pending rows in a
fetched inbox is only correct while the inbox is unpaged; paging it would quietly turn the badge into
"pending requests on page one", wrong in exactly the situation the badge exists for. Counted in the
database it is right at any inbox size and costs one integer.

`respondContactRequest` enforces owner scope by lookup, not by a check after the fact: the row is
only accepted once `properties.findByIdAndOwner_Id` confirms the caller owns the listing it points
at. A request belonging to another owner is a `404`, never a `403` - we do not confirm that
someone else's lead exists. Both end states are terminal, so an owner cannot revoke a reveal the
buyer has already seen. Approval notifies the buyer inside the same transaction; a decline stays
silent on purpose.

### Reveal policy
An owner's raw number is never revealed to another viewer, whatever their own hide-number preference
- approval unlocks the in-app conversation, not the digits. The signal is constant-true for every
non-owner viewer, routing the client to the message affordance rather than a tel:/wa.me link.
`verificationRequired` is false for the owner of the listing, whatever their own preference says.
