# Flow: Share a Flat (Flatmates, Rooms & Groups)

> The flatmate marketplace: seekers post requirements, hosts list rooms or create flat-share groups,
> everyone discovers via filters/map, and interest is shaped by an **L1 sign-in floor**, an optional
> seeker-verification badge, and anti-broker guardrails.
> Under **badge-not-gate (ADR-019)** posting and interest need only being signed in (L1); there is
> **no Aadhaar posting/contact gate** — verification is an optional trust badge.
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** buyer/tenant (seeker + host), admin/ops (moderation)

---

## 1. Purpose & user problem
- **Persona:** a seeker looking for a flatmate/room on a budget; a host (owner or sitting tenant)
  with a spare room or an open seat in a shared flat.
- **Job-to-be-done (seeker):** "Find a compatible flatmate/room near my budget and reach out."
  **(host):** "List my room / group, find flatmates, and manage who joins."
- **Why it matters:** flat-sharing is a distinct, high-frequency demand segment (students, young
  professionals). Trust is the product here - the whole flow is built around anti-broker guardrails,
  the L1 sign-in floor (`requireSignedIn`), optional Verified badges and Ops moderation so the shares
  are genuine.

## 2. Entry points
- **Routes:** `/share-flat` (public browse; posting/interest require sign-in). Query params:
  `view=<flatmates|rooms|groups>`, `loc=<locality>`, `g=<male|female>`, `near=lat,lng` (+ `nearlabel`,
  `nearr`, `nearmode`), `post=1` (open the post-requirement modal directly).
- **Room listing** reuses the property wizard via `/list-property?share=1` (see the list-property
  wizard doc).
- **Source components:** `src/pages/consumer/ShareFlat.jsx` (shell) + `shareflat/*`:
  `useShareFlat.jsx` (orchestrator), `useShareDiscovery.jsx` (filters/sort/lists),
  `useShareSupply.jsx` (posting/verify/consent/join), `Hero`, `FilterBar`, `Results`,
  `ShareMapGate`/`ShareMap`, `PostModal`, `GroupModal`, `VerifyModal`, `SeekerCard`, `RoomCard`,
  `GroupCard`, `AgreementUpload`. Core data: `src/lib/data/shareFlat.js`, rooms in
  `src/lib/store/listings.js` (`puneNestRoomListings`).

## 3. Actors & roles
- **Seeker (demand):** browses, saves, and expresses interest / requests to join. Sign-in required to
  act; a "verified seeker" badge is earned via OTP.
- **Host (supply):** posts a flatmate requirement, lists a room, or creates a group. Host actions
  require only an **L1 sign-in** (`requireSignedIn`) — **no Aadhaar gate**; identity is an optional
  badge. A host is `owner` (lists their own flat) or `tenant` (a sitting tenant seeking a
  replacement, needs a registered agreement + owner consent).
- **Admin/Ops:** moderates tenant-tier and flagged posts via the Ops share-review queue.
- **Ownership match** (`ownsGroup` / `ownsRoom`): last-10 mobile digits (exact) or name fallback, so
  owner controls never appear on seed posts.

## 4. Entities touched
- [`share_flat_requests` (seeker posts)](../../system/data-model.md) - `puneNestShareRequests`,
  created/edited/deleted by `saveShareRequest` / `updateShareRequest` / `deleteShareRequest`. One
  live request per person (`getMyRequest`).
- **Share groups** - `puneNestShareGroups`, `saveShareGroup` / `updateShareGroup` /
  `deleteShareGroup`. Seed groups (from `constants.js`) stay out of storage.
- [`rooms`](../../system/data-model.md) - `puneNestRoomListings` (via `addRoom` / `updateRoom` in
  the property wizard), `status: 'pending'`, carries `seatsTotal`/`seatsOpen`/`verificationTier`.
- **Host inbox requests** - `puneNestShareFlatReq:<hostDigits>` (`addShareFlatRequest` /
  `decideShareFlatRequest`) - the host-facing incoming requests shown in Dashboard -> Requests.
- **Interests / saved / verified** - `puneNestShareInterests` (per-seeker `hasInterest`/`addInterest`),
  `puneNestShareSaved`, `puneNestSeekerVerified` (`isSeekerVerified`/`setSeekerVerified`).
- **Ops review queue** - `puneNestShareReviews` (`enqueueShareReview` / `decideShareReview` /
  `getShareReviewStatusMap`). **Owner consent** - `puneNestOwnerConsent` (`hasOwnerConsent` /
  `setOwnerConsent`). Also writes `puneNestNotifications` and `pnPendingRequests` (chat handoff).

## 5. Business rules & logic  *(the meat)*

### Three tabs / listing types
- **Flatmates** (seeker requirements), **Rooms** (a host's spare room), **Groups** (a shared flat
  with open seats). Each has its own card, interest key and matching rules.

### Posting a flatmate requirement (`useShareSupply.submitPost`)
- Gated by `requireSignedIn` (L1 sign-in only; no Aadhaar). **One live request per person:** if
  `myPost` exists, a fresh post redirects to editing it.
- Validation: `name`, `budget`, at least one `localities` entry.
- Fields: `name, gender (female default), age, occupation, budget, localities[], moveIn (now), flatPref,
  roomPref, tags[], note, verifiedContactOnly, mobile, verified`. Persisted with `id: 's'+ts`.
- `verifiedContactOnly` lets a seeker accept interest only from verified seekers (enforced in
  `onInterest`).

### Listing a room (`listRoom`)
- `requireSignedIn(() => navigate('/list-property?share=1'))` - routes into the property wizard's
  flatmate track (documented in the list-property wizard doc), which creates a `room` with
  `verificationTier`, `seatsTotal`/`seatsOpen`, and enqueues an Ops review for tenant/flagged posts.

### Creating a group (`submitGroup`)
- Gated by `requireSignedIn` (L1). Validation: `title`, `rent`, member `name`.
- **Seats:** `seatsTotal = grp.seats` (default 2); `seatsOpen = clamp(1, seats, grp.seatsOpen)` -
  honest for a tenant backfilling one seat in an occupied flat.
- **Policy:** `women` / `any` (and others) - `policy === 'any'` means open-join.
- **Verification tier derivation:**
  - `owner` role + attached `propertyId` (an Ops-verified listing) -> tier `owner`.
  - `owner` role without a property -> tier `identity`.
  - `tenant` role that declares AND attaches a registered agreement (`hasAgreementEvidence`) -> tier
    `tenant`; declared-without-upload -> tier `identity` (still posts, no host badge, no review).
- **Owner consent (tenant track):** a tenant enters the flat owner's mobile and confirms via an OTP
  sent to the owner (`OwnerConsentModal` -> `setOwnerConsent`), turning "trust me" into an auditable
  consent record. `ownerConsent` is only true when `consentVerified`.
- **Prefill helpers:** `prefillGroupFromListing` (attach an Ops-verified own listing - fills
  title/locality/rent only, never trust signals) and `prefillGroupFromTenancy` (a finalised PuneNest
  tenancy seeds the owner's number for the consent step).

### Anti-broker guardrails (`src/lib/data/shareFlat.js` `evaluateHostEligibility`)
The single decision point both group + room create flows call:
- **Cap (`MAX_ACTIVE_HOST_SHARES = 3`):** counts live **non-owner-tier** shares (`countCappedActiveShares`
  across groups + rooms). Owner-tier posts are **exempt** from the count. Over cap -> **hard block**.
- **Address fingerprint (`addressFingerprint`):** `prop:<id>` (strongest) else `addr:<society>|<loc>`
  or `addr:<title>|<loc>` - a stable key per physical flat.
- **Duplicate (same host, same address)** -> **hard block**.
- **Different host, same address** -> **soft flag** (`flagForReview`) - still posts but routed to Ops
  (fuzzy match, so flag-not-block to avoid false positives).
- Result: `{ fingerprint, overCap, duplicate, flagForReview, blocked, reason }`.

### Ops moderation queue (`enqueueShareReview` / `decideShareReview`)
- Tenant-tier posts (self-attested agreement) and any flagged address land in `puneNestShareReviews`
  with `status: 'pending'`. The uploaded agreement is stored as metadata + inline data URL when under
  the 3 MB cap (else recorded present-but-not-stored). One review per group/room.
- Ops `decideShareReview(id, 'verified'|'rejected', reason)` -> the card shows Ops-verified / review
  failed (`getShareReviewStatusMap` drives `reviewMap`). This is a maker-checker (host proposes,
  Ops approves).

### Discovery: filters, sort, matching (`useShareDiscovery.jsx`)
- **`emptyFilters`:** `q, locality, budget (40000 max), moveIn, gender, sharing, verifiedOnly,
  attachedBath, habits[], near, nearLabel, nearRadius (5), nearMode (km)`.
- Matching helpers: `seekerMatches`, `roomMatches`, `groupMatches` (the last two also consider the
  Ops review status). Free-text `q` doesn't count as a narrowing filter; `budget < 40000` does.
- **Sort modes:** `verified` (default), `match` (requires the seeker to have posted - otherwise
  prompts them to post), and others via `sortPosts`.
- **"Near a place":** radius filter in km or minutes; every post is normalized with coordinates
  (`withCoords`) so cards, map and radius share one shape.

### Map gate (`ShareMapGate`, `MAP_MAX_AREAS = 5`)
- The map view stays legible by asking the user to focus on up to 5 areas first (mirrors the Listings
  map gate). Picking one area unlocks it.

### Contact gating (expressing interest)
- **Flatmate interest (`onInterest`):** requires sign-in (else redirect to `/signin?reason=contact`).
  Blocked if already interested (`hasInterest`). If the seeker set `verifiedContactOnly` and the
  actor is **not** a verified seeker -> blocked + verify modal. On success: `addInterest`, record a
  **host-facing request** (`addShareFlatRequest(seekerMobile, {kind:'flatmate', action:'request'})`),
  push a notification, and queue a chat handoff (`pnPendingRequests`).
- **Room interest (`onRoomInterest`):** distinct key `room-<id>`; same gate; records
  `addShareFlatRequest(room.ownerMobile, {kind:'room'})` + notification + chat handoff.
- **Group join (`onJoin`):** blocked if owner, full (`seatsLeft <= 0`), or already asked. Open-policy
  groups (`policy === 'any'`) record `action: 'join'` (auto-accepted, informational); others record
  `action: 'request'` (needs host approval). Plus notification + chat handoff.
- **Host inbox:** `addShareFlatRequest` dedupes by requester+target; `status` is `accepted` for
  `join`, else `pending`. The host decides via `decideShareFlatRequest(ownerMobile, id, decision)`
  from Dashboard -> Requests -> Flat-share (`shareFlatReqPendingCount` badge).

### Seeker verification (`submitVerify`)
- OTP flow (mock: any 6 digits). On success `setSeekerVerified(userKey)` and, if the seeker has a
  live post, flips it to `verified: true`. This is a lighter, seeker-side **opt-in badge** (a trust
  signal); posting/interest never require it — the floor is L1 sign-in (ADR-019).

### Seat backfill lifecycle
- `setGroupSeats` / `setRoomSeats` let the owner reopen/close seats as flatmates come and go
  (adjust `seatsOpen` only). The `verificationTier` is preserved, so a re-list needs **no**
  re-verification. `markFilled` / `deleteMyRequest` remove a seeker's own post.

## 6. Maker-checker / approval
- **Two approval loops:**
  - **Ops share-review (host -> Ops):** tenant-tier and flagged posts enter `puneNestShareReviews`
    `pending`; Ops decides `verified`/`rejected`. Canonical maker-checker
    ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2; society-claim-style
    row).
  - **Host request approval (seeker -> host):** a non-open interest/join creates a `pending`
    host-inbox request the host accepts/declines (`decideShareFlatRequest`). Open-policy joins skip
    approval (`accepted` immediately).
- **Owner consent** is an auditable OTP confirmation (not a full approval queue) proving the flat
  owner is aware of a tenant's replacement search.

## 7. State machine
```
Seeker post:      (none) --submitPost--> live --markFilled/delete--> removed
                              \--verify--> verified badge (verified: true)

Room / Group:     draft --create--> pending --(Ops, tenant/flagged only)--> verified | rejected
                     seats: seatsOpen in [0..seatsTotal]  (reopen/close, tier preserved)
                     seatsOpen == 0  => effectively filled (roomActive/groupSeatsOpen false)

Host-inbox request: (none) --interest/join(request)--> pending --host decide--> accepted | declined
                    open-policy join --------------------------> accepted (auto)

Host eligibility:  evaluateHostEligibility -> blocked (cap/duplicate) | flagForReview | ok
```
- **Terminal:** seeker post removed; room/group `rejected` (or seats 0 = filled); host request
  `accepted`/`declined`.

## 8. Edge cases, validation & error states
- **Guest acting:** interest/join/post redirect to `/signin` (contact reason preserved).
- **Guest host acting:** listing/grouping/posting redirects to `/signin` (next-URL preserved); the
  action is retried after sign-in. There is no Aadhaar step.
- **Cap hit / self-duplicate address:** hard block with a reason toast; no post created.
- **Cross-host address collision:** posts but `flagForReview` -> Ops queue.
- **`verifiedContactOnly` seeker:** unverified actors are blocked and shown the verify modal.
- **Duplicate interest / already member / full group:** idempotent toasts, no second request.
- **One live request per person:** starting a new post while one exists edits the existing one.
- **Agreement too large (>3 MB):** stored as metadata only (`dataUrl: null`, `tooLarge`), review
  still enqueues (quota-safe retry).
- **Tenant declared-without-upload:** stays `identity` tier (no host badge, no review) - can't fake
  the tenant badge.
- **Owner controls on seed posts:** never shown (`ownsGroup`/`ownsRoom` require an exact mobile match
  or name fallback; seeds have no owner).
- **No detail route:** posts live only on the list; "go to posting" switches to list, narrows to the
  locality, scrolls to and flashes the card.

## 9. Current mock implementation
- **Orchestrator:** `shareflat/useShareFlat.jsx` (collections, tabs, interest handlers).
- **Discovery:** `shareflat/useShareDiscovery.jsx` (`emptyFilters`, filters/sort, `seekerList` /
  `roomList` / `groupList`).
- **Supply:** `shareflat/useShareSupply.jsx` (`requireSignedIn`, `submitPost`, `submitGroup`,
  `listRoom`, `createGroup`, `onJoin`, `setGroupSeats`/`setRoomSeats`, `openConsent`, `submitVerify`).
- **Core data:** `src/lib/data/shareFlat.js` - requests/groups CRUD, `evaluateHostEligibility`
  (`MAX_ACTIVE_HOST_SHARES`, `addressFingerprint`, `findAddressClaims`), Ops reviews
  (`enqueueShareReview` / `decideShareReview` / `getShareReviewStatusMap`), owner consent
  (`hasOwnerConsent` / `setOwnerConsent`), seeker verify, interests, and the host inbox
  (`addShareFlatRequest` / `decideShareFlatRequest` / `shareFlatReqPendingCount`).
- **Rooms store:** `src/lib/store/listings.js` (`addRoom` / `updateRoom` / `getRooms`,
  `puneNestRoomListings`).
- **Key components:** `PostModal`, `GroupModal`, `VerifyModal` (opt-in seeker-badge OTP),
  `AgreementUpload`, `components/auth/OwnerConsentModal.jsx`,
  `SeekerCard`/`RoomCard`/`GroupCard`, `dashboard/useDashboardData.js` (`decideShareFlatReq`).
- **Data/seed:** seekers/rooms/groups seeds in `shareflat/constants.js`.

## 10. Target API endpoints
Map to the [OpenAPI spec](../../../backend/src/main/resources/static/openapi/punenest-api.yaml) (tag: Engagement):
- `GET /share-flat/requests`, `POST /share-flat/requests`, `PATCH /share-flat/requests/:id`,
  `DELETE /share-flat/requests/:id`, `GET /share-flat/rooms`, `POST /share-flat/rooms`.
- **Missing but implied:** groups CRUD, a host-inbox endpoint (`GET /me/share-flat/requests` +
  `PATCH .../:id`), an interest/join endpoint, an Ops share-review queue + decision endpoint, seeker
  verification (OTP), owner-consent OTP, and the anti-broker eligibility check on create (return the
  block reason / flag).

## 11. Backend responsibilities
- **Enforce the anti-broker guardrails server-side:** the active-share cap (owner-tier exempt),
  address-fingerprint dedup (hard block same host, flag cross-host) - the client must not self-gate.
- **Own the verification tiers:** only an Ops-verified property grants `owner` tier; only an
  Ops-verified agreement grants `tenant` tier; the client can't self-assign a host badge.
- **Own the Ops review queue** and store the agreement securely (not inline localStorage), gating who
  can read it; write the decision + audit.
- **Enforce owner consent** as a real OTP against the owner's number, recorded auditable, before a
  tenant replacement search is shown.
- **Gate interest/contact** per the seeker's `verifiedContactOnly` and identity rules; persist the
  host inbox with proper FKs (requester `users.id`, target id) instead of mobile-keyed localStorage;
  dedupe on the server.
- **Generate notifications and chat handoffs** server-side on interest/join/consent instead of the
  client seeding `puneNestNotifications` / `pnPendingRequests` (cross-cutting section 7).
