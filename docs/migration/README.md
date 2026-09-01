# Migration Plan — Retire the mock, run the whole app on the real API + Postgres

**Status:** Planning (no code yet). Branch: `feature/backend-integration`.
**Owner decision (verbatim):** *"I don't want to keep anything on mockup anymore."*

This folder is the module-wise plan to move the **entire** PuneNest app — the React
frontend **and** the Playwright e2e suite — off the in-browser mock and onto the live
Spring Boot API backed by PostgreSQL, with permanent seed data, real file storage
(Cloudflare R2), and persistent real users in a dedicated test database.

It also moves **business logic out of the browser and into the backend**, keeps the code
minimal (ponytail), cleans up comments, and stands up static analysis.

## The documents

| Doc | What it decides |
|-----|-----------------|
| [01-storage-r2.md](01-storage-r2.md) | How photos and documents get **permanently stored** (Cloudflare R2 — already built, one flag away). |
| [02-seed-and-fixtures.md](02-seed-and-fixtures.md) | The **permanent seed** as a named-fixture contract so the app displays exactly as today (photos, localities, societies). |
| [03-e2e-database-and-users.md](03-e2e-database-and-users.md) | The persistent **`punenest_e2e`** database, **real user management that survives restarts**, OTP handling, and drift control. |
| [04-modules.md](04-modules.md) | The **per-domain migration matrix** — all 22 service domains: live status, what self-seeds, what must be rewritten. |
| [05-logic-to-backend.md](05-logic-to-backend.md) | **Business logic moves to the backend; the UI stays thin.** Full `frontend/src/lib/` inventory classified move / stay / delete. |
| [06-code-quality.md](06-code-quality.md) | **Ponytail discipline, comment hygiene, and Sonar/Checkmarx** — including the fact that neither scanner is configured today. |

## The one insight that sizes this whole effort

Flipping the frontend to the live API is **two lines of `.env.local`** (already proven —
the live e2e config works today). The expensive work is **not** wiring; it is the e2e
suite:

> Mock specs **self-seed `localStorage`** (`puneNestUser`, `puneNestDB_v5`, …) via
> `addInitScript`. The `http` providers **ignore `localStorage`** and call the API. So
> every self-seeding spec asserts against data the backend does not have. **The dominant
> cost of this migration is rewriting self-seeding specs into seed-reliant / create-via-API
> specs**, and growing `R__zz_dev_demo_data.sql` into a documented fixture contract.

Start the effort from the **seed-fixture inventory** ([02](02-seed-and-fixtures.md)) — it
sizes everything downstream.

## Principles

1. **Nothing stays on mock as a runtime driver.** The mock providers (`services/providers/mock/*`)
   and the computational stand-ins in `frontend/src/lib/*` (`qualityScore`, `rentPay`, `featured`,
   `freshness`, …) are deleted **only after** the live e2e suite is green — not before. Until then
   they remain the safety net.
2. **The API contract is law.** `backend/src/main/resources/static/openapi/punenest-api.yaml`
   (126 paths / 160 operations) is the source of truth. Mappers conform to it; we do not bend
   the contract to match the mock.
3. **Permanent means seeded and idempotent.** Every fixture the UI displays today must be
   reproducible from a migration/seed file (Flyway repeatable), so a fresh DB looks identical.
4. **Three databases, three jobs** (see [03](03-e2e-database-and-users.md)). Do not blur them.
5. **Storage has a public/private split at the vendor.** Photos → public bucket (permanent CDN
   URL). Documents/KYC → private bucket (short-lived signed GET). This boundary is already
   enforced in code; keep it.
6. **The server decides; the client renders.** If the UI computes a business answer, that
   computation belongs in a service and the answer belongs in the DTO. No component re-derives a
   value the API already returns ([05](05-logic-to-backend.md)).
7. **Delete before you write** (ponytail). Before porting any `lib/*` calculation into Java, check
   whether the API already returns it — usually the correct migration is `git rm`, not a port. No
   new abstraction with one implementation; no new dependency without naming what it replaces
   ([06](06-code-quality.md)).

## The three-database model

| DB | Job | Seed | Isolation | Persists across restart |
|----|-----|------|-----------|-------------------------|
| `punenest` | Local dev driver | Full demo seed (`R__zz_dev_demo_data.sql`) | none | yes |
| `punenest_test` | Java unit/integration suite | **schema only** (guarded by `TestDatabaseIsolationTest`) | `@Transactional` rollback per test | no (rolled back) |
| **`punenest_e2e`** (new) | Playwright browser suite | Named-fixture baseline seed | **no rollback** — reset-to-baseline at run **start** | **yes** (this is the requirement) |

`punenest_test` **must stay empty** — 126 exact-count assertions depend on it. The persistent
real users the owner wants live in the **new** `punenest_e2e`, never in `punenest_test`.

## Phased sequencing

Each phase ends green before the next starts. UI instability on this branch is accepted.

- **Phase 0 — Local integration (cheap, reversible).** Commit a `frontend/.env.local`
  (`VITE_API_DOMAINS=*`, `VITE_PROXY_TARGET=http://localhost:8080`) and a `dev:live` npm script /
  VS Code task. Frontend now runs fully on the live API for manual dev. Mock still available by
  toggle. **No spec changes yet.**
- **Phase 1 — Seed becomes a fixture contract.** Inventory what today's UI shows; promote the
  demo seed into stable named actors with documented invariants ([02](02-seed-and-fixtures.md)).
  Keep photos as external URLs for now (they already display for free).
- **Phase 2 — Storage flip — DONE 2026-08-13.** The six `R2Properties` come from `R2_*` in a
  git-ignored `backend/.env.local`; `application.properties` already bound them, so nothing
  committed changed and `STORAGE_ENABLED` stays `false` by default ([01](01-storage-r2.md)).
  Proven with `STORAGE_ENABLED=true` against the real sandbox: `R2FileStorageLiveTest` (2),
  `MePhotosLiveTest` (public half, whole server chain), and a new `MePersonalDocumentsLiveTest`
  (private half — KYC file lands in the private bucket under an owner-scoped key, the signed GET
  returns the bytes, the unsigned URL is refused). All three frontend-side risks the plan listed
  turned out to need no code change; see the Risks section there. Dev without keys still works via
  the existing local `DevObjectStore`.
- **Phase 3 — `punenest_e2e` + persistent users.** Stand up the third DB, its baseline seed, the
  reset-at-start hook, and the e2e OTP affordance ([03](03-e2e-database-and-users.md)).
- **Phase 3.5 — ~~Authorisation logic to the server~~ — CLOSED 2026-08-13, no work needed.**
  Audited before writing any Java, per [05](05-logic-to-backend.md)'s own first checklist item.
  Both are **already enforced server-side**: `BackOfficePermissions` guards every route with two
  independent fences and may only narrow a role baseline, and the http contact provider owns the
  gate entirely. `lib/permissions.js` speaks a vocabulary migration V61 **deleted**, so it fails
  *closed*; `lib/contact.js`'s gate functions are imported only by the mock provider and retire by
  `git rm` in Phase 4. Not a security finding. See
  [05 § Audit result](05-logic-to-backend.md#audit-result--neither-needs-a-port-both-are-already-enforced-server-side)
  and open decision 3 below for the one real item it surfaced.
- **Phase 4 — Per-domain pass: provider + logic + specs + comments — DONE 2026-08-13.** All 22 rows
  in [04-modules.md](04-modules.md) are ✅; `VITE_API_DOMAINS` in `playwright.live.config.js` names
  every one. The last three were `team`, `fees` and `photo`; converting `photo` meant converting
  `/staff-login`, the only screen still authenticating against `lib/mockApi.js`, to the live
  `/auth/login` mobile-OTP flow — role and team now come from the server, and the demo quick-access
  block survives only behind `{!authIsLive && …}` until Phase 5 removes it. New live evidence:
  `live-fees-and-photos.spec.js` (published fee + GST, the estimate wording the NULL statutory pair
  demands, and a photo whose URL the server minted rather than a `FileReader`) and
  `live-drafting-desk.spec.js`, un-`fixme`d and green. Two things the plan did not predict, both
  recorded where they bite: the drafting-desk fixture had to move to the free `valuation` desk
  because `rent-agreement` is the one priced type and never leaves `awaiting-payment` without a
  payment webhook, so the rental queue is unreachable from e2e by design; and the photo test does
  not fetch its bytes back, because `MockFileStorage.storePublic` deliberately mints them on a host
  that does not resolve — that claim is `R2FileStorageLiveTest`'s. Walk order for each domain was:
  1. Convert self-seeding specs to seed-reliant / create-via-API; keep `e2e/COVERAGE.md` in step.
  2. Move that domain's business logic server-side; add the field to the DTO + OpenAPI; delete the
     `lib/*` file ([05](05-logic-to-backend.md)).
  3. Apply the ponytail ladder — prefer deleting the client calculation over porting it.
  4. Review the comments in every file touched; a comment that is now false is a defect
     ([06](06-code-quality.md)).
- **Phase 5 — Make live the default; retire the mock; harden.** Point the default
  `playwright.config.js` at the live backend (retire the "must pass with no backend" invariant).
  Delete `services/providers/mock/*`, `lib/mockApi*`, `data/db.json`, and the remaining
  computational `lib/*` stand-ins. Remove the Vite `persistPlugin` mock-persistence route. **Then**
  stand up static analysis — scanning before the mock is deleted just produces findings on code
  that is about to disappear ([06](06-code-quality.md)).

  **Measured 2026-08-13, and it changes the shape of this phase.** The one-liner above assumes
  deleting the mock retires scaffolding. It does not — it invalidates tests. The legacy suite
  (`playwright.config.js`) is **220 files / 1,541 tests**, of which **164 files seed their fixtures
  through `localStorage` / `addInitScript`**, which becomes a no-op the moment the mock provider is
  gone. The live suite is 5 files / 48 tests. So "delete the mock and repoint the config" is a
  1,541-test coverage cliff, not a cleanup.

  **Chosen strategy: convert in waves, delete last.** The mock stays alive and unchanged while
  legacy specs move onto the live suite folder by folder — `platform` → `consumer` → `admin` + `ops`
  → `mobile` — and a mock provider is deleted only once nothing imports it. Slower, and the mock
  lives a while longer, but no window exists in which coverage is knowingly down. The rejected
  alternatives are worth recording: flipping now and `fixme`-ing the fallout trades real coverage
  for calendar time, and reclassifying the mock as a permanent test double is ponytail-optimal but
  contradicts the definition of done below.

  **The blocker is not the provider folder.** 58 files import `lib/mockApi.js` *directly*, bypassing
  the `services/*` seam entirely (22 admin, 18 consumer, 4 components, 3 ops, 3 context, 1 root, plus
  8 mock providers which legitimately do). Those direct imports are what actually pin `db.json` in
  place, and each one is invisible to `VITE_API_DOMAINS` — there is no switch to look at, so a screen
  reading mock data in live mode says nothing about it. Seaming them is the bulk of the work.

  Two Phase-5 items listed here previously as defects were **verified already correct** on
  2026-08-13 and need no code: `providers/http/feesProvider.js` preserves the deliberately-NULL
  statutory pair rather than coercing it to `0`, and `useRentAgreement.js` answers a NULL by deriving
  locally and listing the field in `cost.computed`. That `computed` array is load-bearing — it is why
  the sidebar says "estimated total" instead of quoting a figure as the price, and it is what
  `live-fees-and-photos.spec.js` asserts on.

  **Follow-up raised by the `settings` seam: three consumer kill switches wrote to one place and
  read from another.** `AdminSettings` PUTs `flags` and `geo` to the API, but the consumers of those
  same keys still read `rawDb()` — `ConsumerLayout.jsx:37` (`flags.maintenanceMode`, "block all
  consumer access"), `AppFlagsContext.jsx:7` (`flags`, including `signupsEnabled`) and
  `geoConfig.js:72` (the Places blacklist and city limit). The http provider raises
  `punenest-settings-change` and those listeners dutifully re-read localStorage, where nothing has
  changed. This was **not** a regression in real enforcement — the controls were always browser-local,
  so they never protected anyone but the operator's own tab — but it did mean an abuse-response
  switch reported success and did nothing at all.

  **Closed for `flags` on 2026-08-13 by a new public route, `GET /flags`.** The obvious fix — have
  the client read `GET /admin/settings` and take the `flags` block — is not available, and the reason
  is worth recording because it recurs: that endpoint is admin-only *in both directions on purpose*,
  since the same document carries the fee table and the permission map, and "what does this platform
  charge" and "which team may do what" are privileged answers. But the flags gate what a **logged-out
  visitor** sees. A value that governs an anonymous render cannot have an authenticated-only reader.
  So the block got its own route, scoped to `settings.flags` and nothing else, and the contract
  gained a `/flags` path (sanctioned addition, agreed with the product owner before it was written).
  `AppFlagsContext` now reads through `settingsService.getAppFlags()`; its `lib/mockApi` import is
  gone. Absent still means enabled (`flags[key] !== false`), which is what lets the response carry
  only explicit decisions and makes a failed fetch survivable.

  **Still open for `geo`, and the shape of the fix is not what it looked like.** The working
  assumption was "point the city picker at the existing public `GET /cities` and the liveness problem
  goes away". It does not, and building it would have broken the waitlist funnel:

  - `GET /cities` serves the `cities` **table**, which holds one row (Pune). The picker's roster of
    five lives in the `CITY_GEO` constant in `geoConfig.js`, and the four "coming soon" entries are
    deliberately *not* rows — they exist to be waitlist targets. Sourcing the picker from the
    endpoint would delete them from the dropdown along with the funnel that converts them.
  - The switch `city-propagation.spec.js` actually exercises is the admin **override**,
    `settings.geo.cities[name].live` — which lives in the admin-only document. That is the same hole
    `/flags` just closed, wearing different clothes; `GET /cities` does not address it.
  - There is no admin write path for `cities.live` at all (no route constant, no controller).

  So the honest fix is a piece of work in its own right: seed the four coming-soon cities as
  `live = false` rows, give the admin console a way to flip that column, and let `GET /cities` become
  the single answer to roster **and** liveness **and** inventory — retiring `CITY_GEO.live`, the
  `settings.geo.cities[].live` override and the hardcoded "only Pune has data" together. A cities
  table that does not list the cities you can join a waitlist for is the actual defect underneath.
  Until then `platform/city-propagation.spec.js` stays on the legacy suite; it is not blocked on
  test plumbing.

  ### P5b wave 1 — `platform` (in progress, 2026-08-13)

  The 220 legacy specs were classified by *how* they get their fixtures, because that, not the
  folder, is what decides the cost of moving one:

  | class | files | what conversion costs |
  |---|---:|---|
  | pure UI, no seeding | 57 | a rename |
  | session only | 53 | a rename + swap `login.asX` for a real sign-in |
  | seeds domain state | 110 | the actual work — find a fixture row, or create one via API |

  Per folder: `consumer` 136 (85 domain-state), `mobile` 28 (only 2), `admin` 25 (11), `platform` 20
  (10), `ops` 10 (1), plus one loose file. **That table argues against the wave order above.**
  `mobile` and `ops` are almost entirely cheap and `consumer` is almost entirely expensive, so
  `platform → ops → mobile → admin → consumer` banks more coverage sooner. Raised with the user
  rather than changed unilaterally.

  `fixtures/live.js` is the conversion lever: it re-exports Playwright's `test` with the *same two
  fixtures under the same names* as `fixtures/base.js` (`consoleErrors`, `login.asBuyer/asOwner/…`),
  so a session-only spec converts by changing one import line. Underneath, `login` completes the real
  OTP form instead of writing `puneNestUser` into localStorage. Keeping the call sites identical is
  deliberate: 220 files is 220 chances to change behaviour while claiming to be porting it.

  Two things the conversion is *not* allowed to paper over:

  - **`login.asManager` throws on the live base.** Custom back-office roles (`Verifications`,
    `Requests Desk`, `Content`) were deleted in V61 and `PUT /admin/settings` now 422s the key, so
    there is no seeded account scoped below admin. Signing those specs in as a full admin would make
    them pass while testing the opposite of their subject — that a scoped user sees *less*. They stay
    on the mock suite until open decision 3 is settled.
  - **Specs that mutate their actor get a fresh account** (`signedInAsNew`), never a seeded one. The
    fixture registry publishes seeded state as invariants and the e2e database persists for a whole
    run, so flipping Arjun's `verified = false` would break a later spec's premise somewhere else
    entirely. `live-verify-funnel` and `live-flow` both registered actors this way.

  Wave 1 converted 10 of the 20 `platform` specs (the 4 pure + 6 session-only). Two guardrails that
  had been silently `test.skip`-ing themselves behind an auth gate on the mock suite —
  "wizard step actions are not sticky" and "saved tabs are a flex row" — now sign in and assert,
  because the live suite can actually log in. `live-flow`'s registration assertion moved off
  `localStorage.puneNestUsers` (the mock's own registry, which the form wrote itself, so the check
  only ever proved the page could talk to its own tab) onto `POST /auth/login`, which fails if the
  account never reached the server.

  **Eight of the ten were a one-line import change. The two that were not each turned out to be
  asserting behaviour that exists only because the mock exists**, so both were rewritten against the
  live contract rather than reverted to the mock suite — a green tick on code that P5c deletes is
  worth nothing.

  - *Sign-in bounce.* `auth/flow` asserted that an unknown number redirects to `/signup`. That branch
    is gated behind `!authIsLive` (`Signin.jsx:127`): the live API deliberately exposes no "does this
    mobile exist?" endpoint, because answering it publicly is a user-enumeration oracle, and it
    provisions the account on first verified login instead. The spec now asserts the live promise —
    **an unregistered number and a freshly-registered one are indistinguishable from outside** —
    checking both in one test, since "the unknown number reached OTP" only demonstrates
    non-disclosure if a known number does exactly the same thing. The separate "a registered number
    proceeds to OTP" test was deleted as a duplicate of that pair.
  - *Verified badge.* `auth/verify-funnel` asserted the badge rendering after the mock granted it
    inline. Live, `POST /me/verification/aadhaar` answers **202 with a hosted consent URL** and the
    badge lands only on the signed webhook, which no browser action can trigger. The spec now asserts
    the inverse — **starting verification grants nothing** — which is the half worth having, since a
    client that can talk itself into a trust badge is a security defect. It stubs `mock.kyc.local`
    (the dev provider's non-resolving consent host, which would otherwise make the "no badge"
    assertions pass for the wrong reason) and re-reads the profile from the server afterwards. The
    render half is now an explicit ⏳ gap in `COVERAGE.md`; closing it needs a seeded already-verified
    actor, which is tracked in `05-logic-to-backend.md`.

  The ratio is the planning lesson: **budgeting a folder by file count will be wrong in exactly the
  places that matter.** Both hard cases also ended up asserting something stronger than the mock
  version had, so conversion is finding coverage gaps, not just moving files.

  A second measurement caveat, found scoping the next batch: the classifier greps each spec for
  `localStorage.setItem`, so it **misses domain state written through a helper** and misses specs that
  reach into `/src/lib/` with `page.evaluate(() => import(...))`. `platform/i18n.spec.js` scored as
  session-only but calls `publishListing()` and probes four modules that P5c deletes; it moves to the
  expensive pile. Treat the class counts as a lower bound on the work.

  ### P5b wave 1b — the help folder

  `platform/help/centre` (15 tests) and `platform/help/i18n-urls` (15) converted cleanly — import
  swap, drop the ten `seed(page, {})` calls that only ever cleared storage, and map the three
  seeded-user calls onto `login.asBuyer()` / `login.asAdmin()`. 66 tests green.

  The one thing that would have gone silently wrong is not in either spec. Both were on
  `CROSS_VIEWPORT` in `playwright.config.js`, the explicit list of specs that must also run on a
  phone — the help centre is on it because `Footer.jsx` renders each column as an accordion that is
  **closed** below `sm`, so a desktop-only run passes against a footer that is broken on mobile.
  The live config had a single `chromium` project, so converting the pair would have quietly halved
  their coverage while every reported number went up. `playwright.live.config.js` now carries its own
  `mobile` project and the two entries **moved** between the lists rather than being deleted, with a
  comment on each list pointing at the other.

  Worth stating as a rule for the remaining waves, because three more `CROSS_VIEWPORT` entries
  (`consumer/property/detail`, the two `consumer/flatmates` specs, `consumer/services/referral-rewards`,
  `platform/i18n`) are still to come: **a spec's viewport matrix is part of what a conversion has to
  preserve, and it lives in a file the conversion does not otherwise touch.**

  ### P5b wave 1c — `platform/feature-flags` (25 tests)

  Unblocked by the public `GET /flags` above, and the first conversion where the *subject* changed
  rather than the plumbing. The seeded spec wrote `settings.flags` into localStorage and asserted the
  UI reacted — it proved the rendering half and quietly assumed the half that was broken, because it
  wrote to the same place the client read from. The live version writes through `PUT /admin/settings`
  and reads whatever the browser makes of `GET /flags`, so nothing in the test touches the value
  under assertion. All 25 green, and the four route-guard redirects — the tests that would catch a
  disabled feature's URL staying reachable — pass against real server state.

  Three things worth carrying forward:

  - **Flags are now shared run state.** The `flags` fixture in `e2e/fixtures/live.js` snapshots on
    first write and restores in teardown, which Playwright runs even when the test body throws. A
    leaked toggle does not fail where it was set; it fails three specs later, looking like flakiness.
    Restore is to the snapshot, not to a blanket `true` — invisible for the default-on features,
    catastrophic for `maintenanceMode`, where absent means enabled and the seed says `false`.
  - **Every `waitForTimeout` disappeared**, and not by being replaced with a smarter wait. They were
    paying for an ordering the test could choose: set the flag on the server, *then* navigate, and
    the page's first read is already the value under test.
  - **Two tests were asserting nothing.** The "no page errors with all flags disabled" pair read
    `puneNestDB_v1` — a store key three versions stale — so `db` was null, the guard returned, and
    both had spent their lives asserting that a page with *all flags enabled* renders cleanly, under
    a name claiming the opposite. Converting fixed them by construction; they now disable the whole
    26-flag vocabulary through one PUT. Consistent with the D203 lesson: a coverage regression that
    arrives as a passing test is invisible to every gate that watches for failures.

  ### P5b wave 1d — `settings-preferences` (7), `auth/kyc-growth-levers` (4), `auth/verify-payoff` (3 → 5)

  The first wave where a conversion turned into a backend gap.

  `settings-preferences` is the cheap case, and worth naming because most of the remaining 217 specs
  look like it: the three settings cards read device preferences straight from localStorage with no
  provider in front of them, so the conversion moves nothing. What changes is that the person is
  real — which matters more than it sounds, because `isOwner` derives from real inventory, so the
  seeded spec had to fabricate a listing to make the owner card render at all.

  `verify-payoff` is the expensive case. Its whole subject was the mock's
  `applyVerifiedBadgeToListings`, so under the standing rule the answer should have been `git rm`.
  The check came back **"no, and it should"**: `properties.owner_verified` was a stored column with
  an entity field, a response member and six frontend read sites, and **nothing anywhere wrote it**
  outside the seed. Verification stopped at the owner's own profile; every listing they held went on
  telling buyers they were unverified. Implemented in two halves (webhook back-fill for listings
  already held, create-time stamp for listings posted later — the replay early-return means one
  cannot cover the other), proven by `VerifiedOwnerListingsTest`, and two further defects of the same
  shape fell out: `PropertySummary` carried no `ownerVerified` at all, so live search results were
  badge-free for every owner, and `OwnerCard` conflated the owner badge with the ownership badge.

  Carry forward:

  - **The Ponytail check is "does the backend do this?", not "is this mock code?"** Those questions
    have different answers, and the second one is the one that deletes a product promise.
  - **A card projection is a different schema from a detail read.** A field present on one says
    nothing about the other, and the card is the surface that actually monetises a trust signal.
  - **Ask the database, not the dump.** One `psql` join found the seed contradicting itself in both
    directions (an unverified owner badged on three listings, a verified one unbadged on a fourth);
    grepping the same fact out of the generated INSERTs cost 30 KB of context and would not have
    made the contradiction obvious. Fixed with a derived `UPDATE`, so it cannot return on the next
    regeneration.
  - **Choose the negative anchor so a lazy assertion fails.** `p5007` is now a registered anchor
    precisely because it is *not* badge-free — its ownership is verified though its owner is not.

  `verification-disclaimer` (3 → 4) followed and turned up a third defect of the same family. The
  buyer-side document request never goes through the service seam at all: `DocumentsSection` calls
  `addDocRequest` from `lib/data/documents.js` and files it under `p.ownerMobile` — which on the
  live detail read is the **masked** number until the contact gate is passed, while the owner's
  dashboard reads its requests under the real one. Live, a buyer's document request is filed where
  its owner will never look. The seeded spec could not see this because it scanned *every*
  `puneNestDocReq:*` bucket for a match. Not fixed here: the correct fix is the endpoint the
  `document` domain flip brings, and unmasking the number to make the key line up would trade a
  broken feature for a leaked one. The converted spec asserts through the UI's own read-back
  instead, so it keeps meaning the same thing after the flip.

  The fourth test added there is a guard, not coverage: the whole section is `if (!count) return
  null`, so a listing losing `docsCount` deletes the disclaimer, the acknowledgement and the gate in
  one silent step, and every other assertion in the file would fail as "element not found" — a
  locator problem in appearance, a legal disclosure that stopped being made in fact.

  ### P5b wave 1e — `auth/improvements` (16), `i18n` (17)

  Both converted at parity, which is the point worth recording: **the specs that survive a backend
  migration intact are the ones that were never asking the mock anything.** `auth/improvements` is
  about screens — gate copy, real links, one primary action at a time, which storage tier a session
  lands in — and `i18n` is about the render pipeline. Neither ever needed a fixture to have an
  opinion, so neither lost a test. Compare with `settings-preferences` (8 → 7) and the consumer
  folder still ahead, where most of the file *is* the fixture's opinion.

  Three seams in `auth/improvements` were genuinely different rather than re-plumbed, and each is a
  place the live design is deliberate:

  - **User existence is gone.** The seeded spec pre-loaded `puneNestUsers` so a number could be
    "known", and asserted that an unknown number bounces to `/signup`. The live API has no such
    endpoint on purpose — "does this mobile exist?" answered publicly is a user-enumeration oracle —
    and provisions on first verified login. The converted spec asserts the live behaviour instead:
    an unknown number proceeds to OTP and stays on `/signin`. The mock's bounce is a P5c deletion.
  - **Hiding a link is not closing a door.** The signups-flag test now also asserts the route guard,
    not just the absent `Sign Up` link. A flag that hides navigation while leaving `/signup`
    reachable is the shape of every "we turned that off" incident.
  - **The demo-mode hint assertion is inverted.** `Signin.jsx` renders "enter any 6 digits" only
    when auth is *not* live, so the assertion worth having is that it is **absent**. This is the
    class of defect nothing else catches: no error, no 500, the screen simply tells people the wrong
    thing about a real OTP.

  The remember-device test also gained the half the mock could not check — the tokens. `lib/auth.js`
  passes one `remember` flag to both stores precisely so a session cannot be half-scoped, and a
  tab-scoped profile sitting beside a remembered refresh token is a shared-computer leak that looks,
  from the UI, exactly like a signed-out browser.

  `i18n` moved its `CROSS_VIEWPORT` entry to the live config's `mobile` project rather than losing
  it, per the note in `playwright.config.js`. Its property-page test now reads a registry anchor
  instead of a listing the spec wrote itself, which matters more here than elsewhere: a leak scan is
  only as good as the text on the page, and mock copy was written by the same hand as the
  assertions. The societies filter test likewise now filters 348 real societies down to nothing,
  so the translated empty state is reached by actually emptying a list rather than by starting from
  one.

  Its six `page.evaluate(() => import('/src/lib/...'))` probes were kept as-is. They are unit
  assertions wearing an e2e costume and the file now says so — what they pin is the *id/label
  split*: ids stay English because they are persisted on user records, labels are keys because they
  are shown. Two of the modules they reach into (`lib/data/finances.js`, `lib/qualityScore.js`) have
  no http provider and are deleted or rewritten in P5c. Leaving the probes in place means P5c gets a
  loud failure rather than a silent coverage loss; the assertions do not stop being true then, they
  change subject to wherever the ids come from.

  **A fourth finding, from the conversion itself: nothing can sign in through a translated auth
  screen.** The three i18n tests that need an authenticated page failed on the first live run, and
  not for an i18n reason — `signIn` in `helpers/liveAuth.js` locates its submit by accessible name,
  `/send otp|continue/i`, which is English. On a Devanagari page it matches nothing and times out.
  The seeded suite never met this because it wrote a user into `localStorage` instead of signing in.
  Worked around by signing in *before* switching language, which is honest for these three tests
  (they are about the pages behind auth, not about auth) but leaves a real hole: **`/signin` and
  `/signup` in hi/mr are covered for render only, never for use.** The fix is a `data-testid` on the
  auth submit, or a per-language name table in the helper; not done here because eleven live specs
  depend on that helper and changing it in passing is how a suite-wide flake gets introduced. Worth
  doing when the auth screens next get attention.

## Definition of done

- [ ] `frontend` runs against the live API with **no** mock provider reachable.
- [ ] Default Playwright config drives the **live** backend; suite is green.
- [ ] Every listing photo, locality, and society the UI showed on mock is reproduced from seed.
- [ ] User-uploaded photos land in the R2 public bucket; documents/KYC in the private bucket.
- [ ] A user registered in e2e is still logged-in-able after a backend restart.
- [ ] `services/providers/mock/*`, `lib/mockApi*`, `data/db.json` and the `lib/*` computational
      stand-ins are deleted.
- [ ] No business rule, score, money calculation, or authorisation check is computed in the browser.
- [ ] Bundle size measured before/after the `lib/` deletions; headroom recorded.
- [ ] Comments in every migrated file are still true; stale mock-era narration removed.
- [ ] Backend `mvnw test` runs in CI (it does not today).
- [ ] Sonar wired and findings triaged by severity; Checkmarx-vs-CodeQL decision recorded.
- [ ] `docs/coverage-matrix.md` / `e2e/COVERAGE.md` reflect the live suite.

## Open decisions

1. **Checkmarx or CodeQL?** Neither Sonar nor Checkmarx is configured in this repo today, and CI has
   no backend job at all. Checkmarx is commercial — wire it only if your organisation licenses it;
   otherwise GitHub CodeQL is the free native equivalent. See [06](06-code-quality.md).
2. **Caching.** There is **no caching layer** (no `@EnableCaching`/`@Cacheable`/Redis/Caffeine).
   Moving heavy lifting server-side ([05](05-logic-to-backend.md)) puts every one of those
   computations on an uncached Postgres. Per D133, **measure the real call count first** — no cache
   until a profiler asks for one.
3. **How should the admin console bind to the permission catalogue?** *(raised 2026-08-13 by the
   [05](05-logic-to-backend.md) pre-port audit, which found no port was needed.)* The server owns a
   16-atom `module:action` model with per-account documents that may only narrow a role baseline,
   and serves it at `GET /admin/permission-catalogue`. The console instead computes navigation from
   `lib/permissions.js` using `customRoles`/`roleId`/`moduleAccess` — a vocabulary migration V61
   deleted and `PUT /admin/settings` now refuses with 422. It fails *closed*, so nothing is exposed;
   the console simply cannot express the real model, and `AdminFlagsContext` reads it from
   `lib/mockApi.js` in live mode.

   Not started — rewiring the console's access model is architectural. The options are (a) render
   the grid from the catalogue and drive nav from the caller's resolved atoms, deleting
   `lib/permissions.js` and the module-key vocabulary with it; (b) keep the module keys as a purely
   cosmetic nav grouping and map them onto atoms in one adapter; (c) defer until the `team` domain
   flips to http in [04](04-modules.md), which is when `AdminFlagsContext`'s seam violation has to
   be fixed anyway. **(c) is the cheapest and is the recommendation** — the seam fix forces the
   question, and doing it then avoids touching the console twice.

   **Update 2026-08-13 — the seam half is done; the binding half is still open.** `team` flipped in
   Phase 4, so (c) came due. `AdminFlagsContext` and `AdminSettings.jsx` now read and write through
   a new `services/settingsService.js` (`GET`/`PUT /admin/settings`, `settings` added to
   `VITE_API_DOMAINS`), so the admin console no longer reads its flags, fee schedule and geo policy
   out of `db.json` in live mode. The http provider answers `getCustomRoles()` with `[]`, because
   V61 deleted the key and there is nothing to fetch.

   That makes the **consequence** of the unresolved binding concrete rather than theoretical: live,
   a back-office account that is not an `admin` now resolves to role plus the always-on base modules
   only. It fails closed — no tab is exposed that should not be — but a scoped account sees less
   than it should, and no amount of provider work can fix that, because the console is asking a
   question (`can this user open the "enquiries" module?`) the server has no answer to. Choosing
   between (a) and (b) is still required, and it is now the only thing standing between the console
   and the server's real access model.

4. **Does the "first verification" Featured perk survive?** *(raised 2026-08-13 while converting
   `auth/verify-payoff`.)* The mock granted an owner a free 7-day Featured slot the first time they
   verified, guarded by `puneNestFirstFeaturePerk:<mobile>` so it could not be farmed by verifying
   repeatedly. The spec asserted both the grant and the guard, which is why the question surfaced at
   all — nothing else in the product mentions it.

   The backend has no concept of it. `featured` is a bare boolean toggled by a moderator in
   `PropertyModerationService`; there is no `featured_until`, no `featured_reason`, and no ledger of
   who has already been given what. Implementing the mock's behaviour therefore means a schema change
   (a window and a reason, so a free slot can expire and be told apart from a paid one), a grant
   ledger, and a decision to hand out paid placement for free as a standing acquisition cost. That
   last part is a monetization call, not a migration step, so it was **deliberately not built** and
   the corresponding assertions were not ported.

   Three ways to close it: (a) implement it as specified, which needs the schema plus a policy on
   what happens when a free slot and a paid one collide; (b) record it as intentionally dropped — the
   badge itself, plus the ranking preference it already earns, is the incentive; (c) replace it with
   something that costs nothing to give, e.g. a one-off placement in an existing "recently verified"
   rail. **(b) is the recommendation** unless the perk was a committed growth lever: the mock is the
   only place it has ever existed, and D95's real payoff — the badge reaching the buyer — now works
   without it.
