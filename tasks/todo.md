# Tasks

> **This file is a chronological *index* of shipped work, plus whatever is currently in flight.**
> It is deliberately short. Everything durable lives elsewhere and is linked from here:
>
> | What | Where |
> |---|---|
> | What we still owe (deferred, with owner + trigger) | [`docs/system/tech-debt.md`](../docs/system/tech-debt.md) |
> | What someone must decide | [`docs/system/open-questions.md`](../docs/system/open-questions.md) |
> | How the frontend reaches data, and why | [`docs/system/frontend-data-seam.md`](../docs/system/frontend-data-seam.md) |
> | Architecture, data model, API standards | [`docs/system/`](../docs/system/) |
> | Test coverage per route/feature | [`e2e/COVERAGE.md`](../e2e/COVERAGE.md) |
>
> **Rule: a finished slice gets one index line here, not a narrative.** The reasoning that is worth
> keeping goes into the docs above or into a comment next to the code it explains — those are read
> when the code is read; a worklog entry is not.
>
> Compressed 2026-08-06 from 5,294 lines. Every one of the 86 open checkboxes was checked against
> the tree before removal — 62 had shipped, 3 were fixed on the spot, and the rest moved to the
> register. Details in the last entry.

---

## In flight

Nothing.

## Needs attention (not mine, not yet actioned)

- **`npm run check:size` fails**: critical path 587.7 KB gzip vs `BUDGET_KB` 560 (budget unchanged
  from HEAD). Not attributable to any single session — the tracked frontend diff is 1,570 insertions
  across 51 files plus 10 untracked provider/mapper modules. This is what **D129** records; the gate
  is doing its job. Either move weight into lazy chunks or raise the budget in a findable commit.
  A stashed or worktree baseline cannot settle this: `git stash push -- <paths>` skips untracked
  files, and a worktree at HEAD lacks them entirely, so both measure a different app.

## Next up

**The seam is complete — all 18 domains have a live consumer.** Diffing
`frontend/src/services/providers/http/*Provider.js` against `VITE_API_DOMAINS` in
`e2e/playwright.live.config.js` shows every domain is switched on. There is no next domain to flip.

**Documents — flipped on the honest subset (D124 closed, D125 raised).** The owner vault
(`DocumentsTab`) now lists, uploads and deletes through `documentService`, reads the personal/KYC
bucket from `/me/documents/personal`, and answers the request inbox through the seam; `document` is
in the live e2e allow-list and the round-trip is asserted against the real API. `useRentAgreement`'s
vault reuse, `DocVault` and `PropertyPassport` deliberately stay on `lib/` — the first needs the
bytes the signed URL withholds, the last two address mock-only managed-property ids — as does the
whole buyer half (D123). What the flip left rough is D125: failure states that read as emptiness, no
loading state. **D125's item (2) is now closed (2026-08-08):** `useDashboardData` reads the request
inbox through `listDocRequests` and grants through `respondDocRequest` (the seam), so the Documents
tab, the `leads` badge and the Action Center share one source of truth and a dashboard grant reaches
the server in http mode — covered by `consumer/account/doc-requests-grant.spec.js`. D125's remaining
items (1, 3, 4, 5) are **also closed (2026-08-08):** `DocumentsTab` now carries a per-list
`loading`/`error`/`ready` status (failed reads show a retry affordance instead of vanishing, a loading
vault shows a skeleton instead of a false `0/N`), applies each mutation's provider return value in
place guarded by a ref (uploads land on the flat they targeted, grants patch only the answered row),
and treats the non-resolving dev signed-URL as non-previewable. The only deliberate residue is the
http grant success toast (live mode has no client-side doc count to flag an empty grant — the server
is authoritative). **D125 is now fully resolved** and can be struck from the register once both the
dashboard-seam slice and this cleanup land on the same branch.

**Societies** — **UNBLOCKED (D104 closed 2026-08-08).** The catalogue now seeds the frontend's full
set (348 societies + 155 localities) from a generator; `GET /societies` carries
`avgRating`/`reviewCount` as of the reviews slice, which is what the three society-card call sites
need. The seam itself (service + providers + call-site flip) is not yet built — that is the next
society-domain slice, and it no longer 404s on real slugs.

---

## Shipped

### 2026-08-09 — Decision-blocked items closed (open-questions Q1, Q3, Q4, Q5)

Cleared the engineering-decision queue in `open-questions.md`. One index line each; reasoning lives
in the closed-question entry, the code comment, or the repo-memory lesson.

- **Q1 — valid mobile on input (option A: tolerant input, strict storage).** New
  `common.validation.@IndianMobile` (validator normalises via `MobileMask` then gates the result on
  `Formats.MOBILE`) replaces `@Pattern(Formats.MOBILE)` on all 10 input fields; 8 services normalise
  at the persist/lookup edge. `+91`/spaced now accepted; wrong-leading-digit / 15-digit still 422.
  `IndianMobileValidatorTest` + updated Deal/Conversation edge tests (167 green). OpenAPI `Mobile`
  schema gained an input-tolerance note (pattern unchanged). Frontend already hardened (`MobileField`).
  Register **D23 deleted** (→ 89 open).
- **Q3 — legacy enquiries: removed from spec** (already dropped in S45/V22; doc hygiene only, D17 deleted).
- **Q4 — saved-search count cap: max 10/user** (`SavedSearchService.create` → 409; `SavedSearchCapTest`).
- **Q5 — reels locality: carry both caption + slug** (V38 `locality_slug`; `ReelSlugFilterTest`; D16 deleted).

### 2026-08-08 — The contract's schemas are now enforced, not just its routes

`SpecCoverageTest` proved every declared route is served and every served route is declared — but
said nothing about what those routes **return**. Roughly 6,000 of the contract's 6,300 lines are
schemas, and none of them were checked against anything. A renamed DTO field passed a fully green
build and surfaced later in a generated client.

`SpecSchemaParityTest` closes that. Three tests: no declared field is absent from the returned type,
no returned field is missing from the contract, and a floor on how many operations the comparison can
resolve.

- **The link is the handler's return type, not the schema's name.** Name-matching is the obvious
  implementation and it is wrong here: the contract's `ContactRequest` schema describes the DTO
  `ContactRequestResponse`, while a JPA **entity** named `ContactRequest` also exists — so the naive
  version would have compared the contract against the database entity, agreed with itself, and
  proved nothing. Only 30 of 147 schema names match a record name anyway.
- **Names only.** Types, formats and nullability are deliberately not checked: names are where the
  drift that reaches a client lives, and false positives are how a test like this gets disabled.
- **Mutation-proven.** Renaming `authorRole` → `authorRoleTYPO` turned it red in both directions with
  the exact operation and field named. A green assertion that cannot go red is worse than none.

**Six real drifts on the first run**, all fixed:

- `authorId` was missing from two of the three `MessageDto` records. Its own Javadoc on the third
  calls it *"the field a client must use to decide 'mine or theirs'"* — attributing messages by
  display name works right up until two users share one, and then a stranger's message renders on
  the reader's own side of the thread. Both mappers already read the id to look up the name and then
  discarded it, so the fix was passing through a value already in hand.
- Five fields were on the wire but undeclared: `hideNumber` (User), `note` (SocietyLead),
  `failureReason` (RentPayment), `perHead` (FlatmateGroup), `message` (FlatmateRequest). All are
  legitimate and documented in Java — the **contract** was stale, not the code. Also corrected
  `FlatmateGroup.rent`'s description, which told clients to compute per-head themselves while the
  server was already sending it.

Two pre-existing failures surfaced and were recorded rather than papered over: **D144** (eight V32/V33
endpoints served but undeclared) and **D145** (two catalog test classes still assert 16 localities
against the regenerated 155-row seed).

Register recount, done properly this time: **105 items — 4 High, 8 Med-High, 52 Med, 41 Low**,
highest D145. Two counting traps documented in the file header.


### 2026-08-08 — Docs: one owner per fact

Prose docs **19,306 → 13,463 lines**. The premise had expired: `docs/README.md` said the set existed
because "the React app currently holds most business logic in a mock service layer; these docs
capture that logic so it can be re-implemented server-side". The backend exists now, so those
sections stopped being a spec-to-build and became an unmaintained second copy.

New rule: **if a machine enforces a fact, the docs do not restate it.** `SpecCoverageTest` enforces
the OpenAPI contract in both directions (served-but-undeclared *and* declared-but-unhandled), Flyway
validates the schema, the parity harnesses cover the mock — so only the reasoning is written by hand.

- Stripped §9 *Current mock implementation*, §10 *Target API endpoints*, §11 *Backend
  responsibilities* from all 28 flow docs (**−1,151 lines**). They are 8 sections now; the 39% that
  is *Business rules & logic* is what they were always for.
- Deleted `db-schema.md` (opened with "V1–V8 … all 9 migrations … **verified**" while the tree is at
  **V33** — confidently documenting 27% of the schema), `coverage-matrix.md`, and four dated reviews:
  `backend-api-architecture-review.md`, `mobile-design-review.md`, `roadmap/mobile-ux-review.md`,
  `docs/feature review/*`.
- **Deleting a doc is not free.** Those four reviews held 100 actionable findings: 51 shipped, 4
  already in the register, 6 obsolete, 11 duplicated in surviving docs — and **28 orphans** that
  deletion would have destroyed. Routed by kind: engineering defects → **D128–D143**; the
  never-hold-deposits constraint → a **standing ruling** (it lived in one file while D115 was asking
  the question it answers); the two flatmate product gates → **Q11/Q12** in open-questions.
- Rescued into surviving docs first: the 11 bounded contexts and their "core responsibility" column
  into `package-structure.md` §3, the four SLOs ADR-016 exists to serve into `platform-architecture.md`.
- Corrected three things that were **wrong**, not merely redundant: a standing ruling claiming
  `pendingContactCount` has no endpoint (it shipped as D78); D99 recording swipe-to-dismiss as
  deferred (`useSwipeDismiss` is wired into `Select.jsx`); and `docs/README.md` listing
  `platform-architecture.md` twice in its own reading order.
- Register counts were wrong for months because a naive `split('|')` misreads rows containing `\|`.
  Real figures: **105 rows — 4 High, 6 Med-High, 53 Med, 42 Low**, highest issued D143.

Verified: 261/261 relative links resolve, 0 BOM, 0 mojibake, OpenAPI parses with no dangling refs,
`check-coverage-citations` green, frontend build green, 17 e2e passed.


Newest first. Each line: what changed, and the one thing worth remembering.

### Frontend ↔ API integration (the seam)

| Date | Slice | Note |
|---|---|---|
| 2026-08-08 | **Three independent flatmate bugs fixed (D97 closed)** | (a) The board's "reissue the joint agreement" CTA links to `/services/rent-agreement?flat=<id>&reissue=1`, but the wizard's auto-fill effect read only `?listing=`, so that CTA opened a blank form. `useRentAgreement.js` now reads `searchParams.get('listing') \|\| searchParams.get('flat')` (a room's `propertyId` is its listing id) and, when `reissue=1`, prefills the property and confirms with a `services.ra.reissueHint` toast (added to en/hi/mr). (b) `addFlatmateRequest` (`lib/data/flatmates.js`) dropped the room `share`/`message` intent — both callers pass it and the mock provider's `requestVm` reads it back, but it was never persisted; now conditionally persisted on the record. (c) `occupancyOf` (`flatmates/model.js`) collapsed a stored `'filling'` straight to `occupied` via a single `!== EMPTY` guard, so `RoomCard` hid the whole vacant-home disclosure strip — a filling home became invisible. It now treats `'filling'` like `'empty'` and re-derives from the flat ledger. New spec `e2e/tests/consumer/flatmates/d97-occupancy-and-reissue.spec.js` covers (a) + (c) (2/2 green); (b) has no rendered consumer (the dashboard host inbox doesn't display `share`), so it's covered by code review + the provider VM. Graph re-indexed (new spec file). | A view-model that reads a field the persistence layer silently drops just returns a default forever (D97b). A single-value enum guard (`!== EMPTY`) sweeps every *other* value — including a legitimately derived one (`'filling'`) — into the terminal case (D97c). And a param-name mismatch between a link (`flat=`) and its reader (`listing`) fails open as a blank form, not an error (D97a). |
| 2026-08-08 | **Two red mock e2e specs triaged and fixed — one real a11y bug, one stale test copy (D127 closed)** | The register's D127 description was itself stale (it named the nudge-banner at line 76); running the specs showed the true failures. **`listing-freshness`** actually failed at line 73 — `getByRole('button', { name: /WhatsApp reminder/i })` found nothing because the button in `myListings/ListingCard.jsx` carried an `aria-label` ("Send the interested buyer a WhatsApp nudge…") that *replaced* its visible "WhatsApp reminder" text as the accessible name. That is a genuine **WCAG 2.5.3 (Label in Name)** violation, not a test problem, so the fix is in the component: the aria-label now leads with the visible label ("WhatsApp reminder — nudge the interested buyer to reconfirm availability"), restoring label-in-name and the role query. **`view-documents-flow`** failed at line 82 asserting stale copy `/2 document\(s\) shared/i`; the viewer now renders the i18n-pluralised `viewDocs.sharedCount_other` → "2 documents shared for your review." — an intentional improvement, so the test assertion was updated to `/2 documents shared/i` rather than regressing the copy. Both specs green (7/7). No files added/renamed/deleted → no graph re-index; specs already in COVERAGE.md. | An `aria-label` on a button with visible text *overrides* the text as the accessible name — if it drops the visible words it both breaks `getByRole({name})` and violates WCAG 2.5.3. Fix a red `getByRole` by making the accessible name contain the visible label, not by loosening the selector. And always run the spec before trusting a triage note in the register — the recorded line/cause was wrong for both. |
| 2026-08-08 | **Nine shipped-but-undeclared endpoints declared in the OpenAPI contract (D144 closed)** | `SpecCoverageTest.noUndeclaredRoutes` was red on nine served routes with no contract entry: the personal-KYC vault (`GET`/`POST /me/documents/personal`, `DELETE /me/documents/personal/{docId}`) and the managed-property lifecycle (`GET`/`POST /me/managed-properties`, `GET`/`PATCH`/`DELETE /me/managed-properties/{id}`, `POST /me/managed-properties/{id}/publish`). Declared all nine in `punenest-api.yaml` — personal-doc paths mirror the existing property-doc block and reuse the `Document` schema; managed-property paths reuse the `PropertyId` (`name: id`) param and got three new component schemas (`ManagedProperty`/`ManagedPropertyCreate`/`ManagedPropertyUpdate`) authored field-by-field from the DTOs, with `deal` enum `[buy, rent]` verified against `DealIntent.PATTERN`. All self-scoped (no `x-roles`), matching the controllers. Raised `IMPLEMENTED_FLOOR` 204→213 (exact new implemented count) and documented it in the test Javadoc; did **not** relax the assertion. 3/3 green. Contract-doc + one test constant only — no production code, no files added/renamed/deleted, so no e2e/COVERAGE/graph steps apply. | Spec-first fails silently in one direction unless enforced: a handler can ship served-but-undeclared and never have its `x-roles` reviewed. The fix is to declare the route (matching the served path/param shape so the set-equality holds) and raise the coverage floor to the real count — never to relax the equality test. |
| 2026-08-08 | **Two catalog test classes re-baselined data-driven against the generated seed (D145 closed)** | The D104 catalogue regeneration grew `R__seed_reference_data.sql` from 16→155 localities and 28→348 societies, reding 6 tests: `CatalogEndpointsTest` hard-coded `$.length()`=16/15 and `totalElements`=28 plus first-row anchors (`aundh`, `Aditya Shagun`), and `LocalityResolverTest`'s per-test fixtures collided with now-real rows (`Sus` and `Hinjawadi Phase 1` became curated localities; a real active `saras-baug` sat inside the geo radius of the inactive Pune fixture). Fixed drift-proof, not by re-typing new constants (which just resets the rot the row calls out): the catalog counts + first-by-name rows are now read from the DB via `jdbc.queryForObject` (so a future regen can't red them), the retired-locality test picks the slug to retire dynamically, and the resolver tests use two fully-fictional, geographically-isolated fixtures (`zzytopia-meadowbrook` active at 20.1,79.1 for the containment/length-floor rungs; `ghosttown-fictional` inactive at Delhi coords for the never-resolve-inactive rung), restoring the isolation that class's own docstring promises. 43/43 green. java-reviewer APPROVE; its MEDIUM (retired test still named `undri`, re-introducing the same drift) fixed by selecting the slug from the DB. Test-only — no production code, no files added/renamed/deleted, so no e2e/COVERAGE/graph steps apply. | A red suite from stale seed constants is fixed by making the test read the seed, not by re-hard-coding a bigger number — the register explicitly warned the second option just rots again. The resolver's fixtures must be *fictional and geographically isolated* to survive a growing curated catalogue; a real-world example name is a latent collision. |
| 2026-08-08 | **`lib/` render-gate predicate audit — no further instance of the D113 bug class (D113 closed)** | The `isOwner`/`hasListings` fix had shipped; the register's remaining ask was to audit other `lib/` boolean helpers used as render gates against their API equivalents. Audited: `isOwner` now derives from API-backed `listings` FIRST, with `hasListings()` + `ownsInventory` (rooms/requests/groups/managed) kept only as mock-mode fallbacks in a disjunction — they can only make `isOwner` *more* true, never falsely false, so the primary API check already catches a real owner. `hasRooms`/`hasManaged` are **not** `lib/` helpers (the register invented them) — they're local `Dashboard.jsx` consts reading mock-only flatmate/managed-property stores. `hasPayoutAccount` (rent.js) is exported but **never called** anywhere, and the rent domain is mock-only. Every remaining store-backed render gate is either a fallback behind an API-first check or gates a mock-only domain (flatSplit, society, billing, deals, rent, tenancy) where the store legitimately IS the truth. No code change. | The bug class is "a store predicate gating a component that ALSO holds API data". After the `isOwner` fix, the audit finds none: the predicate is either safe-by-disjunction (API check wins) or its domain isn't API-backed. The register's named targets were stale — measure the predicate surface before scheduling. |
| 2026-08-08 | **A declined finalization is visible to the buyer (D111 closed)** | `GET /finalization/{propId}/status` resolved through `findLiveByPropertyAndParticipant` (query ends `and fr.status = 'pending'`) and 404'd otherwise, so a declined/cancelled request read the same as never having asked — the property panel's "the owner hasn't confirmed — you can ask again" branch was dead data. Added a status-agnostic `findRecentByPropertyAndParticipant(propertyId, callerId, Pageable)` (`order by fr.createdAt desc`, same `initiator OR counterparty` scope) and pointed `FinalizationService.status()` at it with `PageRequest.of(0,1)` — it now returns the caller's newest request whatever its status, still 404 when they were never a participant. `cancel()` keeps the pending-only query (unchanged). Mock `finalizationStatus` matched (newest-regardless-of-status); http provider/`dealMapper` gap-5/`DealPanel` declined-branch doc comments corrected. 1 backend regression test (decline → status returns `declined`, was 404) + 1 mock e2e (declined row → refusal copy renders). 17/17 finalization backend green, 11/11 deals-offers e2e green. | Masking is unaffected — the mapper reveals a mobile only to a party or on `accepted`, so surfacing terminal rows leaks nothing. The declined render-gate was written defensively but is reachable in practice because a buyer can only reach a declined row via an approved contact, which is also what un-gates the status load. |
| 2026-08-08 | **`ServiceRequest.details` round-trips as a structured map (D119 closed)** | `ServiceRequestCreate.details` accepted a **string** and `ServiceRequestDto` had no `details` field, so the seam's `toCreate` flattened the customer's object to `Label: value` lines and `toViewModel` returned `details: {}` — the tracker's summary lines were mock-only and the fields the user typed were unreadable live. Converted `service_requests.details` from `text` to `jsonb` (V36, `USING` wraps any legacy plain text under a `note` key), changed the entity/create/DTO field to `Map<String,Object>` (`@JdbcTypeCode(SqlTypes.JSON)`, mirroring `Plan.features`), and passed it through `ServiceRequestMapper`. Since a `Map` can't take `@Size`, the service bounds it with `boundedDetails()` — serialize via `tools.jackson.databind.ObjectMapper` (Jackson 3) and reject >8 000 chars with a 400, mirroring `SavedSearchService.serializeFilters`. Contract's `ServiceRequest`/`ServiceRequestCreate` `details` now `[object,'null']` `additionalProperties:true`. Seam `toCreate` passes the object through and `toViewModel` reads `dto.details` (deleted `summarizeDetails`/`labelize`). 3 backend tests (round-trip, still-required-type, oversized→400); live probe confirmed a real jsonb round-trip and the oversized 400. | A structured object flattened to a summary string at the edge is a shape the mock renders and the API can't read back — the fix is a real jsonb column and a bounded map, not a create-time artifact. Jackson 3 databind lives at `tools.jackson.databind` and throws unchecked; `@Size` cannot bound a `Map`, so the length guard belongs in the service. |
| 2026-08-08 | **Plan entitlement limits are numbers on the wire (D109 closed)** | Plan listing/contact ceilings lived only as prose inside `features` (`"2 live listings"`), so the http seam kept a hardcoded `PLAN_LISTING_LIMITS` table to know the real number — a duplicate free to drift the moment the copy was reworded. Added nullable `listing_limit`/`contact_limit` integer columns (V35), seeded them (Owner Free=1, Plus=2, Pro=5, Seeker Plus=NULL; contact limits NULL — no per-plan contact consumer today), added `Integer listingLimit, contactLimit` to `Plan`/`PlanDto`/`PlanMapper`, and extended the OpenAPI `Plan` schema (`[integer,'null']`). Frontend `planMapper` now reads `plan.listingLimit` off the wire (floor of 1 via `?? FREE_TIER_LISTING_LIMIT`) and the catalogue entry carries both fields; deleted the `PLAN_LISTING_LIMITS` table and `listingLimitForSlug` from the http seam. Mock provider keeps its CATALOGUE (its own source of truth) with the numbers added and a local `listingLimitForSlug`. 1 backend assertion (Owner Plus `listingLimit`=2, `contactLimit`=null). | NULL = no cap, not a missing value: an owner plan has no contact limit and a tenant plan no listing limit. Parsing the integer back out of the sentence was the worse alternative — a paywall wrong in the generous direction leaks revenue silently. |
| 2026-08-08 | **Offer carries the buyer's preferred move-in date (D112 closed)** | `OfferCreateRequest`/`OfferDto` carried only `propertyId`/`amount`/`message`, so the offer modal's date ("Preferred move-in" / "Target possession") had nowhere to go — the http provider folded it into `message` prose and the mapper hardcoded `moveIn: ''`. Added an optional `move_in date` column (V34), an unconstrained `LocalDate moveIn` on both records, wired through `Offer` (new ctor arg), `OfferService.submit` and `OfferMapper.toDto`, mirroring the existing `tenant_profiles.move_in` precedent exactly. Contract's `Offer`/`OfferCreate` schemas gained `moveIn: {string, date}`. Provider now sends `moveIn` as a real field and the mapper reads `row.moveIn`, so the date round-trips as its own value instead of being buried in a sentence. 2 new backend tests (present → returned `2026-03-15`; absent → null). | A date the buyer typed and the owner reads only inside prose can't be filtered, sorted or shown as a field — folding into `message` was the least-bad stopgap, not the shape. The fix is one nullable column and a positional record field, not a new endpoint. |
| 2026-08-08 | **Flatmate feeds filter server-side across every facet (D116 closed)** | The three feed endpoints (`/flatmates/rooms`, `/groups`, `/me`… posts) took `(locality, Pageable)` and silently 200'd an unfiltered list for the other ten facets — "Female only" returned everyone — while `http/flatmateProvider.js` compensated by over-fetching a wide page (200) and filtering in JS, which made `total` a post-filter lie and broke past one page. Pushed the filtering into the DB: the two JPQL repos and the native seeker repo now take the facets as bound params (gender/food/roomType/furnishing/bhk/min-maxBudget on rooms, policy/min-maxRent on groups, gender/flatPref/roomPref/min-maxBudget on seeker posts), with an `any`-fallback wildcard (`or col = 'any'`) for the preference facets so a flexible post still surfaces under a specific filter, and exact match for the hard constraints. New `FlatmateVocabulary.facetOrNull` collapses both blank and `'any'` to null (= no filter), mirroring the mock's `if (v && v !== 'any')`. Facets travel as `RoomFacets`/`GroupFacets`/`PostFacets` records (8 same-typed args on rooms is a transposition trap a record closes). Provider rewritten to `clean(...)` the facets onto the query and `unwrapPage` the server's real page — `applyRoomFacets`/`applyGroupFacets`/`applyPostFacets`, `WIDE`, `pageOf` deleted, server paging restored. Contract updated (three `list*` ops gained the query params). 7 new backend integration tests (real Postgres) cover the any-fallback, exact match and budget ranges; the live filter e2e now asserts server-side narrowing + that an out-of-vocab casing slip is dropped by `vocab()` not sent. | An `any`-valued *preference* facet means "no filter", not "match only rows literally tagged any" — the naive `col = :val` would have made "Female only" return the any-rows *instead of* everyone, a subtler wrong. `facetOrNull` on the request side plus the `or col = 'any'` wildcard on the query side is the pair that gets it right. | The rough edges the async flip left in `DocumentsTab`. Every list load had `.catch`ed to `[]`, so a failed read *removed* the buyer-request panel and painted a confident wrong `0/N` checklist — replaced by a `useAsyncList` hook giving each of the three lists a `loading`/`error`/`ready` status, with a retry affordance on error and a skeleton + indeterminate ring on load (the checklist is hidden until `ready`). Mutations no longer refetch via a single shared `tick`: upload/delete/grant each apply the provider's own return value to the one list it belongs to, guarded by an `activePropRef` so an upload lands on the flat it targeted even if the selector moved, and a grant patches only the answered row. The viewer treats the non-resolving dev signed-URL host (`mock.storage.local`, D120) as non-previewable via a local `DEV_STORAGE_STUB` guard in `viewDoc` — shows `noPreviewToast` instead of a blank DNS-error tab — rather than widening the shared `isViewableDoc` security helper. The http grant success toast is intentionally left as-is (live has no doc count to distinguish an empty grant; server authoritative). New i18n keys `vaultLoadError`/`reqsLoadError`/`retry` in en/hi/mr. The five document mock specs stay green (`doc-info` 4 + `documents-vault` 1). | The loading/error states can't be exercised by mock e2e — the mock never rejects — so they land as a known coverage gap, not a brittle route-fault test; worth injecting a fault-route once the http provider is the default. |
| 2026-08-08 | **Dashboard request inbox onto the seam (D125 item 2 closed)** | `useDashboardData` no longer reads the buyer document-request inbox from `lib/data/documents.js` (localStorage) — it now reads through `listDocRequests` and grants through `respondDocRequest` on `documentService`, the same seam `DocumentsTab` uses. So the Documents tab, the `leads` badge and the Action Center share one source of truth, and a grant issued from the dashboard reaches the server in http mode instead of only writing localStorage. Load is a dedicated `alive`-guarded async effect mirroring `contactReqs`; the grant handler `await`s each id sequentially then re-reads, re-reading on the partial-failure path too so surviving grants surface. `countSharedDocs`/`notifyBuyerDocsGranted` stay mock-only behind `!isHttpDomain('document')`. New spec `consumer/account/doc-requests-grant.spec.js` (4/4). | A "seam" is only a source of truth if *every* surface reads it — one lingering direct-store read (the dashboard inbox) silently forks the truth the moment the domain goes http. |
| 2026-08-08 | **Documents — consumer flip, the honest subset (D124 closed)** | The last domain with a provider but no consumer. Four of D124's five blockers were cleared rather than argued away: the `'personal'` bucket got a real endpoint in an earlier slice, the checklist stopped re-reading localStorage (new pure `checklistFromDocs(docs)` derives progress from the rows the seam already fetched), the share ledger is mode-branched, and the "unverifiable" blocker dissolved on inspection — the probe owner **already** owns four seeded listings, so no new migration was needed. The fifth (rent-agreement vault reuse needs `dataUrl` bytes) is honoured by *scoping*: that hook, `DocVault` and `PropertyPassport` stay on `lib/`. Three synchronous reads became effects with a `live` guard; `'portfolio'` is skipped **only in http mode** — guarding it unconditionally would have made a mock upload vanish behind a success toast, which is what a review caught before it shipped. Live proof: upload/delete round-trip against the seeded owner's listing, asserting `POST` **201** and `DELETE` on the real routes; the spec clears a stale slot first so an aborted run cannot poison the next. Fixing the flip's late reflow also exposed why `doc-info.spec.js` was fragile — `Tip` closes on scroll, so the tap that scrolled the dot into view dismissed its own tooltip; both tooltip tests now settle layout and centre the anchor first, and pass 16/16 under load where the *baseline* failed 6/6 | An async flip is not a mechanical rewrite: every `.catch(() => [])` is a decision about what a failure should look like, and "empty" is usually the wrong answer. Recorded as D125 |
| 2026-08-08 | **Catalogue seed — full societies + localities (D104 closed)** | The seed shipped ~10× thinner than the frontend (28 societies / 16 localities vs 348 / 155), so most society and locality slugs 404'd — this blocked the Societies seam. The localities and societies blocks of `R__seed_reference_data.sql` are now **generated** from the frontend canonical data by `backend/tools/gen-catalogue-seed.mjs` (imports `localities.js`/`societies.js`/`societies-rera.js`; works because `frontend/package.json` is `type:module`), making the seed reproducible from the repo — the very property the old hand-written blocks lacked. All 348 societies load: the 320 MahaRERA rows were verified to carry full data (lat, amenities, year, occupancy), **not** thin stubs, so the old exclusion comment was stale. The generator validates FK integrity (every `society.locality_slug` ∈ localities; `exit 1` on any orphan — 0 found) and its `--write` mode splices in place, CRLF-aware and BOM-free. Re-run after editing frontend data: `node tools/gen-catalogue-seed.mjs --write src\main\resources\db\migration\R__seed_reference_data.sql`. Verified end-to-end: Flyway re-applies the repeatable migration on boot, and `GET /societies` / `GET /localities` serve 348 / 155 over HTTP | The vault is two-sided and only the owner's half maps to the API cleanly, so the seam is drawn there: list/upload/delete a listing's files (`/me/documents/{propId}`, the first **multipart** surface in the seam) and the owner's request inbox (`/me/documents/requests`, grant/decline). Added `postMultipart` to http.js — a `FormData` body must **not** get a `Content-Type` header (the platform sets the boundary). The mapper collapses the wire's `categories[]` to a single `docType`, keeps the requester mobile **masked**, and leaves `shareToken`/`expiresAt` null until granted; a vault doc carries both `dataUrl` (mock) and `url` (signed, unresolvable in dev — D120). The **buyer half** (ask/poll/open, token-mediated with no status read), grant notification, shared-doc counts, the doc-count badge and rent agreements stay on `lib/data/documents.js` (D123). Foundation only: providers + mapper + `parity:document` agree, but **no consumer imports the service yet** and `document` is not in `VITE_API_DOMAINS` — the async consumer migration is queued (D124). Verified: parity PASS (backend-free), eslint clean, build green |
| 2026-08-08 | **Identity verification (Aadhaar badge)** — seam domain 17 | The opt-in "Verified" badge — a badge, never a wall (ADR-019). `GET /me/verification/aadhaar` always 200s (`status:'none'` for a never-tried caller, never 404); `POST` is a **202 pending handle** (DigiLocker consent url + `ref`), *not* a granted badge — the webhook grants, and a dev backend never receives it, so in http mode the badge stays `pending` (D122). Held once in `VerificationContext` (like `PlanContext`); eight readers switched from the `isAadhaarVerified()` store call to `useVerification()`. The **write** moved onto the seam too — the shared `AadhaarVerifyModal` calls `startVerification`, mock grants instantly, http returns the pending handle and redirects. Growth perk (`applyVerifiedBadgeToListings`) and `aadhaarMobile` are mock-only (the wire has neither; mapper carries `aadhaarMobile:''` for shape parity). The seeded `users.aadhaar_verified` flag feeds the contact gate, **not** this badge — the badge's `identity_verifications` row is unseeded, which the live suite asserts |
| 2026-08-08 | **Service requests** — seam domain 16 | The honest subset of a two-sided concierge flow: list/get/create/addMessage/decideDraft go live; the rest stays mock. `details` is **write-only** (structured object in, string on the wire, `{}` on read — D119). Draft/final documents are multipart returning signed URLs a dev backend does not serve, and the per-request checklist has no read shape (D120), so the tracker's document column and inline `draft.dataUrl` preview are mock-only. Co-fill requests have no counterparty endpoint — the customer API scopes every request to its requester — so `listPartyServiceRequests` returns `[]` and `useRentAgreement.js` create stays on `serviceFlow.create` (D121). Sample-draft preview button hidden when live via `!isHttpDomain('serviceRequest')`. The `mockApi.createServiceRequest` ops-lead ticket at the landing forms is a separate system, left untouched |
| 2026-08-07 | **Flatmates** — seam domain 15 | 23 endpoints across four controllers. Two tabs over **three** resources (move-in reads rooms; team-up reads posts *and* groups), so the tab counts are not the resource counts. Seats are never inferred from `members.length` — the host sets them, and a group with three members can still have two open seats. Joining an **open-policy** group is already accepted, not pending. Found three server bugs the mock had been hiding: the default unfiltered feed 500'd on `lower(bytea)` (D117), joining 500'd for anyone with no name (D118), and every facet except `locality` is silently ignored (D116). Also caught a rename of my own making — the seam had renamed rooms' `budget` to `rent`, which would have printed ₹0 on every card |
| 2026-08-07 | **Rent, tenancies and property finances** — seam domain 14 | 21 endpoints. **Paying rent yields `due`, not `paid`** — the third domain with that shape after plans and finalization. The payout account returns a mask, never the number. Summary/cashflow/dues stopped being client reductions over a *paged* ledger. Exposed D113: the dashboard decided who was an owner from localStorage, so a real owner got the tenant view |
| 2026-08-07 | **Deals, offers and finalization** — seam domain 13 | Every signature dropped its `ownerMobile`: that parameter was the caller naming *whose* data to read, and the mock let anyone name anyone. Accept/decline are the owner's alone (403) — the property page had shipped a buyer-side Accept button. Two gaps raised: a buyer cannot see a listing is sold (D110), a declined finalization is invisible (D111) |
| 2026-08-07 | **Subscription plans** — seam domain 12 | First domain read *during render* rather than awaited, so it is held in `PlanContext`. `pending ≠ active`: buying a priced plan does not grant it — the payment webhook does. Exposed D108: the page showed ₹999 while the server charged ₹2,499 |
| 2026-08-07 | **Abuse reports** — seam domain 11 | See below |
| 2026-08-07 | **Support tickets** — seam domain 10 | See below |
| 2026-08-07 | **Reviews** — seam domain 9 | See below |
| 2026-08-06 | **Conversations** — seam domain 8 | See below |
| 2026-08-06 | **Worklog compression + OpenAPI 3.1 nullable fix** | See below |
| 2026-08-06 | **Notifications** — seam domain 7 | Server/UI type vocabularies had *zero* overlap; untranslated, every filter chip would silently empty the page. `dismiss` is a client tombstone (no endpoint) |
| 2026-08-06 | **Listing moderation** — `GET /admin/properties` + the 4 decisions | The four writes had shipped months earlier with **no read that could find a listing to act on**. Inferring the route from filter flags 403'd every owner's dashboard — authorization-relevant routing must be named by the caller |
| 2026-08-05 | **Visits** — seam domain 6 | Reschedule has no endpoint (D87); the seam carries the human `when` string and converts to the wire's ISO slot |
| 2026-08-05 | **Saved searches + alerts** — seam domain 5 | Anonymous lead capture stays local (D85) — `POST /me/saved-searches` would 401 for exactly the signed-out visitor the card exists to capture |
| 2026-08-04 | **Saved shortlist** — seam domain 4 | Membership answered from `SavedContext`, never per card — the naive conversion was 30 requests to draw 30 hearts |
| 2026-08-04 | **Contact gate** — seam domain 3 | Keyed on `propertyId`: the grant is per listing, not per owner |
| 2026-08-03 | **Owner number-hiding, city on profile, paged contact inbox** | Backend prep for the contact slice |
| 2026-07-30 | **Property** — seam domain 2, incl. `localitySlug` hardening | `construction`/`possession` was the one divergence that *broke* a feature rather than degrading it — fixed in the contract, not papered over in the client |
| 2026-07-29 | **Auth** — seam domain 1, Phase 0 + 1 | Established the provider pattern and the parity-harness habit |
| 2026-07-28 | **Phase 2a** — route property consumers through `services/` | 21 files imported `lib/` directly; a seam with a bypass is not a seam |

### Backend slices (OpenAPI-first, 208 operations)

| Date | Slice | Note |
|---|---|---|
| 2026-08-07 | **Tech-debt pass** — D90, D82, D19, D22, D83, D86, D97(d), D95 closed; D33 rule amended | **The register's own numbers were the least reliable thing in it** — D19 said "7 files, cosmetic" (22 files, mangled ₹ in live prices); D96 said "50 specs" (9); D33 said 562 `@param` (673). A `@Transactional` test base class **cannot see a commit-time bug** — D90 survived 750 tests. And a mutation test caught a *bad assertion*: the D95 perk test passed with the guard disabled, because an unguarded grant moves to the next listing rather than re-extending the first |
| 2026-08-02 | **Tech-debt batches** — D1 Lombok, concurrency, register audit | Three passes; the register is now the SSOT for what is owed |
| 2026-08-01 | 15 — share-flat + admin listing correction (4 ops) | `adminUpdateProperty` shares one `apply` with the owner path — two copies would drift |
| 2026-08-01 | 14 — Admin & Analytics (13 ops) | Revenue blanked for staff; `/admin/finance` is admin-only |
| 2026-07-31 | 13 — Billing & Growth (14 ops) | |
| 2026-07-31 | 12 — conversations + support tickets | Thread creation requires an approved contact request — the constraint the conversations seam slice will have to design around |
| 2026-07-31 | 11 — service requests + staff ticket queue (13 ops) | |
| 2026-07-30 | 10 — Documents & agreements | Storage keys server-minted; content type derived from bytes, not the client header |
| 2026-07-30 | 9 — Moderation / Trust & Safety (20 ops) | Spec fix S28: `archive`/`restore` are dual-audience, so their guard lives in the service — `@PreAuthorize` can express "is staff" but not "is staff or owns this row" |
| 2026-07-29 | 8 — Reviews (S26/S27, migration V16) | `context` is readOnly — a settable one is the forgery vector |
| 2026-07-29 | 7 — Catalog & Search, + pagination and OTP rate-limiting pass | Every sort must be index-backed |
| 2026-07-28 | 5 — finance ledger + tenancy lifecycle | |
| 2026-07-28 | 4 — deals / offers / visits | |
| 2026-07-27 | 3 — contacts + gate + Aadhaar badge | |
| 2026-07-27 | 2 — properties + listings | Slug-or-id resolution: parses as UUID → by id, else by slug |
| 2026-07-26 | 1 — auth + users | |
| 2026-07-26 | **Package structure** — bounded-context layout | |

### Database

| Date | Change | Note |
|---|---|---|
| 2026-08-04 | **One populated local DB, schema by Flyway only** | Closed D81 the day it opened. Three permanent Flyway traps recorded in `R__zz_dev_demo_data.sql`'s header — repeatable migrations sort by description across *all* locations (hence the `zz_` prefix), `ON CONFLICT (id)` is too narrow for a seed, and data extracted from an old schema is not automatically valid under the current one |

### Mobile-first programme

| Date | Phase | Note |
|---|---|---|
| 2026-08-05 | Home "Flatmates" tile optimisation | |
| 2026-08-05 | Mobile review B5 / C5 / D1 + CI | B7 blocked on a product call (D98) |
| 2026-08-03 | Desktop e2e triage | |
| 2026-08-03 | Phase 6 — deferred-item sweep | |
| 2026-08-02 | Bundle — eager vendor chunks | **571 KB off first paint.** `financeProvider → lib/data/finances.js → jspdf` was statically imported *and* `modulepreload`ed, so every mobile visitor downloaded a PDF library to see a listing |
| 2026-08-02 | Phase 4 — §F items incl. PWA (#17) and landscape (#24) | |
| 2026-08-01 | Home Phase 3 — featured-first, search-on-demand | Featured moved above Categories on mobile via CSS `order`, leaving DOM order (and every desktop spec) untouched |
| 2026-08-01 | Phase 2 — mobile-design-review sweep, waves H–R | |
| 2026-07-31 | Phases 1, 3, 4, 5 — content, touch targets, native affordances | |
| 2026-07-31 | Rename "Share Flat" → "Flatmates" | Internal enum values stay `'share'` on purpose — renaming would orphan persisted localStorage |

### Trust model & KYC

| Date | Change | Note |
|---|---|---|
| 2026-07-28 | **Badge-not-gate migration**, 8 pages + consistency sweep | ADR-019. Verification is a badge that earns visibility, never a precondition to act |
| 2026-07-28 | KYC growth levers, native DigiLocker consent flow | |
| 2026-07-27 | Trust model pivot documented | Open product questions live as Q6–Q10 in `open-questions.md` |

### Docs & contract

| Date | Change |
|---|---|
| 2026-08-08 | **Encoding guard restored (D126 closed).** Stripped UTF-8 BOMs from 18 committed files via `node e2e/scripts/fix-mojibake.mjs` (BOM-only — 0 content bytes changed); `SourceTreeHygieneTest.noMojibakeOrBom` now green, so the ban on non-UTF-8 source writes is live again. Disproved D126's guess that the BOM broke `listing-freshness.spec.js` — it still fails on a nudge-banner assertion after the strip, so the two standing mock e2e failures are functional drifts, not encoding (re-recorded as D127) |
| 2026-08-02 | Re-sync docs + OpenAPI to the flatmates redesign & mobile-first UI |
| 2026-07-27 | 3-way sync: `platform-architecture.md` (SOT) → OpenAPI → React |
| 2026-07-26 | OpenAPI established as the single source of truth; matured to cover all React needs |
| 2026-07-25 | Platform & solution architecture (MVP pass), ADR-009a KYC, ADR-014 payments, legal/compliance advisory |

---

## 2026-08-07 — Switching on the four domains that were live on paper only

`contact`, `saved`, `savedSearch` and `visit` shipped complete http providers and parity harnesses
in `e330cd3`, but were never added to `VITE_API_DOMAINS` — so no browser had ever run them, and
every live e2e run since had been quietly exercising their mocks. Added to the live config; the
seam is now 11 domains live, not 7.

The parity harnesses had passed the whole time, which is the point. A harness imports the provider
and calls it; it cannot see a React call site that never awaits, or a request fired for a visitor
with no session. Five things were wrong and none were visible from that angle:

- **`isHttpDomain('savedSearch')` could never match.** The allow-list is lower-cased when parsed,
  the lookup key was not. Worst-case failure mode: the "enabled but has no http provider" warning is
  itself gated on `isHttpDomain`, so the domain served mocks with **nothing in the console** — a live
  run would have passed while testing the mock (D105).
- **A signed-out visitor fired four `401 /contacts/status` per property page.** The gate asks where
  *this caller* stands; someone with no session has made no request, so the server can only say 401.
  Short-circuited on `readAccessToken()`; the 401 branch stays as a fast-path backstop.
- **`PageEnvelope.page`, read as Spring's `number`** in four providers, each behind a fallback that
  resolved to the *requested* page — right until the server clamps or redirects. Two parity
  harnesses had the same bug in their own unwrapping, which is why it cancelled out and went
  unreported (D106).
- **Both alert cards showed "first in line" without awaiting the create.** Now awaited, with an
  `alertFailed` toast in en/hi/mr and a disabled submit while in flight.
- **Reschedule fired at a provider that throws by design** (D87), from a handler that closes the
  modal and toasts success first — so the user would have seen "Rescheduled" *and* an error at once.
  Control hidden in http mode, same treatment as support's priority picker.

Also fixed: the four oldest parity harnesses could not run under Node ≥ 22 at all (bare `db.json`
import, `import.meta.env` outside a bundler), so "the harness passes" had been vacuously true —
migrated to the Vite SSR loader the newer three already used (D107). And `AdminReports`' detail
drawer still rendered the Reopen button removed from the rows a slice ago, referencing an import
that no longer existed: a lint error, and a control that would 409 on click.

---

## 2026-08-07 — Abuse reports: the 11th seam domain

`POST /reports` · `GET /reports` (staff/admin, paged) · `PATCH /reports/{id}`. `reportService.js` +
mock/http providers + mapper, `parity:report`, live e2e walking the whole loop across two sessions.
The **first domain whose two ends have different audiences** — anyone files, only ops reads.

**The bug: a reason set that contradicted its target type.** The server validates the reason
*against* the target type. `SHARE_REPORT_REASONS` is `FOR_POST` exactly — but `Flatmates.jsx` and
all three flatmate cards passed `kind='user'` or `'listing'`. **Every flatmate report would have
been a 400**, because `filled` is not something you can say about a person. It survived because the
mock stores whatever it is handed: the report landed, the user was thanked, and it appeared in the
ops queue under the wrong tab. Fixed at four call sites; the mapper now warns on an unknown kind.

**Three server rules with no mock equivalent, each of which changed a control:**

- **Duplicate → 409.** The modal closed and toasted success unconditionally, because a localStorage
  write cannot fail. Thanking somebody for a report nobody received is the outcome worth avoiding —
  they stop worrying about it.
- **Terminal is terminal.** "Reopen" would 409 on click, so it is gone. Re-opening erases the record
  that somebody judged it, and is how one moderator quietly undoes a colleague's decision.
- **`resolved` does not exist server-side.** Translated to `dismissed` on the way *out* only, so the
  queue never displays a status the server did not record.

**What the wire withholds, and why nothing was invented:** `reporterId` is omitted on purpose —
"naming the reporter to every member of ops is how a complaint becomes a reprisal". `targetTitle`
falls back to the bare id rather than being resolved, because a resolved title would be a **stale**
one: the listing may have been edited since it was reported, and judging yesterday's complaint
against today's copy is worse than opening a tab.

**Process:** the live test's "a consumer gets 403" probe was removed rather than kept — an in-browser
`fetch` carries no bearer token, so it asserted 401-unauthenticated, not 403-wrong-role. Same class
of mistake as last slice's vacuous badge assertion. The real 403 is asserted in the parity harness,
which signs in as an actual consumer. Mutation-verified: `share→user`, terminal-status and the 409
handler were each broken on purpose and each caught.

---

## 2026-08-07 — Support tickets: the 10th seam domain

`GET|POST /support/tickets`, `GET /support/tickets/{id}`, `POST .../messages`, `POST .../read`.
Five endpoints, one page, a one-to-one mapping onto the mock's five functions. `supportService.js`
+ mock/http providers + mapper, `parity:support`, live e2e. 6/6 mock e2e, parity PASS
(mutation-verified 4×), live test verified red-able.

**Three controls had nothing behind them**, and hiding them is the slice:

| Control | On the wire | Shipped |
|---|---|---|
| Priority (low→urgent) | absent from `SupportTicket` **and** `SupportTicketCreate` | hidden in http mode |
| Attachments (4 images) | `MessageCreate` is `{ body }` | hidden in http mode |
| Name / mobile | absent — the raiser is the session | left visible, D102 |

The first two had to be *hidden*, not merely not-sent: **an unknown property is ignored, not
rejected**, so a form that kept sending `priority` would show a success toast for a ticket ops never
sees as urgent. Worse than an error, because nobody learns anything.

**Three vocabularies to reconcile**, each with a wrong answer that looks right:

- **Status** — the server opens every ticket `open` (no `new`) and has an `in-progress` the page
  cannot label. Passed through unchanged rather than collapsed onto `open`: erasing a distinction
  ops made would tell the customer nothing was happening while somebody worked on it (D103).
- **Author role** — `buyer|owner|staff|admin` → `customer|staff`. `owner` is a *customer* of
  support. The first parity harness could not catch this because the probe signs in as a buyer; it
  now drives every role through the mapper directly. That gap was found by mutation, not by reading.
- **`updatedAt`** — not on the wire at all, and the list sorts by it. Derived from the last message;
  the server's `createdAtDesc` would put a ticket answered this morning below one opened last week.

**Scoping finding (D104):** I checked Societies first — it looked unblocked, since the reviews slice
had just added `avgRating`/`reviewCount` to `GET /societies` for exactly that purpose. It is not:
the frontend ships **348 societies and 155 localities**, the database has **28 and 16**. Migrating
would 404 on 92% of society hubs. The same check killed Localities. Catalogue reference data is
seeded thinly across the board, which is why this slice went to a *user-generated* domain instead —
those have no alignment problem, because the rows are created by the user at runtime.

---

## 2026-08-07 — Reviews: the 9th seam domain

`GET|POST /reviews/property/{id}` and `GET|POST /reviews/{entityType}/{entityId}`.
`reviewService.js` + mock/http providers + mapper, `parity:review`, live e2e. Backend: `avgRating`
and `reviewCount` added to the society **directory** row (they were already on the hub), computed
through the existing batched `RatingLookup`. 25/25 review endpoint tests, parity PASS
(mutation-verified twice), live suite green.

**The slice is that the wire is stricter than the mock, and the strictness is the product.**

`context` is the reviewer-standing badge — "Verified resident" / "Visited". It is derived
server-side from visit and tenancy history and is `readOnly` in the contract. Three call sites were
asserting it anyway:

- `ReviewModal.jsx` sent `context: 'visit'` hard-coded on **every** submission;
- `useSocietyHub.js` sent `resident: isVerifiedResident(slug)`, a client-side lookup;
- `ReviewsSection.jsx` rendered the chip **unconditionally**, so a null `context` fell through the
  ternary and displayed "Visited".

The first two were discarded live and believed on mocks — the worst split available, because the
demo and the screenshots come from mocks, so the badge earned its credibility exactly where it meant
nothing. The third is not a provider bug at all: the provider returned the correct null and the card
invented a badge from it. A badge a browser can assert about itself is not evidence, and evidence is
the only reason a stranger's rating is worth reading.

**Two key bugs, same shape, both invisible on mocks** — a localStorage map will key on any string
you hand it, so neither could fail until there was a server to disagree with:

- The society hub keyed reviews on `soc.id` (a synthetic `S01`) while follow, Q&A, resident status,
  board and WhatsApp all already used `soc.slug`. Reviews were the single holdout.
- The locality page keyed reviews on `activeName.toLowerCase()` — the *display name* — while its
  listings query, societies filter and URL used the slug. One-word localities agree, which is
  exactly why it survived; `viman nagar` vs `viman-nagar` is where it did not.

**What was deliberately not migrated, and why:**

- **Owner reviews** stay on the mock store. `getOwner()` still reads `lib/mockApi/users.js`, so the
  target id is a mock user id and the server keys on its own UUIDs. Migrating would issue a
  well-formed request for an owner the server has never heard of and render the empty result as "no
  reviews yet" — a silent wrong answer, worse than an honest mock.
- **The three society-card rating sites** call `entityRating()` inside a `.map()`. The fix is not to
  point them at the reviews service (one request per card) but at the aggregate the row now carries.
  Hence the backend addition; they hold SEAM NOTEs saying so.

`avgRating` is **null, not 0**, for an unrated society: a card rendering 0.0 for a society nobody has
reviewed states something false about it. The fields moved *up* from `SocietyDetail` to `Society`
rather than being duplicated, so the hub and the directory cannot drift into two different numbers.

---

## 2026-08-06 — Conversations: the 8th seam domain

`GET/POST /messages`, `GET /messages/{id}`, `POST /messages/{id}/reply`, `POST /messages/{id}/read`.
`conversationService.js` + mock/http providers + mapper, `ConversationContext` behind the navbar
badge, `Messages.jsx` and nine other `lib/chat.js` importers migrated, `parity:conversation`, live
e2e. Backend: `authorId` on `MessageDto`, and a notification written to the other side on every
reply. 750 backend tests green, 15/15 mock chat e2e, live suite green, parity PASS.

**The five shape gaps and the ruling on each** — these are the slice; the wiring was routine:

1. **`state: active|pending|incoming` does not exist server-side.** A thread only exists *after* an
   approved contact request (`ConversationService.related`), so every server thread is `active`.
   `pending` stays a **client-side staging queue** (`pnPendingRequests`) drained into `POST /messages`
   once approval lands. `incoming` — and the accept/decline buttons that act on it — are mock-only:
   on the server there is nothing left to accept, because the contact gate already did it.
2. **`youAre` is not on the wire.** Derived from `counterpartyRole`. An approximation, documented as
   one — a user who is both owner and buyer is classified per thread, which is what the page needs.
3. **`property.{price,loc,img}` are absent** — the wire carries `propertyId` + `propertyTitle` only.
   Degrade to title; resolving the rest would be N property reads per inbox render.
4. **`from: me|them` could not be derived safely.** `MessageDto` carried `author` (a *display name*)
   and no id, so the client would have had to match identity by string — works in dev, breaks the
   first time two users share a name. Added `authorId`; the test seeds two users called "Same Name".
5. **Share chips have no server representation.** The contract declares `MessageCreate.attachments`;
   the Java record does not implement it. Marked NOT IMPLEMENTED in the spec rather than invented.

**Three bugs the slice surfaced, all of which the mocks were hiding:**

- **Same-rank dependency.** `ConversationService` reaching into `engagement.notification` to write
  the notification is a cycle (leads=2, engagement=2) and `ArchitectureBoundaryTest` failed on it.
  Fixed with a `common.trust.Notifier` port — the pattern `ContactGate`/`RatingLookup` already set.
  That port is now the reusable mechanism for the rest of D92.
- **`property.img: ''`.** `<img src="">` makes the browser re-request *the current page* as the
  image. Mocks always had a URL, so it only appeared live, as a console error the e2e asserts on.
- **The inbox omits `messages`.** `ConversationDto.messages` is `NON_NULL` and the list contract
  drops it — a hundred previews would otherwise cost a hundred transcripts. The page worked
  perfectly on mocks (one store, whole objects) and opened an *empty thread* against the API. Fixed
  by hydrating on open. **A second-order bug fell out of the same async move:** the deep-link effect
  (`?c=<id>`) ran once at mount against a `convs` that was no longer populated synchronously, so it
  silently opened nothing — caught only because the mock e2e suite still deep-links. Both are the
  same lesson: *replacing a synchronous store with a fetched one changes when every reader runs.*

---

## 2026-08-06 — Worklog compression + OpenAPI 3.1 `nullable` fix

This file had reached 5,294 lines with 86 unticked boxes, and its own header already admitted the
boxes "are not a backlog". That is the failure mode worth naming: **a worklog that is never pruned
stops being read, and an unread list of open items is indistinguishable from having none.**

### What the 86 open boxes actually were

Each was checked against the tree rather than trusted.

- **62 had already shipped.** The 20 slice-2 property reconciliation and build-task items, the 14
  Home Phase 3 items, the 7 S26/S27 + migration-V16 items, the bundle bug, and the JDK-version
  blocker (`local JDK is 17, backend targets 21` — the toolchain is Zulu 25 and 747 tests pass).
  They were never ticked because they were *decision records* written in checkbox form.
- **3 were fixed here.** Both remaining ones were comments that contradicted their own code:
  `submit.js` claimed identity was "guaranteed by the Aadhaar gate" when the floor is L1 sign-in —
  a leftover from the pre-badge-not-gate model, and exactly the sort of stale comment that gets
  believed. `useFlatmateDiscovery.jsx` documented a "unified" `h-9`/`rounded-xl` scale on the line
  directly above one emitting `h-10`/`rounded-full`.
- **21 moved to the register** as D95–D99, or were already there (the SEC items, rate-limiting,
  Cashfree and the Wave L sheet all had entries).
- **2 were duplicates** of `open-questions.md` Q6–Q10.

**One was wrong in a way that mattered.** A "dead artefacts — no importers" note listed three files
to delete. `QuickFilters.jsx` was indeed already gone, but `FlatmateFields.jsx` is imported by
`Step1.jsx` and `REPORT_REASONS` has four importers. Acting on that note would have broken the
build. Recorded because it is the argument for verifying a stale note before acting on it, not just
before deleting it.

### The OpenAPI fix

The spec declares `openapi: 3.1.0` and used the 3.0-only `nullable: true` keyword **66 times**. In
3.1 that keyword does not exist and is ignored silently, so all 66 fields were documented as
non-nullable and a generated client would have typed them as required-non-null.

Converted to the 3.1 spelling — `type: [string, 'null']` — by a scripted pass over three shapes:
60 inline flow mappings, 5 own-line under a block mapping (one of which sat *below* a `format:`
line, so the transform walks back to the sibling `type:` rather than assuming the line above), and
one `allOf: [$ref] + nullable` that a type array cannot express at all and became an explicit
`anyOf: [$ref, {type: 'null'}]`.

`'null'` is quoted deliberately: inside a YAML flow sequence, bare `null` is the null *value*, not
the type name JSON Schema needs.

Verified: `validate_spec.py` → 166 paths / 147 schemas / 208 ops, no dangling refs; 66 type arrays
present, 0 `nullable:` keywords left; file still CRLF, no BOM, no mojibake.

### Deliberately not done

`e2e` console filtering (D96) — 50 of 67 specs assert "zero console errors" with no noise filter
while `helpers/console.js` exists for exactly that. It is a 50-file mechanical change, and burying
one inside a cleanup pass is how a cleanup pass stops being reviewable.
