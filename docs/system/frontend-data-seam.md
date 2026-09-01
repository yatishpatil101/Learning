# Frontend data seam (mock ↔ http)

How the React app reaches data, and the rule that keeps the `mock → http` flip a one-line change
instead of a 20-file refactor.

## The rule

> **Pages, components and hooks import from `src/services/*`. They must never import from
> `src/lib/mockApi.js`, `src/lib/mockApi/*`, `src/lib/store*` or `src/lib/properties-admin.js`
> for anything that has (or will have) a backend endpoint.**

```
pages / components / hooks
        ↓  (only this direction)
src/services/<domain>Service.js      ← stable public API, never changes shape
        ↓  createProvider('<domain>')
src/services/providers/mock/…        ← localStorage implementation (always works, no backend)
src/services/providers/http/…        ← real API implementation (opt-in per domain)
```

`services/config.js` resolves the provider **per domain** from `VITE_API_DOMAINS`
(e.g. `VITE_API_DOMAINS=auth,property`). Anything not listed stays on mocks. This is what makes
integration incremental: one domain can go live while the rest of the app is fully demoable with the
backend switched off.

## Why it matters

Before Phase 2a, 21 files imported `listProperties` and friends **directly from `lib/`**. Flipping
the property domain to http would have changed the behaviour of the one file using the seam and
silently left the other 20 on localStorage — producing a half-real UI that looks like a mapping bug.
A seam only works if it has no bypass.

**Enforcement:** grep for direct `lib/mockApi` imports in `pages/` and `components/` before shipping
a domain flip. Zero results = zero leaks.

## Domain status

| Domain | Service | Provider(s) | Notes |
|---|---|---|---|
| `auth` | `authService.js` | mock + **http** | Live: login, staff-login, refresh, logout, `GET/PATCH /auth/me` |
| `property` | `propertyService.js` | mock + **http** | Live: search, detail, featured, counts, by-id, `/me/listings`, archive/restore, **and the full moderation surface** — `GET /admin/properties` plus approve/reject, feature, flag, clear-flag |
| `contact` | `contactService.js` | mock + **http** | Live: gate status, request, owner inbox (paged), respond, pending count. Keyed on `propertyId` — the grant is per listing |
| `saved` | `savedService.js` | mock + **http** | Live: `GET /me/saved` (rows, not ids), idempotent PUT/DELETE. Membership is answered from `SavedContext`, never per card |
| `savedSearch` | `savedSearchService.js` | mock + **http** | Live: list/create/patch/delete. Seam flattens the server's `filters` jsonb onto the record and derives `alerts` from `alertFrequency`. Anonymous lead capture stays local (D85) |
| `visit` | `visitService.js` | mock + **http** | Live: `/visits` (mine) and `/me/visit-requests` (on my listings), create, status. Seam carries the human `when` string; `visitWhen` converts to/from the wire's ISO slot. Reschedule has no endpoint (D87) |
| `notification` | `notificationService.js` | mock + **http** | Live: `GET /notifications` (paged), `POST /notifications/read`. Dismiss is a client tombstone — no endpoint. Client-derived alerts merge in. Preferences stay on `lib/` |
| `conversation` | `conversationService.js` | mock + **http** | Live: inbox (paged), start, detail, reply, mark-read. Both providers speak one shape: a thread carries **`staged`** — `false` for a thread the server has, `true` for one still queued client-side under `pnPendingRequests`. There is **no `state`** field on either side (D52): the invented `active`/`incoming`/`pending` triple is gone, and `conversation-parity.mjs` fails if a `state` key reappears. `incoming` had no server referent at all — a conversation cannot exist before an approved contact request, so accept/decline belongs to the contact gate, not here |
| `review` | `reviewService.js` | mock + **http** | Live: property reviews and entity (society/locality/owner) reviews, read + write. `context` is server-derived and never sent. Owner reviews stay on mocks — the *target* is not live |
| `support` | `supportService.js` | mock + **http** | Live: list, create, detail, reply, mark-read. Bare list with the thread inline. Priority and attachments are mock-only — no field on the schema, so the page hides both controls in http mode |
| `report` | `reportService.js` | mock + **http** | Live: file, queue (paged, **staff/admin**), triage. First domain whose two ends have different audiences. Duplicate → 409; terminal is terminal |
| `plan` | `planService.js` | mock + **http** | Live: `GET /plans` (**public**), `GET/POST /me/subscription`. Held in `PlanContext` because the questions are asked during render, not awaited. `pending ≠ active`: buying a priced plan does **not** grant it |
| `deal` | `dealService.js` | mock + **http** | Live: the whole transaction cluster — `/me/deals` (+reserve/close/reopen/parties), `/offers` (+respond/mine), `/me/offers`, `/finalization/*`, `/me/finalization-requests`. Every signature dropped its `ownerMobile`: the token scopes the read. A buyer cannot see a listing is closed, and cannot accept an offer |
| `rent` | `rentService.js` | mock + **http** | Live: the money cluster — `/me/tenancies` + `/tenancies`, `/me/tenant-profile`, `/tenant-profiles/{mobile}`, `/me/rent-payments`, `/me/rent-ledger`, `/me/rent-mandate`, `/me/payout-account`, and `/me/finances/{propId}/*`. **Paying rent yields `due`, not `paid`** — the webhook settles it. The payout account returns a mask, never the number |
| `flatmate` | `flatmateService.js` | mock + **http** | Live: the flatmates board — `/flatmates/rooms` (+seats/occupants/interest/agreement), `/flatmates/groups` (+seats/join/owner-consent), `/flatmates/posts` (+interest), `/me/flatmate-requests`, `/flatmates/feed`, `/properties/{id}/rooms` + `/split`. Two tabs over **three** resources: move-in reads rooms, team-up reads posts *and* groups. Seats are never inferred from `members.length` — the host sets them. Joining an open-policy group is **already accepted**; a closed one is pending. The server filters on `locality` only, so the other ten facets are applied client-side (D116) |
| `serviceRequest` | `serviceRequestService.js` | mock + **http** | Live: the customer's own concierge requests — `GET /service-requests` (paged, type-filtered), `GET/POST /service-requests`, `POST /{id}/messages`, `POST /{id}/draft/decision`. `details` is **write-only** (summarised to a string on create, absent from the read shape). Draft/final uploads are multipart to the vault and the signed URLs don't resolve in dev; the per-request document checklist, co-fill invites, unread receipts and staff transitions have no customer endpoint and stay mock-only (D119–D121). **The only domain with a partial mock**: `listServiceRequestQueue`, `takeServiceRequest` and `readServiceRequestIdentities` exist on http *only* (D184) — the drafting desk filters on the server's nine-value status vocabulary, which the mock store cannot speak, so `/ops/drafting-desk` gates on `isHttpDomain('serviceRequest')` and says so rather than showing a queue it cannot filter. `serviceRequest-parity.mjs` names those three as the exception, so a fourth going live-only still fails |
| `verification` | `verificationService.js` | mock + **http** | Live: the opt-in Aadhaar "Verified" badge — `GET /me/verification/aadhaar` (always 200; a never-tried caller reads `status:'none'`, never 404) and `POST /me/verification/aadhaar` (**202** — a DigiLocker consent handle, *not* a granted badge; the webhook grants). Held once in `VerificationContext`. A badge, never a wall (ADR-019): nothing is withheld for its want — the only place identity has teeth is the server-side contact gate. A start reads back **pending**, never verified; the growth perk and `aadhaarMobile` are mock-only, the latter carried as `''` on the wire (D122) |
| `propertyReview` | `propertyReviewService.js` | mock + **http** | Live: the property-verification case file — `GET/POST /properties/{id}/verification`, `POST .../messages`, `POST .../read`, `POST .../decision`, and the staff queue `GET /admin/property-reviews`. **Named for the collision it avoids twice over**: `verificationService` is the Aadhaar *identity* badge, and `reviewService.listPropertyReviews` is consumer star-ratings — hence `listPropertyReviewQueue` for the desk. `{id}` is the listing **UUID, never the slug** (`propertyMapper` sets `id = slug || id` and stashes the real one on `uuid`), so callers pass `listing.uuid \|\| listing.id`. Two vocabularies that look like one: the request verb is `approve`/`reject`, the resulting status is `approved`/`rejected`, and an unrecognised verb **throws a 400 on both providers** rather than defaulting — the obvious `startsWith('approve') ? … : 'reject'` makes every typo a rejection, which is the destructive, owner-visible, audit-logged side of the branch. Deciding writes **three** places server-side — the case file, `properties.status`, and an owner-facing sentence posted into the thread — so a console must stop pairing `decideReview` with `setListingStatus`. The mock is the *richer* end for once (per-document verify/reject, `in_review`/`clarification` statuses, a listing snapshot) and none of it has a server: the checklist is read-only `{item, pass}` with no write endpoint, and `/admin/property-reviews` takes a `Pageable` and nothing else, so a "pending only" desk is filtering a page, not the queue. `reviewer` is a raw user **UUID**, not a handle. The mock provider reproduces the server's *access* rules as well as its business ones — participant-or-staff on the thread (404, not 403, so a stranger cannot confirm the listing is under review), staff on the queue and the decision, owner-cannot-decide-their-own — because a permissive mock lets a buyer session publish a listing in the demo and lets screens get built against forbidden states they never render. **D218 added a third party to the thread: nobody.** A message can now be `internal`, and an internal message is filtered out of the owner's copy entirely — so a case holding *only* internal notes answers the owner **404, not an empty thread**, because an empty thread still tells them a file has been opened on them. `internal` is on the wire (and false in every owner-side response) because filtering alone left staff unable to tell a staff-only finding from something the owner was actually told: both arrive as `from: ops`, in one conversation, and a moderator who quotes the first back to an owner has made the disclosure the filter existed to prevent. It renders as a separate amber lane with no `You (PuneNest)` attribution. The read is gated on the `properties:read` **grant** and not the bare staff role — that is the one verification route that cannot be gated at the controller, because it is participant-or-staff and an owner holds no grants at all. D218 also moved the desk's sort to `last_message_at desc, id desc`; note that this currently orders *identically* to `updatedAt` and is still the right column, because it is the write that dirties the row in the first place |
| `settings` | `settingsService.js` | mock + **http** | Live: the platform configuration document — `GET`/`PUT /admin/settings`, both `x-roles: [admin]`. **The last domain to get a seam, and the one that most needed it**: `AdminFlagsContext` and `AdminSettings.jsx` imported `getSettings`/`updateSettings` straight from `lib/mockApi.js`, so with every domain switched on the admin console *still* read its feature flags, fee schedule and geo policy out of `db.json` — and nothing said so, because a direct import has no switch to look at. No mapper, deliberately: the server stores one row per top-level key and folds them on read, so the key set is open by construction and a mapper would either enumerate it (dropping the next key someone adds) or pass it through. Writes **merge**, on both providers — send only what you actually changed, because a block you did not read is still a block you are asserting. That is not pedantry: `setFlag` used to send the whole `adminFlags` object, so a failed read followed by one toggle would persist the all-`true` defaults over every flag the operator had set. The mock provider deep-merges against the stored document before handing whole blocks to `lib/mockApi`'s shallow spread, matching the server's rule — objects merge key by key, arrays and scalars replace whole (`geo.blacklist` is an ordered list). `getCustomRoles()` answers `[]` on http and that is the correct answer, not a stub: V61 deleted the key and `PUT` returns **422** for it. The optional `If-Match` precondition (D66) is not sent — honouring it is UI work in `AdminSettings.jsx` (surface the 412, re-read, re-apply), and sending the header without that handling turns a rare silent overwrite into a frequent unexplained failure |
| others (content, admin, listing, …) | — | — | Backend controllers exist; no seam, and the pages import `lib/` directly |
| `document` | `documentService.js` | mock + **http** | **Owner side only.** Live surface: the vault — `GET /me/documents/{propId}`, multipart `POST` (upload), `DELETE` — and the owner's request inbox — `GET /me/documents/requests`, `PATCH /me/documents/requests/{reqId}` (grant/decline). The wire's `categories[]` collapses to a single `docType` for the inbox row; the requester mobile stays masked; `shareToken`/`expiresAt` are re-send affordances, null until granted. The vault's signed `url` does not resolve in dev, so the bytes live behind the mock's `dataUrl` (D120 pattern). The **buyer's half** (ask → poll → open a shared bundle, token-mediated), the cross-user grant notification, shared-doc counts, the dashboard doc-count badge, rent agreements, and every presentation helper stay on `lib/data/documents.js` (D123). The consumer flip shipped as an **honest subset**: `DocumentsTab` — the owner's per-listing vault, the personal/KYC bucket (`/me/documents/personal`) and the request inbox — reads and writes through the service, and `document` is in the live e2e `VITE_API_DOMAINS`. `useRentAgreement`'s vault reuse, `DocVault` and `PropertyPassport` deliberately stay on `lib/` (the first needs the bytes the signed URL withholds; the last two address mock-only managed-property ids). What the flip left rough — failure states that read as emptiness, the missing loading state, wrong-flat mutation updates, and the request inbox on localStorage (tracked as D125, resolved 2026-08-08) |

Twenty-nine services, twenty-nine http providers, twenty-six mock providers — and the invariant to
keep is that the first two match. A provider without a service is unreachable; a service without a
provider throws. (The table above grew past the "eighteen" and then the "twenty-three" it was
written for; the count is the thing to check, not the adjective.) The three mock-side gaps are
deliberate and named: `permissions`, `referral` and `ticket` are http-only, because their mock
stores cannot speak the server's vocabulary — the same reason `serviceRequest`'s drafting desk is a
partial mock. Everything else must have both, or the demo build and the live build are different
products. `document` was foundation-only until its consumer flip; it is now wired to `DocumentsTab`
and switched on in the live e2e config, on the honest subset described in its row above.

**Having an http provider is not the same as using it, and having a *seam* is not the same as being
behind one.** Which domains are actually live is decided by `VITE_API_DOMAINS`, and for a long time
four of the fifteen had a provider, a parity harness and a row in this table while every browser run
still served their mocks. The list that matters is in `e2e/playwright.live.config.js`; if a domain
is not in it, nothing here has been exercised in a browser. See "The switch-on slice" below.

The second failure mode is worse, because the switch cannot even describe it: **58 source files
import `lib/mockApi.js` directly** (22 admin pages, 18 consumer, 4 components, 3 ops, 3 context, 1
root — plus 8 mock providers, which legitimately do). A direct import sits *below* the seam, so
`VITE_API_DOMAINS` has no opinion about it and no configuration can make it talk to the server. That
is what `AdminFlagsContext` was until 2026-08-13, and it is the real remaining work in retiring the
mock — not the provider folder, which is a `git rm`.

The same gap has a second form, and the plan slice hit it: a domain can be **in** that list and
still have no consumer, if the provider files exist but the call sites were never migrated (or were
reverted). Lint and build both stay clean, because unused modules are not errors. When adding a
domain, the check is not "do the files exist" but "does a component import the service".

`dealService.js` and `financeService.js` were **deleted** in the saved slice. Both had zero importers
— only the barrel referenced them, and the barrel itself is imported nowhere — so they were seam
files that had never been wired to anything. Their mock providers went with them. A dead service is
worse than a missing one: it reads as coverage that does not exist.

Four more mock providers — `admin`, `content`, `document`, `listing` — were deleted afterwards for
the mirror-image reason: they had no service, so `createProvider` was never called with those names
and nothing could reach them. They were not inert at the time, though. `config.js` then resolved
providers with `import.meta.glob(..., { eager: true })`, so every file matching
`providers/mock/*Provider.js` was pulled into the main bundle whether or not a service existed for
it; removing them took it from 1864 KB to 1848 KB. (That glob is **lazy** as of 2026-08-12 — see
D208 — so an orphan provider no longer costs bundle weight. It still costs comprehension, which is
the better reason to delete one.) Each was a pure pass-through (`Promise.resolve(_fn())`) over
`lib/` functions the pages already import directly, so nothing changed behaviourally — the wrappers
had simply been built ahead of a seam that never arrived.

The old `savedProvider.js` bundled five unrelated domains (saved properties, saved searches, plans,
boosts, service orders) behind one name. On the server those are five separate controllers, so the
bundle would have pinned five backend slices behind one provider. It was narrowed to saved
properties; the other four had no consumers.

`propertyService.js` exports 15 symbols: `listProperties`, `getProperty`, `featuredProperties`,
`countProperties`, `getPropertiesByIds`, `myListings`, `addListing`, `setListingStatus`,
`toggleFeatured`, `flagListing`, `clearFlag`, `deleteListing`, `updateListingFields`,
`archiveListing`, `restoreListing`.

### Why `countProperties` / `getPropertiesByIds` exist

Several pages used to load the **entire catalogue** and reduce it client-side — a locality count, a
saved-list lookup, a compare picker. That is invisible against a 38-row mock and simply *wrong*
against a paginated API: the answer silently becomes "…of the first page". Both operations push the
work to the server, and `countProperties` is exact because `totalElements` on a `size=1` request is a
count over the whole result set, not over a page. No new endpoint was needed for either.

`myListings` is a correctness fix rather than an optimisation: public `/properties` is hard-floored
to approved + non-archived server-side, so an owner's pending or rejected rows **cannot** be derived
from it at all. `GET /me/listings` is the only source that returns them.

## Coming-soon features are not integration targets

**A feature the product is not shipping does not get wired, however complete its backend is.**
Integration effort spent on a surface nobody can reach buys nothing, and it accrues the same
maintenance cost as live code — a parity harness to keep green, a mock to keep honest, call sites
that drift.

The list, and how to tell:

| Surface | How it is gated | Status |
|---|---|---|
| **Pay Rent** (`/pay-rent`) | `flagEnabled('onlineRentPayment')` → `PayRentComingSoon` | **Not shipping.** Rent *payments*, *mandates* and *payout accounts* are wired but dormant behind the flag |
| **Move-in Pack** (services) | `services.packComingSoon` copy | Not shipping |

Two clarifications on the rent slice, because it is the one place this line is subtle:

- Only the **payment** half is coming-soon. `/me/tenancies`, `/tenancies`, the tenant profile and the
  whole `/me/finances/{propId}/*` ledger are live surfaces the dashboard renders today, and they are
  genuinely integrated. Nothing there is dormant.
- The payment endpoints were wired before this ruling and are left in place: they are tested, green,
  and behind a flag that costs nothing while off. Removing them would be more churn than leaving
  them. **They should not be extended** — no new call sites, no new copy, no widening.

Before scoping any slice, check for a `ComingSoon` component, an `if (!flagEnabled(...)) return`
early exit, and `coming soon` in the i18n catalogue. A surface that fails any of those is out.

## Documented exceptions (deliberate, not oversights)

These stay on `lib/` **because they have no backend counterpart**, and moving them would create a
service method that can never be implemented:

- `setPipelineStage`, `sendOwnerReminder`, `confirmListingFresh`, `applyVerifiedBadgeToListings`,
  `verifiedStats` — growth/ops features that are mock-only by design.
- `logAudit` on the admin pages stays mock-only **deliberately**, not pending. The server writes its
  own `audit_log` row inside `PropertyModerationService` for every status change, feature toggle,
  flag and clear; wiring the client's `logAudit` to the API would record the same action twice, from
  a source that can be neither trusted nor correlated. The client-side log is a mock affordance for
  the demo Audit page, and it stops at the seam.
- `decideReview` / `ensureReview` (maker-checker case files) remain on `lib/` for now — the endpoints
  exist per-listing (`/properties/{id}/verification`) but the queue cannot be enumerated
  (`PropertyReviewRepository` has only `findByPropertyId`), so a live Verification tab would be able
  to decide a case it cannot list. Recorded in tech-debt.

## The listing moderation slice

The four moderation writes had shipped on the server months before anything could call them, and the
http provider's stubs pointed at paths that were guessed rather than looked up
(`PATCH /admin/properties/{id}/status`; the real route is `PATCH /properties/{id}/status`). That was
the visible half. The invisible half mattered more.

**There was no way for a moderator to list properties at all.** `PropertySpecs.publicSearch` pins
`archived = false AND status = 'approved'` unconditionally, and `PropertyController.search` takes no
principal, so it cannot relax for staff — a staff caller got byte-identical results to an anonymous
one, and `?status=pending` returned an **empty page** because the param can only AND onto an
already-pinned `approved`. The only status-complete list was `GET /me/listings`, scoped to the
caller's own `owner_id`. So `AdminProperties` in http mode asked for `includeAllStatuses` +
`includeArchived`, had both silently dropped as "unsupported", and rendered the approved-only public
catalogue: a Verification Queue that could never contain anything, presented as an empty backlog.

`GET /admin/properties` (`PropertySpecs.adminSearch`, staff/admin) is the fix. Three decisions in it
are worth keeping:

- **A separate spec method, not an `includeAll` flag on `publicSearch`.** A flag would leave the
  anonymous search one mistyped argument away from serving unapproved listings. A second method can
  only be reached by a caller that named it, and every caller can be enumerated by grep.
- **A separate path, not a role branch inside `GET /properties`.** The public search is opened *by
  path* in `SecurityConfig`; a role check inside it would put the unapproved catalogue behind a
  runtime `if` on an endpoint whose matcher says `permitAll`.
- **`status` widens here and narrows there.** That asymmetry is the entire point, so both halves are
  asserted in `PropertyModerationQueueTest` — each test checks the queue returns a row *and* that
  public search does not. Asserting only the first would still pass if someone later merged the two
  specifications, which is the change this endpoint most needs protecting from.

### `listForModeration` is a separate seam operation — and that was learned the hard way

The obvious client shape was `listProperties({ includeAllStatuses: true, includeArchived: true })`,
with the http provider noticing those flags and routing to `/admin/properties`. The reasoning was
"a consumer page never sets them". **That was simply false.**
[useDashboardData.js](../../frontend/src/pages/consumer/dashboard/useDashboardData.js#L158) passes
`includeAllStatuses: true` — it wants a catalogue to resolve visit titles against — so every owner
opening their dashboard was routed to a staff-only endpoint and got a **403**. The live e2e caught
it; nothing else would have, because on mocks the flag is honoured and the page works.

The rule it produced is the same one the server applies a layer down: **an authorization-relevant
routing decision must be named by the caller, never inferred from an ambiguous flag.** So
`propertyService` exports `listForModeration` alongside `listProperties`, the mock provider
implements both, and reaching the queue requires asking for it.

A second bug hid behind the first. While the routing was inferred, an *absent* flag re-imposed the
public floor — which was the safe reading then, and wrong the moment the operation became explicit:
`listForModeration({})` returned exactly the approved rows public search already returns. The admin
table showed 16 of 38 listings and reported no error. **An unfiltered moderation read filters on
neither axis**, the inverse of `toQuery`'s default, and the parity harness asserts it.

### `archived` had to go on the wire

No response DTO exposed it, so `propertyMapper` hard-coded `archived: false`. Defensible while every
list was public — an archived row cannot appear in one — and fatal on an ops list, where it made
every archived listing look live and left the Archived filter permanently empty. It is now on
`Property`, which also fixes `GET /me/listings`, where an owner's archived listings had the same
problem.

`archived` is a **separate axis from `status`**, not a sixth status value: archiving preserves the
moderation state it was archived from, and restoring resets to `pending`. Hence the tri-state
`archived` query param — omitted means both, and "everything" and "only the live ones" are different
questions that a two-valued flag cannot distinguish.

### The four writes resolve with no value

The contract declares a bare `200`/`204` with no schema for all four, on the reasoning that a
moderator can predict the effect of the request they sent. The mock still returns the updated record;
**nothing may read it**, because a caller that does works on mocks and silently reads `undefined`
against the API. `AdminProperties.doFeature` did exactly that (`rec.featured`) and would have worded
every toast "Removed from featured". It now derives the new state from the row already on screen.

Echoing the row back was considered and rejected: the obvious re-read, `GET /properties/{id}`,
enforces the public floor and so 404s for pending, rejected, flagged and archived listings — the
result of every action on this page.

### Three server behaviours the seam passes through rather than hides

- **`clearFlag` sets `approved` unconditionally.** It does not restore the pre-flag status, so a
  `pending` listing that is flagged and then cleared reaches `approved` without ever passing the
  queue. The mock's "clear flag & publish" matches, by accident rather than design.
- **`denySelfDealing` returns 403** when the actor owns the listing. Partial failure in bulk actions
  is therefore an expected case, not a remote one — which is why every bulk path now uses
  `Promise.allSettled` and reports what actually happened.
- **Moderation routes are UUID-only.** Unlike the public read they do not resolve a slug, so an id
  taken from a public URL 404s.

### Call-site defects this exposed

The page's moderation calls were fire-and-forget `forEach` loops. Against mocks that is harmless;
against the API each is an unhandled rejection *and* a green success toast for the same click. All
are now awaited, bulk paths use `allSettled`, and toasts report the real outcome.

The edit modal's status dropdown was a silent no-op in http mode: it went through
`updateListingFields` → `ListingUpdate`, which **deliberately omits `status`** so a PATCH cannot
self-escalate, so the field simply vanished from the request body. Field edits and a status change
are two different operations against the API and the modal now makes two calls.

`bulkApprove` used to follow every approval with `updateListingFields(id, {flagReason: ''})` —
another silent no-op against the API, since `ListingUpdate` has no `flagReason` and the patch
serialised to `{}`. The mock's `setListingStatus` now clears the flag on approve, mirroring the
server (`PropertyModerationService` nulls `flag_reason` only on approve), and the extra call is gone.

### `PAGE_SIZE` was above the server's ceiling

The provider asked for `size=500`; `spring.data.web.pageable.max-page-size=100` clamped it. So every
list silently returned at most 100 rows while `warnIfTruncated` compared `totalElements` against 500
and stayed quiet for everything in between — the guard that existed to make the ceiling audible was
muted by the ceiling it was guarding. It is now 100, and the check compares against the rows actually
returned, which is correct regardless of what either constant says.

## The owner listing wizard crosses the seam (D219)

`addListing` and `updateListingFields` shipped with the moderation slice, but for months their only
caller was `AdminPostOnBehalf.jsx` — a desk of five people. The owner wizard
(`list-property/submit.js`) built a record and wrote it straight to localStorage, so the path that
produces almost every listing on the platform never issued a request at all.

That is not merely an unconverted page. `POST /me/listings` is where `ListingDuplicateProbe` runs,
so the duplicate detector was structurally blind to the one path the abuse it exists to catch — one
flat listed twice, by two "owners" — actually arrives through. A detector reachable only from the
back office is a detector aimed at the wrong door.

Three things this slice had to get right, none of them obvious from the provider signature:

- **The wizard's field names are not the contract's.** The address is five boxes and the wire takes
  one line; `rera` is `reraId`; maintenance is split into a sale field and a rent field behind a
  toggle, and the entity has one column; the meter number lives under `electricityConsumerNo` in the
  owner-private `strongIds` block. None of these fail loudly — an unmapped key is simply dropped, so
  the write succeeds and the value disappears. `forTheWire` does the adaptation in one place, next
  to the call, rather than spreading renames through the record builder.
- **`floor` must be *absent*, not zero.** Villas, plots and PGs never collect a floor. Sending `0`
  for all of them would hand the server a fabricated `(society, floor, bhk)` tuple that every such
  listing in one society shares — and the ten-minute duplicate sweep would then re-file them against
  each other forever.
- **The edit path sends nothing about re-checks.** `ListingService.apply` decides what an edit costs
  and returns an `EditImpact`. A client that could assert "this edit stays live" could edit its way
  around moderation, which is exactly what the foundation-field rules exist to prevent.

The localStorage write survives as a **mirror**, not as the system of record: edit prefill, the
browser-side dedup (`evaluateListingDedup`) and the documents shelf still read it. It is wrapped in
its own try/catch for quota errors, and the seam call sits deliberately *outside* that — losing the
mirror is survivable, losing the save is not.

### Types diverge across the seam before values do

The mock provider stores what it is handed; the http mapper coerces on the way out. So a field sent
as the string the form holds is a number in live mode and a string in mock mode, and both providers
answer without complaint. `forTheWire` shipped with exactly that bug on `floor` — caught by a
mock-mode spec asserting `toBe(9)`, which is worth noting because the *live* run passed it. Anything
the two providers must agree on has to be normalised on the wizard's side of the seam, not left to
whichever mapper happens to be downstream.

### The live seam has a third input nobody declares: elapsed time

Mock mode has no tokens, so nothing in it ages. Live mode does, and the seam's test harness cached
a session snapshot per account and replayed it — correct for the first fifteen minutes and quietly
wrong afterwards. Past the access token's TTL the replayed token 401s, `services/http.js` recovers
exactly as designed, and the refresh **rotates**: the live page holds the new token, the cache holds
the old one. Hand the old one back and the server sees an already-rotated token presented a second
time, which is what a stolen token looks like, so ADR-008 reuse detection revokes the family. The
session is then genuinely dead, and the failure surfaces as a route guard redirecting to `/signin`
on whatever screen happened to be next.

Worth recording here rather than only in the harness, because the shape generalises past tests: any
holder of a *copy* of a rotating credential — a second tab, a service worker, a retry queue that
captured headers — is one refresh away from presenting a token the server will read as theft. The
seam's contract is that tokens are read through `lib/auth.js` at call time, never captured and
replayed later. Found by the first full live run (D219); a single spec file never runs long enough
to cross the TTL.

## The notifications slice

Two endpoints — `GET /notifications` (paged) and `POST /notifications/read` — so the wiring is the
smallest of any slice so far. What made it a design slice is that **most of what the page does has
no server home**, and each gap needed a different answer rather than one blanket policy.

| Behaviour | Lives | Why |
|---|---|---|
| list, mark read, mark all read | server | the two endpoints |
| `dismiss` | client tombstones (`pnDismissedNotifs`) | no `DELETE /notifications/{id}` |
| saved-search / saved-property alerts | client-derived, merged per read | computed from `countMatches`; the server has no slot |
| `pushNotificationFor` | mock only, **permanently** | writing into another user's inbox is a server-side effect, never a client call |
| preferences + quiet hours | `lib/` only | the server surface now exists (`GET/PUT /me/notification-preferences`, V73, D94/D15) and the writers honour quiet hours by **deferring** the row; the client has not been moved onto it yet, so `ProfileTab` is still untouched |

### The vocabulary mismatch that would have been invisible

The server emits dotted namespaces — `flatmate.interest`, `flatmate.review.approved`,
`flatmate.request.accepted`, `flatmate.agreement.reissue`. The page's `ICONS` and `FILTERS` maps use
a flat set — `match | enquiry | price | visit | share | document | service | system`. **They do not
overlap at all.**

Because the page reads `ICONS[n.type] || ICONS.system`, nothing throws. It degrades two ways:

1. Every server notification renders as the grey "system" glyph — merely ugly.
2. **The filter chips match nothing.** Selecting "Matches", "Price" or any other chip empties the
   page. A user whose inbox is entirely server-fed would conclude the filters are broken.

`notificationMapper.js` translates by longest prefix; an unrecognised type falls back to `system`
**and warns once**, so the next type the backend invents is audible rather than silently grey. The
parity harness drives every type the backend actually writes today and asserts each lands inside the
UI vocabulary — mutation-verified by mapping one to a nonexistent chip and watching it fail.

### `at` must be a number, and the wire sends a string

`createdAt` is an ISO instant; the page sorts on `at`, groups Today/Earlier from it and computes
`Date.now() - at`. An ISO string sorts *lexicographically* — which for same-format timestamps is
mostly the right order, so this survives casual testing — and makes every relative time `NaN`. The
mapper `Date.parse`s it, and the harness asserts the type, also mutation-verified.

### Dismiss is a tombstone, and that is a deliberate trade

There is no delete endpoint. The options were: hide the X in http mode (removes a control that works
today), throw (a dead button), or record locally which rows the user has hidden. The tombstone wins
because it is honest about being a local preference — it does not sync across devices and clearing
site data brings the row back, both documented on the provider. Recorded as debt so a real endpoint
replaces it rather than joining it.

### The seed must not run against the API

`seedNotifsIfEmpty` writes eight fabricated rows to localStorage. On mocks that is the demo inbox;
in http mode the same call would merge invented notifications into a real one — indelible (not the
server's to delete), invisible from any other device, and indistinguishable from genuine platform
messages. The page gates the seed on `isHttpDomain('notification')`, and the live e2e asserts the
seeded ids never appear in storage.

### What "live" currently means here

Only the flatmate flows call `new Notification(...)` server-side — five call sites, all in
`FlatmateSeekerService`, `FlatmateSupplyService` and `FlatmateModerationService`. Nothing in
property, contact, visit, saved-search, offers, deals or documents writes a row. **A non-flatmates
user's live inbox is legitimately empty**, which is why the client-derived alerts are load-bearing
rather than a nicety: without them the flip would trade a populated demo for a truthful blank page.
The gap is in the writers, not the seam.

**Partly closed by the conversations slice** — `ConversationService.send` now writes a
`message.received` notification to the other participant, so the two features finally reinforce each
other. Everything else in D92 still stands.

## The conversations slice

Five endpoints (inbox, start, detail, reply, mark-read) and ten frontend files. The wiring was
routine; **the shape gap was the slice**, because the mock's conversation is a *richer document*
than the server's rather than a differently-named one.

### The `state` machine does not exist server-side

`ConversationService.related` requires an approved contact request in one direction or the other
before a thread can be created at all. So a live thread is always `active` — there is nothing left
to accept, because the contact gate did the accepting one layer up.

The mock's three states map like this:

| Mock state | Live | Why |
|---|---|---|
| `active` | every server thread | the only state that survives |
| `pending` | **client staging queue** | composed but not sendable: the gate has not opened |
| `incoming` | never | it means "they asked, I have not accepted", which is a contact-gate concept |

`accept` and `decline` render behind `state === 'incoming'`, so in http mode they simply never
appear — no gating needed, which is the nicer version of "mock-only".

### Staging, and why the button is not just disabled

"Message owner" is reachable from a property page *before* the gate opens, where `POST /messages`
answers 403. Three options, one honest:

- **Hide the button until contact is approved** — matches the server exactly, and makes the property
  page's primary CTA appear and disappear depending on state the user cannot see.
- **Let it throw** — a dead button with an error nobody can act on.
- **Stage it and send when the gate opens** — what shipped.

The staged row carries `state: 'pending'` and a `staged:` id, so nothing can mistake it for a server
thread or try to reply into it. `drainPendingChats` runs before every inbox read, and **re-reads the
listing** rather than trusting anything stored at queue time — the owner's mobile is masked until
the gate opens, so a number captured at queue time would be a masked string sent as if it were real.
An entry the server still refuses stays queued; silently dropping a message the user composed is the
worst outcome available.

### `authorId` was added to the contract

`MessageDto` carried `author` — a **display name** — and no id. The client has to decide which side
of the thread each bubble belongs on, so it would have had to compare names. That works until two
users share one, at which point a stranger's message renders on the reader's own side, styled as
theirs. Nothing throws and nothing logs; the thread just quietly misattributes who said what.

`authorId` is one field and it makes the question answerable. The mapper keys on it, the parity
harness drives a same-name counterparty to prove it, and `ConversationEndpointsTest` creates two
users called "Same Name" for the same reason. When identity is unknown the fallback is `them`:
misattributing a stranger's words *to* the reader is the worse of the two errors.

### What degrades, and how visibly

| Mock field | Live | Behaviour |
|---|---|---|
| `property.{price,loc,img}` | absent | title renders; the rest would be one property read per inbox row |
| `party.online` | absent | pinned `false` — there is no presence service, and `undefined` reads as "online" under a truthiness check |
| `youAre` | absent | derived from `counterpartyRole`; an approximation, documented as one |
| message `type: 'card'`, `icon` | absent | share chips send their text and lose the icon — the sentence carries the meaning |
| auto-reply, typing dots | — | mock-only. Against the API the other end is a person; fabricating a reply would put words in their mouth |

The contract declares `MessageCreate.attachments` and the Java record does not implement it. That
divergence is now marked in the spec rather than left to be discovered.

### The inbox does not carry the transcripts

`ConversationDto.messages` is `NON_NULL` and the *list* contract omits it — a hundred one-line
previews would otherwise cost a hundred full transcripts. So a live row arrives with `messages: []`
and the thread is read separately, on open, which is also the moment the user first needs it.

The mock has one store and returns whole objects, so opening a thread was free there. The page
therefore worked perfectly on mocks and opened an **empty thread** against the API. Two things fell
out of fixing it, and they are the same lesson:

- The list read and the detail read are now different operations, and every caller that shows a
  thread has to make the second one. `hydrate(id)` exists so there is exactly one place to forget.
- **Replacing a synchronous store with a fetched one changes *when* every reader runs.** `convs`
  used to be seeded from localStorage during `useState`, so a mount-time effect saw the whole
  inbox. Behind the seam it arrives from a request, and the `?c=<id>` deep-link effect — untouched
  by the migration — ran against `[]` and silently opened nothing. It now latches on the first
  non-empty list instead. Nothing in the http provider was wrong; the *timing contract* changed.

`lib/data/myListings.js` is the one `lib/ → services/` import in the codebase. The layering concern
was real but hypothetical; the correctness gain is concrete, and the absence of a cycle was verified
(the provider registry reaches `lib/mockApi.js` and `lib/data/properties-admin.js`, neither of which
imports `myListings.js`). It carries a SEAM NOTE recording that check.

## The reviews slice

Four operations over two routes, and the interesting part is that **the wire is stricter than the
mock, deliberately**. Everywhere else the seam has translated between two equally-permissive
vocabularies; here the server refuses fields the client used to supply, and refusing them is the
feature.

### `context` is not the client's to send

`context` is the reviewer-standing badge — "Verified resident" (`tenant`) or "Visited" (`visit`).
The contract marks it `readOnly`; `ReviewCreateRequest` has no such field; the server derives it
from the author's visit and tenancy history.

Three separate call sites were sending it anyway:

| Where | What it sent | Why that was wrong |
|---|---|---|
| `ReviewModal.jsx` | `context: 'visit'`, hard-coded on every submission | every review certified itself |
| `useSocietyHub.js` | `resident: isVerifiedResident(soc.slug)` | a client-side lookup, stored as evidence |
| `ReviewsSection.jsx` | rendered the chip **unconditionally** | a null `context` fell through to "Visited" |

The first two were ignored live and believed on mocks — the worst possible split, because mocks are
where the demo and the screenshots come from, so the badge acquired its credibility in exactly the
environment where it meant nothing. The third is not a provider bug at all: the provider returned
the correct null and the card invented a badge from it.

The mock provider now refuses to stamp a badge either, and the parity harness asserts that. A badge
a browser can assert about itself is not evidence, and evidence is the only thing that makes a
stranger's rating worth reading.

### An entity review is only as live as its target

`GET /reviews/{entityType}/{entityId}` is one route over three target types, and each one migrated
only if the frontend and the database already agreed on the key:

| Target | Frontend key | Server key | Outcome |
|---|---|---|---|
| `locality` | slug | slug | **live** — but see below |
| `society` | `soc.id` (`S01`) | UUID, slug accepted | **live**, after re-keying on `soc.slug` |
| `owner` | mock user id | user UUID | **not migrated** |

Owner reviews stay on `lib/store.js` and carry a SEAM NOTE saying so. `getOwner()` still reads
`lib/mockApi/users.js`, so pointing the page at the service would issue a perfectly well-formed
request for an owner the server has never heard of — and the empty result would render as "no
reviews yet". A silent wrong answer is worse than an honest mock, and this moves when the owner
profile does.

Two key bugs surfaced from the same cause, and both were invisible on mocks because the mock will
happily key on any string you hand it:

- **The society hub keyed reviews on `soc.id`.** Every other call on that page — follow, Q&A,
  resident status, board, WhatsApp — already used the slug; reviews were the single holdout.
- **The locality page keyed reviews on `activeName.toLowerCase()`** — the *display name* — while its
  listings query, societies filter and URL all used the slug. For a one-word locality the two agree,
  which is precisely why it survived; `viman nagar` vs `viman-nagar` is where it did not.

### The society cards are still on the mock aggregate, and there is a reason

`SocietiesSection`, `Societies.jsx` and `SocietySection.jsx` call `entityRating('society', soc.slug)`
inside a `.map()`. They used to key on `soc.id` — the synthetic `S01` minted by `data/societies.js`,
which the hub (and the server) never write under — so the read addressed a bucket nothing fills and
every card showed "Not rated" regardless. They were otherwise left alone and given SEAM NOTEs,
because the fix is not to migrate them
to the reviews service — that would be one request per card — but to read the aggregate the row
already carries. **`GET /societies` now returns `avgRating` and `reviewCount` per row**, added by
this slice for exactly that call site, computed through `RatingLookup.forSocieties` in one batched
query alongside the listing and follower counts.

`avgRating` is **null, not 0**, for an unrated society. A card that renders 0.0 for a society nobody
has reviewed is stating something false about it, and "unrated" and "rated zero" are different
claims. The `SocietyDetail` schema had these two fields already; they moved up to `Society` rather
than being duplicated, so the hub and the directory cannot drift into computing different numbers.

### What the server has that the UI does not use

`title` and `categories` exist on the wire and only `categories` is rendered; `ReviewCreate` accepts
a `title` nothing sends. Left unused rather than invented — an empty heading on every review card is
not an improvement.

## The support slice

Five endpoints, one page, and a one-to-one mapping onto the mock's five functions. The wiring took
an afternoon; the value is in what it made visible.

### Three controls with nothing behind them

| Control | On the wire | What shipped |
|---|---|---|
| **Priority** (low/normal/high/urgent) | absent from `SupportTicket` *and* `SupportTicketCreate` | hidden in http mode |
| **Attachments** (up to 4 images, base64) | `MessageCreate` is `{ body }` | hidden in http mode |
| **Name / mobile** | absent — the raiser is the session | left visible, documented |

The first two are hidden rather than disabled. A greyed-out control invites "why can't I?"; an
absent one asks nothing. And they had to be *hidden* rather than merely not-sent, because **an
unknown property is ignored, not rejected**: a form that kept sending `priority` would show a
success toast for a ticket ops never sees as urgent. That is the worst possible outcome — worse than
an error, because nobody learns anything.

Name and mobile are the weaker case and were deliberately not gated. They are prefilled from the
signed-in user on a `ProtectedRoute`, so the common path is right either way, and support still
reaches the person through the account and the thread. The gap — a user who *edits* the mobile to a
different callback number is telling us something the API cannot carry — is recorded rather than
papered over.

### Three vocabularies to reconcile

**Status.** The page labels five and the server has five, but they are not the same five: the
server opens every ticket `open` (there is no `new`), and it distinguishes `in-progress` — ops
picked it up — which the page has no label for. Unknown statuses are **passed through unchanged**.
`getStatusLabel` falls back to the raw key, so `in-progress` renders unstyled and visibly a gap.
Collapsing it onto `open` would have erased a distinction ops actually made and told the customer
nothing was happening while somebody was working on it.

**Author role.** `authorRole` is `buyer|owner|staff|admin`; the bubbles key on `customer|staff`.
Anything not staff-side is the customer, *including `owner`* — an owner raising a support ticket is
a customer of support. The first version of the parity harness could not catch this, because the
probe signs in as a buyer; it now drives every role through the mapper directly.

**Time.** `at` must be a number — the thread sorts on it and `fmtTime` does date arithmetic. An ISO
string sorts almost right, which is why it survives casual testing.

### `updatedAt` is derived, not fetched

The mock sorts the list by `updatedAt`. The server sorts by `createdAtDesc` and sends no updated
time at all, so the provider derives it from the last message — the thing that actually changed. A
ticket answered this morning belongs above one opened last week, and the server's own ordering would
have put it second.

## The reports slice

Three endpoints, and the first domain in the seam whose **two ends have different audiences**:
`POST /reports` is open to any signed-in caller, `GET /reports` and `PATCH /reports/{id}` are
staff/admin. That asymmetry is the shape of the module — the consumer modal and the ops queue share
a service and never call each other's operations.

### The bug: a reason set that contradicted its target type

The server validates the reason **against the target type**. `FOR_USER` is
`impersonation|fraud|brokerage|abuse|spam|fakelistings|other`; `FOR_POST` is
`fake|unavailable|filled|broker|inappropriate|spam|other`.

`Flatmates.jsx` and all three flatmate cards passed `kind='user'` (or `'listing'`) while shipping
`SHARE_REPORT_REASONS` — which *is* `FOR_POST`, exactly. So **every flatmate report would have been
a 400**: `filled` is not something you can say about a person.

It survived because the mock stores whatever it is handed. The report landed, the user was thanked,
and it appeared in the ops queue under the wrong tab. Fixed at all four call sites (`share` →
`post`), and the mapping table in `reportMapper.js` now warns on an unknown kind rather than
silently guessing.

| Modal reasons | Client `kind` | Wire `targetType` | Admin tab |
|---|---|---|---|
| `LISTING_REPORT_REASONS` | `listing` | `property` | Reported properties |
| `OWNER_REPORT_REASONS` | `user` | `user` | Reported users & owners |
| `SHARE_REPORT_REASONS` | `share` | **`post`** | Reported flatmate posts |

That last row is newer than the rest of the table. Correcting the `kind` was only half the fix:
the admin queue split its rows with `kind === 'listing' ? … : kind === 'user'`, so once flatmate
reports carried their honest `share` they matched **neither branch and rendered in no tab at all**.
The mislabelling had been masking a total absence — wrong but reachable is not obviously worse than
right and invisible, and it is the reason the gap survived a wire fix. It surfaced from arithmetic
rather than from a bug report: the live spec asserts `open + closed === listings + users + posts`,
and before the third tile existed the two partitions could not be made to agree. `TAB_KIND` in
`AdminReports.jsx` is now the one place that correspondence is written down.

Those three lists now live in `frontend/src/lib/reportReasons.js` rather than inside
`ReportModal.jsx`, because the admin queue needs the same vocabulary to build its reason filter and
was carrying a second, drifted copy. Five modules import them. The drift mattered on the merits, not
just structurally: **the same code means different things to different targets** — `spam` on a
listing is a duplicate posting, `spam` on a person is who they are; `unavailable` on a listing means
it is gone, on a person it means they never reply. `reportMapper.reasonLabel(reason, targetType)`
therefore indexes per target type, and the queue renders the words the reporter actually chose.

### Three server rules the mock has no equivalent for

**A duplicate is a 409.** A second *live* report of the same target by the same person is refused,
backed by a partial unique index and not only by a check — so two concurrent submissions get the
same answer. The modal used to close and toast success unconditionally, because a localStorage
write cannot fail. It now has a sentence for it: thanking somebody for a report nobody received is
the one outcome worth avoiding, because they stop worrying about it.

**Terminal is terminal.** `actioned` and `dismissed` cannot move. The queue's "Reopen" button would
409 on click, so it is gone — replaced by a "Decided" label. The server's reasoning is worth
keeping: re-opening "erases the record that somebody judged it, and it is the obvious way for one
moderator to quietly undo a colleague's decision".

**`resolved` does not exist.** It was the queue's word for "reviewed, no action needed", which is
what `dismissed` means. Translated on the way *out* only — the queue never *displays* a status the
server did not record.

### What the wire deliberately withholds

The mock froze a snapshot of the target at report time: `targetTitle`, `targetOwner`, `ownerMobile`,
`reportedBy`, `url`. The contract declares none of them, and `reporterId` is withheld on purpose —
"the queue tells a moderator what was complained about and why, not who complained: naming the
reporter to every member of ops is how a complaint becomes a reprisal".

So they degrade rather than being invented. `targetTitle` falls back to the bare `targetId`: a
moderator can click through, whereas a *resolved* title would be a **stale** title, because the
listing may have been edited since it was reported — and a moderator judging yesterday's complaint
against today's copy is worse than one who has to open a tab.

`reasonLabel` is the exception: presentation text the client already ships, resolved locally from
one flattened table both providers share.

Withholding has to be *said*, and said the same way everywhere. The queue read `reportedBy || ''`
and rendered "Anonymous", which is a different claim from the one the server is making: the reporter
is known — `reports.reporter_id` is NOT NULL and backs the duplicate index — merely not disclosed.
"Anonymous" tells a moderator the complaint is unattributable, and an unattributable complaint is an
easy one to wave away. It now reads **"Withheld"** in all four places the value surfaces: the table
column, the detail drawer, the mobile card, and the CSV export — where the fallback had been missing
altogether, and a blank cell in a spreadsheet reads as *missing* data rather than *withheld* data,
which is the exact ambiguity the wording exists to remove. `admin/live-reports.spec.js` asserts the
string "Anonymous" appears nowhere on the page, which is what found the last two copies.

## The switch-on slice: four providers that were live on paper only

`contact`, `saved`, `savedSearch` and `visit` shipped complete http providers, complete parity
harnesses and a row in the table above. What they never had was a place in
`VITE_API_DOMAINS` — so the live e2e config had never once loaded them, and every browser run since
had been quietly exercising their mocks.

The parity harnesses passed the whole time, and that is the point. A harness imports the provider
and calls it directly; it cannot see a React call site that never awaits, or a request fired for a
visitor who has no session. Four things were wrong, and all four were invisible from that angle:

| Found | Why the harness could not see it |
|---|---|
| `isHttpDomain('savedSearch')` could never match — the allow-list is lower-cased at parse time, the lookup key was not | The harness imports the provider directly and never consults the registry |
| Signed-out visitors fired **four** `401 /contacts/status` per property page | The harness is always signed in |
| Both alert cards showed "first in line" without awaiting the create | The harness calls the provider, not the form |
| Reschedule fired at a provider that throws by design (D87) | Same — the control is a React button, not a provider method |

The `savedSearch` casing bug deserves its own note, because it fails in the worst available
direction: the "enabled but has no http provider" warning is itself gated on `isHttpDomain`, so an
opted-in domain whose name did not match served mocks with **nothing in the console to say so**. A
live e2e run would have passed while testing the mock — the exact failure this whole config exists
to prevent.

### `PageEnvelope.page`, not Spring's `number`

Four providers (`contact`, `saved`, `review`, `report`) read `res.number` for the current page.
The contract calls that field `page`, and so does the server. Every one of them had a fallback —
`res?.number ?? page` — so the wrong read silently resolved to the *requested* page instead.

That agrees with the server right up until it disagrees: any clamp or redirect (a `page` past the
end, a size ceiling) and the client reports a page the caller is not on. Two of the parity harnesses
had the same bug in their own unwrapping, which is why it had gone unreported — harness and provider
were wrong in the same direction and cancelled out.

### The reschedule control

`saveReschedule` closes the modal and toasts success *before* the write settles. Against the mock
that is harmless; against the live API the write throws, so the user would have seen "Rescheduled"
and an error toast at once, with no way to tell which was true. The control is hidden in http mode
rather than left to fail — the same treatment support's priority picker gets, and for the same
reason: a control that lies is worse than a control that is absent.

## The plan slice: the first domain read during render, and the first where success ≠ entitlement

Every earlier domain answers a question a component can `await`. This one answers questions the app
asks **while drawing**:

| Question | Asked by |
|---|---|
| `isPaidOwnerPlan()` | `MyListingsPanel`, deciding whether to offer the Feature action |
| `listingLimit()` | `ListProperty`'s paywall and `Refer`'s "slots left" counter |
| `canPostListing()` | `useListProperty`, in a `useState` initialiser |
| `getPlan().id` | `Plans` (which card is current), `Checkout` (the already-owned guard) |

Those were synchronous localStorage reads. The naive conversion — `await` in each of six places —
costs six requests to draw one dashboard and leaves six copies of the answer free to disagree the
moment a purchase changes one. So the plan is fetched **once** into `context/PlanContext.jsx` and
the sync questions are answered from memory, the same shape `SavedContext` uses for the shortlist.

### `pending` is not `active`

`POST /me/subscription` on a **priced** plan does not grant it. The server creates the row `pending`
against a payment-gateway order and returns the order id; only the signature-verified payment
webhook moves it to `active`, and nothing the browser does can make that happen. A free plan is
active immediately, because there is no money to wait for.

The mock used to grant instantly — a localStorage write cannot fail. **It no longer does**, so a
call site cannot be written against "pay, then you have it" and discover the difference in
production. Entitlement is `status === 'active'`, never "the POST returned 200".

`Checkout` therefore has three end states, not two: success, **pending**, and a failure that leaves
the Pay button usable. The pending screen is not a worse success screen; it is the honest answer for
the interval in which the money is in flight.

### The pricing divergence this slice exposed

The pricing cards rendered `fee('ownerPlanYearly')` from the back-office Fees panel while the server
charged whatever its `plans` row said. `SubscribeRequest` has no price field, so the client number
never travels — it was a *claim about* the charge, not the charge:

| Plan | Page showed | Server charged |
|---|---|---|
| Owner Plus | ₹999 | **₹2,499** |
| Owner Pro | ₹2,499 | **₹4,999** |
| Seeker Plus | ₹199 | **₹299** |

Resolved by making the server authoritative: `Plans.jsx` and `Checkout.jsx` read `listPlans()` and
render the catalogue price, falling back to `fee()` only while the request is in flight or after a
failure. The Fees panel keeps the non-plan charges it genuinely owns. The alternative — reseeding
the plans to match the page — was not ours to choose, because it is a revenue decision.

The parity harness tolerates these three price differences by design: the mock reads the Fees panel,
the live provider reads the catalogue, and both are right for their own world.

### Two seam details worth keeping

`listPlans` is the first operation in a caller-scoped provider that **does not** short-circuit on a
missing session. The pricing page has to render for the signed-out visitor it exists to convert.

Plan identity is a UUID on the wire and a slug in the app (`/checkout?plan=owner2`), and the two are
joined by plan **name** in `planMapper.js`. Mapping by name rather than by position matters: a fifth
plan inserted in the middle would silently re-point every slug if this keyed on order. An unknown
name maps to `null` rather than guessing — a plan the app has no card for is one it cannot describe.

## The deal slice: the first domain where the mock had a security hole

Deals, offers and finalization — 18 endpoints across three controllers, one flow: reserve →
negotiate → finalize. It is the widest gap between mock and server the seam has had, and the gap is
not cosmetic.

### Every signature dropped its first argument

The store this replaces took `ownerMobile` everywhere: `isDealClosed(owner, propId)`,
`getOffers(owner)`, `acceptFinalize(owner, reqId)`. That parameter is the caller **naming whose data
to read**. localStorage has no identity, so the reader supplies one — and any reader could supply
any owner's. A buyer could enumerate every offer every other buyer had made on a listing.

The server has no such parameter and no such possibility: `/me/deals` is the caller's own listings,
`/offers/mine` is the caller's own offers, `/me/finalization-requests` is what awaits the caller's
decision. The token decides.

So the seam dropped it. That is not tidying — it is the security property. Keeping `ownerMobile`
would preserve a signature that promises something the API will never do.

### Three things the mock allowed that the server refuses

The mock was made **stricter** in each case. A mock more permissive than the server passes tests the
real thing fails, which is how a slice ships green and breaks on switch-on.

| Rule | Mock before | Both, now |
|---|---|---|
| Accept / decline an offer | anyone | the listing **owner** only — 403 otherwise |
| A second live offer on one listing | stacked silently | 409 |
| Closing a deal | no price, no counterparty | positive price + a real 10-digit mobile, mask refused |

The accept rule had shipped UI behind it: the property page offered the **buyer** an "Accept ₹X"
button when the owner countered. Against the server that is 403 — otherwise a buyer marks a price
agreed with no owner involvement and, through the status-driven contact reveal, unmasks a mobile the
owner never chose to share. It is now "Agree at ₹X", which counters at the owner's own number: the
one response a buyer is allowed, saying the same thing, and leaving the owner as the party who
closes. Which is what maker/checker means here.

### `from` means different things on the two sides

The mock stored one `from` field and flipped it between `buyer` and `owner` on each counter, so it
meant "who moved last". `OfferDto.from` is the **author** of the offer and never changes; who moved
last is the final `history[].by`. Reading the wire's field as the mock's would invert "you
countered" and "they countered" on every card — so `lastActorOf` derives it, and the parity harness
asserts both the empty case and that it reads the *last* entry rather than the first.

### Two gaps this slice could not close

**A buyer cannot learn that a listing is sold.** Closed-ness lives only in `deals.status`, which is
owner-scoped. `DealService.close` does not touch the property, and `properties.status` is
constrained to `pending|approved|rejected|flagged|archived` — there is no `sold` or `rented` to set.
`dealStatusForBuyer()` therefore answers `active` on both providers: the honest answer available,
with the server refusing a stale offer with 409. Guessing `closed` from a heuristic would hide a live
listing's controls on no evidence.

**A declined finalization is invisible.** `GET /finalization/{propId}/status` resolves through a
query ending `and fr.status = 'pending'`, so a turned-down request reads the same as never having
asked. The panel's "the owner didn't confirm — you can ask again" branch is unreachable in both
modes. It is kept, because that copy is the only place a refusal is explained, and it becomes
reachable the day the endpoint returns terminal rows.

### Two things only the browser test found

The parity harness passed on its first run and was still wrong about the app, twice — which is the
standing lesson about harnesses being blind to React call sites, arriving on schedule.

1. **The seam's `p.id` is the listing's *slug*, not its UUID.** `propertyMapper` sets
   `id: p.slug || p.id` because the property routes accept slug-or-id and a slug makes a prettier
   URL. The deal routes parse with `Ids.parseUuid` and 404 on anything else. The harness passed a
   real UUID directly and never saw it; the browser produced `404 /api/finalization/p5015/status`.
   Call sites now use `p.uuid || p.id`.

2. **404 is this domain's normal "nothing pending" answer**, and catching it in JS does not unmake
   the request — the network log and the console still carry it. Every property page view by a
   signed-in buyer would have logged one. The fix is not to ask: the finalize card is gated on
   `contactApproved` anyway, so for a cold buyer the answer could not change the screen.

A third defect was caught by an assertion written for it: the dashboard's deal read is one
`/me/deals` call for the whole book, and the first implementation fired it four times per load
because the effect depended on the `listingsState` *array identity* rather than its ids. The test
asserts the **count**, not merely that the endpoint was called — an assertion that only checked "was
it called" would have passed on all four.

## The rent slice: where getting it wrong costs rupees

Tenancies, rent payments and property finances — 21 endpoints over three controllers, held together
by the **tenancy**: the thing a payment is against, a mandate authorises, and an owner's ledger is
about. A tenancy is not created directly; closing a **rent** deal opens one in the same transaction
(backend D1), which is also why this slice sits directly on top of the deal slice.

### Paying rent does not settle rent

`POST /me/rent-payments` computes the fee, opens a payment-gateway order and stores the row **`due`**
with the order id in `reference`. Only the signature-verified webhook moves it to `paid`.

The mock defaulted to `status: 'paid'`, because a localStorage write cannot fail. That is a lie about
money in both directions: it tells the tenant their rent is settled the instant they tap, and it
tells the owner they have been paid. Both providers now return `due`, and `Pay Rent` says
"waiting for your bank to confirm" rather than "paid".

This is the third domain with the same shape — plan subscriptions, deal finalization, now rent. The
pattern is worth naming: **any operation that opens a gateway order returns intent, not outcome.**

### The fee is computed twice, and the two must agree

The client needs a total *before* the tenant commits and there is no quote endpoint, so
`quoteRentFee` still computes it locally. The server computes its own and charges that. Both do
`round(base × percent / 100)` in whole rupees, half-up, with the fee rounded **before** GST is taken
on it — GST is on the fee, not the rent, because the platform is selling a payment service.

`feesAgree` exists to assert the two have not drifted, and the parity harness checks it against a
real payment. A fee the client computes is a fee the client can change; a fee the client *displays*
and the server *charges* is only safe while they agree.

> **The first version of that assertion could not fail.** It checked `quoteRentFee(25000)`, where
> the fee is exactly ₹500 either way — so reversing the rounding order left it green. ₹125 is the
> smallest amount that tells them apart (fee ₹2.50 → ₹3, GST ₹1; taking GST on the unrounded ₹2.50
> gives ₹0). Found by mutation-testing, which is the only reason it is now a real check.

### Four rules the mock had to adopt

| Rule | Mock before | Both, now |
|---|---|---|
| Paying rent | `paid` immediately | `due` against a gateway order |
| Paying twice in a month | stacked a second row | 409 |
| Paying a stale amount | charged whatever was passed | 409 if it disagrees with the tenancy |
| Reading a payout account | returned the full account number | a mask, never the number |

The last one is worth dwelling on. `PayoutAccountUpdateRequest` takes `accountNumber`;
`PayoutAccountDto` returns `maskedAccount`. That asymmetry is deliberate — the server will not
re-serve a bank account number to anyone, **including its owner**. So `hasPayoutAccount` can no
longer test `accountNumber`; it asks whether the server says there is one.

The stale-amount rule is optimistic concurrency on money: `expectedAmount` is the figure the tenant
was *shown*, and if the rent has moved since the page loaded, charging the old number silently is
worse than making them look again.

### Three sums that stopped being the client's

`financeSummary`, `cashflowByMonth` and `getDues` were reductions over the transaction list. They are
endpoints now, and not for tidiness: **the ledger is paged**, so reducing over what the client had
downloaded produced a summary of page one wearing the label of a summary. Correct on a small ledger,
quietly wrong on a large one — the worst failure mode available.

### What the browser found that the harness could not

1. **The seam's `p.id` is the listing's slug.** The finance routes parse `{propId}` as a UUID and
   404 on `p5002`. Same defect the deal slice hit, in a new place — the harness passes UUIDs
   directly and cannot see it. Both are now `l.uuid || l.id`.

2. **The dashboard decided who was an owner from localStorage.** `isOwner` read `hasListings()`,
   which holds only what *this browser* posted. Against the API an owner's listings are in the
   database, so a real owner with four real listings answered `false` — and got the tenant
   dashboard, with Finances rendering the Rent Wallet instead of their property ledger. Now derived
   from the API-backed `listings`, with the store kept in the disjunction for mock mode.

   This one had nothing to do with the rent domain and everything to do with running the app
   against real data for the first time. It would have shipped invisibly.

3. **The page envelope is `content`, not `items`.** `PageResponse(content, page, size,
   totalElements, totalPages, sort)` is what the whole backend returns; the seam normalises it. The
   first draft read `res?.items` and silently produced empty pages — the same class of bug as D106,
   which is why the harness asserts a payment is readable back rather than only that it was created.

## Backend gaps that block the last two aggregates

| Aggregate | Blocker | Needs |
|---|---|---|
| Societies "N homes" | No `society` facet on `/properties`; the society list itself is client-side mock data, so an exact count over fabricated societies is meaningless | a `society` facet, or a societies slice |
| Saved-search match counts (`listings/alertCriteria.js` `countMatches`) | Matches on **multi-valued** `localities[]`/`bhk[]`; server facets are single-valued, so it would take \|localities\| × \|bhks\| requests per saved search | a saved-search / alerts count endpoint |

## Shape gaps (resolved in Phase 2b)

The backend does **not** return a mock-compatible property. The http provider needs a mapper:

| Mock field | Backend field | Action |
|---|---|---|
| (bare array) | `PageResponse{content,page,size,…}` | unwrap in provider |
| `type` | `propertyType` | rename |
| `bhkNum` | `bhk` | rename |
| `image` | `coverImage` | rename |
| `gallery` | `images` | rename |
| `archived` (bool) | `status` (enum) | derive |
| `localitySlug` | `localitySlug` | ✅ **resolved** — now emitted by `PropertySummary`/`Property` |

### Verified by `npm run parity:property`

`frontend/scripts/property-parity.mjs` drives the **real** mock provider and the **real** http
provider (not the mapper alone, and not re-implementations) against a live backend and diffs the
resulting view models. It is deliberately **fail-closed**: every mock field must appear in
`REQUIRED`, `OPTIONAL` or `WAIVED`, because an unclassified field is a field nobody has judged. It
also compares the **union of keys across all rows**, not one sample — the first version compared a
single listing and missed seven fields that only some rows carry.

It additionally asserts:

- **Both providers expose the same operations.** `propertyService.js` forwards blindly, so a method
  added to one provider and forgotten on the other fails at runtime, on whichever page calls it, in
  whichever mode nobody tested. Comparing the exported surfaces catches that up front.
- **`countProperties` counts the result set, not a page** — checked against `totalElements`, both
  unfiltered and locality-filtered, plus a check that the filter actually narrowed the count.
  Mutation-verified: making it read `content.length` fails the harness.
- **`getPropertiesByIds` drops unknown ids** rather than throwing or leaving a hole, and preserves
  request order — the behaviour Saved and Compare depend on when a listing is archived later.
- **Vocabulary drift is audible**: an unrecognised possession value must map to `undefined` in both
  directions *and* emit a console warning. Degrading gracefully and degrading silently are different
  things, and the warning is itself covered so it cannot rot away.

Not covered: `myListings`, `archiveListing` and `restoreListing` are checked for presence but not
driven, because they need a real session and would write to the dev DB.

```powershell
npm run parity:property                                      # defaults to http://localhost:8080/api
node scripts/property-parity.mjs --base http://localhost:8081/api
```

**Point it at the backend you actually changed.** A server running older code fails these assertions
in the same shape as a real regression, so the harness prints `live API: <base>` before comparing —
check that line first when it fails.

Current verdict: **PASS**, with these deliberate divergences.

| Field(s) | Status | Why it's tolerable |
|---|---|---|
| `desc`, `owner`, `ownerId`, `ownerMobile` | detail-only on the wire | verified unread by `Card.jsx`; matches the contact-gate intent |
| `floorPlan` | absent | read as `p.floorPlan \|\| floorPlanFor(p) \|\| DEFAULT` — synthesised |
| `priceStr`, `commercialType`, `shellType`, `washrooms`, `powerBackup`, `fixtures`, `form` | absent | commercial/land enrichment, every read guarded by `?.`/`\|\|`/`Array.isArray` — thins the detail page, doesn't break it |

### ✅ `construction` / `possession` — resolved (V10)

This was the one divergence that broke a feature rather than degrading it, so it was fixed in the
contract rather than papered over in the client.

- **Was:** UI had `construction ∈ {ready, new, under}` driving the availability filter; the backend
  had `possession`, nullable free **text**, detail-only, not filterable, `NULL` in all 38 rows. With
  the property domain on http, "Ready to move" returned **zero results**.
- **Now:** `PropertyPossession` is a first-class enum — `ready-to-move | new-launch |
  under-construction` — on `PropertySummary` (so cards carry it), as a `possession` search facet, and
  validated on create/update. `V10__property_possession.sql` adds a `CHECK` constraint and backfills
  the seeded catalogue.

| Layer | Enforcement |
|---|---|
| OpenAPI | `PropertyPossession` schema + `possession` query param |
| API edge | `@Pattern(PropertyPossession.PATTERN)` on `ListingCreate`/`ListingUpdate` → 422 |
| Database | `properties_possession_check` — blocks values arriving via backfills or ops scripts |
| Client | `propertyMapper` translates `ready-to-move ⇄ ready` in both directions |

**Two decisions worth remembering.** `NULL` is legal and means *not stated* — deliberately distinct
from all three values, so an unrecorded listing never satisfies a "Ready to move" search (plots stay
here permanently). And the wire vocabulary is intentionally *not* the UI's `ready|new|under`
shorthand: `possession=new` is ambiguous in a long-lived public contract, and translating in the
mapper is a far smaller diff than renaming ~14 UI read sites and their i18n keys.

`npm run parity:property` asserts the whole path end-to-end: that `toQuery({construction:'ready'})`
emits `possession=ready-to-move`, that the facet returns rows, that every returned row is `ready`,
and that no unstated listing leaks in.

### Why `localitySlug` exists (settled — do not "simplify" it away)

`localities.slug` is the **primary key**, and `properties.locality_slug` / `societies.locality_slug`
are real FKs to it. `localities.name` has no uniqueness constraint at all. The slug is also the
public URL key (`/locality/{slug}`), so it is SEO-load-bearing and must survive a display rename.
The property search facet (`GET /properties?locality=…`) matches the **slug**, not the display name:

```
?locality=baner  -> 2 results
?locality=Baner  -> 0 results
```

Server-side resolution lives in `catalog.locality.LocalityResolver` (slug hit → case-insensitive
name → containment for sub-areas like "Hinjawadi Phase 1" → nearest curated locality within 2.5 km).
It mirrors the client's `resolveLocalitySlug` with one deliberate difference: the server returns
`null` rather than coining `slugify(name)`, because the column is FK-constrained and coining would
mean polluting the curated locality table (and the sitemap) with owner typos.

## Backend changes the http providers must account for (API polish pass)

The backend was reviewed and hardened before integration began. Five changes alter what a client
sees, so they are recorded here rather than only in the contract.

| Change | What breaks without it |
|---|---|
| **`/api` is now a real prefix** (`server.servlet.context-path`) and the Vite proxy no longer rewrites it | Nothing, in dev — which was the problem. The backend used to serve `/auth/login` while every layer claimed `/api/auth/login`, and it only worked because the proxy stripped the prefix. Pointing `VITE_API_BASE` at a deployed host would have 404'd every request. Health and Swagger move too: `/api/actuator/health`, `/api/docs` |
| **Four reads are now paged**: `GET /me/saved`, `GET /messages`, `GET /admin/flatmate-reviews`, `GET /admin/group-applications` | A provider reading `response.length` or iterating the body gets the envelope, not the rows. Unwrap `content`, and read `totalElements` for counts — `$.length()` on an envelope returns the *field count* (6), which is the confusing failure these produced in the backend's own tests |
| **Three endpoints added**: `PATCH /me/saved-searches/{id}`, `GET /me/properties/{propId}/boost`, `GET /admin/reviews` | Each was a feature whose UI could write but never read. `toggleSearchAlert` in the mock provider now has a real counterpart; the boost UI can render its own state; the review moderation queue is reachable |
| **`GET /properties/{id}/rooms` now exists** | It was declared in the contract and served by nothing — a generated client 404'd on a promise the document made |
| **`furnishing` and `possession` now revert a listing to `pending`** | The client's `LISTING_FOUNDATION_FIELDS` list disagrees with the server in *both* directions and must be reconciled before the listing domain goes live — see below. (Superseded 2026-08-11: `furnishing` and `possession` no longer revert; they queue a background re-check while the listing stays live — Q14.) |

### The foundation-field list — reconciled, then split (D76, Q14)

**Closed 2026-08-11.** `lib/store/listings.js` once listed twelve fields against the server's seven
searchable facets, and disagreed both ways — it warned on `title`/`area`/`facing`/`floor`/`age`
(which do *not* revert) and stayed silent on `price` (which did). Both client mirrors are now derived
from the server's set rather than restated, and `npm run check:listing`
(`frontend/scripts/check-listing-foundation.mjs`, 61 assertions) fails the build if any of them
drifts.

The rule then split in two, because "foundation" was answering two different questions at once:

| Fields | Outcome | Why |
|---|---|---|
| `locality`, `propertyType`, `bhk`, `deal` | reverts to `pending`, **off search** | They change *what the listing fundamentally is*, so a stale index entry is a wrong answer — a 2BHK under 3BHK, a rental under sale |
| `price`, `furnishing`, `possession` | stays `approved` and searchable, **re-check queued** | They change *an attribute of a listing that is still the same property*, so the worst case is a briefly stale number on a listing that is genuinely what it claims to be |

For the seam this means `PropertyResponse` carries three more fields — `recheckPending` (a primitive
`boolean`, so it always serializes), `recheckReason` and `recheckRequestedAt` (both omitted when
clean) — without which the two outcomes are indistinguishable to any client, since a stays-live edit
leaves `status` at `approved` and looks exactly like no edit at all. `GET /admin/properties` gained a
tri-state `recheck` filter shaped like the existing `archived` one.

`recheckRequestedAt` and the filter's client half were both added later, on 2026-08-11, when the
admin Re-check Queue was built and the queue turned out to be unreachable from this side. Two
separate holes, each invisible on its own end: the timestamp existed on the entity, in V62 and in the
partial index, but was never added to `PropertyResponse`, so the queue's *age* — the only thing that
makes an un-drained backlog visible, and the whole reason the column is set once and never refreshed
— never left the server; and `toModerationQuery` dropped `recheck` on the floor, so the axis was
declared, tested and correct server-side while nothing on the client ever asked for it. The mock
modelled none of the three fields, which is the more instructive half: the tab would have rendered
an empty list in mock mode and every e2e assertion written against it would have passed vacuously.
The mock now carries the recheck axis in `matchesFilters`, raises a real re-check from the edit
wizard (`requestRecheckFields`, mirroring `Property.requestRecheck` — merge the field names, set the
timestamp only if unset), and clears all three on any status change and on `clearFlag`, mirroring
`PropertyModerationService`. Standing rule: a mock more permissive than the server passes tests the
real thing would fail — a mock that models *fewer* fields than the server passes tests that assert
nothing at all.

The server side is self-enforcing: `ListingFoundationTest` reads the facets off
`PropertyController.search` by reflection, so a new search facet fails the build until somebody
decides which of the two sets it belongs to.

## The flatmates slice: two tabs, three resources, and a filter bar that filtered nothing

The Flatmates board looks like one list with a toggle. It is three: **move-in** reads rooms,
**team-up** reads seeker posts *and* groups, and the tab counts are therefore not the resource
counts. Anything that treats "the current tab" as "the current endpoint" gets the team-up tab wrong.

### The rules the seam has to hold

- **Seats are never inferred from `members.length`.** The host sets `seatsOpen`, and a group with
  three members can still have two open seats — it is a flat, not a table. `seatsLeft` falls back to
  capacity-minus-members only for legacy rows that carry no `seatsOpen` at all.
- **Joining an open-policy group is already accepted.** `POST /flatmates/groups/{id}/join` returns
  `status: 'accepted'` with `decidedAt` stamped when the policy is `any`, and `pending` otherwise.
  Rendering "request sent, awaiting the host" over an accepted join tells someone to wait for a
  decision that has already been made.
- **`modStatus` decides visibility, and the client keeps it only to label the author's own copy.**
  Nine server queries filter the moderated states out. The seam holds the value so an owner can be
  told their post was taken down, and never re-filters a public feed with it.
- **Nine closed vocabularies.** `vocab()` drops an out-of-set value rather than spending a round trip
  to be told 400. A filter chip sending `"Female"` for `"female"` should narrow nothing, not empty
  the page.

### `budget` keeps the wire's name

On a room this number is the asking rent; on a seeker post the identical wire field is a ceiling. An
early draft renamed the room one to `rent` on those grounds. It was wrong: the page's settled
convention is that rooms and seeker posts carry `budget` and only groups carry `rent` — which is
exactly what `budgetOf` in the page helpers keys on. The rename returned a perfectly good 201 and
then printed **₹0** on every card, filter and map pin. A seam that renames a field the whole page
already agrees on buys nothing and costs every call site.

The same shape of mistake, one layer down: the mapper defaulted an absent `priceBasis` to `'room'`,
but `priceBasisOf` reads anything that is not exactly `'room'` as **per person** — the opposite. A
per-room listing shows no seat stepper (tenants decide occupancy) and a per-person one does, so
every row whose host never set the field lost the owner's backfill control. No error, no console
message, the button simply was not there. **When mapping an optional enum, check what the page does
with absent before choosing a default.**

### The seed moved behind the seam

The board used to be assembled in the view as `[...getRooms(), ...SEED_ROOMS]` — a store getter plus
a hard-coded demo seed, neither of which the seam knew about. Switching the domain on would have
left a page that loaded, rendered its tabs, called the API, and showed almost nothing. Every
provenance assertion would still have passed. The seed now lives in the mock provider, which is
where the live API replaces it.

### The filter bar filtered nothing (D116)

All three feed controllers take exactly `(@RequestParam(required = false) String locality, Pageable)`.
The ten other facets the page offers are accepted with **200 and an unfiltered list** — not refused
with a 400. That is the worst failure mode on offer: "Women only" returns everyone and nothing in
the response says so.

Until the controllers gain the facets, `http/flatmateProvider.js` fetches a wide page (200) and
applies them client-side. This is honest for one city and a small dataset and **does not scale** — it
makes `total` the post-filter count and breaks as soon as the board outgrows one page. The parity
harness asserts that a facet **narrows**, and asserts it by checking that every returned row matches
rather than by comparing counts: a no-op filter returns the *same* count, so a count assertion
cannot go red. The first version of that check asked the wrong question and passed while the facets
did nothing.

### Three server bugs the mock had been hiding

Writing the harness turned up three, two of them fixed in this slice:

1. **The default page 500'd.** `and (:locality is null or lower(r.locality) = lower(:locality))` —
   Hibernate cannot infer a null parameter's type, binds it as `bytea`, and PostgreSQL has no
   `lower(bytea)`. Every *filtered* request worked; the unfiltered one everybody lands on did not
   (D117).
2. **Joining 500'd for anyone with no name.** `flatmate_group_members.name` is `NOT NULL` and was fed
   from the nullable `users.name`, which OTP sign-in never sets — so it broke for exactly the users
   who had just signed up (D118).
3. The silently-ignored facets above.

### Making a handler async is a behaviour change

The seat and occupancy steppers are +1/−1 controls, so they are tapped in bursts. When the write was
a synchronous localStorage call, two taps in quick succession both applied. Awaiting a request
instead means the second tap reads the row captured by a render that has not happened yet: both
requests ask for the same number and one tap is silently swallowed — 2 → 1, not 2 → 1 → 0. Each
stepper now holds the value its row is being moved *to* while the request is in flight, so the next
tap continues from where the row is going rather than from where the screen still says it is.

It also changes what the e2e can assume. A spec that fired two clicks and checked only the end state
now leaves Playwright re-running its actionability check against a button React is re-rendering
underneath it. Asserting the intermediate count fixes that and says more than the end state did.

### Ids belong to the server

The call sites used to mint `'s' + Date.now()` before saving. That is the one thing a client must
never do — two devices inside the same millisecond mint the same id, and against the real API the
value is discarded anyway. Moving it out is what let the call sites stop caring; the mock then has
to mint it too, or its create returns a row with `id: undefined` and every reader that matches on it
breaks. Watch the store helpers while doing this: `saveFlatmatePost` ends `return set(key, arr)` and
hands back the whole **array**, not the row.

## The service-requests slice: the honest subset of a two-sided concierge flow

The largest and most divergent slice, and the first where the right answer was to migrate **part** of
a domain and say so. The mock (`lib/serviceFlow.js`) is not a thin store — it is a full concierge
workflow: a customer raises a request, ops assigns it, a document checklist is verified item by item,
a draft is shared and approved or sent back, a final document is uploaded, and a co-fill invite can
split a rent agreement across two mobiles. The customer API (`/service-requests`) carries the slice
of that a **signed-in requester** can genuinely reach, and nothing more.

### What is live, and what is not

| Operation | Live | Note |
|---|---|---|
| `listServiceRequests(type)` | **yes** | `GET /service-requests?type=` — paged, server-filtered by type |
| `getServiceRequest(id)` | **yes** | a miss is a 404, mapped to `null` — same as every other id read |
| `createServiceRequest(data)` | **yes** | `details` is summarised to a string; opens `new` → shown `submitted` |
| `addServiceRequestMessage(id, text)` | **yes** | `POST /{id}/messages`, then re-read for return-shape parity with the mock |
| `decideServiceRequestDraft(id, decision)` | **yes** | `accepted`→`approve`, else `reject`; a rejection returns the request to ops, not a failure |
| `listPartyServiceRequests()` | no | co-fill has no counterparty endpoint — returns `[]`, never `undefined` |
| `markServiceRequestRead(id)` | no | no read-receipt endpoint; unread badges are mock-only |

The mock keeps **full fidelity** — it is the demo and the source of the screenshots, so it must show
the whole flow. Live mode does the honest subset; the degraded parts are documented here and are
**not asserted** by the live suite, because asserting a gap as if it were a feature is how a gap
becomes permanent.

### `details` is write-only

The customer sends a structured object (`{property, rent, deposit, months, …}` for a rent agreement,
free-form scope for interior). `ServiceRequestCreate` accepts `details` as a **string**, and
`ServiceRequestDto` has no `details` field at all. So the mapper's `toCreate` flattens the object to
`Label: value` lines (dropping nested objects), and `toViewModel` returns `details: {}` — the view
optional-chains it and renders nothing rather than the fields the user typed. The tracker's summary
lines are a mock-only affordance; live, the request is identified by its type and its thread.

### Documents do not resolve in dev

Draft and final documents are `multipart/form-data` to the document vault, and the vault answers with
**signed URLs** that do not resolve against a dev backend. There is no upload surface behind the
customer tracker either — sharing a draft and uploading a final are staff transitions. So `draft`
and `finalDoc` are projected from `documents[]` by category (`draft` / `final-document`, newest wins,
`version` = count) for when they *do* exist, but a customer-created request carries neither, and the
per-request **document checklist** — six named items in the mock — has no read representation on the
wire and stays mock-only.

### `changes_requested` survives; the rejection note does not

The maker-checker has three customer-visible outcomes in the mock: accept, reject-with-changes, and
a standing `draftDecision` record. The server's `POST /{id}/draft-decision` takes `approve` / `reject`
and parks a rejection in its own `changes-requested` status (added by D121, widened in V75), so the
mapper maps it to the tracker's `changes_requested` step and reconstructs `draftDecision` as
`{type:'accepted'}` for `approved` and `{type:'changes'}` for `changes-requested`. What is *not*
recoverable is the customer's note: it lands in the message thread rather than on the request, so
`draftDecision.note` is empty on a live read and the ops queue shows its unadorned
"Customer requested changes" line.

### Message roles, and the identity that keys them

`MessageDto.authorRole` is `buyer|owner|staff|admin`; the tracker's bubbles key on `user|staff`.
Everything that is not staff-side is the customer, **including `owner`** — an owner raising a service
request is a customer of the service desk, the same rule the support slice learned. The mock keys its
store on the signed-in user's mobile (`readUser().mobile`), and co-fill counterparty operations
resolve the owner from the stored row; the http provider needs none of that because the token scopes
every read to its requester.

### The three landing forms were safe to migrate

`ServiceLanding.jsx`, `InteriorRenovation.jsx` and `PropertyValuation.jsx` create through the seam
now. All three are sign-in gated, so `form.mobile` is always the session user's own — there is no
counterparty to key against. `useRentAgreement.js` is the exception and stays on `serviceFlow.create`:
its create is a **co-fill** that keys on the *other* party's `ownerMobile`, which the customer API has
no endpoint for. The landing creates are fire-and-forget (`.catch(() => {})`): the synchronous ops
lead ticket (`mockApi.createServiceRequest`, a separate system, untouched) remains the primary
artifact, and a live POST failure is swallowed rather than blocking the confirmation the user already
saw. `ServiceTracker.jsx` hides its "preview sample draft" button in http mode — it is a demo
affordance that seeds a mock request, and there is nothing to seed against the API.

## The verification slice: a badge, never a wall

The opt-in Aadhaar "Verified" badge. It is small on the wire — two endpoints — but it is the first
slice whose whole point is that the seam changes *nothing anyone can see is gated*. The badge is a
trust signal (ADR-019: "a badge, never a wall"); the one place identity has teeth is the server-side
contact gate, when an owner opts into verified-contacts-only, and that gate reads `users.verified`
live and is untouched by this slice. Everything in the seam is additive trust.

### What is live, and what is not

| Operation | Live | Note |
|---|---|---|
| `getAadhaarStatus()` | **yes** | `GET /me/verification/aadhaar` — always **200**, never 404. A never-tried caller reads `{status:'none', verified:false}`; absence of a badge is a state, not a missing resource. Signed-out is answered locally with the none-tier rather than a round trip |
| `startAadhaar(details)` | **yes** | `POST /me/verification/aadhaar` — **202**. Returns a *pending handle* (`ref`, `verificationUrl`, `expiresAt`), **not** a badge; the DigiLocker webhook grants it later. A retry overwrites the handle; a dedup collision is `409 aadhaar_already_registered` |
| the growth perk | no | `applyVerifiedBadgeToListings` (an instant listings boost on grant) has no server counterpart — mock-only, so the live handle's `perk` is null |
| the webhook | n/a | `POST /webhooks/digilocker` is provider→server, not a browser call, so it is outside the seam entirely |

The mock keeps **full fidelity**: it grants the badge at once (there is no webhook to wait for),
records it against the Aadhaar-linked mobile, and applies the growth perk — it is the demo, and the
screenshots need the whole arc. Live mode does the honest subset: a start is pending until a webhook
that a dev backend never receives, so the badge stays unearned, and the live suite asserts exactly
that (pending, not verified) rather than pretending the grant happened.

### The write goes through the seam, or the two providers disagree

The badge is *read* everywhere (eight call sites) but *written* in one — the shared
`AadhaarVerifyModal`. That write had to move onto the seam too. If the modal kept writing the mock's
`localStorage` record while the http provider read from the API, the two would diverge the instant a
user verified: the badge would light from local state and vanish on the next context refresh. So the
modal now calls `startVerification`, and the providers split on what that means — the mock grants and
returns `{verified:true, perk}`, the http provider returns the pending handle and the modal redirects
the browser to `verificationUrl`. The 1.7s simulated redirect delay lives in the **mock** provider
(`MOCK_REDIRECT_MS`), so the demo's pacing survives without the http path inheriting a fake wait.

### `aadhaarMobile` is never on the wire

The mock's view model carries the Aadhaar-linked mobile; DigiLocker returns no mobile, only the
masked last four. So the mapper carries `aadhaarMobile: ''` — present, so mock and live answer the
context the same keys, but empty. The one reader that wants it, the tenant-profile mirror, already
falls back to the account mobile when it is blank, so a blank is invisible to it.

### One badge, read once, in a context

`VerificationContext` fetches the badge once on sign-in (keyed on `isIn`) and holds it, the same
shape as `PlanContext`. The eight readers — the dashboard overview and completion meter, the flatmate
supply gate, the my-listings verify banner, the contact-owner modal, the post-a-property nudge, the
profile tab and the tenant profile — all read `useVerification()` rather than calling the store, so a
grant lights every one of them from a single refresh. `useVerification()` is null-safe outside the
provider (degrades to the none-tier), the same defence the other context hooks use.

## The document slice: the owner side of a token-mediated vault (foundation only)

The document vault is a two-sided flow, and only one side maps to the API cleanly, so this slice
draws the seam around that side and leaves the other on the mock — deliberately, not as an oversight.

An **owner** keeps a listing's papers in a vault (`/me/documents/{propId}` — list, multipart upload,
delete) and answers requests for them from an inbox (`/me/documents/requests` — list, and
`PATCH .../{reqId}` to grant or decline). Both are scoped to the signed-in owner by the token, both
have a faithful wire shape, and both are in the seam. A **buyer** asks for papers
(`POST /documents/requests`) and, once granted, opens them with a share token
(`GET /documents/shared?token=`) — but the server gives the buyer **no way to poll a request's
status**, so there is nothing on the wire for the buyer's tracker to read. `DocumentsSection` and
`ViewDocuments` therefore keep reading `lib/data/documents.js` cross-user localStorage directly,
never through the service — the same shape as the presentation helpers in the service-requests slice.

### What is live, and what is not

| Operation | Live | Note |
|---|---|---|
| `listDocuments(mobile, propId)` | **yes** | `GET /me/documents/{propId}` — tolerates a paged or bare list |
| `uploadDocument(mobile, propId, {category, file})` | **yes** | `multipart/form-data` (`category`, `file`) via `postMultipart` — the platform sets the boundary, so http.js must **not** send a `Content-Type` for a `FormData` body |
| `deleteDocument(mobile, propId, docId)` | **yes** | `DELETE`, then re-list for return-shape parity with the mock |
| `listDocRequests(mobile)` | **yes** | `GET /me/documents/requests` — an empty inbox is `[]`, never a throw |
| `respondDocRequest(mobile, reqId, decision, note)` | **yes** | `PATCH .../{reqId}` with `{status, note}`; anything not `granted` clamps to `declined` — a typo is a safe no-op, not a leak |
| the vault preview | no | the wire returns a signed `url` a dev backend does not serve, so `toDoc` carries it for a viewer but the bytes only exist behind the mock's `dataUrl` (D120 pattern) |
| the buyer's ask / poll / open | no | token-mediated with no status read — `DocumentsSection`/`ViewDocuments` stay on `lib/` (D123) |
| grant notification, shared-doc count, doc-count badge | no | `notifyBuyerDocsGranted`, `countSharedDocs`, the dashboard badge — the server owns the grant, so these stay mock-only |
| rent agreements | no | they overlap the already-live tenancy flow (created as a side effect in `lib/data/tenancy.js`) — out of this slice |

### The mapper's reconciliations

`categories[]` collapses to a single `docType` (the first) for the inbox row, with the full list
preserved as `categories`; the requester mobile passes through **masked** and is never unmasked here;
`shareToken`/`expiresAt` are the owner's re-send affordances, null until a request is granted and null
in mock mode; every time is epoch ms because both lists sort on it. A vault document carries **both**
`dataUrl` (mock bytes) and `url` (signed, http) with the other null, so a future viewer can be
dual-mode without the providers disagreeing.

### Foundation only — nothing flips yet

The service, both providers, the mapper and `npm run parity:document` all exist and agree, but **no
component imports `documentService.js` yet** and `document` is not in `VITE_API_DOMAINS`, so every
browser run still serves the mock. The owner-vault consumers (`DocumentsTab`, `useDashboardData`,
`DocVault`, `useRentAgreement`, the ownerProperties doc-count) read sync localStorage in their render
bodies; making those five call sites async, giving `DocVault.openDoc` a dual-mode (dataUrl blob **or**
signed url), and adding `document` to `playwright.live.config.js` is the queued follow-up slice
(D124). The per-domain live flag is all-or-nothing, so nothing flips until every consumer is handled.

## Local run
