# Flow: Contact Reveal & Leads (Enquiries)

> How an owner's phone number stays masked behind an **owner-approval** gate, how a buyer's request
> becomes a lead, and how the owner triages that lead. Contact is **L1-only** (signed in with
> mobile OTP) under the **badge-not-gate** model — **no Aadhaar/identity verification is required to
> contact an owner** (ADR-019; see [`../../system/trust-and-verification-model.md`](../../system/trust-and-verification-model.md)
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
  **request → owner-approval + masked-number** model — **not** an identity/Aadhaar wall; the
  lead inbox is the owner's CRM.

## 2. Entry points
- **Buyer side (create a request):** the property detail page - `ContactBox.jsx` ("Request number")
  and `ContactOwnerModal.jsx` ("Send enquiry"), and the sticky mobile CTA + map detail panel. Route:
  `/property/:id`.
- **Opt-in Verified-badge popup:** `src/components/auth/AadhaarVerifyModal.jsx` — surfaced **only**
  when an owner accepts "verified contacts only" (dialog "Get your Verified badge"; CTA "Continue with
  DigiLocker"; dismiss "Maybe later"). It is a badge earn, not a gate.
- **Owner side (triage leads):** dashboard Enquiries/Leads tab -
  `src/pages/consumer/dashboard/EnquiriesPanel.jsx` + `LeadSheet.jsx`, fed by
  `useDashboardData.js`. Route: `/dashboard` (owner view), `ProtectedRoute`.
- **Core logic:** `src/lib/contact.js`, `src/lib/store/listings.js` (opt-in Verified-badge helpers),
  `src/services/contactService.js`, `src/services/providers/mock/contactProvider.js`.

## 3. Actors & roles
- **Maker = buyer/tenant** (signed in at **L1** — mobile OTP; no Aadhaar needed) requests the number
  or sends an enquiry.
- **Checker = owner** approves/declines from the dashboard.
- **`isOwnerViewer`** (viewer mobile == owner mobile) always sees the full number (`status:'owner'`).
- The gate is defined once in [`../../system/cross-cutting.md`](../../system/cross-cutting.md)
  (section 3); this doc is the flow-level detail.

## 4. Entities touched
- [`contact_requests`](../../system/domain-model.md) - created by the buyer, decided by the owner.
  Runtime store, key `puneNestContactReq:<ownerDigits>` (shared with the HTML prototype).
- [`aadhaar_verifications`](../../system/domain-model.md) - read **only** as the opt-in Verified
  badge, and used solely by the owner "verified contacts only" path; written by `AadhaarVerifyModal`
  on DigiLocker success (key `puneNestAadhaar:<mobile>`, `{ verified: true, source: 'digilocker', … }`).
  It is **never** a prerequisite for the contact gate itself.
- [`enquiries`](../../system/domain-model.md) - the owner's "Enquiries" tab is **seed-only** today
  (`src/data/enquiries.json`); the buyer contact flow does **not** create rows here (see edge cases).
- Owner privacy prefs (`pnOwnerPrefs:<mobile>`, `hideNumber`) and lead annotations
  (`leadNotes`, private note + follow-up date) are read/written on the owner side.

## 5. Business rules & logic  *(the meat)*

### The contact gate (from `src/lib/contact.js`)
Under **ADR-019 (badge-not-gate)** contact is **L1-only**: the sole floor is being signed in
(mobile-OTP). There is **no Aadhaar/identity gate** on contacting an owner. The real "gate" is the
**request → owner-approval + masked-number** model, plus one narrow opt-in exception.

**Floor - signed in (L1).**
`requestContact(ownerMobile, propId)`:
- Returns `'login'` if no signed-in user (the UI prompts sign-in). This is the only hard prerequisite
  to create a request.

**Narrow exception - owner "verified contacts only" (opt-in badge, L2).**
- If, and only if, the owner has opted into `verifiedContactOnly` (`ownerVerifiedOnly(ownerMobile)`)
  **and** the requester lacks the Verified badge (`isViewerVerified` reads `puneNestAadhaar:<buyerDigits>`),
  `requestContact` returns `'verification_required'`.
- The UI (`ContactBox.request` / `ContactOwnerModal.request`) then opens `AadhaarVerifyModal` — the
  **opt-in DigiLocker Verified-badge** flow ("Get your Verified badge" → "Continue with DigiLocker") —
  and resumes the request via `onVerified()`. This is the **sole** path that turns a contact request
  into `verification_required`.
- **Not the norm:** for the vast majority of listings (no `verifiedContactOnly` pref) any signed-in
  user reaches the owner-approval step directly. Verification is a **badge, never a wall** — and no
  KYC nudge precedes this value moment.
- **Mobile-match** is a **soft** trust signal at MVP (ADR-009a): the badge records `mobileMatch` but
  never blocks contact; the hard `403 mobile_match_required` applies only at the deal step (L3).

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

### Status model (`contactStatus`)
`'owner' | 'approved' | 'pending' | 'declined' | 'none'`:
- `owner` - viewer is the owner; full number always.
- `pending` - request created, awaiting owner; masked.
- `approved` - owner approved; number can unmask (subject to privacy pref).
- `declined` - owner declined; stays masked.
- `none` - no request yet.

### Reveal rule (`ContactBox` / `ContactOwnerModal`)
`revealed = status === 'owner' || (status === 'approved' && !ownerHidesNumber(ownerMobile))`.
- **Owner privacy override:** `ownerHidesNumber` (from `pnOwnerPrefs.hideNumber`) keeps the number
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
  signed-in user; no Aadhaar). If `inAppMessaging` is on it `queueOwnerChat(p, { firstMessage })`
  (a real chat request the owner accepts in Messages); if off it just toasts "enquiry sent". It does
  **not** create a `contact_request` or an `enquiries` row.

### Owner lead inbox (`EnquiriesPanel.jsx`)
- Aggregates several request types into one normalized **lead descriptor** and a priority queue
  (attention-first, then longest-waiting):
  - **Number requests** (`contact_requests`) - approve = "Share", decline; approved reveals the
    buyer's mobile for Call/WhatsApp.
  - **Photo requests**, **Document requests** (grouped per buyer+property; grant/decline all),
    **Flat-share requests** (accept/decline), and **Enquiries** (seed).
- **Triage math:** `waitingOnYou` = pending contacts + pending share-flat + photo reqs + pending doc
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
- **Cross-prototype storage:** the `puneNestContactReq:<ownerDigits>` key is shared with the HTML
  prototype, so requests must stay compatible.
- **`pn:store` event:** owner-pref changes dispatch a `pn:store` CustomEvent so open tabs re-render
  without reload (a lightweight in-app pub/sub the backend would replace with push).

## 9. Current mock implementation
- **Service:** `src/services/contactService.js` (`getContactReqs`, `contactStatus`,
  `requestContact`, `setContactStatus`, `pendingContactCount`, `isOwnerViewer` - all Promises).
- **Provider:** `src/services/providers/mock/contactProvider.js` (wraps `lib/contact.js`).
- **Core lib:** `src/lib/contact.js` (`requestContact`, `contactStatus`, `setContactStatus`,
  `maskPhone`, `fmtPhone`, `digits`, `getContactReqs`, `pendingContactCount`, owner-prefs
  `getOwnerPrefsFor` / `setOwnerPrefs` / `ownerHidesNumber` / `ownerVerifiedOnly`). Opt-in
  Verified-badge helpers in `src/lib/store/listings.js` (`isAadhaarVerified`, `setAadhaarVerified`,
  `getAadhaarVerification`) — read only for the badge, not as a contact prerequisite.
- **Data/seed:** `src/data/enquiries.json` (owner Enquiries tab, demo-only).
- **Key components:** `property/ContactBox.jsx`, `property/ContactOwnerModal.jsx`,
  `components/auth/AadhaarVerifyModal.jsx`, `dashboard/EnquiriesPanel.jsx`, `dashboard/LeadSheet.jsx`,
  `dashboard/useDashboardData.js` (`decideContact`), `src/lib/leadNotes.js`.

## 10. Target API endpoints
Map to [`../../system/api-contract.md`](../../system/api-contract.md) (sections 6 & 7):
- `POST /me/verification/aadhaar` -> DigiLocker consent URL; a `DIGILOCKER_VERIFICATION_SUCCESS`
  webhook confirms -> `{ verified, source: 'digilocker', maskedAadhaar, … }`;
  `GET /me/verification/aadhaar` -> badge status. **(Opt-in L2 Verified badge — never required to
  contact.)**
- `GET /contacts/status?ownerMobile=&propertyId=` -> current status.
- `POST /contacts/request { ownerMobile, propertyId }` -> `{ status: 'pending' }`, or **`401`/login**
  if not signed in, or **`403 { "error": "verification_required" }`** *only* when the owner set
  `verifiedContactOnly` and the requester lacks the badge. **No Aadhaar gate on contact.**
- `GET /me/contact-requests` (owner inbox), `PATCH /me/contact-requests/:reqId { status }`
  (approve/decline).
- **Missing but implied:** an enquiry/message create endpoint (so the "send enquiry" path produces a
  real, persisted, owner-scoped lead), a photo-request and document-request endpoint, and
  lead-annotation (note/follow-up) endpoints.

## 11. Backend responsibilities
- **Own the opt-in Verified badge, not a contact gate.** DigiLocker/KYC issuance and the
  one-identity-one-badge invariant (composite `identity_hash`, ADR-009b) must be server-enforced, but
  they belong to the **opt-in badge flow** — they must **never** gate contacting an owner. A
  localStorage `verified` flag is not security; the badge is a trust signal.
- **Never ship the raw owner number to an unapproved client.** Return it only after the server
  confirms an `approved` request AND the owner's privacy pref allows it; otherwise return the masked
  form or a chat handle. Reject request creation with `401`/login when unauthenticated, or
  `403 verification_required` **only** when the owner set `verifiedContactOnly` and the requester
  lacks the badge — not an Aadhaar gate.
- **Authorize the checker:** only the property owner may approve/decline their own contact requests;
  apply the side-effect (reveal) transactionally and write an audit entry (cross-cutting section 4).
- **Persist real leads:** unify contact requests, enquiries and chat requests into an owner-scoped
  lead store with proper foreign keys (buyer `users.id`, `properties.id`) instead of mobile-keyed
  localStorage; close the seed-only `enquiries` gap so live buyer intent is a durable lead.
- **Generate notifications** for approvals/declines server-side (cross-cutting section 7).
- **Rate-limit / anti-spam** request creation; the client must not be trusted to gate itself.
