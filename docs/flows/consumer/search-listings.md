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
  `v` (verification flags), `room`, `tenants`, `landuse`, `constr`, `avail`, `availfrom`,
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
  `enrichRent.js`) because a service must not import
  from a page directory.
- **Mobile filter FAB:** filtering is the most-repeated action in the search journey, but the
  controls bar is pinned to the top of the page - the hardest place to reach one-handed. A `lg:hidden`
  fixed pill duplicates the action into the thumb arc, docked above `--dz-bottom-inset` so it clears
  the bottom nav, and carries a count badge when filters are active. It is anchored **bottom-left**
  because the Draaz assistant FAB owns bottom-right and was literally intercepting taps there.

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
- Explicit `?deal=rent|buy` always wins. Otherwise a share-only signal (type `flatmates`) defaults
  to **rent**; everything else defaults to **buy**. Switching deal resets to that deal's default
  filter set (`INITIAL(deal)`), sort `relevance`, page 1 (the two journeys have different filter
  shapes).

### The filter vocabulary (`toFacetQuery` in `lib/listings/facetQuery.js`)
The filter state is translated once into a wire query and answered by `ListingFacets` +
`PropertySpecs` server-side. The vocabulary is defined in one place and the page never re-implements
it, which is what stops the controls and the query from drifting apart.

Axes, and the column each resolves to:
1. **Base:** `deal` + `status = 'approved'` (the approved floor is the provider's, mirroring the
   server; it is not a facet a caller can turn off).
2. **Text (`q`, from `?q=`/`?locality=`):** `title`, `locality`, `localitySlug`.
3. **Price:** `minPrice`/`maxPrice` - top-level params, *not* members of `ListingFacets`. A thumb
   parked at the default ceiling means "and above", so high-value stock is not hidden.
4. **Type:** an **OR across two columns**, not an `IN` on one. `flatmates` resolves against
   `share_type` (V100); every other chip resolves against `property_type_key` (V98) **and**
   requires `share_type IS NULL`, so a shared room posted as "Flat" no longer appears under the
   Flat chip. Shared Room is its own product - one person's room in someone else's flat, not a
   whole home - and carries its own sub-filter (flatmate room type `single|shared`), so the two
   narrow honestly against disjoint sets. What this page **cannot** claim for shared rooms is
   completeness: `/flatmates` also carries flatmate *requests*, which are people rather than
   listings; that gap is disclosed by the cross-sell card rather than by silently widening the
   search.
5. **Commercial subtype:** `commercial_use_key` (V99).
6. **Room type**, **land use**, **BHK** (`3plus` -> `>=3`, `5` -> `>=5`, `0` -> RK/studio),
   **furnishing**, **localities** (`locality_slug`), **societies** (`society_slug`; an unbound
   listing matches no society filter rather than a hashed guess - D19).
7. **Area**, **amenities** (must contain ALL selected - an AND, unlike every other multi-select),
   **verification flags** (`ownerVerified`, `ownershipVerified`, `rera`, `societyVerified`,
   `conveyanceDone`). Ownership verification **lapses**: the facet, the count and the badge all
   read the same live expression, so a listing whose verification has expired disappears from the
   filter rather than keeping a badge it no longer earns.
8. **Construction / availability**, **age**, **floor**, **pets**, **tenant preference**,
   **availability window** (`now`/`15`/`30`, cumulative).
9. **Security deposit:** `minDeposit`/`maxDeposit`, rent-side only - a sale has no deposit to
   narrow on, so the client never sends the pair on `deal=buy` (the server does not gate it, and
   would answer such a request with every sale listing, all of them unstated).
10. **Near-a-place:** `nearLat`/`nearLng`/`nearRadiusKm`; radius is `nearRadius` km, or
    `nearRadius * 0.4` km when `nearMode === 'min'` (minutes-to-km heuristic).
11. **Posted by:** `postedByOwner=true` - the "no brokerage" search, on both deals. Matched by
    **equality** on `posted_by_type`, so a listing that never recorded who posted it is excluded
    rather than assumed to be an owner; `false` is never sent, and is a no-op the server cannot
    distinguish from an absent parameter, because narrowing *to* a broker's stock is not a search
    anyone comes here to run. The self-serve wizard hard-codes `owner`, so a
    listing is a broker's or a builder's exactly when a concierge operator said so on the call.
    The same fact gates the *copy*: the "deal direct with the owner" half of the zero-brokerage
    claim is withdrawn on an agent's or a builder's listing, via `isBrokered` in `lib/contact.js`.
    Draazy's own nil fee is a platform claim and stays unconditional everywhere.
- **Relevance-gated filters:** each optional filter is wrapped in `rel(section)`
  (`sectionVisible`), so a filter hidden as irrelevant for the current property types never narrows
  results.

**Where the browser and the server disagreed, the server wins** - these are behaviour changes, not
implementation details:
- A **range facet admits the listings that state nothing** on the column it narrows - area, age,
  floor and deposit - and reports how many in `unstatedElements`, rather than deleting them the way
  a bare `cb.ge` on a NULL column would. Most of the catalogue states no age or floor, and most
  rentals state no deposit, so excluding them hides the majority the moment a thumb moves. Still
  not a coalesce: unstated is disclosed as unstated, never read as zero the way an unknown age once
  read as "brand new".
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
  and toasts what it understood. Reads BHK, 1 RK / studio, property type, locality (incl. `near X`),
  furnishing, amenities, pets, ready / under-construction, owner-only, and money in every phrasing
  the box gets — `under 80 lakh`, `50-80 lakh`, `above 1 cr`, and a bare `25k`.
- **It merges, it does not reset.** The parse clones the filters already on screen and adds to them,
  so a typed phrase refines the search the user has been building. Only a change of deal resets,
  exactly as the Rent/Buy toggle does.
- **The deal can be inferred from the amount.** With no `rent`/`buy` word, an amount above the rent
  slider's ceiling is a sale price and switches to Buy; anything at or below it is a rent. Clamping
  instead would land on the slider default and filter nothing at all. A figure trailed by a land
  unit (`1000 sqft`, `2 acre`) is a size and is never read as money.
- **Unparsed words become `?q=`.** A society, a builder or a landmark is exactly what a shopper
  types and none is a facet, so the remainder is forwarded to the free-text match (§ 9.2) rather
  than dropped. It renders as the first active chip, which is the only control that removes it. A
  facet the other journey's panel does not offer goes back to the remainder for the same reason.

### Locality demand telemetry (`recordSignal`)
- **Keyed on the slug, not the display name.** The server joins to `localities` on the slug and
  resolves the name itself, so a label-keyed table would drift with whatever the label was that day.
- **No `userId` is sent.** The server reads the session from the token if there is one and records
  nothing if there is not. A client-supplied `'anon'` would make every signed-out searcher one
  identity, so three strangers would look like one repeat visitor.
- **Not awaited and not caught** — `recordSignal` never rejects, and a telemetry write must not be
  able to break a search.

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

## 9. Backend search internals

Relocated from code comments in `catalog/property/` so the reasoning survives without a
multi-paragraph docblock per method.

### 9.1 The public-visibility floor, and why `adminSearch` is a separate method

`PropertySpecs.publicSearch` always pins `archived = false AND status = 'approved'` - exactly the
predicate of the partial `idx_properties_search`. The contract exposes a `status` query param, but
on this anonymous endpoint it can only ever narrow *within* approved; it can never surface
pending/flagged/rejected/archived rows.

`adminSearch` is the only builder in the codebase that omits that floor. It is a separate method
rather than a `boolean includeAll` flag on `publicSearch` on purpose: a flag would put the public
search one mistyped argument away from serving unapproved listings anonymously, whereas a second
method can only be reached by a caller that named it, and every caller can be enumerated by grep.
Its one caller is a route behind `@PreAuthorize(staff|admin)`.

`adminSearch` also join-fetches `owner` (LAZY, and the moderation page maps the full
`PropertyResponse`, which embeds it). `publicSearch` deliberately does not: `PropertySummary`
carries no owner contact by construction, so the join would be paid for nothing on the hottest read
on the platform. Both the fetch and every `ORDER BY` are guarded on the result type, because Spring
Data issues a separate `COUNT` query for the page total and neither is valid there.

### 9.2 Two text searches, never one with a flag

`publicTextSearch` matches title, locality, society and property type - the four things a name typed
into the search box can be, and each already printed on the card the query returns. The term is
matched **word by word**, every word required in one of those four columns: it arrives from smart
search as the words it could not turn into a facet, so it is routinely a builder and a project split
across two columns, and society is on the row only as its `name-builder-locality` slug - nobody
types it in that order. The term is bounded at 120 characters, words are capped at six and `%`/`_`
are escaped, so on a route needing no login a pasted paragraph cannot become a predicate per word
and `?q=%` cannot return the whole catalogue while reading as a narrowing. `adminTextSearch` adds
the owner's name,
the owner's mobile and the listing id. They are separate methods for the same reason `adminSearch` is
separate: what a flag would buy an attacker is `?q=98234` against a widened public search answering
"which landlords' numbers start 98234, and exactly what do they own", from an endpoint needing no
login. Listing pages mask the mobile precisely so that cannot be assembled.

Mobile is the one key a desk always has, because the caller is on the phone; name alone is not,
since Indian names are transliterated inconsistently enough that "Rajesh"/"Rajeshh" is an ordinary
support call. The id is matched as text so a partial paste works - the tail of a uuid quoted in
chat is how ids travel between people.

That cast must be a real one. `Path.as(String.class)` looks like the JPA spelling and is not: it
re-types the expression for the compiler without emitting anything, so the generated SQL was
`lower(uuid)` and every search on the moderation screen answered **500** - including searches
matching on title, because a broken branch of an `OR` takes the whole query with it.
`HibernateCriteriaBuilder.cast` emits the `cast(... as varchar)` Postgres needs, and no `lower()`
goes around it because Postgres renders a uuid as lowercase hex already. The path is typed to
`UUID` before the cast because that builder takes a `JpaExpression<T>` and an untyped
`root.get("id")` is a `Path<Object>` that matches nothing. `owner` is reached by path rather than an
explicit join: `owner_id` is `NOT NULL`, so the implicit inner join cannot drop a row from either
the page or its count, and the two `get`s share one join.

### 9.3 Ranking: `boostedFirst`, `relevanceFirst`, and the tie-break

Both ranking specifications **filter nothing** - they return a `null` predicate and contribute only
an `ORDER BY`, so a boost or a good score buys position, never visibility. Both are applied only
when the caller expressed no order: a buyer who sorts by price low-to-high gets price low-to-high,
because silently pinning paid listings above a sort the buyer chose is a lie about what the control
does.

Promotion is computed as `boosted_until > now` rather than read as a flag, so an elapsed window
stops promoting the moment it elapses and correctness never depends on a sweeper having run.

`relevanceFirst`'s score, term for term:

```
featured             1000
owner verified        250
ownership verified    200
RERA registered        80
freshness       200 / 120 / 40 / 0   (active / aging / stale / dormant)
+ quality_score    0 .. 100          (generated)
```

The weights are spaced so each tier dominates the sum of everything beneath it: a featured listing
outranks a perfect unfeatured one, and no amount of completeness substitutes for a verification.
Freshness is computed from timestamps rather than read from a column because it cannot be one - it
is a function of the clock, so any stored tier is correct only at the instant it was written.
`Freshness` states the same boundaries for the response and the cutoffs come from the same
constants, so the badge a buyer sees and the rank that put the listing in front of them cannot
disagree. Lapsed ownership verification stops earning its 200 points, because the facet, the
`verifiedElements` count and the card badge all read `ownershipLive`. A null `quality_score` (a row
written but not read back) is coalesced to zero rather than collapsing the whole sum.

**Tie-break.** Both branches append `id DESC` - the same total-order guarantee `PropertySort`
appends to the sorted branch. Neither the rank nor `created_at` is unique and these branches are
paged, so two listings posted in the same instant would otherwise be ordered by whatever the planner
picked for that query, and a reader paging through could see one twice and never see the other.

`now` is a parameter on both so a test can place a window or a freshness boundary on either side of
it deterministically.

### 9.4 Facet semantics

- **Unknown facet token matches nothing, never everything.** `unmatchableIfAsked` distinguishes
  "this facet was not used" from "it was used and nothing survived sanitising". Both arrive at an
  empty token list, and treating them alike fails in the direction that looks like success: the
  caller gets the entire catalogue back presented as the answer to their filter. An empty page is
  legible; a full one silently is not the search that was requested. The amenities loop needs this
  guard most, because an empty loop body adds no predicate at all.
- **Amenities AND, tenant types OR.** Ticking "lift" and "parking" states two requirements,
  not two alternatives, and returning a listing with one of them wastes the visit that finds out.
  Tenant types OR, because one listing genuinely accepts several and a seeker who will take either
  has asked one question.
- **Stated policy only.** A listing that stated no tenant policy matches no tenant chip. "Unknown"
  is not a value a filter can match: answering a `family` tick with owners who said nothing is the
  same fabrication as defaulting the field to a guess. `pets` and `availableFrom` read silence the
  same way, and so does `possession` - an unrecorded possession is not a promise. **This is a rule
  about token facets, and the range facets deliberately do the opposite** (see `unstatedFiltered`):
  a tenant chip is a claim the owner either made or did not, while a silent `age_years` or
  `deposit` is a gap in the data on a column most of the catalogue never fills, so excluding it
  deletes the majority rather than answering the question. Ranges therefore admit the silent rows
  and disclose the count. Neither rule is a coalesce - nothing is ever read as zero, which would
  float every silent listing to the top of a brand-new-homes search.
- **Trust flags only ever narrow.** `false` means "I did not ask", not "show me the unverified
  ones" - there is no surface that searches for absent trust.
- **BHK is a union with an open top chip.** "3+" is a bound, not a value; rendering it as equality
  hides every 4BHK from a buyer who asked for three or more.
- **Type chips need two columns.** `property_type_key` says what kind of building a listing is,
  which is not quite what the chips ask: a shared room posted with a `property_type` of "Flat" keys
  as `flat`, so reading the key alone puts shared rooms into a Flat search. `flatmates` resolves
  against `share_type`; every other chip resolves against the type key *and* the absence of a share
  type. Chips OR, so `?types=flat,flatmates` means whole flats plus shared rooms, not the empty
  intersection ANDing the two columns would give. The commercial sub-filter needs its own
  `commercial_use_key`, because every commercial label collapses to `commercial` in the type key.
- **`inLowerValues` lowercases the values, never the column.** `property_type_key` already holds a
  lowercase canonical vocabulary, so `lower(property_type_key)` buys no extra matches and costs the
  index - it is not the expression `idx_properties_type_key` is built on, so the planner falls back
  to a scan on the busiest read on the platform.
- **`clean`/`SAFE_TOKEN` is a filter, not validation.** A token that cannot be a slug cannot match a
  row either, so discarding it costs a caller nothing real. It exists because these values reach
  `cb.literal` inside a JSON function, and "Hibernate binds literals as parameters by default" is a
  defence that depends on a configuration setting staying at its default.
- **`jsonb_exists(column, token)` rather than the `?` operator**, because `?` is also JDBC's bind
  placeholder: a driver rewrites it into a parameter and the query fails well below where anyone is
  looking.
- **Owner id is parsed in the specification**, so a value that is not an id at all becomes a
  predicate matching nothing instead of a 400 or - as the first draft did, comparing a String
  against a UUID column - a 500. The profile page is reached by link, so a bad id means a stale or
  hand-edited URL and "this person has nothing listed" is the honest answer.
- **Moderation axes are tri-state.** "Show me everything" and "show me only the un-archived" are
  different questions and a two-valued flag can only ask one. The `unconfirmed` axis coalesces
  `last_confirmed_at` to `created_at`, because posting is itself an assertion of availability -
  without the fallback every listing with a null confirmation compares as NULL and drops out of
  *both* sides of the tri-state.
- **Filtering happens in the database**, not client-side: a predicate the database cannot see cannot
  participate in `ORDER BY` or `LIMIT`, so a client-side filter pages the wrong set.

- **A separate record from `PropertySearchQuery`.** That query is shared with the moderation search,
  where "pets allowed" or "within 3km of Baner Chowk" mean nothing. Folding these in would have grown
  the shape both callers must satisfy past thirty positional components, where one transposed
  argument is a filter silently searching the wrong column. Kept apart, the moderation call site
  passes `ListingFacets.NONE` and does not change.
- **Plural names (`bhks`, `furnishings`) are deliberate.** `PropertySearchQuery` already publishes a
  single-valued `bhk` on the same endpoint; two parameters of one name and different arity is worse
  than ambiguous, since Spring binds the scalar first and `?bhk=2,3` becomes an equality against the
  literal string.
- **`availableFrom` is cumulative**: `30` also matches `now` and `15`. A tenant who can wait a month
  can also take a flat free today. An unknown bucket resolves to a token no row can hold rather than
  to a wildcard, so a bad request cannot read as the whole catalogue.
- **The near-radius is clamped, not rejected** (50 km). The radius sizes a bounding box, and an
  unbounded one spans the planet — a full-table scan anyone can request on an anonymous endpoint.
  Fifty kilometres already reaches past every locality in the catalogue.

### 9.5 `ownershipLive` and `anyVerified`

`ownership_verified` records that the paperwork once checked out; `ownership_verified_until` is when
that expires, and a null there means "does not lapse", not "lapsed" - the same reading as
`Property.isOwnershipVerifiedAt`, which is what the card badge is drawn from. Filtering on the bare
column would make the "Ownership verified" facet return listings that show no ownership badge.
`anyVerified` (the predicate behind `verifiedElements`) is deliberately the same disjunction the
cards draw their badges from, and reuses `ownershipLive` for its second half.

### 9.6 "Within N km" without PostGIS

PostGIS is not installed, and installing an extension to answer one filter is a deployment
dependency bought very cheaply. `withinRadius` is two predicates, in this order:

1. A latitude/longitude **bounding box** computed in Java from the radius. It is a plain range
   comparison, so the planner can drive it from an index and it discards almost every row before any
   trigonometry runs. One degree of latitude is ~111.045 km everywhere; a degree of longitude shrinks
   with the cosine of the latitude, and that cosine is floored at `1e-6` so a search near a pole
   degenerates into "the whole longitude range" instead of dividing by zero. Pune will never reach
   that, but a bug that only appears at a latitude nobody tests is not a bug anyone finds.
2. The exact great-circle test on what survives, trimming the box's corners back to a circle.
   Without the box this is a full-table trigonometric scan on the busiest read on the platform;
   without the circle, a listing 7 km away on the diagonal answers a 5 km search.

The exact test compares **cosines** rather than distances: `cos` is monotonically decreasing over
`[0, pi]`, so "angle <= r" is exactly "cos(angle) >= cos(r)". That removes the `acos` call entirely,
and with it the floating-point domain error a listing at distance zero would trigger when rounding
pushes the argument a hair above 1. Everything depending only on the search centre is folded into a
constant rather than recomputed per row.

### 9.7 Two totals, one scan (`PropertySearchFragment`)

The search response carries two numbers describing the whole match rather than the page -
`totalElements` and `verifiedElements` - and `JpaSpecificationExecutor.findAll(spec, pageable)` can
only produce the first. Asking for the second separately costs a third statement over the same rows.
`countTotals` issues both aggregates over one predicate in one statement, which also removes a way
for them to disagree, since two counts issued separately are two points in time. JPA has no
`FILTER (WHERE ...)`, so the conditional count is spelled as a sum over a `CASE`; `SUM` over zero
rows is `NULL` rather than zero, hence the `toLong` coalesce - an empty search would otherwise be an
NPE on the one path that is hardest to notice, because an empty search still renders perfectly well.

The price is that this fragment owns the page query `SimpleJpaRepository` would otherwise own. That
is only affordable because `publicSearch` is a pure `WHERE` builder - no joins, no `fetch`, no
`distinct` - so there is no row multiplication for a count to disagree with. **Anything added to
`publicSearch` that joins to a collection breaks that assumption** and needs a `distinct` here plus
a matching `countDistinct`, or the totals will exceed the rows.

`findPage` applies the specification *before* reading the pageable's sort, because a ranking
specification restricts nothing and instead calls `orderBy` on the query it is given. The
`cq.orderBy` call is guarded rather than unconditional: `orderBy` with an empty list *clears* the
order, so calling it on the ranked branch - which arrives with a deliberately sort-free pageable -
would throw away the ranking the specification just set.

Ranking is never passed to `countTotals`: it cannot change a count, and its `ORDER BY` has no
meaning in an aggregate.

`PropertyService.searchWithTotals` hands the ranked branch an **unsorted** pageable on purpose,
because a `Pageable` sort overrides a specification's `ORDER BY` and the default `createdAt DESC`
would silently discard the ranking; `boostedFirst`/`relevanceFirst` carry that tiebreaker
themselves. The `PageImpl` is built with that same executed pageable, not the sanitised one, or a
client reading `sort` off the response would be told about an order that was overridden.

`rank` is deliberately not part of Spring's `sort`: `relevance` and `newest` are not column orders,
they are rankings, and `PropertySort` exists to refuse anything that is not a whitelisted column.
Passing them through `sort` would either widen that whitelist or be silently dropped. `newestOnly`
means promoted-first then most recent with no merit ranking, because "newest" and "best match" are
the two orders that both carry paid placement and only one may be reordered by a quality score - a
buyer who asked for the newest listings and got the best-scoring ones has been shown something other
than what the control says.

The listings-page facets bind as a `ListingFacets` object rather than twenty-seven more
`@RequestParam` declarations: a method with forty parameters is one where a mistyped name binds
nothing and the filter silently does not apply.

### 9.8 Public reads that are caller-aware

`GET /properties/{id}` is public, so `principal` is null for an anonymous reader and a null viewer
always masks the owner's mobile. The gate verdict comes from the `ContactGate` port, which the
contacts feature implements. `GET /properties/trust-stats` is public and counted by the database:
derived in the browser from whichever listings were already loaded, each figure would be a statement
about the current page dressed up as a statement about the catalogue - worst for the distinct-owner
figure, where two pages of the same owner's flats count as two verified owners. An unknown locality
slug answers zeroes rather than 404, because this is a headline about a slice and an empty slice is
a real slice.

The archive/restore `PATCH`es hide private fields **even from the owner**: the owner reads their own
meter number from `GET /me/listings/{id}`, and branching visibility on whether the caller happens to
be the owner would put a second copy of that decision here to drift out of step with
`MeListingsController`.

**Who may read a non-approved listing.** A missing, archived or unapproved row is a 404; sold or
rented stays reachable so a held link opens the badged page. Two exceptions, both matching assumptions
the client already makes:

- **The owner.** The detail page shows everyone else an "under review" interstitial, a branch that was
  unreachable while the server 404'd its own author — the dashboard's View button was dead for exactly
  the first hours an owner most wants it.
- **A checker.** The admin console offers *Open public page* on every verification-queue row, and it
  404'd on precisely the listings it exists for. `staff` is resolved by the caller from the
  `properties:read` *grant* rather than the bare role, so a revoked grant closes this door too.

Archived stays a 404 for both: taken down is gone, not private, and the moderation search already
reaches taken-down rows without pretending they are published.

## The property provider (`providers/http/propertyProvider.js`)

Method names, argument order and return shapes mirror the seam contract exactly, because
`services/propertyService.js` is the only contract and no page may care which provider is active.
Shape translation lives in `propertyMapper.js`, kept separate so the mapping is testable on its own.
What has no server counterpart is named at each call site rather than silently no-oped: a write that
lands in a different store than the reads come from produces a UI that contradicts itself on the
next refresh, which is far harder to diagnose than a thrown error.

**`PAGE_SIZE` is 100 because that is the server's actual ceiling**
(`spring.data.web.pageable.max-page-size=100` clamps anything larger). Any larger value here mutes
`warnIfTruncated`, which is the guard that makes the ceiling audible. Callers like Compare,
Societies and the admin tables aggregate over the whole result set client-side, so a silent cap
would show subtly wrong numbers rather than an obvious failure.

**`warnIfTruncated` compares against what actually came back**, not against `PAGE_SIZE`: the server
clamps the requested size to its own maximum, so a constant that drifts above that maximum would
silence the warning for every result set between the two. It uses `console.error`, not
`console.warn` — every spec asserts on console errors and `e2e/helpers/console.js` drops anything
whose `type()` is not `'error'`, so at warn severity the one detector for a partial catalogue is
invisible to the only thing that could act on it. The message describes the *condition* rather than
naming affected consumers, because a hand-maintained list of callers inside a warning grows false
silently and a reader who does not see their screen named concludes their screen is fine.

**Search and the list read are separate operations, deliberately.** `listProperties` has a dozen
callers that want "the catalogue as an array" and aggregate over it; changing its return shape to a
page envelope would change all of them at once. `searchListings` answers a different question — one
page of a filtered search, and how big the whole match is — and only the listings page asks it. It
returns `total` (the whole match, for the count and the pager) and `verifiedTotal` (the verified
subset of the whole match, counted by the database), because reading either off `items.length` is
the bug this endpoint shape exists to prevent. `signal` cancels the read: a search is superseded
constantly — every filter tick abandons the one before it — and without it the abandoned query still
runs to completion server-side, page plus count, for an answer discarded on arrival.

**Moderation is a separate operation rather than a flag, and the distinction is load-bearing.**
Routing must never be inferred from the filters: `useDashboardData.js` passes
`includeAllStatuses: true` on a consumer page, so a filter-sniffing branch would send every owner
opening their dashboard to a staff-only endpoint and a 403. That is the same rule the server applies
one layer down, where `PropertySpecs.adminSearch` is a separate method rather than a boolean on
`publicSearch`: an authorization-relevant routing decision is named by the caller, so every caller
can be found by grep. `searchForModeration` exists beside it for the same reason `searchListings`
does, and forwards `q` to the server rather than applying it to the fetched page — so a moderator
searching outside the newest hundred is never told "No listings match your filters" about a listing
that exists, the one answer a moderation search must never give.

`moderationSummary` is unfiltered by design (see `PropertyModerationSummary` server-side): a KPI
strip that followed the search box would just be a second copy of the table's row count, and
counting the fetched page instead paints confident zeroes over rows that fell outside it.

**404 → `null` where a "not found" state exists.** `getProperty` and `ownerProfile` translate it so
every caller does not have to catch; an unknown, malformed or archived owner is the same fact from a
visitor's side. The owner card is deliberately narrow — id, name, masked mobile, verified, city,
member-since year, live listing count — and anything a page reads beyond those seven fields arrives
by accident. An owner's stock is a facet on the ordinary public search rather than a route of its
own, which is what makes the approved-and-unarchived floor, the paging and the card shape the same
ones every other surface gets; without the floor, an owner's page would show their own rejected and
archived rows to a stranger.

`trustStats` does no client-side arithmetic and has no fallback: an unknown locality answers zeroes
rather than 404, so there is no not-found case to translate, and a genuine failure should surface
rather than be papered over with a plausible-looking number.

`countProperties` gets an exact match count at any catalogue size with no new endpoint: ask for the
smallest possible page and read `totalElements`, which the server computes over the full result set.
`size=1` rather than `size=0` because Spring rejects a zero page size.

`getPropertiesByIds` is N parallel detail reads because there is no batch-get in the contract —
deliberately better than fetching the entire catalogue and filtering client-side, since N is bounded
by what one user saved and the catalogue is not bounded at all. Missing ids resolve to `null` and
are dropped, because a saved listing can legitimately be archived later and that must not blank the
whole page.

**`myListings` / `myListing` are owner-scoped and status-complete**, which public search deliberately
is not. The `user`/`mobile` arguments are ignored: ownership is the access token's, and letting the
caller name an owner would be an authorization decision made in the browser; they are accepted only
so the signatures match the seam. `myListing` exists for the edit form, which must prefill from the
server rather than from browser-local state — a local prefill hands an owner on a second device an
empty form for a listing that is not empty, and submitting it sends the defaults over the top of
their real record. A listing under moderation is not on the public endpoint at all, and the public
view model omits precisely the fields the editor needs back. A non-owner gets a 404 by design,
because existence is itself information (`MeListingsController.getMine`). It synthesises its own
`form` snapshot because that is the shape the caller reads: a server row carries the contract's
field names, and the wizard's `listing.form || listing` fallback would otherwise prefill from keys
that mostly do not exist — `type` for `propertyType`, `desc` for `description`, `"2 BHK"` for `"2"`.

**The duplicate pre-check composes its address with the same expression the create does**, and that
is not a stylistic echo: the server normalises the string it is given into the comparison key, so a
three-part line here and a four-part line on the create normalise to two different keys and the
pre-check would answer about a property the submission is not about. Reusing the create mapper and
discarding the rest of the body would be the tidier-looking guarantee, but that body requires
`title`/`deal`/`price`, none of which the check needs or the schema declares. It is a `POST` on a
read because the body carries the electricity meter number — the one field on a listing that names a
real-world utility account, and not something to put in a query string.

**Concierge listing is its own route.** `/me/listings` attributes what it creates to the **caller**,
so a concierge listing posted through it would be owned by the staff member who typed it — invisible
in the owner's dashboard and unclaimable. A client does not get to say who owns a record or who
acted. `POST /admin/properties` takes the owner's **mobile** as the identity, because the operator
is on a call with somebody who has never signed in and the number they are calling from is the only
handle that exists; the server provisions or finds the account behind it. `ownerName` is used only
if the account has to be created, so an operator's transcription of a name heard over a phone call
cannot overwrite what the owner typed themselves. `postedByStaff` is set server-side. It is guarded
by `postOnBehalf:write` rather than `properties:write`, because this is the one route where the
caller names somebody else as the owner of what they create.

`ownerListingStanding` is the other half of exempting that route from the freemium cap: the desk may
post past an owner's plan, and this is what stops that being silent, so the operator sees they are
holding an upgrade conversation rather than discovering it from a billing report weeks later. Counts
only — no plan name and no price, because the operator needs to know a conversation exists, not what
the account is worth, and a desk that can read anybody's subscription off a phone number is a larger
disclosure than this feature is asking for. A number with no account is a 200 with `known: false`,
not a 404, because on this desk that is the ordinary first call; a short or malformed number is a
400.

**Duplicate clusters are unpaged by design** — a cluster is only meaningful whole, so there is no
page boundary that could fall inside one. The server's `truncated` flag is passed straight through
rather than folded away, because of how this read fails under a cap: a truncated list looks short,
but a truncated *clustering* looks **clean** — if the scan ceiling falls between two members of a
real pair, the pair does not render as a partial cluster, it does not render at all. An ops screen
quietly reporting "supply looks clean" is the failure this feature exists to prevent, so the flag
reaches the UI and the UI says it out loud. `warnIfTruncated` is deliberately not used here: it is
for paged reads where the server's page metadata reveals the clamp, and here the server has already
made the judgement and named it.

The reason vocabulary is enumerated rather than sampled. The wire's words and the console's overlap
enough to be dangerous — both sides say "address" and "image" — so a missing member would look
mapped right up until a cluster matched on both arms and the badge rendered `undefined`. The server
sorts its reasons before joining, so only one permutation of the compound key is reachable and a
label nothing can produce would be a false claim about the contract. An unrecognised value returns
`undefined` so the caller can fall back to the raw string, and warns naming the table to update:
"the server grew a reason the console has never heard of" is invisible if the mapper silently
returns its input.

Merging names the losers explicitly rather than deriving them server-side from the cluster: the
operator's screen and the server's next derivation are two moments apart, so a listing that joined
the cluster in between is one the operator never saw, and inferring the losers would archive it on
their behalf. Dismissing sends the member ids, never a signature — the server derives the signature
from them, so there is exactly one implementation of "what identifies this cluster", and the symptom
of two drifting would be dismissals that never match anything and clusters that come back forever. A
cluster that later gains a member is a different set and correctly resurfaces, because the operator
was never asked about the new listing.

**`takeListingDown` is not `archiveListing`.** `PATCH /properties/{id}/archive` is the *moderator's*
route and takes a reason, because a listing pulled by staff owes the owner an explanation; an owner
withdrawing their own listing owes nobody one, and routing them through the staff path would mean
either inventing a reason on their behalf or storing a blank one on an audit row. The delete is soft
server-side, because the row survives for the enquiries and deals that point at it — a listing is
not only the owner's; buyers have contacted it. It returns the archived listing so the dashboard
re-renders from the answer rather than assuming.

`updateListingAsModerator` is cross-owner, audited, and deliberately *not* a re-moderation trigger:
it leaves the listing's status alone, because the person making the change is the person who would
otherwise have to re-approve it. `confirmListingFresh` is its own endpoint rather than a field on
the edit, because an edit can revert a listing to `pending` and confirming availability must never
do that — an owner answering the freshness nudge would otherwise take their own listing out of
search to do it.

**All four moderation decisions resolve with no value**, and that is the contract's design rather
than a gap: `setPropertyStatus`, `toggleFeatured`, `flagProperty` and `clearFlag` each declare a
bare 200/204 with no schema, on the reasoning that a moderator can predict the effect of the request
they sent and the UI re-reads the queue anyway. Echoing the row back would mean a second round trip
per action, and the obvious one — `GET /properties/{id}` — is unusable here because it enforces the
public floor and so 404s for pending, rejected, flagged and archived listings, i.e. for the result
of every action on this list. The moderation queue has no by-id route, so the only faithful re-read
is the list refresh the caller already performs. Nothing may depend on a resolved value.

`setListingStatus` accepts only `pending | approved | rejected` server-side and 400s otherwise:
`flagged` belongs to `flagListing` (which also records why) and `archived` to `archiveListing`
(owner-or-staff, a different authorization). Routing either through here would be a second,
reason-less way to do something the API already models properly; `reason` is recorded on the audit
row and is what makes a rejection reviewable afterwards. `toggleFeatured` has no precondition — a
pending or archived listing can be marked featured, it simply will not surface, because the featured
strip re-filters on approved. `clearFlag` sets status to `approved` **unconditionally**: it does not
restore the status the listing held before, so a `pending` listing that is flagged and then cleared
reaches `approved` without ever passing the verification queue. That is the server's documented
behaviour, passed through rather than simulated.

`setPipelineStage` drops the listing the route answers with, for the reason above. The server sorts
the value onto the right column: a hand-back milestone lands in `handback_milestone` and pins
`pipeline_stage` at `docs_submitted`; an acquisition stage lands in `pipeline_stage` and clears the
milestone. Anything outside the eight is a 400, which includes `under_review` and `live` — those are
`status`, not stages.

The featured strip is server-curated and its endpoint takes no limit, so the cap is applied
client-side purely to keep the seam signature meaningful.
