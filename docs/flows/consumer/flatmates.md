# Flow: Flatmates (Move in now / Team up)

> The flatmate marketplace: people who need a home browse **places** or **people**, hosts offer a
> room / an open seat / a whole flat let room-by-room, and interest is shaped by an **L1 sign-in
> floor**, an optional identity badge, and anti-broker guardrails.
> Under **badge-not-gate (ADR-019)** posting and interest need only being signed in (L1); there is
> **no Aadhaar posting/contact gate** — verification is an optional trust badge, and it is now the
> **same DigiLocker identity badge (ADR-009a)** the rest of the app uses, not a separate seeker OTP.
> **Status:** documented from React source · re-synced to the two-tab redesign + owner flat-split - **Primary role(s):** buyer/tenant (seeker + host), admin/ops (moderation)

---

## 1. Purpose & user problem
- **Persona:** a seeker looking for a flatmate/room on a budget; a host (owner or sitting tenant)
  with a spare room, an open seat in their own flat, or a whole flat they want to let room by room.
- **Job-to-be-done (seeker):** "Find a compatible flatmate/room near my budget and reach out."
  **(host):** "List my room / group, find flatmates, and manage who joins."
- **Why it matters:** flat-sharing is a distinct, high-frequency demand segment (students, young
  professionals). Trust is the product here - the whole flow is built around anti-broker guardrails,
  the L1 sign-in floor (`requireSignedIn`), optional Verified badges and Ops moderation so the shares
  are genuine.

## 2. Entry points
- **Routes:** `/flatmates` (public browse; posting/interest require sign-in). `/share-flat` is a
  permanent redirect to `/flatmates` so links from before the rename still resolve
  (`App.jsx`). Query params:
  `view=<move-in|team-up>` (legacy `flatmates|rooms|groups` still resolve via `normalizeTab`),
  `loc=<locality>`, `g=<male|female>`, `near=lat,lng` (+ `nearlabel`, `nearr`, `nearmode`),
  `post=1` (open the post-requirement modal directly), `startGroup=1&title=&rent=&loc=` (seed a
  Team-up group from a property detail page's "split the rent" card).
- **Room listing** reuses the property wizard via `/list-property?flatmate=1` (see the list-property
  wizard doc). **Owner flat-split** is reached from that wizard's success screen and from
  Dashboard -> My Listings ("Let room by room") - see section 5.
- **Source components:** `src/pages/consumer/Flatmates.jsx` (shell) + `flatmates/*`:
  `model.js` (domain model: tabs, room kinds, pricing basis, occupancy), `useFlatmates.jsx`
  (orchestrator), `useFlatmateDiscovery.jsx` (filters/sort/lists), `useFlatmateSupply.jsx`
  (posting/verify/consent/join), `Hero`, `FilterBar`, `PostChooser`, `Results`,
  `FlatmateMapGate`/`FlatmateMap`, `PostModal`, `GroupModal`, `SplitFlatModal`, `SeekerCard`,
  `RoomCard`, `GroupCard`, `AgreementUpload`, `FlatmateAlertCard` + `alertCriteria.js`,
  `NearPlaceField`, `atoms.jsx`, `helpers.js`, `constants.js`. Shared:
  `components/auth/AadhaarVerifyModal.jsx`, `components/auth/OwnerConsentModal.jsx`,
  `components/ReportModal.jsx`. Core data: `src/lib/data/flatmates.js` and
  `src/lib/data/flatSplit.js`; rooms in `src/lib/store/listings.js` (`puneNestRoomListings`).

## 3. Actors & roles
- **Seeker (demand):** browses, saves, and expresses interest / requests to join. Sign-in required to
  act; the "Verified" pill is the shared DigiLocker identity badge, not a flatmates-only credential.
- **Host (supply):** posts a flatmate requirement, lists a room, splits a whole flat into rooms, or
  creates a group. Host actions require only an **L1 sign-in** (`requireSignedIn`) — **no Aadhaar
  gate**; identity is an optional badge. A host is `owner` (lets their own flat) or `tenant` (a
  sitting tenant seeking a replacement, needs a registered agreement + owner consent).
- **Admin/Ops:** moderates tenant-tier and flagged posts via the Ops flatmate-verification queue
  (`/ops/flatmate-review`); admin moderates seekers, groups and group applications at
  `/admin/flatmates`.
- **Ownership match** (`ownsGroup` / `ownsRoom`): last-10 mobile digits (exact) or name fallback, so
  owner controls never appear on seed posts.

## 4. Entities touched
- [`flatmate_requests` (seeker posts)](../../system/data-model.md) - `puneNestFlatmatePosts`,
  created/edited/deleted by `saveFlatmatePost` / `updateFlatmatePost` / `deleteFlatmatePost`. One
  live request per person (`getMyRequest`).
- **Share groups** - `puneNestFlatmateGroups`, `saveFlatmateGroup` / `updateFlatmateGroup` /
  `deleteFlatmateGroup`. Seed groups (from `constants.js`) stay out of storage.
- [`rooms`](../../system/data-model.md) - `puneNestRoomListings`, written by **two** paths:
  `persistFlatmate` (a host's single spare room; seat-based `seatsTotal`/`seatsOpen`) and `splitFlat`
  (an owner letting a whole flat room by room; occupancy-based `occupants`/`maxOccupants` with
  `priceBasis: 'room'`). Both carry `verificationTier` and start `status: 'pending'`.
- **Host inbox requests** - `puneNestFlatmateReq:<hostDigits>` (`addFlatmateRequest` /
  `decideFlatmateRequest`) - the host-facing incoming requests shown in Dashboard -> Requests.
- **Interests / saved / verified** - `puneNestFlatmateInterests` (per-seeker `hasInterest`/`addInterest`),
  `puneNestFlatmateSaved`, `puneNestSeekerVerified` (legacy seeker badge, still read so anyone who
  earned it keeps it).
- **Ops review queue** - `puneNestFlatmateReviews` (`enqueueFlatmateReview` / `decideFlatmateReview` /
  `getFlatmateReviewStatusMap`). **Owner consent** - `puneNestOwnerConsent` (`hasOwnerConsent` /
  `setOwnerConsent`). Also writes `pnPendingRequests` (chat handoff) — it used to write
  `puneNestNotifications` too, a key the live inbox (`GET /notifications`) never read, so those rows
  were invisible on every surface and the writes are **deleted** — saved searches via
  `store/search.js` (`addSavedSearch`) \u2014 that module has since been **deleted**
  and saved searches go through `services/savedSearchService.js` \u2014 and reports via the shared
  report store.

## 5. Business rules & logic  *(the meat)*

### Two tabs, split by one question (`model.js`)
The page used to split by record type - **Flatmates / Rooms / Groups** - which asked the user to
learn our storage model. It now splits by the one question a seeker can always answer instantly:

> **"Is there an address yet?"**

- **`move-in` ("Move in now")** - you browse **places**: rooms, plus any group that already holds a
  flat. Priced, dated, visitable.
- **`team-up` ("Team up")** - you browse **people**: solo seekers, plus groups still hunting. You
  form a household first.

`tabOf(item)` decides: a room is always `move-in`; a group is `move-in` only when `hasAddress` (it
carries a `propertyId` or a `society`), else `team-up`; a seeker post is always `team-up`. Each feed
is therefore a **mixed** list and is re-sorted **as one list** - merging two pre-sorted lists would
stack every room above every group regardless of the chosen sort. `Results.renderCard` dispatches on
`item.kind` (`room` | `group` | `seeker`).

Legacy `?view=` values are kept as read aliases (`normalizeTab`): `rooms -> move-in`,
`flatmates -> team-up`, `groups -> team-up`, so old deep links, saved alerts and notification links
resolve instead of silently falling back to the default. Tab counts are **rendered** (not just
announced), because stock a seeker cannot see is stock they never switch tabs for; a zero count stays
visible but dimmed.

### One posting entry point (`PostChooser`)
Posting used to present three sibling CTAs ("Post a request", "List your room", "Create group").
There is now a single **Post** CTA that opens a two-step chooser mirroring the two browse tabs:

```
Do you have a place?
  yes -> listRoom()      -> /list-property?flatmate=1   (supply for "Move in now")
  no  -> who is looking?
           just me       -> openPostModal()             (seeker request, "Team up")
           we're a group -> createGroup()               (group, "Team up")
```

### Room taxonomy, pricing basis and occupancy (`model.js`)
Three orthogonal facts about a room, each answering a different seeker question:

- **`roomKind`** - `master` | `bedroom` | `living` (a partitioned hall is the budget option). Priced
  per **room**, matching the Indian share market: a master with its own bathroom commands a premium.
  `attachedBath` is **implied** by `master`, so the owner is never asked the same question twice.
  `roomKindOf` infers a kind for older rooms that only carry the `attachedBath` string.
- **`priceBasis`** - `person` (legacy spare-room posts quote what one flatmate pays) or `room` (an
  owner splitting a flat prices each room; sharers split it equally, so the owner's total never
  changes and the per-person price falls as more people take it). Mixing the two silently would make
  a ₹9,000 shared bed look pricier than a ₹14,000 private room, so the basis is explicit and defaults
  to `person` for every post predating the split flow.
- **`occupancy`** - `empty` | `filling` | `occupied`. Orthogonal to `hostRole`/`verificationTier`:
  occupancy answers *"will I have flatmates from day one?"*, host role answers the trust question. It
  is **derived** from the flat's ledger, never stored stale.

`decorateRooms` annotates each room once at the merge boundary with `flatCommitted` (people moved
into this flat across every sibling room), `flatMax` and `shareMax` = `min(ROOM_SHARE_MAX - occupants,
flatMax - flatCommitted)`, so cards and filters read a plain field instead of re-deriving the ledger.
The ledger is keyed per **flat** (`prop:<propertyId>`, else `addr:<society>|<flatNumber>`, else the
room's own id) - a bare society name is not safe, since two unrelated hosts in "Skyline Heights"
would pool into one ledger and suppress each other's rooms. `bestPerPersonRent` (the cheapest a room
can be per person given `shareMax`) is what the budget filter and the empty-state hint compare on, so
an ₹18,000 room that can legitimately be split can still surface under a ₹10,000 budget - and the
card states the split price up front so the seeker never has to work out why.

### Owner flat-split: letting one flat room by room (`src/lib/data/flatSplit.js`)
A second supply path, entered from the list-property success screen (`PostSuccessSplitNudge`) or from
Dashboard -> My Listings ("Let room by room"), and confirmed in `SplitFlatModal`.

- **Entry rule is deliberately narrow:** `canSplitIntoRooms` requires `deal === 'rent'` and an id. A
  sale listing can never be sliced, and the whole-flat listing keeps existing, so the share market
  never cannibalises core rental inventory.
- The owner declares only what they are entitled to decide: **which rooms exist**, **the rent for
  each**, and **how many people may live in the flat** (`maxOccupants`, the society's rule). They
  never declare how many people belong in a given room - tenants decide that, so per-room occupancy
  is emergent.
- **Bounds:** `maxRoomsForBhk(bhk)` = bedrooms + hall (the wizard's "4" pill means "4+", so its room
  count is unbounded); `ROOM_SHARE_MAX = 3` per room; `capBoundsFor(n)` = `[n, n * 3]`.
  `validateSplit` rejects `noRooms` / `tooManyRooms` / `missingRent` / `capOutOfRange`.
- **Only the listing's own owner** may split it (last-10-digit mobile compare - the UI is not a
  security boundary), and only **once** (`isFlatSplit` guard; splitting twice would create two room
  sets on one `propertyId` and corrupt the ledger).
- **The Owner-verified badge is earned, not asserted.** Being attached to a listing is not proof of
  ownership: a new listing is unverified until Ops approves it, so rooms start at `identity` tier,
  unbadged, and go to the Ops queue. `reconcileSplitVerification()` promotes them to `owner` tier +
  `verified` once the parent listing is approved. It runs on the owner's next visit (from
  `useFlatmates`) because the badge is stored on each room - seekers cannot read the owner's listing
  store, so a live lookup is impossible.
- **One review per flat**, not per room - reviewing four rooms of the same flat would be the same
  check four times.
- **Reversible only while empty:** `canUnsplit` / `unsplitFlat` refuse once anyone has moved in,
  because deleting their room would erase a live tenancy.
- **Occupancy ledger:** `setRoomOccupants(roomId, n)` clamps to `min(ROOM_SHARE_MAX, cap - others)`,
  so a society limit can never be exceeded by editing one room.

### Posting a flatmate requirement (`useFlatmateSupply.submitPost`)
- Gated by `requireSignedIn` (L1 sign-in only; no Aadhaar). **One live request per person:** if
  `myPost` exists, a fresh post redirects to editing it.
- Validation: `name`, `budget`, at least one `localities` entry.
- Fields: `name, gender (female default), age, occupation, budget, localities[], moveIn (now), flatPref,
  roomPref, tags[], note, verifiedContactOnly, mobile, verified`. Persisted with `id: 's'+ts`.
- `verifiedContactOnly` lets a seeker accept interest only from verified seekers (enforced in
  `onInterest`).

### Listing a single room (`listRoom`)
- `requireSignedIn(() => navigate('/list-property?flatmate=1'))` - routes into the property wizard's
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
  title/locality/rent only, never trust signals; rent is copied only from a **rent** listing, since a
  sale price is not a monthly rent) and `prefillGroupFromTenancy` (a finalised PuneNest tenancy seeds
  the owner's number for the consent step, pre-filled but never pre-verified).
- Draft persistence deliberately **excludes** the eligibility signals (`role`, `propertyId`,
  `agreement`, `agreementDoc`, `consentMobile`, `consentVerified`), so a stale badge claim can never
  be silently restored later.

### Anti-broker guardrails (`src/lib/data/flatmates.js` `evaluateHostEligibility`)
The single decision point every supply path calls - group create, single-room post **and** flat split:
- **Cap (`MAX_ACTIVE_HOST_SHARES = 3`):** counts live **non-owner-tier** shares (`countCappedActiveFlatmatePosts`
  across groups + rooms). Owner-tier posts are **exempt** from the count (a real owner may legitimately
  let several rooms) but never from the dedupe. Over cap -> **hard block**.
- **Address fingerprint (`addressFingerprint`):** `prop:<id>` (strongest) else `addr:<society>|<loc>`
  or `addr:<title>|<loc>` - a stable key per physical flat.
- **Duplicate (same host, same address)** -> **hard block**.
- **Different host, same address** -> **soft flag** (`flagForReview`) - still posts but routed to Ops
  (fuzzy match, so flag-not-block to avoid false positives).
- Result: `{ fingerprint, overCap, duplicate, flagForReview, blocked, reason }`.

### Moderate-before-public (`mod_status`, D72)
- Every seeker post, room and group is created with **`mod_status = 'pending'`** and is invisible on
  the public board until a moderator approves it. Backend default is set in the entity *and* in the
  column default (`V41__flatmate_moderate_before_public.sql`), so a row inserted by any route -
  API, migration, manual SQL - is held.
- Visibility is a **whitelist**, not a blacklist: `FlatmateVocabulary.MOD_PUBLIC = {live, approved}`
  and `isPublic(status)`. Public feeds, the count queries and the by-id `findVisible` paths all use
  it, so a moderation state added later fails **closed** instead of leaking until someone remembers
  to add it to a "hidden" list. The frontend mirrors the same whitelist in
  `providers/http/flatmateMapper.js` and `lib/data/flatmates.js`.
- The gate covers the by-id path too, not just the list: hiding a row from the feed while leaving it
  reachable and actionable by id is an unlisted page, not moderation.
- **The author still sees their own post** (`getMyRequest` reads unfiltered) and can edit or delete
  it while it waits. Their banner reads *"Your request · in review"* with the wait explained, not
  *"Your live request"*; the create toasts say the post was **saved** and is being checked.
- **Queue API:** `GET /admin/flatmates/moderation?kind=post|room|group&modStatus=…`
  (`STAFF_OR_ADMIN`) returns `PageResponse<FlatmateModerationQueueItem>` - id, kind, status, author
  id + **name only** (never the mobile), headline, locality, free text, createdAt. There is **no
  admin UI for this queue yet**; it is API-only.
- Distinct from the Ops review desk below, which is a *post-publication* trust check on tenant-tier
  and flagged posts. This gate runs first, for everything.

### Ops moderation queue (`enqueueFlatmateReview` / `decideFlatmateReview`)
- Tenant-tier posts (self-attested agreement), any flagged address, and any split whose **parent
  listing is not yet approved** land in `puneNestFlatmateReviews` with `status: 'pending'`. The
  uploaded agreement is stored as metadata + inline data URL when under the 3 MB cap (else recorded
  present-but-not-stored). One review per group / per flat.
- Ops `decideFlatmateReview(id, 'approved'|'rejected', reason)` -> the card shows Ops-verified /
  review failed (`getFlatmateReviewStatusMap` drives `reviewMap`). This is a maker-checker (host
  proposes, Ops approves). Full desk behaviour: [`../ops/service-queues.md`](../ops/service-queues.md) §5.3.

### Discovery: filters, sort, matching (`useFlatmateDiscovery.jsx`)
- **`emptyFilters`:** `q, locality, budget (40000 max), moveIn, gender, sharing, verifiedOnly,
  attachedBath, habits[], near, nearLabel, nearRadius (5), nearMode (km)`.
- **Tab-gated filters:** switching tabs clears the filter the destination cannot honour - `sharing`
  is `team-up`-only, `attachedBath` is `move-in`-only - so a stale value never lingers as an
  invisible, uncountable active filter after its control is hidden.
- **Two counters, deliberately different:** `activeFilterCount` ignores the free-text `q` and the
  near-tuning keys (`nearLabel`/`nearRadius`/`nearMode`), and gates the alert CTA on narrowing intent;
  `filtersActive` counts `q` too, because "Clear filters" must be able to undo a typed query.
- Matching helpers: `seekerMatches`, `roomMatches`, `groupMatches`, `postMatches` (the room/group ones
  also consider the Ops review status).
- **Sort modes:** `verified` (default), `match` (requires the seeker to have posted - otherwise
  prompts them to post), and others via `sortPosts`.
- **Smart search:** parses a natural-language query into structured chips (gender, budget `Xk`/`under
  N`, locality, move-in -> `now` or a concrete ISO date, verified, attached bath, habits). If anything
  parsed, the raw sentence is **cleared** from `q` - otherwise it keeps applying as a substring match
  and silently zeroes out honest results.
- **"Near a place":** radius filter in km or minutes; every post is normalized with coordinates
  (`withCoords`) so cards, map and radius share one shape.
- **Empty-state intelligence:** when a tab is empty and budget is the binding constraint, `raiseHint`
  finds the cheapest post that *would* match at "Any" and offers a concrete "raise your budget to ₹X"
  instead of a dead end. When the other tab still holds stock for the same filters, the empty state
  offers a **cross-tab rescue** (`otherCount` / `switchTab`) rather than "widen your budget".

### Alerts (`alertCriteria.js`, `FlatmateAlertCard`)
- `buildFlatmateAlertRecord(filters, tab)` produces `{ kind: 'flatmates', tab, ...filters, label }`,
  tab-gated per field so a stale value never rides along. `BUDGET_MAX = 40000` is treated as "Any"
  and omitted. `flatmateAlertLabel` / `flatmateCriteriaChips` render the same criteria everywhere -
  the alert card, the empty state's "why is this empty" chips, and the dashboard Alerts panel.
- The card appears when the list is empty **or** `activeFilterCount >= 2` (enough narrowing intent to
  want a ping), mirroring the listings page. Channels offered are WhatsApp and SMS.
- `tabMeta` runs values through `normalizeTab`, so an alert saved before the redesign is labelled
  correctly instead of mislabelled.

### Map gate (`FlatmateMapGate`, `MAP_MAX_AREAS = 5`)
- The map view stays legible by asking the user to focus on up to 5 areas first (mirrors the Listings
  map gate). Only areas that actually hold matching posts are offered, ranked by count, so a pick
  never dead-ends. A single active locality filter is carried into the focus on entry. A proximity
  search already narrows by radius, so `filters.near` bypasses the gate entirely.

### Contact gating (expressing interest)
- **Flatmate interest (`onInterest`):** requires sign-in (else redirect to `/signin?reason=contact`).
  Blocked if already interested (`hasInterest`). If the seeker set `verifiedContactOnly` and the
  actor is **not** verified -> blocked + verify modal. On success: `addInterest`, record a
  **host-facing request** (`addFlatmateRequest(seekerMobile, {kind:'flatmate', action:'request'})`),
  push a notification, and queue a chat handoff (`pnPendingRequests`).
- **Room interest (`onRoomInterest`)** carries a **share intent** - `solo` (alone), `bring` (with
  someone they already know, two people) or `match` (they want us to find them a room-sharer). Sharing
  is the tenant's call, not the owner's, so the choice is made at the point of enquiry and travels
  with it; `SHARE_OPENER` sets the opening chat message so the owner learns how many people are coming
  in the first line rather than three messages later. Distinct interest key `room-<id>`; records
  `addFlatmateRequest(room.ownerMobile, {kind:'room', share})` + notification + chat handoff.
- **Group join (`onJoin`):** blocked if owner, full (`seatsLeft <= 0`), or already asked. Open-policy
  groups (`policy === 'any'`) record `action: 'join'` (auto-accepted, informational); others record
  `action: 'request'` (needs host approval). Plus notification + chat handoff.
- **Host inbox:** `addFlatmateRequest` dedupes by requester+target; `status` is `accepted` for
  `join`, else `pending`. The host decides via `decideFlatmateRequest(ownerMobile, id, decision)`
  from Dashboard -> Requests -> Flatmate (`flatmateReqPendingCount` badge).

### Identity badge (`isVerified`, `AadhaarVerifyModal`)
The Flatmates "Verified" pill is now the **same government-backed DigiLocker KYC** the rest of the app
uses (ADR-009a), not a second, weaker scheme:
`isVerified = isAadhaarVerified() || isSeekerVerified(userKey)`.
The old scheme granted the badge after an OTP to the number the user was *already signed in with* -
which proved nothing new, yet drove the Verified filter, the card pills and verified-only contact.
Flatmates is where strangers agree to share a home, so the badge has to mean at least as much here as
it does on a property listing. `isSeekerVerified` is still read so anyone who earned the old badge
keeps it. `onVerified` mirrors the badge onto the seeker's live request (`verified: true`) so the card
shows the pill without waiting for a re-post. Verification is never required to post or to contact -
the floor is L1 sign-in (ADR-019).

### Reporting a post (`ReportModal`)
Cards pass a target descriptor (`{ id, title, ownerName, ownerMobile, kind }`) to the shared
platform report modal with the `SHARE_REPORT_REASONS` set. Rooms, seekers and groups alike are filed
as `kind: 'share'` → `targetType: 'post'` on the wire, and surface in the admin queue's
**Reported flatmate posts** tab.

That tab is newer than the reports themselves. The queue originally had only listings and users, and
split its rows with `kind === 'listing' ? … : kind === 'user'` - so `share` rows matched neither
branch and rendered in **no tab at all**. It was masked for a while by a second bug: these cards used
to send `kind: 'user'`, which put flatmate complaints under "Reported users & owners" wearing the
wrong vocabulary. Fixing the wire mapping is what made them disappear, which is the ordinary way a
latent gap becomes visible. Triage on this tab is `hide_content`, not `suspend_account`: a post is
content, and the person who wrote it may have done nothing worse than forget to take it down.

### Seat and occupancy lifecycle
- **Seat-based (legacy spare rooms and groups):** `setGroupSeats` / `setRoomSeats` let the owner
  reopen/close seats as flatmates come and go (adjust `seatsOpen` only). The `verificationTier` is
  preserved, so a re-list needs **no** re-verification.
- **Occupancy-based (owner-split rooms):** `setRoomPeople` records how many people **actually** live
  in each room, clamped by `setRoomOccupants` against the flat's cap. Because one **joint rent
  agreement** covers the owner and everyone in the flat, any change to who lives there is the moment
  to reissue it - the card offers `reissueAgreement` ->
  `/services/rent-agreement?flat=<propertyId|roomId>&reissue=1`.
- `markFilled` / `deleteMyRequest` remove a seeker's own post.

### Vacant-home disclosure (`RoomCard`)
A spare room in an occupied flat and a room in a vacant flat an owner is letting piece by piece are
priced alike but are **not** the same decision - in the first the household meets and vets you, in the
second your future flatmates are simply undecided. Any room whose `occupancy` is not `occupied`
therefore carries a full-width disclosure strip (not a chip in a row of six), stating whether the home
is empty or filling, how many people have moved in, and that one joint agreement covers everyone.

## 6. Maker-checker / approval
- **Two approval loops:**
  - **Ops share-review (host -> Ops):** tenant-tier posts, flagged addresses and splits of a
    not-yet-approved listing enter `puneNestFlatmateReviews` `pending`; Ops decides
    `approved`/`rejected` (reject requires a reason). Canonical maker-checker
    ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2; society-claim-style
    row).
  - **Host request approval (seeker -> host):** a non-open interest/join creates a `pending`
    host-inbox request the host accepts/declines (`decideFlatmateRequest`). Open-policy joins skip
    approval (`accepted` immediately).
- **Owner consent** is an auditable OTP confirmation (not a full approval queue) proving the flat
  owner is aware of a tenant's replacement search.
- **Badge promotion is a third, automatic checker:** an owner-split room's Verified pill tracks the
  **parent listing's** Ops approval (`reconcileSplitVerification`), so it can never appear on a flat
  nobody has checked.

## 7. State machine
```
Seeker post:      (none) --submitPost--> live --markFilled/delete--> removed
                              \--DigiLocker KYC--> verified badge (verified: true)

Room / Group:     draft --create--> pending --(Ops: tenant tier / flagged / unapproved parent)--> approved | rejected
                     seats:     seatsOpen in [0..seatsTotal]  (reopen/close, tier preserved)
                     occupancy: occupants in [0..min(3, flatMax - siblings)]  (owner-split rooms)
                     seatsOpen == 0  => effectively filled (roomActive/groupSeatsOpen false)

Flat split:       live rent listing --splitFlat--> N rooms (pending, identity tier, unbadged)
                     --parent listing approved--> reconcileSplitVerification --> owner tier + verified
                     --unsplitFlat (only while occupants == 0)--> rooms deleted

Occupancy:        empty --first person moves in--> filling --...--> occupied   (derived, never stored stale)

Host-inbox request: (none) --interest/join(request)--> pending --host decide--> accepted | declined
                    open-policy join --------------------------> accepted (auto)

Host eligibility:  evaluateHostEligibility -> blocked (cap/duplicate) | flagForReview | ok
```
- **Terminal:** seeker post removed; room/group `rejected` (or seats 0 = filled); host request
  `accepted`/`declined`; split withdrawn (only while empty).

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
- **Sale listing / already-split flat / not the owner:** `splitFlat` refuses with `notSplittable`,
  `alreadySplit`, `notOwner`. **Occupied flat:** `unsplitFlat` refuses with `occupied`.
- **Cap out of range:** the flat cap must sit in `[roomCount, roomCount * 3]`; the "4" BHK pill means
  "4+", so its room count is unbounded and only the flat cap binds.
- **Unrelated hosts in the same society:** rooms without a `propertyId` **and** a `flatNumber` fall
  back to their own id for the occupancy ledger, so they stand alone instead of pooling.
- **Owner controls on seed posts:** never shown (`ownsGroup`/`ownsRoom` require an exact mobile match
  or name fallback; seeds have no owner).
- **Legacy `?view=` values and pre-redesign alerts:** resolved via `normalizeTab`, never dropped to
  the default tab silently.
- **Smart search that parses nothing:** the raw sentence is kept as a plain text filter; if anything
  parsed, it is cleared so it stops fighting the chips.
- **No detail route:** posts live only on the list; "go to posting" switches to list, narrows to the
  locality, scrolls to and flashes the card.
