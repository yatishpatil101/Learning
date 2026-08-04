# Flow: Search & Listings (Buy / Rent discovery)

> The core discovery surface: a filterable, sortable, paginated grid/list/map of properties,
> computed entirely client-side over the loaded inventory.
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
  `filterState.js`, `listingsResultsPipeline.js`, `matchers.js`, `filterRelevance.js`,
  `Filters.jsx` (+ `filtersPanel/*`), `FilterControls.jsx`, `ResultsArea.jsx`, `Card.jsx`,
  `DealToggle.jsx`, `MobileFilterDrawer.jsx`, `MapGate.jsx`, `NotifyMeCard.jsx`, `constants.js`,
  `listingsChips.js`, `listingsSmartQuery.js`, `alertCriteria.js`, `format.js`, `geo.js`.
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
- On mount, `Promise.all([listProperties({ includeAllStatuses: false }, 'newest'), listLocalities()])`.
  Each property is passed through `enrichRent(p)` then `enrichWithVerification(...)`. The locality
  option list is the seed localities **merged** with the full canonical registry (`allLocalities()`)
  so any Pune locality is filterable even without the Maps SDK.
- **City awareness:** only Pune has inventory (`cityHasData(city)`); a data-less "live" city shows
  `NewCityEmptyState` instead of mislabelled Pune listings.

### Deal resolution
- Explicit `?deal=rent|buy` always wins. Otherwise share-only signals (types `flatmates`/`pg`, or
  `?sharing=`) default to **rent**; everything else defaults to **buy**. Switching deal resets to
  that deal's default filter set (`INITIAL(deal)`), sort `relevance`, page 1 (the two journeys have
  different filter shapes).

### The filter pipeline (`computeResults` in `listingsResultsPipeline.js`)
Pure function of `{ all, df (deferred filters), sort, urlQ, locNameBySlug }`. Applied in order:
1. **Base:** `p.deal === df.deal && p.status === 'approved'`.
2. **Text (`urlQ`, from `?q=`/`?locality=`):** matches `title`, `locality`, or `localitySlug`.
3. **Price:** buy uses `budget` vs `p.price`; rent uses `rent` vs `p.price`. A thumb parked at the
   default ceiling means "and above" (`openHi` -> `Infinity`) so high-value stock isn't hidden.
4. **Type:** `matchRentType` / `matchBuyType` (share-aware; PG/flatmates resolve via `shareType`).
5. **Commercial subtype:** when `commercial` is selected, `commercialTypeMatch` on `p.type`.
6. **Sharing (PG occupancy):** `offersSharing` - applied for both deals (a PG can be rented per bed
   or its building sold).
7. **Land use / zone**, **BHK** (`bhkMatch`: `3plus` -> `>=3`, `5` -> `>=5`, `0` -> RK/studio),
   **furnishing**, **localities** (by `localitySlug`), **societies** (by `societyForListing().slug`).
8. **Area** (buy only), **amenities** (must contain ALL selected), **verification flags**
   (`ownerVerified`, `ownershipVerified`, `rera`, `societyVerified`, `conveyanceDone`).
9. **Buy extras:** availability (`ready` vs not), construction status, age range, floor range.
   **Rent extras:** room type, tenant preference (any-match), availability window
   (`now`/`15`/`30`, cumulative), pets, age range, floor range.
10. **Near-a-place:** haversine distance filter around `?near=lat,lng`; radius is `nearRadius` km,
    or `nearRadius * 0.4` km when `nearMode === 'min'` (minutes-to-km heuristic).
- **Relevance-gated filters:** each optional filter is wrapped in `rel(section)`
  (`sectionVisible`), so a filter hidden as irrelevant for the current property types never narrows
  results.

### Sorting
- `relevance` (default), `price-low`, `price-high`, `newest`. Non-relevance sorts are simple
  comparators; `newest` uses `createdMs(createdAt)`.
- **Relevance score (`relevanceScore`)** = featured (+1000) + ownerVerified (+250) +
  ownershipVerified (+200) + RERA (+80) + freshness weight (`active` 200 / `aging` 120 / `stale` 40
  / `dormant` 0) + `computeQualityScore(p)` (photos/description/amenities completeness). Ties break
  on newest.

### Empty-state recovery (near vs locality contradiction)
- If `near` + `localities` are both set and the primary result is empty, the pipeline recomputes
  with the locality constraint dropped; if that yields results it returns them plus a `relaxedNear`
  banner ("no exact matches in X - showing homes near Y"). Only fires on the genuine contradiction.

### Pagination & views
- **Grid/list:** client-side, `PAGE_SIZE = 9`; page resets to 1 whenever filters/sort/text change.
- **Map:** "area-first" - gated until the user focuses 1..`MAP_MAX_AREAS` (5) localities, then caps
  markers at `MAP_MARKER_CAP` (120). Uses locality registry centres for focus.
- **Map fallback:** a `view=map` deep link with `mapSearch` off falls back to grid + a note.

### URL <-> state sync (`filterState.js`)
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
  when `total > markers shown` (120 cap).
- **Map unavailable:** info note when `view=map` but `mapSearch` flag is off.
- **New/empty city:** `NewCityEmptyState` instead of results.
- **Dormant listings:** `listProperties` already hides `real && isDormant` posts from public search
  (anti-staleness); seed/demo stock stays visible.
- **Range "and above":** default-ceiling thumbs are treated as no upper bound (`openHi`), avoiding
  silently hidden high-value listings.

## 9. Current mock implementation
- **Service:** `src/services/propertyService.js` (`listProperties`, `getProperty`,
  `featuredProperties`, ...). NB: `Listings.jsx` imports `listProperties`/`listLocalities`/
  `logSearchIntent` directly from `src/lib/mockApi.js`; the service seam wraps the same functions.
- **Provider:** `src/services/providers/mock/propertyProvider.js` (wraps `mockApi.js` +
  `properties-admin.js`).
- **Core:** `src/lib/mockApi/properties.js` `listProperties(filters, sort)` -
  `matchesFilters` supports flat params (`deal, type, locality, bhk, minPrice, maxPrice, furnishing,
  q, status`), default hides non-`approved` and `real && isDormant`; `sortProps` supports
  `price-asc`/`price-desc`/`area-desc`/`newest`. Note the **rich filtering is in the page pipeline**
  (`computeResults`), not this coarse mock filter.
- **Data/seed:** `src/data/properties.json`, `src/data/localities.json`, `src/data/societies.js`.
- **Key components/functions:** `computeResults` (`listingsResultsPipeline.js`), `matchers.js`
  (`matchRentType`, `matchBuyType`, `bhkMatch`, `offersSharing`, `enrichRent`), `filterState.js`
  (`INITIAL`, `paramsToFilters`, `applyFiltersToSearchParams`, `normBhk`), `constants.js` (all filter
  option lists), `ResultsArea.jsx` (pagination `pageItems`, empty-state broadeners).

## 10. Target API endpoints
Map to the [OpenAPI spec](../../../backend/src/main/resources/static/openapi/punenest-api.yaml) (tag: Catalog & Search) and the pagination/filter
contract in [`../../system/cross-cutting.md`](../../system/cross-cutting.md) (section 5):
- `GET /properties?deal=&type=&locality=&bhk=&minPrice=&maxPrice=&furnishing=&q=&sort=&status=&page=&size=`
  -> paginated `{ content, page, size, totalElements, totalPages }`.
- The server must accept the **full** filter set the pipeline computes today (multi-select types,
  commercial subtypes, multiple localities/societies, verification flags, amenities-contains-all,
  age/floor/area ranges, `sharing`, `room`, `tenants`, `avail`/`availfrom`, `pets`, and
  `near=lat,lng&radius=&mode=`), plus relevance/price/newest sort.
- `GET /localities` for filter options. Save-search maps to the saved-searches/alerts endpoints.
- **Response delta:** relevance ranking, freshness weighting, `computeQualityScore`, dormant-hiding
  and the near/locality relaxation must move server-side and be reflected in ordering + `content`.

## 11. Backend responsibilities
- **Own filtering, sorting, ranking and pagination on the server.** Today `computeResults` filters
  and ranks the *entire* loaded inventory in the browser; at scale the server must do this and return
  only the requested page.
- **Enforce visibility rules server-side:** only `approved`, non-archived, non-dormant (for `real`
  posts) listings are searchable; never ship non-approved rows to public search.
- **Compute derived/ranking fields server-side:** relevance score, freshness state, quality score,
  and the deterministic rent enrichment (`enrichRent`) must be authoritative on the server, not
  re-derived per client from an id hash.
- **Near-a-place geo search:** implement radius/haversine (or PostGIS) filtering server-side,
  including the minutes-to-km heuristic and the locality-relaxation fallback.
- **Analytics:** `logSearchIntent` should be a server-side demand event, not a client write.
- The client filter/sort/page values are **inputs**, never trusted authority over what's visible.
