# Flow: Societies & Localities

> How buyers/tenants discover Pune residential societies and localities, read curated + community
> intelligence, follow/alert on them, contribute content, and how residents claim & manage a society
> (the Society-OS SaaS surface).
> Under **badge-not-gate (ADR-019)** the only floor is **L1 mobile sign-in**: any signed-in user can
> add/upvote community info — **no identity check**. Posting notices is limited to a **verified resident**,
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
  identity verification - section 5).
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
  (`dzSocietyOverlay`) on ops verify / applied suggestion / claim decision.
- **Locality** - canonical registry (`src/data/localities.js`, `LOCALITIES`) + curated intelligence
  (`src/data/localityIntel.js`, `LOC`, 10 fully-covered localities). **Read** only in these pages
  (community localities are minted elsewhere).
- **Society overlay / claim / resident / suggestion / merge** - localStorage records written by
  `src/lib/store/societyAdmin.js` (`dzSocietyOverlay`, `dzSocietyClaims`, `dzSocietyResidents`,
  `dzSocietySuggestions`, `dzSocietyMerges`). Created/updated here (maker side), decided by ops.
- **Reviews & Q&A** - `getEntityReviews/addEntityReview('society'|'locality', id)`, `getSocietyQA` /
  `addSocietyQuestion` / `addSocietyAnswer`.
- **Follows** - `context/FollowContext.jsx`, over `societyService.listFollowedSocieties` /
  `followSociety` / `unfollowSociety`. Server-backed since **D227**: `PUT`/`DELETE
  /me/societies/{slug}/follow` and `GET /me/societies/following`, with `dzFollowedSocieties` now
  only the mock provider's backing store.

  Before D227 this was that localStorage array read directly by five surfaces, so following on a
  laptop did not follow on a phone and the Hub's follower count - which the server computes from
  `society_follows` - counted nobody, because nothing ever wrote a row. The five could not be ported
  one at a time: `followedByMe` on a page of societies could have carried the directory alone, but
  the dashboard tile, the followed-societies panel and the finder ask *which* societies with no page
  to hang the question on, which is why `GET /me/societies/following` had to be built first.

  The set is held once for the app rather than read per row - the finder asks membership once per
  search result and the directory once per card, which against a real API is a request per row.
  Writes are optimistic and roll back on failure, and `toggle` returns the state it **settled** on,
  so a toast reports what happened rather than what was attempted.

  Follows on societies **this browser minted** stay local (`dzLocalSocietyFollows`): the server
  refuses a follow on a slug it has never heard of, correctly, since it will not write a dangling
  foreign key. The context retries them on every load, so the follow lands by itself the day ops
  promote the slug.
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
- **`managed` / claimed:** `claimStatus === 'claimed'` (a "Managed on Draazy" badge). Derived in
  `resolveSociety`: an approved claim -> `claimed`, a pending claim -> `pending`, else overlay/base.
- **`_thin`** = a community/demand row with no `units` and no `builder`: the hub must NOT fabricate
  specs; it shows an honest "add details" / "help verify" panel instead.

### 5.2 Society -> listing binding (`societyForListing`)
**A binding is a fact or it is nothing (D19).** `societySlug` first (the server's `@Formula` over
`societies.slug`), then `societyId`, then **null**. There is no fallback: this function used to
answer `pool[fnvHash(listing.id) % pool.length]` over the locality's societies, which is wrong for
all but one listing in a pool-sized group by construction, and the property page printed the chosen
building's builder, towers, units, year and occupancy as if they described the home. Callers must
handle null - the property page's Society section renders **nothing at all** when unbound, because a
heading over a generic "Building" still asserts membership. `listingsInSociety(listings, socId)`
filters listings whose bound society id matches, so an unbound listing counts towards no hub.

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
  candidate (`source: 'demand'`), then the page follows it through `FollowContext` and navigates to
  its Hub. Requires sign-in.

  The follow used to happen inside `mintDemandSociety`, straight into localStorage - fine while
  follows were a browser array, wrong the moment they became rows (D227). The society exists only in
  this browser, so the server 404s the follow; only the context knows to hold it locally and retry
  it later.
- **Paging:** client-side `limit` starts 24, "Show more" adds 24; resets on any filter change.

### 5.4 Society Hub ratings & stats (`useSocietyHub.js`)
- **`getEntityReviewSummary('society', slug)`** gives real resident-review `{ avg, count, catAvg }`.
- **Residents only — there is no estimate.** Until D197 (2026-08-11) a deterministic `baselineBars(soc)`
  was blended 50/50 into both the bars and the headline for any society that was neither `_thin` nor
  `_community` — i.e. the whole curated directory — so an unrated society drew five confident scores
  and a rated one had its residents' average diluted by fiction while labelled `(N)`. Both are gone.
  - Per-category bars: `bar[k] = catAvg[k]` for the aspects present in `catAvg`, and nothing for the
    rest. `catAvg` is sparse by contract (an aspect nobody rated is absent, not 0), so a partly
    rated society draws a partial grid; each cell carries its own label, so three bars read as three
    aspects rather than as a total.
  - **Overall:** `count ? rating.avg : null`. `null` is a signal, not a defence — `Stars` does
    `Math.round(Number(value) || 0)`, so `null` and `0` draw the same empty strip; what keeps either
    off the page is that both call sites branch on `rating.count` first. `null` exists so a caller
    that forgets the branch fails loudly rather than printing a confident "0/5".
  - **Where "Not rated yet" appears:** the hero on `Society.jsx` only. The Reviews tab renders
    *nothing* at the aggregate slot when `rating.count` is 0 and leaves the explaining to the
    empty-list line (`society.noReviewsYet`), which is gated on `reviews.length` — a different read.
    A spec looking for "Not rated yet" scoped to the Reviews tab will time out.
  - **Loading and failure are their own branches** in both surfaces, above the unrated one, so a
    summary that failed to load can never read as "nobody has rated it".
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
  **reviews, Q&A, contributions (tip/pick/photo), replies, helpful votes, reports**. (No identity
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
  (`/signin?next=...`); once signed in (L1) they proceed — there is no verification step.
- **Resident flat conflict:** live warning while typing (`unitTaken`), server refusal on
  verify (`'conflict'`).
- **Claim contention:** a second user's claim on an already pending/approved society returns
  `'exists'` (toast: already under review).
- **Validation:** claim needs name + 10-digit mobile; resident needs flat + 6-digit OTP; WhatsApp
  link must match `https://chat.whatsapp.com/...` (`badurl`); location pin must be within city bounds
  (`bounds`); search inputs capped (60 chars index, name maxlength).
- **Merged society:** all lookups redirect; followers and Q&A are folded into the canonical row.

## 9. Backend society reads

Relocated from code comments in `catalog/society/` so the reasoning survives without a
multi-paragraph docblock per method.

### 9.1 The merge family is the unit of aggregation

A merge moves nothing: a listing filed under the duplicate keeps pointing at the duplicate. Every
aggregate on the directory and the hub is therefore taken over the society **and everything merged
into it**, because a merge that hid the duplicate without consolidating it would leave the
building's listings, followers and reviews split across two rows, one of which is invisible.

`SocietyService.families` resolves that in one query for the whole page, served by the partial
`idx_society_merged_into`, so it costs a lookup into the tens of merged rows however large the
catalogue grows. Asking per row would put an N+1 on `GET /societies`, which is unauthenticated and
therefore an N+1 anybody can trigger for free. The survivor is always the first entry and an
unmerged society gets a list of exactly itself, so the aggregate code has one shape rather than a
merged and an unmerged one.

A slug an operator merged away **resolves rather than 404ing**, and the response carries the
survivor's slug so a client knows to canonicalise its own URL. The merged-away slug is in Google's
index, in shared links, in the `society` field of every listing filed under it, and in every alert
somebody set on it.

A merge is **reversible**, which is the reason nothing is moved or deleted: `DELETE
/admin/society-merges/{slug}` takes `merged_into`, `merged_at` and `merged_by` back to null. Because
an undo erases its own evidence, both directions are written to `audit_log` — unlike the sibling
society queues, whose outcome stays legible on the row. Chains are refused in both directions:
collapsing an intermediate hop could not be undone, since the middle of it would be gone.

### 9.2 Page-scoped aggregates, never per-row

`browse` and `summarise` cost six queries for any page size: the page, the merge lookup, the grouped
listing counts, the grouped follower counts, the grouped rating aggregates, and - only when somebody
is signed in - which of the page's societies they follow. The naive shape asks each of those once per
row, which on an unauthenticated endpoint is a denial-of-service a client can trigger for free. The
standing risk on this surface is not leakage (nothing here is private) but cost.

The rating is resolved for the directory, not only the hub, because the cards render it: resolving
per card would be one request per row from the browser as well as one query per row on the server.

`summarise` is extracted from `browse` so the follow list (`GET /me/societies/following`) renders
identical cards; a second assembly in the Engagement slice would drift silently, and a society would
show a different follower count depending on which screen you found it on. The caller supplies the
order and `summarise` preserves it, because a follow list is ordered by when you followed - a fact
that class cannot see.

Empty id lists short-circuit before hitting the repository: an `IN ()` is not SQL.

### 9.3 Ratings over a merged family

`combinedRating` is weighted by how many reviews each row's average was over, not a plain mean of
the two averages - which would let a duplicate carrying one five-star review drag a survivor's
3.9-from-two-hundred up to 4.45. The arithmetic is the same as if every review had been written
against one society, which is the claim a merge makes.

The single-society case returns the stored aggregate untouched, so no unmerged card's star moves by
a decimal because of a feature it is not using.

Null is not zero: `RatingLookup.forSocieties` omits unrated societies precisely so an unrated
building stays a null average rather than a `0.0` the card would render as a one-star society.

### 9.4 `hasListings` - the home rail's `EXISTS`

The home page's society rail shows eight cards. Without this filter it reads the entire directory to
choose them - four pages of a hundred, ~268 kB, on the critical path of the entry route, so a
client-side sort can discard 340 of the 350 rows it was just sent.

- **`EXISTS`, not a count.** Postgres stops at the first matching row and "at least one" is all the
  predicate means. Ranking *within* the survivors stays the client's job, because "strongest" mixes
  the verification badge with the listing count and only the first of those is a column.
- **Live means what it means everywhere else** - approved and unarchived, the same pair
  `ListingCounts` groups on and `Property.isPubliclyVisible` enforces. Counting pending or archived
  rows would put a society on the home page whose listings a visitor cannot open.
- **`FALSE` is deliberately not the inverse.** "Societies with no listings" is an ops question, and
  answering it here hands an anonymous caller a cheap way to enumerate the quiet half of the
  catalogue.
- **The subquery's second root is the merge family, and it is load-bearing.** Correlating on
  `society.id` alone would make the rail and the card disagree: a survivor whose live listings all
  sit under a merged-away duplicate would render a card saying it has homes and be excluded from the
  rail that shows them, with nothing erroring.

### 9.5 `SocietySpecs.browse` constraints

- Societies an operator merged away are excluded, and that is deliberately not a caller-supplied
  flag: leaving the duplicate listable means two cards for one building, splitting its listings,
  followers and reviews across both - the state the merge exists to fix. The cost is that somebody
  typing the merged-away spelling gets no result rather than the survivor, which is bounded because
  the survivor carries the canonical name and merged duplicates usually differ only by a typo or a
  phase suffix.
- The text match is a leading-wildcard `LIKE`, which no btree index can serve. That is acceptable
  here and only here: `societies` is a curated directory in the thousands of rows, the scan is
  bounded by the page-size cap, and the alternative - a trigram index or a full-text column - is a
  schema change this slice does not need. **If the RERA bulk import (~320k statewide records) is
  ever loaded, this becomes a `pg_trgm` index instead**; that is the trigger to watch for.
- **For `findAll` only, never delete-by-Specification.** The `hasListings` branch builds a subquery
  off the `CriteriaQuery` it is handed, and `SimpleJpaRepository.delete(Specification)` builds a
  `CriteriaDelete` and passes `null` there. Guarding that with an always-true predicate would be
  worse than the NPE: a delete would silently widen to the whole directory.

### 9.6 The hub's own bounds

`homes` is capped at 50. A society with hundreds of live listings is a page nobody scrolls to the
end of, and an uncapped array would make the largest society the cheapest way to make the server do
the most work. `reviews` stays empty because the contract serves a society's reviews from the paged
`GET /reviews/society/{slug}`, and inlining an unbounded array would undo that.

`POST /societies` answers **201** for a new society and **200** when the name already matches one,
handing back the canonical row either way. The distinction is what lets the screen say "Added" or
"Already on Draazy"; collapsing it would tell somebody they had just added a society that has
existed for two years. Signing in is required because the row records who added it, which is what an
operator reviewing the queue needs in order to ask, and what makes one account minting fifty
societies visible rather than merely suspected.

## The society seam (`societyService.js`, `providers/http/societyProvider.js`)

**Societies join on `slug`, never on `id`.** `id` is a synthetic `S01` minted by `data/societies.js`
that the server has never seen, and the server keys societies by UUID. The type-ahead still carries
whatever the answering mode calls a society's id, but only because the listing wizard binds a
`societyId` into its form; everything else joins on the slug.

**Ratings are an index keyed by slug**, not a per-society read, so no caller ends up in a `.map()`
issuing one request per row. `avg` is `null`, never `0` — branch on `count`, because a `0` renders as
a one-star society, and `Number(null)` is the one transformation that turns "nobody has rated this"
into "everybody rated it one star". A slug absent from the index means "this reader has no opinion",
which is not the same as unrated. Rows without a slug are skipped rather than indexed under
`undefined`, which would make one membership check answer true for every unnamed society.

**Ordering, the geo blacklist and the cap live in the service, not the provider**, so a picker
cannot rank differently per mode; the pass is idempotent, which is what lets an already-ranked list
through unchanged. Ordering is verified first, then a locality match, then alphabetical, where
"verified" means a registration and a conveyance on file and a community-added society is never
verified whatever its own row claims. `GET /societies` does not honour the admin geo blacklist, so
that is a presentation filter — the directory is not its enforcement point.

**The locality is deliberately not sent to the type-ahead.** `GET /societies?locality=` is a hard
filter, and to this picker a locality is a *preference*: the wizard offers societies outside the
chosen area ranked below the ones inside it, because a user who picked the wrong locality first
should still find their building rather than be told it does not exist. Sending the parameter would
turn that ranking into an exclusion and quietly delete the rows it was meant to demote. The provider
asks for 60 candidates rather than the 20 the picker shows, because the ordering the user sees is
not the server's: asking for exactly 20 would let the server's own sort decide which 20 were
eligible for the re-rank, so a verified match sitting 25th by name would never surface. The six
projected fields are a projection on purpose — `SocietyResponse` carries twenty-odd, and a picker
that could reach them would grow a dependency on data another mode does not return.

**The hub reads `GET /societies/{slug}`, not a `q=` search.** A directory read matches on text and
would answer with a *near* society, which on a page rendering one building's registration,
conveyance and claim status is worse than answering with nothing. A 404 becomes `null` — the hub is
reachable from a typed URL and from links minted before a merge, and it has an honest rendering for
that — while every other failure propagates, because "the server is down" and "that building does
not exist" must not read the same on screen.

**The back office reads the public `GET /societies` rather than an `/admin/societies` list.** Every
column the console renders is already on `SocietyResponse` and `q`/`locality` already filter it, so
a second listing route would be a second set of filters to keep in step for no reader who lacks one.
The consequence to know: a merged-away society is absent (the spec filters `mergedInto is null`),
which is correct, and the row carries `followedByMe`/`avgRating` the console ignores. No `sort` is
exposed — `SocietySort`'s whitelist is not backed by indexes, and api-standards.md §5 forbids
exposing a sort the schema cannot serve.

**Follows come in two operations on purpose.** `listFollowedSocieties` narrows to slugs for
`FollowContext`, which is mounted app-wide, answers `has(slug)` for every society card on every page
from memory, and must not hold up to 500 full records to compute a set of strings; the slugs also
resolve through the local catalogue for the synthetic `S01` id that `listingsInSociety` joins on,
where a server UUID would match no listings. `listFollowedSocietyRows` returns whole rows for the
dashboard panel that has to *draw* the list. The alternative — mapping `getSociety` over the slugs —
is one request per followed society to draw a name and a locality this endpoint already sends. A
followed slug the reader cannot resolve is **absent** rather than present as a stub, so `length` may
be smaller than the follow count. Both reads use `unwrapFullPage`: a follow set that outgrew one
page would otherwise show as unfollowed, which looks like the user never followed them.

**One read for four facts.** `getSocietyMembership` answers the caller's own residency request,
whether they are the committee, the society's live claim, and how many residents are verified,
because the hub takes all four rendering decisions at once and three reads would flicker controls
into and out of existence as they landed. It is safe signed out — `resident: null`, `admin: false`,
the society's own facts still arrive — which is what lets the "claim this society" invitation render
on first paint. The claim never carries the claimant's mobile or email here: the surface is public,
and who claimed a society must not be a way to lift a committee member's number off a page anybody
can load. Those fields *are* populated on the ops queue, because deciding a claim means phoning the
person who filed it.

**Residency.** Requesting again amends the standing request rather than queueing a second, so a
caller may treat it as "save my flat" and render whatever comes back; a 409 means the caller is
already verified in a *different* flat, which is a move and needs the committee. Deciding answers
409 when another resident already holds that flat — reject them first, because a handover is a
decision, not a race. The queue carries the applicant's name and mobile deliberately: the question
being answered is "does this person live in B/704". A resident who is not the committee gets a 403 —
living somewhere is not a licence to read every neighbour's number.

**Claims.** Approval is what makes the claimant the society's reviewer; there is no separate
committee-members table, so the approved claimant *is* the society admin, granted in the same
transaction as the decision. Ops decisions are keyed by the **claim's id, not the society slug**,
because the server keeps every claim ever filed, so "the claim for Kumar Prospera" does not name a
unique row once a second committee asks or the first re-files after a rejection. An already-decided
claim answers 409 rather than being rewritten — a second decision would either revoke authority
silently or re-grant it to somebody who was told they were rejected.

**The registration certificate is fetched on click, never with the queue.** The queue pages at
twenty and the certificate is opened on a small minority of rows, so folding the link in would mint
twenty signed URLs to serve the one that gets used — and drop a live capability on twenty people's
vault documents into a response the browser caches. It is keyed by the claim, not the document: the
certificate sits in the claimant's personal vault beside their identity and salary documents, so there is
deliberately no "fetch document X" staff route, and the server resolves the document id off the
claim row and re-checks it belongs to the filer. Unknown claim, no certificate, and a pointer that
no longer resolves are one 404 on purpose — telling them apart would confirm that a document exists
and is being withheld. The URL expires in minutes and must not be stored or shared.

**Q&A, board and contributions are public reads.** The person with the most to ask about a building
has not moved into it yet, and a Q&A only residents can read cannot help the person it exists for;
an active noticeboard is the most honest signal a society hub can give somebody deciding where to
live. `authorIsResident` is recomputed on every read rather than stored, so a rejected resident's
old answers stop wearing the badge. `canRemove` is per-viewer and computed server-side, so the hub
draws a delete control only where one would work. `referralContact` is null for a signed-out reader —
it is a third party's phone number. Answering through the wrong society's URL is refused rather than
orphaned, because such an answer would be invisible. The board sorts dated events by when they
happen and then undated notices newest first, because one ordering would bury next week's AGM under
a notice about the lift; `eventDate` is required for an event and dropped from a notice, since a
dated notice sorts into the calendar and claims to be something that happens. Residency buys posting
and contributing, never moderation — removing a reply is its own author, the committee or staff, and
deliberately *not* the author of the contribution it sits under, because owning a tip does not make
you the moderator of the conversation.

The community tab is fetched **unfiltered**: its chips show a count for every kind including the
ones you are not viewing, so a filtered read could not draw the page anyway, and a list and its
counts fetched separately are two answers free to disagree. Each contribution kind has its own
minimum — a tip needs `body`, a pick needs `referralName`, a photo needs `photoUrl` — and fields
belonging to another kind are dropped rather than refused. `photoUrl` must already be a URL from the
photo upload, never a data URI; keeping base64 in local storage is exactly why a shared photo used
to be invisible on every device except the one that shared it. Helpfulness takes the state you want
rather than a toggle, so a request retried after a dropped connection produces the state the tap
intended instead of undoing it, and answers with the new count so the button updates without
re-reading the page.

**Community pages are read whole.** There is no "load more" on a society hub, so a short read is not
a shorter list — it is a question nobody ever answers and a notice nobody sees. The same reasoning
sets the resident queue's page size (bounded by the number of flats in the building) and the ops
queues' (no pager, and the counts beside each heading are computed over whatever comes back, so a
silent 20-row cap would show "3 pending links" to an operator with thirty). `unwrapFullPage` makes
any overflow audible instead of letting the queue quietly lie.

**Proposals are one lifecycle wearing three names.** Detail suggestions, group links and pin
corrections are `kind` filters on one resource, not three queues — ask unfiltered and group
client-side, or ask three times; there is no third queue to forget. A detail suggestion is open to
any signed-in caller, because enriching a thin, bulk-imported society without first demanding
somebody verify a flat is how a community society becomes a verified one, while the invite and the
pin need a verified resident or the committee. Re-submitting corrects your own pending proposal
rather than queueing a second; somebody else's pending proposal is a 409. `getSocietyProposals` is
one read so the page cannot render half a state — a banner saying your pin correction is pending
beside a map that has already been corrected. `whatsappJoinUrl` is null for anyone without a
verified flat here, approved or not, because the invite is a key to a private resident space, while
`whatsappAvailable` still reports the group exists, which is what the "verify your flat" nudge is
drawn from. `inviteUrl` is populated on the ops queue and nowhere else — screening a link for a scam
is the point of the review, and an operator cannot screen what the response redacts. Approving
writes the value onto the society in the same transaction, and a detail suggestion is coalesced
rather than overwritten so correcting the builder does not blank a tower count somebody else
contributed.

**There is no cross-society residency decide route.** Deciding stays on `decideResidency`, addressed
by the slug every row carries: the per-society route already admits staff and already owns the
one-verified-resident-per-flat rule, and the copy the committee does not exercise daily is the one
that drifts.

**Minting.** Four screens invite somebody to add a society the catalogue lacks — the lister who
cannot find their building, the searcher who wants alerting when a flat comes up in it. The response
is the canonical society either way, so the caller's next move works against the real row rather
than a duplicate they did not know they created; `created` comes from the status code, which is the
only place the distinction lives, because nothing in the body distinguishes a society added
yesterday from one added a millisecond ago.

**Candidate review.** Confirming a member-added society records *who* confirmed it and when, and
deliberately leaves `registration` and `conveyance` alone: those describe the building's legal
paperwork, not our confidence in the record, and setting them here would quietly tell every buyer
its conveyance deed was done. A second verification answers 409 rather than silently overwriting the
first, because the record of who verified it is the only thing that says who to ask later. Duplicate
hints are drawn from the *server's* catalogue rather than the bundled one, since the duplicates this
queue produces are member-added rows and a candidate that is a textbook second copy of another
candidate must not render "No obvious match" — which an operator reads as "no duplicate exists"
before verifying the junk row into a permanent one nothing automatic can undo. They are a hint,
never an action: the merge is a separate explicit call, and what the hints buy is that the obvious
duplicate is one click away rather than one search away. They are fetched per candidate opened
rather than as a column on the queue, because the scan compares a name against the whole catalogue
and running it twenty times to render a screen where at most one row's hints are looked at is the
wrong trade. A 404 for an unknown slug is deliberate, so a stale queue says so instead of rendering
"no duplicates" for a row that no longer exists.

**Merges are pointers, not moves.** The duplicate keeps its listings, follows, reviews and claims,
and the reads union them onto the survivor — which is what makes a merge undoable, and that matters
more here than anywhere else in the console, because the input is two rows differing by a typo, so
merging the wrong pair, or the right pair the wrong way round, is a mistake that will be made. Both
slugs travel in the body because they are the two halves of one statement, not subject and object;
either in the path would read as an edit of that society. Undo is addressed by the society that was
**merged away**, not the survivor, because a survivor can have absorbed several duplicates and "undo
the merge on this society" would resolve silently to the wrong one; a slug that is not merged into
anything 404s, because the resource being deleted is the merge. Merging a society into itself is
422; either shape of chain, and losing the race to another operator on the same pair, is 409, each
naming the merge to undo first so the next action is one corrected request rather than an
investigation. The merge list is newest-first, deliberately the other way round from the four queues
beside it: those are backlogs where the oldest item is the one somebody is still waiting on, while
this is a record of decisions already taken and the one an operator comes to check is almost always
the one just made.

**The admin society view exists for `adminNote`.** The other four fields are already on the
directory row the console holds; the note is not, and is kept off the public payload on purpose,
since it is moderator prose about a named building and often about the people in it. The edit is a
`PATCH` and partial in the way a `PATCH` promises — the console happens to send all five together,
but the row carries columns this form has never shown, and sending the whole shape is how a later
screen reusing this call blanks them. `adminNote` is the one field where absent and empty differ:
`''` clears the note, `undefined` leaves it, and neither may be coalesced into the other at any
layer. A maintenance figure outside 0–100 is a 422, because the field is rupees per square foot and
the box beside it on every maintenance screen an operator has seen is the monthly bill — so the
wrong one gets typed here and quotes a flat at lakhs a month on the public hub.

**The society mapper writes fields out one by one** rather than passing the row through, because
`SocietyDetailResponse` also carries `homes` and `reviews` that the hub must read from
`propertyService` and `reviewService`; a component that could reach them here would depend on data
another mode does not return. Units match `data/societies.js` and the SQL seed exactly (`occupancy`
is 92, not 0.92; `maintenancePerSqft` is rupees), so nothing needs converting. `_thin`, `_community`
and `_generic` are deliberately not set: they are the hub's own words for what it got, and a mapper
that stamped them would decide per mode what the page may say. `verifiedAt` stays the timestamp the
server sent rather than being narrowed to a boolean — the hub's badge asks `!!soc.verifiedAt`, but
answering `true` would make the day it happened unrecoverable downstream. `listingCount` is the
server's own count of live listings summed over the merge family, and `0` there is a real zero.

**The directory is read page by page**, because it renders every society: page 0 first because it is
the only way to learn `totalPages`, the rest in parallel. The 20-page stop is a stop, not a page
size — a wrong `totalPages` would otherwise turn one page load into an unbounded request storm — and
hitting it warns, because a silently short index renders rated societies as "Not rated yet". The
listing-bearing rail asks for the server's page ceiling rather than a second smaller literal,
because the server can only narrow the population: the badge half of "strongest" is not a sortable
column, so the ordering happens client-side and the candidate set must be well above the eight it
renders.
