# Worklog

> **A finished slice gets one index line here, not a narrative.** Git history is the archive; this
> file is the index into it. Open work gets a bullet, and the bullet is deleted the moment it is
> fixed or moves into a numbered ledger row. Do not restate a decision here — link to its number in
> [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md). Compressed 5,294 → 527 → 1,828 → 4,348 → this.

Where things live:

| Topic | File |
|---|---|
| Open decisions and the damage-ordered work queue | [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md) |
| Durable rules learned the hard way, and house style | [tasks/lessons.md](lessons.md) |
| Tech debt | [docs/system/tech-debt.md](../docs/system/tech-debt.md) |
| Unanswered product questions | [docs/system/open-questions.md](../docs/system/open-questions.md) |
| The frontend data seam | [docs/system/frontend-data-seam.md](../docs/system/frontend-data-seam.md) |
| Migration plan and phase status | [docs/migration/README.md](../docs/migration/README.md) |
| e2e coverage matrix (hard gate) | [e2e/COVERAGE.md](../e2e/COVERAGE.md) |

---

## In flight

**Mock retirement.** All 18 seam domains have live consumers. Phases 0–4 are done; Phase 5 (retiring
`lib/mockApi.js` and the `lib/data/**` stores) is in progress. Remaining work is enumerated as
numbered rows in the ledger, in damage order. The consumer-first slice just closed is rent-agreement
co-fill: deferred checkout, an invite addressable to an **unregistered** mobile, and party-side
details submission. Written end to end; the live e2e run is the outstanding step.

Two things that are true and are not going to change soon:

- **The Cashfree sandbox-verify gap has no possible e2e.** The mock provider returns no
  `paymentSessionId`, so no automated run can reach the hosted checkout. It stays manual.
- **`PUNENEST_DEV_MACHINE` is mandatory for the `dev` profile.** The backend refuses to boot without
  it. It is set per machine, not in the repo.

### Closed recently

- Ledger 20 (finance console) is shipped and verified (`023c311`).
- Ledger 35 (`GET /geo`) is shipped and closed in the decision register.
- Rent-agreement co-fill (V107) — backend at `b7bc2fa`, frontend seam, wizard and live e2e at
  `499732d`. Run and green: 5/5 in the live service-request block. The run earned its keep — it
  caught `http/serviceRequestMapper.toViewModel` dropping `parties` on the wire, which no mock spec
  could have seen, since the mock builds its own party list.

## Needs attention

Open items with no ledger row. Anything covered by a decision is cited, not restated.

**Data and schema**

- `idx_properties_society_unit` (V79) indexes a column combination nothing queries. Both options —
  drop it, or `comment on index` explaining why it is kept — cost a new migration, because V79 is
  applied and editing it breaks its checksum.
- `flatmate_rooms.society_id` has the FK-as-409 shape that D218 fixed for `properties`: a bad society
  reference surfaces as a constraint violation instead of a 400 naming the field.
- No guard test asserts that a `V__` migration never inserts into a table the e2e reset truncates.
  The V78 `message_template` incident is fixed; the class of bug is not prevented.
- `confirmListingFresh` writes `freshenedAt` to localStorage and the API has no such column, so
  freshness is measured from `createdAt` and **cannot be reset**. The admin Recheck tab and
  `AdminProperties.jsx:296`'s sort both read the absent field. Needs a column and a route.

**Silent failures**

- `toListingUpdate` drops non-whitelisted keys without warning. `AdminProperties.jsx:428` passes
  `bhk`; the mapper reads `bhkNum`, so a BHK correction is discarded and the toast says it saved.
- `flagReason` is ungated on the public property detail response — moderator-facing prose served to
  anonymous callers.
- There is no HTTP-level write throttle on any route. Rate limiting exists only on OTP.
- `postInternalOnce` scans the whole thread in memory on every write.
- `PropertyResponse.adminPipeline` is not flattened by any http mapper, so six back-office readers
  are silently dark on live builds. Precondition for ledger 27.
- `PropertyReviewModal.jsx:391` returns `null` when either the review or the thread fails to load, so
  a failed case-file load is indistinguishable from a dismissed click.
- **The admin moderation console reads a partial catalogue, and the tripwire is now red.** The
  e2e catalogue crossed the page ceiling (102 listings against `spring.data.web.pageable.max-page-size=100`),
  so `warnIfTruncated` fires on both `/admin/properties` reads and `live-property-integration.spec.js`
  `:689` and `:720` fail in their shared `afterEach` — their own assertions pass. Confirmed
  pre-existing, not a Wave C regression. Consumer surfaces are unaffected *today*: the public
  approved catalogue is 47. Fixing it is a **P6 slice**, deferred there by decision on 2026-08-20:
  `listForModeration` returns a flat array and four screens aggregate over it client-side
  (`AdminProperties` tabbed table, per-tab counts and the recheck queue; `AdminDashboard` headline
  counts; `AdminPostOnBehalf` pending list), so a real fix is a page envelope plus server-side counts
  plus pushing the table's filters and sort onto `/admin/properties` so the server pages a *filtered*
  set. Raising `PAGE_SIZE` is not a fix and the server clamps it anyway — that is the mistake the
  tripwire's own docstring records.
- The review modal's open effect double-POSTs under StrictMode. Harmless since D221's advisory lock,
  but it is why a real server bug hid for weeks.

**Content and admin surfaces**

- The three editorial content endpoints shipped empty for three different reasons: `banners` cannot
  round-trip through the admin console, `announcements` and `services` have no admin write routes at
  all, and production answers `[]` for FAQs. Each needs its own decision.
- The live FAQ list has no `Sort`, so it is heap order; the mock's order was editorial.
- `MyListingsPanel.jsx:258` calls `sendWhatsappTemplate`, which 403s for owners. Either widen the
  guard or drop the control — pinned in place by `admin/live-outreach` test 6.
- `sendOwnerReminder` has zero callers and dies with the mock.
- The audit tab needs three small rulings before `logAudit`'s 44 call sites are deleted: whether the
  clear button survives, whether the uuid column is shown, and what the detail sentence reads.
- Flatmates gender filter (`FilterBar.jsx:130`) carries selection only in a CSS class; its four
  siblings all set `aria-pressed`. Accessibility finding, product change.
- Three surfaces still average reviews in the browser (`useSocietyHub`, `Owner.jsx`,
  `locality/ReviewsBlock`) — D79's aggregate endpoint is property-only.
- `hasTenancy` in `ReviewsSection` is mock-only, so the "Tenant" reviewer badge cannot render live.
- The mock `propertyReviewProvider` is missing two D218 behaviours (ordering column, staff-note lane).

**Structure**

- `ListingService` is 17 lines from the 450-line guard. `updateAsModerator` extracts cleanly to
  `ListingModerationService`. Note that `frontend/scripts/check-listing-foundation.mjs` parses the
  file **as text**, by path and regex, so the split has to update the script in the same commit.

**Verification gaps**

- Property reviews have no live e2e; `review-parity.mjs` probes a locality instead.
- The two D160 payment-cap 409s cannot be reached by e2e yet.
- `RentMapper`'s `@Mapping(ignore)` belongs to D167 and is untested.
- `backend/.env.local` secrets were surfaced on 2026-08-09. Rotate if there is any doubt.

**Flaky set** — re-measured 2026-08-13 over a full sweep (1,708 tests, 0 failed, 9 flaky). All are
viewport, scroll or animation timing. **Never relax an assertion to close one**, and never run a
build or `graphify` during an e2e run.

- `platform/desktop-noleak-guardrails.spec.js` :267 :282 :291 :328
- `mobile/landscape.spec.js:101`
- `mobile/phase3.spec.js:157` — both mobile projects
- `mobile/topbar-scroll.spec.js:61` — both mobile projects

**Decided elsewhere** — geo policy → ledger 35 · locality queue → 24 · own-listing dedup → 23 ·
saved-search count → 33 · society follows → 34 · internal notes → 29 · referral reward → 31b ·
society binding → 19 · pipeline stages → 27 · managed properties → 32 · `services` CMS type → 26 ·
admin enquiries → 25 · finance console → 20 · analytics tiles → 36 · "Posted by PuneNest" badge →
still undecided · `wa-pricing` → resolved.

## Next up

The ledger's damage order. Items 35, 24, 23, 33, 34, 29, 31b, 19, 27, 26, 32 and 25 are built; the
queue is now **20 (finance console) then 36 (analytics tabs)**. Clear item 36's analytics trap early:
`AdminAnalytics.jsx:35` calls `getAnalytics()` from `mockApi.js` and `:59` gates the whole page on
it, so deleting the mock hangs the page including its one working tab.

---

## Shipped

Newest first. One line per slice; the commit is the record.

| Date | What shipped |
|---|---|
| 2026-08-17 | Every open migration decision closed; the 1,975-line register collapsed to a 205-line ledger |
| 2026-08-16 | Admin command palette stopped searching `db.json` fixtures on live builds |
| 2026-08-16 | D230–D234, and the closing summary of the autonomous window (`8cecfe5`..`45f9168`) |
| 2026-08-16 | D227–D229: the 36-row `mockApi.js` importer table, and its two corrections |
| 2026-08-16 | D226: the `ui-only` census bucket — routed screens that fetch nothing |
| 2026-08-16 | The route census (227 resolved / 35 unreached), now a committed script, and 195 dead exports |
| 2026-08-15 | D225: 105 sleeps and 122 `networkidle` calls triaged; the eight silent-skip guards |
| 2026-08-15 | D223/D224: the test-quality sweep and its corrections — what a green suite was hiding |
| 2026-08-15 | The `rawDb`/`mutateDb` cluster and the `fee()` survey, both closed |
| 2026-08-15 | Wave 4a: "Anonymous" → "Withheld", and the reason labels that had forked in five places |
| 2026-08-15 | D217: the propertyReview mock that copied the business rules and not the access rules |
| 2026-08-14 | D218: ordering column, duplicate detector, staff-only note lane — and four ways the green suite lied |
| 2026-08-14 | D219: the owner listing wizard onto the seam; six ways a never-run suite had rotted |
| 2026-08-14 | Wave 4: masked fields made read-only; `/admin` ruled administrator-only |
| 2026-08-13 | D216: outbound messages and templates, classified by the DPDP erasure guard |
| 2026-08-13 | Phase 5 pre-port audit — `permissions.js` and `contact.js` need no port, both already enforced server-side |
| 2026-08-13 | Debt wave 14: four e2e sweeps that died to infrastructure; the flaky set re-derived |
| 2026-08-13 | Phase 3: the referral retention sweep that had never once run; `punenest_test` reference data restored |
| 2026-08-13 | The prod profile became a tested contract; the container can be told its port |
| 2026-08-12 | Debt wave 10: seven write-disjoint lanes, ten register rows closed |
| 2026-08-12 | D133 closed won't-do; D158 re-verified still blocked — both measurement tasks, both registers wrong |
| 2026-08-11 | Debt wave 11 close-out: six register rows; debt wave 9: six lanes and the register's last High |
| 2026-08-11 | D193/D195/D198: a 404 that claimed to be a 500, an invented star rating, thirty unnamed buttons |
| 2026-08-11 | Society reviews get their own aspect vocabulary; Q14 answered — the foundation set splits |
| 2026-08-11 | D174, D175, D50/D51, D100, D42 and the e2e reliability pair (D28/D29) |
| 2026-08-10 | D79 wired up, plus the two defects hiding behind it; D163, D132, D47, D129 (partial) |
| 2026-08-09 | D77 paged inbound demand; D151 identity numbers reach one operator and stop existing |
| 2026-08-09 | Payment hardening (D169–D172); every payment family got the cap and the sweep (D160/D161) |
| 2026-08-09 | Paid Leave & License, and the thirteen register rows its review opened |
| 2026-08-09 | Eight decision-blocked register items closed; open-questions Q1–Q5 answered |
| 2026-08-08 | Encoding guard restored (D126); the contract's schemas enforced, not just its routes |
| 2026-08-08 | D144: nine shipped-but-undeclared endpoints declared; D145: catalog tests re-baselined against the seed |
| 2026-08-08 | D111/D112/D119/D109/D116/D97/D127/D113 — the flatmate and deals defect batch |
| 2026-08-06 | Worklog compression 5,294 → 527, and the OpenAPI 3.1 `nullable` fix (66 fields typed non-null) |

### The seam — 18 domains

| Date | Domain | The thing worth remembering |
|---|---|---|
| 2026-08-09 | Flatmate moderation | A visibility blacklist is a leak waiting for the next state |
| 2026-08-08 | Documents (17) | Multipart: a `FormData` body must not get a `Content-Type` header |
| 2026-08-08 | Identity verification (18) | `POST` is a 202 pending handle, not a granted badge — the webhook grants |
| 2026-08-08 | Service requests (16) | `details` was write-only until it became a real `jsonb` column |
| 2026-08-08 | Catalogue seed | 348 societies / 155 localities, generated from frontend data and FK-validated |
| 2026-08-07 | Flatmates (15) | Seats are set by the host, never inferred from `members.length` |
| 2026-08-07 | Rent and tenancies (14) | Paying rent yields `due`, not `paid`; the payout account returns a mask |
| 2026-08-07 | Deals and offers (13) | Every signature dropped its `ownerMobile` — that parameter was the caller naming whose data to read |
| 2026-08-07 | Subscription plans (12) | First domain read during render, so it is held in `PlanContext`. `pending ≠ active` |
| 2026-08-07 | contact/saved/savedSearch/visit | Shipped complete but absent from `VITE_API_DOMAINS`, so every live run had exercised their mocks |
| 2026-08-07 | Abuse reports (11) | Reason set is validated *against* target type; duplicate → 409 |
| 2026-08-07 | Support tickets (10) | Three controls had nothing behind them, so they are hidden in http — an unknown field is ignored, not rejected |
| 2026-08-07 | Reviews (9) | `context` is server-derived and readOnly; `avgRating` is null, not 0 |
| 2026-08-06 | Conversations (8) | Attributing by display name breaks the first time two users share a name |
| 2026-08-06 | Notifications (7) | Server and UI type vocabularies had zero overlap; every filter chip would have emptied the page |
| 2026-08-06 | Listing moderation | Four writes had shipped with no read that could find a listing to act on |
| 2026-08-05 | Visits (6) | The seam carries the human `when` string and converts to the wire's ISO slot |
| 2026-08-05 | Saved searches (5) | `POST /me/saved-searches` 401s for exactly the signed-out visitor the card exists to capture |
| 2026-08-04 | Saved shortlist (4) | Membership answered from `SavedContext`, never per card — 30 requests to draw 30 hearts |
| 2026-08-04 | Contact gate (3) | Keyed on `propertyId`: the grant is per listing, not per owner |
| 2026-07-30 | Property (2) | `construction`/`possession` broke a feature rather than degrading it — fixed in the contract |
| 2026-07-29 | Auth (1) | Established the provider pattern and the parity-harness habit |
| 2026-07-28 | Phase 2a | 21 files imported `lib/` directly; a seam with a bypass is not a seam |

### Backend slices — OpenAPI-first, 208 operations

| Date | Slice |
|---|---|
| 2026-08-07 | Tech-debt pass — D90, D82, D19, D22, D83, D86, D97(d), D95; the register's own numbers were the least reliable thing in it |
| 2026-08-02 | Tech-debt batches — Lombok, concurrency, register audit |
| 2026-08-01 | 15 share-flat + admin listing correction · 14 Admin & Analytics (revenue blanked for staff) |
| 2026-07-31 | 13 Billing & Growth · 12 conversations + support tickets · 11 service requests + staff queue |
| 2026-07-30 | 10 Documents (storage keys server-minted, content type derived from bytes) · 9 Moderation |
| 2026-07-29 | 8 Reviews · 7 Catalog & Search, pagination and OTP rate limiting — every sort index-backed |
| 2026-07-28 | 5 finance ledger + tenancy · 4 deals/offers/visits |
| 2026-07-27 | 3 contacts + gate + Aadhaar badge · 2 properties (slug-or-id resolution) |
| 2026-07-26 | 1 auth + users · bounded-context package layout |

### Database, mobile, trust, docs

| Date | Change |
|---|---|
| 2026-08-04 | One populated local DB, schema by Flyway only. Three permanent Flyway traps recorded in `R__zz_dev_demo_data.sql`'s header |
| 2026-08-05 | Mobile review B5/C5/D1 + CI; Home "Flatmates" tile |
| 2026-08-02 | Bundle: 571 KB off first paint — `financeProvider → finances.js → jspdf` was statically imported *and* preloaded |
| 2026-08-02 | Mobile Phase 4 incl. PWA and landscape; Phase 6 deferred-item sweep |
| 2026-08-01 | Home Phase 3 featured-first via CSS `order`, leaving DOM order untouched; Phase 2 waves H–R |
| 2026-07-31 | Mobile Phases 1/3/4/5; "Share Flat" → "Flatmates" (enum values stay `'share'` — renaming would orphan localStorage) |
| 2026-07-28 | Badge-not-gate migration, 8 pages (ADR-019); KYC growth levers; DigiLocker consent flow |
| 2026-07-27 | Trust model pivot documented; 3-way sync `platform-architecture.md` → OpenAPI → React |
| 2026-07-26 | OpenAPI established as the single source of truth |
| 2026-07-25 | Platform & solution architecture (MVP), ADR-009a KYC, ADR-014 payments, legal/compliance advisory |
