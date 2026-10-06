# Flow: List / Post a Property (Owner Wizard)

> The owner-facing multi-step wizard that turns a property into a pending listing, and the flatmate
> "list your room" variant, then hands the submission to the admin verification maker-checker queue.
> Posting is **L1-only** under the **badge-not-gate** model (ADR-019): any signed-in user posts
> immediately — **no identity gate**; the Verified badge is an optional, post-success nudge.
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** owner (maker), staff (checker)

---

## 1. Purpose & user problem
- **Persona:** a property owner (or a sitting tenant listing a room) who wants their unit live on
  Draazy.
- **Job-to-be-done:** "Describe my property, price it, add photos, and publish it."
- **Why it matters:** this is the **supply side** of the marketplace. Listing quality and the
  admin listing-verification maker-checker are what make the "zero brokerage" promise real. Every
  listing enters as `pending` and only goes live after admin verification. Posting itself is never
  identity-gated — an owner signs in (L1) and posts; verification is an **optional Verified badge**.

## 2. Entry points
- **Routes:** `/list-property` is public for a new draft and asks for OTP inside the wizard only when
  the owner reaches media/publish; `?edit=<id>` remains protected. Query params:
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
  `useListProperty.js` (orchestrator), `PostSuccessSplitNudge.jsx` (post-success "let it room by room" offer), `ProgressMeter.jsx`,
  `StepNav.jsx`, `ListingPaywall.jsx`, `EditPolicyBanner.jsx`,
  `PropertyDetailsStep.jsx` (shell -> `PropertyDetailsWhole.jsx` / `PropertyDetailsFlatmate.jsx`,
  with `step1/*` field groups), `LocationStep.jsx`, `PricingStep.jsx`, `SocietySelect.jsx`,
  `PhotosDocumentsStep.jsx`,
  `FlatmateFlow.jsx` (flatmate steps 2 & 3),
  plus `validation.js`, `submit.js`, `editPolicy.js`, `constants.js`, `initialForm.js`.

## 3. Actors & roles
- **Maker = owner** fills the wizard as a guest or signed-in user; submitting/media upload requires
  inline OTP sign-in at **L1**.
- **Checker = staff** reviews the resulting `pending` listing in
  `src/pages/admin/AdminProperties.jsx` (three-fact checklist; see
  [`../admin/property-verification.md`](../admin/property-verification.md)).
- **Floor (not a gate):** posting requires only being signed in (L1, `ProtectedRoute`) — there is
  **no** identity or document gate on the form under ADR-019. The Verified owner badge is offered on
  the success status card, never as a wall. See
  [`../../system/platform-architecture.md`](../../system/platform-architecture.md) §6.4 / ADR-019.

## 4. Entities touched
- [`listings` / `properties`](../../system/data-model.md) - **created** as `status: 'pending'` in
  both the mock DB (`db.listings`, via `mutateDb`) and the per-user store
  (`draazyListings:<mobile>`, via `addListing`). Edited in place via `updateListing` + `mutateDb`.
- [`rooms` / `flatmate_requests`](../../system/data-model.md) - the flatmate track **creates** a
  room in `draazyRoomListings` via `addRoom` (`status: 'pending'`).
- [`identity_verifications`](../../system/data-model.md) - **read** only for the **optional** Verified
  badge (post-success nudge); **not** a prerequisite to post.
- [`property_reviews`](../../system/data-model.md) - `ensureOwnerReview` opens a review thread on a
  material edit or a duplicate flag; `addPropReviewAdminNote` writes the system message.
- [`documents`](../../system/data-model.md) - not touched by the wizard; ownership papers for the
  Verified badge go to the Dashboard Document Vault. `localities` - an unmatched real locality **mints** a
  community-tier locality via `addCommunityLocality`. `notifications` - a "under review" notification
  is pushed on create.

## 5. Business rules & logic  *(the meat)*

### Optional badge + paywall (before any step)
- **Deferred login (ADR-019):** a new `/list-property` draft is **not** hidden behind a login wall.
  Guests can complete details, location and pricing; the shared inline OTP sheet opens at the photos
  step because photo storage and publish calls are owner-scoped. After sign-in the browser draft is
  adopted by that account, quota/paywall is checked, and the owner continues without a redirect.
  Dismissing the sheet leaves the guest on the photos step behind a verify card; the submit button
  reads "Verify & submit" and reopens the sheet, since sign-in is checked before the photo floor.
  `?edit=<id>` is still protected before the wizard loads.
- **No identity gate:** once signed in (L1), an owner posts immediately. The success screen is a
  `ListingStatusCard` (Pending / Needs info / Live · Verified owner) with one next action; the
  optional badge is offered there, never before posting, and is fully dismissible.
- **Freemium quota (`src/lib/store/billing.js`):** `PLAN_LISTING_LIMITS = { free: 1, 'owner-free':
  1, owner2: 2, owner5: 5 }`. `activeListingCount()` counts non-flatmate, non-deleted/archived
  listings. `canPostListing()` = `activeListingCount() < listingLimit()`. A **new** post over the
  limit renders `ListingPaywall`; **editing** an existing listing is never paywalled (`canPost` is
  fixed `true` in edit mode).
- **The server enforces the same ceiling.** `ListingService.create` calls `ListingQuota.require`
  and `requirePace` (§9.2), so skipping this screen does not post past the plan.

### The 4-step wizard
`StepNav` shows the same 4 phases (`LISTING_STEPS`: details, location, price, photos)
for sale, whole-place rent and a flatmate room, so picking what you post never reshapes the wizard.
A room's Location step asks only locality, society, flat and pin; its Price step only room rent,
deposit and available-from. `nextStep` validates the current step and blocks
advance on any error (scrolling to the first error via `scrollToError`).

**Property "For" + rent sub-mode (top of Step 1):**
- `deal`: `buy` (Sale) or `rent`. **No default** — the owner taps one; Next is blocked until they do.
  `bhk` has no default either; bathrooms then default from BHK and stay editable.
- Whole-place listings don't ask who is listing. `formDetails.listerRelation` stays legal only so
  listings that stored it still re-save.
- When `deal === 'rent'` AND residential: choose `rentMode` = `whole` or `flatmate`.
  `isFlatmateMode = deal === 'rent' && rentMode === 'flatmate'`. Switching to a non-residential
  type forces `rentMode = 'whole'`.

**Step 1 - Property details (`validateStep1`):**
- `propertyType` required (`flat | independent | villa | commercial | openplot | farmland`). PG is not
  a listing type: smart search has no `pg` synonym and help has no PG tag; only the applied, immutable
  migrations V04 and V18 still mention it.
- Commercial: `commercialType` required (`office | shop | retail | warehouse | industrial |
  coworking`).
- Residential: `bhk` (pills 1 RK, 1, 2, 3, 4, 5+) and `bathrooms` required. Search keeps its
  "4+" bucket as `bhk >= 4`, so a 5+ listing still appears there.
- **`carpetArea` always required.** A flat or house takes 100–20,000 sq.ft; land is bounded per unit
  (`areaRangeFor`: sq.ft, sq.yd, sq.m, guntha, acre, hectare); commercial takes 1–1,000,000. Built-up,
  when given, must be at least the carpet area, and super built-up at least the built-up area (or the
  carpet area when built-up is blank). A plot's length × width fills the area and keeps following
  the dimensions while the area still holds the value it filled; once the owner types their own area
  it is left alone. Square metres are a plot unit (1 sq.m = 10.7639 sq.ft, `lib/listings/areaUnits.js`).
- Facing offers the four cardinal directions only. Listings posted earlier may still state a corner
  (NE, NW, SE, SW); search counts a corner under both cardinals beside it.
- Type-specific fields are reset when the type changes (`changePropertyType` clears
  `TYPE_SPECIFIC_KEYS`) so one type's answers never leak into another.

**Step 2 - Location (`validateLocationStep`):**
- **Society first.** The society picker leads the step; picking one autofills locality, pincode,
  map pin, building age and RERA ID, but only into fields that are empty or were themselves filled
  by an earlier society pick, so an owner's own entry is never overwritten. Below our own societies
  the picker lists up to 5 **Google Maps** buildings (`establishment`/`premise`, biased to the pin);
  picking one mints it into the catalogue with Google's coordinates (a guest gets the name, pin and
  pincode unlinked until sign-in). The same picker serves the flatmate step and the rent agreement.
  "Use my current
  location" places the pin from the device's position. The map uses cooperative gestures (one
  finger scrolls the page, two pan the map) and 44 px zoom controls.
- `locality` required; must be **placed on the map** (`form.pinPlaced`, set by a locality pick,
  search or pin drag) or `err.location` is raised - a listing is never geo-pinned to the default.
  Placement is a form field rather than component state so the autosaved draft carries it: the
  coordinates cannot stand in for it, since `initialForm`'s default is Baner's canonical centre.
- `flatNumber` required unless land; `society` required unless land; `pincode` must match
  `^[1-9]\d{5}$` (six digits, not starting 0).

**Step 3 - Pricing (`validatePricingStep`):**
- **Rent:** `monthlyRent` at least ₹1,000, `deposit` present (zero allowed) and no more than 24 months'
  rent, `availableFrom` present. Deposit helper `setDepositMonths(n)` = `monthlyRent * n`.
  "Anyone" is exclusive among preferred tenants, and so is "Bachelors" against male/female bachelors.
  Commercial rent shows a ₹/sq.ft/month caption. Rent never sends the home-loan answer.
- **Sale:** `price` at least ₹1,00,000 (catches "85" typed for 85 lakh), `possession` present,
  `ownership` present; if `possession === 'available'` then `availableFrom` required. Power of
  Attorney is not offered as a new pick (it does not pass title), but a listing that already holds it
  keeps it on edit. Home loan is a pair of Yes/No pills that starts unanswered and is not sent until
  answered. The price caption is ₹/sq.ft, or ₹ per the land's own unit (guntha, acre, sq.m, …).
- **Plots in a layout (MahaRERA).** An open-plot sale asks "Is this plot part of a layout / plotted
  project?" (`formDetails.plottedProject`). The MahaRERA ID is **optional** either way (RERA binds
  promoters and agents, not an owner reselling a plot); if typed, its format is checked on the client
  and the server (`ListingSanityLimits`). Rentals and
  farmland are not asked. Changing `reraId` or `plottedProject` on a live listing queues a moderator
  re-check. A resale listing never autofills `reraId` as its own claim.
- The server mirrors the limits (`ListingSanityLimits`, 422 `validation_failed`): sale ≥ ₹1,00,000,
  rent ≥ ₹1,000, residential carpet 100–20,000 sq.ft, built-up ≥ carpet, super built-up ≥ built-up
  (≥ carpet when built-up is blank), deposit ≤ 24 × rent. An edit is checked only on the fields it
  changes, so an untouched legacy value never blocks a save.
- The real available date lives in `formDetails.availableFrom` and is public as `availableDate`; the
  detail page shows "From Mon YYYY" for a future date — on a sale only when the possession is a new
  launch or under construction. The top-level `availableFrom` stays a search bucket (`now`, `15`, `30`).

**Step 4 - Photos & description (`validateStep3`):**
- **Photos:** one is the floor; under three, a hint says "Add at least 3 photos — listings with 3+
  photos are approved faster."
- **Up to the configured photo limit**: default 10, set by an admin in Settings → General (3–20), stored
  as `settings.listings.maxPhotos` and published on the public `GET /bootstrap` (`listingPolicy`)
  (`usePhotoLimit` in `lib/uploads`). The server enforces the same number on listing create, owner
  PATCH, moderator PATCH and flatmate room create/edit, for every property type. It is strict: a
  listing stored with more photos must trim before an edit that sends `images`. One picker accepts HEIF/HEIC, JPEG/JPG and PNG; it carries no
  `capture` attribute, so phones offer camera or library in their own sheet. HEIC is converted to JPEG in the browser, so the server receives JPEG or
  PNG only. A photo under 480 px on its shorter side is refused at its tile with that reason.
  Existing media is not silently deleted on edit. Video uploading is hidden and does not contribute
  to completion.
- **Gallery.** The cover is the first photo: "Set as cover" jumps a photo to the front, and dragging
  reorders the rest (press and hold on touch so a swipe still scrolls; Space and the arrow keys on a
  keyboard). Up to three uploads run in parallel, and a tile whose decode or upload
  fails shows its own retry.
- **Amenities** on a residential listing are society amenities only. On a new listing a society
  pick pre-ticks that society's amenities; an edit never re-ticks them. Everything inside the home
  (modular kitchen, AC, geyser, wardrobe, furniture) is one picker on step 1 at every furnishing
  level, titled "What's already fitted?" when unfurnished and "What's included?" otherwise. Listings
  saved when those items were amenities move them into furniture on open (`withInFlatAsFurniture`).
- **"Write it for me"** (`describe.js`) drafts a factual description from the answers already given;
  it asks before replacing a description the owner has typed. The description still passes the
  contact filter.
- **Video walkthrough (optional).** An owner may paste a YouTube link; it is stored as the 11-character
  video id (`video`, server pattern `^[A-Za-z0-9_-]{11}$`) and any other URL is refused. The detail page
  plays it through a `youtube-nocookie.com` embed (`VideoWalkthrough.jsx`), which the CSP `frame-src`
  allows. Changing the video on a live listing queues a moderator re-check.
- Each uploaded photo is strictly below 1,000,000 bytes. Originals may be up to
  25,000,000 bytes; advertised image dimensions are capped at 48 megapixels before decoding. Neither
  bound is quoted in the wizard's guidance: they are decode-memory guards, and only the file that
  actually hits one is told about it. The server reads the upload's header before decoding it and
  refuses (413) a canvas over 10,000 px on a side or 40 megapixels (`PhotoUploads`). The server itself
  takes only JPEG or PNG, since the browser has already converted any HEIC; it keeps only an allowlist
  (JFIF, ICC and Adobe colour segments and the image data; PNG rendering chunks), drops everything after
  the end marker (motion-photo video, MPF images), and refuses (415) a file it cannot walk to that
  marker (`ImageMetadataStripper`).
- Compatible small images are decoded for validation but retain their original bytes. Oversized
  images are re-encoded to JPEG in a worker from a 2,560-pixel longest edge, stepping down a quality
  ladder and only then down in resolution — by the ratio the last measured round implies, always
  resampled from the full frame. **Within those two bounds no photo is refused for its size:** its
  ladder runs to quality 0.35 and a 320-pixel edge, which is tens of kilobytes. A vault *document*
  stops at quality 0.62 and 1,600 pixels and is refused below that, because a scan degraded past reading
  is worse for the moderator who has to check it than one the owner is asked to retake. The first
  rung is 0.92 (the single attempt it replaced used 0.95, so an oversized photo that always fit is
  now marginally lossier). HEIC uses the CSP-safe heic-to decoder and becomes JPEG even below the
  cap, because browsers cannot consistently display HEIC. Unchanged originals may retain metadata.
- **No documents in the wizard.** Posting and editing never ask for ownership papers. The Verified
  property badge is requested from the Dashboard Document Vault (`?tab=documents&prop=<id>`, linked
  from the listing status card's **Get Verified property badge**): the owner uploads one proof for
  the listing's type — rent flat: electricity bill, Index II, share certificate or property tax
  receipt; sale flat: Index II or share certificate; plot: 7/12, 8A or property card; farmland:
  7/12 or 8A — then presses **Request Verified badge**. Aadhaar/PAN are never asked for. pdf-lib
  validates unsigned, unencrypted PDFs (1–100 pages), then optimizes object streams only when oversized.
  It does not flatten pages, rasterize text or guarantee every scanned PDF will fit. Signed PDFs,
  malformed files and outputs still above the limit are refused with visible guidance. See
  [`../admin/property-verification.md`](../admin/property-verification.md) "Ownership gate".
- Photos upload three at a time; submission is disabled while preparation/upload is active.
  Workers terminate on completion, cancellation or a 30-second deadline. The server checks actual
  uploaded bytes and MIME independently, and caps persisted property galleries at the configured limit.
- HEIC decoding remains a separately replaceable asset. Production builds package library notices,
  corresponding library/codec sources and integration source under `/third-party/uploads/`.

### Draft vs submit
- **New-post draft only:** `useFormDraft` autosaves the form to `dzDraft:list-property:v3`, stamped
  with its owner (`__owner`); a draft left by another account is never restored, and logout clears
  every `dzDraft:*` key. The draft carries the step, the room mode and durable photo URLs.
  A restore banner + "start fresh" let the owner resume or wipe. There is no server draft
  status. The suffix is part of the contract — consent and agreement fields are `omit`ted on write, and
  `omit` cannot reach a draft an older build already wrote, so a shape change renames the key (the
  `:v2` key is removed on load). Specs seed it through `LIST_PROPERTY_DRAFT_KEY` rather than
  retyping the literal.
  Edits never restore, autosave or clear this draft, including after a successful save. Resetting
  an edit reloads the saved server snapshot, leaving the separate new-post draft untouched.
- **Saved edit readiness:** `GET /me/listings/{id}` is owner-scoped. The form becomes ready only
  when it succeeds; a failure blocks the
  entire editor and writes until an explicit retry reloads it. There is no localStorage edit
  source or partial prefill. The form remounts keyed by owner + listing, and stale responses are
  ignored so state and pending work cannot cross editors.
- **Submit (`submitProperty` -> `finalizeListing` -> `persistListing`):**
  1. `validateStep3` must pass (no identity precondition — posting is L1-only).
    Edits also revalidate Steps 1–2 against the saved snapshot before submission.
  2. New post over quota is blocked; edit with an identity change opens the identity guard modal.
  3. Photo hashes for duplicate detection are computed by the server at upload and carried in the
    photo's storage key; the create/edit reads them from the gallery URLs and ignores any client value.
    The server therefore accepts only its own upload URLs in `images`/`floorPlan` (`ListingPhotoSources`):
    a foreign host could swap the picture after approval, and a `?query` would hide the hash. An edit may
    keep any URL the listing already holds, so legacy galleries are never forced to re-upload.
  4. `persistListing` awaits `addListing` (`POST /me/listings`) for a new pending listing, or
    `updateListingFields` (`PATCH /me/listings/{id}`) with only changed answers for an edit.
    `forTheWire` composes flat/tower/society/street into `address`, omits an unanswered floor
    (not a saved ground-floor zero), maps maintenance and private identifiers, and includes
    supplementary `formDetails`. New posts preserve decimal headline, carpet and built-up
    areas without integer truncation. The server supplies the created id and moderation state.
  5. Confetti + success screen. It stays until the owner chooses **Go to dashboard** or **Post
     another**, and says the listing is reviewed within 24 hours. A brand-new **rent** listing also
     carries the split-flat offer (`PostSuccessSplitNudge`) there.
  6. A server 400/422 with field errors is mapped to its step and field (`serverFieldErrors.js`;
     for example `construction` → the possession control): the wizard opens that step and shows the
     message beside the field. An error it cannot place falls back to a toast.

### Wizard shell
- **Sticky actions on mobile:** the Next / Save bar sticks above the bottom navigation. It does not
  unstick while an input has focus: the blur on the next tap re-sticks it under the finger and the
  tap is lost (a Parking pill tapped after typing the carpet area never registered).
- **Progress meter:** `ProgressMeter.jsx` collapses to a one-line summary on mobile and expands on tap.
- **Leaving the wizard:** an in-app link out of a dirty wizard opens a confirmation (Stay / Leave)
  instead of navigating; the router is not a data router, so this is the wizard's own guard rather
  than `useBlocker`. Leaving a new post flushes the draft first; in edit mode the copy warns that
  unsaved changes will be lost. Closing or reloading the tab uses the browser's `beforeunload` prompt.

### Derivations in `persistListing`
- **Title:** `[BHK] + typeLabel + " in " + locality` (BHK only qualifies a residential home;
  commercial and land carry none).
- **Locality binding:** `matchLocalityToCanonical(locality, lat, lng)` -> canonical slug; an
  unmatched locality yields **no slug** (D225 deleted the community tier that used to mint one, and
  never the old first-word truncation). The listing lands in the server's locality queue and cannot
  be approved until a human files it — see `docs/flows/admin/localities.md`.
- **Private identifiers stripped** from the buyer-readable `form` snapshot (`electricityConsumerNo`)
  - it lives only in Ops-only `strongIds`.
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
  `{ ok:false, blocked:true, existingId }` and the wizard shows the duplicate guard. Opening the
  existing listing uses the owner-scoped edit load above, not a browser-local listing lookup.

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
- **Saved answers:** private owner/staff `formDetails` stores supplementary split address,
  landmark, ownership, rental terms and type-specific answers in `properties.form_details`
  (JSONB, [V21 migration](../../../backend/src/main/resources/db/migration/V21__DDL_property_edit_details.sql)).
  The server validates an allowlist, types and size bounds; media, credentials and verification
  flags do not belong in it. Pincode and headline/carpet/built-up areas stay in canonical columns.
  Prefill preserves saved types, including `false` flags and zero-valued answers, rather than
  replacing them with defaults.
- **Sparse PATCH:** compare against the hydrated snapshot and send only changed answers;
  supplementary changes retain the other saved `formDetails` keys. An unrelated edit preserves
  the title, exact numeric age, independent headline area and full address. Changing carpet area
  updates the headline area only if it matched the original carpet value; built-up stays separate.
- **Legacy address:** a stored line the wizard itself composed is handed back to the address boxes
  in the order it was joined, so recomposing it reproduces the same line whichever box a segment
  lands in. A line the wizard did not compose (line breaks, or more segments than there are boxes)
  is never guessed at: it is displayed verbatim and preserved on unrelated edits. Recovered boxes
  are not an edit — an unrelated save writes no address. An explicit replacement must satisfy the
  required address fields and stores all four parts, so the line always stays decomposable.
- **Legacy validation:** unchanged missing answers (such as pincode, availability or ownership)
  do not block an unrelated edit while the listing kind is unchanged. Changed or cleared saved
  answers still validate. Clearing a saved `builtUp` shows an error rather than silent success:
  the backend's null-means-unchanged PATCH contract cannot clear that measurement.
- **Public contract boundary:** saved pet, tenant and availability answers support owner edit
  roundtrips only. Their public write-sync is a separately tracked missing canonical contract;
  this does not introduce or fix public search/filter behaviour.
- **Browser coverage:** [edit-prefill.spec.js](../../../e2e/tests/consumer/list-property/edit-prefill.spec.js)
  covers saved rent/sale answers, legacy edits, legacy address recovery, vault failure/retry,
  decimal-area edits and create-to-edit reload. All nine journeys passed together on Chromium
  against isolated API 8091, app 5201 and `draazy_e2e_edit_prefill`. Focused backend tests passed
  20/20; JavaScript tests passed 21/21.

**The server decides what an edit does** (`ListingEditRules`, see
[`../admin/property-verification.md`](../admin/property-verification.md) §5.5): `bhk, propertyType,
commercialType, landUse, locality, deal` take the listing **off search** until re-approved; `price,
furnishing, possession, address, images, description, amenities, reraId, plottedProject, video`, a
changed `societyId` or `electricityMeterNo`, a `carpetArea` change of ≥ 20 % and a pin moved
> 500 m keep it **live with a re-check**. Changing `address`, `societyId` or `electricityMeterNo`
also revokes the Verified owner badge. The client tiers below only drive the owner's edit banner.

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
- **Host verification tier:** `hostRole` = `owner` or `tenant`. Owner -> tier `owner`. A tenant host
  must upload the registered leave-and-licence agreement and confirm the owner agrees
  (`ownerConsent: true`) before the room can be posted — the server refuses it otherwise (422 naming
  `agreementDoc.id` / `ownerConsent`). The picker uploads the file to the host's document vault
  (`POST /me/documents/personal`) as it is chosen, so `agreementDoc.id` is a real vault document.
- **Anti-broker guardrails (`evaluateHostEligibility`):** hard block on cap hit or same host
  re-claiming an address; soft flag when a different host already claimed the address (still posts,
  routed to Ops). See flatmates doc for the full guardrail model.
- **Seats:** the host picks **Single (1 person)** or **Double sharing (up to 2)** (`roomType`
  `Private room` / `Shared room`), so `seatsTotal` is 1 or 2 and `seatsOpen` starts equal. The rent
  field is the **room rent** (`priceBasis: 'room'`); a double room shows the host "₹X each when 2
  share". The host no longer states how many people the flat can hold — that is the owner's or the
  society's rule, asked only in the owner split flow below.
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
- `maxRoomsForBhk(bhk)` = bedrooms + hall; 4 and 5+ are unbounded, since a stored 4 predates the
  5+ pill and may mean "4 or more".
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
  checker = staff who ticks the three checks and approves, asks for info, or rejects (final), all in
  one server transaction. This flow doc covers the **maker (submission)** side; the checker/queue
  side lives in [`../admin/property-verification.md`](../admin/property-verification.md). A
  stays-live edit on a live listing is a lighter re-check that keeps the listing live.

## 7. State machine
```
draft (client-only autosave)  --submitProperty-->  pending  --checker approve-->  approved (live)
                                                    |   \--needs info--> pending[needs_info]
                                                    |          (owner reply/edit -> pending; 14 d silent -> archived)
                                                    \--reject (final)--> rejected
live listing + stays-live edit -> stays approved + re-check queued
live listing + off-search edit -> pending (checklist unticked)
approved  --owner pause-->  paused  --owner resume-->  approved (no new moderation decision)
```
- **Terminal-ish:** `approved` (live), `rejected` (final; only a two-staff override reopens it),
  `archived` (soft-delete; restore resets to `pending`, cross-cutting section 4). Rooms follow the same
  `pending -> ...` shape plus a separate Ops share-review for tenant/flagged posts.
- **Owner-facing labels:** Pending (amber) / Needs info (rose) / Live (teal) + optional
  `Verified owner`; a final reject reads `Not approved`.

## 8. Edge cases, validation & error states
- **Over quota (new only):** `ListingPaywall` replaces the form until the owner upgrades.
- **Duplicate (same owner):** hard block + duplicate guard modal pointing to the existing listing.
- **Duplicate (different owner / same photos):** posts but is `duplicateFlag`ged and opens an Ops
  thread.
- **The save itself fails:** the seam write is awaited, so a rejected `POST /me/listings` keeps the
  wizard in place rather than showing a success screen for a listing that does not exist. Field
  errors open their step and field; anything else is a toast.
- **Identity change on edit:** `showIdentityGuard` modal before finalizing (quota implication).
- **Per-step validation:** each `nextStep` blocks advance and scroll-focuses the first error; Step 2
  additionally requires a map placement (`form.pinPlaced`).

## 9. Backend listing writes

Relocated from code comments in `catalog/listing/` so the reasoning survives without a
multi-paragraph docblock per method.

### 9.1 Owner scope and the server-set fields

Every read and mutation in `ListingService` is keyed by the server-resolved principal id, so a
caller can only ever see or change their own rows; cross-owner access returns `404`, because we
never confirm another owner's listing exists.

On create the trust-critical fields are server-set, not taken from the body: `status = pending`,
`owner` = the authenticated caller (loaded, not a client id), and `price_unit` derived from the
deal. A listing therefore cannot be born approved or assigned to someone else. What the client *may*
say is decided by `PropertyMapper`'s allowlist, so the
"deliberately absent" set in `ListingCreate`'s docs is enforced rather than described.

**Ordering inside `createOnBehalf` is load-bearing.** The locality resolver runs after the mapper,
because its geo fallback needs the lat/lng the mapper has just set (a null slug is an accepted
outcome and simply leaves the listing out of locality facets until curated). Photo hashes are
reindexed after the flush, because the hash rows are keyed by the listing's id and it has one only
then, and before `flag`, because the photo arm reads back what that wrote.

`owner_verified` is **inherited, not claimed**. It is denormalised onto the listing because buyers
and the ranking read it there, so it has to be stamped at both ends: the reviewer's approval
back-fills existing listings, and create stamps new ones. Without this half, an owner who verified
last month and posts today gets a listing telling buyers they are unverified - and no later approval
can fix it, because a second approval on an already-verified row is deliberately a no-op.
It is read from the owner rather than accepted from the client because it is a trust signal,
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

### 9.6 Owner pause and resume, and the dashboard around them

`POST /me/listings/{id}/pause` moves a live `approved` listing to `paused`; anything else is a 409.
`POST /me/listings/{id}/resume` returns an owner-paused listing to `approved` without a new
moderation decision. Both are audited (`property.ownerPause`, `property.ownerResume`).

- A paused listing is excluded from search and every public discovery surface, but its direct link
  still resolves, so a buyer holding the URL is not sent to a dead page.
- It still counts toward the owner's listing quota: pausing is not a way round the plan.
- An edit made while paused queues its re-check as usual, and that re-check survives the resume.
- Resume re-runs duplicate flagging (`ListingDuplicateProbe.flag`), and paused listings are included
  when other listings are checked for duplicates, so pausing cannot hide a collision.

On the dashboard, My listings offers Pause / Resume per listing, shows the quota in use, and gives a
pending or re-check listing a moderation SLA badge (`lib/moderationSla.js`) measured against the
24-hour review promise. The age is taken from `resubmittedAt` when an owner sends an existing
listing back to moderation, with `createdAt`, `recheckRequestedAt` and `lastConfirmedAt` retained as
fallbacks for old rows and stays-live re-checks. On mobile the Post CTA carries the free-listing
label.
