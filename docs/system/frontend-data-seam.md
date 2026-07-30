# Frontend data seam (mock ↔ http)

How the React app reaches data, and the rule that keeps the `mock → http` flip a one-line change
instead of a 20-file refactor.

## The rule

> **Pages, components and hooks import from `src/services/*`. They must never import from
> `src/lib/mockApi.js`, `src/lib/mockApi/*`, `src/lib/store*` or `src/lib/properties-admin.js`
> for anything that has (or will have) a backend endpoint.**

```
pages / components / hooks
        ↓  (only this direction)
src/services/<domain>Service.js      ← stable public API, never changes shape
        ↓  createProvider('<domain>')
src/services/providers/mock/…        ← localStorage implementation (always works, no backend)
src/services/providers/http/…        ← real API implementation (opt-in per domain)
```

`services/config.js` resolves the provider **per domain** from `VITE_API_DOMAINS`
(e.g. `VITE_API_DOMAINS=auth,property`). Anything not listed stays on mocks. This is what makes
integration incremental: one domain can go live while the rest of the app is fully demoable with the
backend switched off.

## Why it matters

Before Phase 2a, 21 files imported `listProperties` and friends **directly from `lib/`**. Flipping
the property domain to http would have changed the behaviour of the one file using the seam and
silently left the other 20 on localStorage — producing a half-real UI that looks like a mapping bug.
A seam only works if it has no bypass.

**Enforcement:** grep for direct `lib/mockApi` imports in `pages/` and `components/` before shipping
a domain flip. Zero results = zero leaks.

## Domain status

| Domain | Service | Provider(s) | Notes |
|---|---|---|---|
| `auth` | `authService.js` | mock + **http** | Live: login, staff-login, refresh, logout, `GET/PATCH /auth/me` |
| `property` | `propertyService.js` | mock + **http** | Live: search, detail, featured, counts, by-id, `/me/listings`, archive/restore. Admin moderation still mock-only |
| others (saved, visit, deal, finance, document, content, admin, …) | — | mock | No backend controller yet |

`propertyService.js` exports 15 symbols: `listProperties`, `getProperty`, `featuredProperties`,
`countProperties`, `getPropertiesByIds`, `myListings`, `addListing`, `setListingStatus`,
`toggleFeatured`, `flagListing`, `clearFlag`, `deleteListing`, `updateListingFields`,
`archiveListing`, `restoreListing`.

### Why `countProperties` / `getPropertiesByIds` exist

Several pages used to load the **entire catalogue** and reduce it client-side — a locality count, a
saved-list lookup, a compare picker. That is invisible against a 38-row mock and simply *wrong*
against a paginated API: the answer silently becomes "…of the first page". Both operations push the
work to the server, and `countProperties` is exact because `totalElements` on a `size=1` request is a
count over the whole result set, not over a page. No new endpoint was needed for either.

`myListings` is a correctness fix rather than an optimisation: public `/properties` is hard-floored
to approved + non-archived server-side, so an owner's pending or rejected rows **cannot** be derived
from it at all. `GET /me/listings` is the only source that returns them.

## Documented exceptions (deliberate, not oversights)

These stay on `lib/` **because they have no backend counterpart**, and moving them would create a
service method that can never be implemented:

- `setPipelineStage`, `sendOwnerReminder`, `confirmListingFresh`, `applyVerifiedBadgeToListings`,
  `verifiedStats` — growth/ops features that are mock-only by design.
- Admin moderation (`setListingStatus`, `toggleFeatured`, `flagListing`, `clearFlag`) is in the seam
  but **throws in http mode**, pending the admin slice. Deliberate: failing loudly beats a silent
  no-op on a moderation action.

`lib/data/myListings.js` is the one `lib/ → services/` import in the codebase. The layering concern
was real but hypothetical; the correctness gain is concrete, and the absence of a cycle was verified
(the provider registry reaches `lib/mockApi.js` and `lib/data/properties-admin.js`, neither of which
imports `myListings.js`). It carries a SEAM NOTE recording that check.

## Backend gaps that block the last two aggregates

Two client-side aggregates could **not** be expressed with shipped endpoints, and are named here
rather than quietly left as whole-catalogue scans:

| Aggregate | Blocker | Needs |
|---|---|---|
| Societies "N homes" | No `society` facet on `/properties`; the society list itself is client-side mock data, so an exact count over fabricated societies is meaningless | a `society` facet, or a societies slice |
| Saved-search match counts (`listings/alertCriteria.js` `countMatches`) | Matches on **multi-valued** `localities[]`/`bhk[]`; server facets are single-valued, so it would take \|localities\| × \|bhks\| requests per saved search | a saved-search / alerts count endpoint |

## Shape gaps (resolved in Phase 2b)

The backend does **not** return a mock-compatible property. The http provider needs a mapper:

| Mock field | Backend field | Action |
|---|---|---|
| (bare array) | `PageResponse{content,page,size,…}` | unwrap in provider |
| `type` | `propertyType` | rename |
| `bhkNum` | `bhk` | rename |
| `image` | `coverImage` | rename |
| `gallery` | `images` | rename |
| `archived` (bool) | `status` (enum) | derive |
| `localitySlug` | `localitySlug` | ✅ **resolved** — now emitted by `PropertySummary`/`Property` |

### Verified by `npm run parity:property`

`frontend/scripts/property-parity.mjs` drives the **real** mock provider and the **real** http
provider (not the mapper alone, and not re-implementations) against a live backend and diffs the
resulting view models. It is deliberately **fail-closed**: every mock field must appear in
`REQUIRED`, `OPTIONAL` or `WAIVED`, because an unclassified field is a field nobody has judged. It
also compares the **union of keys across all rows**, not one sample — the first version compared a
single listing and missed seven fields that only some rows carry.

It additionally asserts:

- **Both providers expose the same operations.** `propertyService.js` forwards blindly, so a method
  added to one provider and forgotten on the other fails at runtime, on whichever page calls it, in
  whichever mode nobody tested. Comparing the exported surfaces catches that up front.
- **`countProperties` counts the result set, not a page** — checked against `totalElements`, both
  unfiltered and locality-filtered, plus a check that the filter actually narrowed the count.
  Mutation-verified: making it read `content.length` fails the harness.
- **`getPropertiesByIds` drops unknown ids** rather than throwing or leaving a hole, and preserves
  request order — the behaviour Saved and Compare depend on when a listing is archived later.
- **Vocabulary drift is audible**: an unrecognised possession value must map to `undefined` in both
  directions *and* emit a console warning. Degrading gracefully and degrading silently are different
  things, and the warning is itself covered so it cannot rot away.

Not covered: `myListings`, `archiveListing` and `restoreListing` are checked for presence but not
driven, because they need a real session and would write to the dev DB.

```powershell
npm run parity:property                                  # defaults to http://localhost:8080
node scripts/property-parity.mjs --base http://localhost:8081
```

**Point it at the backend you actually changed.** A server running older code fails these assertions
in the same shape as a real regression, so the harness prints `live API: <base>` before comparing —
check that line first when it fails.

Current verdict: **PASS**, with these deliberate divergences.

| Field(s) | Status | Why it's tolerable |
|---|---|---|
| `desc`, `owner`, `ownerId`, `ownerMobile` | detail-only on the wire | verified unread by `Card.jsx`; matches the contact-gate intent |
| `floorPlan` | absent | read as `p.floorPlan \|\| floorPlanFor(p) \|\| DEFAULT` — synthesised |
| `priceStr`, `commercialType`, `shellType`, `washrooms`, `powerBackup`, `fixtures`, `form` | absent | commercial/land enrichment, every read guarded by `?.`/`\|\|`/`Array.isArray` — thins the detail page, doesn't break it |

### ✅ `construction` / `possession` — resolved (V10)

This was the one divergence that broke a feature rather than degrading it, so it was fixed in the
contract rather than papered over in the client.

- **Was:** UI had `construction ∈ {ready, new, under}` driving the availability filter; the backend
  had `possession`, nullable free **text**, detail-only, not filterable, `NULL` in all 38 rows. With
  the property domain on http, "Ready to move" returned **zero results**.
- **Now:** `PropertyPossession` is a first-class enum — `ready-to-move | new-launch |
  under-construction` — on `PropertySummary` (so cards carry it), as a `possession` search facet, and
  validated on create/update. `V10__property_possession.sql` adds a `CHECK` constraint and backfills
  the seeded catalogue.

| Layer | Enforcement |
|---|---|
| OpenAPI | `PropertyPossession` schema + `possession` query param |
| API edge | `@Pattern(PropertyPossession.PATTERN)` on `ListingCreate`/`ListingUpdate` → 422 |
| Database | `properties_possession_check` — blocks values arriving via backfills or ops scripts |
| Client | `propertyMapper` translates `ready-to-move ⇄ ready` in both directions |

**Two decisions worth remembering.** `NULL` is legal and means *not stated* — deliberately distinct
from all three values, so an unrecorded listing never satisfies a "Ready to move" search (plots stay
here permanently). And the wire vocabulary is intentionally *not* the UI's `ready|new|under`
shorthand: `possession=new` is ambiguous in a long-lived public contract, and translating in the
mapper is a far smaller diff than renaming ~14 UI read sites and their i18n keys.

`npm run parity:property` asserts the whole path end-to-end: that `toQuery({construction:'ready'})`
emits `possession=ready-to-move`, that the facet returns rows, that every returned row is `ready`,
and that no unstated listing leaks in.

### Why `localitySlug` exists (settled — do not "simplify" it away)

`localities.slug` is the **primary key**, and `properties.locality_slug` / `societies.locality_slug`
are real FKs to it. `localities.name` has no uniqueness constraint at all. The slug is also the
public URL key (`/locality/{slug}`), so it is SEO-load-bearing and must survive a display rename.
The property search facet (`GET /properties?locality=…`) matches the **slug**, not the display name:

```
?locality=baner  -> 2 results
?locality=Baner  -> 0 results
```

Server-side resolution lives in `catalog.locality.LocalityResolver` (slug hit → case-insensitive
name → containment for sub-areas like "Hinjawadi Phase 1" → nearest curated locality within 2.5 km).
It mirrors the client's `resolveLocalitySlug` with one deliberate difference: the server returns
`null` rather than coining `slugify(name)`, because the column is FK-constrained and coining would
mean polluting the curated locality table (and the sitemap) with owner typos.

## Local run

See [`../LOCAL_DEV.md`](../LOCAL_DEV.md) for Postgres + backend + frontend, the Vite `/api` proxy,
and how to read the OTP out of the backend log in dev.
