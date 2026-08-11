# Flow: Societies & Localities

> How buyers/tenants discover Pune residential societies and localities, read curated + community
> intelligence, follow/alert on them, contribute content, and how residents claim & manage a society
> (the Society-OS SaaS surface).
> Under **badge-not-gate (ADR-019)** the only floor is **L1 mobile sign-in**: any signed-in user can
> add/upvote community info — **no Aadhaar KYC**. Posting notices is limited to a **verified resident**,
> which is a separate **resident-of-unit** verification (flat + OTP / committee approval,
> `status:'verified'`), not identity KYC.
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** buyer/tenant (default), owner,
> verified resident, society admin (claimant), ops/admin (checker)

---

## 1. Purpose & user problem
- **Persona:** a buyer/tenant researching *where* to live (locality-first) and *which building* to
  live in (society-first); a resident who wants their building represented accurately and managed;
  ops/admin who curate the society/locality graph.
- **Job-to-be-done:**
  - *Locality:* "Show me prices, appreciation, livability, rental yield and live inventory for a
    Pune locality, and let me set an alert."
  - *Societies index:* "Browse/search Pune societies, filter by locality, follow the ones I like,
    or add mine if it is missing."
  - *Society Hub:* "See a building's specs, ratings, homes on sale/rent, community tips, events and
    location - and, if I live here, claim/verify and contribute."
- **Why it matters:** society- and locality-first discovery is the top-of-funnel bridge into search
  (`/listings`) and the differentiator vs broker portals. `follow`/alerts and `mintDemandSociety`
  capture demand even when there is zero inventory yet. The claim + resident-verification surface is
  the seed of a future Society-OS SaaS.

## 2. Entry points
- **Routes:**
  - `/societies` - Societies index (search/filter/follow). `Societies.jsx`.
  - `/society/:slug` - Society Hub. `Society.jsx` (+ `?tab=` deep-links overview|homes|reviews|
    community|location; `?s=`, `?name=`, `?loc=` fallbacks for a generic/unknown slug).
  - `/society` (no slug) - gated behind `AppFlagRoute flag="societySaaS"`; the `/society/:slug`
    detail is always reachable.
  - `/locality` and `/locality/:slug` - Locality insights dashboard. `Locality.jsx` (+ `?locality=`).
- **Tiles / triggers:** nav/home "Explore societies" & "Locality insights"; property detail Society
  section links to `/society/:slug`; `SocietiesBlock` on a Locality page links each building into its
  Hub; Locality "View Properties" links to `/listings?q=<locality>`; Services hub tile "Locality
  Insights" -> `/locality/baner`.
- **Source components:** `src/pages/consumer/Societies.jsx`, `Society.jsx`,
  `src/pages/consumer/society/useSocietyHub.js` (the hub controller) + `society/tabs/*`,
  `society/SocietySidebar.jsx`, `society/SocietyModals.jsx`, `society/constants.js`,
  `society/helpers.jsx`; `src/pages/consumer/Locality.jsx` + `locality/*` cards and
  `locality/helpers.js`.

## 3. Actors & roles
- **Guest / buyer / tenant:** browse index, hub, locality dashboards; read all curated + community
  content. Following, reviewing, Q&A, contributions and alerts require **sign-in only** (L1; no
  Aadhaar KYC - section 5).
- **Verified resident:** a signed-in user with a `verified` resident record for the society; may post
  events/notices, propose the WhatsApp group link and a location correction, and their reviews carry
  a `resident: true` badge. ("Verified resident" is **resident-of-unit** verification, not identity KYC.)
- **Society admin (approved claimant):** the user whose society claim was approved becomes
  `adminMobile`; unlocks committee-side resident review (`committeeResidentReqs` / `setResidentStatus`).
- **Ops / admin (checker):** approve/deny claims, verify community societies, apply detail
  suggestions, merge duplicates, approve WhatsApp/location proposals (admin flows, out of scope here).
- **Guards:** none of the consumer routes are `ProtectedRoute`; gating is done in-handler
  (`requireLogin`, `requireSignedIn`, `requireResident`). `/society` (slug-less) and `/emi`-style extras
  sit behind `AppFlagRoute`. All guards are UX-only - see
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1.

## 4. Entities touched
Link to [`../../system/data-model.md`](../../system/data-model.md).
- **Society** - curated static catalogue (`src/data/societies.js`, 28 rows `S01..S28`) + MahaRERA
  bulk import (`societies-rera.js`) + user-minted **community** societies (localStorage). **Read**
  everywhere; **created** by `mintDemandSociety` / supply-side auto-mint; **updated** via an overlay
  (`pnSocietyOverlay`) on ops verify / applied suggestion / claim decision.
- **Locality** - canonical registry (`src/data/localities.js`, `LOCALITIES`) + curated intelligence
  (`src/data/localityIntel.js`, `LOC`, 10 fully-covered localities). **Read** only in these pages
  (community localities are minted elsewhere).
- **Society overlay / claim / resident / suggestion / merge** - localStorage records written by
  `src/lib/store/societyAdmin.js` (`pnSocietyOverlay`, `pnSocietyClaims`, `pnSocietyResidents`,
  `pnSocietySuggestions`, `pnSocietyMerges`). Created/updated here (maker side), decided by ops.
- **Reviews & Q&A** - `getEntityReviews/addEntityReview('society'|'locality', id)`, `getSocietyQA` /
  `addSocietyQuestion` / `addSocietyAnswer`.
- **Follows** - `getFollowedSocieties` / `toggleFollowSociety` (`pnFollowedSocieties`).
- **Community content** - contributions (tips/picks/photos + replies + helpful votes), events &
  notices board, WhatsApp join link, location correction, content reports.
- **Saved searches / alerts** - `addSavedSearch` (locality alert reuses the listings alert layer).
- **Properties** - read via `listProperties({})` and mapped to societies by `societyForListing`.

## 5. Business rules & logic  *(the meat)*

### 5.1 Society identity, tiers & verification
- **Slug is identity.** `slugifySociety(name, locality)` lowercases + hyphenates. Lookups
  (`societyBySlug` / `societyById`) transparently follow **merge redirects** (`resolveMergedSlug`,
  up to 8 hops) so a duplicate that ops merged away resolves to its canonical row.
- **Catalogue** = curated `SOCIETIES` + `RERA_SOCIETIES` + registered community rows, minus merged
  slugs (`allSocieties()`).
- **Tier / badge derivation (single rule):** `verified = !!(registration && conveyance)` AND tier is
  not `community`. Curated rows ship `registration:true, conveyance:true`. Community rows start
  unverified; ops `verifyCommunitySociety` flips tier to `verified` and writes an overlay with
  `registration:true, conveyance:true`.
- **`managed` / claimed:** `claimStatus === 'claimed'` (a "Managed on PuneNest" badge). Derived in
  `resolveSociety`: an approved claim -> `claimed`, a pending claim -> `pending`, else overlay/base.
- **`_thin`** = a community/demand row with no `units` and no `builder`: the hub must NOT fabricate
  specs; it shows an honest "add details" / "help verify" panel instead.

### 5.2 Society -> listing binding (`societyForListing`)
Deterministic and honest: if a listing has an explicit `societyId` and it resolves, use it. Otherwise
(legacy/unbound) fall back to a **locality-scoped, id-stable hash**: `pool =
societiesInLocality(localitySlug)` (or all curated if empty), pick `pool[fnvHash(listing.id) %
pool.length]`. `listingsInSociety(listings, socId)` filters listings whose bound society id matches.

### 5.3 Societies index (`Societies.jsx`)
- Enriches every society with `{ verified, community, managed, rating: entityRating('society', slug),
  homes: listingsInSociety(listings, id).length }`. The rating is keyed on the **slug**, which is what
  the hub writes reviews under; the synthetic `S01`-style `id` is only ever a listings-join key.
- **Filters:** locality (`loc`), verified-only toggle, free-text `q` over `name + builder +
  localityTitle`. Locality + query mirror into the URL (shareable/deep-linkable).
- **Sorts:**
  - `relevance` (default): `rel = Number(verified)*4 + min(homes,3) + rating.avg/5`, desc, then name.
  - `rating`: avg desc, then count desc, then name.
  - `homes`: homes desc, then verified desc, then name.
  - `name`: A-Z.
- **Add-society funnel:** the "Can't find X?" CTA shows when `query.trim().length >= 2` and no exact
  name match. `addSociety` -> `mintDemandSociety({ name, localitySlug })` which mints a `community`
  candidate (`source: 'demand'`) AND auto-follows it, then navigates to its Hub. Requires sign-in.
- **Paging:** client-side `limit` starts 24, "Show more" adds 24; resets on any filter change.

### 5.4 Society Hub ratings & stats (`useSocietyHub.js`)
- **`entityRating('society', slug)`** gives real resident-review `{ avg, count }`.
- **Estimate blending is only honest for real specs:** `showEstimate = !_thin && !_community`.
  - Per-category bars: for estimate-eligible societies, `bar[k] = count ? avg(catAvg[k], base[k]) :
    base[k]` where `base = baselineBars(soc)` (a deterministic baseline from specs). Non-eligible
    societies show only categories residents actually rated.
  - **Overall:** estimate-eligible -> `count ? avg(rating.avg, mean(bars)) : mean(bars)`; otherwise
    `count ? rating.avg : 0` ("Not rated yet").
- **Price stats from live listings in the society:** `psf = mean(price/area)` over `buy` listings
  with area; `rentAvg = mean(price)` over `rent` listings; plus `forSale` / `forRent` counts.
- **Stats tiles:** total units, towers, `built = year + age`, occupancy - each rendered only if the
  field is present (thin rows show none).
- **Location:** `commuteInfo(lat,lng)` + `connectivityFor({localitySlug})`; a Google Maps directions
  URL is built only when `lat/lng` exist (`hasCoords`).
- **Tabs shown conditionally:** overview (always), homes (only if listings > 0, with count), reviews
  & Q&A (count = rating.count), community (count = contributions), location (hidden for a generic
  society). Active tab is URL-synced (`?tab=`).

### 5.5 Community writes & the sign-in floor (`requireSignedIn`)
- `requireLogin()` bounces guests to `/signin?next=/society/<slug>`.
- `requireSignedIn(fn)`: mobile-verified **sign-in (L1) is the only floor** — identity verification is
  a badge, never required to participate; a signed-in user runs `fn` directly. Gated actions:
  **reviews, Q&A, contributions (tip/pick/photo), replies, helpful votes, reports**. (No Aadhaar
  KYC — ADR-019.)
- `requireResident(fn)` = `requireSignedIn` + must be a verified resident or the society admin; gates
  **events/notices, WhatsApp link, location correction**. This "verified resident" is a **resident-of-unit**
  check (flat + OTP / committee approval), not identity KYC. Server messages: "Only verified residents
  or the committee can post this."
- **Contributions** carry `kind` in {tip, pick, photo}; validation requires the kind-specific field
  (person/service name for pick, a photo for photo, text for tip). Users may remove only their own
  contribution/reply (`forbidden` otherwise). Reports dedupe per-user (`dup`).

### 5.6 Claims & resident verification (`src/lib/store/societyAdmin.js`)
- **Claim (`requestSocietyClaim`):** requires sign-in; **one active claim per society** - a
  competing `pending`/`approved` claim by a different user returns `'exists'` (the same user may
  resubmit to update their own). Creates `{ status:'pending', by: myMobile, ... }`. On ops approval
  (`setSocietyClaimStatus('approved')`) the claimant becomes `adminMobile`/`adminName` and
  `claimStatus:'claimed'`; any other decision clears managed state.
- **Resident verification (`requestResidentVerification`):** signed-in; two-step UI - flat/unit then
  a 6-digit OTP (`useOtpFlow`). Normalises `unitKey = upper(wing+flat) sans spaces`. Routing:
  `assignedTo = 'committee'` if the society is claimed, else `'ops'`. **Flat uniqueness** is enforced:
  a request whose unit is already held by another verified resident is `flagged:'conflict'`, and
  `setResidentStatus('verified', ...)` refuses with `'conflict'` if that unit is taken by a different
  mobile. One live request per user+society (a resubmit replaces the prior).
- **Detail suggestions (`suggestSocietyDetails`):** anyone (signed-in) can enrich a thin/community
  society (builder/year/towers/units/amenities) without resident OTP. Only positive numeric fields
  survive; needs >=1 field or returns null. Stored `status:'pending'` (a pending suggestion never
  renders as fact) and nudges the ops queue via `addSocietyLead`. Ops `applySocietySuggestion` turns
  the fields into a confirmed overlay (`detailsSource:'community'`).
- **Merges (`mergeSocieties`):** records `from -> to` redirect, collapses chains, moves followers and
  Q&A onto the canonical society. `suggestDuplicates` ranks candidates by shared name tokens (stop-
  words dropped) + same-locality boost, floating verified targets up so merges canonicalise into
  trusted rows.

### 5.7 Locality insights (`Locality.jsx` + `locality/helpers.js`)
Covered localities key off `LOC[name]`. All figures are curated/deterministic (no live API):
- `scoreOf(n)` = mean of the six livability sub-scores (Safety, Connectivity, Schools, Healthcare,
  Lifestyle, Greenery).
- `rentOf(n, bhk)` = `LOC[n].rent2 * RENT_MULT[bhk]`, `RENT_MULT = {1:0.7, 2:1, 3:1.45}`.
- `yieldOf(n, bhk)` = `(rentOf*12) / (price * SIZES[bhk]) * 100`, `SIZES = {1:550, 2:800, 3:1150}`
  sq.ft.
- `puneAvgPrice` / `puneAvgYoy` = simple means across covered localities.
- **Price trend (`buildTrend(price, yoy, range)`):** back-casts 6 yearly points via
  `price / (1+g)^k` (g = yoy/100), then interpolates geometrically per range (5Y/3Y/1Y). Forecast =
  `price*(1+g)` and `price*(1+g)^2` for the next two years; a "Pune avg" series overlays.
- **Livability rank:** `1 + count(localities with scoreOf > this)`. Score label thresholds: >=8.5
  Excellent, >=8 Very Good, >=7.5 Good, else Average.
- **Compare metric values (`metricVal`):** price | rent (rent2) | yield(2 BHK) | yoy | livability.
- **"Best for" tags (`bestForTags`):** Family-safe (Safety>=8.7), Well-connected (Connectivity>=8.7),
  Top schools (Schools>=8.7), High rental yield (yield>=4.5), Hot demand (demand=='Very High'),
  Vibrant lifestyle (Lifestyle>=8.7); first 5.
- **Live inventory bridge:** loads approved listings, indexes by `localitySlug` into
  `{count, from(min price), buy, rent}`; the KPI/CTA cards deep-link into `/listings`.
- **Emerging locality panel:** a registry-only locality with no `LOC` dashboard renders
  `EmergingPanel` instead of mislabeling Baner's data. It shows the 3 nearest covered localities by
  **haversine distance** (`haversineKm`) as an honest benchmark proxy, plus live inventory, map,
  societies and reviews for that area.
- **Local societies bridge:** `allSocieties().filter(localitySlug === activeSlug).slice(0,6)` feeds
  `SocietiesBlock` (society-first discovery into the Hub).
- **Locality alert (`setLocalityAlert`):** reuses `buildAlertRecord` + `addSavedSearch` (the listings
  alert layer) so it lands in the dashboard Alerts panel; sign-in gated.

### 5.8 Must move server-side
- Society/locality identity resolution, merge redirects, tier/verified derivation, claim & resident
  uniqueness, sign-in / resident-OTP gating, and all price/yield/trend math. The client currently computes
  ratings blends, yields and trends and enforces gates over editable localStorage.

## 6. Maker-checker / approval
Applicable - multiple maker-checker loops all following
[`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2:
- **Society claim:** maker = resident/committee; checker = ops/admin. Approval side-effect: claimant
  becomes society admin (`claimStatus:'claimed'`).
- **Resident verification:** maker = resident (flat + OTP); checker = society committee (if claimed)
  or ops. Approval grants the Resident badge and posting rights; enforces flat uniqueness.
- **Detail suggestion:** maker = any signed-in user; checker = ops (`applySocietySuggestion` ->
  confirmed overlay) or dismiss.
- **Community society verification & merge:** maker = supply/demand auto-mint; checker = ops
  (`verifyCommunitySociety`, `mergeSocieties`).
- **WhatsApp link / location correction:** maker = verified resident; checker = ops (pending until
  approved).
- **Content reports:** maker = any signed-in (L1) user; checker = ops moderation queue.

## 7. State machine
```
Community society:   minted(community) --ops verify--> verified   (--ops merge--> redirected to canonical)
Society claim:       (none) --request--> pending --ops--> approved(=> admin) | rejected/cleared
Resident request:    (none) --request(OTP)--> pending [flagged:conflict?] --committee/ops--> verified | rejected
                       verified refused if unit already held by another mobile (conflict)
Detail suggestion:   (none) --suggest--> pending --ops--> applied(overlay) | dismissed
WhatsApp / location: (none) --propose--> pending --ops--> approved(live) | (stays pending)
```
- Terminal: `verified` (society/resident), `approved`/`claimed` (claim), `applied`/`dismissed`
  (suggestion), merged (society, redirected forever unless ops re-point).

## 8. Edge cases, validation & error states
- **Unknown slug:** `resolveSociety` misses -> `genericSociety(slug, name, loc)`; hub hides homes &
  location tabs and shows a thin/add-details state. The placeholder carries **no** specs, no
  `registration`/`conveyance` and no coordinates, so it takes the `_thin` branch: it never claims a
  builder, a unit count, a "Society Verified" badge or an estimated rating for a building nobody has
  confirmed exists. (It used to carry a full set of invented defaults and therefore rendered as a
  verified, rated society.)
- **Thin / community society:** never fabricate specs; show "Details not confirmed yet" (unverified)
  or "Full details coming soon" (verified-but-sparse); a pending suggestion shows "Details submitted
  - pending review".
- **Empty states:** Societies index "No societies match your filters" with reset; Society homes tab
  hidden when 0 listings; Locality inventory bar handles a locality with no live listings.
- **Not signed in:** review/Q&A/contribution/follow/alert actions bounce to sign-in
  (`/signin?next=...`); once signed in (L1) they proceed — there is no Aadhaar step.
- **Resident flat conflict:** live warning while typing (`unitTaken`), server refusal on
  verify (`'conflict'`).
- **Claim contention:** a second user's claim on an already pending/approved society returns
  `'exists'` (toast: already under review).
- **Validation:** claim needs name + 10-digit mobile; resident needs flat + 6-digit OTP; WhatsApp
  link must match `https://chat.whatsapp.com/...` (`badurl`); location pin must be within city bounds
  (`bounds`); search inputs capped (60 chars index, name maxlength).
- **Merged society:** all lookups redirect; followers and Q&A are folded into the canonical row.
