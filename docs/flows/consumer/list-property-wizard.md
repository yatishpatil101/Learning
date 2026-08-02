# Flow: List / Post a Property (Owner Wizard)

> The owner-facing multi-step wizard that turns a property into a pending listing, and the flatmate
> "list your room" variant, then hands the submission to the admin verification maker-checker queue.
> Posting is **L1-only** under the **badge-not-gate** model (ADR-019): any signed-in user posts
> immediately — **no Aadhaar/identity gate**; the Verified badge is an optional, post-success nudge.
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** owner (maker), admin/manager (checker)

---

## 1. Purpose & user problem
- **Persona:** a property owner (or a sitting tenant listing a room) who wants their unit live on
  PuneNest.
- **Job-to-be-done:** "Describe my property, price it, add photos/documents, and publish it."
- **Why it matters:** this is the **supply side** of the marketplace. Listing quality and the
  admin listing-verification maker-checker are what make the "zero brokerage" promise real. Every
  listing enters as `pending` and only goes live after admin verification. Posting itself is never
  identity-gated — an owner signs in (L1) and posts; verification is an **optional Verified badge**.

## 2. Entry points
- **Routes:** `/list-property` (`ProtectedRoute`). Query params:
  - `edit=<listingId>` - edit an existing listing (never consumes quota; see section 5).
  - `flatmate=1` - arrived from the Flatmates `PostChooser` ("I have a place") or from a room
    card's Edit action. Pre-selects the flatmate track via `rentMode = 'flatmate'`; `hostRole` still
    defaults to `owner` and the host picks owner/tenant on Step 1.
- **Tiles / triggers:** "Post Property" nav/CTA, dashboard "Add listing", and the Flatmates
  `PostChooser` - a single posting entry point that asks "Do you have a place?" and routes only the
  *yes* branch into this wizard (`?flatmate=1`); the *no* branches stay on Flatmates as a seeker
  request or a group.
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
  (`puneNestListings:<mobile>`, via `addListing`). Edited in place via `updateListing` + `mutateDb`.
- [`rooms` / `flatmate_requests`](../../system/data-model.md) - the flatmate track **creates** a
  room in `puneNestRoomListings` via `addRoom` (`status: 'pending'`).
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
- **Autosave draft:** the whole form autosaves to `pnDraft:list-property` (`useFormDraft`); a
  restore banner + "start fresh" let the owner resume or wipe. There is **no explicit "save draft"
  status** - a listing only exists once submitted; the draft is client-only.
- **Submit (`submitProperty` -> `finalizeListing` -> `persistListing`):**
  1. `validateStep3` must pass (no identity/Aadhaar precondition — posting is L1-only).
  2. New post over quota is blocked; edit with an identity change opens the identity guard modal.
  3. `hashPhotos(photos)` computes perceptual hashes (browser) for duplicate detection.
  4. `persistListing` builds the record with `status: 'pending'`, `statusClass: 'pill-pending'`,
     writes to `db.listings` (`mutateDb`) and the per-user store (`addListing`), pushes an "under
     review" notification, and (sale only) stores docs via `addDocument`.
  5. Confetti + success screen. A brand-new **rent** listing stays on the success screen, because
     the split-flat offer (`PostSuccessSplitNudge`) lives there; everything else auto-navigates to
     `/dashboard` after 3.2s.

### Derivations in `persistListing`
- **Title:** `[BHK|sharing prefix] + typeLabel + " in " + locality` (PG multi-occupancy advertises a
  "from ... onwards" price = cheapest bed).
- **Locality binding:** `matchLocalityToCanonical(locality, lat, lng)` -> canonical slug; else
  `addCommunityLocality(...)` mints a community-tier locality (never the old first-word truncation).
- **Private identifiers stripped** from the buyer-readable `form` snapshot (`electricityConsumerNo`,
  `pmcPropertyId`) - they live only in Ops-only `strongIds`.
- **Flat spec fields** (bhkNum, bath, area, price, furnishing, amenities, ...) are denormalized onto
  the record so cards/detail read them without reaching into `record.form`.

### Duplicate prevention (`evaluateListingDedup`)
- **Hard block:** same owner + same physical unit (electricity meter / PMC tax id / society+unit+
  pincode) -> `persistListing` returns `{ ok:false, blocked:true, existingId }`, the wizard shows the
  duplicate guard and points the owner to the existing listing.
- **Soft flag:** a **different** owner claiming the same address, or reusing the same photo hashes ->
  the listing still posts but carries `duplicateFlag` + a `flagReason` and opens an Ops review thread
  (`ensureOwnerReview` + `addPropReviewAdminNote`).

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
- **Identity change on edit:** `showIdentityGuard` modal before finalizing (quota implication).
- **Per-step validation:** each `nextStep` blocks advance and scroll-focuses the first error; Step 2
  additionally requires a map placement (`locationSet`).
- **localStorage quota:** `persistListing` swallows quota errors so the success flow still completes;
  oversized documents are stored as `tooLarge` (metadata only, `dataUrl: null`).
- **Rent skips doc storage:** only sale listings persist uploaded documents (mirrors the HTML
  prototype); rent uses the single Ownership Proof for the badge but doesn't vault it.
- **PG rent sync:** unchecking a sharing type prunes its stale per-occupancy rent and recomputes the
  "from" `monthlyRent` as the cheapest remaining bed.

## 9. Current mock implementation
- **Orchestrator:** `list-property/useListProperty.js` (state, validation wiring, submit handlers).
- **Persistence:** `list-property/submit.js` (`persistListing`, `persistFlatmate`).
- **Rules modules:** `list-property/validation.js`, `list-property/editPolicy.js`,
  `list-property/constants.js` (types, docs, `docsFor`, `requiredDocKeyFor`, photo categories),
  `list-property/initialForm.js`.
- **Store/API:** `src/lib/store/listings.js` (`addListing`, `updateListing`, `getListing`,
  `isListingApproved`), `src/lib/store/billing.js` (quota), `src/lib/mockApi` (`mutateDb`),
  `src/lib/data/documents.js` (`addDocument`), `src/lib/data/propertyIdentity.js`
  (`evaluateListingDedup`), `src/lib/data/flatmates.js` (`evaluateHostEligibility`,
  `enqueueFlatmateReview`), `src/lib/data/imageHash.js` (`hashPhotos`).
- **Provider seam:** consumer listing reads/writes flow through `propertyService` /
  `listingProvider` (mock). `src/services/config.js` selects mock vs http.
- **Data/seed:** `src/data/properties.json` (seed listings), `src/data/db.json`.

## 10. Target API endpoints
Map to the [OpenAPI spec](../../../backend/src/main/resources/static/openapi/punenest-api.yaml):
- `POST /me/listings` (owner) -> create a `pending` listing (section 3). `PATCH /me/listings/:id` ->
  edit (server must apply Tier A/B classification + re-review scheduling).
- `GET /properties/:id/verification` / `POST /properties/:id/verification` /
  `.../verification/decision` (section 6) -> the maker-checker queue side-effects.
- `POST /flatmates/rooms` (section 26) -> the flatmate/room track.
- **Missing but implied:** an **opt-in** badge verify endpoint (`POST /me/verification/aadhaar`,
  DigiLocker — not a posting prerequisite), a dedup pre-check endpoint, a document upload endpoint
  bound to the listing, a locality-mint endpoint, and the freemium quota check on `POST /me/listings`
  (return `403` when over limit).

## 11. Backend responsibilities
- **Own the verification gate:** a new listing must be persisted as `pending` and made live **only**
  by an authorized admin decision; the client cannot set `status: 'approved'`.
- **Enforce the freemium quota server-side** (reject over-limit `POST`s; editing never consumes
  quota). Posting must **not** be identity-gated — L1 (authenticated) is the only floor (ADR-019).
- **Run dedup and photo-hash matching server-side** (block same-owner duplicates, flag cross-owner
  claims) - the client hash is a hint, not a decision.
- **Apply the edit policy server-side:** classify Tier A vs Tier B, keep the listing live on a
  material edit while scheduling a re-check, enforce the material-edit cap/window, and compute the
  price-reduced/price-jump signals - never trust the client's tiering.
- **Strip and protect private identifiers** (electricity/PMC ids) so they never ship to buyers; keep
  documents access-gated.
- **Write audit + notifications** on create, approve, reject, archive, and material edit
  (cross-cutting sections 4 & 7).
