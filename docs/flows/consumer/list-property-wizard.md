# Flow: List / Post a Property (Owner Wizard)

> The owner-facing multi-step wizard that turns a property into a pending listing, and the flatmate
> "list your room" variant, then hands the submission to the admin verification maker-checker queue.
> Posting is **L1-only** under the **badge-not-gate** model (ADR-019): any signed-in user posts
> immediately — **no Aadhaar/identity gate**; the Verified badge is an optional, post-success nudge.
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** owner (maker), admin/manager (checker)

---

## 1. Purpose & user problem
- **Persona:** a property owner (or a sitting tenant listing a room) who wants their unit live on
  Draazy.
- **Job-to-be-done:** "Describe my property, price it, add photos/documents, and publish it."
- **Why it matters:** this is the **supply side** of the marketplace. Listing quality and the
  admin listing-verification maker-checker are what make the "zero brokerage" promise real. Every
  listing enters as `pending` and only goes live after admin verification. Posting itself is never
  identity-gated — an owner signs in (L1) and posts; verification is an **optional Verified badge**.

## 2. Entry points
- **Routes:** `/list-property` (`ProtectedRoute`). Query params:
  - `edit=<listingId>` - edit an existing listing (never consumes quota; see section 5).
  - `flatmate=1` - arrived from the app-wide `PostChooser` ("a room in my place") or from a room
    card's Edit action. Pre-selects the flatmate track via `rentMode = 'flatmate'`; `hostRole` still
    defaults to `owner` and the host picks owner/tenant on Step 1.
- **Tiles / triggers:** "Post Property" nav/CTA, dashboard "Add listing", the bottom bar's raised
  `+` on mobile, and the Flatmates tab-row `Post` CTA on desktop (the two never both render - the
  bar is `lg:hidden` and `.sf-post-cta` is its exact complement). The last two open the same thing:
  the app-wide
  `PostChooser`, mounted once by `ConsumerLayout`, which asks "what do you want to post?" and routes
  **two** of its branches into this wizard - *a property* to `/list-property` and *a room in my
  place* to `?flatmate=1`, the second being a track through this form rather than a second form that
  would relearn the same fields. Its remaining branch forks into "who's looking?" and stays on
  Flatmates as a seeker request or a group.
- **Source components:** `src/pages/consumer/ListProperty.jsx` (shell) + `list-property/*`:
  `useListProperty.js` (orchestrator), `PostSuccessVerifyNudge.jsx` (optional post-success badge
  nudge), `PostSuccessSplitNudge.jsx` (post-success "let it room by room" offer), `ProgressMeter.jsx`,
  `StepNav.jsx`, `ListingPaywall.jsx`, `EditPolicyBanner.jsx`,
  `PropertyDetailsStep.jsx` (shell -> `PropertyDetailsWhole.jsx` / `PropertyDetailsFlatmate.jsx`,
  with `step1/*` field groups), `LocationPricingStep.jsx`, `PhotosDocumentsStep.jsx`,
  `FlatmateFlow.jsx` (flatmate steps 2 & 3),
  plus `validation.js`, `submit.js`, `editPolicy.js`, `constants.js`, `initialForm.js`.

## 3. Actors & roles
- **Maker = owner** (signed in at **L1** — `ProtectedRoute`; no Aadhaar needed) fills and submits the
  wizard.
- **Checker = admin / manager** reviews the resulting `pending` listing in
  `src/pages/admin/AdminProperties.jsx` (`RoleRoute roles={['admin','manager']}`).
- **Floor (not a gate):** posting requires only being signed in (L1, `ProtectedRoute`) — there is
  **no** Aadhaar/identity gate on the form under ADR-019. The Verified badge is offered *after* the
  listing goes live (`PostSuccessVerifyNudge`), never as a wall. See
  [`../../system/trust-and-verification-model.md`](../../system/trust-and-verification-model.md).

## 4. Entities touched
- [`listings` / `properties`](../../system/data-model.md) - **created** as `status: 'pending'` in
  both the mock DB (`db.listings`, via `mutateDb`) and the per-user store
  (`draazyListings:<mobile>`, via `addListing`). Edited in place via `updateListing` + `mutateDb`.
- [`rooms` / `flatmate_requests`](../../system/data-model.md) - the flatmate track **creates** a
  room in `draazyRoomListings` via `addRoom` (`status: 'pending'`).
- [`aadhaar_verifications`](../../system/data-model.md) - **read** only for the **optional** Verified
  badge (post-success nudge); **not** a prerequisite to post.
- [`property_reviews`](../../system/data-model.md) - `ensureOwnerReview` opens a review thread on a
  material edit or a duplicate flag; `addPropReviewAdminNote` writes the system message.
- [`documents`](../../system/data-model.md) - sale listings persist uploaded docs via
  `addDocument(mobile, listingId, ...)`. `localities` - an unmatched real locality **mints** a
  community-tier locality via `addCommunityLocality`. `notifications` - a "under review" notification
  is pushed on create.

## 5. Business rules & logic  *(the meat)*

### Optional badge + paywall (before any step)
- **No posting gate (ADR-019):** the form is **not** hidden behind any identity check — a signed-in
  (L1) owner posts immediately. The Verified badge is offered *after* the listing goes live via
  `PostSuccessVerifyNudge` (at the value moment, never before it), and is fully dismissible.
- **Freemium quota (`src/lib/store/billing.js`):** `PLAN_LISTING_LIMITS = { free: 1, 'owner-free':
  1, owner2: 2, owner5: 5 }`. `activeListingCount()` counts non-flatmate, non-deleted/archived
  listings. `canPostListing()` = `activeListingCount() < listingLimit()`. A **new** post over the
  limit renders `ListingPaywall`; **editing** an existing listing is never paywalled (`canPost` is
  fixed `true` in edit mode).
- **This paywall is a courtesy, not a gate, and knowingly so.** D31b moved the *contact* quota
  server-side but deliberately left the listing count alone. `GET /me/entitlements` **reports**
  `listings.allowance` and `listings.referralBonus`, and `Refer.jsx` renders the "slots left" figure
  from it, but `POST /me/listings` does not check either number — a caller that skips this screen
  posts as many listings as it likes. Enforcing it is separate work; see
  [`../../system/open-questions.md`](../../system/open-questions.md) Q17.

### The 3-step wizard (whole-place track)
`StepNav` shows the same 3 phases for both tracks. `nextStep` validates the current step and blocks
advance on any error (scrolling to the first error via `scrollToError`).

**Property "For" + rent sub-mode (top of Step 1):**
- `deal`: `buy` (Sale) or `rent`.
- When `deal === 'rent'` AND residential AND not PG: choose `rentMode` = `whole` or `flatmate`.
  `isFlatmateMode = deal === 'rent' && rentMode === 'flatmate'`. Switching to a non-residential/PG
  type forces `rentMode = 'whole'`.

**Step 1 - Property details (`validateStep1`):**
- `propertyType` required (`flat | independent | villa | pg | commercial | openplot | farmland`).
- Commercial: `commercialType` required (`office | shop | retail | warehouse | industrial |
  coworking`).
- PG/Hostel: at least one `sharing` (occupancy) type required (PG is defined by occupancy, not BHK).
- Residential non-PG: `bhk` and `bathrooms` required.
- **`carpetArea` always required**, must be `inRange(1, 1000000)` - the one hard number every
  listing needs.
- Type-specific fields are reset when the type changes (`changePropertyType` clears
  `TYPE_SPECIFIC_KEYS`) so one type's answers never leak into another.

**Step 2 - Location & pricing (`validateStep2`):**
- `locality` required; must be **placed on the map** (`locationSet` via locality pick, search or pin
  drag) or `err.location` is raised - a listing is never geo-pinned to the default.
- `flatNumber` required unless land or PG; `society` required unless land (PG building name still
  required); `pincode` must match `^[1-9]\d{5}$` (six digits, not starting 0).
- **Rent:** `monthlyRent` positive, `deposit` present, `availableFrom` present. Deposit helper
  `setDepositMonths(n)` = `monthlyRent * n`.
- **Sale:** `price` positive, `possession` present, `ownership` present; if `possession ===
  'available'` then `availableFrom` required.

**Step 3 - Photos & documents (`validateStep3`):**
- At least one `photos` entry required.
- Exactly one mandatory ownership document required, keyed by `requiredDocKeyFor(deal,
  propertyType)`: land -> `7/12 Extract`; built sale -> `Index II`; built rent -> `Ownership Proof`.
  The full per-type doc set comes from `docsFor(deal, propertyType, commercialType)` (sale/rent/PG/
  land/commercial variants; commercial appends profile-specific compliance docs like Shop Act / MPCB
  Consent / Factory License).

### Draft vs submit
- **Autosave draft:** the whole form autosaves to `dzDraft:list-property` (`useFormDraft`); a
  restore banner + "start fresh" let the owner resume or wipe. There is **no explicit "save draft"
  status** - a listing only exists once submitted; the draft is client-only.
- **Submit (`submitProperty` -> `finalizeListing` -> `persistListing`):**
  1. `validateStep3` must pass (no identity/Aadhaar precondition — posting is L1-only).
  2. New post over quota is blocked; edit with an identity change opens the identity guard modal.
  3. `hashPhotos(photos)` computes perceptual hashes (browser) for duplicate detection.
  4. `persistListing` builds the record with `status: 'pending'`, `statusClass: 'pill-pending'`, then
     **writes it through the seam** (D219): `addListing` on create, `updateListingFields` on edit.
     That request is the only place the server can run its duplicate probe, so this is what puts the
     detector in front of the path that produces almost every listing. `forTheWire` adapts the
     record on the way out — the five address boxes fold into one unit-bearing `address` line,
     `floor` is omitted rather than sent as 0, the deal-split maintenance pair folds into one
     `maintenance`, `rera` is renamed `reraId`, and `electricityConsumerNo` is lifted out of
     `strongIds` for the request only. On create the server's id is adopted if it differs.
  5. It then mirrors into localStorage (`mutateDb`, `addListing`) for edit prefill, the browser-side
     dedup and the documents shelf, pushes an "under review" notification, and (sale only) stores
     docs via `addDocument`. The mirror write sits inside its own try/catch — losing it is
     survivable, losing the save is not — so a quota failure cannot take the listing down with it.
  6. Confetti + success screen. A brand-new **rent** listing stays on the success screen, because
     the split-flat offer (`PostSuccessSplitNudge`) lives there; everything else auto-navigates to
     `/dashboard` after 3.2s.

### Derivations in `persistListing`
- **Title:** `[BHK|sharing prefix] + typeLabel + " in " + locality` (PG multi-occupancy advertises a
  "from ... onwards" price = cheapest bed).
- **Locality binding:** `matchLocalityToCanonical(locality, lat, lng)` -> canonical slug; an
  unmatched locality yields **no slug** (D225 deleted the community tier that used to mint one, and
  never the old first-word truncation). The listing lands in the server's locality queue and cannot
  be approved until a human files it — see `docs/flows/admin/localities.md`.
- **Private identifiers stripped** from the buyer-readable `form` snapshot (`electricityConsumerNo`,
  `pmcPropertyId`) - they live only in Ops-only `strongIds`.
- **Flat spec fields** (bhkNum, bath, area, price, furnishing, amenities, ...) are denormalized onto
  the record so cards/detail read them without reaching into `record.form`.

### Duplicate prevention - two questions, two places
The wizard asks two different things, and they are deliberately not the same call.

**"Have I already listed this?" is the server's** (D226). `persistListing` calls
`propertyService.checkOwnDuplicate` -> `POST /me/listings/duplicate-check`, which derives the
comparison key by the same `LocalityResolver` + `AddressKey` calls the create makes and matches it
against the **caller's own** listings only. It used to be `evaluateListingDedup`'s self-arm, scanning
this browser's localStorage - which against a live API is the seeded demo catalogue, so the guard
could refuse a genuine owner over a fixture and then offer to open an id the server had never
issued. Only asked on a create; an edit is by definition already the listing it would match.
- **Hard block:** `{ found: true, existingId }` -> `persistListing` returns
  `{ ok:false, blocked:true, existingId }` and the wizard shows the duplicate guard. The CTA opens
  the editor only when `getListing(existingId)` resolves locally, because the edit route prefills
  from `draazyListings:<mobile>` and a server id this browser has never held renders an empty form
  under the words "here is the one you already have". Otherwise it goes to `/dashboard`.

**"Is somebody else claiming this?" stays local and stays on the write.**
`evaluateListingDedup` still runs for its other outputs (`fingerprint`, `fingerprintKeys`, and the
cross-owner flag), and the authoritative version is the server's `ListingDuplicateProbe` inside
`POST /me/listings` (reached since D219) plus `ListingDuplicateSweep` every ten minutes, because two
simultaneous submissions are invisible to each other inside one transaction.
- **Soft flag:** a **different** owner claiming the same address, or reusing the same photo hashes ->
  the listing still posts but carries `duplicateFlag` + a `flagReason` and opens an Ops review thread
  (`ensureOwnerReview` + `addPropReviewAdminNote`). Never reported back to the lister: a finding
  about somebody else's property is what turns a duplicate check into a lookup.

### Edit policy (`editPolicy.js`) - the anti bait-and-switch rules
Editing a **live** listing classifies every changed field into two tiers (`classifyChanges`):
- **Tier A (material / trust):** `deal, propertyType, commercialType, bhk, carpetArea, builtUp,
  plotArea, floor, totalFloors, facing, age, possession, ownership, locality, society, flatNumber,
  tower, street, pincode` + removing/replacing an already-uploaded photo. A Tier-A edit on a live
  listing **keeps it live** but schedules an admin re-check (`record.reReview`) and notifies the
  owner. Adding new photos never counts.
- **Tier B (soft / marketing):** price, description, amenities, availability, furnishing, etc. -
  goes live **instantly**, no re-verification.
- **Identity subset** (`IDENTITY_FIELDS = ['propertyType', 'commercialType', 'locality']`): changing
  identity is treated as effectively a different property -> triggers the identity guard and interacts
  with the freemium quota. (Society is deliberately excluded - a name correction stays Tier A.)
- **Thresholds:** `PRICE_REDUCED_PCT = 0.15` (buyer "Price reduced" badge on a >=15% drop),
  `PRICE_JUMP_FLAG_PCT = 0.20` (admin flag on a >=20% increase), `MATERIAL_EDIT_CAP = 3` material
  edits per `MATERIAL_EDIT_WINDOW_DAYS = 30` before `materialEditFlag` is raised. An `editLog`
  (capped 20) records each edit's tier counts + price swing.

### Flatmate / room track (`submitFlatmate` -> `persistFlatmate`)
- **Lean validation, two tiers.** Step advance uses `validateFlatmateStep1` (`bhk`, `roomType`) and
  `validateFlatmateStep2` (`locality`, `society`, `rentShare` > 0, `availableFrom`) - note the
  flatmate Step 2 does **not** require a map placement, unlike the whole-place track. `submitFlatmate`
  re-checks all six **plus** at least one photo before persisting.
- **Host verification tier:** `hostRole` = `owner` or `tenant`. Owner -> tier `owner`. Tenant who
  both declares AND uploads a registered rent agreement (`hasAgreementEvidence`) -> tier `tenant`;
  declared-without-upload stays tier `identity` (still lists, no host badge, no review queue).
- **Anti-broker guardrails (`evaluateHostEligibility`):** hard block on cap hit or same host
  re-claiming an address; soft flag when a different host already claimed the address (still posts,
  routed to Ops). See flatmates doc for the full guardrail model.
- **Seats:** `seatsTotal` = 2 for a "Shared room", else 1; `seatsOpen` starts equal.
- Creates a `room` with `status: 'pending'`; tenant-tier or flagged posts also call
  `enqueueFlatmateReview(...)`. Pushes an "under review" notification.

### Split a rent listing into rooms (`PostSuccessSplitNudge` -> `splitFlat`)
A **second** room-creation path that does not go through the flatmate track at all, but is offered
from this wizard's success screen (and later from Dashboard -> My Listings).

A brand-new **rent** listing's success screen carries a dismissible offer to let the flat room by
room; sale listings and edits are never splittable (`postedListing` is only set when
`!editId && deal === 'rent'`). Accepting opens `SplitFlatModal`, which asks only what the owner is
entitled to decide: **which rooms exist** (`roomKind` = `master | bedroom | living`), **the rent for
each**, and **how many people may live in the flat** (`maxOccupants`, the society's rule). Per-room
occupancy is never declared - tenants decide that.

Rules (`src/lib/data/flatSplit.js`):
- `canSplitIntoRooms` = the listing is `deal === 'rent'` and has an id, so the whole-flat listing
  keeps existing and the share market never cannibalises core rental inventory.
- `maxRoomsForBhk(bhk)` = bedrooms + hall; the "4" pill means "4+", so its room count is unbounded.
- `ROOM_SHARE_MAX = 3` per room; `capBoundsFor(n)` = `[n, n * 3]`.
- Only the listing's own owner may split it (last-10-digit mobile compare), and only **once**
  (`isFlatSplit` guard).
- Each created room inherits the parent's address/BHK/photo and carries `propertyId`,
  `priceBasis: 'room'`, `occupancy: 'empty'`, `occupants: 0`, `maxOccupants`, `roomKind`, and an
  implied `attachedBath: 'attached'` for a master.
- **The Verified badge is earned, not asserted:** rooms start at `identity` tier and unbadged while
  the parent listing is `pending`; `reconcileSplitVerification()` promotes them to `owner` tier once
  Ops approves the flat. An unapproved parent (or a flagged address) enqueues **one** Ops review per
  flat via `enqueueFlatmateReview`.
- The same anti-broker guardrails (`evaluateHostEligibility`) apply as on every other supply path.
- Reversible only while empty: `canUnsplit` / `unsplitFlat` refuse once anyone has moved in.

Full model: [`flatmates.md`](./flatmates.md) section 5.

## 6. Maker-checker / approval
- **Yes - the canonical listing-verification maker-checker.** Maker = owner (submits `pending`);
  checker = admin/manager. On approval the admin pairs `decideReview(id,'approved')` +
  `setListingStatus(id,'approved')` and the listing goes live; rejection pairs the rejected review
  with `setListingStatus(id,'rejected')`. This is the worked example in
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.3. This flow doc covers
  the **maker (submission)** side; the checker/queue side lives in the admin docs. A **material edit**
  on a live listing is a lighter re-check that keeps the listing live (Tier A above).

## 7. State machine
```
draft (client-only autosave)  --submitProperty-->  pending  --admin approve-->  approved (live)
                                                       |            \--admin reject--> rejected
                                                       |                                  |
                                              (owner archives) --> archived           (owner edits, resubmit)
live listing + Tier B edit  -> stays approved (instant)
live listing + Tier A edit  -> stays approved + reReview scheduled (fast re-check)
live listing + identity edit-> identity guard + quota interaction
```
- **Terminal-ish:** `approved` (live), `rejected` (owner can fix & resubmit -> pending), `archived`
  (soft-delete; restore resets to `pending`, cross-cutting section 4). Rooms follow the same
  `pending -> ...` shape plus a separate Ops share-review for tenant/flagged posts.

## 8. Edge cases, validation & error states
- **Over quota (new only):** `ListingPaywall` replaces the form until the owner upgrades.
- **Duplicate (same owner):** hard block + duplicate guard modal pointing to the existing listing.
- **Duplicate (different owner / same photos):** posts but is `duplicateFlag`ged and opens an Ops
  thread.
- **The save itself fails:** the seam write is awaited outside the localStorage try/catch, so a
  rejected `POST /me/listings` surfaces as a toast and the wizard stays put rather than showing a
  success screen for a listing that does not exist.
- **Identity change on edit:** `showIdentityGuard` modal before finalizing (quota implication).
- **Per-step validation:** each `nextStep` blocks advance and scroll-focuses the first error; Step 2
  additionally requires a map placement (`locationSet`).
- **localStorage quota:** `persistListing` swallows quota errors so the success flow still completes;
  oversized documents are stored as `tooLarge` (metadata only, `dataUrl: null`).
- **Rent skips doc storage:** only sale listings persist uploaded documents (mirrors the HTML
  prototype); rent uses the single Ownership Proof for the badge but doesn't vault it.
- **PG rent sync:** unchecking a sharing type prunes its stale per-occupancy rent and recomputes the
  "from" `monthlyRent` as the cheapest remaining bed.

## 9. Backend listing writes

Relocated from code comments in `catalog/listing/` so the reasoning survives without a
multi-paragraph docblock per method.

### 9.1 Owner scope and the server-set fields

Every read and mutation in `ListingService` is keyed by the server-resolved principal id, so a
caller can only ever see or change their own rows; cross-owner access returns `404`, because we
never confirm another owner's listing exists.

On create the trust-critical fields are server-set, not taken from the body: `status = pending`,
`owner` = the authenticated caller (loaded, not a client id), `posted_by_type = owner`, and
`price_unit` derived from the deal. A listing therefore cannot be born approved or attributed to
someone else. What the client *may* say is decided by `PropertyMapper`'s allowlist, so the
"deliberately absent" set in `ListingCreate`'s docs is enforced rather than described.

**Ordering inside `createOnBehalf` is load-bearing.** The locality resolver runs after the mapper,
because its geo fallback needs the lat/lng the mapper has just set (a null slug is an accepted
outcome and simply leaves the listing out of locality facets until curated). Photo hashes are
reindexed after the flush, because the hash rows are keyed by the listing's id and it has one only
then, and before `flag`, because the photo arm reads back what that wrote.

`owner_verified` is **inherited, not claimed**. It is denormalised onto the listing because buyers
and the ranking read it there, so it has to be stamped at both ends: the verification webhook
back-fills existing listings, and create stamps new ones. Without this half, an owner who verified
last month and posts today gets a listing telling buyers they are unverified - and the webhook
cannot fix it, because a replayed DigiLocker success is deliberately a no-op on an already-verified
row. It is read from the owner rather than accepted from the client because it is a trust signal,
so the only safe source is the one the client cannot reach.

The lifetime listing tally is incremented at create rather than at approval, because the question it
answers is "has this person ever posted", and they have - a listing the desk later rejects was still
posted by an owner. Two things this depends on, both silent if broken: it must stay on a *managed*
`owner` (a `@Modifying(clearAutomatically = true)` inserted above that line would detach the entity
and drop the increment with no error at all, and that idiom appears eight times elsewhere in this
codebase), and it dirties the user row, so `users.updated_at` moves when someone posts a listing -
anything reading that column as "profile last edited" is reading it wrong.

### 9.2 The freemium ceiling (`ListingQuota`)

The quota is split out of `ListingService` under package-structure.md 4.1 along a use-case seam: the
freemium ceiling is a commercial rule with its own inputs (a plan, referral credits) and two callers
who want opposite things from it - `create` wants a verdict, the concierge desk wants the numbers so
a human can decide. Both answers come from the same two reads deliberately: a second count derived
some other way would eventually disagree with the one that does the refusing, and the operator would
be reading a number the server does not act on.

**Until this existed the rule only lived in the browser, which meant it did not exist.** The wizard
compared a count of the listings that browser's `localStorage` held against a ceiling the same
browser computed, so an owner who posted from a laptop and opened the wizard on a phone was measured
as having posted nothing. The client now reads both numbers from the server, but a number the client
reads is a number the client can skip, and the create endpoint is reachable without the wizard at
all. Callers must check before anything is loaded or written, so a refused post leaves no half-built
row and no duplicate-probe entry behind.

`createOnBehalf` is the same creation **without** the ceiling, for the back-office concierge desk
only. The ceiling is a rule about what an owner may help themselves to; the desk is not
self-service - it is staff-only behind its own `postOnBehalf:write` atom, doubly audited, with a
person on a phone call deciding. Leaving the check in place made the desk inherit a stranger's plan,
so an operator taking down three flats from one caller could record one and was refused the rest
with copy written for the owner sitting in the wizard ("take one down, upgrade your plan, or refer
an owner"), addressed to a member of staff about an account that is not theirs. It also made one of
the desk's own safeguards unreachable: the owner step warns "this owner already has N pending
listings", which is how a second operator notices the flat has already been taken down once, and a
free-tier owner can never hold two pending listings.

This is not a hole in the paywall. Nothing there is reachable by the owner, and what it produces is
a `pending` listing in a hand-back funnel the owner has not yet accepted. What the desk loses is
only the refusal - the overage itself is still a fact, published by
`GET /admin/properties/owner-standing` so the operator can see the upgrade conversation they are now
holding. It is a second method rather than a `skipQuota` boolean because a flag is a thing a future
caller can pass by accident; a method whose name says who may call it is not.

### 9.3 What an edit costs, and what acts on the answer

`ListingEditRules` owns the rule that decides what an edit costs; `ListingService` owns what to *do*
about the answer, and the owner and moderator paths do opposite things with the same `EditImpact`.
The split arrived when the file reached the 450-line ceiling `ServiceSizeGuardTest` enforces, but it
is along a real seam: a rule that decides and a caller that acts. `check-listing-foundation.mjs`
pins the two sets against the client's copy of the same rule.

A foundation-field change earns a re-review either way: an identity change reverts to `pending` and
leaves search, an attribute change raises a re-check and stays live. Non-foundation edits (photos,
description, deposit) leave both untouched. When one PATCH does both, the revert wins and no
re-check is raised, because a full re-moderation looks at the whole listing and queueing the
attribute change separately would put the same edit in front of a moderator twice.

Either outcome posts a line into the owner's verification thread saying what happened and why. That
sentence used to be composed in the browser and written to `localStorage`, which meant the owner's
own explanation for why their listing had gone dark lived on one machine, and the ops desk - the
people who would have to answer for it - never saw it at all.

**The stays-live note is conditional; the re-check is not.** `requestRecheck` refuses on a listing
that is not publicly visible, because "stays live" means nothing for a listing already off search
and already in front of a moderator; posting the note regardless told the owner of a pending listing
that it was live and opened a case file with no work item behind it. Reading the outcome rather than
re-testing `isPubliclyVisible()` keeps one copy of that rule, in the entity. The note is posted only
when the desk's work item actually moved: `requestRecheck` merges this edit's fields into the set
already under re-check, so an unchanged set means the desk has nothing new to look at and the owner
has already been told. Without that comparison, one owner looping `PATCH {price: 41000}` /
`{price: 41001}` wrote a `review_messages` row per request and bumped `lastMessageAt`, which is the
desk queue's sort key - roughly 7k messages an hour, permanently pinned at rank 1 of
`findAllForDesk`, bounded only by the global 120/min write limiter. Comparing the merged set rather
than suppressing repeats outright keeps the note for the case that deserves one: an owner who edited
price yesterday and area today is told about the area.

**Re-probing for duplicates is conditional on a signal actually moving.** Probing on every PATCH
would re-post the same warning every time an owner touched their description; probing never would
leave the obvious evasion open, since an owner can be approved at one address and then edit their
way onto somebody else's. It runs last, after the status has settled, because the note quotes it: an
approved listing whose PATCH both moves a signal and changes an identity field is pending by the
time the transaction commits, and a note written before the revert would tell a moderator the
listing is "already live" about a listing that is not. The dedupe makes the ordering matter twice
over, since `postInternalOnce` compares message bodies and the same collision described once as
approved and once as pending is two notes for one finding. Photographs are the other half of "moved
a signal" and are not in `signalOf` (which holds typed column values, while photo hashes are rows in
another table): swapping every photograph for somebody else's is precisely the edit that creates a
duplicate while every address value stays put.

**A moderator edit does not revert the listing to pending**, and that is the one behavioural
difference from the owner path. Re-moderation exists so a change made by the owner is seen by a
moderator before it goes live; here the moderator *is* the change. Reverting would push their own
correction into their own queue, so fixing a typo in an approved listing would take it off the site
until somebody re-approved it - and the natural response to that is to stop correcting listings. For
the same reason the duplicate key is recomputed (so the listing stays findable by a *later* probe)
but no probe is run: here a human is already looking, and is the one making the change. The
moderator path is audited, unlike the owner path, because it is a write to a row belonging to
someone else who will never be told it happened, so "who changed my price" needs an answer that is
not "nobody knows". It lives in `catalog` rather than `moderation` because the body is
`ListingUpdate` - every field of `ListingCreate`, made optional - and a second copy of that mapping
would be a second place for a field to be forgotten.

### 9.4 "Have I already listed this?"

`duplicateCheck` derives its comparison key here, from the address as typed, by the same two calls
the create path makes: `LocalityResolver.resolve` then the probe's `AddressKey`. That is the point
of the endpoint existing at all - the client used to compute its own notion of "same property" and
match it against whatever listings its browser happened to be holding, so it could stop a real owner
over a demo fixture and then offer to edit an id the server had never issued. Deriving the key on
the same code path the create will take means the pre-check and the write cannot disagree.

The meter goes through the same `MeterKey` normaliser for the same reason, and that also subsumes
the blank-to-null guard the line used to carry: `= ''` is a match in SQL where `= null` is not, so a
caller sending an empty meter would otherwise collide with every listing that also had one, and `""`
has no digits so it keys to null. The read is read-only and writes nothing - the `Property` it
builds is a scratch value that reaches the derivation and is never persisted.

### 9.5 Owner lifecycle writes that deliberately do nothing else

`confirmAvailable` stamps `last_confirmed_at = now` and that is the whole write; freshness is
derived from it on every read, so a dormant owner is back to active the instant they answer with
nothing to sweep or recompute. It does **not** touch `status` (confirming availability is not a
moderation event and must not send a live listing back to pending), `recheck_requested_at` (an owner
saying "still available" says nothing about the price change a moderator is queued to look at, and
clearing it here would let any owner dismiss their own re-check with one tap), or `archived` (a
confirmation is not a restore). It writes no audit row either, unlike archive and restore: those are
contestable - somebody took a listing down and the platform may be asked who - whereas a
confirmation is self-reported by the only person entitled to report it and its own timestamp is the
record. An audit row would double the write volume of the single most-repeated owner action on the
platform to store what the column already says. It is idempotent because the owner cannot see which
of their listings the badge currently considers stale, and the dashboard's "confirm all" would
otherwise need to ask.

`archive` is soft, because the row is not only the owner's: enquiries, deals and moderation history
all point at it, and the catalogue already filters on the flag it sets. It is idempotent - archiving
an archived listing is the state the caller asked for, and a second click on a slow connection
should not be an error. The reason string is the server's, not the client's: there is one thing the
route means, and a free-text field would only give a client somewhere to put a string nobody reads
back.
