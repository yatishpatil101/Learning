# Flow: Search & Listings (Buy / Rent discovery)

> The core discovery surface: a filterable, sortable, paginated grid/list/map of properties.
> Filtering, ranking and paging are **server-side** (`GET /properties` + `ListingFacets`); the
> browser owns the controls, the URL round-trip and the presentation.
> **Status:** documented from React source - **Primary role(s):** buyer / tenant (public, no auth required to browse)

---

## 1. Purpose & user problem
- **Persona:** buyers and tenants browsing Pune inventory; anyone (no sign-in required to search).
- **Job-to-be-done:** "Narrow the whole city down to the handful of homes that fit my deal type,
  budget, area, configuration and trust bar - and let me share or save that search."
- **Why it matters:** this is the primary funnel entry. Every filter, the URL round-trip, the
  relevance ranking and the empty-state recovery exist to keep a searcher from bouncing.

## 2. Entry points
- **Route:** `/listings` (`src/pages/consumer/Listings.jsx`).
- **URL params (all round-trip through the address bar):**
  `deal` (`rent`|`buy`), `ptype`/`type` (csv type keys, legacy alias), `ctype` (commercial
  subtypes), `loc`/`locality` (locality slugs), `soc` (society slugs), `bhk`, `furn`, `amen`,
  `v` (verification flags), `sharing`, `room`, `tenants`, `landuse`, `constr`, `avail`, `availfrom`,
  `pets`, `budget`, `rent`, `area`, `age`, `floor`, `near`/`nearlabel`/`nearr`/`nearmode`,
  `q` (text), `sort`, `view` (`grid`|`list`|`map`), `property` (open card).
- **Triggers:** hero search, home category tiles, locality/society pages, `alerts`-reason sign-in
  returns, and deep links from anywhere. Flatmates is reached from its own permanent slot in the
  mobile bottom nav - the old "Looking to share? Browse flatmates & rooms" pill on the Rent tab was
  removed as a second entry point to a destination already one tap away, which also pushed the first
  result card below the fold. A flatmates cross-sell card still renders inside the results list, but
  only when `deal === 'rent'` **and** the `flatmates` type filter is selected.
- **Source components:** `Listings.jsx` (container) + `src/pages/consumer/listings/`:
  `useListingsSearch.js`, `matchers.js`, `Filters.jsx` (+ `filtersPanel/*`), `FilterControls.jsx`,
  `ResultsArea.jsx`, `Card.jsx`, `DealToggle.jsx`, `MobileFilterDrawer.jsx`, `MapGate.jsx`,
  `NotifyMeCard.jsx`, `constants.js`, `listingsChips.js`, `listingsSmartQuery.js`,
  `alertCriteria.js`, `format.js`, `geo.js`.
  The search vocabulary itself lives **outside the page**, in `src/lib/listings/`
  (`filterState.js`, `filterRelevance.js`, `facetQuery.js`, `facetMatch.js`, `facetRank.js`,
  `enrichRent.js`) because the mock provider has to speak it too and a service must not import
  from a page directory.
- **Mobile filter FAB:** filtering is the most-repeated action in the search journey, but the
  controls bar is pinned to the top of the page - the hardest place to reach one-handed. A `lg:hidden`
  fixed pill duplicates the action into the thumb arc, docked above `--pn-bottom-inset` so it clears
  the bottom nav, and carries a count badge when filters are active. It is anchored **bottom-left**
  because the Nestor assistant FAB owns bottom-right and was literally intercepting taps there.

## 3. Actors & roles
- **Public:** anyone can browse, filter, sort and page. No `ProtectedRoute`.
- **Auth-gated sub-actions:** saving a search / alert requires sign-in (bounces to
  `/signin?reason=alerts`), because alerts are keyed by mobile and live in the login-only dashboard.
  Opening a property and requesting contact have their own gates (see
  [property-detail.md](./property-detail.md) and [contact-gate-leads.md](./contact-gate-leads.md)).
- **Map view** is behind the `mapSearch` app flag (`AppFlagRoute`-style `flagEnabled('mapSearch')`).

## 4. Entities touched
- [`properties`](../../system/data-model.md) - read-only; only `status === 'approved'` and the
  active `deal` are shown to searchers.
- [`localities`](../../system/data-model.md) - read for filter options and map focus.
- [`societies`](../../system/data-model.md) - read for the society filter (`societyForListing`).
- [`saved_searches`](../../system/data-model.md) - created by "Save search" (`addSavedSearch`).
- Passive analytics: `logSearchIntent(...)` records `{ locality, deal, bhk, userId }` on filter
  change (demand signal, not a core entity).

## 5. Business rules & logic  *(the meat)*

### Data load
- **A page of results is a request.** `useListingsSearch` sends `toFacetQuery(filters, { sort, q })`
  to `GET /properties` and renders exactly what comes back. The page used to fetch the first 100
  listings once and do everything else in the browser, which quietly made every filter mean "of the
  first 100": the result count and the "N verified" beside it described a page while reading as
  facts about the catalogue, and page 12 of a Baner search was unreachable because the catalogue was
  cut off long before Baner ran out.
- **The locality registry is still read up front** (`listLocalities()`), merged with the full
  canonical registry (`allLocalities()`) so any Pune locality is filterable even without the Maps
  SDK, and used for chip labels and map focus.
- **City awareness:** only Pune has inventory (`cityHasData(city)`); a data-less "live" city shows
  `NewCityEmptyState` instead of mislabelled Pune listings, and suspends the request entirely.
- **Races:** a refinement typed through on the way to a narrower search can outlive it, so only the
  most recent request may write state. Without that, the results shown are whichever request the
  network happened to finish last.

### Deal resolution
- Explicit `?deal=rent|buy` always wins. Otherwise share-only signals (types `flatmates`/`pg`, or
  `?sharing=`) default to **rent**; everything else defaults to **buy**. Switching deal resets to
  that deal's default filter set (`INITIAL(deal)`), sort `relevance`, page 1 (the two journeys have
  different filter shapes).

### The filter vocabulary (`toFacetQuery` in `lib/listings/facetQuery.js`)
The filter state is translated once into a wire query and answered by `ListingFacets` +
`PropertySpecs` server-side. Mock mode answers the **same query** through `matchesFacetQuery`
(`lib/listings/facetMatch.js`), so the mock is a fake of the endpoint rather than a second
implementation of the page - which is what let the two modes drift in the first place.

Axes, and the column each resolves to:
1. **Base:** `deal` + `status = 'approved'` (the approved floor is the provider's, mirroring the
   server; it is not a facet a caller can turn off).
2. **Text (`q`, from `?q=`/`?locality=`):** `title`, `locality`, `localitySlug`.
3. **Price:** `minPrice`/`maxPrice` - top-level params, *not* members of `ListingFacets`. A thumb
   parked at the default ceiling means "and above", so high-value stock is not hidden.
4. **Type:** an **OR across two columns**, not an `IN` on one. `pg`/`flatmates` resolve against
   `share_type` (V100); every other chip resolves against `property_type_key` (V98) **and**
   requires `share_type IS NULL`, so a PG posted as "Flat" no longer appears under the Flat chip.
   PG and Shared Room are two different products - a PG rents a bed at a stated occupancy, a shared
   room is one person's room in someone else's flat - and each carries its own sub-filter (PG
   occupancy `single..dorm`; flatmate room type `single|shared`). Both narrow honestly here, against
   disjoint sets. What this page **cannot** claim for shared rooms is completeness: `/flatmates`
   also carries flatmate *requests*, which are people rather than listings; that gap is disclosed by
   the cross-sell card rather than by silently widening the search.
5. **Commercial subtype:** `commercial_use_key` (V99).
6. **Sharing (PG occupancy)**, **room type**, **land use**, **BHK** (`3plus` -> `>=3`, `5` -> `>=5`,
   `0` -> RK/studio), **furnishing**, **localities** (`locality_slug`), **societies**
   (`society_slug`; an unbound listing matches no society filter rather than a hashed guess - D19).
7. **Area**, **amenities** (must contain ALL selected - an AND, unlike every other multi-select),
   **verification flags** (`ownerVerified`, `ownershipVerified`, `rera`, `societyVerified`,
   `conveyanceDone`). Ownership verification **lapses**: the facet, the count and the badge all
   read the same live expression, so a listing whose verification has expired disappears from the
   filter rather than keeping a badge it no longer earns.
8. **Construction / availability**, **age**, **floor**, **pets**, **tenant preference**,
   **availability window** (`now`/`15`/`30`, cumulative).
9. **Near-a-place:** `nearLat`/`nearLng`/`nearRadiusKm`; radius is `nearRadius` km, or
   `nearRadius * 0.4` km when `nearMode === 'min'` (minutes-to-km heuristic).
- **Relevance-gated filters:** each optional filter is wrapped in `rel(section)`
  (`sectionVisible`), so a filter hidden as irrelevant for the current property types never narrows
  results.

**Where the browser and the server disagreed, the server wins** - these are behaviour changes, not
implementation details:
- An **unstated** value is excluded from a narrowed range rather than coerced to zero. An unknown
  age used to read as "brand new".
- **"Under Construction" excludes unstated possession**, because SQL `IN` never matches NULL.
- A **tenant filter excludes listings that state no preference**, the same way the pets and move-in
  filters always have. Ticking "family" asks for owners who said yes to families, and an owner who
  never answered has not said it. The server briefly admitted them; that rule never reached a user,
  because the browser was still doing the filtering at the time, and it is gone from both sides now.
- A **radius search needs real coordinates**, and every listing now carries them. Live rows have
  `lat`/`lng` in the database; the mock stamps the same pair onto seed rows once, at its read
  boundary (`lib/listings/coords.js`), from the listing's own locality centre plus an offset derived
  from its id. The map used to compute a position at render time instead - a number the server
  cannot compare against, so "within 2 km" was being answered by a hash of the listing id, and the
  pin was drawn somewhere the listing never claimed to be. One stored pair means the map, the
  filter and the distance label cannot disagree.

### Sorting
- `relevance` (default), `price-low`, `price-high`, `newest`. Only the two price orders travel as a
  `sort` param; `relevance` and `newest` are **rankings**, and an explicit sort disables ranking
  server-side (`PropertySort.hasExplicitSort`).
- **Relevance score** = featured (+1000) + ownerVerified (+250) + ownershipVerified (+200) +
  RERA (+80) + freshness weight (`active` 200 / `aging` 120 / `stale` 40 / `dormant` 0) +
  `computeQualityScore(p)` (photos/description/amenities completeness). Ties break on newest.
  `lib/listings/facetRank.js` mirrors `PropertySpecs.relevanceFirst` weight for weight.
  The +200 is earned by **live** ownership verification, the same reading the facet, the
  `verifiedElements` count and the badge on the card use - a lapsed verification stops promoting a
  listing at the moment it stops showing the badge.
- **Paid placement applies to the two rankings only, never to an explicit price sort.** Ranking a
  promoted listing above one the buyer asked to see first is deception rather than advertising.

### Empty-state recovery (near vs locality contradiction)
- If `near` + `localities` are both set and the primary result is empty, the page issues a **second
  request** with the locality constraint dropped; if that yields results it shows them plus a
  `relaxedNear` banner ("no exact matches in X - showing homes near Y"). Only fires on the genuine
  contradiction, so an ordinary search is never quietly widened underneath the user.

### Pagination & views
- **Grid/list:** real server pages, `PAGE_SIZE = 24`; the page resets to 1 when the *search* changes,
  during render rather than in an effect, so the request for page 7 of the old search is never sent.
- **The count line is a server count.** `total` and `verifiedCount` come off the response
  (`totalElements` / `verifiedElements`) because neither can be recovered from a page - counting the
  badges on screen would answer "how many of these 24" while reading as "how many in Baner".
- **Map:** "area-first" - gated until the user focuses 1..`MAP_MAX_AREAS` (5) localities, then asks
  for at most `MAP_MARKER_CAP` (100) pins in a single request. While gated, no request is made at
  all. Uses locality registry centres for focus. 100 is the server's own ceiling
  (`spring.data.web.pageable.max-page-size`), not a taste judgement: asking for more is silently
  clamped, which would leave the "showing the first N" note quoting a number of pins nobody drew.
- **Map fallback:** a `view=map` deep link with `mapSearch` off falls back to grid + a note.

### URL <-> state sync (`lib/listings/filterState.js`)
- `paramsToFilters` builds initial state from the URL (understands legacy `?type=`/`?locality=`,
  cross-deal BHK normalisation via `normBhk`). `applyFiltersToSearchParams` clears all managed keys
  then writes only non-default filters, so the address bar carries only what the user narrowed. A
  search is therefore shareable, refresh-safe and back-button-safe.

### Save search / smart search
- **Save search:** requires sign-in (else `/signin?reason=alerts`). Builds an alert record
  (`buildAlertRecord`) and `addSavedSearch(...)`; a typed query is parsed first so the label and
  criteria agree.
- **Smart search (`parseSmartQuery`):** parses a free-text box into a filter set + deal, applies it,
  and toasts the parsed parts.

## 6. Maker-checker / approval
- **Not applicable to search itself.** Search only ever *reads* `status === 'approved'` listings.
  The approval that put a listing into the searchable set is the listing-verification maker-checker
  documented once in [`../../system/cross-cutting.md`](../../system/cross-cutting.md) (section 2.3):
  owner submits -> admin/manager approves -> `status: approved` -> it appears here.

## 7. State machine
Search has no persistent record; the "state" is the filter object + view + sort + page, all mirrored
to the URL:
```
grid (default) <-> list <-> map(gated: needs 1..5 focused localities)
   ^ any filter/sort/text change -> page resets to 1
   ^ deal switch -> INITIAL(deal), sort=relevance, page=1
```
A listing's own lifecycle (pending -> approved -> flagged/archived) is what makes it enter/leave the
result set; see cross-cutting soft-delete/status (section 4).

## 8. Edge cases, validation & error states
- **Loading:** skeleton cards (6) until `loaded`; count line shows a spinner + "Searching...".
- **Empty (0 results):** "No properties found" with one-tap **broadeners** for whichever narrowing
  filters are active (clear localities, reset rent/budget, any BHK, any type) plus a "Clear all
  filters" button and a `NotifyMeCard` (create an alert instead).
- **Sparse (<3 results):** still shows a `NotifyMeCard` nudge.
- **Relaxed-near banner:** shown when localities were dropped to recover results (with a "keep
  showing near X" action).
- **Map gated:** `MapGate` prompts the user to pick 1..5 localities; **map capped:** an amber note
  when `total > markers shown` (100 cap).
- **Map unavailable:** info note when `view=map` but `mapSearch` flag is off.
- **New/empty city:** `NewCityEmptyState` instead of results.
- **Dormant listings:** the search endpoint hides dormant real posts from public results
  (anti-staleness); seed/demo stock stays visible.
- **Range "and above":** default-ceiling thumbs are treated as no upper bound (`openHi`), avoiding
  silently hidden high-value listings.
