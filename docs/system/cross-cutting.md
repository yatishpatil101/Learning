# Cross-cutting Patterns

This is the foundation document for PuneNest. It defines the patterns that are reused across
every feature so that individual flow docs can link here instead of re-explaining them. Whenever
a flow doc mentions auth, an approval/verification step, the contact or Aadhaar gate, soft-delete,
audit, pagination, the provider seam, or notifications, it points back to the relevant section
below.

Two hard truths frame everything here (see [`./platform-architecture.md`](./platform-architecture.md)):

- **The mock layer is the business logic today.** All of the rules below are currently enforced
  in browser JavaScript over `localStorage`. Every rule marked "MUST be server-enforced" is a
  trust boundary that a real backend has to own.
- **There is no real security yet.** Route guards, roles, and gates are UX conveniences backed by
  editable `localStorage`. They shape the experience; they do not protect data.

Related docs:
- [`./data-model.md`](./data-model.md) - ER map + persistence design (field shapes → OpenAPI schemas).
- [`OpenAPI spec`](../../backend/src/main/resources/static/openapi/punenest-api.yaml) - the REST API contract the future backend must expose.
- [`./platform-architecture.md`](./platform-architecture.md) - overall system shape and the provider seam.

---

## 1. Auth and roles

### Roles

The session user carries a `role`. The **canonical auth roles are defined by the `Role` schema in the
[OpenAPI spec](../../backend/src/main/resources/static/openapi/punenest-api.yaml)**: `buyer`,
`owner`, `staff`, `admin`. This section only explains how they behave; it does not redefine the enum.

- `buyer` - property seekers (the default; also covers tenants — "Buyer / Tenant").
- `owner` - property owners / landlords.
- `admin` - platform super-admin; bypasses team scoping and module scoping.
- `staff` - internal ops team member, scoped to one or more `teams` (`rental`, `legal`, `interior`,
  `packers`, `valuation` — the `Team` schema in the spec).
- `manager` / `member` are **admin-RBAC permission labels, not auth roles** (see `roleLabel` in
  `src/lib/auth.js`); they never appear in the JWT `role` claim.

`isInternal(user)` (in `src/lib/auth.js`) treats `admin`, `manager`, and `staff` as back-office.

### Session storage and the two login doors

Session state lives in `localStorage`/`sessionStorage` under the key `puneNestUser`, managed by
`src/lib/auth.js`:

- `writeUser(user, remember)` - persists to `localStorage` when "remember this device" is on,
  otherwise `sessionStorage` (tab-scoped). Exactly one tier holds the session at a time.
- `loginUser(...)` - consumer login (`buyer` / `owner`), stamps `loginAt`.
- `staffLoginUser(...)` - back-office login; sets `role`, `team` (null for admin), `teams[]`,
  `roleId`, and `moduleAccess[]`.
- `logoutUser()` clears both tiers.

`src/context/AuthContext.jsx` exposes this to React via `useAuth()`, returning
`{ user, isIn, role, team, login, register, staffLogin, logout, update }`.

There are two separate login doors, wired into the route guards:

- **Consumer `/signin`** - buyers and owners. Unauthenticated access to a protected consumer
  route redirects here with a `?next=` return path.
- **Back-office `/staff-login`** - admin/staff. Role and team guards redirect here.

### Route guards

All guards live in `src/components/RouteGuards.jsx` and are wired in `src/App.jsx`. They shape the
UI; they are **not** the control. Every guarded API route carries `@PreAuthorize` over the same
permission atom, so a hand-edited client reaches a 403 rather than data.

| Guard | Rule | Redirect on failure |
|-------|------|---------------------|
| `ProtectedRoute` | requires a signed-in user (`isIn`) | `/signin?next=<path>` |
| `RoleRoute roles={[...]}` | `user.role` must be in the allowed list | `/staff-login` (configurable via `redirect`) |
| `ModuleRoute moduleKey="x"` | `canAccessModule(user, x)` - a set test against `user.permissions` from `GET /me` | `/admin` |
| `FlagRoute flag="x"` | admin tab feature flag enabled | `/admin` |
| `AppFlagRoute flag="x"` | consumer feature flag enabled | `/` |

Examples in `src/App.jsx`: the admin console is `RoleRoute roles={['admin']}`; consumer-only
pages (`/saved`, `/schedule-visit`, `/pay-rent`, ...) are `ProtectedRoute`, some nested inside
`AppFlagRoute`.

**`manager` is gone (D209).** It was never one of the contract's roles (`buyer|owner|staff|admin`) -
only a console label on a custom-role bundle whose storage V61 deleted, so it granted nothing. The
admin console is administrator-only; an ops account's atoms widen what the API does for it inside
`/ops`, not which shell it may load. `ModuleRoute` no longer resolves anything itself: the server
returns the caller's own atoms and the console tests membership.

**`TeamRoute` is gone.** It gated the five per-team ops desks (`/ops/rent-agreement`, `/ops/legal`,
`/ops/interior`, `/ops/packers`, `/ops/valuation`) on `x ∈ teams[]` and redirected to
`/ops?denied=x`. Those desks were retired — they read `localStorage` while the work had moved to
Postgres — and the routes now redirect into `/ops/drafting-desk?type=x`. Dropping the guard widened
nothing: `ServiceDeskAuthority.deskFilterFor` scopes a staff caller to their own desk and ignores a
`team` they do not own (D44), so the server was always the thing holding the line and the guard only
chose the error message. What replaced its *user-visible* role is the desk picker, which offers a
staffer their own desk and nothing else — an empty queue and a forbidden queue must not look alike.

> **MUST be server-enforced later.** Every guard above is cosmetic. The future backend must
> authenticate via Bearer JWT (see the [OpenAPI spec](../../backend/src/main/resources/static/openapi/punenest-api.yaml)) and authorize every
> request by role and team server-side. The client role/team is a hint, never a grant.

### Where a permission atom is deliberately *not* the guard

`PATCH /societies/{slug}/residents/{id}` guards on `isStaff` rather than on the `societies:write`
atom, and this is an accepted exception rather than an oversight.

The reason is that the endpoint has two legitimate callers with nothing in common. One is an ops
account working the residency queue, which is what the atom describes. The other is a **committee
member of that society** approving a neighbour's residency claim — a resident, holding no
back-office permissions at all, who would fail any atom check by construction. Gating on
`societies:write` would lock out the caller the feature exists for.

The cost is real and worth stating plainly: an ops account granted `societies:read` and *not*
`societies:write` can still approve and reject residents, because `isStaff` does not distinguish
them. A read-only ops account therefore keeps one write it was never granted.

That is accepted for now because the alternative — an `isStaff OR isCommitteeMemberOf(slug)`
disjunction — needs a committee-membership relation that does not exist yet, and the same missing
relation is what blocks several other society guards (see `ListingEditRules.requireSociety` on why
an owner can still name a society they have nothing to do with). When that relation lands, this
guard becomes the disjunction and the atom starts meaning what it says. Until then the exception is
documented here rather than left to be rediscovered from the code.

---

## 2. Maker-checker / approval pattern (defined once here)

**This is the canonical definition. All flow docs reference this section instead of restating it.**

Many PuneNest features share one shape: one party *proposes* a change, and a second party
*approves or rejects* it before it takes effect. This is the maker-checker (proposer-approver)
pattern. Documenting it once keeps every approval flow consistent.

### 2.1 Generic model

- **Maker** proposes an action (create a listing, request contact, request finalization, request
  a document). The proposal is recorded but has no side effect yet.
- **Checker** reviews the proposal and either **approves** (the side effects fire) or **rejects**
  (no side effects; the maker may fix and resubmit).
- Every proposal is a persisted record with a `status`, timestamps, and enough identity to know
  who the maker is. Approval writes an **audit trail** (see section 4).

### 2.2 Canonical state machine

```
draft/submitted  ->  pending  ->  approved  ->  [side-effects fire]
                          |
                          +--->  rejected  ->  [maker fixes, resubmits -> pending]
```

- **draft / submitted** - maker is preparing or has just proposed.
- **pending** - awaiting the checker. Terminal only if abandoned/cancelled by the maker.
- **approved** - checker accepted; side-effects apply and an audit entry is written.
- **rejected** - checker declined, usually with a reason; the maker can address it and resubmit,
  which returns the record to **pending**.

Intermediate states exist in some flows (for example the verification review adds `in_review` and
`clarification` between submitted and decided). They are refinements of "pending", not new
top-level stages.

### 2.3 Canonical example in real code: property verification

Grounded in `src/lib/data/properties-admin.js` and `src/pages/admin/AdminProperties.jsx`.

- **Maker = owner.** Creating a listing (`addListing` in `src/lib/mockApi/properties.js`) stamps
  `status: 'pending'`. The listing is not live.
- **Checker = admin / manager.** The admin Properties queue
  (`src/pages/admin/AdminProperties.jsx`, guarded by `RoleRoute roles={['admin','manager']}`)
  reviews each listing.
- **Review record.** `ensureReview(listing)` creates a `propertyReviews[id]` record with
  `status: 'in_review'`, a per-document checklist (`docs`, each `status: 'pending'`), a `messages`
  thread, `decision: null`, and `createdAt`/`updatedAt`.
- **Per-document verification.** `setDocStatus` / `setDocVerified` mark each required document
  `verified`. `addReviewMessage` supports owner<->admin clarification; an admin message flips the
  review to `clarification` unless already decided.
- **Decision.** `decideReview(id, 'approved'|'rejected', reason)` sets the review `status`, writes
  `decision = { type, reason, at }`, and appends a system message to the owner.
- **Side-effects on approval.** The admin handler pairs the decision with the listing status:
  `decideReview(id, 'approved')` + `setListingStatus(id, 'approved')` (listing goes live) and
  clears any `flagReason`. Rejection pairs `decideReview(id, 'rejected', reason)` with
  `setListingStatus(id, 'rejected')`. See `bulkApprove` / `submitBulkReject` in
  `AdminProperties.jsx`.
- **Audit.** Each action calls `logAudit('Listing'|'Listings', '...')` (section 4).

### 2.4 The same pattern in other contexts

| Context | Maker (proposes) | Checker (approves/rejects) | Approval side-effect | Code |
|---------|------------------|----------------------------|----------------------|------|
| Listing verification | owner submits listing | admin/manager | listing `status -> approved`, goes live | `properties-admin.js` `decideReview`, `mockApi/properties.js` `setListingStatus` |
| Deal finalization | buyer requests finalize | owner accepts/declines | accept closes the deal (`closeDeal`) and auto-declines the other pending requests for that property | `src/lib/store/deals.js` `requestFinalize` / `acceptFinalize` / `declineFinalize` |
| Contact reveal | buyer requests contact | owner approves/declines | owner phone unmasks for that buyer (subject to owner privacy prefs) | `src/lib/contact.js` `requestContact` / `setContactStatus` |
| Document access | buyer requests a doc category | owner grants/declines | on grant, matching uploaded docs are shared (`sharedDocIds`) | `src/lib/data/documents.js` `addDocRequest` / `respondDocRequest` |
| Visit request | buyer requests a visit slot | owner confirms/cancels | slot confirmed | see `visitProvider` / `PATCH /visit-requests/:id/status` |
| Offer / negotiation | buyer submits an offer | owner responds (accept/counter/decline) | accepted offer feeds finalization | `src/lib/store/deals.js` `addOffer` / `respondOffer` |
| Society claim | resident claims a society role | admin moderates | claim approved | `src/pages/admin/societies/ClaimsTab.jsx` |

In every row the record starts `pending`, is decided by the checker, and only then does the
side-effect fire. Reject-then-resubmit returns the record to `pending`.

> **MUST be server-enforced later.** Today the maker and checker operate on the same editable
> `localStorage`. The backend must (a) verify the maker's identity, (b) verify the checker is
> authorized for that entity (owner of the listing, admin for verification), (c) apply the
> side-effect transactionally, and (d) write the audit entry. The client must never be trusted to
> flip a `status` to `approved` on its own.

---

## 3. Contact and Aadhaar / verification gate

Lead contact information (owner phone numbers) is never exposed by default. It is gated behind two
layers, implemented in `src/lib/contact.js` and consumed by
`src/pages/consumer/property/ContactBox.jsx` / `ContactOwnerModal.jsx`.

### Layer 1 - Aadhaar identity gate (before a buyer may even ask)

`requestContact(ownerMobile, propId)` refuses to create a request unless the signed-in buyer has a
verified Aadhaar record in `localStorage` under `puneNestAadhaar:<mobile>` with `verified: true`.
Return values:

- `'login'` - no signed-in user.
- `'aadhaar_required'` - signed in but Aadhaar not verified. The UI routes to the Aadhaar OTP
  gate (`src/pages/consumer/list-property/AadhaarGate.jsx`), which confirms the mobile and verifies
  an OTP before setting the verified flag. The same gate protects listing creation (an owner must
  verify Aadhaar before posting).

### Layer 2 - Owner approval (maker-checker, section 2)

Once past the Aadhaar gate, the buyer's request is created with `status: 'pending'` and the owner's
number stays **masked** (`maskPhone`, for example `+91 98xxx xxxx02`). Status progression via
`contactStatus`:

- `'owner'` - the viewer is the owner themselves (`isOwnerViewer`); always sees the full number.
- `'pending'` - request created, awaiting owner. Number stays masked.
- `'approved'` - owner approved (`setContactStatus(..., 'approved')`); number can unmask.
- `'declined'` - owner declined; stays masked.
- `'none'` - no request yet.

### Trust rules

- **Owner privacy preference.** Even after approval, an owner who set `hideNumber`
  (`getOwnerPrefs` / `ownerHidesNumber` in `src/lib/contact.js`) keeps the raw number masked;
  approved buyers are routed to in-app chat / callback instead. This sits on top of the always-on
  request gate, it does not replace it.
- **Storage keys are shared with the HTML prototype** (`puneNestContactReq:<ownerDigits>`), so the
  two prototypes stay compatible.

> **MUST be server-enforced later.** The Aadhaar verification, the mask, and the approval check all
> run client-side today. The backend must own KYC/Aadhaar verification, return the number **only**
> after it confirms an approved request (see `POST /contacts/request` returning
> `403 { "error": "aadhaar_required" }` in the [OpenAPI spec](../../backend/src/main/resources/static/openapi/punenest-api.yaml)), and never
> ship the raw number to an unapproved client.

---

## 4. Soft-delete and audit

### Soft-delete (status flags and archive, not hard delete)

PuneNest prefers reversible archival over destructive deletes. The generic helpers live in
`src/lib/mockApi/core.js`:

- `archiveRecord(collection, id, reason)` sets `archived: true`, `archivedAt` (ISO-8601), and
  `archiveReason`. The record stays in the store; list views filter out `archived` items.
- `restoreRecord(collection, id, statusOverride)` sets `archived: false`, stamps `restoredAt`, and
  can reset `status` (listings restore to `pending`, so they re-enter verification).

Listings wrap these as `archiveListing` / `restoreListing` in
`src/lib/data/properties-admin.js`. The legacy `deleteListing` is retained only for backwards
compatibility and now delegates to `archiveListing` (there is no true hard delete in the property
path).

Lifecycle is also expressed through `status` flags rather than deletion: listings move across
`pending -> approved | rejected | flagged`, and `flagListing` / `clearFlag` toggle a `flagged`
state with a `flagReason` instead of removing anything.

### Timestamps

Records carry `created_at` / `createdAt` and `updated_at` / `updatedAt` (the review record stamps
`updatedAt` on every mutation; `addListing` stamps `createdAt` and `freshenedAt`). Archive/restore
add `archivedAt` / `restoredAt`. The future schema standardizes on `created_at` / `updated_at`
(see [`./data-model.md`](./data-model.md)).

### Audit trail (who / when / what)

`src/lib/mockApi/audit.js`:

- `logAudit(action, detail)` prepends an entry `{ id, at (ISO-8601), who, action, detail }` to a
  capped list (`auditLog`, max 200). `who` is resolved from the signed-in user via
  `currentStaffInfo()`. `listAudit()` / `clearAudit()` read/reset it.
- `addInternalNote` / `editInternalNote` / `getInternalNotes` are the **mock** half of the
  `note` domain, reached only through `services/providers/mock/noteProvider.js`. Live, notes are a
  table of their own (`internal_notes`) behind `GET|POST /admin/notes/{entityType}/{entityId}` and
  `PATCH /admin/notes/{id}`, gated on `notes:read` / `notes:write`. They are **mutable on purpose**
  — a note is retained customer information that goes stale, not a signature — and an edit records
  the previous wording on the audit row while leaving the original author on the note. There is no
  delete route, deliberately. See `docs/system/frontend-data-seam.md` for the domain registry.

Admin handlers fire `logAudit(...)` after every mutation (feature toggle, flag, archive, restore,
edit, bulk approve/reject, pipeline move) - see `src/pages/admin/AdminProperties.jsx`.

> **MUST be server-enforced later.** Audit and soft-delete are the record of who did what. The
> backend must write audit rows server-side (client-supplied `who` is not trustworthy), enforce
> who may archive/restore, and keep archived rows out of unauthorized reads.

---

## 5. Pagination, sorting, and filtering

The exact query params, the `PageEnvelope` wrapper, and the `?sort=`/`?page=&size=` conventions are
defined in the [OpenAPI spec](../../backend/src/main/resources/static/openapi/punenest-api.yaml)
(`info.description` + `PageEnvelope`/parameter schemas). This section only notes the *behaviour* the
mock layer approximates today.

- **Pagination & sorting:** zero-indexed `page/size`; `sort=field,direction`. Responses use the
  spec's `PageEnvelope`.
- **Filtering:** flat query params per resource (e.g. property search filters on deal, type,
  locality, bhk, price range, furnishing, free text) — see the spec for the authoritative list.
- **Archived filtering:** list endpoints exclude soft-deleted rows by default
  (`archived=false`); an explicit `archived=true` surfaces them for admin views.

In the mock today, filtering/sorting/paging happen in-memory inside the providers and page
components (for example `src/pages/admin/AdminProperties.jsx` computes counts and filters over the
full listing array). The `page/size/sort` contract is what those in-memory operations must map to
once the HTTP provider exists.

---

## 6. Provider seam and error shape

### The seam

Components never talk to `localStorage` or `fetch` directly. They import from a **service** module
(`src/services/*Service.js`), which delegates to the **active provider** selected in
`src/services/config.js`:

```
component  ->  services/xService.js  ->  createProvider('x')  ->  mock | http provider
```

- `VITE_API_MODE` selects the backend: `mock` (default, `src/services/providers/mock/*Provider.js`,
  localStorage) or `http` (`src/services/providers/http/*Provider.js`, future Spring Boot).
- Swapping mock <-> http is **one env variable**; no component changes. `createProvider(domain)`
  resolves and caches the provider via a **lazy** `import.meta.glob`, so it returns a *Promise* of
  the provider module and services await it: `(await provider()).foo(...)`. The glob must stay lazy
  — an eager one reinstates an import cycle that blanks the app at bootstrap (tech-debt D208), and
  `scripts/check-provider-cycle.mjs` fails the build if it comes back.
- **All service functions return Promises** regardless of provider, so the mock's synchronous
  localStorage wrappers and the future async HTTP calls are interchangeable (mock providers wrap
  sync helpers in `Promise.resolve(...)`).

Domains wired today: `property`, `auth`, `deal`, `contact`, `finance` (barrel:
`src/services/index.js`).

### Error shape

The HTTP provider must surface failures in the canonical shape defined by the `Error` schema in the
[OpenAPI spec](../../backend/src/main/resources/static/openapi/punenest-api.yaml): a stable machine
`error` code (for example `aadhaar_required`), a user-facing `message`, and the HTTP `status`.
Callers branch on `error`; UIs show `message`.

### Loading / empty / error UI states

Because every call is a Promise, each data-driven view handles three states:

- **Loading** - spinner while the Promise is pending (for example `ModuleRoute` renders a spinner
  while admin roles load).
- **Empty** - a distinct "nothing here yet" state when the resolved list is empty (saved
  properties, notifications, queues), never a blank screen.
- **Error** - render the `message` from the error shape with a retry affordance; do not swallow the
  rejection.

---

## 7. Notifications

In-app notifications are read from the server through `src/services/notificationService.js`.

> **Historical.** The bullets below describe `src/lib/store/notifications.js`, a per-user seed-once
> `localStorage` list that **no longer exists** — it was deleted with the mock provider lane. They are
> kept because the *shape* they describe (stable `id`, `read` flag, `at` timestamp, one list feeding
> both the page and the bell badge) is still the shape the server returns, and because the seed-once
> rule explains why a revisit never duplicated entries in the old demo build.

- Stored under `pnNotifications:<mobile>` (falls back to `anon`).
- `getNotifications()` returns the list; `seedNotifsIfEmpty(defaults)` stamps a stable `id`, an
  unread flag (`read: false`), and an `at` timestamp exactly once, so a revisit never duplicates
  seed entries.
- Each entry drives both the `/notifications` page and the header bell unread badge (one source of
  truth).

Notifications are the natural delivery channel for maker-checker outcomes (contact approved, deal
finalized, listing verified/rejected). The review thread in property verification
(`addReviewMessage` in `properties-admin.js`) plays the same role owner<->admin, carrying the
approval/rejection message with a `read` flag.

Related store events: `src/lib/contact.js` dispatches a `pn:store` `CustomEvent` on owner-pref
changes so open tabs can react without a reload - a lightweight in-app pub/sub the real backend
would replace with push/websockets.

> **MUST be server-enforced later.** Notification generation belongs on the server as a side-effect
> of approvals and state changes, not something the client seeds for itself.
