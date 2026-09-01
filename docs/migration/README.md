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
  gate entirely. `lib/permissions.js` spoke a vocabulary migration V61 **deleted**, so it failed
  *closed*; `lib/contact.js`'s gate functions are imported only by the mock provider and retire by
  `git rm` in Phase 4. Not a security finding. See
  [05 § Audit result](05-logic-to-backend.md#audit-result--neither-needs-a-port-both-are-already-enforced-server-side)
  and open decision 3 below, resolved 2026-08-14 by deleting `lib/permissions.js` outright.
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

  - **`login.asManager` is gone.** Custom back-office roles (`Verifications`, `Requests Desk`,
    `Content`) were deleted in V61 and `PUT /admin/settings` 422s the key, so there was no seeded
    account scoped below admin and no way to make one. Signing those specs in as a full admin would
    have made them pass while testing the opposite of their subject — that a scoped user sees *less*.
    Resolved 2026-08-14 with open decision 3: `login.scopeStaff(team, atoms)` narrows a real seeded
    staffer through `PUT /users/{id}/permissions` — the same route an administrator uses — and
    restores the role baseline in teardown. It deliberately does **not** sign anyone in, because
    `/admin` is administrator-only and the enforcement worth asserting is the API's.
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

- **Wave 2b — the five per-team ops desks were retired, not converted.** *(2026-08-14.)*
  `/ops/rent-agreement`, `/ops/legal`, `/ops/interior`, `/ops/packers` and `/ops/valuation` were one
  component (`OpsServiceQueue`) rendered five times over `serviceFlow`'s `localStorage` engine.
  **Defect found while sizing them: in live mode all five were blind.** Consumers had already moved
  onto the seam, so requests were landing in Postgres while the desks scanned
  `puneNestServiceReq:<mobile>` keys that nothing was writing any more. They did not error — they
  rendered an empty, healthy-looking queue, which is the worst way for a work surface to fail.

  A Ponytail check before porting anything, against the contract rather than against the mock: of
  the nine writes `serviceFlow` gave those desks, take / message / cancel already existed on the
  server, share-draft and upload-final had endpoints, and **three could never exist**. `setDocStatus`
  and `markDocsVerified` tick a checklist the server derives on read and never stores (D120 — "no
  checklist table, no `status` column a desk can tick by hand, and therefore no way for 'verified'
  to disagree with 'there is a file'"), and `submitRegistration` sets `registration`, which
  `ServiceRequestStatus` refuses by name: "the window between `approved` and the final document
  landing — a state with no decision in it, and therefore not a state". Porting the desks would have
  meant re-implementing three operations the contract exists to prevent. **The drafting desk is
  their replacement**; the five routes now redirect to `/ops/drafting-desk?type=<team>` rather than
  404, because they are in bookmarks, in `TEAM_HOME` and in the flow docs.

  **`TeamRoute` went with them, and this is the part worth recording.** It looked like deleting a
  security control. It was not: `ServiceDeskAuthority.deskFilterFor` derives a staff caller's desk
  from the principal and ignores a `team` they do not own, and `ServiceRequestQueryService` says why
  there is no `?requesterId=` either — "a filter a client can set is a filter a client can remove"
  (D44). The guard was never holding the line; it only chose the error message. What it *did*
  provide was a reason on screen instead of a silent empty table, and that is what the desk picker
  now provides: a staffer is offered their own desk and nothing else, because an empty queue and a
  forbidden queue must not look alike. Deleting the guard also stranded its only consumer — the
  `?denied=` banner on `OpsDashboard` — which went in the same change. The roadmap's two
  "enforce team scoping server-side" goals are marked **met** rather than deleted.

  **Capability honestly lost:** share-draft and upload-final now have no ops surface at all. They
  are multipart writes into a vault whose signed URLs do not resolve in dev, so there was never a
  working path to keep — but the maker-checker loop is unreachable from ops until they get one.
  Document *viewing* is likewise gone with `DocViewer` and is a deliberate open gap: the checklist
  endpoint returns `documentId`, an id and not a URL, "so this endpoint never mints a download
  credential".

  **Built in its place:** the read-only document checklist on the matter drawer
  (`GET /service-requests/{id}/checklist`, D120) — "*n* of *m* received" plus every item, present or
  missing. The missing ones are the point: a panel that could only show what arrived cannot answer
  the one question a desk has. A failed read says so rather than rendering as an empty checklist,
  because "nothing has been filed" is a fact about the customer and getting it wrong sends somebody
  chasing documents already in hand. Nothing is writable, which is the same fact as D120 seen from
  the UI: the only thing that moves an item is an upload.

  **Two consumer specs were reaching into the retired desks** and were truncated to their consumer
  half rather than deleted — a consumer spec proving a consumer flow should not need a second role.
  One of the replacement assertions had to be strengthened after being written: asserting a
  non-empty `docs[]` would have passed without any upload, because `serviceFlow` gives every request
  a placeholder `defaultDocs()` array. It now matches the real `owner-pan` file name.

  Suites: mock ops 23 ✅, live drafting desk 8 ✅ (was 6), consumer rent-agreement 15 ✅.

- **Wave 2c — the ops ticket board, and two infrastructure defects it uncovered.** *(2026-08-14.)*

  `OpsQueue` and `OpsDashboard` moved onto a new `ticketService.js` seam. Both are **live-only**
  (D184): there is no mock ticket provider, so in mock mode the board states why it is shut instead
  of rendering an empty queue. That is the whole argument for the wave — the mock's three statuses
  (`new`, `in_progress`, `done`) are not three of the server's five (`open`, `in-progress`,
  `waiting`, `resolved`, `closed`), so there was no adapter to write. `waiting` in particular has no
  mock equivalent, and a ticket parked on the customer sitting in `in_progress` is exactly the
  reading an SLA report must not make.

  Three mock behaviours were **not** ported. The client-side `scope = team || …` narrowing is gone —
  `TicketService.list` refuses another desk by name, same reasoning as D44. `syncServiceTicket`, the
  ticket ↔ service-request status mirror, is gone: it existed to keep one `localStorage` store
  consistent with itself and the contract has no field for it. And a claim no longer advances the
  status — putting your name on something and declaring it underway are two decisions, and doing the
  second silently is how a queue reports work in flight that nobody has started. That last one is
  now a live test.

  Free assignment was narrowed to **self-claim** (the drafting desk's *Take*), the board reads a
  **window** of the newest 100 and says so when the envelope total is larger, and notes are appended
  by the server with its own author and timestamp rather than posted as an array.

  **Two defects found by the live suite, both of which would have shipped:**

  1. `playwright.live.config.js`'s `webServer.env.VITE_API_DOMAINS` is a hand-maintained comma list,
     **not** `*` — and `frontend/.env.live` *is* `*`. A manual `npm run dev:live` would have looked
     perfect. Every new live domain must be added there by hand.
  2. `services/config.js` built `KNOWN_DOMAINS` from the **mock** registry alone, on the documented
     assumption that every domain has a mock provider. D184 repealed that invariant and the code did
     not notice: `ticket` looked like a typo, and the D105 validation throws in dev, so the entire
     app blank-paged before React mounted. Fixed by unioning both registries. This would have
     recurred for every future live-only domain.

  `Badge` also did not know the hyphenated vocabulary — `in-progress` fell through to the neutral
  grey, the one tone that means *unrecognised*.

  Suites: live ops board 7 ✅ (new), mock ops 21 ✅ (`requests.spec.js` 7 → 5, now routing/guard
  facts only), lint 0 errors, i18n ✅, build ✅.

- **Wave 2c (part 2) — the referral fraud desk, and the migration's first backend change.**
  *(2026-08-14.)*

  `OpsReferrals` moved onto a new `referralService.js` seam, **live-only** for the same D184 reason
  and with a stronger case than the ticket board had: the mock and the server disagree three times
  about what a referral *is*. It has a `flagged` status `ReferralStatuses` does not have, it hands
  out both mobile numbers in full where the server masks them, and its Approve grants a device-local
  perk where the server pays rupees.

  **The Aadhaar rule was ported to the server — the only backend change this migration has made so
  far.** Ponytail says check whether the API already answers before porting a client calculation,
  and usually the answer is `git rm`. Here it was not: `canQualify()` greyed out Approve in the
  browser, under a banner calling the check mandatory, while `POST /referrals/{id}/approve` released
  the money to anyone who called the endpoint directly. That is a hole, not a duplicate.
  `ReferralService.approve` now refuses with a 409, and the button is a mirror of it.

  Two details of that gate were load-bearing:

  1. **It reads the referee's *current* badge**, via `UserRepository.findByMobile`, not the
     referral's own `aadhaar_verified` column. That column is `updatable = false` — a snapshot of
     the redeem moment — and the ordinary order of events is redeem first, verify later, so gating
     on it would have permanently refused exactly the referrals the scheme exists for. A referee
     missing from the user table is refused too: "cannot check" is not "checked out".
  2. **The refusal is a sentence, not a boolean.** `decide()`'s guard was a `Predicate` producing
     one generic message ("Referral is *x* and cannot be *y*"), which is right for an illegal
     transition and actively misleading for this one — `pending` *is* the state approve works from,
     so a desk would hunt a status bug that does not exist. The guard is now a
     `Function<Referral,String>` returning `null` or the reason to show.

  **The perk grant could not be ported and is recorded as intentionally dropped**, alongside the D95
  Featured perk. `creditReferrer({ mobile: r.referrerMobile, … })` failed on both halves: the number
  it looked the referrer up by is masked on the wire, and the reward it granted (a listing slot, +15
  contacts) is not a thing the contract models — `ReferralSummaryDto` speaks `rewardsEarned` /
  `rewardsPending` in rupees. The reward is money, and the desk's job ends at approving it.

  **Flagged → High risk.** There is no `flagged` status, so that tab would have sat permanently
  empty while telling a fraud desk there was nothing suspicious. It now filters on `risk`, which is
  the question it was always reaching for and which the server already computes.

  Three fixes fell out of the live run, all product defects rather than test friction:

  - `referralService.js`'s delegates called methods on `createProvider`'s **resolver function**
    instead of awaiting it. The seam has been async since D208, and every existing service awaits;
    this one crashed the page into its error boundary on first render. A copy-paste shape error that
    lint and build both pass.
  - `Badge` had no `clawed-back` tone, so a reversed reward rendered in the neutral grey that means
    *unrecognised* — the second time this wave that a shared primitive silently degraded when a
    domain's vocabulary changed under it.
  - The spec had to learn that `Badge` **relabels**: `pending` renders as *Under Review*. Asserting
    the wire word on screen would have been asserting a lie; the wire vocabulary is checked in
    `ReferralEndpointsTest` instead, against the endpoint.

  Suites: live referrals 5 ✅ (new), `ReferralEndpointsTest` 29 ✅ (1 new), mock ops 18 ✅
  (`referrals.spec.js` 5 → 2, now the guard and the shut panel), lint 0 errors, i18n ✅, build ✅.

- **Wave 2c (part 3) — the flatmate desk, and the queue that makes D72 legitimate.**
  *(2026-08-15.)*

  The first desk in this wave where converting the screen was the smaller half of the job.

  `/ops/flatmate-review` runs three boards: **Verification** (is this host who they say they are),
  **Moderation** (may the city see this) and **Group applications**. The mock modelled the first.
  `lib/data/flatmates.js` knew nothing about the D72 publication axis, so the queue that decides
  whether *any* flatmate supply is visible had never been exercised by a test — and D72 is only a
  defensible policy if something clears its queue. The desk is **live-only**, and in mock mode says
  so rather than rendering an empty board: an empty queue and a disconnected queue look identical,
  and one of them means "the backlog is clear".

  **The third board read a table nothing could write to.** `GET /admin/group-applications` existed,
  the `flatmate_group_applications` table existed, `AdminFlatmates.jsx` moderated rows out of
  `lib/groupApplications.js` — two records seeded into `localStorage`. There was no apply route.
  Ponytail's usual answer is `git rm`; here the honest answer was that the feature was missing, so
  the ruling was to build it:

  | Route | Why it is shaped this way |
  |---|---|
  | `POST /flatmates/groups/{id}/apply` | hangs off the **group**, because the group is what is being committed |
  | `GET /me/group-applications` | the owner's inbox |
  | `PATCH /me/group-applications/{id}` | deliberately a **different path** from `PATCH /admin/group-applications/{id}`, so no request is ambiguous about which column it writes |
  | `GET /me/flatmate-groups` | `FlatmateGroupFeedDto` carries no host identity by design, so the codebase's existing "is this mine?" test was a question fixed at `false` in live mode |

  **These four routes are an intentional extension beyond the OpenAPI contract**, recorded here and
  in [`../flows/ops/flatmate-moderation.md`](../flows/ops/flatmate-moderation.md) section 10. The
  contract described an admin board over a table with no writer.

  Rules that are the server's now, each with a reason:

  - Only the group's host may apply it, only a **visible** group may apply, and only to a
    **rental** listing — on a sale listing `price` is whole consideration, so per-head would be
    wrong by orders of magnitude.
  - A stranger's `PATCH` returns **404, not 403**, to avoid an existence oracle.
  - `DECISION` excludes `pending`, so a decided application cannot be un-decided — that would also
    have to move `decided_at`, which the V29 check constraint ties to `status`.
  - The owner inbox filters `modStatus IN MOD_PUBLIC`. That is the *only* thing keeping an
    admin-removed application off the owner's screen, since `status` must stay `pending`. It has its
    own test, because nothing else would notice if the filter were dropped.
  - `myGroups` deliberately includes moderation-pending groups. Hiding a host's own group while it
    waits would read as data loss.

  Two rulings are visible on screen. The host's mobile is **masked in the mapper** even though
  `FlatmateReviewDto` sends it in full — a deliberate divergence from that DTO's javadoc, on the
  ground that a desk which can ring a host can be talked into ringing one on somebody else's behalf.
  And the moderation axis offers no `rejected`, because there it means exactly what `removed` means,
  and two words for "not published" is an invitation to use them inconsistently.

  Unlike the six ops functions, the mock provider **implements** the four consumer ones. The owner
  inbox is a consumer surface that must keep working in mock mode, and that is what allowed
  `lib/groupApplications.js` to be deleted now rather than at P5c.

  Two defects fell out of the backend tests, both worth remembering:

  - **`PageResponse` serialises as `content`, not `items`.** Four assertions were written against
    the frontend's normalised shape. `unwrapPage` does that translation; the wire does not.
  - **Hibernate's first-level cache hid a fixture.** The whole test class runs in one transaction,
    so a `jdbc.update` publishing a group was invisible to a later `group.isVisible()` check in
    Java — every apply returned "this group is not live yet". `em.clear()` fixes it.
    `FlatmateSupplyEndpointsTest.publish()` escapes this only because those tests assert on
    SQL-filtered feed queries and never read `modStatus` off an entity.

  Debt recorded rather than fixed: base64 agreements in a JSONB column (ruling: redesigning document
  storage was not this wave's job); documents over the ~3 MB inline cap cannot be previewed.

  Suites: live flatmate moderation 5 ✅ (new), live group-apply 2 ✅ (new),
  `FlatmateApplicationEndpointsTest` 13 ✅ (new), mock ops 19 ✅ (`flatmate-review.spec.js` 3 → 4,
  truncated to its consumer half plus the shut panel), lint 22 warnings / 0 errors, i18n ✅,
  build ✅.

  **Answered immediately after, and shipped in the same wave.** Two of the debts above were put to
  the user rather than carried, and both came back "fix it now":

  - **Paging on all three boards.** The 50-row window was not a display limit, it was a *silent*
    one — a desk with 51 pending rooms would have seen 50 and no indication there was a 51st, which
    is the same failure mode as an empty queue that is really a disconnected one. All three boards
    now page server-side at 25 with a `Previous` / `Next` control and a `1–25 of 137` readout. Two
    details are load-bearing: the page resets when the tab, board or state changes (a page number
    means nothing against a different result set, and resetting during render avoids firing a fetch
    for a page that is about to be abandoned), and deciding the last row on a page steps *back*
    rather than leaving the operator on an empty page they cannot explain. The pager renders nothing
    when one page holds everything, so the seeded desk is unchanged.
  - **`/admin/flatmates` retired.** It was not merely duplicated, it was strictly worse: it could
    not see rooms at all, it had no view of the D72 publication axis, and it moderated group
    applications that — until this wave — nothing in the product could create. The route now
    redirects to `/ops/flatmate-review`, `AdminFlatmates.jsx` is deleted, and the admin topbar's
    three flatmate children point at the live desk. Its suite went 8 tests → 3 (the redirect and its
    two guards); the first half of `flatmate-moderation-reach.spec.js` and the three flatmate tests
    in `consolidation.spec.js` went with it, since every one of them drove the retired page. What
    they asserted is covered for real by `ops/live-flatmate-moderation.spec.js`, against the
    database rather than against a second `localStorage` store.

  Suites for that follow-up: mock ops + admin 43 ✅, live flatmate 7 ✅, lint 22 warnings / 0 errors,
  i18n ✅, build ✅.

- **Wave 2d — the support queue, and the 500 that was hiding behind a nullable column.**
  *(2026-08-15.)* The shortest conversion so far in code and the most interesting in what it found.
  `OpsSupportQueue` was already fully live-capable — `supportService.js`, `http/supportProvider.js`
  and `supportMapper.js` had all been written correctly and never exercised — so this wave was
  meant to be spec work. It was not.

  **What the mock could not express.** The support read model has two sides (D50): `unread` is "a
  staff reply the customer has not opened", `staff_unread` is "a customer message nobody on the desk
  has read". They are not opposites, and the second column exists because the first could not be
  made to do both jobs. `lib/data/support.js` had one store and one flag, so the property that
  matters most here — *the desk clearing its own signal must not mark the customer's reply as seen*
  — was not merely untested, it was unfalsifiable. The live spec reads it back through the raiser's
  own `GET /support/tickets/{id}` after the desk has opened the ticket, which is the only place that
  assertion can be made honestly.

  **Two real defects, both invisible to the mock.**

  - **A nullable column dereferenced.** `SupportTicketMapper` filtered null author ids out of its
    batched name lookup and then, three lines later, called `m.getAuthorId().toString()` on the same
    id. One message whose author has gone — which the contract explicitly provides for, `author` is
    declared nullable for exactly this — turned `GET /support/tickets/{id}` into a 500 for the
    **customer who raised the ticket**, with no way to read past it. The e2e seed contains such a
    row, so the live suite found it on its first run. `ServiceRequestMapper` had the identical line
    over the identical nullable column and was guarded with it; `ConversationMessage.author_id` is
    `nullable = false`, so the other two call sites are genuinely safe and were left alone.
    Regression test: `SupportTicketEndpointsTest.authorlessMessageStillRenders`.
  - **The ops shell asking for something ops may not have.** `AdminLayout` mounts
    `AdminFlagsProvider` for both variants, and that provider reads `GET /admin/settings` — which is
    admin-only in both directions, because the same document carries fee configuration and the
    audit-log gate. So every `/ops` page load by a staffer fired two guaranteed 403s. Nothing broke,
    which is why it survived: the provider already falls back to defaults on a failed read. On the
    mock the store answered anyone. The ops variant now mounts the provider for its shape and skips
    the request — it consults neither a tab flag nor a module gate, its sidebar being a static list.

  **Also in this wave.** The queue pages at 25 rather than 20, matching the flatmate boards: two
  desks in the same shell paging differently reads as an accident, and an operator moving between
  them has no way to tell whether it is one. The mock spec went 7 tests → 1, keeping only the route
  guard, which is a property of the router rather than of the API and must hold whichever store
  answers.

  Suites: live support 6 ✅, backend support 15 ✅ and service-request 96 ✅, mock ops + admin ✅,
  lint 22 warnings / 0 errors, i18n ✅, build ✅.

- **Wave 3 — the mobile suite, all of it, and the sessions it had been inventing.** *(2026-08-15.)*
  `tests/mobile/**` moved wholesale: 28 specs, ~157 tests, now `live-*.spec.js` and routed by the
  live config's `mobile` (Pixel 7) and `mobile-small` (360×640) projects. The folder went as one
  piece rather than spec-by-spec because the thing it tests is not a feature, it is the chrome —
  the bottom nav, the safe-area insets, the tap floor, the 12px legibility floor. Splitting that
  across two stores would mean the phone layout was proved against the mock on Monday and against
  the API on Tuesday, with no single run that had seen all of it.

  **What the mock was hiding.** Almost nothing about layout, and quite a lot about identity.
  Six specs signed themselves in by writing a `puneNestUser` object into `localStorage`. That
  satisfied the mock's auth check, which only ever asked whether the key was there. It carries no
  token, so against the API every panel behind it renders its signed-out state — the specs would
  have gone on passing while measuring the wrong page. They now take the `login` fixture and sign
  in for real. `auth-keyboard` was the same trick one layer down: it seeded a `puneNestUsers`
  registry so that "Send OTP" would not bounce its number to `/signup`. It now uses a seeded
  account, which means the OTP step it asserts is the real one.

  **Two things the move corrected outright.**
  - **`/property/P5000` is a 404.** Four specs used the mock's upper-case id. The server matches the
    slug exactly, so on the live API those routes rendered a not-found page — and a not-found page
    has no five-stat band, no sticky CTA and no gallery rail, which is to say the sweeps would have
    passed by finding nothing to measure. Lower-cased to `p5000`.
  - **`property-contact` reached into `puneNestDB_v5`** to turn `inAppMessaging` off, because with
    it on the Contact button opens a chat instead of the enquiry sheet the spec is about. That is a
    settings row now, not a localStorage key, so it goes through the `flags` fixture — which also
    restores it afterwards.

  **Config.** `mobile-small` moved with the folder rather than being dropped: 360×640 is the
  realistic median device here and the width where bottom chrome, tap targets and labels break
  first. Its old home in `playwright.config.js` was deleted in the same commit, because with the
  folder gone it matched zero specs — and a project that matches nothing reports nothing, which is
  the quiet kind of coverage loss this repo keeps writing comments about. The live `chromium`
  project gained a `testIgnore` for the folder, or every phone assertion would also have run at
  1280px, where a 48px tap target is not evidence about a phone.

  **One product defect, found because the flag was on.** The Virtual Tour button on the property
  gallery rendered 133×**38** — six pixels under the floor, over a swipeable photo, so a near-miss
  paged the carousel instead of opening the tour. It had survived every previous sweep because the
  mock ran with `videoListings` off and the button was never in the DOM to be measured. An
  assertion that cannot see a control cannot fail on it; a flag that is off in the fixture is a
  blind spot in every sweep that runs behind it. Fixed to `min-h-[44px] sm:min-h-0`, matching the
  fullscreen button opposite.

  **Three fixture gaps, closed in the seed rather than papered over in the specs.** The live
  database had no verified flatmate seeker post (the flag is set from the author's Aadhaar status,
  and only Meera is verified), no conversation between any two *named* actors — the four seeded
  threads are between generated users, so the entire messaging surface was unreachable from any
  spec that signs in as Rahul or Priya — and only one `buy`-deal saved listing for Rahul, while
  `/saved` tabs by deal, so the swipe-and-undo spec had a single card and nothing to prove
  "the neighbour survived" against. All three are now seeded. The conversation rows had to be
  moved down the file: `R__zz_dev_demo_data.sql` replays top-to-bottom under `ON_ERROR_STOP=1`,
  the generated users exist early but the named actors are inserted around line 445, and the
  foreign key says so. A seed error aborts the whole live run before a single test executes.

  **One capability gap recorded rather than built.** `live-ops-field` lost four of its six tests:
  per-document Verify, Reject, View and Add-a-note exist on the mock desk and have no server
  behind them. The two that survive (the checklist renders, and it is read-only) were kept and the
  spec retitled. The cost of the gap is now measurable — four deleted mobile tests — which is the
  point of recording it here.

  **Three Playwright races the live API exposed and the mock never could.** A single tap-target
  measurement taken after an app-shell readiness gate found 0 elements on `/messages`, because that
  route replaces the shell with a full-screen spinner while its conversations land; the measurement
  is polled now, so a genuinely unrendered page still fails at the timeout but a loading state does
  not. The filter-drawer drag read its origin from a `boundingBox()` taken mid-animation and landed
  on the backdrop; it waits for two consecutive identical reads. And the sibling "a short drag snaps
  back" test passed *vacuously* whenever the gesture was ignored entirely — both drag tests now
  assert the hook actually armed before releasing.

  Suites: live mobile 193 passed / 1 skipped ✅ and mobile-small 193 passed / 1 skipped ✅
  (the skip is the wizard step-actions test, which skips itself on a viewport that cannot show
  the sticky bar and the field together), mock ✅, lint 22 warnings / 0 errors, i18n ✅, build ✅.

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
3. **How should the admin console bind to the permission catalogue?** — **RESOLVED 2026-08-14 (a).**
   *(raised 2026-08-13 by the
   [05](05-logic-to-backend.md) pre-port audit, which found no port was needed.)* The server owns a
   `module:action` atom model with per-account documents that may only narrow a role baseline,
   and serves it at `GET /admin/permission-catalogue`. The console instead computed navigation from
   `lib/permissions.js` using `customRoles`/`roleId`/`moduleAccess` — a vocabulary migration V61
   deleted and `PUT /admin/settings` now refuses with 422. It failed *closed*, so nothing was exposed;
   the console simply could not express the real model, and `AdminFlagsContext` read it from
   `lib/mockApi.js` in live mode.

   The options were (a) render
   the grid from the catalogue and drive nav from the caller's resolved atoms, deleting
   `lib/permissions.js` and the module-key vocabulary with it; (b) keep the module keys as a purely
   cosmetic nav grouping and map them onto atoms in one adapter; (c) defer until the `team` domain
   flips to http in [04](04-modules.md), which is when `AdminFlagsContext`'s seam violation had to
   be fixed anyway. (c) was taken first as the cheapest sequencing, then (a) as the answer.

   **Update 2026-08-13 — the seam half is done; the binding half is still open.** `team` flipped in
   Phase 4, so (c) came due. `AdminFlagsContext` and `AdminSettings.jsx` now read and write through
   a new `services/settingsService.js` (`GET`/`PUT /admin/settings`, `settings` added to
   `VITE_API_DOMAINS`), so the admin console no longer reads its flags, fee schedule and geo policy
   out of `db.json` in live mode. The http provider answers `getCustomRoles()` with `[]`, because
   V61 deleted the key and there is nothing to fetch.

   That made the **consequence** of the unresolved binding concrete rather than theoretical: live,
   a back-office account that is not an `admin` resolved to role plus the always-on base modules
   only. It failed closed — no tab was exposed that should not be — but a scoped account saw less
   than it should, and no amount of provider work could fix that, because the console was asking a
   question (`can this user open the "enquiries" module?`) the server had no answer to.

   **RESOLVED 2026-08-14 — (a), server-driven. Shipped as D209.** The console no longer resolves
   anything. `GET /me` now carries `User.permissions`, the caller's own atoms; `canAccessModule` in
   `adminModules.js` is a set-membership test against it; the grantable grid on Team & Access is
   rendered from `GET /admin/permission-catalogue` and the console holds no copy of the list.
   `lib/permissions.js` is deleted.

   Three things fell out of it, all of them things the console had been asserting and the server had
   never agreed to:
   - **Custom roles are retired, not deferred.** They composed a *widening* union
     (`BASE ∪ bundle ∪ moduleAccess`) against a model that may only narrow, which is why the server
     refused the key with 422 and V61 deleted the stored row. They granted nothing, and the tab
     already carried a banner saying so. The roles tab, `roleId`, `moduleAccess` and
     `settingsService.getCustomRoles` all went with them.
   - **`properties:verify` is gone.** A console-only sub-scope with no route behind it. Read-without-
     write now produces the verify-only Properties page, which is the same behaviour expressed in the
     server's own vocabulary.
   - **`manager` is gone, and `/admin` is administrator-only** *(ruling 2026-08-14)*. `manager` was
     never one of the contract's roles; it was the label on a custom-role bundle. The catalogue was
     also grown from 16 atoms to 27 so that every admin-shell module maps to one.

   The atoms an ops account holds are not decorative — they govern what the API grants it inside
   `/ops`. `live-rbac.spec.js` asserts that at the route, with the narrowed account's own token,
   rather than by reading a sidebar.

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

4. **Where do the analytics, finance and disclosure surfaces get their numbers?** — **OPEN, and
   deliberately deferred out of wave 4 (recorded 2026-08-14).** Three spec files totalling 48 tests
   still run against the mock: `analytics.spec.js` (19), `finance.spec.js` (24) and
   `finance-disclosure.spec.js` (5). They are not blocked on a seam that has not been written; they
   are blocked on a question nobody has answered.

   `AdminMetricsController` already serves `/admin/dashboard`, `/admin/analytics` and
   `/admin/finance`, all behind ADMIN plus the `finance:read` atom. So the endpoints exist. What does
   not exist is any statement that the numbers they return are the same numbers the console has been
   drawing. The mock computes its figures in the browser from `db.json` — revenue, conversion, payout
   and disclosure lines are all derived client-side, by code that was written to make a demo look
   plausible rather than to be right. Pointing the console at the server would therefore change the
   numbers on screen, and there is presently no way to tell an improvement from a regression, because
   neither side is anchored to a definition.

   That makes this a finance-correctness question wearing a migration question's clothes. Migrating
   it blind would be the worst of the options: the screens would look like they work, the figures
   would move, and the first person to notice would be whoever reconciles a payout.

   **These three files stay on the mock until the definitions land.** Closing it needs, in order:
   (i) a written definition per metric — what counts as revenue, when a conversion is counted, what a
   disclosure line must contain; (ii) a reconciliation of server output against those definitions;
   (iii) only then the seam and the spec rewrite. Step (i) is a product decision, not an engineering
   one, which is why this sits here rather than in the phase plan.

5. **A general internal-notes facility does not exist server-side.** — **OPEN, needs a product
   decision before it can be built (recorded 2026-08-14).** The console's `addInternalNote` is
   general: it attaches an ops-only note to a `report`, `user`, `banner`, `faq`, `announcement`,
   `review` or `listing`. The server has nothing equivalent. The nearest thing is
   `PropertyReview.addInternalNote(body)`, which is narrower in two ways that both matter — it is
   reachable only for a listing under verification, and it writes `review_messages.sender_id` as
   NULL, because it exists to record *system* notes rather than a named colleague's.

   So this is not a seam waiting to be wired. It is a table, a permission atom, an endpoint and a
   retention decision that have never been designed. Two questions have to be answered before any of
   that can be written: whether an internal note is *evidence* (immutable, retained, exportable on a
   dispute) or *scratch* (editable, deletable, disposable); and whether notes on a person are
   in-scope at all, given that a free-text field attached to a named user is the highest-risk column
   the product would own.

   Until then, two reads fail silently rather than loudly, which is the dangerous shape:
   `lib/mockApi/ownerComms.js` folds listing notes into the Communication Log as `type: 'note'`, and
   `lib/mockApi/users.js` reads them for a person. Both return `[]` against a live backend, so the
   log renders — just shorter. Whoever migrates those two call sites must make the absence visible
   instead of empty.
### 6. Owner outreach uncovered three product decisions, none of them technical

Wiring the outreach seam was supposed to be a straight port: the backend was already complete, and
the console had simply never called it. It is complete. But connecting the two surfaced three
questions that no amount of mapping answers, because each one is a decision about what the product
should say to a person.

**a. Should `wa-pricing` exist?** The template body reads `Avg rate: {market_rate}/sqft`, and the
server does not supply `market_rate`. That omission is right, and `OwnerOutreachService` argues it
well: the mock's value was the string `9,500` for every locality in Pune, and carrying that across
would be quoting an invented figure to an owner deciding what to charge. Unknown keys are left
standing rather than blanked, so the gap shows up in the preview the staff member reads. What is
unfinished is that the template is still returned by the library endpoint and still sendable, so the
only thing standing between an owner and a raw `{market_rate}` is somebody noticing. Either the line
gains a real per-locality rate, or the template is retired with `active = false` — the column exists
for exactly this, so a retired template still resolves for messages already sent. Inventing a number
is not a third option. `admin/live-outreach` pins the current behaviour and is written to be deleted
by whichever fix lands.

**b. Should a buyer see "Posted by PuneNest"?** The consumer card renders that badge today from the
flat `postedByAdmin` the mock kept on every listing. `PropertyResponse` omits `adminPipeline` from
consumer reads entirely — null rather than an empty object, specifically so the key is stripped,
because an empty object would still tell a buyer the field exists. The header says the omission is
intentional: the pipeline is back-office workflow. So this badge cannot be mapped back; it can only
be decided. If "we listed this ourselves" is a trust signal a buyer is entitled to, the contract
needs a single public boolean that is *not* the pipeline. If it is not, the badge goes. The one
outcome to avoid is it vanishing quietly during a migration, because it currently reads as a trust
marker and nobody would have chosen to remove it.

**c. Who owns the concierge fixtures?** All 38 seeded properties have `posted_by_admin = false`, so
the entire post-on-behalf surface is empty against the live API regardless of what the mapper does —
the chase button only renders for a staff-posted listing that is still pending. Wave 4b needs seed
rows before it can be tested: at least one listing per pipeline stage, owned by someone with a
mobile. That is a fixture-design decision (whose listings, at which stages) and it moves row counts
that existing specs may assert, so it should land against a known-green baseline rather than in the
middle of one.

There is also a genuine contract seam worth recording, though it needs no decision: outreach may be
written for any listing with an owner mobile, but the count that displays it is narrowed to
staff-posted listings before it is asked for. Both rules are individually sound. Together they mean
a chaser sent on an owner-posted listing is recorded, audited, and never counted. Any surface that
wants to show "chased N times" has to read the ledger rather than the count, and
`admin/live-outreach` asserts exactly that so the disagreement cannot drift further.
