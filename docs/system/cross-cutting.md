# Cross-cutting Patterns

This is the foundation document for Draazy. It defines the patterns that are reused across
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
- [`OpenAPI spec`](../../backend/src/main/resources/static/openapi/draazy-api.yaml) - the REST API contract the future backend must expose.
- [`./platform-architecture.md`](./platform-architecture.md) - overall system shape and the provider seam.

---

## 1. Auth and roles

### Roles

The session user carries a `role`. The **canonical auth roles are defined by the `Role` schema in the
[OpenAPI spec](../../backend/src/main/resources/static/openapi/draazy-api.yaml)**: `buyer`,
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

Session state lives in `localStorage`/`sessionStorage` under the keys `draazyUser` (the cached
profile) and `draazyTokens` (the 15-minute access token), managed by `src/lib/auth.js`:

- `writeUser(user, remember)` - persists to `localStorage` when "remember this device" is on,
  otherwise `sessionStorage` (tab-scoped). Exactly one tier holds the session at a time.
- `writeTokens(tokens, remember)` / `readAccessToken()` - the same two-tier plumbing for the access
  token. `sessionRemembered()` reports whether the session was meant to outlive the browser, so a
  refresh can restate `remember` to the server and the cookie stays scoped to match. It reads the
  server's session-hint cookie whenever that is readable, and falls back to the tokens' own storage
  tier only when it is not (the sibling-subdomain topology in §5.7.1). The ordering is the wrong way
  round from the obvious one, deliberately: the tier records where the last write *landed*, not what
  the user *asked for*, and `persistTokens` breaks the equivalence on purpose by demoting to the
  tab-scoped tier when `localStorage` is unwritable while keeping the 30-day cookie. Read the tier
  back as the choice and one transient `QuotaExceededError` becomes permanent - the next rotation
  says "not remembered", the server swaps the 30-day cookie for a session one and rewrites the hint
  to `0`, and the record of the choice is gone from both places. The hint has neither failure mode:
  it is the server's own record of what it was told, and being server-set it survives the ITP wipe
  that destroys the tier evidence entirely. Where the rotated token may actually be written stays a
  separate question, asked at the write by `localStorageWritable()`.
- `logoutUser()` clears both keys from both tiers, and expires the session-hint cookie. That last
  part is not redundant with the server's own clear on `/auth/logout`: that call is best-effort, so
  a sign-out on a flaky connection would otherwise leave a hint beside an unrevoked refresh cookie
  and the next cold boot would sign the user back in.

The rotating refresh token is deliberately absent from all of this: the server sets it as an
`HttpOnly; Secure; SameSite=Lax` cookie named `__Host-draazy_rt` at path `/`, so it is unreadable
from JavaScript. `services/http.js` sends every request with `credentials: 'include'`.
Clearing it is the server's job, on `POST /auth/logout`.

The path is `/` rather than the narrower `/api/auth` it once was, and the trade is deliberate. Path
scoping only ever defended against *our own* code forwarding or logging a request that carried the
cookie, and nothing in this backend logs cookies or headers. The `__Host-` prefix defends against
something we cannot otherwise stop: a browser refuses to store a cookie of that name unless it is
`Secure`, has no `Domain` and sits at `Path=/`, which is the only mechanism that makes host-only
scoping *enforced* rather than merely intended. Without it, any other host under the registrable
domain - a marketing subdomain, a third-party SaaS on a CNAME, anything a dangling DNS record can be
claimed by - can put a `Domain=.draazy.in` cookie of the same name in the jar, and neither our
clear nor the client's can remove it. That is session fixation: the victim's next cold boot restores
the *attacker's* session. Giving up path scoping to buy that is a bargain.

Both cookies are named for the deployment they are in: `secure=true` (production) gets the
`__Host-` prefix, `secure=false` (dev and e2e, plain HTTP) gets the bare names, because a browser
would reject a prefixed cookie without `Secure` outright. Nothing hardcodes either spelling -
`RefreshCookie.name()` and `RefreshCookie.hintName()` are the only source, and
`RefreshCookieNamingTest` pins both shapes so the production one is not left untested by the
profile every suite happens to run on.

A second cookie rides beside it and is deliberately **not** `HttpOnly`: `__Host-draazy_session`
(path `/`, value `1` for a remembered session and `0` for a tab-scoped one, same lifetime, `Secure`
and `SameSite` as the refresh cookie). Safari's Intelligent Tracking Prevention evicts
script-writable storage - `localStorage`, `sessionStorage`, IndexedDB, `document.cookie` writes -
after seven days without first-party interaction, but leaves server-set cookies alone. So a user who
asked to be remembered for 30 days arrived on day eight with empty storage and a perfectly good
refresh cookie that nothing would ever spend, because an absent access token reads as "signed out"
everywhere else in the client. The hint is what tells "signed out" apart from "storage was cleared
underneath a live session", and it is why the cold boot spends exactly one `/auth/refresh` for the
users who have something to recover and nothing for the anonymous majority. Its value carries the
second bit because `remember` has to be restated on every rotation - the browser says nothing about
the lifetime of the cookie it presents - and the state that used to answer that question is exactly
the state ITP destroys. It carries no identity and no secret: an XSS that reads it learns only what
a bare `POST /auth/refresh` would already have told it. Both `POST /auth/logout` and every 401 from
`POST /auth/refresh` clear it, so a revoked session converges instead of retrying forever.

Because the hint is meant to be *read by the page*, and `document.cookie` is scoped by host while
`__Host-` forbids the `Domain` attribute that would widen it, the hint only reaches a UI served from
the API's own host. That makes the two supported deployment topologies unequal: behind a path proxy
(one origin serving the app and forwarding `/api`) everything works, whereas on sibling subdomains
(`www.` calling `api.`) the refresh cookie is still delivered - `SameSite=Lax` cares about site, not
origin - but the hint is invisible and the ITP recovery is silently inert. `CookieDeliveryCheck`
refuses to boot on a genuinely cross-*site* UI and logs a warning naming this second case, because a
feature that is dead only in production is exactly the failure mode that class exists to end. The
repair is the path proxy, never a `Domain` on the hint - that would reopen the shadowing above.

The writers are the auth provider, not this module: `loginUser`/`staffLoginUser` lived here while
the app was localStorage-backed and are gone. `services/providers/http/authProvider.js` calls
`writeUser` with whatever `POST /auth/login`, `POST /auth/staff-login` or `GET /auth/me` returned.

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
> authenticate via Bearer JWT (see the [OpenAPI spec](../../backend/src/main/resources/static/openapi/draazy-api.yaml)) and authorize every
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

Many Draazy features share one shape: one party *proposes* a change, and a second party
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
verified Aadhaar record in `localStorage` under `draazyAadhaar:<mobile>` with `verified: true`.
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
- **Storage keys are shared with the HTML prototype** (`draazyContactReq:<ownerDigits>`), so the
  two prototypes stay compatible.

> **MUST be server-enforced later.** The Aadhaar verification, the mask, and the approval check all
> run client-side today. The backend must own KYC/Aadhaar verification, return the number **only**
> after it confirms an approved request (see `POST /contacts/request` returning
> `403 { "error": "aadhaar_required" }` in the [OpenAPI spec](../../backend/src/main/resources/static/openapi/draazy-api.yaml)), and never
> ship the raw number to an unapproved client.

---

## 4. Soft-delete and audit

### Soft-delete (status flags and archive, not hard delete)

Draazy prefers reversible archival over destructive deletes. The generic helpers live in
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
defined in the [OpenAPI spec](../../backend/src/main/resources/static/openapi/draazy-api.yaml)
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
[OpenAPI spec](../../backend/src/main/resources/static/openapi/draazy-api.yaml): a stable machine
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

- Stored under `dzNotifications:<mobile>` (falls back to `anon`).
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

---

## 8. The backend security filter chain

The reasoning behind `com.draazy.api.security.SecurityConfig`, `WriteRateLimitFilter` and
`MaintenanceModeFilter`. It lives here rather than in those files' comments so the code stays
readable; the code carries one-line pointers back to this section.

### 8.1 Chain shape and filter order

One stateless resource-server chain. No sessions, no CSRF token, default posture `authenticated`;
401/403 render the contract envelope via `RestAuthEntryPoint` / `RestAccessDeniedHandler`.

Three filters are added and **the order is load-bearing**:

1. `JwtAuthFilter` — resolves the bearer token.
2. `WriteRateLimitFilter` — counts the request against whoever that turned out to be. The reverse
   order would leave every authenticated caller sharing an address-keyed bucket.
3. `BotDefenceFilter` — challenges the small set of writes anyone on the internet may post to. Last
   of the three because it is the only one that can make a network call, so a flood should already
   have been refused by the counter.

`MaintenanceModeFilter` is added after `BotDefenceFilter`: the two cheap in-memory defences refuse a
flood before this one asks the database anything, and it has to sit after the JWT filter because it
is answered by a caller's role.

`BotDefenceFilter` is registered unconditionally, unlike the rate limiter: whether it does anything
is decided by which `BotDefence` bean was wired, not by whether the filter is in the chain. One
shape in every environment means the enabled and disabled paths cannot drift, and with the no-op the
per-request cost is a single boolean read. Exactly one `BotDefence` bean always exists (Turnstile
when the flag is on, the no-op otherwise via `matchIfMissing`); it is constructor-injected so a
misconfiguration producing none — or both — fails at startup rather than on the first anonymous form
submission in production.

`RoleSource` is a bean-method parameter rather than a constructor field: it is backed by a JPA
repository, and a `@Configuration` class holding one forces the persistence infrastructure to
initialise ahead of the bean post-processors meant to decorate it. Resolved at chain-assembly time
it is an ordinary singleton lookup.

The rate limiter is switched off for the test run (`src/test/resources/application.properties`):
~700 MockMvc tests all present as one anonymous caller from 127.0.0.1, so a shared bucket would fail
whichever test happened to run 121st. `WriteRateLimitTest` turns it back on with a budget small
enough to reach deliberately.

### 8.2 Why CSRF stays disabled even though a cookie exists

Every mutation authenticates by an `Authorization` header, which no foreign origin can set. The
single exception is `POST /auth/refresh`, which authenticates by the `draazy_rt` cookie
(`identity.auth.RefreshCookie`) alone — and that cookie carries an explicit `SameSite=Lax` (not the
defaulted variety, so Chrome's Lax+POST intervention window does not apply) on a route with no GET
mapping, so a forged cross-site POST arrives with no cookie at all. **If a cookie is ever accepted
for anything else, or that attribute is loosened to `None`, this decision has to be revisited.**

The seam `Lax` does not cover: it is a statement about *sites*, so a sibling subdomain under the same
registrable domain clears it and could drive `/auth/refresh` on a visitor's behalf. No CSRF token
would be reached in time to matter, so that case is settled at the endpoint by
`identity.auth.RefreshOriginGate`, which refuses to rotate for an origin we do not serve.

### 8.3 `Referrer-Policy: no-referrer`

Spring Security's own defaults already send `nosniff`, `DENY` and `no-store`. The one it does not
send is `Referrer-Policy`, and this API has a route that needs it: `GET /documents/shared` carries a
bearer credential in its query string, so any URL of ours a browser holds is a secret it must not
forward. `no-referrer` rather than the frontend's `strict-origin-when-cross-origin`, because that
policy still sends the full URL — path and query — on same-origin requests, and an API has no
navigation for a `Referer` to be useful to. The static frontend sets its own, looser policy in
`netlify.toml`; the two are independent hosts and independent decisions.

### 8.4 How the public-route matchers are written

Application routes are referenced through `Routes` constants rather than string literals: this file
and the controllers must agree on every path, and a silent typo is a security defect (an endpoint
left guarded that should be public, or a matcher too broad). The docs/actuator paths stay literal —
they belong to the framework and have no controller to drift from.

Three rules hold across the whole `permitAll` block:

- **Per-method, never path-only.** Several routes serve a public GET and an authenticated POST on
  the identical path (the two review routes, `/flatmates/posts`, `/properties/{id}/split`), so a
  path-only `permitAll` would silently open the write side.
- **Exact-path and single-segment.** `ANY_SINGLE` matchers are deliberately one segment, which is
  what keeps `/{id}/archive` and the society residency queue authenticated. Any public two-segment
  child therefore needs its own line — `Routes.Properties.ROOMS`, `Societies.MEMBERSHIP`,
  `Societies.QUESTIONS/BOARD/CONTRIBUTIONS/PROPOSALS`. `TRUST_STATS` is named explicitly even though
  `ANY_SINGLE` would already match it, so that a public endpoint is public by decision rather than
  by accident of path depth.
- **Narrow the payload, not just the route.** `GET /owners/{id}` is the only public route that reads
  the users table; the response is capped in `OwnerProfileResponse` and the mobile masked in the
  service. The anonymous society reads withhold a recommended person's number and the resident-group
  invite. The public room and flatmate payloads carry no contact detail.

Why each public family is public:

| Family | Why anonymous |
|---|---|
| `/auth/login`, `/auth/staff-login`, `/auth/refresh`, `/auth/staff-invite/redeem` | The caller holds no session; for the invite redeem, the single-use token **is** the credential, verified in `StaffInviteService`. |
| Catalogue reads (properties, cities, localities, societies, reels, fees) | The pages a visitor sees before deciding whether to sign up at all. |
| `/flags`, `/pricing`, `/plans`, `/boosts/packs`, `/services`, `/move-pack`, `/geo` | These toggles and prices decide what a logged-out visitor sees, so an admin-only reader cannot be the client's source for them. Each is scoped to one block of the settings document, so the rest of `/admin/settings` (fees, permissions, `adminFlags`, the referral auto-qualify threshold, blacklist reasons) stays admin-only. `/move-pack` is separate from `/flags` because the latter's contract is map-of-boolean and would have to drop the prices; the switch travels with the prices it gates so configuration that must be consistent cannot arrive half-applied. |
| `POST /cities/waitlist`, `POST /society-leads`, `POST /service-waitlist` | The people these exist for are not users and may never become any — a 400-flat society's secretary should not have to create an account to say hello. POST-only; reading the leads back is staff/admin, because each row is a name and a mobile number. Each is additionally rate-limited per mobile in its service, and the waitlist is challenged in `BotDefenceFilter`. |
| `POST /demand-signals`, `POST /page-views` | The two high-volume kinds fire on public surfaces, and the demand most worth measuring belongs to the visitor who left without signing up. Write-only by design: the aggregate is on `/admin/supply-gap`, because a public read would hand a competitor a locality-by-locality map of what Draazy is short of. |
| `GET /documents/shared` | The link is forwarded to a lawyer or banker with no Draazy account; the unguessable, expiring share token **is** the credential, checked in `DocumentRequestService.shared`. |
| Cashfree DigiLocker / payment webhooks | Server-to-server, no user session; authenticity is an HMAC over the raw body, verified in the handler. |

### 8.5 Write rate limiting

**A filter, opt-out rather than opt-in.** A rule that must be remembered at every new endpoint is
eventually forgotten at the one that matters, and several writes here cost real money or notify a
real person. It runs before authorisation, so refusing costs a map lookup rather than the database
round trip it is trying to prevent.

**The budget is not a performance figure.** It sits far above what a person does and far below what
a script wants; nothing legitimate should ever see a 429 from here, which is the test of whether the
number is right.

**Reads are untouched**, because a GET is cheap, cacheable, idempotent and often anonymous, and
`spring.data.web.pageable.max-page-size` is what bounds read amplification. Two exceptions:
`GET /documents/shared`, where the attack is enumeration — the shape a rate limit answers and an
authorisation rule cannot — and `GET /me/data-export`, which is ~70 queries assembled in memory and
uncacheable because a point-in-time statement must not be stale. The export path is a literal because
this package deliberately imports nothing from a feature package, so a rename fails open and
silently; `WriteRateLimitTest.dataExportIsLimited` drives a real request through the filter.
Membership is tested on path and not method, because Spring MVC dispatches HEAD to `@GetMapping`
handlers and merely suppresses the body — allowing HEAD through unlimited would make the enumeration
defence bypassable by a one-character change.

**Provider callbacks get their own budget rather than an exemption.** They cannot share the ordinary
bucket: they arrive from a handful of provider addresses, and a refused callback is a customer who
paid and was not credited. Nor may they be exempt — they are `permitAll`, so an attacker can send
them, and the HMAC only rejects an unsigned body after the container has buffered it and the handler
has materialised it as a string. The 50× multiplier is sized for a provider replaying a backlog after
an outage, all from one address, while still bounding an anonymous flood to something the heap
survives. It is computed as a `long` and clamped: at `int` width the multiplication wraps above
42,949,672 and would quietly hand the callbacks a *smaller* budget than everyone else.

**Callback bodies are capped at 64 KiB.** Nothing else bounds them: Tomcat's `maxPostSize` covers
only form encoding and `spring.servlet.multipart` only multipart, so an `application/json` body is
unlimited in this stack. The handler takes the raw body as a `String` because the signature is over
exact bytes, so an unsigned body is materialised on the heap roughly three times before the HMAC is
consulted; a real Cashfree callback is a couple of kilobytes. A negative `Content-Length` means
unknown (`Transfer-Encoding: chunked`) and passes any `> cap` test, so it is refused too — otherwise
the ceiling is bypassable by one request header. The constant is `64L * 1024` so the expression stays
in `long`: at `int` width, raising it past 2 GiB overflows negative and the bound inverts.

**Bucket keys.** Prefixed by kind (`u:`, `ip:`, and separate `w`/`cb` store namespaces) so a user id
can never collide with an address, and so one namespace cannot add every instance's callbacks to
every instance's users on a shared Redis backend. Anonymous writes fall back to the client address,
which is only sound if `getRemoteAddr()` really is the client's: behind an undeclared load balancer
every anonymous caller shares one bucket and a single host can 429 the platform. `TrustedProxyConfig`
makes the topology an explicit declaration; the filter logs loudly — **once**, because a line per
request would be an unauthenticated log-amplification tap — the first time `X-Forwarded-For` arrives
while that declaration says nothing is in front. The header is never read for keying, as that would
let every caller choose their own bucket. An IPv6 address is collapsed to its /64, because a single
host is routinely assigned an entire /64 and can source from any address in it at no cost; the cost
is that distinct users behind one /64 share a bucket, the trade already accepted for IPv4 behind a
carrier NAT. `isNumericIpv6` guards `InetAddress.getByName`, which resolves anything that is not a
literal — a non-numeric argument would turn a key derivation into a blocking DNS lookup on the
request thread.

**Path normalisation closes specific bypasses.** `getRequestURI()` is raw while the dispatcher routes
on the decoded path, so a raw comparison misses `/documents/share%64`; Spring's path matching also
excludes `;name=value` path parameters, so `/documents/shared;x=1` reaches the same handler. Decode
*then* cut, which is the order `UrlPathHelper` uses and is itself a bypass — cutting first leaves
`%3b` intact, so `/documents/shared%3Bx=1` would match nothing while still routing to the protected
handler. `StrictHttpFirewall` rejects both shapes today, which is why this is exercised rarely and no
reason to depend on it. Derived from `getContextPath()`/`getRequestURI()` rather than
`getServletPath()`, which agrees in a real container and not under MockMvc; a helper that behaves
differently in tests proves nothing.

**`Retry-After` is set as a header *and* carried in the message**: the header is what a well-behaved
client and every HTTP proxy understand, the message is what a person reads in a toast. The message
text is ASCII-only, because `SecurityErrors` hand-writes the body through the response writer without
pinning a charset and a punctuation flourish would reach the client as mojibake.

### 8.6 Maintenance mode

The client overlay is a statement about what one browser draws, not about what the platform accepts;
`MaintenanceModeFilter` is the half that holds against an open tab, a stale flag payload, a script or
curl.

**Writes only; reads are deliberately left alone.** The danger maintenance mode exists for — a
migration or backfill running while users mutate rows — is entirely on the write path. Blocking reads
would add a settings lookup to every anonymous GET, turn one slow tiny table into a total outage, and
remove the only thing a visitor can still usefully do. The "can this change state" answer is shared
with `WriteRateLimitFilter.MUTATING` rather than restated, since two copies drift the day a method is
added.

**Three exemptions, each of which would otherwise be a bug:**

- *Staff and administrators* must still be able to work, including in the back office where the
  switch that ends the window lives. Keyed on the authority `JwtAuthFilter` resolved, so no path list
  can fall behind the routes.
- *Everything under `/auth/`*, or the maintenance page's link to `/staff-login` is a dead end and the
  only way back in is a hand-edited row. Nothing under that prefix mutates consumer data.
- *Signed provider callbacks.* A payment or DigiLocker callback is a fact that already happened
  elsewhere; refusing it discards a write rather than preventing one, and money the customer has paid
  goes uncredited once the provider's retries run out. Listed by route constant rather than by prefix:
  a hole in a maintenance gate should be exactly two paths wide.

Exemption is checked before the flag is read, so an exempt caller costs no query. The flag itself is
read per write request, uncached: a cache would make switching on take effect "shortly", and the
whole value of the switch is that it takes effect now. If the settings table cannot answer,
`PlatformSettings.maintenanceMode()` propagates rather than guessing.

**503 and not 403:** a 403 makes every client offer to sign in as somebody permitted, which does not
end a maintenance window. No `Retry-After` — nobody knows how long the window is, and an invented
number is a false statement in a header clients act on.

## 9. Client-side seams: caching, commit-on-release, and shared overlays

### `lib/searchCache.js` — one result set, fetched at most once

A faceted search is not a stream of unrelated requests. It is a walk around a small graph of result
sets the user keeps returning to: they tick a filter and untick it, switch to the map and back, page
forward and back, open a property and press Back. Each of those returns to a set the browser already
has, and without a cache each one is a fresh round trip plus — on the listings endpoint — three SQL
statements, to be told something it was told a moment ago.

Three jobs, deliberately in one module because they share the same key and get them wrong
separately:

1. **Remember** a settled result for a short while, so going back to a set is free.
2. **Dedupe** concurrent reads of the same key, so React's StrictMode double-effect (and any
   re-render race) is one request rather than two.
3. **Cancel** a read nobody is waiting for any more. Superseded requests were already discarded on
   arrival by the caller's sequence guard, but discarding an answer does not un-ask the question —
   the server had already run the whole query. This is the only one of the three that reduces
   *server* load rather than client latency.

**Public reads only.** Entries are keyed by the query and by nothing else, so a cache instance must
only ever hold responses that do not depend on who is asking. The listings and flatmates searches
qualify: both are `auth: false` and hard-floored to approved, public rows server-side. Point it at
an authenticated endpoint and one account would be served another's answer after a sign-out and
sign-in in the same tab — silently, and only for the window of the TTL, which is the hardest kind of
leak to reproduce. If that is ever needed the account must become part of the key; a logout hook is
not enough, because a key that omits the identity is wrong even with perfect invalidation.

The `key` must include *everything* that changes the answer — the facets, the sort, the page and the
page size — because two requests are the same request exactly when it matches. The fetcher is handed
a signal that fires when the last interested caller has gone away and must pass it to `http`; a
fetcher that ignores it makes job 3 silently a no-op. A caller's own `signal` is **not** the fetch's
signal: several callers can share one flight, and cancelling on the first would break the readers
still waiting. `fresh: true` skips the remembered value but deliberately not the dedupe, so two
simultaneous refreshes are still one request. A cache hit resolves through a promise rather than
being returned directly, because ordering that changes with cache state is how a "sometimes" bug is
made.

The last subscriber out cancels **and retires the flight in the same breath, synchronously**. Both
halves are load-bearing: `fetch` does not reject until a microtask after `abort()`, so the entry
would otherwise sit in `inflight`, already doomed, for any read starting in between — and that
window is not hypothetical, because StrictMode runs effect → cleanup → effect back to back on mount,
so in development the *second* run would join the flight the first one just killed, receive its
`AbortError`, correctly swallow it as its own cancellation, and leave the screen loading forever.
The flight's own `finally` also deletes, guarded on identity, so neither can strand a newer flight
for the same key. The cache's abort rejection is named `AbortError` so it is indistinguishable from
the platform's, which is what lets `http.isAbort` be the single test every caller uses.

### `lib/useCommitOnRelease.js` — a slider is one decision, not a hundred

A `<input type="range">` reports every step of a drag. That is correct for the *control* — the thumb
has to follow the finger — but wrong for anything downstream that treats a value change as an
intent. On the listings page a filter change becomes `GET /properties`, so a drag across a 100-step
budget slider is ~100 requests and ~100 URL rewrites for one decision.

**The native `change` event, not a list of gestures.** The platform already draws this distinction:
a range fires `input` continuously while the value is explored and `change` once, when it settles.
React aliases its `onChange` prop to the *former*, which is why `change` has to be reached through a
listener rather than a prop. Do not replace it with an enumeration of gestures (`pointerup`,
`keyup`): that covers a mouse and a keyboard and misses everything else — iOS VoiceOver's slider
*adjust* gesture sets the value through the accessibility API, producing `input` and `change` but no
pointer or key event at all, so a screen-reader user would hear the value change while the results
never moved. Deferring to `change` also closes the pointer-released-outside-the-element case for
free.

**Why the commit is not quite immediate.** A range fires `input` **and** `change` on every keyboard
step, so holding an arrow key auto-repeats the pair — crossing a hundred steps that way is ~80
superseded searches, for the one group the switch to `change` exists to serve. A settled value
therefore waits 120 ms for another to replace it: long enough to swallow auto-repeat (~30 ms between
steps), short enough to stay imperceptible after a release. It is not a debounce — it sits on this
control rather than the shared query, starts only once the value has *settled*, and a drag never
enters it.

**Why not a debounce.** Wrong shape twice over: it still fires mid-drag (a slow four-second drag
under a 250 ms debounce is sixteen requests for one decision), and it would have to sit on the
shared query, where it would also delay the discrete filters — a checkbox, a chip — that should feel
instant because each already is exactly one intent.

Render every readout from the returned value, not the owner's: the figure beside the thumb, a
preset's active state, a derived "≈ 4 km" line. Any that keeps reading the owner's copy freezes for
the length of the drag while the thumb moves beneath it, and an `aria-pressed` left behind that way
announces a selection the user has already left. That is also why the value is state rather than a
ref. A non-primitive `value` (`DualRange`'s `[lo, hi]`) must be referentially stable — rebuilt
inline it reads as a fresh commit on every parent render and yanks the thumb back mid-drag.

The hook tracks the last *seen* committed value rather than clearing the live one on commit, because
the owner writes through `startTransition` and the new value arrives some renders later — clearing
on commit would drop the thumb back to the old figure until it did. `Object.is` rather than `!==`,
so a `NaN` value cannot re-enter the render forever and blow up as "Too many re-renders". The commit
closure is assigned in a layout effect rather than during render, because `startTransition` renders
are ones React is free to throw away and a ref written by a discarded render would keep a value that
was never shown; it must not be memoised either, since it has to close over the latest live value.
`onBlur` is a backstop for anything that moved the value and never settled it — committing twice is
harmless, because the second carries the same value and the query key does not move.
`onPointerCancel` discards instead: the browser is saying the gesture was *taken away*, most often
by the scroller claiming a drag that began on the thumb, so committing there would search for a
value the user never chose. The `ref` cleanup flushes rather than drops, because the control usually
leaves when its section collapsed or the drawer closed.

### `lib/useSwipeDismiss.js`

Drag-to-dismiss for mobile overlays: `axis: 'y'` is the bottom-sheet gesture, `axis: 'x'` the side
drawer's. Both are mobile-only — the gesture never arms unless the phone media query matches.
Pointer capture is taken on the first qualifying *move*, never on `pointerdown`: capturing eagerly
retargets the following `click` to the panel and breaks every button inside it. A vertical drag may
only begin in the top 40 px (handle and header), because below it the sheet's own content scrolls
and a drag that could mean either would make both feel unreliable. A `pointerdown` on a range input
is excluded outright — a range thumb *is* a drag handle, so without this the drawer's left-drag arms
alongside it and a slider can only be nudged a few pixels before the panel slides away. On release,
a dismissal hands the transform back to the stylesheet so the overlay's own close animation plays;
a snap-back has no such animation to borrow, so one is supplied and then cleared, or the inline rule
outlives the gesture and overrides the stylesheet on the *next* dismissal.

### `context/PostChooserContext.jsx`

One posting sheet for the whole consumer shell, mounted once here rather than by whoever owns a Post
button, so every posting control — the bottom bar's `+`, the Flatmates tab-row `Post`, the Flatmates
empty state — opens the *same* instance instead of copies kept in step by hand. The provider holds
nothing but "is it open": every branch of the sheet navigates, so there is no per-route handler to
register.

The open flag is a **second** context on purpose. `openPostChooser` never changes, so the many
consumers that only need to open the sheet — `useFlatmates` spreads it down through the whole
board — re-render exactly never; `open` changes on every use and only the bottom bar subscribes, to
report `aria-expanded`. Folding the two together would make opening the sheet re-render the
Flatmates board underneath it. `usePostChooser()` throws rather than no-oping, because a Post button
that silently does nothing is the kind of failure that ships.

### `lib/hooks.js` — draft autosave

`useFormDraft` serialises during render and debounces on the **result** rather than on `form`. Every
caller builds its form object fresh on each render (`captureShareableState()` and friends), so
`form` has a new identity even when nothing was typed; keying the effect on that identity measures
400 ms from the last *render*, not the last *change*, and any render cadence faster than the
debounce re-arms the timer forever so the draft is never written at all — the failure nobody notices
until a customer loses a form. The string is what gets stored anyway, so this is work moved earlier,
not extra work.

`flush()` writes the draft now instead of `debounce` ms from now. The debounced save's cleanup
clears the pending timer on unmount, so a caller that deliberately navigates away — a sign-in gate,
say — destroys the very write it was counting on, and everything typed in the last 400 ms is gone.
That is invisible in manual testing, because a human takes longer than 400 ms to move from the last
input to the button. Any gate that sends someone off the page and promises their work will be there
must call it first. It is deliberately not `useCallback`-wrapped: it has to close over the current
`form`, so memoising it would only imply a stability it cannot have. It raises no "Draft saved"
flash, because a pill animating onto a screen mid-navigation reads as a glitch.

The flash element's presentation and placement live in `index.css` (`.dz-autosave-flash`), never in
inline `cssText`: a body-level node cannot see the `--dz-bottom-inset` `ConsumerLayout` sets on its
own wrapper, and JS has no view of the breakpoint that decides whether the bottom bar exists, so an
inline offset parks the pill on top of the mobile tab bar.

Restore-on-mount only lets fields the user actually filled override the form's defaults; empty draft
values must not wipe smart defaults.

### `lib/useSocietyCatalogue.js`

A **completeness** gate, not a loading gate. `data/societies.js` answers synchronously with 28
curated rows until its 182 KB bulk chunk lands, so a surface claiming to show the whole catalogue
must put this flag in the dependency list of the memo that reads it, or it paints 28 of 348 and
never corrects itself. The first render still paints from the curated rows. It costs one re-render
and zero bytes, because every accessor calls `ensureSocietyCatalogue()` anyway. A failed load stays
`false` and does not rethrow: `ensureSocietyCatalogue` has dropped its cached promise so the next
read retries, and resolving `true` would tell a surface its partial 28-row view is complete.
