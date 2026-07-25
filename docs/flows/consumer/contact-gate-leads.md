# Flow: Contact Reveal & Leads (Enquiries)

> How an owner's phone number is gated behind identity + owner approval, how a buyer's request
> becomes a lead, and how the owner triages that lead.
> **Status:** documented from React source - **Primary role(s):** buyer/tenant (maker), owner (checker)

---

## 1. Purpose & user problem
- **Persona:** a buyer/tenant who wants to reach the owner; the owner who wants genuine, spam-free
  leads and control over who gets their number.
- **Job-to-be-done (buyer):** "Get the owner's number / start a chat about this listing." **(owner):**
  "Only share my number with verified people, and manage every incoming request in one inbox."
- **Why it matters:** this is the conversion event of the whole product - the zero-brokerage promise
  is "connect directly with verified owners." Gating protects owner privacy and lead quality; the
  lead inbox is the owner's CRM.

## 2. Entry points
- **Buyer side (create a request):** the property detail page - `ContactBox.jsx` ("Request number")
  and `ContactOwnerModal.jsx` ("Send enquiry"), and the sticky mobile CTA + map detail panel. Route:
  `/property/:id`.
- **Identity gate popup:** `src/components/auth/AadhaarVerifyModal.jsx`.
- **Owner side (triage leads):** dashboard Enquiries/Leads tab -
  `src/pages/consumer/dashboard/EnquiriesPanel.jsx` + `LeadSheet.jsx`, fed by
  `useDashboardData.js`. Route: `/dashboard` (owner view), `ProtectedRoute`.
- **Core logic:** `src/lib/contact.js`, `src/lib/store/listings.js` (Aadhaar helpers),
  `src/services/contactService.js`, `src/services/providers/mock/contactProvider.js`.

## 3. Actors & roles
- **Maker = buyer/tenant** (signed-in, Aadhaar-verified) requests the number or sends an enquiry.
- **Checker = owner** approves/declines from the dashboard.
- **`isOwnerViewer`** (viewer mobile == owner mobile) always sees the full number (`status:'owner'`).
- The gate is defined once in [`../../system/cross-cutting.md`](../../system/cross-cutting.md)
  (section 3); this doc is the flow-level detail.

## 4. Entities touched
- [`contact_requests`](../../system/domain-model.md) - created by the buyer, decided by the owner.
  Runtime store, key `puneNestContactReq:<ownerDigits>` (shared with the HTML prototype).
- [`aadhaar_verifications`](../../system/domain-model.md) - read as the identity gate; written by
  `AadhaarVerifyModal` (key `puneNestAadhaar:<mobile>`).
- [`enquiries`](../../system/domain-model.md) - the owner's "Enquiries" tab is **seed-only** today
  (`src/data/enquiries.json`); the buyer contact flow does **not** create rows here (see edge cases).
- Owner privacy prefs (`pnOwnerPrefs:<mobile>`, `hideNumber`) and lead annotations
  (`leadNotes`, private note + follow-up date) are read/written on the owner side.

## 5. Business rules & logic  *(the meat)*

### Two-layer gate (from `src/lib/contact.js`)
**Layer 1 - Aadhaar identity gate (before a request can even be created).**
`requestContact(ownerMobile, propId)`:
- Returns `'login'` if no signed-in user.
- Reads `puneNestAadhaar:<buyerDigits>`; if missing or `!verified`, returns `'aadhaar_required'`.
- The UI (`ContactBox.request` / `ContactOwnerModal.request`) opens `AadhaarVerifyModal` on
  `'aadhaar_required'`, verifies the Aadhaar-linked mobile by OTP (mock: any 6 digits), calls
  `setAadhaarVerified(mobile)` (`{ verified: true, aadhaarMobile, at }`), then resumes the original
  action via `onVerified()`.
- **One Aadhaar = one mobile:** the modal pins verification to the signed-in number when valid; if
  the user says it's a different number, it routes them back to `/signin` to re-auth with their
  Aadhaar-linked mobile (`mismatch` branch). The same gate protects listing creation and society
  contributions (`isAadhaarVerified()` -> `'kyc'`).

**Layer 2 - Owner approval (maker-checker).**
Once past Layer 1, `requestContact`:
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
- "Send enquiry" is also "contacting the owner", so it shares the Aadhaar gate. Once verified: if
  `inAppMessaging` is on it `queueOwnerChat(p, { firstMessage })` (a real chat request the owner
  accepts in Messages); if off it just toasts "enquiry sent". It does **not** create a
  `contact_request` or an `enquiries` row.

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
Aadhaar:  unverified --(OTP verify)--> verified   (prerequisite; else 'aadhaar_required')

Contact request (per buyer+property):
  none --requestContact--> pending --owner approve--> approved --> number unmasks*
                              |                                   (*unless owner hideNumber -> chat)
                              +--owner decline--> declined (masked, terminal)
  owner viewer -> always 'owner' (full number)
```
- **Terminal:** `approved` and `declined`. A re-request while a record exists returns the current
  status (no duplicate).

## 8. Edge cases, validation & error states
- **Not signed in:** `requestContact` returns `'login'`; UI toasts "sign in to request the number".
- **Not Aadhaar-verified:** `'aadhaar_required'` -> verify modal, not a request.
- **Aadhaar number mismatch:** modal routes back to `/signin` to re-auth with the Aadhaar-linked
  mobile (one Aadhaar maps to one mobile).
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
  `getOwnerPrefsFor` / `setOwnerPrefs` / `ownerHidesNumber`). Aadhaar helpers in
  `src/lib/store/listings.js` (`isAadhaarVerified`, `setAadhaarVerified`, `getAadhaarVerification`).
- **Data/seed:** `src/data/enquiries.json` (owner Enquiries tab, demo-only).
- **Key components:** `property/ContactBox.jsx`, `property/ContactOwnerModal.jsx`,
  `components/auth/AadhaarVerifyModal.jsx`, `dashboard/EnquiriesPanel.jsx`, `dashboard/LeadSheet.jsx`,
  `dashboard/useDashboardData.js` (`decideContact`), `src/lib/leadNotes.js`.

## 10. Target API endpoints
Map to [`../../system/api-contract.md`](../../system/api-contract.md) (sections 6 & 7):
- `POST /me/verification/aadhaar { aadhaarMobile, otp }` -> `{ verified, aadhaarMobile, at }`;
  `GET /me/verification/aadhaar` -> status. (Layer 1.)
- `GET /contacts/status?ownerMobile=&propertyId=` -> current status.
- `POST /contacts/request { ownerMobile, propertyId }` -> `{ status: 'pending' }` or
  **`403 { "error": "aadhaar_required" }`** (Layer 1 enforced server-side).
- `GET /me/contact-requests` (owner inbox), `PATCH /me/contact-requests/:reqId { status }`
  (approve/decline).
- **Missing but implied:** an OTP-send endpoint for the Aadhaar mobile, an enquiry/message create
  endpoint (so the "send enquiry" path produces a real, persisted, owner-scoped lead), a photo-
  request and document-request endpoint, and lead-annotation (note/follow-up) endpoints.

## 11. Backend responsibilities
- **Own KYC/Aadhaar verification.** Real Aadhaar OTP verification and the one-Aadhaar-one-mobile
  invariant must be server-enforced; "any 6 digits" and a localStorage `verified` flag are not
  security.
- **Never ship the raw owner number to an unapproved client.** Return it only after the server
  confirms an `approved` request AND the owner's privacy pref allows it; otherwise return the masked
  form or a chat handle. `403 aadhaar_required` before any request is created.
- **Authorize the checker:** only the property owner may approve/decline their own contact requests;
  apply the side-effect (reveal) transactionally and write an audit entry (cross-cutting section 4).
- **Persist real leads:** unify contact requests, enquiries and chat requests into an owner-scoped
  lead store with proper foreign keys (buyer `users.id`, `properties.id`) instead of mobile-keyed
  localStorage; close the seed-only `enquiries` gap so live buyer intent is a durable lead.
- **Generate notifications** for approvals/declines server-side (cross-cutting section 7).
- **Rate-limit / anti-spam** request creation; the client must not be trusted to gate itself.
