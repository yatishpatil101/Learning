# Flow: Flatmates (Move in now / Team up)

> The flatmate marketplace: people who need a home browse **places** or **people**, hosts offer a
> room / an open seat / a whole flat let room-by-room, and interest is shaped by an **L1 sign-in
> floor**, an optional identity badge, and anti-broker guardrails.
> Under **badge-not-gate (ADR-019)** posting and interest need only being signed in (L1); there is
> **no identity posting/contact gate** — verification is an optional trust badge, and it is now the
> **same reviewed identity badge** the rest of the app uses, not a separate seeker OTP.
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
  `post=<solo|group>` (open the seeker request or group form directly; legacy `post=1` still
  resolves to the seeker form), `startGroup=1&title=&rent=&loc=` (seed a
  Team-up group from a property detail page's "split the rent" card).
- **Room listing** reuses the property wizard via `/list-property?flatmate=1` (see the list-property
  wizard doc). **Owner flat-split** is reached from that wizard's success screen and from
  Dashboard -> My Listings ("Let room by room") - see section 5.
- **Source components:** `src/pages/consumer/Flatmates.jsx` (shell) + `flatmates/*`:
  `model.js` (domain model: tabs, room kinds, pricing basis, occupancy), `useFlatmates.jsx`
  (orchestrator), `useFlatmateDiscovery.jsx` (filters/sort/lists), `useFlatmateSupply.jsx`
  (posting/verify/consent/join), `Hero`, `FilterBar`, `Results`,
  `FlatmateMapGate`/`FlatmateMap`, `PostModal`, `GroupModal`, `SplitFlatModal`, `SeekerCard`,
  `RoomCard`, `GroupCard`, `AgreementUpload`, `FlatmateAlertCard` + `alertCriteria.js`,
  `NearPlaceField`, `atoms.jsx`, `helpers.js`, `constants.js`. Shared:
  `components/auth/VerifyIdentityRedirect.jsx`, `components/auth/OwnerConsentModal.jsx`,
  `components/ReportModal.jsx`. Core data: `src/lib/data/flatmates.js` and
  `src/lib/data/flatSplit.js`; rooms in `src/lib/store/listings.js` (`draazyRoomListings`).

## 3. Actors & roles
- **Seeker (demand):** browses, saves, and expresses interest / requests to join. Sign-in required to
  act; the "Verified" pill is the shared reviewed identity badge, not a flatmates-only credential.
- **Host (supply):** posts a flatmate requirement, lists a room, splits a whole flat into rooms, or
  creates a group. Host actions require only an **L1 sign-in** (`requireSignedIn`) — **no identity
  gate**; identity is an optional badge. A host is `owner` (lets their own flat) or `tenant` (a
  sitting tenant seeking a replacement, needs a registered agreement + owner consent).
- **Admin/Ops:** moderates tenant-tier and flagged posts via the Ops flatmate-verification queue
  (`/ops/flatmate-review`); admin moderates seekers, groups and group applications at
  `/admin/flatmates`.
- **Ownership match** (`ownsGroup` / `ownsRoom`): last-10 mobile digits (exact) or name fallback, so
  owner controls never appear on seed posts.

## 4. Entities touched
- [`flatmate_requests` (seeker posts)](../../system/data-model.md) - `draazyFlatmatePosts`,
  created/edited/deleted by `saveFlatmatePost` / `updateFlatmatePost` / `deleteFlatmatePost`. One
  live request per person (`getMyRequest`).
- **Share groups** - `draazyFlatmateGroups`, `saveFlatmateGroup` / `updateFlatmateGroup` /
  `deleteFlatmateGroup`. Seed groups (from `constants.js`) stay out of storage.
- [`rooms`](../../system/data-model.md) - `draazyRoomListings`, written by **two** paths:
  `persistFlatmate` (a host's single spare room; seat-based `seatsTotal`/`seatsOpen`) and `splitFlat`
  (an owner letting a whole flat room by room; occupancy-based `occupants`/`maxOccupants` with
  `priceBasis: 'room'`). Both carry `verificationTier` and start `status: 'pending'`.
- **Host inbox requests** - `draazyFlatmateReq:<hostDigits>` (`addFlatmateRequest` /
  `decideFlatmateRequest`) - the host-facing incoming requests shown in Dashboard -> Requests.
- **Interests / saved / verified** - `draazyFlatmateInterests` (per-seeker `hasInterest`/`addInterest`),
  `draazyFlatmateSaved`, `draazySeekerVerified` (legacy seeker badge, still read so anyone who
  earned it keeps it).
- **Ops review queue** - `draazyFlatmateReviews` (`enqueueFlatmateReview` / `decideFlatmateReview` /
  `getFlatmateReviewStatusMap`). **Owner consent** - `draazyOwnerConsent` (`hasOwnerConsent` /
  `setOwnerConsent`). Also writes `dzPendingRequests` (chat handoff) — it used to write
  `draazyNotifications` too, a key the live inbox (`GET /notifications`) never read, so those rows
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
Posting used to present three sibling CTAs ("Post a request", "List your room", "Create group"),
which asked a poster to work out which tab to stand on before they could post at all. Those became
a single **Post** CTA opening a chooser local to this board — and that chooser has since moved up a
level again, because the bottom bar's `+` was a second door to the same decision, leading somewhere
else. There is now ONE sheet, `components/PostChooser.jsx`, mounted once by `ConsumerLayout` via
`PostChooserProvider`.

There is also one *trigger* per viewport. The bar's `+` is `lg:hidden`, so below 1024px it is the
only posting control on this board; at and above 1024px the bar is gone and the tab-row `Post`
button (`.sf-post-cta`) takes over — it is hidden below `lg` by `styles/routes/flatmates.css`. The
hero used to carry a third copy, landing in the same phone viewport ~150px above the `+`; it was
deleted as pure duplication.

```
What do you want to post?
  a property           -> /list-property                (whole-unit listing wizard)
  a room in my place   -> /list-property?flatmate=1     (supply for "Move in now")
  looking for a place  -> Who's looking?
                            just me       -> /flatmates?post=solo   (seeker request, "Team up")
                            we're a group -> /flatmates?post=group  (group, "Team up")
```

The two seeker branches route by URL rather than calling this board's handlers directly, because the
sheet is app-wide and the presser may not be on `/flatmates` at all. `useFlatmateSupply` consumes
`?post=` on arrival — deleting the param, so a one-shot instruction cannot be bookmarked or re-fire
when the form is closed — and gates it on auth having settled and the caller's own posts having
loaded, so the "one live request per person" rule can still see them. Sign-in is asked for inside
the sheet, on the branch the user chose, not on the `+` itself.

Two things must settle before `?post=` is safe to read, and neither is a formality:

- **`authLoading`** — `user` is null both for a guest and for a signed-in visitor whose session is
  still being revalidated (the cookie survived a storage wipe and `/auth/refresh` is in flight).
  `/flatmates` is not a protected route, so nothing holds the render back through that window.
  Acting on the null would bounce a signed-in user to sign-in, and because the guest branch returns
  before the param is cleared they would come back and succeed — a wall that appears once and never
  reproduces.
- **`myPostsStatus`** — `openPostModal` refuses to create a second live request, but only if
  `myPost` has arrived. A click always came long after the feeds settled; arriving by URL does not.
  Acting early hands someone with a live request a blank create form and a 4xx they cannot act on.
  Leaving the param in place while it loads is what re-fires the effect.

The intent is also latched by value and **disarmed the moment the param goes away**. StrictMode
double-invokes mount effects in dev, and `user` is an object whose identity churns when the boot
revalidation lands — either would otherwise run the branch twice and double-toast, and both replays
happen while the param is still in the URL. Clearing the latch on the empty param is the whole
point: without it, pressing the same branch a second time arrives with the same value, matches the
latch, and opens nothing — the dead second press, one layer further in.

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
- Gated by `requireSignedIn` (L1 sign-in only; no badge). **One live request per person:** if
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
  sale price is not a monthly rent) and `prefillGroupFromTenancy` (a finalised Draazy tenancy seeds
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
  column default (`V13__DDL_flatmates.sql`, folded from the old `V41`), so a row inserted by any
  route - API, migration, manual SQL - is held.
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
  listing is not yet approved** land in `draazyFlatmateReviews` with `status: 'pending'`. The
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
- **The desktop filter grid is collapsed by default** (`showFilters` in `FilterBar.jsx`). Open, it is
  308px tall and sat permanently above the results: on a 1440x820 laptop the first result card
  landed at y=881, so a visitor arrived on a search page and saw no stock without scrolling. It
  **opens automatically when any filter is already set**, so a deep link like `?loc=Baner` never
  lands someone on a narrowed list with no visible reason for it — hiding the *cause* of an empty
  result set is worse than the scroll it saves. Search, tabs, list/map, sort and reset stay on
  screen; only the advanced grid folds, behind a count badge.
- **Where the Filters trigger lives.** Desktop keeps its toggle in the control deck. Below 1024px
  the trigger is a fixed capsule in the thumb arc instead, because the deck is pinned to the *top*
  of the page and filtering is the most-repeated action in the journey. It is the same `.filter-fab`
  the listings board uses - one filter affordance, drawn one way, on both browse surfaces - which is
  why that class lives in `styles/index.css` rather than either route sheet.
  It is anchored bottom-**left**: the Draaz FAB owns the bottom-right corner and intercepts taps on
  anything placed there. Its `bottom` comes from the class, not an inline style, so the two routes
  cannot drift and neither can forget the `--dz-cookie-banner-h` term - without it the DPDPA consent
  bar (z-1400, anchored to the same `--dz-bottom-inset`) lands on top of the capsule and eats its
  taps, leaving a first-time guest with no way to open filters at all.
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
  push a notification, and queue a chat handoff (`dzPendingRequests`).
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

### Identity badge (`isVerified`, `VerifyIdentityRedirect`)
The Flatmates "Verified" pill is now the **same reviewed identity badge** the rest of the app
uses — a government document and a live selfie, checked by a person on our team — not a second,
weaker scheme. `useFlatmateSupply` reads the shared badge out of `useVerification()` and ORs it with
the legacy one:
`isVerified = identityVerified || isSeekerVerified(userKey)`.
The old scheme granted the badge after an OTP to the number the user was *already signed in with* -
which proved nothing new, yet drove the Verified filter, the card pills and verified-only contact.
Flatmates is where strangers agree to share a home, so the badge has to mean at least as much here as
it does on a property listing. `isSeekerVerified` is still read so anyone who earned the old badge
keeps it. Because the badge is now **granted by a reviewer, not on the spot**, the offer is a
*route* — `VerifyIdentityRedirect` sends the seeker to `/verify-identity` and renders nothing of its
own — and the pill appears whenever the decision lands, not when the seeker returns. Verification is
never required to post or to contact - the floor is L1 sign-in (ADR-019).

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

### Server-side board search (`FlatmateSearchQueries`, `FlatmateSearchQuery`)

The backend answers `GET /flatmates/feed` with one `UNION ALL` across the two supply types a tab
shows, narrowed, ordered, counted and paged by PostgreSQL. Reasoning relocated here from the Java so
it lives with the flow it serves.

- **Why the database and not Java.** Gathering ~200 rows per table and filtering in memory breaks in
  three ways: the total becomes a count of the gather (a locality with 240 rooms reports 200 and has
  no 201st row to page to); the sort becomes a sort of the gather (the newest row of a busy tab can
  lose a race to be in the first 200 of its own table); and every facet the ceiling cannot express
  stays in the browser, where it re-filters a page the server already counted — so the number above
  the list and the cards below it are computed by two programs from two rules.
- **Every facet the board offers reaches the server.** `FlatmateSearchQuery` is the line the client
  does not cross: the server owns narrowing, ordering, counting and paging. Facets are deliberately
  asymmetric — `attachedBath` is a room's property and `sharing` a group's, so each narrows its own
  kind and leaves the other alone instead of emptying it.
- **One statement, three answers.** `count(*) over ()` and a conditional `sum(...) over ()` are
  evaluated over the whole match set while the `limit` takes the window. A second count statement is
  a second evaluation of the same predicate, and a concurrent write can make the badge contradict the
  rows beside it. Because both totals ride on window columns of the *returned* rows, an offset past
  the end carries no totals — so a page that came back empty falls through to a separate count over
  the same CTE. Returning zeros there would take `totalPages` to 0, unmount the pager and render the
  empty state for a search with hundreds of results and no control left to reach them.
- **Absent facets contribute no SQL at all**, rather than the `(:x is null or ...)` style the
  single-table feeds use: the planner sees the predicate the caller actually asked for, and the
  "Hibernate cannot infer the type of a null parameter" trap cannot arise. Every value reaches the
  database as a bound parameter; the only concatenated strings are compile-time literals chosen by
  `if`/`switch` in the file, and list facets bind an indexed parameter name (`habit0`, `meLoc1`).
- **`LIKE` metacharacters are escaped on the Java side.** Binding a value stops the statement being
  rewritten but does not neutralise `%` — someone searching for "50%" wants the rows whose note says
  "50%", not every row. The backslash is Postgres's default escape, so it must be escaped first and
  by itself.
- **Free text is matched against stored columns only**, never a seeker's `name` or a group's member
  names. Rendering a name on a card is not the same permission as making it queryable: matching it
  would turn a no-login endpoint into a directory of people looking for a room, searchable by name
  then narrowed by gender, move-in date and a shrinking radius. Same rule as `q` on
  `searchProperties`. Free text against a jsonb array expands the array (`jsonb_array_elements_text`)
  rather than matching `col::text`, so JSON punctuation is not matchable and a pattern cannot span an
  element boundary.
- **Per-person price is derived, not stored.** A room priced `per room` is split between the headroom
  left in the *flat*, which is a property of the flat and not of the row, so no generated column can
  express it (a generated column must be immutable and reference only its own row). The room ledger
  CTE is therefore computed over every unarchived room *before* any facet is applied — if the window
  ran over filtered rows, a budget filter would move the very price it compares against. The ledger
  filters on `archived = false` and nothing else: occupancy is a physical fact, so a room awaiting
  moderation still has people asleep in it. The divisor is floored at 1, matching the browser's
  `perPersonRent`, so a full room prices at its whole rent rather than dividing by zero. A group
  compares against the generated `per_head` (V15), never `rent` — filtering on the whole flat's price
  while the card quotes one member's share.
- **The moderation floor comes from `FlatmateVocabulary.MOD_PUBLIC`**, not a repeated SQL literal, so
  a sixth moderation state cannot become visible on this feed without someone adding it there.
- **What earns a group the verified pill** has two independent routes, and dropping either is a
  visible contradiction: the host's trust tier (owner outright, tenant once Ops approved the
  agreement) **or** every listed member verified — a group is a set of people. Drop the second and
  `GroupCard` paints "All verified" on a row that `sort=verified` does not lift and that vanishes
  when the user ticks the filter the badge invited them to tick. A group with no members listed is
  not vacuously verified, hence the `exists` alongside the `not exists`. The `verifiedOnly` filter
  reuses the same expression the row projects, so filter and badge cannot disagree.
- **What earns a room the verified pill** is the same shape, minus the members: the host's tier —
  owner outright, tenant once Ops approved the agreement. It is **derived on every read**, in the
  JPQL `verifiedOnly` clause, in `FlatmateSearchQueries.roomVerified()` and in
  `FlatmateMapper.hostVerified`, and there is no `flatmate_rooms.verified` column for them to drift
  from (dropped in V26). There was one, written once at post time, and `reopenAfterEdit` could not
  reach it: an edited post kept passing the Verified-only filter with its own card badge already
  gone. A split room needs no special case — its tier is `owner` exactly when the parent listing is
  Ops-approved, so the badge still cannot appear on a flat nobody has checked.
- **Owner tier is re-asked, not granted once.** `deriveTier` runs only on a host-initiated write, so
  a listing archived or sent back to pending afterwards used to leave its rooms badged with nobody
  able to take it back: owner tier never enters the Ops queue, so there was no lever. An hourly
  sweep (`FlatmateModerationService.reconcileOwnerTier`) re-asks the question of every standing
  claim and demotes the ones whose listing has stopped standing — to `tenant` if the host also
  declared an agreement, else `identity`, either way unbadged until Ops says otherwise. It is a
  sweep rather than a hook on each status change because seven places across four modules write a
  property status, and the eighth that forgets would be silent. Ops can also run the same pass on
  demand — `POST /admin/flatmate-reviews/reconcile-owner-tier`, which answers how many posts it
  demoted — for the case the hourly cadence is too slow for: a listing pulled precisely *because*
  its owner turned out not to own it. It is idempotent, so two people working the queue is safe.
- **Sorting.** Every branch ends in `id desc`: without a total order two rows sharing a timestamp or
  a price may come back in either order from page to page, and the boundary row is then shown twice
  or skipped. A null price sorts `nulls last` in both directions, because "we do not know" is neither
  "free" nor "most expensive". `sort=match` is kept term for term with the browser's `matchScore` —
  +3 for a shared locality (jsonb containment, both sides), +2/+1 where the two budgets *overlap as
  bands* at ±12%/±28% (deliberately not a percentage gap, which has a denominator and would rank
  ₹18k↔₹20k differently depending on direction), +1 where the row's preference admits the searcher,
  plus a nudge fading to nothing over two days. With nothing to score against every row ties, so
  `scoresAgainstMe()` falls the sort through to recency instead of shipping a scoring expression.
- **Radius search is a bounding box then an exact great-circle test**, the same two-step
  `PropertySpecs.withinRadius` uses: without the box it is a trigonometric scan, without the circle a
  group 7km away on the diagonal answers a 5km search. The exact test compares cosines (`cos` is
  monotonic over `[0, π]`), avoiding the `acos` domain error a row at distance zero triggers. The
  longitude delta is floored so a search near a pole degenerates into the whole longitude range
  rather than dividing by zero. **A row with no coordinates is placed at its locality's centroid**
  rather than dropped — nothing writes `flatmate_groups.lat/lng` or `flatmate_seeker_posts.lat/lng`,
  so requiring them would exclude whole supply types and answer "nothing near you" for a full tab.
  Two consequences: a locality is coarser than an address, so a 0.5km search around one corner of
  Baner returns every Baner group; and a locality absent from the registry still drops. A seeker
  names a *shortlist*, so any entry landing in the circle answers yes — taking only the first would
  quietly drop a seeker whose second choice is the searcher's street.
- **Move-in windows are IST, not the database session's timezone.** `move_in_at` is derived with
  `LocalDate.now(PlatformTime.IST)`, so a bare `current_date` on a UTC server writes one day and
  filters on another for five and a half hours after IST midnight. **An undated row passes the
  filter**: null means "the host has not said", and `available_from` is null on most rows, so
  requiring it would empty the board on the first touch of the control. The card prints "Flexible",
  so nothing is promised.
- **An unpriced row passes every budget range**, the same way an undated row passes every move-in
  threshold. Hiding a row on a fact the host has never stated is worse than showing a few extra, and
  the card says the value is unstated.
- **Facet clamps, all of them reachable by an anonymous caller with no rate limit.**
  `MAX_RADIUS_KM = 50` (Pune is ~15km across) stops an unclamped radius turning a bounded index range
  into a full scan. `MIN_RADIUS_KM = 0.5` is a privacy floor: a group's coordinates are deliberately
  absent from its feed DTO (the map draws a jittered pin), but an exact great-circle test with an
  arbitrarily small radius hands them back — vary the centre, shrink the radius, and the flat falls
  out. `MAX_MOVE_IN_DAYS = 730` stops `current_date + :moveInDays` overflowing the date type and
  raising a 500. `MAX_LIST_VALUES = 12` bounds repeated parameters, which emit one predicate *and*
  one bind per element on both halves of the union — their length sizes the SQL text, so an unbounded
  one is a planner-cost amplifier.
- **An unrecognised facet value is dropped, never passed through.** Passing it narrows to the empty
  set, so a typo, a stale deep link or a renamed value all render as "there is nothing here" — a
  false claim the user cannot read as their own mistake. Same choice `sort` makes (unknown sorts fall
  back to `verified`) and `resolveTab` makes for the tab, including the deprecated `?view=` aliases:
  falling back to the default tab would silently show somebody the wrong half of the market. The
  single-value `?budget=` alias ("at most this") is folded into `maxBudget` rather than living beside
  it, so links and saved alerts written against it still resolve and two parameters for one bound
  cannot come to disagree.
- **Gender and policy are two vocabularies, translated where they meet.** Rooms and seeker posts
  store `any|male|female`; a group stores a join *policy*, `any|women|men`. Two enums agreeing on one
  value out of three are the dangerous kind — passing `female` straight through matches no group at
  all and reads as an empty tab rather than as a bug. On the query side the literal `any` collapses
  to "no preference": a row stating `any` is matched by the query's own `or col = 'any'` clause, so
  without the collapse "any gender" would paradoxically return only the no-preference rows.

- **The query record carries every facet, with per-kind semantics.** `tab` is `move-in` (rooms +
  housed groups) or `team-up` (seeker posts + groups still hunting). `q` is free text against stored
  columns only — deliberately not the derived English gender label ("Woman"/"Man"), which exists
  nowhere in the database while the `gender` facet expresses the same intent precisely.
  `minBudget`/`maxBudget` bound the *per-person* price, which neither table stores. `gender` is
  `male`/`female` and a row whose own preference is `any` always matches, because a no-preference
  host is a candidate for every seeker. `moveInDays` is "available within N days", `0` meaning today,
  and applies to rooms and posts only — a group has no move-in date at all. `habits` is an AND, not
  an OR: "non-smoker" and "early riser" asks for someone who is both, answered by one jsonb
  containment test per habit (`@>` against a scalar, which is what the GIN `jsonb_path_ops` indexes
  from V15 answer — deliberately not `jsonb_exists`/`?`, which `jsonb_path_ops` does not support and
  which is also JDBC's bind placeholder, so a driver would rewrite it into a parameter and the query
  would fail a layer below where anyone is looking). `attachedBath` is rooms-only and `sharing`
  (a group's total seats) groups-only — making every facet apply to every kind would delete half the
  board the moment a user taps a chip. `meLocalities`/`meBudget`/`meGender` are read only by
  `sort=match`, which ranks by fit to the searcher rather than by anything about the row.
- **The public cards are a second, narrower shape (`FlatmateGroupFeedDto`).** A card cannot show a
  field it never reads, so the anonymous producers (`GET /flatmates/groups` and the group half of
  `GET /flatmates/feed`) project a DTO that structurally cannot carry the host's own view.
  `ownerMobile` and `ownerConsentMobile` are third parties' contact details on an unauthenticated
  wire; omitting the fields makes the anonymous convention a guarantee rather than a convention.
  `addressFingerprint` and `flagForReview` are anti-broker forensics the client only ever writes.
  `modStatus` is filtered to `('live','approved')` by both producers, so publishing it tells a
  stranger nothing while leaving a slot a future unfiltered producer could leak a verdict through.
  `ownerConsent` stays as a boolean — a stranger may know the flat's owner agreed and may not know
  how to ring them. `reviewStatus` is the one verdict that belongs on a public card: it is what Ops
  concluded about the host's *claim to the flat* and it is the entire content of the trust badge.
  Publishing a pending state is deliberate — a badge absent because nobody looked yet and a badge
  absent because Ops said no are different facts to a seeker deciding whom to message.

### Owner consent before the group exists (`FlatmateOwnerConsentService`)

`flatmate_owner_consents` (V13) is keyed `UNIQUE (owner_mobile, granted_by,
coalesce(address_fingerprint, ''))` since V30, with a **nullable** `group_id` — the schema saying a
consent is a fact about two people *and one flat*, rather than about one post: a tenant who reopens
the form must not be made to re-OTP an owner who already agreed about that flat, and a consent may
exist before the group it will be attached to does. V13's original two-column key said nothing about
*what* was agreed to, so one honest OTP silently vouched for every later post the same tenant made.
The `coalesce` stands in for `NULLS NOT DISTINCT`, which arrived in PostgreSQL 15 and this schema's
13 floor does not have: without it the legacy rows V30 could not backfill would be freely duplicable.

That nullable column is why `POST /flatmates/owner-consent` exists alongside the group-scoped twin.
The form asks for consent *while the group is being written*, so the browser had no route to call at
the moment it needed one: it wrote `draazyOwnerConsent` to `localStorage` and put `ownerConsent: true`
on the create payload, which `FlatmateMapper` correctly dropped — a tenant who could assert their own
landlord's consent would make the record worthless. The tenant did the whole OTP dance and got
nothing for it: no chip on the card, and an Ops review entry saying consent was absent. `createGroup`
now reads the row back, so a consent taken minutes earlier lands on the group.

The flow spends the same `OtpService` send budget as login (one cooldown value, keyed per purpose),
so the cooldown is reported to the client rather than guessed: a timer the client picks is wrong in
every environment whose cooldown differs. Verify throws 401 on a wrong code and 429 once the attempt
cap is spent, scoped to `PURPOSE_OWNER_CONSENT` so neither flow can be used against the other.

### Seeker interest: contact, caps and withdrawal (`FlatmateSeekerService`)

- **The contact decision runs opposite to the rest of the platform, and the inversion is what makes
  it safe.** Everywhere else a seeker asks and an owner approves before a number moves
  (`leads.contact`). That model has nothing to work with here — there is no listing to request
  against, and the person contacted is a flatmate-seeker rather than an owner fielding enquiries. So
  the feed publishes no contact at all and "I'm interested" hands the *requester's* own name and
  number to the host. Pressing it on one named post is precisely the affirmative act the contact gate
  exists to require: the gate protects you from your number being given out without your say-so, not
  from giving it out yourself. `GET /me/flatmate-interests` deliberately does **not** carry the
  host's number — adding it would hand every seeker a contact list assembled by pressing buttons.
- **The interest cap is a rate (10 per hour), not a count**, because unlike a post an interest is
  *delivered*: each one puts a stranger's number in front of a different person and a notification in
  their inbox. The only meaningful question about a broadcast channel is how fast it runs, and
  re-sending to somebody already contacted costs nothing. The budget is taken under a lock keyed on
  the requester alone — the same key `FlatmateSupplyService` uses, so a burst cannot just use both
  doors — held to commit, so concurrent presses cannot all read the same pre-insert total.
- **A duplicate press is a 409, not a silent rewrite.** The existence re-read happens *behind* the
  lock (reading before it is a stale read by construction) and *ahead* of the rate-limit count, since
  a repeat press is not a delivery and telling somebody they have contacted too many people would be
  untrue. The unique index `uq_flatmate_requests_target_requester` is the backstop, and only that
  index is translated to the 409: answering a foreign-key or check violation with "you have already
  expressed interest" would tell the requester their message was delivered while the host never sees
  it and nothing reaches the error log.
- **Withdrawal is a hard delete, and the budget is not refunded.** The duplicate guard is a unique
  index on `(kind, target_id, requester_id)`, so a withdrawn row left in the table would keep the
  door shut behind it — withdraw once and that person could never write to that post again, turning
  an undo into a lockout. Only while pending: once the host has accepted they have acted on it (on a
  group, given up a seat for it), so 409 rather than 403 — the row is theirs, it is its state that
  refuses. No refund, because the notification already went out and a refund would make withdrawal
  the cheapest way to buy another send. The `kind` vocabulary spells the seeker door `flatmate`
  rather than `post`: that is the literal in the column, and renaming it needs a data migration.
- **`GET /me/flatmate-posts` is not the feed narrowed by author.** The feed is hard-floored to
  approved rows, so an author still in moderation cannot find their post there, and every row it
  returns is anonymous, so even an approved author could not tell which row was theirs. Both are
  correct for a public board and both make "have I posted?" unanswerable — a question the client asks
  on every render. It is a 0..1 resource wearing the page envelope its `/me/flatmate-*` siblings
  wear, because a singular route would answer "no post" with a 404: an error status for the ordinary
  state of every account that has not posted yet. Archived posts are excluded (unlike
  `listMyFlatmateRooms`): the question is "is one of mine live right now", and a taken-down ad would
  put the banner back over an ad nobody can see.
- **`GET /flatmates/posts/{id}/interests` is `findById`, not `findVisible`.** An ad that has been
  filled or taken down is archived, and the people who answered while it was live are exactly the
  leads the poster still wants. Ownership is re-established server-side on every call and the query
  is narrowed by the caller's own id — an id in the path grants nothing. 403 rather than 404, since
  the post is on the public feed and pretending it does not exist would only confuse.
- **Inbox and outbox are paged and batch-hydrated.** The host does not write these rows — each is a
  stranger who answered the ad — so the collection grows with the ad's reach (§5.1 of
  `api-standards.md`, the inbound-demand shape). `FlatmateRequestHydrator` resolves every requester
  and target in one query per kind; mapping row-by-row over a page would reinstate the N+1.
  `PageImpl` re-wraps around the original `totalElements` so any "N new requests" badge counts the
  whole inbox rather than the slice.
- **An unparseable move-in hint stores null rather than throwing**, while the raw string is kept
  verbatim — refusing a post because a date hint was odd would lose the post to save a sort key. The
  literal `now` resolves to today and never to null: null means "the poster has not said", and the
  feed passes unstated rows through every window, so folding the most definite answer into it would
  make "immediately" and "no idea" the same row.

## 6. Maker-checker / approval
- **Two approval loops:**
  - **Ops share-review (host -> Ops):** tenant-tier posts, flagged addresses and splits of a
    not-yet-approved listing enter `draazyFlatmateReviews` `pending`; Ops decides
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
                              \--document + selfie, staff review--> verified badge (verified: true)

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
  action is retried after sign-in. There is no identity step.
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

## The flatmate seam (`flatmateService.js`, `providers/http/flatmateProvider.js`)

The widest surface in the seam: 23 endpoints over four resources — `/flatmates/rooms` (+seats,
occupants, interest, agreement reissue), `/flatmates/groups` (+seats, join, owner-consent),
`/flatmates/posts` (+interest), `/me/flatmate-requests` · `/flatmates/feed`, and
`/properties/{id}/rooms` · `/properties/{id}/split`.

**Two tabs, three resources, and they do not map one-to-one.** "Move in" is rooms; "Team up" is
seeker posts **and** groups, interleaved. `feed(tab)` does the interleaving; `listRooms` /
`listPosts` / `listGroups` exist for views that want one resource at a time. The feed and the
shortlist are heterogeneous, so rows are discriminated by shape rather than by a type field.

**The three list reads are public, deliberately.** The Flatmates page exists to convert a signed-out
visitor, and a provider that short-circuited on a missing session — the right thing for every
caller-scoped read in this seam — would blank the page for exactly that person. Only `myRequests`
and the `/me` reads are session-gated.

**Joining an open group succeeds immediately.** `joinGroup` returns a **request** whose `status`
depends on the group's policy: an open-policy group accepts outright (`status: 'accepted'`,
`decidedAt` stamped), a restricted one leaves it `pending` for the host. Read `status`; rendering
"waiting for approval" unconditionally would be wrong about half of them. It is the "the call
succeeded ≠ the thing happened" shape the payment domains have, without the money.

**Two different 409s come out of that one door**, and both arrive as `error: "conflict"` on the
wire, so the mapper lifts the real reason onto `ApiError.code`. They are not interchangeable:
`already_interested` is informational (the host has the message), `group_full` is a refusal — the
last seat went while the board was on screen.

**The vocabularies are closed.** Nine fields accept only a fixed set and the server answers 400
listing the allowed values, so unknown values are dropped before the request rather than spent on a
round trip — a filter chip sending `"Female"` for `"female"` would otherwise surface as "search is
broken". `undefined` and `''` are stripped so an absent filter is never sent as the string
`"undefined"`, and invalid filter values are omitted rather than forwarded, so a malformed filter
does not falsely empty the board.

**Seats and occupants are separate facts.** Occupants is a fact about the flat, seats is an
intention about letting: a flat can be full with seats open (someone is leaving) or half empty with
none (the host has stopped looking). Withdrawing a room is likewise not the same act as closing the
last seat — a room with no seats open is taken, a withdrawn room was never really on offer — and a
409 on withdrawal is not a failure to retry: the room is part of a flat split whose sibling rooms
share one occupancy ledger and one joint agreement, so it can only come down through
`unsplitProperty`.

**`photos` on a room is `@NotEmpty` and `localities` on a post is `@NotEmpty`.** A room with no
pictures is the shape a broker spam post takes, so the server refuses it outright and the client
surfaces the validation error rather than smoothing it over.

**`share` is not a formality.** It says whether the asker comes alone (`solo`), brings someone
(`bring`) or wants to be paired (`match`) — a two-person `bring` against a one-seat room is a
different conversation.

**Owner consent has a group-less twin.** `recordOwnerConsent` records onto a group and so needs one;
`requestOwnerConsent` is taken *before* the group exists, which is when the form asks for it. The
consent is keyed on (owner mobile, tenant) rather than on a post, so it can be granted first and
read back at submit time. Both are called twice — without `otp` to send the owner a code, with it to
record consent. `resendAfterSeconds` is passed through and never defaulted: it is present only on
the send call, and the countdown has to be the gap this deployment will actually enforce, since a
number invented client-side would re-enable "Resend" while the server was still refusing.

**The flat-split routes take the listing's `uuid`, not its slug.** Pass `p.uuid || p.id` — never
`p.id` alone. `propertyMapper` sets the seam's `id` to `slug || uuid` because the UI routes on
`/property/:id`, and stashes the real key on `uuid`, so the obvious argument is the wrong one.
`FlatSplitController` binds `@PathVariable UUID id`, which means a slug does not 404 — it 400s in
Spring's converter before the handler runs, and nothing on the page would say why. The same mistake
against `PUT /me/saved/{propId}` produces silent 400s behind an optimistic control. Rooms created by
a split inherit the listing's `propertyId`, which is what makes them owner-verified without a second
verification: the flat was already proven, so the rooms in it are too.

**Shortlist: a save is a key, not a card.** The flatmate half of "Saved" is kept apart from
`savedService` because a flatmate save points at one of three tables and so cannot carry a
`propertyId`. Both sides store the key alone and join the card on read, so the shortlist can be
wrong about what still exists but never about what it says — a copied title, rent and photo would go
on showing what the row looked like at the moment of the tap. `kind` (`room` | `group` | `post`) is
part of the key, because the three id spaces are separate tables and the same id may legitimately
exist in two of them. `listFlatmateSaveKeys` exists for the board, which is already holding the
cards and only needs to know which bookmarks are filled in. Both writes are idempotent.

**Ops: two axes, deliberately not merged.** *Verification* asks "has this host proved what they
claimed?" and its outcome is a badge — a post that fails stays visible, because an unproven claim is
not abuse. *Moderation* asks "may this post be published at all?" and its outcome is visibility — a
post that fails is hidden, which says nothing about whether the paperwork is real. They are separate
routes on the server for that reason and stay separate here. The six staff routes are guarded by
`hasAnyRole('STAFF','ADMIN')` **and** a per-account atom (`flatmates:read` for the queues,
`flatmates:write` for the decisions), because watching the work is not the same permission as doing
it on a queue somebody is being trained on — so a 403 can mean "wrong role" or "read-only account",
and the desk renders the server's own message rather than guessing.

**A rejection needs a note.** The server answers 400 without one and the database enforces it too,
so the rule holds whatever the write path. That is not a validation quirk to route around: a host
told "no" without being told why cannot fix anything. Approving is the only path by which a
tenant-tier post ever earns its badge.

**The moderation backlog takes one `kind` per call**, and that is the server's design rather than a
limitation to paper over: posts, rooms and groups are three tables, and a merged board would have to
either load every pending row to sort it in memory or report a `totalElements` that is true of one
table and false of the screen. It is served oldest-first, because a moderation queue served
newest-first starves the person who has been waiting longest — the one outcome that turns "we
moderate posts" into "we lose posts". The moderation write returns 200 with no body, so the caller
refetches the queue rather than re-rendering a row from an echo; `note` is internal and lands on the
audit row, never on a consumer surface. The id may name a post, a room or a group and the server
tries each in turn, rather than making the caller declare a taxonomy it may not have.

**Queue filters are the server's, not the client's.** A desk that fetched everything and filtered in
the browser would report a total that is true of the window and false of the queue. `flagged`
narrows to contested addresses — an address a different host has already claimed.

**Group applications write the OWNER axis only.** Moderating an application writes `modStatus`
alone: removing a spam application must not thereby decline it on the owner's behalf. The server
cannot reach `status` from that route at all, so the client could not break the rule if it tried, but
sending only what we mean to change keeps the intent legible at the call site. The owner's decision
is irreversible and the server enforces it (409 on a second call) rather than trusting the button to
have been hidden; it returns the decided row so the caller re-renders from the answer. A 409 on
apply should be surfaced verbatim, because the server's sentence ("the owner has it") is more useful
than "already applied" — what the host wants to know is whether their application landed, not
whether it was a duplicate.

**The `/me` reads are not derivable from the public ones.** `listGroups` is public and its card
projection carries no host identity at all, so matching "mine" against a mobile there compares
against a field the server never sends — a test whose answer is fixed at `false` before it is asked.
`listRooms` is public and hard-floored to approved posts, so a host's pending or rejected room is
not in it, and a host who cannot see their own rejected room simply posts it again. The host-facing
shape populates `ownerMobile` where every public read masks it, because it is the caller's own
number.

**`myRequests` asks for the full page explicitly.** It contains both `pending` rows awaiting a
decision and already-accepted joins — filter on `awaitingDecision`, not on presence — and that count
is computed across the whole list, so it would undercount on the server's default of twenty.

**Feed details.** `signal` cancels superseded reads; `verifiedTotal` is server-derived because a
page cannot count it. Budget bounds are dropped when unset so the slider does not apply an
unintended filter, and the upper thumb at its maximum means "no ceiling". Match facets are sent only
when the searcher has a post to match against. Travel minutes convert to kilometres with the shared
Pune city-speed assumption. Move-in distance is computed from local midnights, which is what keeps
calendar-day distance exact.


## Supply-side rationale (moved from backend Javadoc)

**Server-derived trust tier.** Verification tier, `verified`, `flagForReview`, `addressFingerprint`, `modStatus`, `seatsTotal`/`seatsOpen`, `propertyId` (for groups) and `ownerConsent` are decided server-side; a client that could name its own tier could award itself the badge the whole trust model rests on. The MapStruct `applyTo` methods use `ignoreByDefault = true` as an allowlist so that trust fields have to be named to be settable. `deriveTier` reads the caller's actual relationship to a real listing: `owner` requires an Ops-approved property owned by the caller; `tenant` is a claim that files a review-queue entry; `identity` is the sign-in floor. `propertyId` on a group is honoured only when `deriveTier` confirms owner tier.

**Owner mobile handling.** `ownerMobile` is null on anonymous feeds and only populated for the host's own view. Enquirers reach a host by expressing interest through `POST /flatmates/rooms/{id}/interest`, volunteering their own number — contact never travels outward from a public read. The flat owner's consent number is masked (`98XXXXX210`) even for the host who typed it, because it belongs to a third party who consented to being asked, not to being published. `maskMobile` is `@Named` and only reachable via `qualifiedByName` to keep MapStruct from adopting it as an implicit String ? String converter that would mask `title`, `locality` and `note` into nonsense. `mobileNormaliseOrNull` canonicalises to the ten-digit shape so `+91`-prefixed values pass `@IndianMobile` at the edge without 500-ing on the column CHECK.

**Card projection (`FlatmateRoomFeedDto`, `FlatmateGroupFeedDto`).** A card cannot show a field it never reads. `ownerMobile`, `agreementDeclared`, `addressFingerprint`, `flagForReview`, `societyId`, `availableFrom`, `photos`, `status` and `modStatus` are absent because no downstream consumer reads them off a feed row (checked against `frontend/src`, not the seam mapper). Removing the fields turns a convention into a structural guarantee. Every producer of the feed shape is moderation-filtered; `roomsInFlat` filters through `FlatmateRoom#isVisible()` on the returned stream rather than the finder, because the finder also feeds the occupancy ledger, the `already_split` check and `unsplit`, which must keep seeing non-archived rows. `reviewStatus` is present as Ops' verdict on the host's claim to the flat — the tier badge content — even though `modStatus` (our verdict on the post) has already filtered every producer. MapStruct cannot inherit `@Mapping` across differing target types, so `seatsOpen`, `perHead` and `ownerName` are wired on both `toDto` and `toFeedDto`; `FlatmateGroupShapeTest` catches drift.

**Two ledgers on one table (`FlatmateRoom`).** Standalone spare rooms use the seat model (`seatsTotal`/`seatsOpen`) — one seat by construction because the poster describes one vacancy. Split rooms use the occupancy model (`occupants`/`maxOccupants`) — the ceiling belongs to the whole flat and is enforced across sibling rooms sharing `propertyId`. They never mix: DB CHECK constraints and the service (`not_seat_based`) refuse a split room with a seat count. `verificationTier` on a split room tracks the parent listing's Ops approval, so a badge never appears on an unchecked flat. `priceBasis` distinguishes per-person from whole-room quotes — mixing them silently makes a shared bed look pricier than a private room. `flatCommitted`, `flatMax`, `shareMax` and `perHead` are derived, never stored, because they are properties of the flat; storing them would let sibling rooms hold disagreeing copies of one shared truth. `flatCommitted` on anonymous views must be real, not zero: it drives `occupancyOf` and `shareMax`, so a fake zero would publish a wrong occupancy label. `shareMax` is 1 for per-person prices — sharing is not something a per-head quote can express.

**Interest ledger and dedupe.** V13's `uq_flatmate_requests_target_requester` — `(kind, target_id, requester_id)` — enforces one request per person per target. `record` locks the per-requester budget (shared with `FlatmateSeekerService.express` — one ten-per-hour budget across both doors), re-reads AFTER the lock (under READ COMMITTED the loser of a double press sees the winner's row), then relies on the unique index as the backstop for repeatable-read sessions; only that index is translated to `already_interested`, other integrity violations propagate as 500 rather than being dressed up as the system working. `users.name` is nullable (OTP sign-in with no profile), so notifications fall back to "Someone" rather than the literal string "null"; the member card renders its own fallback for the absent case. `ownerConsent` for a group is (owner mobile, tenant)-keyed so reopening the form doesn't re-OTP an owner who already agreed; `noRollbackFor` on `ownerConsent` prevents an outer advice from refunding a send budget on a route whose recipient is a stranger's number.

**`OutboundMessage` and `MessageTemplate`.** `OutboundMessage` is a ledger, not a queue: it exists so a second staff member can see the first already chased the owner, and so pipeline counts come from rows rather than counters. `recipientMobile` and rendered `body` are captured at send time so an owner's later mobile change or a template edit does not retroactively rewrite the log. Not a `BaseEntity`: the base's `created_at` would duplicate the row's `prepared_at`. `MessageTemplate.render` leaves unknown placeholders as literal text rather than blanking them, so a typo lands loudly in front of the staff member reviewing the preview; templates use `\w+`-only placeholders because anything richer is a template engine editable from an admin screen. Template ids are slugs, not surrogate uuids, because they are named in code and audit rows.
