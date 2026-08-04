# Tasks

> **Deferred / carried-forward items live in [`docs/system/tech-debt.md`](../docs/system/tech-debt.md)**,
> and items awaiting a decision in [`docs/system/open-questions.md`](../docs/system/open-questions.md) —
> not in this file. This file is the chronological worklog (plans + RESULTS per slice); those two are
> the SSOT for "what do we still owe" and "what must someone decide". When a slice defers something,
> record it there **once** and link, rather than adding another `### Deferred` heading here.
>
> **Unticked `- [ ]` boxes below are not a backlog.** Most are stale plan items from slices that
> subsequently shipped. They were swept and reconciled on 2026-07-31; the register is authoritative.

## One populated local DB, schema by Flyway only (DONE)

The decision: **one local database, kept populated, never truncated. Every schema change is a new
Flyway script. Pre-launch, the chain can be flattened into a clean baseline later.** Implemented,
and it closed D81 the same day it was opened.

- [x] **Backed up first, and checked the backup actually loads.** `pg_dump` in both formats to
      `~/punenest-db-backup`, then restored the V10-era data into a *fresh V30 schema* to prove it
      before touching the original. A backup nobody has restored is a hope, not a backup — and this
      one surfaced a real incompatibility (below) that would otherwise have appeared mid-rebuild.
- [x] **The demo data is now source.** `db/seed/R__zz_dev_demo_data.sql` — 38 listings, 78 users,
      plus conversations, visits and contact requests. An empty `punenest` now rebuilds to a
      populated app. Rebuilt DB matches the original **exactly** on every business table.
- [x] **Excluded from prod and from the test run**, via `spring.flyway.locations`. Both exclusions
      are load-bearing and one of them is a genuine trap: **a profile-specific properties file
      outranks a plain one regardless of source set**, so main's `application-dev.properties` beat
      the test's `application.properties`, the seed loaded, and the suite died in Flyway before the
      first test. It needed `src/test/resources/application-dev.properties` to override at the same
      precedence tier.
- [x] **Two guards, because both mistakes are invisible in review.** `MigrationChainTest` fails if
      two migrations create the same table (the V7/V24 `society_leads` duplicate that made the chain
      un-replayable) or reuse a version. `TestDatabaseIsolationTest` fails if demo data ever reaches
      the test DB — worth its own test because the failure mode is 126 simultaneous count failures
      that read as "the search filter broke", not "someone edited a properties file".
- [x] Old database kept as `punenest_pre_rebuild` on top of the file backups. Nothing was dropped
      until the rebuild was verified.
- [x] Verified: **737 tests, 0 failures** (from 733). Live API against the rebuilt DB returns 16
      approved of 38 with locality facets intact.

### Three traps, each of which cost a rebuild cycle

Recorded because none is obvious and all are permanent properties of Flyway:

1. **Repeatable migrations sort by description across *all* locations.** `R__dev_demo_data` sorted
   before `R__seed_reference_data`, so listings were inserted before the localities their FK points
   at. Hence the `zz_` prefix — any future demo seed needs the same.
2. **`ON CONFLICT (id)` is too narrow for a seed.** It failed on `users_mobile_key`: a seeded mobile
   can already exist under a different id, because a developer signed in before seeding. Bare
   `ON CONFLICT DO NOTHING` is what "leave it alone if it's already there" actually means.
3. **Data extracted from an old schema is not automatically valid under the current one.** One demo
   conversation violated `conversations_pair_ordered`, a CHECK added *after* that row was written,
   so nothing had ever validated it. The pair was swapped rather than the row dropped — a
   conversation is symmetric, so the ordering is a storage convention, not information.

### The pre-launch flattening, when you come to it

Two conditions, both from the same rule that caused today's outage: every environment must be
rebuilt from empty (there is no history to preserve), and it must be a deliberate reset rather than
an edit-in-place. Editing applied migrations is exactly what broke the dev DB.

## Backend API polish — pre-integration hardening (DONE)

Reviewed the whole backend surface (58 controllers, 202 operations) against what the UI needs,
before wiring any new domain to http. **The backend was not the bottleneck** — the contract is
broad and the discipline is unusually good. What it had were five defects and four holes.

### Defects fixed (bugs, not debt — rule 2 of the register)

- [x] **The 400 handler leaked internals.** `handleBadRequest` returned `ex.getMessage()` verbatim.
      For `HttpMessageNotReadableException` that message is Jackson's: target Java class, JSON
      pointer, and a slice of the submitted payload. It was the only handler in the file that
      echoed an exception, and it contradicted the class's own "logged, never leaked" promise.
      Split into two handlers — an unparseable body says nothing about why (detail at `debug`), a
      bad parameter names the parameter but not its Java type.
- [x] **405 and 415 were being answered as 500s.** `GlobalExceptionHandler` carries an
      `@ExceptionHandler(Exception.class)` and does not extend `ResponseEntityExceptionHandler`,
      so the catch-all outranked Spring's own resolver. `DELETE /properties` returned
      `internal` + a stack trace, as though the server had broken rather than the caller. The
      multipart controllers' Javadoc *asserts* Spring returns 415 before controller code runs;
      every existing 415 test exercised the vault's own byte-sniffing instead, so the claim had no
      coverage. `ErrorEnvelopeWebTest` now drives the dispatcher and proves both.
- [x] **`server.servlet.context-path=/api` was documented everywhere and set nowhere.**
      `api-standards.md` and `Routes.java` both said the prefix is applied by configuration; a grep
      found exactly one hit — the doc line. The backend served `/auth/login`, and it worked only
      because the Vite proxy rewrote `/api/*` → `/*`. Invisible in dev, fatal at deploy: an
      absolute `VITE_API_BASE` would have 404'd every request against a healthy backend.
      Set it, dropped the rewrite, and pinned it with `ApiContextPathTest` — which needs
      `RANDOM_PORT`, because **MockMvc does not apply the context path at all**, so all 700-odd
      existing HTTP tests pass whether the property is set or not.
- [x] **`punenest.web.cors.allowed-origins` was unset in prod**, so a deploy defaulted to
      `http://localhost:5173`. Fails closed, but every other prod value is a fail-fast `${ENV}`
      lookup and this one silently was not.
- [x] **The foundation-field rule covered five of the seven search facets.** `furnishing` and
      `possession` were applied as ordinary edits, so an approved unfurnished flat could be
      relabelled "furnished" and an under-construction one "ready to move" with no moderator
      seeing it — which is bait-and-switch precisely as defined. The rule is now derived from the
      facet list rather than curated: `ListingFoundationTest` reads `PropertyController.search` by
      reflection, so **a new facet fails the build until somebody classifies it**.
      Mutation-verified: removing the `furnishing` flag fails exactly one named test.

### Holes closed

- [x] `GET /properties/{id}/rooms` — declared in the contract since the flatmates slice, served by
      nothing. A generated client got a 404 from a promise the document made.
- [x] `PATCH /me/saved-searches/{id}` — alerts had create and delete and nothing between, so the
      toggle the UI renders had nowhere to send its change.
- [x] `GET /me/properties/{propId}/boost` — buying a window was a write with no read anywhere, and
      there is deliberately no `boosted` flag on the listing either (D59), so an owner who paid
      could not be shown what they had paid for.
- [x] `GET /admin/reviews` — `PATCH /reviews/{id}/status` shipped able to take a review down with
      nothing able to *find* one. Reviews are post-moderated, so every other read filters to
      `published`; a moderator could act only on reviews someone had already reported.
- [x] **`SpecCoverageTest` now asserts both directions.** It checked served ⊆ declared, which is
      why the rooms endpoint survived the entire build-out declared and unimplemented with a green
      suite. The coverage floor could not see it either — a ratchet counts what exists, not what is
      missing. Floor raised 200 → 204.

### Pagination

- [x] `GET /admin/flatmate-reviews` and `GET /admin/group-applications` were **platform-wide reads
      with no scoping, no filter, no cap and no `Pageable`** — the only two such endpoints in the
      API, in the only admin controller that did not page. Paging the first exposed a latent bug:
      it picked one of three finders and, when both `status` and `flagged` were supplied,
      re-filtered **in Java**. Harmless while the whole table is the answer; short pages and a
      wrong `totalElements` the moment it is sliced. Both predicates moved into one query.
- [x] `GET /me/saved` and `GET /messages` paged. `/me/saved`'s Javadoc claimed the list was
      "structurally bounded" while naming no structure — **"one user's clicks" is a rate, not a
      bound** — and returned a 22-field `PropertySummary` per save, forever. `/messages` argued
      §5.1's growth test correctly for a seeker and wrongly for an owner, whose inbox grows with
      *other people's* enquiries.
- [x] `V30__group_applications_created_index.sql` — the unfiltered admin board sorts on
      `created_at` alone and V29 indexed only `(listing_id, …)` and `(mod_status, …)`. Unnoticed
      while the whole table was the answer; paging without the index would keep the full-table sort
      and merely discard most of it.
- [x] **`api-standards.md` §5.1 gained an "inbound demand" row.** The rule said "grows with one
      user's own actions", which reads as scope; six `/me/` collections satisfy the scope and fail
      the growth test because the row is written by somebody else. That is the case most likely to
      get large in production — the successful owner is the one an unpaged read punishes.

### Verified

- [x] `mvn -o verify` green: **733 tests, 0 failures** (from 705). Spec: 164 paths / 206 ops, no
      dangling refs, no orphan schemas.
- [x] **JDK note for whoever runs this next:** the build targets release 25 and `JAVA_HOME` on this
      machine points at Zulu 17, so `mvnw verify` fails with "release version 25 not supported"
      until `JAVA_HOME` is set to `C:\Program Files\Zulu\zulu-25`.
- [x] Deliberately **not** done here: the client-side foundation-field list (D76), the sixteen
      remaining demand-driven unpaged reads (D77), `/me/contact-requests` (D78 — needs a server-side
      pending count *first*, or its badge silently under-counts), and `/properties/{propId}/reviews`
      (D79 — paging it makes the client-computed rating summary describe page one).

### End-to-end validation against a real server (asked for after the fact, and it found things)

The 733 tests run through MockMvc, which *stands in for* the servlet container. That gap is not
theoretical — it is exactly where the `/api` bug lived for the whole project. So the work was
re-checked against a real Tomcat and a real Postgres.

- [x] **New `backend/tools/live-probe.mjs`** — signs in for real (OTP read from the backend log),
      then drives the changed surface. **11/11 pass.** It proves the things MockMvc structurally
      cannot: `/api/properties` → 200 and `/properties` → 404 on the same server; 405 carrying an
      `Allow` header; 415 from Spring's own `consumes` refusal; the new endpoints reachable and
      correctly role-gated; `/me/saved` and `/messages` returning envelopes.
- [x] **The migration chain replays from empty.** Booted against a throwaway `punenest_replay`:
      *"Successfully applied 31 migrations"*. This was worth checking because **nothing in the suite
      checks it** — tests only ever migrate forward from whatever `punenest_test` already holds, so
      a migration that cannot build a database from scratch stays green forever. That is precisely
      how the duplicate `society_leads` in V7/V24 survived.
- [x] **Found: the dev database is unbootable and cannot be repaired forward — D81, High.** The V7
      edit changed its checksum, so Flyway refuses to start. `flyway repair` does not fix it: the DB
      is at V10, twenty behind, and already holds a `society_leads` from the *old* V7, so V24's bare
      `CREATE TABLE` will fail. It must be rebuilt — and **rebuilding destroys the demo data**,
      which migrations do not reproduce (0 properties vs the dev DB's 38) and no committed script
      regenerates. `pg_dump` it *before* dropping it, not after.
- [x] **Found: `backend/LOCAL_DB_STATUS.md` was actively misleading** — it pointed at
      `punenest_test` as "the seeded one", which is now the empty test DB the suite depends on
      being empty. Following it would have broken the suite. Rewritten with a warning box; the
      fixture ids below it are still good.
- [x] **Found and fixed: the `/api` change broke both parity harnesses.** `property-parity.mjs` and
      `contract-parity.mjs` call the backend **directly**, with no Vite proxy in front, so their
      `--base` must now carry `/api`. Left alone they would have failed identically to a real
      contract regression. Same fix in `LOCAL_DEV.md`, `.env.example`, `backend/README.md`
      (Swagger UI is `/api/docs` now) and the seam doc.
- [x] **`docs/LOCAL_DEV.md` now documents the DB test strategy**, which was nowhere: one long-lived
      `punenest_test` (not created per run), isolation by `@Transactional` rollback rather than a
      fresh database, audit rows as the standing exception because they commit `REQUIRES_NEW`, no
      Testcontainers (Docker unavailable — org sign-in), and the replay check above.

### Still not automated, and worth a decision

`e2e/tests/live-property-integration.spec.js` and both parity harnesses are excluded from the
default run and wired to no npm script — they need a backend, and the main suite deliberately must
not. So **every live check on this branch was run by hand.** That is defensible while integration is
one domain wide; it stops being defensible as more domains flip, because the checks that catch
wire-level drift are the ones nobody remembers to run.

<!-- above: feature/backend-integration | below: feature/ui-mobile-improvements -->

## PMF test overlay— public mockup deploy with demand capture (DONE)

## Mobile-first Phase 1 — unblock content + lock the size budget (DONE)

Implements Phase 1 of `docs/roadmap/mobile-ux-review.md`. All changes are UI/config
only, behind no backend dependency — the service seam (`services/config.js`) means a
later `VITE_API_MODE=http` swap touches none of it.

- [x] **A6** `scripts/check-bundle-size.mjs` + `npm run check:size` — gzip gate on the
      critical path, read from `dist/index.html` (entry + modulepreload + stylesheet)
      rather than guessed by filename. Ratchet at 560 KB (measured 550.7), target 180.
- [x] **B1** Nestor coach-mark: suppressed below `lg` on conversion routes
      (`/property/`, `/list-property`, `/checkout`, `/schedule-visit`, `/signin`,
      `/signup`); dismissal moved sessionStorage → localStorage with a 2-sighting
      budget so it stops reappearing on every page load. Ref-guarded against the
      StrictMode double-invoke (the exact trap `design-system.md` documents).
- [x] **B2** `/list-property` hero collapsed below `sm` (badge + subtitle desktop-only,
      tighter margins) — the first form control is now above the fold at 360×640.
- [x] **B3** Autosave "Draft saved" toast moved out of inline JS into
      `.pn-autosave-flash`; z-index 2000 → 90 (in the documented ladder, just above the
      tab bar) and offset rebuilt from the bar's own tokens so it no longer sits on it.
      Ladder updated in `docs/system/design-system.md`.
- [x] Contact-page consent checkbox: `.tap-target` on the label (was an ~18px hit area
      on a consent control). Sign-in/sign-up were **false positives** — their labels
      already meet the floor; the audit measured the `<input>`, not its label.
- [x] New spec `e2e/tests/mobile-content-budget.spec.js` (6 tests, both mobile
      projects) + `e2e/COVERAGE.md` row.
- [x] Corrected two wrong estimates in the review doc after measuring: **A5** CSS split
      is worth ~10–20 KB gzip, not 60–100 (209 KB raw → 37.9 KB gzipped); **A1/A2**
      re-rated S → L/M once the import graph was traced.
- [x] Full `mobile` + `mobile-small` suite: **366 passed, 2 failed**. Both failures are
      `help-i18n-urls` (the Hindi/Marathi footer-link cases) and are **pre-existing** —
      proved by stashing every source change and re-running the spec, which failed
      identically. `locales/mr/chrome.json` was already modified before this work began.- [x] Verified after restore: lint 0 errors (402 pre-existing warnings), build exit 0,
      size gate exit 0 (550.7 / 560 KB), content-budget spec 6/6 on both projects.
- [x] Desktop (`chromium`) suite: **957 passed, 85 failed, 13 flaky**. Proven **not
      mine** by an A/B run: stashed all six source edits, ran the four worst-hit specs
      (`list-property-p3`, `society-community`, `flatmates-eligibility`,
      `flatmates-groups`) → **12 failed / 9 passed**; restored the edits, ran the same
      four → **12 failed / 9 passed**. Byte-identical result.

### Pre-existing desktop breakage — NOT addressed here, needs a decision
The branch carries substantial uncommitted work from an earlier session that this task
did not touch: `InstallPrompt.jsx`, `uiEvents.js`, `MobileSearchSheet.jsx`,
`VerifyModal.jsx`, `CityChrome.jsx`, `CityContext.jsx`, `propertyTypes.js`, `Reels.jsx`,
`reels.css`, and six `i18n/locales/**` files. The 85 desktop failures cluster almost
entirely in flatmates (~80 of them) plus `list-property-p3`, `society-community` and
`help-i18n-urls` — i.e. exactly those areas. Representative failure:
`list-property-p3` expects `[data-err="documents"]` and gets 0 elements.

Left alone deliberately: it is someone else's in-progress work, and "fixing" a red test
by editing unfamiliar half-finished code is how real work gets discarded. Flagged for
the owner to triage.

## Mobile-first Phase 3 — touch targets the sweep missed (DONE)

`mobile-tap-targets.spec.js` sweeps a fixed route list; every control below sat
outside it, which is how a 6px slider rail and an 8px carousel dot survived a suite
of 178 specs. Baseline was captured **before** any edit this time.

- [x] **C2** EMI sliders (`/emi-calculator`): rail hit area 6px → 32px, thumb 20px →
      28px under `pointer: coarse`. The rail is still *drawn* at 6px via
      `background-size` — a fat bar reads as a progress meter, not a slider. Required
      moving the fill gradient out of an inline `background:` shorthand (which resets
      background-size/position and outranks any stylesheet rule) into a `--emi-pct`
      custom property.
- [x] **C2** Budget/area value labels (`.rng-val` on `/listings`): 15x16 painted →
      44x44 hit area via a transparent `::before`, same trade as `.tap-extend`. The
      `.rng` *thumbs* already grew to 28px on touch — that part was already correct
      and documented; only the labels were missed.
- [x] **C3** `/plans` carousel dots: 8x8 → 24x44. Deliberately not 44x44 — three 44px
      dots either overlap (ambiguous taps, worse than small ones) or spread so far
      they stop reading as one indicator. 24px is the WCAG 2.5.8 AA floor and puts
      adjacent centres 32px apart.
- [x] **D2** Admin header icon buttons: `.tap-extend` + real `aria-label` on Open
      menu / Close menu / Log out. They had `title` only, which never surfaces on a
      phone — an icon-only control named only by `title` is unnamed.
- [x] **D3** The two `/admin` Latest-activity cards: added `min-w-0`. A grid item
      defaults to `min-width: auto`, so the track refused to shrink and the card ran
      14px past the viewport with its Review button clipped off screen. The inner rows
      were already built to truncate; they just never got the chance.
- [x] New spec `e2e/tests/mobile-touch-targets-p3.spec.js` (5 tests) + COVERAGE row.
- [x] Verified: lint 0 errors, build exit 0, size gate exit 0 (550.8 / 560 KB),
      new spec 5/5, regression set **59 passed / 1 failed**.
- [x] The 1 failure (`admin-rbac` → "Team & Access renders seeded members") is
      **pre-existing**: stashed only the two admin files I touched, re-ran, failed
      identically. Same `/admin/team` seeding issue as the wider desktop breakage below.

### Not done, and why
- **C4** (property gallery thumb strip, 22px wide): the honest fix is to drop the
  thumbs below `sm` and rely on swipe + the existing `1/6` counter, not to grow them.
  That is a gallery-interaction decision, not a sizing tweak — raised, not taken.
- **A7** (preload the LCP image): deferred with A1/A2. The hero URL is only known
  after JS runs, so a static `<link rel=preload>` in `index.html` cannot name it; doing
  this properly means emitting the preload from the route, which is Phase 2 work.

## Mobile-first Phase 4 (partial) — native-app affordances (DONE)

- [x] **E7 measured first, and it is NOT a defect.** Scrolled `/listings` to y=1400,
      opened a property, pressed Back → restored to exactly 1400 (max scroll 3739, so
      the position was real, not a clamp). The `navType !== 'POP'` guard in `App.jsx`
      already works. Review row corrected from "gap" to "verified". No code written.
- [x] **E5 — found a real bug the audit had missed.** On `/property/:id`, dismissing
      the OS share sheet rejects with `AbortError`, which fell into the clipboard
      `catch` and raised a "Couldn't copy link" error toast. The single most common
      outcome of tapping Share on a phone reported a failure for working correctly.
      Reels and Refer already handled `AbortError`; this surface did not. Fixed, and
      the fix is regression-proven (see below).
- [x] **E4** `lib/haptics.js` + wired to save-a-listing (`tick`) and wizard step
      advance (`step`). Suppressed by BOTH `prefers-reduced-motion` and the existing
      `pnAppPrefs.reduceMotion` toggle — deliberately **no new setting**, since a third
      switch is one more thing to find and could disagree with the two that exist.
      Imports `getAppPrefs` from `store/account.js`, not the `store.js` barrel, so a
      tick does not drag the whole store graph into every component.
- [x] New spec `e2e/tests/mobile-native-affordances.spec.js` (4 tests) + COVERAGE rows.
- [x] **Proved the new test actually catches the bug:** stashed only the share fix,
      re-ran the spec → **failed**; restored it → **passed**. A regression test that has
      never been seen to fail is decoration.
- [x] Verified: lint 0 errors, build exit 0, size gate exit 0 (550.8 / 560 KB),
      regression set across property / wizard / saved / reels / refer / settings +
      all three new mobile specs — **58 passed, 0 failed**.

### Honest limits of E4
- **iOS gets no haptics.** No WebKit browser implements `navigator.vibrate`, so every
  browser on iOS is a silent no-op. India is ~95% Android so this still reaches nearly
  the whole audience, but iOS needs the Capacitor Haptics plugin — it is not a web fix,
  and pretending otherwise would be worse than the gap.
- Only two interactions are wired. The review listed four; filter-apply and
  contact-reveal were left until the two shipped ones have been felt on a real device.
  Haptics are trivial to over-apply, and a phone that buzzes constantly is worse than
  one that never does.

### Still open from Phase 4
- **E5 (the other half):** extending `navigator.share` to society pages and flatmate
  posts. The bug fix was the urgent part; the extension is additive.
- **E1** (offline state) and **E3** (pull-to-refresh) remain deferred — both need real
  network failure and real latency to be testable, which means the backend.
- **E2** (skeletons): buildable now, but mock data resolves instantly so the timings
  cannot be tuned honestly until there is a real API.

## Mobile-first Phase 5 — unreachable control + unreadable safety badge (DONE)

Two defects that produce **no** console error, no layout shift and no horizontal
scrollbar, which is why 180 specs never noticed them.

- [x] **`/societies` Verified filter was unreachable on a phone.** Measured at
      x=364..481 on a 412px viewport — 69px past the edge, clipped by an ancestor so
      there was no page scroll to reach it and nothing looked broken. Same root cause
      as D3: two `flex-1` selects with the default `min-width: auto` refused to shrink
      ("Sort: Recommended" alone claimed 186px). `min-w-0` + `flex-wrap`. Re-measured:
      all three controls now end at 383 inside a 396 toolbar, no wrap needed.
- [x] **`.badge-seeker` "VERIFIED" raised 9px → 11px below `sm`** (`/flatmates`). This
      is the badge that tells someone whether the stranger they might share a flat
      with has passed an identity check — the one place in the audit where small text
      has a safety cost, not an aesthetic one. Verified 7 badges render at 11px with
      0 overflow past card or viewport at 360px.
- [x] Two new tests in `mobile-content-budget.spec.js` (now 10 tests, both projects).
- [x] **Both new tests proven to catch their bugs:** stashed the two fixes → both
      failed (`controls escaping a 412px viewport`, `VERIFIED badge font-size`);
      restored → both passed.
- [x] Verified: lint 0 errors, build exit 0, size gate exit 0 (550.8 / 560 KB),
      regression set **63 passed / 3 failed**; the 3 are `flatmates-filters` and are
      **pre-existing** (stashed both my files, re-ran, failed identically — same
      flatmates cluster as the wider desktop breakage documented above).

### A correction to my own audit
The review listed `.badge-verified` / `.badge-rera` as 9px trust badges needing a fix.
I raised them, then measured: they render **zero times on a phone** — they belong to
the desktop-only list-row card variant. The change was reverted. The audit had read
`text-[9px]` in source and assumed it reached mobile users. Source-grep is not
evidence of what renders; only measurement is.

### Deferred, with reasons
- **A1** (`db.json` off the entry chunk): `rawLoad()` is synchronous and called from
  dozens of sites, so a dynamic import means an async refactor of the whole mock
  layer — code that is deleted when the backend lands. Do the `VITE_API_MODE` gate
  instead, or nothing.
- **A2** (`societies-rera.js`): on the critical path via Home's societies rail, so it
  is a data-shape change rather than a config tweak.
- **Property price above the fold at 360×640**: measured at y=551 with the sticky CTA
  at y=505. Closing that needs ~90px, i.e. shrinking the hero gallery on a property
  site. That is a photo-vs-price product decision, not a bug — raised, not decided.

## PMF test overlay — public mockup deploy with demand capture (DONE)

Temporary, non-invasive overlay to test product-market fit before backend/company.
Everything gated behind `VITE_PMF_MODE` (off by default → dev flow untouched).
Stack: Netlify (host) + Netlify Forms (capture) + GA4 (analytics).

- [x] `src/lib/pmf.js` — flag read, `track()` (GA4), `captureLead()` (Netlify POST); no-ops when off.
- [x] `PreviewBanner.jsx` — one-line honest "early preview" banner (App-level).
- [x] `NotifyMe.jsx` — gate-free email/WhatsApp capture on Home (top-of-funnel signal).
- [x] Instrumented existing contact actions (ContactOwnerModal + ContactBox) + `view_listing` + `page_view`.
- [x] `index.html` — hidden Netlify `pmf-lead` form + widened CSP for GA4.
- [x] `netlify.toml` + `public/_redirects` (SPA fallback); `.env.example` documents the flags.
- [x] Verify: lint clean on touched files (0 errors); build passes flag-off AND flag-on; overlay artifacts present in flag-on dist; contact/property e2e (6 specs) green.
- Kept existing sign-in + Aadhaar contact gate as-is (user decision).
- Pre-existing (not mine): `src/components/Header.jsx` is a broken placeholder file → 1 lint parse error; unused/unimported, build unaffected. Flagged to user.
- PENDING (needs user credentials): create Netlify site + set `VITE_PMF_MODE=on` & `VITE_GA_ID`; deploy; share URL.

## OpenAPI as the single source of truth for API design (DONE)

Goal: make `backend/src/main/resources/static/openapi/punenest-api.yaml` the one
authoritative API design; remove duplicated API design from every other doc.

### Phase 1 - Make the OpenAPI solid
- [x] Canonical `Role` enum -> `[buyer, owner, staff, admin]`; align `Party.role -> [buyer, owner]`.
- [x] `Team` enum -> `[rental, legal, interior, packers, valuation]`.
- [x] `bearerAuth` description: JWT claims `sub, role, mobileVerified, aadhaarVerified` + staff `team`.
- [x] `info` block: version `1.0.0 -> 1.1.0`; declared spec as SSOT + changelog note.
- [x] Validate: YAML parses, 403 `$ref`s / 0 unresolved.

### Phase 2 - Remove duplicated API design
- [x] `docs/system/api-contract.md` -> gutted 25KB catalogue; now a ~2KB pointer stub.
- [x] `docs/system/cross-cutting.md` -> removed literal error/pagination/role JSON; point to spec.
- [x] All 27 `docs/flows/**` -> "Target API endpoints" lead-ins repointed to the OpenAPI spec.
- [x] `README.md`, `docs/README.md`, `docs/coverage-matrix.md` -> repointed to spec.
- [x] `docs/roadmap/build-roadmap.md` -> repointed refs + added "Spring Boot 4.1.0 / Java 21".
- [x] `docs/system/backend-api-architecture-review.md` -> role list `-> [buyer, owner, staff, admin]`;
      rewrote "API Catalog" from "maintained in two places to avoid drift" to single-source.
- [x] `docs/system/app-architecture.md`, `docs/system/domain-model.md`, `backend/README.md` -> repointed.

### Phase 3 - Verify
- [x] OpenAPI re-parsed: 403 refs / 0 unresolved; role/team/party enums correct.
- [x] Grep sweep: no endpoint tables / request-response JSON remain in `docs/system/*.md`.
- [x] Remaining `api-contract.md` references are all legitimate (pointer-stub self-refs +
      one flow prose note about a sample-value discrepancy).
- [x] Temp validation scripts removed.
- [ ] `mvn -q verify` -- BLOCKED (pre-existing, not caused by this work): local JDK is **17**,
      but backend `pom.xml` targets **Java 21** (`release version 21 not supported`). Docs/OpenAPI
      changes touched zero Java. To build the backend, install a JDK 21+ toolchain.

## Mature OpenAPI to cover all React needs (retire path for domain-model.md) (DONE)

Goal: verify `docs/system/domain-model.md` captures everything React needs, then extend the
OpenAPI spec to cover it entirely so domain-model.md can eventually be retired.

- [x] Deleted `docs/system/api-contract.md`, `_audit_openapi.py`, `_oapi_check.py`; repointed links.
- [x] Gap analysis (domain-model 33 entities vs OpenAPI vs React). Verdict: domain-model was more
      complete; flow docs already flagged the gaps as "missing but implied".
- [x] Phase A - Societies (`Society`/`SocietyDetail` + `/societies`, `/societies/{slug}`, follow),
      Reels (`Reel` + `/reels`), entity reviews (`Review.targetType` += society|owner,
      `/reviews/{entityType}/{entityId}`).
- [x] Phase B - Messaging: `Conversation`/`ConversationCreate` + `/messages` (list/start),
      `/messages/{id}` (thread/reply/read).
- [x] Phase C - Referrals+fraud (`Referral` + admin `/referrals`, approve/reject/clawback);
      enriched `AdminSettings` (site/fees/movePack/flags/permissions/customRoles), `User`
      (team/status/verified/city/counters), `Property` (views/enquiries/featured/verification flags/
      owner{}/adminPipeline{}).
- [x] Phase D - field closers: `Transaction.recurring`, `OwnershipBasis.currentValue`,
      `Offer.history[]`, `Ticket` (customer/mobile/value/service/notes[]), `Locality`
      (demand/avgRent/focus/lat/lng/active), `DocumentRequest.acknowledgedDisclaimer`,
      `SavedSearch`/`SavedSearchCreate` (filters/channel/newCount) + **fixed YAML `off` bool bug**
      (unquoted `off` -> `"off"`).
- [x] Phase E - parity verified: 138 paths, 107 schemas, 452 refs, 0 unresolved, 0 unused. All 33
      domain-model entities now map to a schema.

### Retire path for domain-model.md (DONE - user chose the ADR path)
- Created `docs/system/data-model.md` (ADR): entity->OpenAPI-schema map + the DB-only truth that a
  wire contract can't hold (ER overview, ID/timestamp/money/soft-delete conventions, mobile-key->FK
  migration, the 10 seed-vs-contract reconciliations, migration strategy).
- Repointed every `domain-model.md` reference across 33 docs + root `README.md` + the OpenAPI header
  to `data-model.md`; reworded doc-map descriptions ("canonical entities" -> "ER map + persistence
  design; field shapes -> OpenAPI schemas").
- Deleted `docs/system/domain-model.md`. Repo-wide grep: no dangling `domain-model.md` links
  (only an intentional "Supersedes" mention inside data-model.md).
- Open decision still pending: delete the 2 stale `VERIFICATION_*.md` QA reports (reference a
  deleted `HTML_APP_MIGRATION_SPEC.md`; nothing links them)? Defaulted to KEEP.

## Notes / follow-ups
- `AGENTS.md:57` still says "Spring Boot 3" (skill description). Left unedited: it is instruction
  config, not API design. Flag for the user if they want it corrected to Boot 4.
- Non-auth enums intentionally keep `user`/`tenant` tokens: moderation `targetType`
  `[property, user, review, post]` and content `audience` `[owner, tenant, buyer, agent]`.


## Platform & solution architecture (MVP pass) (DONE)

Iterative, one-question-at-a-time design in `docs/system/platform-architecture.md`.
Criteria every decision: Performance / Security / Cost / Ops simplicity. Founder constraint:
free-tier-first ($0 until real usage forces it). 16 ADRs ratified:

- [x] ADR-005 Platform/compute = Cloud Run (Mumbai) + managed Postgres + Cloudflare Pages/R2 + FCM
- [x] ADR-006 Rejected Firestore/BaaS core; FCM push only
- [x] ADR-007 DB = Supabase Postgres (Mumbai), pure Postgres, PgBouncer pooler; India residency
- [x] ADR-008 Session = httpOnly+Secure+SameSite cookies, short access JWT + rotating refresh + CSRF
- [x] ADR-009 KYC = paid aggregator Aadhaar OKYC/OTP behind KycClient seam (first paid prod dep)
- [x] ADR-010 Notifications = WhatsApp Cloud API + Brevo + Postgres in-app, transactional outbox
- [x] ADR-011 Jobs = Cloud Scheduler -> internal endpoint + warming ping + startup CPU boost
- [x] ADR-012 Search = PostgreSQL (indexes + FTS + pg_trgm + PostGIS) behind swap seam
- [x] ADR-013 Media = pre-signed direct-to-R2, split public/private buckets
- [x] ADR-014 Payments = Razorpay, fee-only at MVP (rent off-platform)
- [x] ADR-015 Cache/limits = defer Redis; CDN + Postgres + in-process + Cloudflare edge/Turnstile
- [x] ADR-016 Ops = Secret Manager + GitHub Actions + Cloud Logging/Monitoring/Sentry; DR pg_dump->R2

Diagrams added: system context, high-level (full), deployment, + sequences (OTP login, contact
gate/OKYC, scheduled alert/outbox). Open (non-blocking): A-Q2 MVP scale, A-Q4 team size.
Two unavoidable paid prod deps: SMS OTP (DLT/TRAI) + Aadhaar KYC; free in dev via seams.

## KYC identity model refinement (ADR-009a) (DONE)

Clarified the Aadhaar/KYC design in `docs/system/platform-architecture.md` (§6.4):
- [x] Two OTPs, two proofs: login OTP secures registration mobile (A); Aadhaar OKYC OTP proves genuine
      unique identity (B). Aadhaar OTP is mandatory for every gated user.
- [x] No "mobile -> identity" lookup exists; aggregator releases data only on Aadhaar/VID + OTP consent.
- [x] Uniqueness via entity-scoped **UID token** stored as UNIQUE dedup anchor; **never store raw Aadhaar**.
- [x] Mobile-match policy (Option 1): buyers soft-flag on A!=B (no block); owners posting a listing
      hard-require A==B (403 mobile_match_required).
- [x] `kyc_verification` schema: user_id, uid_token UNIQUE, verified, name, dob, gender, aadhaar_masked,
      mobile_match, source, verified_at.
- [x] Updated contact-gate sequence diagram; added ADR-009a; aggregator must expose a stable UID token.

## Payment gateway free-tier clarification (ADR-014 refined) (DONE)

- [x] Clarified: no India gateway has a "free usage tier"; all are ₹0 fixed cost + free sandbox +
      pay-per-successful-transaction (fits $0-until-revenue). Razorpay/Cashfree/PhonePe PG/PayU/Stripe.
- [x] Key nuance: zero-MDR (govt-mandated 0% on UPI/RuPay) zeroes only the network cost, NOT the
      aggregator's service fee -> UPI through Razorpay is typically NOT free.
- [x] GPay/PhonePe are payer-side UPI apps, not merchant integrations; you accept UPI, any app pays.
- [x] Two routes recorded: Route A aggregator (Razorpay, chosen MVP - webhooks/reconciliation worth the
      tiny fee); Route B direct UPI collection (QR/deep-link, near-0% but manual reconciliation, UPI-only)
      as a documented future cost-reduction path behind the PaymentClient seam.
- [x] Added payments row to §4.1 cost map; enriched §6.8 + ADR-014. Flag: confirm live per-txn rates.

## Production prerequisites & legal dependencies (India) (DONE)

Added §9 to `docs/system/platform-architecture.md`:
- [x] 9.1 Needs a registered entity: Payments (Razorpay), Aadhaar KYC aggregator, SMS OTP (DLT/TRAI),
      WhatsApp (Meta Business verification) + cross-cutting: money collection (current a/c, GST) & DPDP.
- [x] 9.2 Personal-signup OK: Cloud Run/GCP, Google Maps, Supabase, Cloudflare, FCM, email, Sentry/
      UptimeRobot/GitHub Actions, Upstash.
- [x] 9.3 Go-live sequencing: build on mocks now; incorporate; start DLT + Meta first (slowest);
      then gateway/KYC KYC; GST+DPDP; flip seams mock->real with no code change.
- [x] Flagged as engineering map, not legal advice (confirm GST/DPDP/entity type with a CA).
## Architecture diagrams completed (platform-architecture.md §5)
- [x] 5.3 Component Diagram - modular-monolith internals: cross-cutting filter chain, feature modules, provider seams -> Postgres/external.
- [x] 5.4 API Interaction Flow - request lifecycle through edge + CSRF/JWT/role/gate filters -> controller/service/repo, audit+outbox in-txn.
- [x] 5.5 Data Flow Diagram - PII residency (Mumbai DB), R2 public/private buckets, minimum-data-out to seams; raw Aadhaar never stored.
- All seven views (5.1-5.7) now drawn; status header + §5 intro updated.
## Legal entity & compliance advisory (DONE)
- [x] Created docs/system/legal-entity-and-compliance.md (Pvt Ltd recommendation, SPICe+ roadmap, compliance checklist, tax/funding, IP, MahaRERA/DPDP flags, 30-day plan)
- [x] Cross-linked from platform-architecture.md 9 and registered in docs/README.md

## Cashfree provider consolidation persisted (platform-architecture.md)
- [x] ADR-017 - Cashfree as primary vendor: Secure ID (DigiLocker KYC) + PG (fee collection); Payouts deferred behind PayoutClient seam; Razorpay = documented fallback.
- [x] ADR-018 - Cloud Run prod 2FA for Secure ID/Payouts = RSA public-key signature (X-Cf-Signature), not IP-whitelist (dynamic egress IP).
- [x] ADR-009 amended - Aadhaar is Cashfree DigiLocker-only (no standalone OTP OKYC product); webhook-driven, no GET /status.
- [x] ADR-009a revived - DigiLocker success webhook returns `mobile`, so owner hard mobile-match IS feasible; buyers soft-flag.
- [x] ADR-009b - dedup via composite identity_hash = SHA256(name|dob|gender|care_of|uid_last4) UNIQUE; never raw Aadhaar; 409 on duplicate; admin transfer for re-registration.
- [x] Rewrote 6.4 (KYC) and 6.8 (Payments); added 2 sequence diagrams (DigiLocker KYC, Cashfree PG); updated contact-gate diagram + data-flow labels + component inventory for coherence.
- [x] 9.4 added - pricing-verification checklist (skill has NO pricing): per-verify price, monthly floor, live MDR, instant-settlement fee, festive-0% applicability, TDS 194-O, payout fee.
- Verified: 11 mermaid blocks, 22 fences balanced; no stale uid_token/OKYC refs (ADR-014 marked superseded).
- PENDING (user): obtain written Cashfree quote before commercial sign-off of ADR-017.
## Feature/business-model reviews documented (docs/feature review/)
- [x] Created "docs/feature review/" folder with README index.
- [x] 01-business-model-kyc-thesis.md - skeptical VC review of "mandatory KYC everywhere" thesis for buy/rent; verdict PIVOT; incumbents keep spam because brokers=paying customers + liquidity>purity; includes scorecard, 3 failure/3 win scenarios, steel-man, implementation checklist.
- [x] 02-flatmates-market-and-feature-review.md - flatmate market sizing (Pune SAM ~600-900k, high churn every 8-14mo) + feature review; verdict WEDGE-lead-with-it; KYC becomes an asset here; GrabHouse=monetization graveyard; corridor GTM (Hinjewadi-Wakad-Baner), women-safety hook, move-in-services monetization, MVP scope trims.
- Both docs are advisory (for founder review + later implementation), each ends with a lift-into-todo checklist.
- Note: market numbers are reasoned estimates (informal market, no audited data) - flagged as assumptions in-doc.
## Trust model pivot: "verification as a badge, not a gate" (docs/system/trust-and-verification-model.md)
- [x] Reframed thesis: PuneNest = structured, trustworthy home for the market now living in Pune Facebook/Telegram groups (free, direct, broker-optional) minus their spam/staleness/no-trust.
- [x] Defined 4-tier Trust Ladder (L0 anon -> L1 mobile -> L2 DigiLocker badge -> L3 deal-verified).
- [x] "When to offer KYC" matrix for owner/buyer/broker: offer/nudge at intent, REQUIRE only at L3 (token/agreement).
- [x] Anti-spam WITHOUT gates: freshness "still available?" ping + auto-expiry (top priority), duplicate collapse, verified+fresh ranking boost, reputation signals, community reporting, masked-contact request/approve.
- [x] Business model: free discovery/posting; revenue at deal layer (agreement/e-stamp/token/escrow/KYC), verified boosts, broker subscriptions, ancillary.
- [x] Phased build: P0 50-owner validation gate -> P1 MVP (listings+search+freshness+direct contact) -> P2 badge/ranking -> P3 deal room+both-side KYC -> P4 scale.
- [x] Proposed ADR-019 (badge-not-gate) + amend ADR-009a (mobile-match soft at MVP, hard only at L3) + ADR-009b (identity_hash soft signal at MVP, hard UNIQUE deferred).
- [x] Persisted ADR-019 + amended ADR-009a/009b + A-Q5/A-Q15 + status header + 6.4 enforcement bullets in platform-architecture.md (fences balanced).
- [ ] PENDING: 4 open questions (freshness cadence, L1 contact-reveal vs chat-only, broker-lane timing, first 5 localities).
- [ ] NEXT GATE: Phase 0 - hand-recruit 50 real Pune owners/listings before any new backend code.
## OpenAPI badge-not-gate KYC update (ADR-009a/009b/017/018/019) - DONE
- Bumped punenest-api.yaml -> 1.2.0 with changelog note.
- /me/verification/aadhaar: POST now STARTS Cashfree DigiLocker consent flow (202 + verificationUrl, no Aadhaar number); GET returns opt-in badge. Added 409 aadhaar_already_registered (identity_hash dedup, badge-flow only).
- Added POST /webhooks/cashfree/digilocker (HMAC-verified provider callback; RSA-signed egress per ADR-018; carries mobile for soft mobile-match).
- /contacts/request: removed blanket 403 aadhaar_required; now L1 sign-in only (401 if unauth); 403 verification_required ONLY when owner opted "verified contact only".
- Schemas: replaced AadhaarSubmit -> KycStartRequest/KycStart; expanded AadhaarVerification (badge/status/source/mobileMatch); added DigilockerWebhook; ContactStatus requiresAadhaar -> verifiedContactOnly + verificationRequired; User gains verifiedContactOnly + reworded badge fields; AdminSettings aadhaarGateEnabled -> kycBadgeEnabled.
- Auth note + Forbidden example de-gated. Validated: openapi-spec-validator (OpenAPI 3.1) PASS; all $refs resolve.
- NOTE: security-reviewer not spawned (contract/doc change only; change reduces surface by removing raw-Aadhaar intake and documents webhook HMAC). Re-review at backend implementation.
## OpenAPI end-to-end functionality annotations (links/callbacks/externalDocs/examples) - DONE
- Added root externalDocs -> platform-architecture.md (explains docs carry the cross-call journey).
- components/links (6, reusable): GetCurrentUser, PollKycBadge, CheckContactStatus, CloseThisDeal, FinalizationStatus, RespondToOffer.
- components/callbacks (2, reusable): DigilockerVerificationResult, PaymentResult.
- New PaymentWebhook schema + POST /webhooks/cashfree/payment path (parallels DigiLocker webhook; HMAC-verified, idempotent on orderId).
- Flow-entry ops annotated (narrative description + externalDocs + links, callbacks where a provider calls back):
  login->getMe; submitAadhaar (callbacks + examples + poll link); requestContact (status link + 2 examples); reserveDeal->closeDeal; submitOffer->respondOffer; requestFinalization->finalizationStatus; payRent/subscribe/boostListing (PaymentResult callback + pending-state narrative).
- Scope note: applied only to genuine multi-step/stateful/async flows, NOT plain CRUD GETs (links there would be noise) - matches "do it for all [flows]".
- Validated: openapi-spec-validator (3.1) PASS; all $refs resolve; all 6 link operationId targets exist. paths=140, schemas=110, links=6, callbacks=2.
## React badge-not-gate — Page 1: List Property (DONE)
- Removed the Aadhaar posting gate: deleted useListingGate.js + AadhaarGate.jsx.
- useListProperty.js: dropped requireAadhaar() guard from submitProperty/submitFlatmate; removed gate hook, isAadhaarVerified import, logout.
- progress.js: removed AADHAAR_WEIGHT; meter now = listing-field completion only.
- ListProperty.jsx: always render the form (no gate branch/verified banner).
- Build: PASS. i18n listProperty.gate.* strings now orphaned -> deferred to Page 8 sweep.

## React badge-not-gate — Page 2: Property contact de-gate (DONE)
- contact.js: removed blanket aadhaar gate in requestContact(); now L1-only, returns 'verification_required' ONLY when owner opted into verified-contacts-only. Added isViewerVerified() + ownerVerifiedOnly() helpers (verifiedContactOnly owner pref).
- ContactBox.jsx: aadhaar_required -> verification_required branch.
- ContactOwnerModal.jsx: request() -> verification_required; sendEnquiry() de-gated to L1-only (removed isAadhaarVerified block); simplified verify state to bool.
- Owner.jsx: aadhaar_required -> verification_required, message reframed to Verified-badge.
- constants.js: CONTACT_STATUS.AADHAAR_REQUIRED -> VERIFICATION_REQUIRED (was unused).
- Owner verified-only TOGGLE (to SET the pref) comes on Page 4; defaults false so contact is ungated meanwhile. Build: PASS.

## React badge-not-gate — Page 2 FIX: property-page 'Contact Owner' chat gate (DONE)
- Root cause: the popup came from a THIRD gate I'd missed — the in-app CHAT path, not requestContact. useProperty.js handleContact() blocked chat on isAadhaarVerified() -> opened AadhaarVerifyModal.
- useProperty.js: removed the isAadhaarVerified gate from handleContact; dropped aadhaarOpen state, isAadhaarVerified import, and the aadhaarOpen/setAadhaarOpen exports.
- PropertyModals.jsx: removed dead AadhaarVerifyModal block + import + unused props.
- MapDetailPanel.jsx: same de-gate on contact(); removed aadhaarOpen state, keydown dep, modal block, and 2 unused imports.
- Chat/contact is now L1-only across property detail + map panel. Build: PASS.

## React badge-not-gate — Page 3: Verify modal -> opt-in DigiLocker badge (DONE)
- AadhaarVerifyModal.jsx: reframed gate->badge. Title 'Verify your identity to continue' -> 'Get your Verified badge'; aria-label updated.
- Default subtitle/note reframed to opt-in trust + DigiLocker (govt-backed Aadhaar consent); removed false 'only verified users can contact owners' gate copy.
- Kept mobile-match/mismatch (ADR-009a) but softened 'verify and continue' -> 'earn your Verified badge'. Submit btn 'Verify & continue' -> 'Verify & earn badge'. Rewrote doc comment to badge-not-gate.
- ContactBox.jsx + ContactOwnerModal.jsx: pass context subtitle 'This owner accepts verified contacts only...' so the opt-in modal explains WHY it appeared.
- Mechanism unchanged (mock OTP stands in for DigiLocker consent) — deeper redirect mock deferred. Build: PASS.

## React badge-not-gate — Page 4: Profile badge + owner verified-only toggle (DONE)
- ProfileTab.jsx identity card: 'Identity verification' -> 'Verified badge'; gate copy ('Verify once to contact owners directly') -> optional DigiLocker badge/trust copy; button 'Verify now' -> 'Get verified'.
- Modal subtitle it passes reframed to opt-in DigiLocker badge; success toast 'Identity verified' -> 'Verified badge earned'.
- Added owner 'Accept verified contacts only' Switch (verifiedContactOnly pref) in the owner section; retitled 'Owner phone privacy' -> 'Owner contact preferences'. Kept 'Keep my number private'.
- Verified wiring: store.js re-exports getOwnerPrefs/setOwnerPrefs from contact.js -> same pnOwnerPrefs:<mobile> key ownerVerifiedOnly() reads (Page 2). Toggle now END-TO-END drives the verification_required contact case. Build: PASS.

## Page 5 — Society community actions (badge-not-gate) — DONE
- Store layer (society.js, societyMod.js): removed all 9 'kyc' blocks + isAadhaarVerified imports.
- useSocietyHub.js: renamed requireKyc -> requireSignedIn (login-only, no Aadhaar wall); updated all call sites; removed dead === 'kyc' conditions/branches; removed aadhaarOpen state + pendingAction ref, isAadhaarVerified import, unused useRef import, ctx exports. Kept resident/committee orbidden guards intact per user decision.
- SocietyModals.jsx: removed dead AadhaarVerifyModal import, props, render block.
- Updated stale "KYC-gated" comments (society.js, society/constants.js, tabs/CommunityTab.jsx) to "sign-in only".
- Build PASS. Grep confirms zero lingering 'kyc'/isAadhaarVerified/aadhaarOpen/pendingAction in society files.
- User decision: KYC gates removed; resident-only actions held as-is.
## Page 6 — Admin Settings flag (badge-not-gate) — DONE
- Renamed feature flag adhaarVerification -> kycBadgeEnabled to match OpenAPI AdminSettings schema (ADR-019).
- AppFlagsPanel.jsx: label "Aadhaar verification" -> "Verified badge (DigiLocker)"; desc reframed from "Require owner identity verification" -> "Offer the opt-in DigiLocker Verified badge — a trust signal, not a posting or contact gate".
- Renamed the key in settings.json and data/db.json defaults.
- Flag is display/config only (not consumed to gate any flow) — no logic change needed.
- Build PASS. Grep confirms only the 3 expected kycBadgeEnabled refs, zero adhaarVerification left.
## Page 7 — Admin Users (badge-not-gate vocabulary) — DONE
- Finding: AdminUsers.jsx had NO "Aadhaar verified" wording — the erified flag already renders as a generic Verified badge (BadgeCheck icon). Contract confirms User.verified = the opt-in Verified badge (L2, ADR-019). No dedup/unique columns present.
- Change = vocabulary alignment only, matching SoT term "Verified badge":
  - Row action tooltip/label: "Verify user"/"Remove verification" -> "Grant Verified badge"/"Remove Verified badge".
  - Single verify toast/note/audit: "User verified"/"Verification removed" -> "Verified badge granted"/"Verified badge removed".
  - Bulk: confirm label "Verify N user(s)?" -> "Grant Verified badge to N user(s)?"; toast/note/audit reworded; toolbar button "Verify all" -> "Grant badge".
  - CSV export "Verified" column left as-is (clear data column).
- No logic change (verified toggle unchanged). Build PASS.
## Page 8 — Consistency sweep (badge-not-gate) — DONE
Live gates removed:
- Flatmates supply gate (useFlatmateSupply.jsx): requireAadhaar -> requireSignedIn (L1 sign-in only, matches List Property). Removed isAadhaarVerified import, aadhaarGateOpen state, pendingSupplyAction ref, return exports; updated comments.
- Flatmates.jsx: removed dead <AadhaarVerifyModal> supply-gate block, destructured props (aadhaarGateOpen/pendingSupplyAction/setAadhaarGateOpen), and now-unused AadhaarVerifyModal import (fixed an accidental dup import).
Stale copy/comment:
- society.js header comment reworded from "Only Aadhaar-OTP KYC-verified users can add" -> "Any signed-in (L1) user can add".
Orphaned i18n removed (en/hi/mr):
- list-property.json: entire gate block (~30 keys, dead since Page 1).
- flatmates.json: identityVerified, aadhaarGateSubtitle, aadhaarGateNote (dead after supply de-gate). All 6 files re-validated as parseable JSON.
- Build PASS. Final grep: zero live gate logic (requireAadhaar/aadhaar_required/if(!isAadhaarVerified)) remains in app.

FLAGGED for founder decision (intentionally NOT changed):
- OpsReferrals.jsx: referral payout still requires aadhaarVerified + aadhaarUnique. KEPT — this is anti-fraud at a MONEY moment (L3-like), legitimate under the model, not a participation gate. Recommend keep.
- Marketing trust copy still says "Aadhaar-verified owners": home.json trustAadhaar ("100% Aadhaar-verified owners"), home.testimonials.aadhaarVerifiedOwners, homeData.js verifiedOwners stat, Testimonials.jsx line ~67, ActivityTicker.jsx. Under badge-not-gate not all owners are verified, so "100%" may be inaccurate — but this is founder marketing positioning, not a gate. Left for user to reword.
- Dashboard profileCompletion() still counts the Verified badge toward profile % — a nudge, not a gate. Left as-is.

## Migration status: all 8 pages COMPLETE (build PASS each).
Pending: (a) react-reviewer + security-reviewer on gate-bearing pages (1,2,3,5,8); (b) flow-doc re-sync (docs/flows/**) AFTER user signs off all pages.
## Add second "Get verified" entry point — DONE
- User request: only one "Get verified" existed (Profile & Settings). Add a more visible one.
- Chosen spot (user-approved): Dashboard Overview tab — dedicated opt-in "Get your Verified badge" trust card.
- OverviewPanel.jsx: added self-contained card just below Action Center. Shows only when !isAadhaarVerified(); "Optional" pill; DigiLocker trust/ranking copy; "Get verified" btn opens the shared AadhaarVerifyModal (which persists the badge). Auto-hides after earning; toast "Verified badge earned". data-testids: verify-badge-cta, verify-badge-btn.
- Non-blocking, badge-not-gate aligned. Build PASS. toast prop confirmed passed from Dashboard.jsx.
## Make "ID not verified" chip clickable — DONE
- ProfileTab.jsx: PendingChip now renders as a <button> when an onClick is passed (keeps <span> otherwise for backward compat). Hover/focus states + title "Get your Verified badge".
- Header chip "ID not verified" wired to open the existing AadhaarVerifyModal (setAadhaarOpen(true)) — same flow as the "Get verified" card below it. Verified users still see the static "ID verified" VerifiedChip.
- Build PASS.
## KYC rework — native DigiLocker consent flow (DONE)
Reworked the shared `AadhaarVerifyModal` from the mock "enter Aadhaar mobile + our OTP" flow to
the ratified **native DigiLocker** model (SoT `platform-architecture.md` §5.6; ADR-009a/019).
Because this modal is the single KYC surface, the change updates **all 5 entry points at once**
(ContactBox, ContactOwnerModal, ProfileTab, OverviewPanel, TenantProfile).
- Modal is now an explainer + consent screen: **Why** (trust, ranking, optional), **How it works**
  (redirect to DigiLocker -> enter Aadhaar+OTP *on DigiLocker* -> approve one-time consent), and a
  **Privacy** panel (we receive name/DOB/gender/address/photo + last-4 only; never the full Aadhaar
  or OTP; DPDP consent, withdraw anytime). Single **"Continue with DigiLocker"** CTA.
- Mock simulates the redirect->consent->success round-trip (production returns a DigiLocker consent
  URL + webhook). Records the badge via enriched `setAadhaarVerified` (source=digilocker,
  maskedAadhaar, mobileMatch soft signal).
- Dropped the on-page OTP/MobileField/mismatch UI and the stale `note` prop (removed the OTP-worded
  `misc.tpKycModalNote` usage from TenantProfile; backward-compatible record keeps aadhaarMobile/at).
- `cd frontend; npm run build` -> PASS (13.72s). Files: components/auth/AadhaarVerifyModal.jsx
  (rewrite), lib/store/listings.js (setAadhaarVerified enrich), pages/consumer/TenantProfile.jsx.
## KYC growth levers — Phase 1 (React only) — DONE 2026-07-27
Badge-not-gate (ADR-019). All 5 verify entry points share ONE AadhaarVerifyModal; wiring the
growth mechanism into its success handler covers everything. Build green after each step.

- [x] kyc-mech: applyVerifiedBadgeToListings(mobile) in mockApi/properties.js — flips ownerVerified
      on all owner listings (+250 rank) + FIRST-time free 7-day Featured (featuredUntil, featuredReason
      ='first-verify', +1000 rank). isFeaturedActive() shared in lib/featured.js; ranking pipeline
      (listingsResultsPipeline.js) + featuredProperties() switched to isFeaturedActive so the free
      perk expires honestly while paid/owner-set featuring stays.
- [x] kyc-modal: AadhaarVerifyModal accepts source + subtitle props; fires trackKyc funnel events
      (badge_cta_impression/click, digilocker_start/success/fail, badge_earned); calls
      applyVerifiedBadgeToListings(signedMobile) on success; passes perk to onVerified.
- [x] kyc-c1: PostSuccessVerifyNudge wired into ListProperty.jsx success card (new, unverified posts
      only) — i18n via listProperty.verifyNudge.* (en/hi/mr, 6 keys each).
- [x] kyc-a1: VerifyListingsBanner (panel-level, dismissible) in MyListingsPanel — shown only when
      owner has >=1 property and is unverified. One badge lifts ALL listings. source='my_listings'.
- [x] kyc-d1: "Featured · free Nd left" chip in ListingCard when featuredReason==='first-verify' &&
      isFeaturedActive(l). Paid featured path untouched.
- [x] kyc-i18n: C1 keys present + parity across en/hi/mr. A1/D1 live in the English-only dashboard
      area (matches surrounding ListingCard/MyListingsPanel house style) — no i18n gap introduced.

Guardrails verified: nothing gates browse/post/contact; C1 fires only AFTER listing goes live;
A1 dismissible; D1 is a reward. No nudge precedes a value moment.
Data plumbing: perk writes to mock DB -> loadMyListings reads mock DB -> cards reflect badge + chip.

PENDING (deferred, not blocking): react-reviewer + security-reviewer pass on the KYC-touched files;
Playwright coverage for the new nudges/chip. Flow-diagram/doc updates intentionally SKIPPED per user
(will update manually).
## KYC growth levers — review + i18n hardening (2026-07-27)
- [x] react-reviewer + security-reviewer run on KYC/badge-not-gate + growth-lever React changes. Verdict: both APPROVE. 0 Critical, 0 High blocking the mock phase.
- [x] i18n: new erify namespace (en/hi/mr erify.json); localized AadhaarVerifyModal (WHY/HOW/PRIVACY via <Trans>), VerifyListingsBanner (C2 plural headline), OverviewPanel badge card, EnquiriesPanel "Serious Buyer" x2, ContactOwnerModal buyer nudge, all AadhaarVerifyModal caller subtitles + "badge earned" toasts.
- [x] security M-1: kycTrack.js now strips PII-looking keys (mobile/phone/aadhaar/otp/name/email/token/address/dob) from extra before console/localStorage.
- [x] Build green (exit 0); en/hi/mr verify.json validated.

### Deferred — enforce server-side when backend lands (tracked, acceptable for localStorage-mock phase)
- [ ] SEC H-1: pplyVerifiedBadgeToListings sets ownerVerified client-side (forgeable). Backend must own verified state; only a DigiLocker webhook may set erified=true; frontend reads only.
- [ ] SEC H-2: replace isSeriousBuyer(mobile) with backend enquirer.verified flag; stop deriving trust from phone numbers; update call sites in EnquiriesPanel.
- [ ] SEC M-2: backend erifiedStats should COUNT(DISTINCT owner_id), not mobile numbers.
- [ ] i18n (pre-existing, out of KYC scope): ProfileTab identity chips ("Mobile verified" / "ID verified" / "ID not verified" + PendingChip title tooltip) are still hardcoded — localize in a dedicated ProfileTab i18n pass.
- [ ] Verification: no Playwright coverage yet for the verify funnel (modal → DigiLocker mock → badge earned → listings update). Add e2e spec.
## e2e — KYC badge-not-gate migration + mojibake fix (2026-07-28)
- [x] Rewrote 4 obsolete gate specs -> badge-not-gate: list-property-no-gate, contact-badge-not-gate, flatmates-no-gate, flatmates-seeker-verify.
- [x] Fixed 3 society specs (community, community-v2, location) from 'kyc' block to L1-allow.
- [x] New kyc-growth-levers.spec.js (dashboard DigiLocker verify funnel). COVERAGE.md updated.
- [x] tenant-profile.spec.js:48 rewritten OTP -> DigiLocker badge earn. 6/6 pass.
- [x] map-panel-contact.spec.js test2 rewritten to badge-not-gate (owner has no verifiedContactOnly). Both tests pass.
- [x] Root-caused map/price failures: mojibake rupee (U+00E2 U+201A U+00B9) instead of the real sign in 7 specs (22 occurrences). App/map are correct. Repaired all; re-run 35/35 green, KYC set 44/44 green.
- [x] PRE-EXISTING, NON-KYC: qa-location-search (x13) + admin-* (x9) timeouts. **CLASSIFIED: FIXED** — root-caused and repaired in the "e2e full-suite green" session below (see items under it); this entry was stale bookkeeping. Re-verified twice: `npx playwright test tests/admin- tests/qa-location-search --project=chromium` -> 290 passed, 0 failed, 0 flaky (no retries consumed).
- [ ] Cosmetic: residual mojibake (em-dash/ellipsis/apostrophe) remains only in comments + test titles of those 7 specs (no assertion impact); left as-is per tight scope.
## e2e full-suite green + flows re-sync (session cont.)
- [x] Whole chromium e2e suite triaged (was 41 fail). Fixed the "pre-existing non-KYC" cluster after all:
  - qa-location-search (x15): shownCount() grabbed hidden mobile dup of countLine -> scope to `main p:visible`.
  - admin-consolidation/post-on-behalf (dual-render strict-mode) -> scope to `getByRole('table')`.
  - admin-users: bulk button renamed "Verify all" -> "Grant badge" (KYC migration) -> updated 3 regexes.
  - admin-reports "table shows report data": rows.count() is a NON-retrying snapshot taken before async listReports() populated -> wait for first row, then count.
  - admin-duplicates + property-dup-modal: addInitScript wrote a PARTIAL puneNestDB_v5 (only listings) before boot -> app boots on a 1-of-25-collections DB -> white-screen crash -> selector timeouts. Fixed by seeding the listing AFTER boot (merge into the full default DB), keeping only non-DB keys in addInitScript.
  - Cookie-consent banner (fixed bottom-0 z-[1400]) intercepts bottom-of-page clicks + hides the Nestor FAB (max-sm:hidden) on mobile when consent unset -> seed pn_cookie_consent_v1 (established pattern) in auth-flow, flatmate-e2e, flatmates-interactions, assistant, photo-requests, property-dup-modal.
  - Dashboard sub-tabs migrated button -> role="tab" -> photo-requests + scheduled-visits use getByRole('tab').
  - feature-flags Map view + view-documents filenames: dual-render -> [title=...]:visible / .first().
  - search-property-types: test.slow() (6 sequential search flows starved under max parallel load).
- [x] Final: full chromium suite 911 passed; residual hard-fails are stochastic parallel-load browser crashes that each PASS in isolation (not app/test bugs). Verified no frontend/src edits (e2e-only).
- [x] PHASE 2 - Re-synced docs/flows/** (14 files) to ADR-019 badge-not-gate FROM current source. Core rewrite: contact-gate-leads.md (contact = L1 + owner-approval + masked number; opt-in DigiLocker badge; verification_required only when owner sets verifiedContactOnly). Kept legit gates: L3 deal-KYC (rent-agreement), referral reward uniqueness, society resident-of-unit verification. Residual grep = intentional negations only.
- [ ] FYI (source, out of docs scope): frontend/src/pages/consumer/list-property/submit.js ~L366 has a stale comment "Identity is guaranteed by the Aadhaar gate" - real floor is L1 sign-in. Flag for future source cleanup.


## 3-way sync: platform-architecture.md (SOT) -> OpenAPI -> React (DONE)
Precedence SOT > Swagger > React. Full cross-domain enum/shape audit; drift report + per-decision approval.

### OpenAPI (punenest-api.yaml) - DONE, YAML validated
- [x] PropertyStatus -> [pending, approved, rejected, flagged, archived]
- [x] Team enum + `loans`
- [x] ContactRequest.status granted->approved; ContactStatus reshaped to badge (dropped remainingUnlocks/unlocked, added status enum)
- [x] FinalizationRequest.status proposed->pending
- [x] Offer.status rejected->declined; OfferResponse.action reject->decline
- [x] Deal rename: intent Deal->DealIntent; aggregate Deal2->Deal with status [active,reserved,closed]
- [x] Enquiry marked deprecated
- [x] Visit.status canonical -> [scheduled, confirmed, completed, cancelled, no-show]

### React (frontend/src) - DONE for decided items
- [x] deals.js pendingOfferCount + buyer_counter -> countered (+ from)
- [x] DealPanel.jsx disambiguate countered by o.from (You/Buyer countered)
- [x] visits.js requested->scheduled (5x); ReviewsSection.jsx scheduled check
- [x] A7/A8 ops/ticket vocab: DOCUMENTED mapping only (mock-only, never hits wire)

### Docs - DONE
- [x] service-queues.md five->six teams (+loans)
- [x] data-model.md Deal2->Deal/DealIntent; added "Status vocabulary - UI<->wire mapping" section

### Verification
- [x] OpenAPI parses (yaml.safe_load OK); orphan scan clean
- [x] eslint changed files: 0 errors (pre-existing warnings only)
- [x] e2e deals-offers.spec.js + scheduled-visits.spec.js: 15 passed
- [x] e2e contact/tickets/admin-properties regression: passed
- [ ] PRE-EXISTING FAILURE (NOT caused by this task): e2e services-loans-team.spec.js
      fails at line 33 filling input[type="tel"] on /home-loans (form UI/harness issue).
      Not in my change set; the loans-team routing my A9 change touched is never reached.
      Flagged to user; needs separate investigation.


## Vertical slice 1 - auth + users (DONE)

First real business slice: wires the cross-cutting foundation into working endpoints. Contract-faithful
(byte-compatible with the React mock so a future VITE_API_MODE=mock->http flip changes no components).

- [x] Endpoints: POST /auth/login (dual-mode OTP), /auth/staff-login (BCrypt), /auth/refresh
      (rotate+reuse-detect), /auth/logout (204, revoke refresh family); GET/PATCH /auth/me (owner-scoped).
- [x] DTO records (LoginRequest/StaffLoginRequest/RefreshRequest/AuthResponse/UserResponse/UserUpdate),
      OtpService, AuthService, AuthController, UserService, MeController - full Javadoc-the-why.
- [x] Spec reconciliations R1-R6 resolved; R1 = added optional `otpSent` to AuthResponse + dual-mode
      /auth/login description (only spec touch; flagged as SSOT fix).
- [x] docs/system/api-standards.md authored (the enforceable API + Javadoc standard; this slice is its
      reference implementation).
- [x] Tests: AuthEndpointsTest (13) + MeEndpointsTest (4); full suite 38 green under ddl-auto=validate
      against the live Flyway'd Postgres (boot = schema-validation proof).
- [x] Reviews: java-reviewer + security-reviewer run. Triaged with ponytail/PM discipline; applied the
      genuinely-in-scope fixes, deferred over-engineering (documented below).

### Review fixes applied
- [x] OTP brute-force cap made durable in prod: verifyLoginCode + login now use
      `@Transactional(noRollbackFor=...)` so a failed-attempt counter isn't rolled back with the 401
      (was silently unbounded in prod; masked by shared-tx tests).
- [x] First-sign-in insert race guarded: findOrProvision catches UNIQUE(mobile) violation and adopts
      the winner's row instead of surfacing a 500.
- [x] Constant-time OTP hash compare (Tokens.hashesEqual via MessageDigest.isEqual).
- [x] UserUpdate size caps (name<=100, email<=254, avatar<=2048) to bound the untyped text columns.

### Deferred (documented, out of this slice's scope)
- [ ] IP/mobile rate-limiting on /auth/** (cross-cutting; OTP per-code cap is the current floor).
- [ ] Staff-login timing-equalization (dummy BCrypt) - low-risk internal surface; revisit if staff
      enumeration becomes a concern.
- [ ] Public/masked user projection - belongs to the contact-gate slice, not auth+users.

### pom.xml
- [x] Restored deps the manual sync had dropped (data-jpa, security, postgresql, flyway-core,
      flyway-database-postgresql, JJWT 0.12.6 trio) and set java.version=25. User to manually sync.


## Package structure � bounded-context layout + safe alignment (DONE)

Decision task: fix the definitive package layout for the modular monolith so future slices drop in
with zero cross-feature coupling and later service extraction is mechanical. Doc = SSOT for *where
code lives*: `docs/system/package-structure.md`.

### Decision
- [x] Adopt package-by-bounded-context with flat feature/aggregate sub-packages
      (`com.punenest.api.<context>[.<aggregate>]`); shared kernel stays top-level
      (`common.*`, `security.*`, `provider.*`). No layer packages.
- [x] Dependency rule: features may import the shared kernel, never each other; kernel never imports a
      feature. Enforcement = convention + review now; ArchUnit tripwire specified but DEFERRED to the
      2nd context (reject Spring Modulith/JPMS as too heavy per ponytail).
- [x] Documented honestly that schema-per-context is LOGICAL only (all 62 tables in `public`;
      contexts = Flyway file groups V2..V8). Physical CREATE SCHEMA deferred to extraction time.

### Moves applied now (cheapest while identity is the only shipped slice)
- [x] Nested identity: `auth -> identity.auth`, `user -> identity.user`,
      `IdentityVerification -> identity.verification` (package lines + imports + test dirs).
- [x] Consolidated `config -> common.config` (OpenApiDocsConfig beside CorsConfig).
- [x] Kept `security`, `provider`, `common.*` shared. Package moves only: no URL/contract/JSON/DB change.

### Deliverables
- [x] `docs/system/package-structure.md` � layout tree, dependency rule, 11 context->package->Flyway
      group->roadmap-phase table, naming conventions, enforcement decision, rationale table.
- [x] `api-standards.md` �7 updated to point at the new doc + bounded-context convention.
- [x] `mvn clean verify` green (41 tests), app boots under `ddl-auto=validate`.

### Concurrency hardening (from the mandated review pass during this task)
- [x] Refresh-token rotation: `@Lock(PESSIMISTIC_WRITE)` on `findByTokenHash` � closes a
      concurrent-double-submit replay window (both reads saw revoked=false under READ COMMITTED).
      security-reviewer HIGH; fixed + verified.
- [x] OTP verify: same `@Lock(PESSIMISTIC_WRITE)` on the active-code finder � serializes concurrent
      verifies so the attempt cap can't be raced past (companion to Fix C's cross-tx durability).
      java-reviewer MEDIUM; fixed + verified. 3 new tests added (Tokens.hashesEqual, race-adopt,
      OTP durability across transactions).

### Deferred review findings (documented, out of scope / acceptable per ponytail)
- [ ] Refresh `findByUserId` in logout is unbounded � self-limiting in practice; add expiry-pruning job later.
- [ ] role/status are String mirroring the DB CHECK constraint � acceptable; enums deferred.
- [ ] provisionBuyer mobile-format guard � already validated upstream by LoginRequest; must stay
      public for the REQUIRES_NEW cross-bean proxy.


---

# Vertical slice 2 � Properties + Search (catalogue) � PLAN

**Goal:** Ship the property catalogue slice (public read-heavy + owner-write) under
`com.punenest.api.catalog.{property,listing}`, reusing the foundation, byte-compatible with the
OpenAPI contract (SSOT) so a later `mock->http` flip changes zero UI components. Package sits under a
`catalog` bounded context, mirroring `identity.auth`/`identity.user` (per package-structure.md).

## Endpoints (exact, from OpenAPI)
- [x] `GET /properties` (searchProperties, PUBLIC) -> PageEnvelope<PropertySummary>. Facets:
      deal,type,locality,bhk,minPrice,maxPrice,furnishing,q,status + page/size/sort. **Public floor:
      always archived=false AND status=approved** (status param cannot widen).
- [x] `GET /properties/featured` (featuredProperties, PUBLIC) -> [PropertySummary]; featured=true first,
      then recent live; capped (no limit param in contract).
- [x] `GET /properties/{id}` (getProperty, PUBLIC) -> Property; owner.mobile masked; 404 if missing/not public.
- [x] `GET /me/listings` (myListings, AUTH) -> PageEnvelope<Property>; owner-scoped; all statuses incl archived.
- [x] `POST /me/listings` (createListing, AUTH) -> **201** Property; status=pending; owner=caller.
- [x] `GET /me/listings/{id}` (getMyListing, AUTH) -> Property; 404 if not owned.
- [x] `PATCH /me/listings/{id}` (updateListing, AUTH) -> Property; foundation-field change reverts status=pending.
- [x] `PATCH /properties/{id}/archive` (archiveProperty) + `/restore` (restoreProperty) � soft-delete/
      restore; **restore => status=pending**; owner-or-staff/admin else 404 (spec declares only 200/404).

Out of scope (defer + flag): localities, societies, reels, status-moderation, toggle-featured, flag, adminPipeline.

## RESULTS � slice 2 SHIPPED (test-green)

- [x] Code under `com.punenest.api.catalog.{property,listing}`: `Property` entity (JSONB
      amenities/images via `@JdbcTypeCode(SqlTypes.JSON)`, `@ManyToOne(LAZY)` owner), `PropertyRepository`
      (+`JpaSpecificationExecutor`, `@EntityGraph("owner")` on detail/owner finders), `PropertySpecs`
      (public floor), `PropertySort` (whitelist), 5 DTO records (+`from`/`maskMobile`), `PropertyService`
      /`ListingService`, `PropertyController` + `MeListingsController`; SecurityConfig public GET matchers.
- [x] Boots under `ddl-auto=validate` on the live Flyway'd Postgres (JSONB mapping + `Pageable`
      resolver validated at runtime); **`mvn clean test` = BUILD SUCCESS, 59 tests, 0 failures**
      (41 prior + 18 new catalog incl. the null-unset PATCH-semantics guard).
- [x] Invariants enforced server-side & tested: create=>pending+server-owner; foundation-edit=>pending
      (non-foundation unchanged; null=leave-unchanged); restore=>pending; public floor approved+non-archived
      (status param can't widen); `/me/**` owner-scoped at the query level (no cross-owner leak, 404 not 403);
      soft-delete only; owner mobile masked `98XXXXX210`; money=Long INR.
- [x] Reviews: **java-reviewer APPROVE**, **code-reviewer** (all 9 invariants verified), **security-reviewer
      EXCELLENT / 0 findings**. Triage (ponytail/PM): applied the 1 high-value in-scope item (null-unset
      PATCH test). Skipped hypothetical/doc-only notes � `/properties/*` matcher confirmed correct by
      security-reviewer (only opens GET; two-segment archive/restore stay authenticated); client `status`
      can't widen the approved floor (harmless empty-set); `@EntityGraph` on `findByOwner_Id` KEPT (myListings
      maps full Property incl. owner summary � dropping it re-introduces N+1).

### Reconciliation decisions (confirmed as implemented)
(a) slug-or-id: parse UUID->by id, else by slug (contract param = "slug or id"). (b) mock storage field
names are pre-wire; backend emits OpenAPI shape; http provider bridges later. (c) sort: backend takes
standard `?sort=field,dir` (whitelist createdAt/price/area/bhk); mock tokens mapped by provider.
(d) `locality` filter = `locality_slug` (slug), response `locality`=display; `type`->property_type
case-insensitive; `q`->lower(title|locality) LIKE. (e) money=Long. (f) mask server-side in PropertyResponse.
(g) create defaults: pending, owner=caller, posted_by_type=owner, price_unit derived from deal. (h)
`/me/listings`=authenticated (any role). (i) archive via `archived` triplet; restore=>archived=false + pending.
(j) public search forces approved+non-archived; status param can't widen.

### Build lesson (this session)
- [x] Incremental `mvn test` in this env intermittently bakes ECJ error-recovery stubs
      ("java.lang.Object cannot be resolved / indirectly referenced from required .class files",
      "X cannot be converted to X") into `target/classes` => a green run can flip to all-errors after a
      one-line edit. **Fix = always `mvn clean test`** (full online rebuild); never rely on incremental for
      a verifying run. Recorded in `tasks/lessons.md`.

## Reconciliation log (spec = SSOT; UI must not break)
- [ ] **(a) {id} vs slug** � `PropertyId` param is documented *"Property slug or id"* (example is a slug).
      Policy: if the path value parses as a UUID -> lookup by `id`; else -> lookup by `slug`. Supports both;
      contract-blessed. Same policy for `/me/listings/{id}` then owner-scope.
- [ ] **(b) mock field drift** � mock `db.listings` internal shape (`type`/`bhkNum`/`ownerMobile`/`gallery`/
      `localitySlug`) is the *mock storage* shape, NOT the wire contract. Backend emits the OpenAPI shape
      (`propertyType`/`bhk`/`owner.mobile`/`images`/`locality`). The `http` provider (later slice) bridges
      storage<->wire; backend stays contract-faithful. Parity test asserts backend JSON == OpenAPI schema.
- [ ] **(c) sort tokens** � backend accepts standard `?sort=field,dir` (Spring). Whitelist sortable
      fields: createdAt, price, area (+ bhk). Default `createdAt,desc`. Mock tokens
      (`newest/price-asc/price-desc/area-desc`) are mapped by the http provider, not the backend.
- [ ] **(d) filter semantics** � `locality` filter matches `locality_slug` (slug), response `locality`
      is display; `type`->property_type (case-insensitive); `q`->lower(title|locality) LIKE; bhk/price
      numeric coercion. Mock "dormant" hiding is a freshness concept with NO column in V3 -> **deferred**
      (approved-only is the contract floor).
- [ ] **(e) money = integer INR** � price/deposit/maintenance = `bigint` -> `Long` (Money int64).
- [ ] **(f) owner mask** � server-side in `Property.from(...)`: `98XXXXX210` = first2 + "XXXXX" + last3.
- [ ] **(g) create-time server defaults** � ListingCreate omits priceUnit/postedByType/status/slug/
      locality_slug. Derive: `price_unit` = rent?per-month:total; `posted_by_type`='owner';
      `status`='pending'; `area_unit` default sqft; `slug`=null (lookup falls back to id); `locality_slug`
      =null (FK forbids arbitrary slugs; locality mgmt out of scope). Documented + deferred.
- [ ] **(h) roles** � no `x-roles` in spec; `/me/listings` = authenticated (any role), NOT hasRole(OWNER)
      (mock lets any signed-in user post -> becomes owner). Owner-scope by `@CurrentUser`. Do not mutate
      user role/listingsCount here (identity concern; deferred).
- [ ] **(i) archive vs status='archived'** � canonical soft-delete is the `archived` boolean triplet;
      the `status` enum's 'archived' value is left unused. archive => archived=true (+reason), status kept;
      restore => archived=false AND status=pending.
- [ ] **(j) public status param** � GET /properties is public; status param cannot expose non-approved.
      Forced `status=approved AND archived=false`; hits partial `idx_properties_search`.

## Build tasks (dependency-ordered)
- [ ] **prop-entity** � `Property extends SoftDeleteEntity` @Table(properties); map summary+detail+invariant
      columns only (validate ignores unmapped). `@ManyToOne(LAZY) @JoinColumn(owner_id) User owner`.
      amenities/images = `List<String>` `@JdbcTypeCode(SqlTypes.JSON)`. numeric->BigDecimal, bigint->Long,
      double precision->Double. Foundation-field setters + `revertToPending()` helper. **AC:** boots under
      ddl-auto=validate (schema test).
- [ ] **prop-repo** � `PropertyRepository extends JpaRepository, JpaSpecificationExecutor`;
      `findBySlug`, owner finders (`findByIdAndOwnerId`, `findByOwnerId(Pageable)` with owner @EntityGraph);
      `PropertySpecs` static Specification builders per facet (index-aware). **AC:** search expressible
      against idx_properties_search; owner reads against idx_properties_owner; N+1-safe.
- [ ] **prop-dtos** � records `PropertySummary`,`Property`(+nested Owner),`ListingCreate`(Bean-Validation:
      @NotBlank title/propertyType/locality/city, @NotNull deal/price, @Positive price),`ListingUpdate`
      (all optional). `from(entity)` mappers; `@JsonInclude(NON_NULL)`; owner-mask in Property.from.
- [ ] **prop-service** � `PropertyService`: `search(filters,Pageable)` (forced approved+non-archived),
      `featured()`, `getPublic(idOrSlug)` (slug-or-id, must be approved+non-archived else 404).
- [ ] **prop-listing-service** � `ListingService`: `myListings(userId,Pageable)`, `create(userId,ListingCreate)`
      (pending+owner+derived defaults), `getMine(userId,idOrSlug)`, `update(userId,idOrSlug,ListingUpdate)`
      (foundation-diff => pending), `archive/restore(principal,idOrSlug,reason)` (owner-or-staff/admin, 404 hide).
- [ ] **prop-controllers** � `PropertyController` (`/properties`, public) + `MeListingsController`
      (`/me/listings`, @CurrentUser). Thin; map at edge. archive/restore live on PropertyController path.
- [ ] **prop-security** � SecurityConfig: `GET /properties`, `/properties/featured`, `/properties/*` permitAll.
- [ ] **prop-tests** � @SpringBootTest+MockMvc, self-inserted fixtures (2 owners, approved/pending/archived):
      search facet/sort/page + approved-only visibility; getProperty masked-owner + 404; myListings
      owner-scope (no cross-owner leak); createListing 201+pending+server-owner; updateListing foundation
      (price/bhk/type/locality/deal) => pending vs non-foundation => unchanged; archive hides from public;
      restore => pending; validation 422; mock/contract parity assertion.
- [ ] **prop-verify** � `cd backend; $env:JAVA_HOME=Zulu-25; mvn verify` green (existing + new), boots validate.
- [ ] **prop-review** � java-reviewer -> code-reviewer -> security-reviewer (owner-scope / cross-owner leak /
      masked contact); triage with ponytail/PM; apply in-scope.

## Acceptance (definition of done)
Working, test-backed 8 endpoints reusing the foundation; contract- and mock-shape-faithful; invariants
enforced server-side (create-pending, foundation-edit-reverts, restore-pending, approved-only-public,
owner-scoped, soft-delete-only); exemplary Javadoc; boots clean on fresh Postgres, zero paid keys; every
reconciliation (a-j) recorded.

---

# Slice 3 - Contacts + Contact Gate + Aadhaar (DigiLocker) Badge

Reference implementation of the badge-not-gate model (ADR-019). Must exemplify the REVISED
`docs/system/api-standards.md`: route constants (2.1), ErrorCodes (4), feature-owned vocabulary
constants (7.1), MapStruct with hand-written trust carve-outs (8.1), Javadoc (10), test bar (11).

## Reconciliation log (decided BEFORE coding)

- (a) **Keying.** Mock keys a request by `ownerMobile + propId` and carries a `buyerMobile`. The
  contract keys by `propertyId` + the server-derived `requester_id`, and derives `owner_id` from
  `properties.owner_id`. **Policy:** the client never sends any mobile or owner id; the server
  resolves `property -> owner`. A future `http` provider bridges by dropping `ownerMobile`
  entirely (it already has the property in hand on every call site). No contract change needed.
- (b) **Status vocab.** 1:1 with the mock: `owner | approved | pending | declined | none`.
  `pending|approved|declined` are persisted (V4 CHECK); `owner` and `none` are **computed
  server-side** and never stored. Registered per 7.1 in `leads.contact.ContactStatuses`
  (gate vocab) and `ContactRequestStatuses` (persisted vocab).
- (c) **`verifiedContactOnly` / `verificationRequired`.** `verifiedContactOnly` =
  `users.verified_contact_only` of the **listing owner**. `verificationRequired` =
  `verifiedContactOnly && !callerHasBadge`. Caller badge is read **live** from
  `users.aadhaar_verified` (not from the JWT claim) so a user who verifies mid-session is not
  wrongly blocked by a stale token.
- (d) **Owner `hideNumber` pref** (mask even after approval). **No backing column exists** in V2
  `users`. Declared **out of scope**; would live as `users.hide_number boolean not null default
  false` and enter the reveal predicate as
  `revealed = owner || (approved && !owner.hideNumber)`. Recorded, not implemented.
- (e) **`pendingContactCount`.** No contract endpoint. **Decision: client-derived** from
  `GET /me/contact-requests` (already returns the full array, and the owner inbox is small).
  No spec addition; revisit only if the array grows past a page.
- (f) **Mask format.** Mock `maskPhone` renders `+91 98..._ ..10`; the trust doc and the shipped
  slice-2 server mask are `98XXXXX210`. **Decision: the server mask stays `98XXXXX210`** (already
  in the spec examples, already shipped, already asserted by 2 slice-2 tests). The mock's prettier
  form is **client-side presentation**, not wire format, and `maskPhone` is applied by the UI on
  whatever string it receives. No spec change required.
- (g) **`ContactRequest.requester` (`Party`) and the conditional `contact`.** `requester` always
  carries `{name, mobile: MASKED, role: "buyer"}` - the owner sees who asked but not their raw
  number until they approve. `contact` is **null** unless `status == approved`, in which case it
  carries `{name, mobile: RAW}` of the **requester** (the payoff: approving reveals both ways).
- (h) **Contract-vs-flow-doc drift.** `docs/flows/consumer/contact-gate-leads.md` shows
  `POST /contacts/request { ownerMobile, propertyId }`. The OpenAPI schema
  `ContactRequestCreate` is `{ propertyId, message? }`. **Contract wins**; `ownerMobile` is a mock
  artifact. Flagged, no code change.
- (i) **409 `aadhaar_already_registered` timing.** The dedup key (`identity_hash`) only exists
  **after** DigiLocker returns, i.e. at webhook time - `submitAadhaar` cannot know it. **Decision:**
  the webhook enforces one-Aadhaar-one-account (collision => `status=failed`, `badge=false`,
  masked last-4 stored as the collision marker); a subsequent `submitAadhaar` returns
  **409 `aadhaar_already_registered`** when the caller's row is `failed` **with** a
  `masked_aadhaar` (= a result came back and was rejected for dedup). A `failed` row **without**
  `masked_aadhaar` is an abandoned/failed consent and is retryable (202). Zero schema change,
  contract-faithful, testable.
- (j) **`package-structure.md` 4 vs `api-standards.md` 8.1.** package-structure says "inline
  `from(...)` on the response record (no separate mapper class)". That row is **superseded** by
  api-standards 8.1 (MapStruct), the newer doc, already applied in slice 2. Flagged for a doc fix;
  this slice follows 8.1.

## Cross-context dependency decision (catalog <-> leads)

`package-structure.md` 5: a feature context may not import another feature context; cross-context
needs go through **ports/ids**, not direct calls.

- **catalog -> leads (the reveal): PORT.** `common.trust.ContactGate` + `common.trust.ContactVisibility`
  are declared in the **shared kernel** (which imports nothing from a feature) and **implemented by
  `leads.contact.ContactGateService`**. `catalog` depends only on the interface. This is a strict
  Dependency-Inversion seam and is **required** here because the consumer is the security-critical
  masking path - it must not become a feature->feature import.
- **leads -> catalog / identity (its own reads): DOCUMENTED EXCEPTION.** `leads.contact` reads
  `catalog.property.PropertyRepository` and `identity.user.UserRepository` directly. Justification:
  `leads` is inherently a *join* context (it relates a property to a user); inverting those two
  reads would cost three more interfaces + impls for zero behaviour change today (ponytail), and
  there is an existing reviewed precedent (`security.JwtService` reads `identity.user.User`).
  Recorded here and flagged for the deferred ArchUnit boundary rule; the ports get written at
  extraction time, not before.
- **ArchUnit boundary test:** still deferred (ponytail/PM triage) - it would need the two
  exceptions encoded as allowlist entries before it has ever caught a bug. Noted, not built.

## Plan (dependency-ordered)

### Foundation additions (shared)
- [x] **ct-errorcodes** - add `VERIFICATION_REQUIRED = "verification_required"` and
      `AADHAAR_ALREADY_REGISTERED = "aadhaar_already_registered"` to `common.error.ErrorCodes`,
      plus typed `VerificationRequiredException` (403) and `AadhaarAlreadyRegisteredException` (409)
      next to the existing hierarchy (both existing `ForbiddenException`/`ConflictException` hardcode
      their codes, so a subclass is the only way to carry a distinct code).
      *Accept:* no inline literal anywhere; both traceable to the spec.
- [x] **ct-routes** - add `Routes.Contacts{STATUS,REQUEST}`, `Routes.MeContactRequests{BASE,BY_ID}`,
      `Routes.Verification.AADHAAR`, `Routes.Webhooks.CASHFREE_DIGILOCKER` as absolute paths.
      *Accept:* controllers + SecurityConfig bind the same constants; no class-level `@RequestMapping`.
- [x] **ct-security** - `SecurityConfig`: `POST Routes.Webhooks.CASHFREE_DIGILOCKER` -> `permitAll`
      (contract `security: []`); everything else stays default-authenticated.
      *Accept:* webhook reachable unauthenticated; `/contacts/**`, `/me/**` still 401 anonymous.
- [x] **ct-gate-port** - `common.trust.ContactVisibility` (MASKED|REVEALED) + `common.trust.ContactGate`
      (`visibilityFor(UUID viewerId /*nullable*/, UUID propertyId, UUID ownerId)`).
      *Accept:* shared kernel imports no feature package.

### Vocabulary constants (7.1, feature-owned, constants not enums)
- [x] **ct-vocab** - `leads.contact.ContactStatuses` (`OWNER|APPROVED|PENDING|DECLINED|NONE`),
      `leads.contact.ContactRequestStatuses` (persisted `PENDING|APPROVED|DECLINED` + `PATTERN` for
      `StatusUpdate` validation, composed from the constants, and `isTerminal`/`canTransitionTo`),
      `identity.verification.VerificationStatuses` (`NONE|PENDING|VERIFIED|FAILED`),
      `identity.verification.VerificationSources` (`DIGILOCKER`),
      `identity.verification.WebhookStatuses` (`SUCCESS|FAILED`).
      *Accept:* every value traced to a spec enum; no Java `enum`; regexes composed from constants.

### leads.contact (entity -> repo -> DTO -> mapper -> service -> controllers)
- [x] **ct-entity** - `ContactRequest` extends `AuditedEntity` (V4 has **no** soft-delete triplet):
      `propertyId`, `requesterId`, `status`, `message`. Table `contact_requests`.
      *Accept:* boots under `ddl-auto=validate`.
- [x] **ct-repo** - `ContactRequestRepository`: `findByPropertyIdAndRequesterId` (idempotency +
      status), `findByPropertyIdIn` (owner inbox, index-backed on `idx_contact_requests_property`),
      `existsByPropertyIdAndRequesterIdAndStatus` (the reveal predicate).
      *Accept:* every query hits `idx_contact_requests_property` or `_requester`; N+1-safe.
- [x] **ct-dto** - records `ContactStatusResponse {status, verifiedContactOnly, verificationRequired}`,
      `ContactRequestCreate {propertyId, message?}` (`@NotBlank propertyId`),
      `ContactRequestResponse {id, propertyId, requester(Party), status, contact(Contact|null), createdAt}`,
      `StatusUpdate {status, note?}`. *Accept:* byte-identical to the OpenAPI schemas.
- [x] **ct-mapper** - `ContactMapper` (`@Mapper(componentModel="spring")`) with the `default String
      map(UUID)` convention. **Trust carve-out:** `toRequesterParty` (always masked) and
      `toContact` (raw, only when approved) are hand-written `default`s; `maskMobile` is `private`
      so MapStruct cannot auto-apply it as a `String->String` converter.
      *Accept:* no generated code touches a mobile.
- [x] **ct-service** - `ContactService`:
      `status(viewer, propertyId)`, `request(viewer, body)`, `myRequests(owner)`, `respond(owner, reqId, body)`.
      Invariants: self-listing => `owner` (no row); duplicate => existing status (no 2nd row);
      403 `verification_required` **only** when owner `verified_contact_only` && caller lacks badge;
      `myRequests`/`respond` strictly owner-scoped (404 on a foreign req); transitions only
      `pending -> approved|declined`.
- [x] **ct-gate-impl** - `ContactGateService implements ContactGate` - REVEALED iff viewer == owner
      or an `approved` row exists for (viewer, property); MASKED otherwise (incl. anonymous).
- [x] **ct-controllers** - `ContactController` (`GET /contacts/status`, `POST /contacts/request`),
      `MeContactRequestsController` (`GET /me/contact-requests`, `PATCH /me/contact-requests/{reqId}`).
      Method-level mappings bound to `Routes`; no role `@PreAuthorize` (spec carries no `x-roles`;
      auth + owner-scoping is the correct gate, same reasoning as `MeListingsController`).

### identity.verification (badge)
- [x] **ct-ver-dto** - `AadhaarVerificationResponse {badge, status, source, maskedAadhaar, mobileMatch,
      verifiedAt}`, `KycStartResponse {ref, verificationUrl, expiresAt}`,
      `KycStartRequest {redirectUrl?}`, `DigilockerWebhook {type, ref, status, data{maskedAadhaar, mobile, identityHash}}`.
- [x] **ct-ver-mapper** - `VerificationMapper` (MapStruct) for the mechanical fields; the
      absent-row default (`badge=false,status=none`) is a hand-written `default`.
- [x] **ct-ver-service** - `VerificationService`: `status(userId)`, `start(userId)` (reuses
      `provider.KycProvider`, persists/updates `ref`/`verification_url`/`expires_at`/`status=pending`,
      409 per reconciliation (i)), `handleWebhook(...)` (idempotent by `ref`; SUCCESS => badge/verified/
      masked last-4/identity_hash/mobile_match/verified_at + flips `users.aadhaar_verified` and
      `users.verified`; collision => failed; FAILED => failed, no badge).
- [x] **ct-ver-repo** - add `findByIdentityHash` to `IdentityVerificationRepository`.
- [x] **ct-ver-controller** - `VerificationController` (`GET`/`POST /me/verification/aadhaar`, 202 on POST).
- [x] **ct-webhook** - `DigilockerWebhookController` + `WebhookSignature` (HMAC-SHA256 over
      `x-webhook-timestamp + rawBody`, constant-time compare, secret from env only with a dev
      default). Takes the **raw** body as `String` and parses with `ObjectMapper` so the signed
      bytes are exactly what we verify. **Always 200**, even on bad signature/parse failure.

### catalog reveal (surgical)
- [x] **ct-reveal** - `PropertyMapper.toResponse(Property, @Context ContactVisibility)` and
      `toOwner(User, @Context ContactVisibility)`; the reveal lives in the **hand-written** carve-out.
      `PropertyController.get` asks the `ContactGate`; every other call site passes `MASKED`
      (archive/restore are moderation responses, `/me/listings` is the caller's own number -
      neither is a contact surface, and keeping them MASKED is the smallest safe diff).
      *Accept:* the 2 slice-2 mask assertions still pass unchanged.

### Verify
- [x] **ct-tests** - to the 11 bar (see Deliverable 4 in the brief): contactStatus owner/none/pending/
      approved; requestContact 200+pending, idempotent, `owner` on self; **403 only** under owner
      opt-in + no badge **and 200 for an unverified caller when the owner has NOT opted in**
      (the badge-not-gate proof); owner-scoping (no cross-owner read, 404 on foreign req);
      masked -> revealed flip on approval; getAadhaarStatus/submitAadhaar 202 + 409 dedup;
      webhook signature-verify + replay-idempotent + always-200 + badge/last-4/mobile_match;
      route-constant vs security-matcher agreement; mock-shape parity.
- [x] **ct-verify** - `cd backend; $env:JAVA_HOME=Zulu-25; mvn -q verify` green (59 existing + new),
      boots under `ddl-auto=validate`, MapStruct generates into `target-cli`.
- [x] **ct-review** - java-reviewer -> code-reviewer -> security-reviewer (owner-scoping, cross-owner
      leakage, premature reveal, webhook forgery/replay, raw-Aadhaar handling, one-Aadhaar-one-account,
      MapStruct not auto-applying a masking converter); triage with ponytail/PM; apply in-scope.


---

## RESULTS - Slice 3 (contacts + gate + Aadhaar badge) - SHIPPED

`cd backend; mvn verify` => **BUILD SUCCESS, 88 tests, 0 failures** (59 pre-existing + 29 new),
booting against the live Flyway'd Postgres under `ddl-auto=validate`, MapStruct generating into
`target-cli`, mock `KycProvider`, zero paid keys.

### Delivered
- `GET /contacts/status`, `POST /contacts/request`, `GET|PATCH /me/contact-requests[/{reqId}]`,
  `GET|POST /me/verification/aadhaar`, `POST /webhooks/cashfree/digilocker`, plus the surgical
  property-detail contact reveal.
- New packages `com.punenest.api.leads.contact` and additions to `com.punenest.api.identity.verification`;
  shared kernel gained `common.trust.{ContactGate, ContactVisibility}`.
- Standards additions: `Routes.{Contacts, MeContactRequests, Verification, Webhooks}`,
  `ErrorCodes.{VERIFICATION_REQUIRED, AADHAAR_ALREADY_REGISTERED}`, feature-owned vocabulary constants
  (`ContactStatuses`, `ContactRequestStatuses`, `VerificationStatuses`, `VerificationSources`,
  `WebhookStatuses`), and two MapStruct mappers with hand-written trust carve-outs.

### Changes made after the plan was written
1. **`V9__contact_request_uniqueness.sql`** (new migration). The idempotency promise ("re-requesting
   never opens a second lead") lived only in a check-then-insert, which two concurrent taps can slip
   through - and V4 had no unique constraint to catch it, so the result would have been a duplicated
   owner inbox and a broken single-row lookup. Added
   `UNIQUE (requester_id, property_id)`; `ContactService.request` now flushes and treats a
   `DataIntegrityViolationException` as "the other tap won, re-read". Same posture as
   `identity_verifications.identity_hash`: the app degrades gracefully, the database guarantees.
2. **Blank webhook secret is now fatal** (`WebhookSignature` constructor). `CASHFREE_WEBHOOK_SECRET=""`
   passes Spring's `${...}` requirement but makes the HMAC key empty - every forged signature would
   verify. Now refused at construction.
3. **Webhook timestamp freshness window (+/-5 min).** The signature covers the timestamp but nothing
   validated it, so a captured payload was replayable forever. Stale or unparsable => not verified
   (still 200).
4. **Bounded free text.** `ContactRequestCreate.message` (1000) and `StatusUpdate.note` (500) were
   unbounded into `text` columns. Added `@Size` **and** mirrored `maxLength` into the OpenAPI spec, so
   the contract stays SSOT rather than the server quietly diverging.
5. **`AadhaarVerificationResponse.none()` moved off the mapper onto the DTO.** MapStruct adopts any
   no-argument method returning the target type as an *object factory* and routes the real mapping
   through it - `toResponse` was silently returning a blank badge for verified users. See lessons.
6. Test-only `punenest.webhooks.cashfree.secret` added to `src/test/resources/application.properties`
   (test resources replace the main file wholesale, they do not merge).

### Reviewer triage (java-reviewer, security-reviewer)
Applied: the request race (1), blank secret (2), replay window (3), input bounds (4).
Rejected with reason:
- *"`tools.jackson` is the wrong import"* - it is correct; Spring Boot 4 ships Jackson 3.
- *"extract the duplicated `maskMobile`"* - deliberate. Both copies are `private` so MapStruct cannot
  adopt them as implicit `String->String` converters, and a security rule a reviewer can read in place
  beats one they have to go find.
- *"timing side-channel in uuid-or-slug resolve"* - both branches are indexed point lookups on
  random v4 UUIDs; not a realistic oracle.
- *"treat a missing user in the webhook as failure"* - `identity_verifications.user_id` is a FK and we
  never hard-delete, so the branch is unreachable; the existing null-guard is enough.
- *rate limiting on `/contacts/request`* - real, but platform-wide and not slice-3 scope.

### Deferred (recorded, not done)
- Owner `hideNumber` preference (mask even after approval): no backing column - would be
  `users.hide_number`. Out of scope, see reconciliation (d).
- ArchUnit boundary test for the `leads -> catalog/identity` documented exception.
- `package-structure.md` 4 still shows the pre-MapStruct inline `from()` style, superseded by
  `api-standards.md` 8.1 - doc fix owed.

## UI-API integration Phase 0 + 1 - auth vertical (this session)

Goal: build the integration seam and wire auth end-to-end to the local backend without ever
breaking mock mode. Gated on a written feasibility verdict (delivered, see below).

### Feasibility verdict (gate)
**Auth mock must be RETAINED**, and removal needed a spec fix first:
- `/auth/refresh` and `AuthResponse.otpSent` were implemented but **missing from the OpenAPI spec**
  (SSOT gap). Fixed before any integration code.
- Scoped-staff RBAC (`roleId`, `moduleAccess`) exists in neither the spec nor the backend. Absent =>
  scoped staff degrade to base modules. Admins are unaffected (`isSuperAdmin`). Mock stays for this.
- Staff login: the UI collects mobile+OTP, `/auth/staff-login` is email+password. Not convertible here.
- `lib/auth.js` sign-up registry has no server counterpart by design: `/auth/login` auto-provisions a
  buyer on first verified login, and there is deliberately no "does this mobile exist?" endpoint
  (it would be a user-enumeration oracle). `Signup.jsx` role is hardcoded `buyer`, so no role gap.
- OTP dev ergonomics were already solved: `MockOtpSender` logs `[MOCK OTP] mobile=... code=...`.

### Done
- [x] Spec: `POST /auth/refresh` + `RefreshRequest`, `AuthResponse.otpSent`, dual-mode `/auth/login` docs.
- [x] Phase 0 seam: per-domain `VITE_API_DOMAINS` switch (replacing the all-or-nothing global flag),
      `services/http.js`, token storage in `lib/auth.js`, Vite `/api` dev proxy.
- [x] Phase 1: `providers/http/authProvider.js`, `AuthContext` via the services seam with an async
      `loading` state, route guards short-circuiting on `loading`.
- [x] Contract-parity harness `frontend/scripts/contract-parity.mjs` - PASS.
- [x] Live evidence: `e2e/_live_auth_probe.mjs` - real OTP login, tokens persisted, session survives
      reload, 401 -> silent refresh. PASS.
- [x] **Cross-tab refresh stampede fixed** (found by security review, proven by A/B test) -
      `e2e/_crosstab_refresh_probe.mjs`. See lessons.
- [x] Dev/test DB split (see "Pre-existing / environment" below).
- [x] Deleted 20 zero-byte `.java` leftovers from the package restructure.

### Verification
- Backend `mvn verify`: **88/88 green**.
- Frontend `npm run build`: green. `npm run lint`: 1 error / 419 warnings - **identical to baseline**.
- e2e auth specs: 8 failed / 14 passed **with and without** these changes (stash-verified baseline).
- Mock mode: unchanged and default; `dashboard` + `admin-rbac` pass.

### Pre-existing failures (NOT caused by this work - stash-verified)
- `frontend/src/components/Header.jsx` contains the literal text `<verbatim file contents>` =>
  the sole lint error. Dead code (imported nowhere). Not fixed: out of scope.
- `NotifyMe.jsx` renders a WhatsApp `<input type="tel">`, making the auth specs' `input[type="tel"]`
  selector ambiguous => 8 auth e2e failures. Baseline is identical. Fix = scope the specs to
  `#signin-mobile` / `#signup-mobile` (the probes already do this).

### Environment change (important)
Dev and test **must not share a database**. The seeded `punenest_test` broke 5 `PropertiesEndpointsTest`
assertions that expect exact row counts on a Flyway-built empty schema. Resolved by cloning the seeded
DB into `punenest` (dev) and resetting `punenest_test` to empty. `application.properties` now documents this.

Root cause of "Flyway did not auto-apply V9": **`spring-boot-flyway` was missing from `pom.xml`**.
Boot 4 split autoconfiguration into per-technology modules, so `flyway-core` was on the classpath but
`FlywayAutoConfiguration` never loaded. Added; Flyway now runs on boot.

### Deferred (recorded, not done)
- Scoped-staff `roleId` / `moduleAccess` - needs backend + spec work; belongs to the admin slice.
- Staff login screen conversion (mobile+OTP -> email+password). `http.staffLogin` throws a clear
  developer error meanwhile; keep staff flows on mocks.
- `ProfileTab.save` sends `city`, which is not in `UserUpdate` - silently dropped on http.
- `avatar` is write-only (in `UserUpdate`, absent from `User`).
- **Rotate `VITE_GOOGLE_MAPS_API_KEY`**: the real key is in git history (2 commits) via the tracked
  `.env.example`. Placeholder committed now, but history exposure means the key must be rotated.
- `npm audit`: react-router RSC-mode CSRF advisory (not exploitable - this is a client-only SPA) and
  a dev-only brace-expansion DoS via eslint.

---

## Phase 2a - Route property consumers through the `services/` seam (DONE)

**Goal:** make `VITE_API_DOMAINS=property` a one-line flip. Mock-only refactor, zero behaviour change.

- [x] Enumerate every `lib/mockApi.js` / `lib/properties-admin.js` import and classify
      property-domain vs non-property symbols.
- [x] Repoint 12 single-symbol importers to `services/propertyService.js` (scripted replace):
      FollowedSocietiesPanel, SavedPanel, HeroSearch, SocietiesSection, LocationInsights,
      SimilarProperties, useSocietyHub, Compare, Locality, Notifications, Saved, Societies.
- [x] Hand-split 9 mixed-import files (property symbols -> service, the rest left on `lib/`):
      Listings, useDashboardData, useProperty, ScheduleVisit, AdminPostOnBehalf, MyListingsPanel,
      PropertyReviewModal, AdminDashboard, AdminProperties.
- [x] Seam-leak check: **0** direct `lib/mockApi` property imports remain in `pages/` + `components/`.
- [x] `npm run build` green; `npm run lint` 1 error / 419 warnings - **identical to baseline**.
- [x] e2e: **120 passed, 0 failed, 0 flaky** across the 11 specs covering every repointed file.
- [x] Documented the seam rule + exceptions in `docs/system/frontend-data-seam.md`.

### Fixed along the way: pre-existing flaky test (NOT a regression)
`e2e/tests/notifications.spec.js` guard assertion. Proven pre-existing by probe: on **both** baseline
and changed code the sign-in card renders (`immediate=0, settled=1`) - `toHaveCount(0)` only passed by
sampling before React rendered. Two bugs, both fixed:
1. the assertion raced the render -> now waits for a positive signal first;
2. `getByRole('heading', { name: 'Notifications' })` matched by **substring**, so it also matched the
   legitimate intent copy "Sign in to view notifications" -> now `exact: true`.
Mutation-tested: temporarily disabling `ProtectedRoute` makes it fail correctly.

### Deliberate exclusions (documented in `docs/system/frontend-data-seam.md`)
- `setPipelineStage`, `sendOwnerReminder`, `confirmListingFresh`, `applyVerifiedBadgeToListings`,
  `verifiedStats` - mock-only, no backend counterpart.
- `lib/data/myListings.js` keeps its direct `lib/` import (routing `lib/ -> services/` inverts
  layering); becomes `GET /me/listings` in Phase 2c.
- `archiveListing` / `restoreListing` stay on `properties-admin.js` until Phase 2b, so the repoint and
  the field mapping land in one reviewable change.

### Blocks Phase 2b (needs a decision)
- **`localitySlug` has no backend counterpart** - backend returns `locality` (display name), but the
  slug is the filter key across Listings / Locality / Societies. Prefer adding it to the OpenAPI spec.
- **Aggregate-heavy pages** (Societies, Locality, LocationInsights, Compare, Notifications,
  SimilarProperties) load the whole catalogue and aggregate client-side. Fine on 38 mock rows, never
  against a paginated API. Needs a product call: server-side aggregate endpoints vs. capped fetch.

---

## localitySlug hardening (DONE) - prerequisite for Phase 2b

Question raised: "why not just use the locality name?" Answer: `localities.slug` is the PK,
`properties.locality_slug` / `societies.locality_slug` are FKs to it, `name` has no uniqueness
constraint, and the slug is the `/locality/{slug}` SEO URL. Verified live: `?locality=baner` -> 2
results, `?locality=Baner` -> 0. Keeping it, and made it trustworthy:

- [x] **Spec (SSOT) first** - `localitySlug` added to `PropertySummary` (inherited by `Property` via
      `allOf`); the `locality` search param now documents that it matches the *slug*.
- [x] `localitySlug` added to `PropertySummary` + `PropertyResponse` records (MapStruct maps by name).
- [x] `catalog.locality.Locality` entity + `LocalityRepository` (active-scoped finders).
- [x] `LocalityResolver` - slug hit -> case-insensitive name -> containment (>=5 chars, snaps
      "Hinjawadi Phase 1" -> `hinjawadi`) -> nearest active locality within 2.5 km -> `null`.
      Returns `null` rather than coining a slug: the column is FK-constrained, so coining would mean
      polluting the curated locality table and the sitemap with owner typos.
- [x] Wired into `ListingService.create` and `update`. **Bug fixed:** owner-created listings were
      saved with `locality_slug = null`, making them invisible to every locality facet while looking
      fine on their own detail page.
- [x] Update re-binds the slug **only** when the display locality changes - deliberately not on a
      lat/lng-only edit, which is non-foundation and would let an owner silently move an approved
      listing into another market's results without re-moderation.
- [x] 16 new tests (12 resolver + 4 endpoint). Backend **104/104 green** (was 88).
- [x] Verified against the live dev DB on :8081 - `localitySlug` emitted, facet keys off it.
- [x] Deleted 3 zero-byte leftover test files (`api/auth/`, `api/user/`).

### Build fix found along the way (was silently shipping stale bytecode)
`pom.xml` had `useIncrementalCompilation=false` with a comment claiming it forced full compiles. The
flag is inverted (MCOMPILER-209): `false` compiles only "stale" sources, so a DTO edit never re-ran
MapStruct and left a `PropertyMapperImpl.class` calling the old constructor -> 18 tests failing with
HTTP 500, and a follow-up `mvn compile` printing BUILD SUCCESS *while skipping compilation*. Set to
`true`, comment corrected, and proven by experiment (an unmappable field is ignored under `false`,
fails the build under `true`). Full `verify` now green **without** `clean`.

### Not done (deliberate)
- No backfill migration for `locality_slug IS NULL`: the dev DB has **0** such rows and there is no
  production. Would be speculative work fixing zero records.

## Phase 2b — property http provider + contract parity

- `services/providers/http/propertyMapper.js` + `propertyProvider.js` added; build clean, lint
  unchanged from baseline (1 error / 419 warnings).
- `frontend/scripts/property-parity.mjs` (`npm run parity:property`) — drives the real mock provider
  and the real http mapper against a live backend and diffs the view models. **PASS** with 7
  explicitly-tolerated divergences (see `docs/system/frontend-data-seam.md`).
- No files under `frontend/src/` were modified in this step, so mock mode is structurally untouched.

### Open, needs a product decision before the property domain goes http
- **`construction` / `possession`.** The UI has a `ready|new|under` enum driving the availability
  filter; the backend has nullable free-text `possession`, detail-only, unfiltered, NULL in all 38
  seed rows. In http mode the "Ready to move" filter returns **zero results** (the comparison at
  `listingsResultsPipeline.js:72` is unguarded). Options: hide the facet via the existing `rel()`
  gate, or add a constrained filterable `possession` to the spec. **Do not enable the property
  domain for the buy flow until resolved.**
- Cross-domain id references: saved / compare / enquiries stay on mocks and key off property id,
  while http ids are backend slugs. Untested.

### e2e baseline (full suite, 930 tests): 915 passed, 10 failed, 5 flaky

All 10 failures are **pre-existing and unrelated to Phase 2b** — Phase 2b added only new files that
mock mode never loads. Root causes confirmed by direct DOM/error inspection, not inferred:

1. **9 failures — a hidden Netlify form in `frontend/index.html:41-49`.** It declares
   `<input type="tel" name="whatsapp">` so the Netlify build bot registers the `pmf-lead` form. It is
   inert and `hidden`, but it exists on *every* page, so `page.locator('input[type="tel"]')` resolves
   to 2 elements and Playwright strict mode throws before any assertion runs.
   Affected: `auth-flow.spec.js` (3), `auth-improvements.spec.js` (5), `services-loans-team.spec.js` (1).
   `index.html` is unchanged since commit `08c4fb9`, which predates all integration work.
   *Fix (not applied — outside this task's scope):* scope the locators to `#root` or use the existing
   ids (`#signin-mobile`, `#signup-mobile`, `#staff-mobile`). Test-side change, no product risk.

2. **1 failure — `contact-owner-gate.spec.js`, environmental.** The gate assertion itself passes; the
   test then fails on `expect(consoleErrors).toEqual([])` because external image CDNs return
   `ERR_CERT_AUTHORITY_INVALID` behind this network's TLS interception. Not a product defect.

Neither should be counted against Phase 2b, and neither blocks it.

## possession / construction — contract fix (chosen over hiding the facet)

Backend 107/107 green (was 104). Frontend build clean, lint unchanged.

- `V10__property_possession.sql` — CHECK constraint + deterministic backfill (rent → ready-to-move,
  plots → NULL, sales spread by md5(id) so the distribution is stable across environments).
- `PropertyPossession` constants (mirrors `DealIntent`), `@Pattern` on ListingCreate/Update,
  `possession` on `PropertySummary`, search facet in `PropertySearchQuery`/`PropertySpecs`/controller.
- OpenAPI: `PropertyPossession` schema, query param, and **removed the contradictory redeclaration**
  in the `Property` detail `allOf` (free text `example: Ready to move`) which would have made the
  detail schema unsatisfiable against the inherited enum.
- Frontend mapper translates `ready-to-move ⇄ ready` on read, filter and write.
- 3 new backend tests + an end-to-end facet assertion in `npm run parity:property`.

**Flyway auto-migrate confirmed working** on Spring Boot 4.1 / Java 25: V10 applied automatically at
boot ("Migrating schema public to version 10"). The V9 incident was situational, not systemic.

## e2e baseline is unstable — 10 deterministic failures, the rest are flakes

Two full runs after the possession work: **16 failed / 10 flaky / 904 passed** and **18 / 12 / 900**
(the second was contended — I was running a build, lint and the parity harness alongside it).
Recorded baseline was 10 / 5 / 915. That looked like a regression. It is not.

Every additional spec was re-run **in isolation** and passed:

| Specs re-run alone | Result |
|---|---|
| `search-property-types`, `commercial-type-filter`, `home-search-combobox` | 23 passed, 1 flaky, 0 failed |
| `list-property-*` ×4, `property-detail-*` ×2 | 22 passed, 4 flaky, 0 failed |
| `flatmate-e2e` alone | passed |
| `flatmate-e2e` + `flatmate-video` + `rent-agreement` together | 4 failed |

The last row is the interesting one: these fail **only in combination**, never alone. They are long
multi-step wizard and dashboard flows, and they are the first to time out when workers compete.

**This segment's changes cannot be the cause, and that is provable rather than probable:**
`config.js:69` imports an http provider only when `isHttpDomain(domain)` is true, and the e2e run
leaves `VITE_API_DOMAINS` unset — so `propertyMapper.js`, the only product file changed here, is
never even loaded in mock mode.

### The 10 deterministic failures (unchanged, pre-existing)

- **9 ×** `input[type="tel"]` strict-mode violations from the hidden Netlify form at
  `frontend/index.html:41-49`, which puts a second tel input on every page.
- **1 ×** `contact-owner-gate` — the gate assertion itself passes; the console-error check trips on
  `ERR_CERT_AUTHORITY_INVALID` from image CDNs behind this network's TLS interception.

**Worth raising with the user:** a suite whose failure count swings 10→18 by machine load can't
gate a release. The wizard specs need explicit waits rather than relying on default timeouts, and
the 9 Netlify-form failures are a one-line locator scoping fix (`#root` or the existing ids).

## Phase 2 COMPLETE — property domain fully on the seam (2026-07-30)

Phase 2a shipped the seam, 2b the http provider + mapper. This closes 2b/2c and the deferred items.

### Five new seam operations (service + both providers)

`countProperties`, `getPropertiesByIds`, `myListings`, `archiveListing`, `restoreListing`.

The first two exist because several pages loaded the **entire catalogue** to compute one number or
find a handful of rows. Harmless against a 38-row mock; against a paginated API the answer silently
becomes "...of the first page". Neither needed a new endpoint:

- `countProperties` -> `size=1` and read `totalElements`, which is an exact count over the whole
  result set. (`size=0` is rejected by Spring, so 1 is the cheapest legal request.)
- `getPropertiesByIds` -> N parallel detail reads; unknown ids dropped, request order preserved.

`myListings` -> `GET /me/listings` is a **correctness** fix, not an optimisation: public `/properties`
is hard-floored to approved + non-archived server-side, so an owner's pending/rejected rows cannot be
derived from it at all.

### Pages repointed

`LocationInsights` (count), `Locality` (dropped an inventory map built only to read one entry),
`SimilarProperties` (locality-scoped with an unscoped fallback when the area is thin), `Compare`
(by-id + debounced server-side `q` picker), `Saved` (by-id), `AdminProperties` (archive/restore via
the service), `lib/data/myListings.js` (`/me/listings`, demo fallback gated on mock mode).

### Parity harness strengthened — now drives the real http provider

Previously it drove the mock provider + the http **mapper**. It now loads the actual
`http/propertyProvider.js` (via `define`-injected `VITE_API_BASE`), so the provider's own logic is
under test rather than assumed. Added assertions:

- **Provider surface equality.** `propertyService.js` forwards blindly, so a method added to one
  provider and forgotten on the other fails at runtime on whichever page calls it, in whichever mode
  nobody tested. Now caught up front.
- **`countProperties` counts the result set, not a page** — vs `totalElements`, filtered and
  unfiltered, plus proof the filter narrowed it. **Mutation-verified**: switching it to
  `content.length` fails the harness ("returned 1 but the catalogue holds 16").
- **`getPropertiesByIds`** drops unknown ids and preserves order.

Result: **PASS**, 7 tolerated differences (all mock-only fields read as `|| fallback`).

### Two real bugs found by review, three false positives rejected

Genuine, fixed:
- **mock `myListings` leaked every owner's listings when `user` was null.** `!owner || !mine || ...`
  made an absent user match *everything*. Now returns `[]` — matching http, where ownership is the
  token's. (The reviewer flagged this with the polarity backwards; the real behaviour was worse than
  reported.)
- **`AdminProperties` archive/restore swallowed errors.** These were sync calls that could not
  reject; they are now network calls that can. A failure left the modal open, logged a false audit
  entry and toasted "Listing archived" having archived nothing. `bulkArchive` used `Promise.all`,
  which fails fast — now `allSettled` with true counts.

Rejected after checking the code (all three claimed stale-response races in `Compare`,
`SimilarProperties`, `LocationInsights`): React runs the previous effect's cleanup **before** the
next run, so the per-run `alive` closure already invalidates the older response. No change made.

### Latent bug found by the harness

`services/config.js` read `window.location.origin` unguarded in its dev cross-origin warning, so the
service layer could not load outside a browser. Guarded on `typeof window`.

### Verification

- `npm run parity:property --base http://localhost:8081` — **PASS**, mutation-checked
- Build clean; lint **420 problems (1 error, 419 warnings)** — identical to baseline
- Backend untouched (107/107 still green); user's :8080 never touched, used :8081

### Named backend gaps (the only two aggregates still client-side)

| Aggregate | Needs |
|---|---|
| Societies "N homes" | a `society` facet, or a societies slice (society list is itself mock data today) |
| Saved-search match counts | a saved-search/alerts count endpoint — `countMatches` matches on multi-valued `localities[]`/`bhk[]`, which single-valued server facets cannot express |

Admin moderation (`setListingStatus`, `toggleFeatured`, `flagListing`, `clearFlag`) still throws in
http mode pending the admin slice — deliberate: failing loudly beats a silent no-op on moderation.

### e2e after Phase 2: 3 failed / 4 flaky / 923 passed (was 10 / 5 / 915)

The 9 Netlify hidden-tel-input failures are gone (locators scoped to `#signin-mobile` /
`#signup-mobile` / `#root`, mutation-checked). None of the 3 remaining are attributable to this work:

| Failure | Verdict |
|---|---|
| `contact-owner-gate` | Known pre-existing — the gate assertion passes; the console-error check trips on `ERR_CERT_AUTHORITY_INVALID` from image CDNs behind this network's TLS interception |
| `dashboard.spec.js:122` profile-completion meter | **Passes in isolation.** Load-related flake, not the `myListings` repoint |
| `near-a-place-autoscroll` | Scroll-position timing; passed on retry in isolation. Unrelated to the property seam |

Deterministic failures attributable to product code: **0**.

## Live integration verified — `VITE_API_DOMAINS=auth,property` end-to-end (2026-07-30)

New: `e2e/tests/live-property-integration.spec.js` + `e2e/playwright.live.config.js`. **5/5 green.**

Kept out of the default suite (`testIgnore: /live-.*\.spec\.js/`) on purpose: the main suite has to
pass with the backend switched off, and a conditional infra dependency makes every failure ambiguous
("is the app broken, or is Postgres down?").

| Test | Proves |
|---|---|
| catalogue served by the API | Provenance first — if the switch silently fell back to mocks, every other assertion would pass while testing nothing |
| detail + location-insights | The count goes out as `size=1` **with a `locality` param**, i.e. filtered and server-side |
| compare | Resolves `/properties/{slug}` per id rather than downloading the catalogue |
| **My Listings** | Returns **4** listings for an owner whose public visibility is **3** — the flagged row proves `/me/listings` is genuinely in use |
| session reload | Real tokens survive a refresh; no redirect to signin |

**Mutation-checked**: pointing `myListings` at `/properties` fails the test. It is not vacuous.

### Bug found: the dev proxy did NOT make CORS a non-issue

`vite.config.js` claimed "requests stay same-origin, so CORS never enters the picture in dev". Half
true, and the missing half cost an hour. The browser still sends `Origin: http://localhost:<devport>`
on POSTs even when same-origin; Vite forwards it verbatim; the backend's CORS filter judges it.
`CorsConfig` allows `http://localhost:5173` by default — so it worked **by coincidence of port**.

Running the dev server on any other port turned every POST into a bare **403 with no CORS wording
anywhere**, which reads exactly like an auth bug. `changeOrigin: true` does not help: it rewrites
`Host`, not `Origin`.

Fix: the proxy now rewrites `Origin` to the proxy target, making the same-origin promise true
regardless of which port Vite picks. Dev-only — `server.proxy` does not exist in a production build.

### Test-authoring gotchas worth keeping

- Compare's storage key is `puneNestCompare`, not what you would guess. Seeding the wrong key leaves
  the page empty and the test passes while proving nothing.
- `LocationInsights` sits on the **`?tab=location`** tab and is URL-driven; landing on `overview`
  never mounts it, so the count request never fires.
- The OTP field is six auto-advancing boxes, not one input — type into the first.
- The local OTP is read from the backend log (`[MOCK OTP] mobile=… code=…`), which is also how a
  developer signs in locally.

---

## Pre-commit cleanup + verification (before first backend commit)

**Residual files removed**
- [x] rontend/src/components/Header.jsx - 24-byte broken placeholder containing the literal text
      `<verbatim file contents>`. Unimported. **Deleting it took lint from 1 error -> 0 errors.**
- [x] `backend/.../identity/IdentityVerification.java` - 84-byte empty stub shadowing the real
      `identity.verification.IdentityVerification`. Unreferenced (no import of the FQN anywhere).
      Note: it survived earlier 0-byte sweeps precisely because it is 84 bytes, not 0.
- [x] `latest.patch` - 1 MB stale git-format patch at repo root, tracked, referenced nowhere.
      `git rm --cached` + delete; fully recoverable from history.
- [x] `e2e/_record_desktop.mjs` / `_record_mobile.mjs` - marketing-reel Playwright scripts,
      untracked, unreferenced, hardcoding an absolute path into a **dead session-state dir**.
      Moved to session `files/marketing-reel/` rather than deleted (untracked = unrecoverable).
- [x] `backend/LOCAL_DB_STATUS.md` - point-in-time local snapshot; gitignored so `git add -A`
      cannot sweep it in. The durable version is `docs/LOCAL_DEV.md`.
- [x] KEPT `e2e/tests/settings-debug.spec.js` - "debug" in the name, but a real tracked test.

**.gitignore bug fixed**
- [x] Last line was the merged pattern `.rollback/target-cli/` - appending `target-cli/` to a file
      with no trailing newline fused it onto `.rollback/`, destroying that pattern. Split back into
      `.rollback/`. (`target-cli/` is separately correct at line 33, so builds were never at risk.)
- [x] Verified ignored: `target`, `target-cli`, `dist`, `test-results`, `playwright-report`,
      `.idea` (incl. `backend/.idea/shelf/*.patch`), `frontend/.env`. `.env.example` correctly NOT ignored.

**Verification**
- [x] Backend `mvnw -o verify`: **107/107 green**, 0 failures / 0 errors, under `ddl-auto=validate`.
- [x] Frontend `npm run build`: clean.
- [x] Frontend `npm run lint`: **419 problems (0 errors, 419 warnings)** - down from 420 (1 error).
- [x] e2e full mock suite: **922 passed / 4 failed / 4 flaky** (baseline 923/3/4).
- [x] Secrets audit: all `application*.properties` use env-overridable, clearly-labelled dev-only
      defaults; `application-prod.properties` uses bare `\${ENV}` so a missing secret fails boot.
      Migrations carry reference data only - **no PII, no phone numbers** in any `.sql`.

**e2e failure triage - none are code defects**
- `contact-owner-gate` fails **reproducibly in isolation**, but NOT on the gate: every masking
  assertion (lines 45-59) passes. It fails at line 61 `expect(errors).toEqual([])` on four
  `ERR_CERT_AUTHORITY_INVALID` console errors - corporate TLS interception blocking the external
  image hosts referenced by 57 files. **Environmental.**
- `dashboard-doc-info` passed in isolation -> load flake.
- `flatmate-e2e`, `rent-agreement` -> flaky in isolation (known load-sensitivity).

**Flagged, not fixed**
- [ ] `AGENTS.md` references `.github/instructions/ui-design-consistency.instructions.md`, which
      does not exist. `.github/` holds only auto-generated java-upgrade tooling (self-ignored).
- [ ] The e2e suite's `expect(errors).toEqual([])` assertions are network-dependent and will fail on
      any machine behind a TLS-intercepting proxy. Worth filtering `ERR_CERT_AUTHORITY_INVALID`.

---

## Contact-gate identity fix (masked owner mobile collapse)

**The bug.** `lib/contact.js` derived every localStorage bucket from
`digits(ownerMobile)`. In http mode the API returns the owner mobile MASKED as
`98XXXXX210` (PropertyMapper.maskMobile: first two + last three digits). Stripping
non-digits from that yields `98210` - short, but a perfectly plausible key. Consequences:

1. **Cross-owner leak (the serious one).** Any two owners sharing a first-two/last-three
   digit pattern mask to the *identical* string, so they collapsed onto ONE bucket. A
   contact request addressed to owner A could be read back on owner B's listing.
2. `isOwnerViewer()` always false -> an owner was never recognised on their own listing.
3. `contactStatus()` always `none`, and `requestContact()` reported `pending` for a write
   that landed in the wrong bucket - the UI confirmed a request that never reached anyone.

**The fix.** `isFullMobile(num)` (exactly 10 digits) is now the single identity test.
Length is the reliable discriminator - a mask can never produce 10 digits - so there is no
need to sniff for `X` or the bullet character. `contactKey()` and `ownerPrefsKey()` return
`null` for anything else and callers read nothing / write nothing. The legacy `|| 'anon'`
fallback was removed from both: it was a shared bucket with the same defect.
`requestContact()` returns a new `'unavailable'` code so the UI stops faking success;
ContactBox, ContactOwnerModal and Owner.jsx toast it (`property.contactUnavailable`,
added to en/hi/mr).

Failing safe: every rejected case *under*-reveals (number stays masked, owner treated as a
stranger). No path can over-reveal.

**Verification**
- [x] New spec `e2e/tests/contact-identity-masking.spec.js` - 6 tests. Imports the module in
      the page via the Vite dev server, because the defect is pure key-derivation logic.
- [x] **Proved the test pins the bug**: 3 of the 6 FAIL against the pre-fix `contact.js`
      (restored from HEAD), all 6 pass after. A regression test that passes on the buggy
      code would have been worthless - the first draft of the collision test did exactly
      that (it used unmasked numbers) and was rewritten.
- [x] Contact/gate/prefs/deal specs: 28 passed, 2 flaky (both green on retry; one is the
      known `ERR_CERT_AUTHORITY_INVALID` environmental failure).
- [x] Lint 419 warnings / 0 errors (unchanged). Build clean.

**Known, deliberately NOT fixed here - same root cause, different domains**

`digits(ownerMobile) || 'anon'` is a repeated idiom across owner-keyed stores, and each one
has the identical collapse the moment a masked owner mobile reaches it. This is reachable
today in the transitional config (property on http + that domain still on mock), because
`propertyMapper.js:126` passes the masked value straight through as `p.ownerMobile`:

- `lib/store/deals.js` (`dealKey`, `dealReqKey`, `offerKey`) - consumed by `DealPanel.jsx:20`
- `lib/store/visits.js` (`visitReqKey`) - consumed by `ScheduleVisitModal`
- `lib/data/documents.js` (`docsKey`, `docReqKey`) - consumed by `DocumentsSection.jsx`
- `lib/store/rent.js` (`rentLedgerKey`, `tenancyKey`), `lib/data/rentAgreement.js`,
  `lib/data/shareFlat.js`, `lib/photoRequests.js`, `lib/leadNotes.js`

Stores keyed on `myMobile()` (billing, notifications, search, referrals, listings) are NOT
affected - the signed-in user's own number is never masked.

Not fixed now because: (a) deals/visits are being rewritten server-side in slice 4, so
guarding the mock store would be thrown away; (b) the durable fix is to re-key on
`ownerId`, which the API already returns (`p.owner.id` -> `propertyMapper.js:125`) and which
mock fixtures currently lack. Actions:

- [ ] Slice 4: deals/offers/visits become server-authoritative; drop the owner-mobile keys.
- [ ] Phase 3/4 integration: re-key the remaining owner-scoped stores on `ownerId`, and add
      `ownerId` to the mock property fixtures so both providers agree.

### Addendum - security review finding (fixed in the same change)

`security-reviewer` found a second instance of the same idiom that I had missed:
`isViewerVerified()` keyed the Aadhaar badge on `digits(u.mobile) || 'anon'`. I verified
reachability rather than taking the report at face value: `auth.js loginStaff()` stores
`mobile: ''` (line 140), so a mobile-less session is genuinely reachable - and every such
session shared ONE badge bucket. One of them verifying made all of them verified, which
bypasses an owner's "accept verified contacts only" preference. It grants a privilege, so
it now fails closed: no full mobile => not verified.

Key derivation is now centralised in a single `mobileKey(prefix, mobile)` helper used by
all three buckets (`puneNestContactReq:`, `pnOwnerPrefs:`, `puneNestAadhaar:`), so the
pattern cannot regress in this file.

Two more tests added (8 total in the spec), and re-verified red-on-old: **4 of the 8 fail
against the pre-fix `contact.js`**, including the new badge-inheritance test.

Reviewer items consciously closed rather than actioned:
- "Audit the remaining 8 modules" - already tracked above as slice-4 / later-phase work.
- The reviewer rated the badge issue HIGH; I judge it MEDIUM in practice (it needs a
  mobile-less session AND an owner who enabled verified-only), but the fix is two lines
  and fails closed, so severity did not change the decision.

**Final verification**
- [x] contact/gate/prefs/deals/masking specs: 37 passed, 1 failed - the failure is the
      known `ERR_CERT_AUTHORITY_INVALID` in `contact-owner-gate.spec.js:61`. The gate
      assertion itself (line 59, "Send an enquiry to request it" still shown) PASSES; only
      the `expect(errors).toEqual([])` console-error assertion trips. Environmental.
- [x] Lint 419 warnings / 0 errors. Build clean.


---

# Slice 4 - Deals / Offers / Visits / Finalization + ledger paydown

## Part 0 - Findings that reordered the plan

- **The backend was untracked.** Resolved before this slice: `feature/backend-integration`
  now carries all 126 Java files, 11 migrations and the test tree.
- **Most of the Part B dead-code ledger was already clean.** Verified directly: zero 0-byte
  `.java` files, no `x_outdir-*` / `xg_outdir-*` / `z_out`, no `validate_spec.py`, no
  `api/auth/` or `api/user/` test dirs. `target` / `target-cli` already gitignored. Part B is
  roughly half the size the brief assumed.

## Part 0.1 - Spec defects fixed before any code (SSOT)

I will not write code against a shape I know is wrong. Six fixes, each with an inline
rationale comment in `punenest-api.yaml`.

| # | Defect | Fix | Done |
|---|--------|-----|------|
| S1 | `OfferCreate` had no `propertyId` and `POST /offers` is not nested under a property - the server could not know the listing. Unimplementable as written. | Added, required. | [x] |
| S2 | `VisitCreate` had no `propertyId`; same hole on `POST /visits` and `POST /visit-requests`. | Added, required. | [x] |
| S3 | `GET /visits` was summarised "All visits (admin)" but carried **no `x-roles`** - as specified, any signed-in user could read every visit on the platform: visitor name, mobile, property address, time. A privacy breach by omission. | Rescoped to caller-scoped ("visits I booked"), which is what `VisitsTab` consumes. A real admin surface can be added later with an explicit `x-roles`. | [x] |
| S4 | `FinalizationCreate.propertyId` duplicated the `{propId}` path param - two sources for one value. | Optional and advisory; path wins; mismatch is 422. | [x] |
| S5 | `DELETE /me/deals/{propId}/parties/{idx}` was positional - racy and non-idempotent (two concurrent removals of `idx=0` delete two different people). | Changed to opaque `{partyId}`. Free now: no http deal provider exists. | [x] |
| S6 | Follow-on from S5: `listParties` returned `Party[]` with **no id field**, so a client could never learn a `partyId`. And the mock party is `{name, note, mobile, at}` while `Party` is `{name, mobile, role}`. | New `DealParty` schema, distinct from `Party` on purpose (see D1). `Party` gains a read-only `id`. | [x] |

## Part 0.2 - The six design decisions

**D1 - `deal_parties`: a new table (V11), not a users FK and not JSONB.**
An under-offer party is an off-platform person the owner jotted down while showing the flat -
a name, a raw mobile, a private note - with no account to reference. That is a different
thing from `deals.counterparty_id`. Not JSONB either: S5 needs a stable per-row id, which
JSONB gives no way to index or FK. This is also why `DealParty` is a separate schema from
`Party`: an under-offer party has a `note` and no `role`; `Offer.from` has a `role` and no
`note`. One overloaded schema would leak two meaningless optional fields into five payloads.

**D2 - positional index -> opaque id.** See S5/S6. Spec first, then code.

**D3 - `/visits` is the visitor surface, `/me/visit-requests` is the owner surface.**
One entity, two viewer projections - not two resources. Both POSTs create; one service method
serves both. Transition rights split by role: the **owner** may `confirm`, `complete`,
`no-show`, `cancel`; the **visitor** may only `cancel`. A visitor marking their own visit
`completed` would forge the anti-fake-review signal (see D6/f).

**D4 - close side effects, decided individually.**
- *Auto-decline sibling finalization requests on accept* - **in scope**, one transaction.
  Stated in both the spec and the V5 header.
- *Tenancy creation on rent close* - **deferred to Phase 5, owner: rent/tenancy slice.**
  The spec says it and `tenancies` exists from V6, so this is a real contract gap, not an
  oversight. But writing tenancy rows before the tenancy aggregate owns its invariants means
  Phase 5 must retrofit rules onto rows slice 4 created. Recorded, not forgotten.
- *`properties.status` on close* - **untouched.** Verified: `PropertyStatus` is
  `pending|approved|rejected|flagged|archived` - there is no `sold`/`rented`. Moderation
  status and market availability are orthogonal, which is exactly why `deals` is its own
  aggregate. The UI already renders availability from the deal (`DealPills.jsx`).

**D5 - Party mobile masking reuses the gate, but the gate cannot answer every question.**
`ContactGate.visibilityFor(viewer, property, owner)` asks *"may this viewer see the **owner's**
mobile"*. Slice 4 also needs the reverse - may the **owner** see the **buyer's** mobile. The
port cannot answer that as written. Rule: an offer/visit/finalization is itself an approach,
so the counterparty's mobile stays **masked until the owner acts** (offer accepted, visit
confirmed, finalization accepted) or an approved contact request exists.
`MobileMask` extracted to `common.trust` first, so slice 4 does not add copies 3-6 of a
security rule. [x] done

**D6 - state machines as String constants + `canTransition`,** mirroring
`ContactRequestStatuses`. Illegal transition -> **409** (api-standards.md 3, "Conflict
(uniqueness, state)"), never 500. `422` stays for payload validation. Four vocabularies:
`OfferStatuses`, `DealStatuses`, `FinalizationStatuses`, `VisitStatuses`.

## Part 0.3 - Mock <-> spec reconciliation log

| # | Divergence | Resolution |
|---|------------|------------|
| a | Mock keys everything by `ownerMobile`; contract keys by `propertyId`/`{id}` with server-derived participants. | Server derives from JWT. Same ruling as slice 3. No spec change. |
| b | Mock `respondOffer` accepts **`buyer_counter`** (`DealPanel.jsx:69`); spec enum is `accept\|decline\|counter`. | **No spec change.** The caller is either the offer's author or the listing owner, so the server *infers* direction and writes `history[].by`. Strictly better than trusting the client to declare which side it is. Two-sided negotiation preserved. |
| c | Mock visit has separate `date` + `time` + `propTitle` + `phone`; contract has one ISO `slot` + `mode`. | Server owns ISO `slot`. `propTitle`/`phone` are denormalisation the frontend mapper re-joins; `lib/visitWhen.js` already composes/parses the display form. |
| d | Mock `active` = **no stored row**; `deals` has an `active` default row. | `getDeal` returns a **synthesized active Deal (200)** when no row exists; 404 only if the property does not. Rows are created lazily on first `reserve`/`close` - no dead row per listing. |
| e | `pendingOfferCount` / `pendingFinalizeCount` / `pendingVisitCount` have no endpoint. | **Client-derived** from the list reads, consistent with the slice-3 `pendingContactCount` ruling. Note `pendingOfferCount` counts `pending` OR (`countered` AND `from==='buyer'`) - i.e. awaiting *owner* action; derivable from `status` + `history`. |
| f | `hasCompletedVisit` gates the "Visited" review badge (`ReviewsSection.jsx:48`) - anti-fake-review. | **Server owns the fact** (only the owner may set `completed`, per D3); enforcement of review eligibility lands with the reviews slice (Phase 6). Recorded with an owner. |
| g | Mock `offer.from` is a **direction string** (`'buyer'\|'owner'`); spec `Offer.from` is a **Party object**. Same field name, different type. | Spec wins on the wire. Direction lives in `history[].by`; the frontend mapper derives its `from` from the trail. Flagged loudly - this is the kind of collision that silently half-works. |
| h | Mock offer carries `moveIn`/`deal`; spec `Offer` has neither. Mock finalization has no `cancelled` (cancel deletes the row); spec/V5 do. | `moveIn`/`deal` are mock-only, dropped. `cancelFinalization` sets `status='cancelled'` and returns 204 (soft-delete rule); the frontend's absence check maps `cancelled -> none`. |
| i | `offer_history` rows are `{amount, by, at}` with `amount` NOT NULL, but `OfferResponse` carries a `message` and accept/decline carry no amount. | History is appended on **submit** and **counter** only - the amount events. Accept/decline are terminal status changes, not amount events. `message` updates `offers.message`; the spec's `history[]` items have no message field, so no column is added for one. |

## Part A - build order (each sub-slice green before the next)

- [x] **A0** Spec fixes S1-S6; `common.trust.MobileMask` extraction; V11 migration
      (`deal_parties`, `deals.counterparty_mobile`/`note`, live-row partial unique indexes,
      one-deal-per-property). *107/107 green, Flyway clean.*
- [x] **A1 Offers** - `POST /offers`, `POST /offers/{id}/respond`, `GET /offers/mine`,
      `GET /me/offers`. Includes direction inference and the negotiation trail.
      *124/124 green.*
- [x] **A2 Deals** - `GET /me/deals`, `GET|reserve|close|reopen /me/deals/{propId}`,
      `GET|POST /me/deals/{propId}/parties`, `DELETE .../parties/{partyId}`.
      11 source files + 18 tests (142/142 green). Old `DealRef`/`DealRepository` deleted.
      Regression guard proof: `getDeal_nonOwner_returns404` and
      `nonOwner_reserveCloseReopen_each404` fail when ownership bypass is injected.
- [x] **A3 Finalization** - 6 ops. The transactional auto-decline is the load-bearing test.
- [x] **A4 Visits** - 5 ops, role-split transitions.
- [x] **A5 Invariant tests** - owner-only reserve/close/reopen/respond; author-only withdraw;
      `/me/*` and `/offers/mine` return **404 not 403** on someone else's row; auto-decline
      atomicity; closed deal blocks new offers; the V11 unique indexes actually fire under
      concurrency; money is `bigint` end-to-end; soft-delete only; N+1-safe list reads;
      route-constant <-> security-matcher agreement; mock-shape parity.

---

## RESULTS — slice 4

**Part A: all 23 endpoints shipped. Part B: ledger closed, nothing left unexplained.**
**107 -> 185 backend tests, 0 failures**, booting under `ddl-auto=validate` against live Postgres.
E2E: **290 passed** (2 consecutive runs, 0 flaky).

### Commits

| Commit | Content | Tests |
|---|---|---|
| `3b1c4df` | Spec fixes S1-S5 + `MobileMask` extraction | 107 |
| `493ebd2` | V11 migration + spec fix S6 (`DealParty`) | 107 |
| `d71b511` | A1 Offers + **authorisation fix** | 124 |
| `0c1d607` | A2 Deals + `MobileMask.normalise` consolidation | 150 |
| `dc6bd44` | A3 Finalization + spec fix S7 | 164 |
| `70b7d6f` | A4 Visits | 180 |
| `2204fdd` | Security-review fixes (counterparty derivation) | 182 |
| `c919e5f` | Context-layering test + `TokenSubject` inversion | 185 |

### The three defects worth remembering

Each was found by reading the code *after* a green build, not by the build.

1. **A buyer could accept their own offer.** `OfferService.respond` checked that the caller was
   *a participant* and stopped there — so the party making the offer could accept it, agreeing a
   price with no owner involvement, and flip the very status that drives the mobile reveal.
   Participation is not authorisation. The same shape was then found and closed in finalization
   (initiator self-accepts) and visits (visitor self-marks `completed`, forging the anti-fake-review
   signal that gates the "Visited" review badge).

2. **Finalization aimed anywhere.** `request()` validated that `counterpartyMobile` belonged to
   *some* registered user, never that it belonged to the **owner of the listing**. A buyer could
   fill a stranger's inbox with unacceptable proposals and leak their own name doing it — and the
   two distinct error messages made the endpoint a registered-mobile oracle on a platform whose
   business model is not leaking phone numbers. Fixed by **deriving** the counterparty from the
   listing and merely validating the body against it, which closes both symptoms at once.

3. **Three forked copies of the mobile rule.** `MobileMask`, `VerificationService.digits` and
   `DealService.normaliseMobile`, each with different leniency — the loosest would happily store a
   *masked* number as an identity. Consolidated into `MobileMask.normalise`, which fails closed.

### Spec fixes (SSOT amended before any code was written against it)

S1 `OfferCreate` had no `propertyId` · S2 `VisitCreate` had no `propertyId` · S3 `GET /visits` was
an unguarded platform-wide read · S4 `FinalizationCreate` duplicated `propertyId` in path and body ·
S5 positional party delete made non-idempotent · S6 `DealParty` given an `id` (without it no client
could ever learn a `partyId`) · S7 `FinalizationAccept.note` removed rather than given a column
nobody reads · S8 `GET /enquiries` deprecated **and** guarded.

### Still deferred, with an owner

- **Tenancy creation on rent-close** — Phase 5, when the tenancy aggregate owns its own invariants.
  Writing tenancy rows now would mean slice 5 retrofitting rules onto rows slice 4 created. Stated
  as NOT YET IMPLEMENTED in the spec description so it cannot be mistaken for an oversight.
- **Review-eligibility enforcement** — Phase 6 (reviews slice). Slice 4 owns the *fact*
  (`hasCompletedVisit`, settable only by the owner); the reviews slice owns what it gates.
- **Per-IP rate limiting** — infrastructure, at first deploy. See the Part B reasoning above.

## Part B - ledger (corrected)

- [x] Delete the 84-byte `identity/IdentityVerification.java` stub - **already gone**.
- [x] Delete the broken unimported `frontend/src/components/Header.jsx` - done in `66d5eb7`.
- [x] Get the backend into version control - done.
- [x] `docs/system/package-structure.md` §4: replaced the pre-MapStruct inline `from(entity)` row
      with the api-standards.md §8.1 mapper rule, and recorded *why* it was superseded — a factory
      on the response record never sees the viewer, so it cannot mask.
- [x] Record the `leads -> catalog/identity` direct-repository exception in
      `package-structure.md`. Done, and generalised: §2 now states the rule as **downward,
      read-only repository access is allowed; cross-context writes go through the owning service**.
- [x] **Decided** the boundary test: **write it, but not the rule as specified, and not with
      ArchUnit.** "No feature imports another feature" was false the day it was written — six
      legitimate edges exist, so the allowlist would have named nearly every pair and guarded
      nothing. Enforced instead: a **layering** (`identity 0 -> catalog 1 -> leads 2 -> deals 3`,
      imports point strictly downward) + shared-kernel-never-references-a-feature + a third test
      that fails when a new context appears unranked. ArchUnit is unresolvable in this build
      environment and the rule is a paragraph of string comparison; scanning source also catches
      fully-qualified inline references, which produce no import statement for a bytecode rule to
      see. **It caught one violation on its first run** (`security.JwtService` took
      `identity.user.User`) — inverted via `security.TokenSubject`, zero callsite changes.
- [x] **Decided** rate limiting on authenticated writes: **close it, do not build it here.**
      The surface that actually costs money and enables enumeration — OTP — is already limited
      (`OtpService` + `RateLimitedException`). Authenticated writes are attributable to a
      mobile-verified identity, and V11's partial unique indexes cap the abuse *structurally*: a
      user cannot hold more than one live offer / visit / finalization per property no matter how
      fast they call. That is a stronger and more honest control than a request counter. A generic
      per-IP limiter belongs at the edge (gateway/CDN), not in application code where it would be
      bypassed by a second instance. **Owner: infrastructure, at first deploy.**
- [x] **Decided** owner `hideNumber`: **stays absent, deliberately.** There is no
      `users.hide_number` column because the preference would be a *second* answer to the question
      `common.trust.ContactGate` already owns. Two mechanisms deciding one reveal is exactly the
      duplication that caused this slice's masking bugs. A number is revealed when the gate says
      the approach was accepted; an owner who does not want calls declines. Revisit only if owners
      actually ask for a blanket opt-out — and then it becomes an input *to* the gate, never a
      parallel check beside it.
- [x] Slice-2 carry-overs, each closed:
      **freshness** — dormant concept, no column, no consumer; not reintroduced. It is a derived
      view of `updatedAt`, so it needs no storage if it ever returns.
      **locality-slug null** — hardened earlier this session (checkpoint 015); the slug is derived
      and never user-supplied.
      **`role`/`listingsCount` on `Party`** — left unpopulated. Both are *catalog/identity*
      aggregates leaking into a transaction DTO; populating them per party in a list read is the
      N+1 the §11 bar forbids. No frontend consumer reads them.
- [x] `GET /enquiries`: **formally deprecated** (spec fix S8) with a sunset note — superseded by
      the ADR-019 contact-request surface shipped in slice 3. Keeping two vocabularies for one fact
      is how a schema forks. **Also fixed a live defect while there**: it was summarised "(admin)"
      but carried **no `x-roles`** — the identical S3 defect — so as specified any signed-in user
      could page every enquiry on the platform (name, mobile, message). Guarded now so a reader who
      implements it before removal cannot reintroduce the leak by trusting the summary line.
- [x] Classify the e2e `qa-location-search` (x13) and `admin-*` (x9) timeouts with a decisive
      fix-or-won't-fix. **DONE: both groups = FIXED (test debt, not product bugs).** The fixes
      already landed (stale-selector / strict-mode dual-render / renamed bulk button / non-retrying
      `rows.count()` snapshot / partial `puneNestDB_v5` seed causing a white-screen boot) and are
      committed. Verified from `e2e\`:
      `npx playwright test tests/admin- tests/qa-location-search --project=chromium --reporter=line`
      -> **290 passed** (2 consecutive runs, 5.2m / 5.3m). qa-location-search alone: 15 passed.
      No `frontend\src` change was needed — no product bug behind either group.


---

# Slice 5 - Finance ledger + tenancy lifecycle (+ flag-gated Cashfree seam)

**Scope agreed with the user:** finance ledger + tenancy lifecycle. The payment rail (rent
payments, mandates, payout accounts, the payment webhook) is **deferred to slice 6**. The user has
no Cashfree credentials, and asked that the Cashfree work be built anyway behind an enable/disable
flag with mock data - so slice 5 lands the *provider layer* and slice 6 lands the *endpoints*.

## Scope judgement to flag

`PaymentGateway` currently has **no consumer** - it is pre-existing dead code from the foundation.
Building a real Cashfree payment client now adds more code nothing calls, which `ponytail` argues
against. But `KycProvider` **does** have a live consumer today (`VerificationService`, slice 3), so
the flag work there is immediately exercised.

Resolution: build **one** shared, flag-gated `CashfreeClient` + config. Wire the **KYC** path
end-to-end (live consumer, testable now). Leave `PaymentGateway` as a flag-gated seam with the
Cashfree order-creation call implemented but no endpoint calling it until slice 6, and say so in
the Javadoc rather than pretending it is live.

## Spec defects found while scoping (fix SSOT first, as always)

| # | Defect | Why it matters | Action |
|---|---|---|---|
| **S9** | `POST /tenancies` is summarised "(system, on deal finalization)" but has **no `x-roles`** and accepts the whole `Tenancy` schema - `id`, `owner`, `tenant`, `status` all client-supplied | Any signed-in user could fabricate a tenancy on any property naming themselves owner or tenant. Tenancies are the **parent of `rent_payments` and `rent_mandates`**, so this manufactures a money-bearing relationship out of nothing. Same class as the `/enquiries` defect, but a **write**. | **Delete the operation.** The system path (deal close) replaces it. |
| **S10** | `GET /tenant-profiles/{mobile}` has **no `x-roles`**, keyed by mobile | Walk the 10-digit space -> name, occupation, employer, family size, budget and trust score for **every tenant on the platform**. Worse than the slice-4 finalization oracle: that leaked a yes/no, this leaks a full profile, keyed by the exact identifier the contact gate exists to protect. | Scope to owners with an **actual tenancy or accepted contact** with that tenant; 404 otherwise. |
| **S11** | `PUT /me/payout-account` shares one schema with GET, whose only account field is `maskedAccount` (`XXXXXX7890`) | You cannot **set** a bank account from a masked value. Same shape as slice 4's `DealParty` having no `id` - a write endpoint that cannot be called correctly. | Split `PayoutAccount` (read) from `PayoutAccountUpdate` (write, full `accountNumber`). Slice 6 implements. |
| **S12** | `RentPaymentCreate.amount` is client-supplied | Rent is a property of the tenancy. A tenant could pay Rs 1. Verbatim the slice-4 **derive-don't-validate** lesson. | Amount derived from the tenancy; body value validated against it or dropped. Slice 6. |
| **S13** | `RentPayment` omits `platformFee`/`gst` although V6 stores both and its header says they are **server-computed, never trusted from the client** | Today the 2% + 18% GST is computed **in the browser** (`lib/store/rent.js:22`) with no server source of truth. Fees a client computes are fees a client can change. | Add both to the response. Slice 6 computes them server-side. |
| **S14** | `GET /me/finances/{propId}/dues` returns bare `Transaction[]` | A "due" whose defining fact is *when it is due* returns no due date. The mock returns `nextDue` + `daysUntil`. The orphan `Dues` schema does not exist. | Add a `Due` schema = Transaction + `nextDue` + `daysUntil`. |
| **S15** | `PaymentWebhook` documents a **flat** shape (`orderId`, `referenceId`, `status`) | Cashfree actually sends `{ type, data: { order, payment, ... } }` with `data.order.order_id` and `data.payment.payment_status`. The contract documents a webhook Cashfree **will never send**, so anyone implementing it faithfully builds a handler that never fires. | Correct to the real Cashfree v2025-01-01 envelope. |
| **S16** | `Tenancy` has no create-shape; `TenancyCreate` is referenced nowhere and missing | Fallout of S9. | Covered by deleting S9's operation. |

## Design decisions to resolve and record

- **D1 - who creates a tenancy?** Slice 4 deferred "tenancy on rent close" to Phase 5; this is
  Phase 5. Created **transactionally inside `DealService.close`** when the property's intent is
  rent, never by a public POST (see S9). Decide what happens on `reopen`.
- **D2 - soft-delete on a financial ledger.** `DELETE .../transactions/{txnId}` returns 204 but
  `transactions` has **no** `archived` triplet. A ledger whose rows vanish cannot be reconciled
  against its own summary, and "no hard delete" is a standing guardrail. -> V12 adds it.
- **D3 - category vocabulary.** The mock uses display strings (`'Society maintenance'`); the spec's
  example is `'rent'`. Per api-standards SS7.1 these are feature-owned String constants - decide
  whether the server validates the set or accepts free text, and who owns the display label.
- **D4 - summary/cashflow shape.** Mock returns chart-shaped `{labels, incomeData, expenseData}`;
  spec returns self-describing `CashflowPoint[]`. Spec wins (a positional array pairs data to
  labels by index, which silently misaligns). Mock `summary.count` vs spec `occupancyRate`.
- **D5 - orphan mock surfaces.** `getLoan/setLoan` (rate, tenure - no home in `OwnershipBasis`),
  `getBudgets/setBudget` (persisted state, **no table, no endpoint**), `expenseBreakdown`,
  `exportTransactionsCSV/PDF`. For each: spec addition, client-derived ruling, or drop - consistent
  with the slice-3 `pendingContactCount` precedent.
- **D6 - flag vs profile.** Existing seams use `@Profile("!prod")`, which means prod **cannot** run
  on mocks and dev **cannot** exercise the real client. The user asked for an enable/disable flag.
  -> `punenest.providers.cashfree.enabled` (default `false`), orthogonal to profile.

## Mock <-> spec reconciliation log (finance)

| # | Mock (`lib/data/finances.js`) | Spec | Ruling |
|---|---|---|---|
| 1 | `repeat` | `recurring` | Spec. V6 already recorded this ("recurring, not repeat"); frontend mapper adapts. |
| 2 | keyed `(mobile, propId)` | `/me/finances/{propId}` | Spec - server-derived owner, as in slices 3-4. |
| 3 | `basis.type: 'owned'` | absent | TBD in D5. |
| 4 | `summary.count` | `summary.occupancyRate` | TBD in D4. |
| 5 | cashflow `{labels, incomeData, expenseData}` | `CashflowPoint[]` | Spec (D4). |
| 6 | dues carry `nextDue`/`daysUntil` | bare `Transaction[]` | Spec fixed -> S14. |
| 7 | category display strings | free text, example `'rent'` | TBD in D3. |
| 8 | budgets persisted | no endpoint, no table | TBD in D5. |
| 9 | CSV/PDF export | none | Client-only (jsPDF in the browser) - correct as-is, record it. |

## Build order

- [x] **S5.0 Spec fixes S9-S16** - SSOT first, each with an inline rationale comment.
- [x] **S5.1 V12 migration** - soft-delete on `transactions`; tenancy uniqueness; basis columns.
- [x] **S5.2 Provider layer** - flag-gated `CashfreeClient`; `WebhookSignature` moved to shared;
      KYC wired live behind the flag; payments seam ready for slice 6.
- [x] **S5.3 Finance ledger** - 9 endpoints, entity/repo/service/mapper/controller.
- [x] **S5.4 Tenancy lifecycle** - read surfaces + the `DealService.close` side effect (D1).
- [x] **S5.5 Invariants + parity tests** - owner scoping, 404-not-403, bigint money, soft-delete,
      N+1-safe reads, route/security-matcher agreement, real webhook-signature test.
- [x] **S5.6 Review** - java-reviewer, code-reviewer, security-reviewer; RESULTS + lessons.

## RESULTS — slice 5 (finance ledger + tenancy lifecycle) — SHIPPED

**238 tests green** (189 before the slice's own suites, +39 endpoint tests, +6 date-rule unit
tests), `mvn verify` clean against live Postgres under `ddl-auto=validate`, MapStruct generating
into `target-cli`. The Cashfree **payment rail is deferred to slice 6** as agreed; the KYC path and
the client are built and flag-gated, so slice 6 is wiring, not discovery.

### Spec fixes applied (SSOT first, each with an inline rationale in the yaml)

| # | Fix |
|---|---|
| S9 | `POST /tenancies` removed. Nobody may assert a tenancy into existence — it is a *consequence* of a deal closing. Leaving the endpoint in meant a forged tenancy could be parented to `rent_payments` and `rent_mandates`, i.e. a claim on somebody else's money. |
| S10 | `GET /tenant-profiles/{mobile}` relationship-guarded and documented as answering `404` for **every** refusal. Keyed by mobile, it returned a stranger's name, occupation and income; anything that distinguished "no such user" from "not allowed" was a mobile-enumeration oracle. |
| S18 | `SummaryPeriods` gained `quarter` and `year`, and `year` is the **Indian financial year** (1 Apr–31 Mar). A landlord's "this year" is the FY their return is filed against, not the calendar year. |
| S19 | `PATCH` semantics for `TransactionUpdateRequest` — absent field means "leave alone", not "null it". |
| S20 | `occupancyRate` made nullable. `0.0` asserts "vacant the whole window", which is a judgement about a badly-let flat; `null` says the question does not apply (sale listing, or the owner lives there). |
| S21 | `TenantProfile` reshaped to the profile the product actually collects. Dropped `employer`, `familySize`, `budget`, `preferredLocalities` (three of which never had a UI); added `income`, `occupants`, `moveIn`, `priorLandlord`, `about`. **Four of the six trust-score inputs had no column** — a server honouring the old schema could score at most 50/100, so every tenant's score would visibly halve on cutover. Backed by `V13`. |

### Design decisions recorded

- **D1 — tenancy on rent close.** `DealService.close` opens a tenancy on a **rent** deal inside the
  existing transaction; `reopen` sets it to `ended`, never deletes, so
  `uq_tenancies_active_per_property` frees up and the flat can be re-let while the record of who
  lived there survives (rent payments hang off that row). An **off-platform tenant gets no
  tenancy** — `tenant_id` is a non-null FK and inventing a shadow user is worse than the gap. The
  deal still closes.
- **D3 — tenancy party mobile is REVEALED** to both participants. Unlike an offer or a visit (which
  are *approaches*), a tenancy exists only because a deal already closed and the two parties have
  each other's numbers. Still routed through `common.trust.MobileMask` from a `private` method so
  the platform keeps exactly one definition of the rule (§8.1).
- **D4 — tenant-profile mobile is MASKED** for a screening owner, revealed only to the profile's
  own owner.
- **D5 — empty-state reads return an empty shape, not 404** (`/me/tenant-profile`, `/basis`).
  "Not filled in yet" is a normal state; a 404 forces every client to special-case a status code in
  order to render a blank form.

### Reviewer triage (java-reviewer / code-reviewer / security-reviewer)

- **security-reviewer: zero findings.** Owner scoping, the S10 enumeration guard, mass-assignment on
  `score`/`verified`, tenancy forgery, money typing, soft-delete, injection and gate reuse all
  verified as correctly handled.
- **Applied — `RecurringIntervals` day-of-month drift (real bug).** Stepping iteratively
  (`next = next.plusMonths(1)`) clamps 31 Jan to 29 Feb and then *keeps* the 29th forever: 29 Mar,
  29 Apr, permanently. Every step now measures from the anchor, so month-end rent returns to
  month-end. Covered by `RecurringIntervalsTest`. The Javadoc had actively described the broken
  behaviour as correct, which is why it survived the first read.
- **Applied — misleading log** in `DealService.close`: it said "Opened tenancy" on the idempotent
  path where an existing one was reused.
- **Rejected — `occupancyRate` "off-by-one".** Half-open `[start, end)` is the correct convention:
  `DAYS.between(1 Jan, 1 Feb)` is 31, exactly the days in January. Numerator and denominator both
  use it, so the ratio is exact; adding `+1` would double-count the changeover day where one
  tenancy ends and the next begins. Locked down with a comment so it is not re-raised.
- **Rejected — `windowStart` NPE.** Already guarded at `FinanceService:307`.
- **Rejected — `to_char` portability comment, explicit `verified = false`.** The project is
  committed to Postgres; `boolean` already defaults to `false`. Both are noise.

### Housekeeping closed with this slice

- **`backend/validate_spec.py` — kept, not deleted.** It was on the Part B junk list, but it is the
  thing that catches a dangling `$ref` after every spec edit (141 paths / 116 schemas / 177
  operations on the last run) and it has caught real breakage. Deleting a working guardrail because
  it is written in the "wrong" language is not hygiene.
- **`docs/system/package-structure.md` layering table updated** for the new `finance` context,
  including why `finance` ranks *below* `deals` even though closing a deal is what opens a tenancy.

### Known gap

The frontend still reads its mocks for finance and tenancy — no HTTP provider is written yet, so
byte-for-byte parity rests on the backend's own shape tests. `TenantProfileService.score`
hand-mirrors the mock's weights (`idVerified 30 / occupation 20 / income 15 / priorLandlord 15 /
about 10 / occupants 10`); **if the mock's weights change the two drift silently.** Owner: whoever
writes the finance HTTP provider — delete the mock's copy at that point rather than syncing it.

# ==========================================================================
# Slice 6 - rent money rail (PLAN - awaiting scope confirmation)
# ==========================================================================

## The finding that reframes this slice

`PayRent.jsx:112` -- `if (!flagEnabled('onlineRentPayment')) return <PayRentComingSoon />;`

The entire rent-payment UI is **behind an admin flag that is off**, and the held-feature page says
why in its own header comment: *"flagged off while the money-movement rails aren't live"*. So the
consumer that would shape a payment-gateway client is a "coming soon" page.

Stacked on top of that:

- **No Cashfree credentials.** Not one call can be executed, in sandbox or otherwise.
- **The `PaymentGateway` seam is knowingly unshaped.** Its own Javadoc records that
  `PaymentOrder.redirectUrl` assumes a hosted handoff Cashfree's PG does not issue -- `POST /pg/orders`
  returns a `payment_session_id` for the JS SDK, while a shareable URL comes from Payment *Links*, a
  different product. Which one fits rent collection is a product decision that needs the frontend in
  front of it.
- **Real money movement is a company milestone, not an engineering one**: it needs a merchant account
  and business KYC before a single rupee can move.

Writing the live HTTP client now means a few hundred lines against an API we cannot call, for a UI
that is switched off, on a request/response shape we already suspect is wrong. Slice 5's own lesson
applies verbatim: *a signature check that is only ever mocked is a signature check nobody has run* --
and the same is true of a payment client.

## The scope call

**Build the rent money DOMAIN end-to-end. Do not write the live Cashfree client.**

Everything below is fully buildable and fully testable today with zero vendor keys, and it is where
the actual product risk lives -- fee correctness, idempotency, and payment state. The vendor HTTP
call is the last, smallest and least risky part, and it is the only part that needs credentials.

### In scope

- [x] **S6.1 Server-computed fee + GST (S13).** Today `lib/store/rent.js:calcRentFee` computes the
      convenience fee **in the browser** (`rentPayPercent` 2%, `gstPercent` 18%). A fee the client
      computes is a fee the client can change, and a receipt that disagrees with the ledger is a
      support ticket. Move it server-side, read the rates from `settings`, and make the browser copy
      dead. This is the single highest-value item in the slice.
- [x] **S6.2 `/me/rent-payments` GET + POST (payRent).** POST derives the amount from the tenancy
      (S12), honours `expectedAmount` as a 422 optimistic check, computes fee/GST, creates a gateway
      order through the seam, and records the row as **`due`/pending** -- never `paid`. Idempotency-Key
      honoured.
- [x] **S6.3 `/me/rent-ledger` (owner receipts).** The owner side of the same rows, participant-scoped.
- [x] **S6.4 `/me/rent-mandate` GET + PUT (autopay).** `dayOfMonth` 1-28 only -- the V6 CHECK already
      says so, and it is right: a mandate on the 30th does not fire in February.
- [x] **S6.5 `/me/payout-account` GET + PUT (S11).** Full `accountNumber` in, masked tail out, never
      returned. `verified` is a penny-drop answer, never the account holder's claim.
- [x] **S6.6 The webhook -- `POST /webhooks/cashfree/payment`.** The real one. Raw-body HMAC via the
      existing `WebhookSignature`, dedupe on `data.order.order_id`, the decimal-rupee -> whole-rupee
      parse in exactly one place, `due -> paid|failed` transition, always 200. **Tested by signing a
      payload with the live signer, not a stub.** This is where a payment rail actually goes wrong,
      and it needs no credentials to build or to verify.
- [x] **S6.7 Resolve the `PaymentGateway` shape decision** and record it: orders + `payment_session_id`
      (JS SDK, tenant present) vs Payment Links (shareable URL, tenant absent). Make the mock a
      faithful stand-in for whichever wins so the switch is a one-class change.
- [x] **S6.8 Tests + review + RESULTS/lessons**, to the SS11 bar.

### Deferred to slice 7 (or to whenever a merchant account exists)

- [ ] **`CashfreePaymentGateway.createOrder` live HTTP.** Stays the loud `UnsupportedOperationException`
      it is today -- which is the honest behaviour: better than a silent mock payment in an environment
      someone deliberately configured to move real money. **Owner: whoever gets the merchant account.**
      Unblocked by: credentials + the S6.7 decision + flipping `onlineRentPayment` on.

# ==========================================================================
# RESULTS - Slice 6: the rent money rail
# ==========================================================================

**Status: shipped, 269/269 tests green** (238 at the end of slice 5, +31 new).
`mvn verify` boots against the live Flyway'd Postgres under `ddl-auto=validate`; V14 applies to a
database rebuilt from empty. Zero vendor keys needed to build, run or test any of it.

## What shipped

19 new classes under `finance/rent/` and `common/settings/`, one migration, two test classes:

| Surface | Operations |
|---|---|
| `/me/rent-payments` | `GET` (tenant side), `POST` (payRent, Idempotency-Key honoured) |
| `/me/rent-ledger` | `GET` (owner side of the same rows) |
| `/me/rent-mandate` | `GET`, `PUT` (create / amend / pause / resume / revoke autopay) |
| `/me/payout-account` | `GET`, `PUT` (replace-not-merge, masked on the way in) |
| `/webhooks/cashfree/payment` | `POST` -- signature-verified, deduped, idempotent, always 200 |

## The three properties that carry the slice

1. **The server decides the amount.** Rent comes from the tenancy (S12); fee and GST from
   `RentFeeCalculator` reading `settings` (S13). `expectedAmount` can *refuse* a charge and can
   never *set* one. The browser's `calcRentFee` is now a duplicate of a server rule, not the rule.
2. **A payment is created pending.** `POST` yields `due`. Nothing outside the HMAC-verified webhook
   can write `paid` -- `applyWebhookOutcome` is the only path, and `RentPaymentStatuses` refuses to
   move a payment that already settled, so a late or out-of-order `FAILED` cannot un-pay a tenant.
3. **A retry does not charge twice.** `Idempotency-Key` replays the original row, and the month
   itself is guarded by a partial unique index -- not only by a service check.

## Spec fixes

| # | Defect | Fix |
|---|---|---|
| S22 | `PUT /me/rent-mandate` took the full *read* shape `RentMandate`, carrying `id`, `status` and `provider`. Same defect as S11, landing harder: `id` would aim the write at somebody else's mandate. | Split out `RentMandateUpdate` -- tenancy, ceiling, day, optional lifecycle change. |
| S22b | That split then restricted `status` to `paused\|revoked`, reasoning that re-activation is consent-on-withdrawn-consent. **That conflated pause with revoke** -- see the design decisions below. | Enum widened to `active\|paused\|revoked`; the round trip is `paused <-> active`, and only `revoked` is terminal. |
| S23 | `payRent` declared only `201`/`422` while the server also answers `404` and `409`. An undeclared status has no branch in a generated client, so a stale-amount rejection surfaces as an unhandled error instead of "the rent changed, confirm again". | Added `404`/`409` to `payRent`, `409` to `setMandate`, `422` to `setPayoutAccount`, and a reusable `Conflict` response component. |
| S23b | Seven **slice-4** operations (`submitOffer`, `respondOffer`, `reserveDeal`, `closeDeal`, `reopenDeal`, `scheduleVisit`, `updateVisitStatus`) already returned `409` from shipped code, and the contract had never said so. | Declared `409` on all seven. Mechanical alignment of the SSOT with shipped behaviour; no code changed. |

## Design decisions

**D6.1 -- Pause is reversible; revoke is not.** The first cut refused *any* re-activation, on the
reasoning that debiting a bank account needs fresh consent. That was wrong, and a test caught it.
The two are not degrees of the same thing: **pausing** is the platform declining to debit an
instruction the bank still holds, so resuming consents to nothing new -- the ceiling and the day are
unchanged. **Revoking** withdraws the instruction itself, and reviving *that* would be charging an
account on consent the tenant took back. Collapsing them made "pause" a one-way door disguised as a
toggle: a tenant taps it expecting to resume and finds they cannot. `MandateStatuses.canTransition`
had encoded the correct machine all along; the service overrode it with a special case.

**D6.2 -- A mandate lookup must see paused rows.** Direct consequence, and the more serious half of
the same bug: `findActiveByTenancyId` filtered `status = 'active'`, so **a paused mandate could
never be revoked** -- the write path reported "no mandate to update" while the standing instruction
sat there uncancellable. Now `findLiveByTenancyId` is `status <> 'revoked'`, and V14's partial
unique index uses the same predicate so a paused mandate still occupies the one slot per tenancy.
An active-only index would have let a paused one and a fresh active one coexist, and the tenant
would be debited twice the moment they resumed.

**D6.3 -- Idempotency keys are scoped to the tenancy, in the index as well as the query.**
`findByIdempotencyKey(key)` was global: a caller who guessed or intercepted another tenant's key was
handed that tenant's payment record -- amount, fees, gateway reference -- from a path that never
checked whose it was. Now `findByTenancyIdAndIdempotencyKey`, with `UNIQUE (tenancy_id,
idempotency_key)` behind it, so the scoping is structural rather than a filter a later edit can drop.
`payRent` was reordered to authorise the tenancy *before* replaying the key.

**D6.4 -- `GET /me/rent-mandate` is singular but a tenant can hold two tenancies.** Returns the most
recent live mandate, recorded in the Javadoc rather than hidden. The real fix is a spec change to
`/me/rent-mandates`; not worth it until multi-tenancy autopay is real.

**D6.5 -- The provider's amount reconciles, it never writes.** The callback's `payment_amount` is
parsed to whole rupees and compared with what we billed; a mismatch logs at ERROR and **still
settles**. Refusing to record it would leave a tenant who has genuinely paid showing as unpaid.
Reading the amount off the callback instead would let the provider's rounding become our ledger.

**D6.6 -- `PaymentGateway` shape (S6.7): orders + `payment_session_id`, not Payment Links.** Rent is
paid by a signed-in tenant with the app open, which is exactly the case the JS SDK serves; Payment
Links exist for a payer you cannot put a UI in front of. The mock keeps `redirectUrl` for now
because nothing consumes it; the real client will return a session id, and the seam is one class.

## Review triage

`security-reviewer` raised 6, `java-reviewer` 10. Applied 6; rejected the rest with reasons.

**Applied**
- **CRITICAL, real -- the idempotency IDOR.** See D6.3. Regression test:
  `payRent_doesNotReplayAnotherTenantsIdempotencyKey`.
- **HIGH, real -- a lost race returned 500.** Two taps both pass `existsLiveForDueDate`; the loser
  hit the unique index and got an unhandled `DataIntegrityViolationException`. The index is the real
  guard, so it now surfaces as the 409 it always meant. Same fix on mandate creation, where the
  consequence is worse: two standing instructions against one rent.
- **HIGH, real (if remote) -- a null gateway order id.** `reference` is how the webhook finds the row
  again; a payment stored without one can never be settled, so the tenant sits at "due" having been
  charged. Now fails before anything is persisted.
- **MEDIUM, real -- payout account accepted a bank account *and* a UPI id.** "Either/or" has to mean
  it: two destinations with no rule for choosing is money landing wherever the code looks first.
- **MEDIUM, real -- V14 backfilled `due_date` from `current_date`**, which would stamp historic rows
  with a future date and corrupt every overdue calculation. Now `date_trunc('month', created_at)`.
- **LOW -- `mask()` returned short input unmasked.** Unreachable behind the 9-18 digit pattern, but a
  masking function whose fallback is "return the secret" is the wrong shape to leave lying around.

**Rejected**
- *"Missing foreign keys allow orphaned payments" (MEDIUM).* **Wrong -- the reviewer did not read
  V6.** `rent_payments.tenancy_id`, `rent_mandates.tenancy_id` and `payout_accounts.owner_id` are all
  `NOT NULL REFERENCES`. This also voids the theta-join concern stacked on it.
- *"Missing explicit `save()` in `applyWebhookOutcome` / `setMandate`" (HIGH/LOW).* Both mutate a
  managed entity inside `@Transactional`; dirty checking flushes at commit. Adding redundant `save()`
  calls to look consistent is cargo cult, and would suggest the surrounding transaction is optional.
- *"Cache the platform settings -- N+1" (MEDIUM).* Two primary-key lookups per rent payment, on a
  path that runs once per tenant per month. Caching would trade nothing measurable for staleness in
  a **fee calculation**, which is the one number that must never be stale.
- *"`settableList()` should not include `active`" (LOW).* After D6.1 `active` *is* settable.
- *Rate limiting on the webhook (MEDIUM).* Real, but infrastructure, and already the standing
  platform-wide deferred item. Signature verification already bounds the abuse to log noise.
- *Redacting money from the mismatch log (MEDIUM).* The log exists precisely so a human sees which
  payment and by how much. An alert that omits the discrepancy is not an alert.

## Still deferred, with owners

- **`CashfreePaymentGateway.createOrder` live HTTP.** Still the loud `UnsupportedOperationException`,
  which is the honest behaviour -- better than a silent mock payment in an environment somebody
  deliberately configured to move real money. **Owner: whoever obtains the merchant account.**
  Unblocked by credentials + flipping `onlineRentPayment` on. Everything it plugs into is built and
  tested; it is one class.
- **Frontend still computes the fee** in `lib/store/rent.js`. The server is now authoritative, but no
  frontend file was touched this slice (out of scope by instruction). **Owner: the rent-UI
  integration slice**, alongside flipping the flag.
- **Rate limiting on authenticated writes.** Platform-wide, unchanged.


---

# Slice 7 - Catalog & Search (public reference surface)

8 operations. `/properties`, `/properties/{id}` and `/properties/featured` shipped in slice 2, so
the tag goes **3/11 -> 11/11**. Everything here is `security: []` - public reads plus one public
write. No money, no state machine, no ownership model.

## Measured starting state (dev DB, not assumed)

| Table (V3) | Rows | Note |
|---|---|---|
| `localities` | 15 | `about`/`connectivity`/`highlights`/`price_trends` jsonb **all empty** |
| `societies` | **0** | never seeded |
| `reels` | **0** | never seeded |
| `cities` | 1 | `pune` |
| `platform_fees` | 2 | `rent`, `buy` |
| `properties` | 38 | carries both `locality_slug` and `society_id` |

Reused rather than rebuilt: `catalog.locality.Locality` (extended from 6 to the full column set),
`LocalityResolver`, `PropertySummary`, `PropertyRepository`, `PageResponse`, `Routes`,
`common.settings.PlatformSettings`, and the `@JdbcTypeCode(SqlTypes.JSON)` jsonb pattern already
proven by `Property.amenities`.

## Design decisions - rulings

### D7.1 - `/fees` is not the frontend's `getFees()`. Two documents, one word. **RULED: keep them apart.**

`GET /fees` returns the spec's `Fees`: a per-deal cost breakdown (`brokerage`, `platformFee`,
`stampDuty`, `registration`, `gst`, `notes`) backed by the `platform_fees` table. The frontend's
`getFees()` in `lib/store/billing.js` is a completely different document - a platform price list
(`ownerPlanYearly`, `rentAgreementPlatform`, `gstPercent`, `rentPayPercent`) backed by
`settings('fees')`, already read server-side by `PlatformSettings`, and owned by
`GET /admin/settings` in the Admin slice.

Checked before ruling: no frontend file reads `brokerage`, `stampDuty` or `platformFee`. `GET /fees`
has **no frontend consumer today**. It is built anyway because it is ~30 lines over an already
seeded table, and because leaving a contracted public endpoint unimplemented is a worse deal than
writing it.

Sub-ruling: the spec declared a single `Fees` object while the table is keyed by deal and the schema
itself carries a `deal` field - an inconsistency. **Returns an array, one entry per deal** (spec fix
S24). A cost-transparency surface wants both sides, and an array needs no query parameter.

### D7.2 - Denormalised counters. **RULED: compute on read; the stored columns are not to be trusted.**

`localities.listing_count`, `societies.listing_count`, `cities.listing_count`,
`societies.follower_count`/`avg_rating`/`review_count` are stored columns that **no application code
has ever maintained**. Measured drift in the dev DB at planning time:

| slug | stored | approved + unarchived | all |
|---|---|---|---|
| aundh | 1 | 0 | 1 |
| nibm-road | 1 | 0 | 1 |
| viman-nagar | 2 | 0 | 2 |

The important part is not the drift, it is that the stored number **answers a different question
than the UI asks**: it counts every property, while the public surface must count approved and
unarchived ones. A counter that is merely stale can be refreshed; a counter that measures the wrong
thing is wrong on the day it is written. That is the worst state for a counter to be in - plausible
enough to be trusted, wrong enough to mislead.

Every count on this slice is computed on read with **one grouped query per endpoint** (15
localities, ~30 societies, 1 city - the aggregate is cheaper than the join it saves), never per row.
The stored columns keep their seeded values for now and are documented as unmaintained; dropping
them belongs with whichever slice takes ownership of write-side counting, if one ever does.

### D7.3 - `societies.security` type. **RULED: text, not boolean (spec fix S25 + V15).**

Schema and spec said `boolean`; the frontend mock says `"3-tier + CCTV"`, `"Gated + CCTV"`. The
string carries information a boolean discards, and a resident choosing a society cares about the
difference. The mock is the UI ground truth, the table has zero rows, so the change costs nothing.
Spec changes first, then the migration.

### D7.4 - `followedByMe` on a `security: []` endpoint. **RULED: optional principal.**

`Society.followedByMe` needs the caller, but `/societies` and `/societies/{slug}` are public.
`permitAll` does not reject a valid bearer token - the JWT filter still populates the security
context - so the field is resolved when a token is present and `false` when anonymous. The write
side (`PUT|DELETE /me/societies/{slug}/follow`) is Engagement-tag: **readable now, settable later.**

### D7.5 - `SocietyDetail` aggregates. **RULED: `homes` now, `reviews` empty with a named owner.**

`homes` is buildable today - `properties.society_id` exists - and reuses `PropertySummary` filtered
to approved and unarchived. `reviews` returns `[]`: the `reviews` table exists (V7) but has no
entity, and `GET /reviews/{entityType}/{entityId}` belongs to the **Engagement slice, which owns the
real review surface**. `avgRating`/`reviewCount` are computed on read per D7.2, and read 0 until
reviews exist - which is honest, where a seeded non-zero rating would not be.

### D7.6 - `POST /cities/waitlist` is an unauthenticated write. **RULED: unique constraint now, rate limiting stays an owned platform item.**

The only write in an otherwise read-only slice, and open to the internet.

- **Dedup by constraint, not by service check** - the slice-3 lesson. `UNIQUE (mobile, city)` in
  V15; a repeat submission is idempotent and still answers 201, because "you are already on the
  list" and "you are now on the list" are the same outcome to the person asking.
- **`name` is dropped, not added.** The frontend sends it; the contract's `CityWaitlistRequest` does
  not have it and neither does the table. A waitlist needs a way to reach you and a city - a name is
  extra personal data with no use, and the cheapest way to protect data is not to collect it.
- **Rate limiting is not done here.** Deferred three times platform-wide, and one low-value insert
  behind a unique constraint does not justify inventing a bespoke limiter for a single route. It
  stays deferred **deliberately and in writing**, with an owner, rather than by drift.

### D7.7 - `LocalityDetail` has no `listingsList`. **RULED: follow the spec.**

The mock's `getLocality(slug)` embeds `listingsList`, but `Locality.jsx` already fetches listings
separately through `listProperties({ locality })`. Adding an embedded array would serve nobody and
would make one endpoint's cost depend on another page's needs.

### D7.8 - Reels are not real yet. **RULED: implement to spec, seed the data, name the frontend gap.**

`reels` has zero rows and `Reels.jsx` renders a **hardcoded array** - it does not even call the mock
provider - carrying `photos[]`, `bhk` and `area` which exist in neither spec nor schema. The
endpoint is built to the contract and the 10 mock reels are seeded. Wiring `Reels.jsx` to it is
frontend work: **owner - the frontend integration slice.**

## Tasks

### Foundations
- [x] **s7-spec** - spec fixes S24 (`/fees` returns an array), S25 (`society.security` -> string),
      and any `CityWaitlistRequest` reconciliation. Spec moves before code; `validate_spec.py` clean.
- [x] **s7-migration** - V15: `societies.security` boolean -> text, `UNIQUE (mobile, city)` on
      `city_waitlist`. Applies to a database rebuilt from empty.
- [x] **s7-seed** - `R__seed_reference_data.sql` gains 28 societies and 10 reels ported from the
      frontend static datasets, idempotent via `ON CONFLICT`. Reference data only, never user data.

### Endpoints
- [x] **s7-fees** - `GET /fees` over `platform_fees`. Smallest surface, proves the pattern.
- [x] **s7-city** - `GET /cities`, `POST /cities/waitlist` (201, idempotent on the unique key).
- [x] **s7-locality** - extend the `Locality` entity to the full column set including the four jsonb
      fields; `GET /localities`, `GET /localities/{slug}` (404 on unknown slug).
- [x] **s7-society** - `GET /societies` with `q`/`locality`/`sort` + `PageResponse`;
      `GET /societies/{slug}` with `homes` and optional-principal `followedByMe`. Largest item.
- [x] **s7-reels** - `GET /reels` with the `locality` filter.

### Wiring, tests, verification
- [x] **s7-wiring** - `Routes` holders (`Localities`, `Societies`, `Cities`, `Reels`, `Fees`);
      `SecurityConfig` `permitAll` bound to **the same constants**; Javadoc per section 10.
- [x] **s7-tests** - section-11 bar: reachable with no token; 404 on unknown slug; sort whitelist
      rejects unknown fields; page size capped; computed counts match reality (the D7.2 regression);
      waitlist dedup under a concurrent double-submit; `followedByMe` anonymous vs authenticated;
      mock-shape parity; route-constant/security-matcher agreement.
- [x] **s7-verify** - `mvn verify` green (269 existing + new) under `ddl-auto=validate`, then
      java-reviewer -> code-reviewer -> security-reviewer, triage, RESULTS block, lessons.

## Review focus for this slice

Nothing here is owner-scoped, so the usual question ("can I read someone else's row?") does not
apply. The exposure moves to: **enumeration and scraping** of the whole catalogue, **hostile page
sizes** on public list endpoints, **N+1 on unauthenticated reads** (an unauthenticated N+1 is a
free denial-of-service), and the one **unauthenticated write**.

---

## RESULTS - Slice 7 (Catalog & Search)

**Status: complete.** `mvn -o verify` green against live Flyway'd Postgres under
`ddl-auto=validate`: **300 tests, 0 failures, 0 errors**, MapStruct generating cleanly into
`target-cli`. Tag coverage `catalog` 3/11 -> **11/11**; overall **67/177 -> 75/177** operations.

### Shipped

| Operation | Notes |
|---|---|
| `GET /fees` | array, not object (spec fix S24) |
| `GET /cities` | computed `listingCount` |
| `POST /cities/waitlist` | the only unauthenticated write; idempotent 201 |
| `GET /localities` | alphabetical, computed counts |
| `GET /localities/{slug}` | narrative + `priceTrends` jsonb; 404 unknown/retired |
| `GET /societies` | `q`/`locality`/`sort` + `PageResponse` |
| `GET /societies/{slug}` | `homes`, optional-principal `followedByMe` |
| `GET /reels` | `locality` filter, bare array feed |

New packages under `catalog/`: `fee`, `city`, `locality` (extended), `society`, `reel`, plus
`catalog/property/ListingCounts`. Five new `Routes` holders with `SecurityConfig` bound to the same
constants. `V15__catalog_public_surface.sql` + reference seed (16 localities, 28 societies, 10 reels).

### Decisions as built

D7.1 `/fees` from `platform_fees`, returned as an array; `billing.js` migrates to `/admin/settings`
later - the two documents stay separate. D7.2 **counters computed, never stored** - the six
unmaintained columns are left unmapped on the entities, so reading them is impossible rather than
merely discouraged; `ListingCounts` is the single owner. D7.3 `societies.security` boolean -> text
(spec fix S25). D7.4 optional principal on a `permitAll` route. D7.5 reviews honestly absent -
`avgRating` is `null`, not `0.0`. D7.6 waitlist dedup by unique index, repeat submit answers 201, and
`name` deliberately not collected. D7.7 no `listingsList` on locality detail. D7.8 reels implemented
and seeded; wiring `Reels.jsx` is later frontend work.

Ruled during implementation: **`localityIntel.js` will not be ported.** Its model (demand as a text
band, connectivity as `(place, icon, distance)` triples) has no counterpart in the contract's
`connectivity: string[]` / `priceTrends`. Reshaping it would be inventing content, not moving it -
so `about`/`connectivity`/`highlights`/`priceTrends` ship empty and content-authoring owns them.

### Bugs found and fixed that were NOT in scope

- **Public `GET /properties` had no page-size cap.** The contract published `maximum: 100` and the
  server enforced nothing, so Spring's default of **2000** applied to an endpoint shipped in slice 2.
  Fixed globally via `spring.data.web.pageable.max-page-size`.
- **`GET /reels` accepted a sort it never offered.** Spring binds a `Pageable`'s sort from the query
  string regardless, then appends it to the derived query - an unknown property is a **500 any
  anonymous caller could trigger by guessing**. Since sorting is not offered, the fix is to page
  without a sort, not to whitelist one.

### Review triage

`security-reviewer`: APPROVED WITH MINOR FIXES, 0 blocking, 0 critical.
- **Rate limiting on `POST /cities/waitlist` - still deferred, deliberately (5th time).** The
  enumeration concern is unfounded: the endpoint answers 201 whether or not the row already existed,
  so nothing is learned by probing. The junk-fill concern is real but the blast radius is rows in a
  low-value table. **Named tripwire:** the day this endpoint sends an SMS or email, it stops being a
  junk-row risk and becomes an SMS-bombing vector - rate limiting is a prerequisite of that change,
  not of this one. Owner: platform, at launch-marketing time.
- **Leading-wildcard `LIKE` in `SocietySpecs`** - closed as documented-not-now. 28 rows today; the
  `pg_trgm` trigger condition (the ~320k RERA bulk import) is already recorded in-code and is not
  scheduled.
- **DB length CHECKs on `city_waitlist`** - **applied** in V15. Cheap, and it is the slice-3 lesson
  again: a rule that lives only in the application holds only while every writer remembers it.

`code-reviewer`: 1 CRITICAL + 2 HIGH claimed. **Two of the three did not survive verification** -
recorded here because "a reviewer said so" is not evidence:
- CRITICAL (`ReelResponse.locality` documented as a slug when it is a display label) - **real, fixed.**
  A doc that contradicts the entity is a trap for the next reader.
- HIGH (division-by-zero on `avgRating`) - **fabricated.** There is no `divide` anywhere in
  `catalog`; `avgRating` is a literal `null` per D7.5. The reviewer said outright that it had not
  read `SocietyService` and reasoned from the mapper signature.
- HIGH (MapStruct would "silently rebind" `listingCount` to a future `City.getListingCount()`,
  defeating D7.2) - **disproven empirically.** I added exactly that getter and compiled: the
  generated `CityMapperImpl` still emits `listingCount1 = listingCount`, binding the **parameter**.
  A whole-parameter match wins over an entity property; the safeguard holds.
- MEDIUM (document why `fee`/`reel` have no service layer) - already documented on `FeeController`.
- Accepted: added the missing **locality detail counter-staleness test**, poisoning the stored column
  with 999 so a pass cannot be a coincidence (column = 999, no predicate = 2, correct = 1).

### Known-empty by design

`LocalityDetail.about/connectivity/highlights/priceTrends` are empty in every seeded row;
`SocietyDetail.reviews` is always `[]` and `avgRating` `null` until the Engagement slice decides
whether a society review keys on the society id or its slug - `reviews.target_id` is untyped `text`,
and an aggregate against a guessed key would look authoritative while being silently wrong.

### Open, carried forward

- Reels' `locality` column holds display names, not slugs. The filter is case-insensitive so either
  works today; nothing has decided which the frontend will send. Owner: frontend integration slice.
- `GET /reels` declares `page`/`size` yet returns a bare array. Ruled correct for an infinite-scroll
  feed (bounded input, no total count needed) rather than a spec bug.


---

## RESULTS - pagination pass + OTP rate limiting (post-slice-7 hardening)

**305 tests, 0 failures, BUILD SUCCESS** (was 300).

### 1. OTP send rate limiting - DONE (`rl-otp-send`)
`POST /auth/login` already declared `429` in the contract - the only 429 in the whole spec - and
nothing implemented it. Unauthenticated, one SMS dispatched per call, recipient chosen by the
caller: a harassment vector and a direct cost drain. This is exactly the tripwire named in the
slice-7 RESULTS, and it had already fired on an endpoint that pass had not checked.

- State lives in `otp_codes` itself - a row per send already exists, so **no new table, cache or
  infra**, and the limit stays correct across restarts and across nodes.
- One query answers both questions: `recent.get(0)` gives the 60s cooldown; a full page of
  `MAX_SENDS_PER_WINDOW` (5/hour) means the budget is spent and its *oldest* row says when a slot
  reopens.
- Keyed on the **mobile, not the caller** - the number is what gets harassed and billed, and it is
  the one thing an attacker cannot rotate while still attacking a chosen victim.
- The 429 is byte-identical whether or not the number has an account, so it is useless as a
  registration oracle.
- Deliberately ignores `consumed`/`expiresAt`: it counts *sends*. Filtering those would let an
  attacker reset their own budget by verifying.
- Residual risk recorded on `SmsOtpSender`, where whoever wires a real gateway must read it:
  per-recipient limiting cannot stop **number rotation** draining SMS spend. That fix belongs at the
  edge (gateway spend cap + LB/WAF per-IP), because an in-app IP limiter without a trusted-proxy
  config either throttles everyone behind the balancer as one IP, or throttles a forgeable header.
- 3 tests: cooldown 429 with `Retry-After` asserted in `1..cooldown`; hourly budget with backdated
  rows; and **per-number isolation** - a guard against a future "simplification" to a global counter,
  which would turn the limiter itself into a platform-wide DoS.

### 2. Which collections get paged - documented as api-standards.md 5.1
The audit found 3 of 23 list controllers paged and 20 returning bare `List`; the spec had 9
`PageEnvelope` operations and 42 bare arrays. The instinct was "page all 42" - wrong.

**The rule the spec was already following, unwritten:** paginate when size grows with **the
platform**; return an array when it grows with **one user's own activity**, or is fixed reference
data. The 9 paged operations are exactly the platform-scale ones.

Two corrections shrank the work from 42 endpoints to ~12:
- The **public surface was already bounded** - `/properties` paged, `featured` capped at 12,
  `/societies` and `/reels` paged, the rest small reference tables. The dangerous class was closed.
- The real drift was elsewhere: `frontend/src/components/ui/Table.jsx` paginates **client-side** -
  it slices a full array and renders `Showing X-Y of {rows.length}`. Nineteen screens use it and
  **every one is admin/ops**. The product had already decided those lists are paginated; the mock
  made server paging unnecessary, so the contract never carried the intent to the wire. A
  client-side pager is a smell, not a solution.

### 3. The three ledgers - DONE (`pg-ledger-bound`)
`listTransactions`, `myRentPayments`, `rentLedger` are the endpoints the rule actually condemned,
and the reason 5.1 exists: they sit under `/me/` and so *look* personal and bounded, but they grow
on a **schedule** - a 5-year tenancy is 60+ rows nobody culls, and an owner's ledger spans every
tenancy on every listing they have ever let. **Scope is not the test; growth is.**

- Spec first (S25): `type: array` -> `allOf[PageEnvelope, {content}]`, plus `Page`/`Size`.
  Re-validated at 141 paths / 117 schemas / 177 ops / 0 dangling refs.
- **No `Sort` parameter** on any of the three: the order is fixed server-side (`date desc,
  createdAt desc` / `dueDate desc, createdAt desc`) and index-backed by `idx_transactions_property`
  and `idx_rent_payments_tenancy`. Each controller strips the bound `Pageable`'s sort through a
  private `unsorted(...)`, because Spring binds `?sort=` whether or not the endpoint offers it, and
  an unknown property reaches the query as a **500 any caller can trigger**.
- Repositories take `Pageable` with an **explicit `countQuery`** - all three are multi-root JPQL
  joins where a derived count is not safe to assume.
- **No frontend change was needed.** There is no HTTP finance/rent provider yet
  (`services/providers/http/` holds only `property` and `auth`); the mock providers read
  `localStorage` and never touch the wire. Recorded so it is not rediscovered: **when the
  finance/rent HTTP provider is written it must read `.content`**, matching `propertyProvider`.
- 2 new tests, each asserting the envelope *and* that `size=100000` is clamped to 100, *and* that a
  hostile `?sort=nosuchfield` is ignored rather than 500-ing.

### Still open, consciously
- `pg-cap-tests` - `/properties` and `/me/listings` still have no page-size clamp test (`/societies`
  and `/reels` do). Low risk: the clamp is global config, now covered on 4 endpoints.
- `pg-reels-shape` - `/reels` declares `page`/`size` but returns an array. **Closed as correct:** it
  feeds an infinite-scroll reel feed, where a client wants a bounded window without a total.
- `rl-waitlist` - `POST /cities/waitlist` is still unlimited. It has no `429` in the spec, so
  limiting it needs a spec change first; the row is cheap and behind a UNIQUE constraint. Deferred
  with the same edge-layer owner as the SMS rotation risk above.
- The ~9 remaining 5.1 violations (admin arrays, `/notifications`, `/messages`,
  `/properties/{id}/reviews`) are **not implemented yet** - they get paged when their slice lands,
  now that 5.1 says so.


# ==========================================================================
# Slice 8 - Engagement (retention loop + trust surface)
# ==========================================================================

Scope confirmed with user: **18 endpoints**. Share-flat (3) deferred to its own slice --
`share_flat_posts` + the contract's 3 operations model ONE of the three collections the
ShareFlat UI actually uses (`requests`, `rooms`, `groups`, plus interests, prefs and
anti-fraud host eligibility in `lib/data/shareFlat.js`). Building the 3 spec endpoints would
produce something the page cannot consume. Ship nothing rather than ship unusable.

## Why this slice, now
The core funnel (search -> contact -> visit -> offer -> deal -> rent) is built across slices
1-7. What is missing is the loop that brings a user BACK: shortlist, saved-search alerts,
notifications. `senior-product-manager-realestate` names exactly these as the retention
metrics ("saved searches, alert opt-ins, repeat sessions"). Everything else left in the spec
(Services & Support 22, Moderation 20, Billing 14, Admin 14) is back-office.

Starting point measured, not assumed: 45 of 177 spec operations implemented; `saved_properties`,
`saved_searches`, `notifications`, `reviews`, `society_follows` and the four CMS tables all
already exist (V1-V15) with their indexes.

## Design decisions - rulings

**D8.1 - Property reviews and entity reviews are two resources, not aliases.** RESOLVED BY THE
CONTRACT, not by me: `/reviews/{entityType}/{entityId}` declares `enum: [society, locality,
owner]`, which is *disjoint* from `/properties/{propId}/reviews`. One `reviews` table
(`target_type`/`target_id`), one service, two controllers. No ambiguity to invent.

**D8.2 - The anti-fake-review rule moves server-side. This is the trust core of the slice.**
Today it lives in the browser: `ReviewsSection.jsx:48`
`eligible = isIn && !isOwner && (hasCompletedVisit(owner, p.id) || hasTenancy)`.
A rule enforced only in the client is not a rule. Server-side:
  - a caller may review a property only with a **completed visit** or a **tenancy** on it;
  - the **owner may never** review their own listing;
  - violation is a typed 422, never a 500.
Applies to PROPERTY reviews only. The mock gates entity (society/locality/owner) reviews on
login alone, and there is no visit/tenancy concept for a locality - so entity reviews stay
login-gated. That asymmetry is deliberate; record it so a reviewer does not "fix" it.

**D8.3 - `context` is DERIVED server-side, then STORED.** `context` drives the
"Verified resident" / "Visited" badge (`ReviewsSection.jsx:129`). It must never be accepted
from the client or the badge is forgeable by anyone who can POST. But it is also not a pure
read-time derivation: a review is a *historical statement*, and a tenancy that later ends must
not silently downgrade an old review's badge or make it vanish from the `tenant` filter. So:
compute at write time from visits/tenancies, persist, never trust input.
  `tenant` if a tenancy exists (past or present), else `visit`.

**D8.4 - `categories` as JSONB, `recommend` as a nullable column, both new in V16.** The UI
renders five sub-ratings (`locality, condition, value, owner, accuracy` - `RV_CATS`) and a
`recommend` boolean; the `reviews` table and the contract carry neither. JSONB for categories
because the UI already treats them as a *sparse* map (`r.categories?.[k]`, `.filter(Boolean)`)
and because `saved_searches.filters` and the property arrays set the house precedent. Guard
against it becoming a junk drawer: validate keys against a feature-owned vocabulary constant
(§7.1) and the values against 1-5, server-side. `recommend` is nullable because the UI
distinguishes "did not say" from "would not recommend" (`r.recommend != null`).

**D8.5 - UNIQUE (author_id, target_type, target_id) - a constraint, not a service check.**
Nothing today stops one user posting fifty reviews on one property and destroying its average.
The slice-3 V9 lesson: enforce with the database. Partial (`WHERE author_id IS NOT NULL`) so
seeded/anonymous rows are unaffected.

**D8.6 - Pagination, per the api-standards.md §5.1 rule written last session.**
  - `/notifications` -> **paged**. Grows with time, forever, per user, culled by nothing.
  - `/reviews/{entityType}/{entityId}` -> **paged**. A popular locality's reviews are bounded by
    the whole city's user base.
  - `/properties/{propId}/reviews` -> **stays a bare array.** Not laziness: D8.2 + D8.5 make it
    *structurally* bounded - only users with a completed visit or tenancy may review, and each
    may review once. The bound is an invariant, not a hope. This also keeps the UI's
    client-side summary (avg, 5-bar distribution, per-category averages, recommend%) working
    with zero spec surgery, which paging would have broken.
  - `/me/saved`, `/me/saved-searches`, CMS lists -> bare arrays. Self-limiting personal
    activity / fixed reference data. §5.1 says array; this is the rule agreeing with itself.

**D8.7 - The society rating aggregate fills a seam slice 7 deliberately left.**
`SocietyDetailResponse` documents `avgRating`/`reviewCount` as "null until the Engagement slice
owns reviews". So the aggregate has a home already: no new endpoint, no envelope surgery. Fill
it from `reviews` where `target_type='society'`. Computed in SQL, never a stored counter -
the slice-7 `City.listing_count` ruling.

**D8.8 - `saved_searches.new_count`: serve the stored column; it stays 0.** This looks like the
slice-7 stored-counter trap but resolves the OTHER way, and the contrast is the point. In slice
7 the true value was cheaply computable, so the stored column was ignored. Here "new matches
since last viewed" needs (a) a `last_viewed_at` column that does not exist and (b) executing
every saved search on every list read - an N+1 of *searches*. The alerting job that would
maintain it does not exist (there is no scheduler in this codebase). So: return the column,
document that nothing writes it, name the alert job as its owner. Mock parity holds - the mock
also stores `newCount: 0` and never increments it.

**D8.9 - Hard delete for `saved_properties` and `society_follows`.** Both are PK(user_id, x)
join tables with no `archived` column. The no-hard-delete guardrail exists to protect business
and audit history - money, deals, listings. A shortlist toggle is a *preference*, not a
record; tombstones would break PK dedupe and make every re-save an UPDATE. Recorded here so a
reviewer does not flag it as a guardrail breach.

**D8.10 - Idempotency via `ON CONFLICT DO NOTHING`, not a caught exception.** `PUT /me/saved/{id}`
and `PUT .../follow` are idempotent by primary key. Catching `DataIntegrityViolationException`
around `save()` inside `@Transactional` marks the transaction rollback-only (slice-7 lesson).
DELETE returns 204 whether or not a row existed - that is what idempotent means.

## Mock <-> spec reconciliation log (spec is SSOT; UI must not break)

| # | Mock (ground truth) | Contract | Ruling |
|---|---|---|---|
| R1 | `getSavedProps()` -> bare **array of ids**, page resolves via `getPropertiesByIds()` | `GET /me/saved` -> `PropertySummary[]` | Contract wins - the server does the join. UI already renders `PropertySummary` since slice 2. |
| R2 | Notification `desc`, `kind`, `at` | `body`, `type`, `createdAt` | Contract wins; mapper renames. |
| R3 | `dismissNotif(id)` | **no endpoint** | Client-only, consistent with the `pendingContactCount` / `pendingOfferCount` rulings. Not a spec addition. |
| R4 | SavedSearch `at`, `label`, `alerts` (**boolean**) | `createdAt`, `name`, `alertFrequency` (**4-value enum**) | Contract wins. `true` -> `daily` (the schema default), `false` -> `off`. |
| R5 | Review `text`, `user`, `at` | `body`, `author`, `createdAt` | Contract wins; mapper renames. |
| R6 | Review `context`, `categories{5}`, `recommend` | **absent from the contract** | **Spec fix S26** - the UI renders all three; a contract that cannot express them is the defect. Fix spec first, then V16, then code. |
| R7 | Contract `Review.title` | mock never renders it | Keep. Contract is law; an unused optional field harms nothing. |
| R8 | Followed societies at a **global** localStorage key, shared by every user on the device | per-user by construction | Server fixes a real bug for free. |
| R9 | `getNotifPrefs()` - email/sms/whatsapp/matchAlerts/quietHours/language | no table, no contract | **Out of scope.** Recorded, not silently dropped. |
| R10 | `entityRating(type,id)` -> `{avg,count}` computed client-side | no aggregate endpoint | Served by the *detail* endpoints (D8.7), not a new operation. |

## Spec fixes required before code (SSOT first)
- [ ] S26 - `Review`: add `context` (enum visit|tenant, **readOnly**), `categories` (object,
      5 named 1-5 ints), `recommend` (boolean, nullable). `ReviewCreate`: add `categories` and
      `recommend` only - **`context` must NOT be settable** (that is the forgery vector).
- [ ] S27 - `/notifications` and `/reviews/{entityType}/{entityId}` -> `PageEnvelope` + Page/Size
      params (D8.6). No `Sort` - order is fixed server-side and index-backed.
- [ ] Re-validate: expect 141 paths / 177 ops / 0 dangling refs.

## Migration V16
- [ ] `reviews`: `+ context text CHECK (context IN ('visit','tenant'))`,
      `+ categories jsonb NOT NULL DEFAULT '{}'::jsonb`, `+ recommend boolean`
- [ ] `CREATE UNIQUE INDEX ... ON reviews (author_id, target_type, target_id) WHERE author_id IS NOT NULL` (D8.5)
- [ ] `CREATE INDEX ... ON reviews (target_type, target_id, created_at DESC)` - backs the paged
      entity-review read (§5 requires every sort be index-backed)
- [ ] Length CHECKs mirroring the DTO `@Size` bounds, with the `-- mirrors @Size(max=...)` sync
      comment (the slice-7 habit)

## Build order (each sub-slice green before the next)
- [x] **8a - Saved properties** (3): `GET /me/saved`, `PUT|DELETE /me/saved/{propId}`.
      Entity w/ composite key, `ON CONFLICT DO NOTHING`, join to `PropertySummary`, N+1-safe.
- [x] **8b - Society follow** (2): `PUT|DELETE /me/societies/{slug}/follow`. Slug -> id resolve,
      404 on unknown slug. Also fills `Society.followedByMe` if that seam exists.
- [x] **8c - Saved searches** (3): `GET|POST /me/saved-searches`, `DELETE .../{id}`.
      404 (never 403) on someone else's id - the /me/** rule from slice 3 onward.
- [x] **8d - Notifications** (2): `GET /notifications` (paged), `POST /notifications/read`.
      Empty/absent body = mark ALL read (mock's `markAllNotifsRead`); `{ids:[...]}` = those only,
      **scoped to the caller** - marking another user's notification read must be impossible.
- [x] **8e - Reviews** (4) - the meat. V16 + S26 first. Eligibility (D8.2), derived `context`
      (D8.3), validated `categories` (D8.4), UNIQUE (D8.5), paged entity list (D8.6).
- [x] **8f - CMS lists** (4): `/announcements`, `/banners`, `/faqs`, `/services`. Public reads
      filtering `archived = false`; announcements additionally windowed by `starts_at`/`ends_at`
      and `active`. Same shape as slice 7's catalog reads.
- [x] **8g - Society aggregate** (D8.7): fill `avgRating`/`reviewCount` on society detail.

## Invariants, each with a test
- [x] Only the author's own saved list / saved searches / notifications are ever returned.
- [x] A stranger's saved-search id -> **404, not 403**.
- [x] `PUT /me/saved/{id}` twice -> 204 both times, exactly one row.
- [x] `DELETE` of something never saved -> 204, not 404.
- [x] `POST /notifications/read {ids:[someone else's]}` -> that row stays unread.
- [x] Review by a user with no visit and no tenancy -> **422**, not 500, not 201.
- [x] Review by the listing owner on their own property -> 422.
- [x] Client-supplied `context: 'tenant'` is **ignored** - the badge is server-derived.
- [x] Second review by the same author on the same target -> rejected by the UNIQUE index.
- [x] A `categories` key outside the 5-value vocabulary, or a value outside 1-5 -> 422.
- [x] Unknown society slug on follow -> 404.
- [x] Paged endpoints clamp `size` and ignore a hostile `?sort=` (the ledger lesson).
- [x] CMS reads exclude `archived` rows; an out-of-window announcement is not returned.
- [x] Route-constant / security-matcher agreement, as every slice.

## Explicitly out of scope (recorded, not dropped)
- Share-flat (3 ops) - deferred, reason above.
- Notification preferences (R9) - no table, no contract.
- The saved-search **alerting job** that would write `new_count` (D8.8) - needs a scheduler.
- `reviews` has no `archived` column and no delete endpoint in scope; if review moderation
  lands (Moderation slice owns `reports`), it will need one.


---

# RESULTS — Slice 8 (Engagement) — SHIPPED, test-green

**18 operations** across saved properties, society follows, saved searches, notifications, reviews
and the public CMS, plus the society rating aggregate. Suite **343 → 373 tests, all green**, booting
against the live Flyway'd Postgres under `ddl-auto=validate`.

## What shipped

| Sub-slice | Ops | Notes |
|---|---|---|
| 8a saved properties | 3 | `ON CONFLICT DO NOTHING`; saved-order preserved across the batch fetch |
| 8b society follow | 2 | slug → id resolve, 404 on unknown slug |
| 8c saved searches | 3 | 404 (never 403) on another user's id |
| 8d notifications | 2 | paged; empty/absent body = mark all read |
| 8e reviews | 4 | the trust core — eligibility, derived badge, one-per-author |
| 8f CMS lists | 4 | public, `archived = false`, announcements window-filtered |
| 8g society aggregate | — | real `avgRating` / `reviewCount` via a kernel port |

## Migrations

- **V16** — `reviews.context` / `categories` / `recommend`; `idx_reviews_author_target` (partial
  UNIQUE); `idx_reviews_target_created`; `idx_notifications_user_created`; length CHECKs.
- **V17** — `idx_saved_searches_user_created`, `idx_saved_properties_user_created` (review
  follow-up; see "Index audit" below).

## Spec fixes

- **S26** — `Review` gained `context` (enum visit|tenant, `readOnly`), `categories` (5 named 1–5
  ints, `additionalProperties: false`), `recommend`. `ReviewCreate` gained `categories` and
  `recommend` but deliberately **not** `context`: a trust badge the caller can set is not a badge.
- **S27** — `GET /notifications` and `GET /reviews/{entityType}/{entityId}` converted from bare
  arrays to `PageEnvelope`. Validated: 141 paths / 117 schemas / 177 ops / 0 dangling refs.

## The two architectural decisions worth remembering

**1. Two kernel ports, because the layering said no.** `ArchitectureBoundaryTest` ranks contexts
(`content`/`identity` 0, `catalog` 1, `leads`/`engagement` 2, `finance` 3, `deals` 4) and fails the
build on an upward import. Reviews need visit facts (deals=4) and tenancy facts (finance=3) from
engagement=2 — both upward. Then 8g needed the reverse: `catalog` (1) needs review aggregates from
`engagement` (2).

The tempting workaround was native SQL — the boundary test matches source text for
`com.punenest.api.<context>.`, so a query string naming another context's *tables* passes it
silently. That was rejected: it would evade the test while coupling to another context's schema,
which is strictly worse than importing its API. Instead, two ports on the `common.trust` kernel,
following the existing `ContactGate` inversion:

- `PropertyExperience` ← implemented by `deals.visit.PropertyExperienceService` (the only context
  that can see both visits and tenancies) ← consumed by `engagement.review`
- `RatingLookup` ← implemented by `engagement.review.SocietyRatingService` ← consumed by
  `catalog.society`

**2. Review target keys — resolves slice 7's open question.** Accept whatever public id the client
holds; store the schema's canonical key. Society → **UUID** (immutable: a rename cannot orphan
reviews). Locality → **slug** (`localities.slug` *is* the primary key). Owner → user UUID. Property
→ property UUID. Societies stay addressable by slug or id (slug lookup falls through to id).
Recorded in `ReviewTargetKey`'s Javadoc.

Corollary: a malformed UUID is a **404, not a 400** — a 400 lets an attacker distinguish "wrong
shape" from "right shape, no such row".

## Review pass — findings and disposition

Three reviewers ran. Every claim was re-verified against the actual source before acting (two of
three reviewer claims were fabricated in an earlier slice, so this is now standing practice). Two
reviewer findings were rejected on inspection; one bug the reviewers missed was found by hand.

### Fixed

1. **`alertFrequency` / `channel` were a user-triggerable 500.** Both were passed straight through
   to columns carrying V8 CHECK constraints. `{"alertFrequency":"hourly"}` became a Postgres
   constraint violation and surfaced as a 500 — any authenticated caller, one typo.
   Fixed with `AlertFrequencies` / `AlertChannels` vocabulary constants + `@Pattern` per §7.1.
   *Tests: invalid frequency → 422, invalid channel → 422, and all 12 legal combinations accepted
   (a pattern that is too tight is the same bug wearing a different hat).*

2. **Two more unbacked sorts (V17).** V16 had already caught `idx_notifications_user (user_id,
   read, created_at DESC)` not backing `WHERE user_id=? ORDER BY created_at DESC` — `read` sits
   mid-key. An audit of the rest of the slice-8 read surface found the same defect twice more:
   `saved_searches` (index on `user_id` alone) and `saved_properties` (PK `(user_id, property_id)`
   does not contain `created_at` at all). Both are per-user tables that grow without bound.
   *Deliberately not indexed: `announcements`, `banners`, `cms_services`, `faqs` — editor-curated,
   a few dozen rows, read whole. The planner would ignore an index. The distinction that matters is
   bounded-by-an-editor vs bounded-by-user-growth, and it is recorded in V17's header.*

3. **`POST /notifications/read` with a malformed id was a 500 — and the naive fix was worse.**
   Raw `UUID.fromString` throws `IllegalArgumentException`, which the global handler can only
   render as a 500. But *skipping* unparseable ids would have been a genuine escalation: an
   all-garbage list arrives **empty**, and an empty list is the signal for "mark **all** read" — so
   a client typo would silently clear the entire inbox. Fixed with an explicit 400.
   *Found by hand; no reviewer flagged it. Test asserts both the 400 and that the inbox stayed
   unread.*

4. **`filters` JSONB was unbounded.** Typed `Object` to match the contract, so Bean Validation has
   nothing to hang a `@Size` on and the column is unbounded `jsonb`. An authenticated caller could
   store a multi-megabyte document per saved search, unbounded in count, re-serialized into the
   response on every list read. Bounded at 8 KB serialized — far beyond any genuine facet set.

5. **`Pageables.unsorted()` extracted to `common.web`.** Four byte-identical private copies had
   accumulated (notifications, entity reviews, finances, rent). Not cosmetic: this helper is what
   stops `?sort=anything` reaching the query as a 500, and on the public review route that is a 500
   *anyone* can trigger. One copy, one place to fix it, and the next paged endpoint inherits it.

6. **Two over-broad repository supertypes narrowed.** `SavedPropertyRepository` and
   `SocietyFollowRepository` extended `JpaRepository<Property|Society, UUID>` for join tables that
   have no entity — publishing `findAll()` and `delete()` methods that silently operate on the
   *properties* / *societies* tables. Narrowed to the bare `Repository` marker;
   `SavedPropertyService` now injects `PropertyRepository` directly for the lookups it genuinely
   needs. Each type now means one thing.

### Closed with a reason, not fixed

7. **"Reviews bypass moderation" (security-reviewer, MEDIUM) — closed: this is the product
   decision, and it is now written where the decision lives.** Every review is written
   `published`; `pending`/`rejected` exist in the vocabulary and schema but nothing writes them.
   Pre-moderation would mean an author posts a review and cannot see it, which reads as a bug and
   suppresses honest reviews far more effectively than dishonest ones. The defence here is the
   **eligibility bar**, not a queue: to plant a review you must first hold a tenancy or complete a
   visit on that specific property — expensive per fake review in a way that creating an account is
   not. Rationale added to `ReviewService`'s Javadoc rather than left in a task file.
   **Owner: the Moderation slice**, which must also add the `archived` column reviews still lack.
   Until it lands, a bad review can only be removed in the database. *This is the one open risk
   this slice knowingly accepts.*

### Rejected on inspection

8. **"`findAllById` loses the saved order"** — my own suspicion, not a reviewer's. Wrong: the
   service already rebuilds the order from the id list via a `LinkedHashMap`
   (`SavedPropertyService:44–51`). Checked before changing anything.

9. **"`ReviewResponse.categories` is `{}` vs null contract drift"** (code-reviewer) — the reviewer
   retracted this mid-report after reading the Javadoc. Empty-not-null is deliberate so the client
   can iterate without a guard. No change.

### Verified clean (so the next reader need not re-check)

Forged `context` (no field on the DTO, no Jackson creator/alias, always overwritten server-side) ·
eligibility guard ordering on both controllers · service check and UNIQUE index agree on the same
three columns · `/me/**` caller-scoping and 404-not-403 across all four surfaces · marking another
user's notification read is a no-op (`WHERE n.userId = :userId AND n.id IN :ids`) · `categories`
closed 5-key vocabulary and 1–5 range enforced server-side · `permitAll` is GET-only and bound to
the same `Routes` constants the controllers use, so the POST on the same path stays authenticated ·
only `status='published'` reaches every public read *including the rating aggregate* · all native
SQL uses bound params (the one JPQL concatenation is a compile-time constant) · no mobile, email or
author UUID in a public review response.

## Open items carried forward

| Item | Owner | Why not now |
|---|---|---|
| Review moderation queue + `archived` column | Moderation slice | See #7 — post-moderation is the deliberate MVP posture |
| Share-flat (3 ops) | later Engagement work | deferred at plan time |
| Notification preferences (R9) | — | no table, no contract |
| Saved-search alerting job writing `new_count` (D8.8) | — | needs a scheduler; served as stored (0), matching the mock |
| Cap on saved-searches **count** per user | — | the blob is now bounded (#4); a count cap is a new product rule, not a bug fix |

<!-- above: feature/backend-integration | below: feature/ui-mobile-improvements -->

---

## Rename: "Share Flat" -> "Flatmates" (DONE)

Product-wide rename of the flat-sharing feature. Functionality unchanged; only names,
copy, files, routes and identifiers moved. Driven by a reviewed 119-entry replacement
map (session `files/rename-map.tsv`) - explicit tokens only, no blanket `share` ->
`flatmate` rule, so social sharing, document sharing, PG occupancy ("2-sharing"),
"your share of the rent" and society share certificates were deliberately left alone.

- [x] Route: `/flatmates` is now canonical; `/share-flat` kept as a permanent
      redirect (`App.jsx`). This is the only remaining occurrence of the old name.
- [x] Query param `?share=1` -> `?flatmate=1` on the list-property deep link.
- [x] Ops route `/ops/share-review` -> `/ops/flatmate-review`.
- [x] Files/folders renamed (52): `pages/consumer/shareflat/` -> `flatmates/`,
      `ShareFlat.jsx` -> `Flatmates.jsx`, `ShareFlatSection.jsx` ->
      `FlatmatesSection.jsx`, `lib/data/shareFlat.js` -> `flatmates.js`,
      `OpsShareReview.jsx` -> `OpsFlatmateReview.jsx`, `ShareMap`/`ShareMapGate`/
      `ShareAlertCard` -> `FlatmateMap`/`FlatmateMapGate`/`FlatmateAlertCard`,
      `useShareFlat`/`useShareSupply`/`useShareDiscovery` -> `useFlatmates`/
      `useFlatmateSupply`/`useFlatmateDiscovery`, i18n `shareflat.json` ->
      `flatmates.json` (x3), 21 e2e specs, 2 docs.
- [x] Identifiers: two request families disambiguated - seeker's own post is now
      `FlatmatePost*` (`getFlatmatePosts`, `saveFlatmatePost`, ...), the host's
      inbound queue is `FlatmateRequest*` (`getFlatmateRequests`,
      `decideFlatmateRequest`, ...). They previously differed only by the word "Flat".
- [x] localStorage keys `puneNestShare*` -> `puneNestFlatmate*`.
- [x] i18n root key `shareFlat` -> `flatmates`; copy translated in en, hi and mr
      (Devanagari product-name strings were rewritten too, not just the English).
- [x] Backend OpenAPI: `/share-flat/posts` -> `/flatmates/posts`, `ShareFlatPost`
      -> `FlatmatePost`, operationIds updated.
- [x] Docs re-synced (`docs/flows/consumer/flatmates.md`, feature review, data-model,
      coverage matrix, e2e COVERAGE.md).

### Deliberately NOT renamed (judgement calls - raise if you disagree)
- [ ] Natural verb/adjective copy that is not the product name: "your share of the
      rent", "shared flats", "Share your flat & split the rent", "Sharing this flat?",
      "Flatmate / Shared".
- [ ] Internal enum values still spelled `'share'`: notification `type: 'share'`,
      Saved-page `cat: 'share'`, the notifications filter key, and `linkCls('share')`.
      Renaming these would orphan already-persisted localStorage notifications and saved
      cards for zero user-visible gain.
- [ ] PG occupancy vocabulary ("2-sharing", "3-sharing", "Shared / common", "Alone").

### Known caveat
Renaming the localStorage keys means any data a user already had under
`puneNestShare*` is not read anymore. Acceptable for the mock/prototype data layer,
but worth a migration shim if this ships to real users.

---

## Mobile-only design improvements — Phase 2 (all remaining `mobile-design-review.md` items)

Scope: every §F roadmap item not already shipped in Phase 1. Same hard constraint —
desktop (≥`lg`, or ≥`sm` where the change is layout-shape) renders identically. Every
mobile rule is either inside a `max-width` / `hover: none` media query or paired with an
explicit `sm:`/`lg:` reset.

### Systems built (consumed everywhere, never hand-tuned)
- [x] **Overlays → bottom sheets below 640px.** One `@media (max-width: 639.98px)` block on the
      shared `.pn-modal-backdrop` / `.pn-modal` classes converts all 7 consumer overlays at once
      (ContactOwner, ScheduleVisit, AadhaarVerify, OwnerConsent, Report, ServiceTracker, Review)
      with zero markup changes: bottom-docked, full-bleed, `88dvh` cap, top-rounded, grab handle,
      `pnSheetUp` entry, safe-area bottom padding. Added to `prefers-reduced-motion`.
- [x] **`components/ui/Modal.jsx`** (23 importers) does the same via base classes + `sm:` resets,
      with a flex header/scroll-body/sticky-footer so the action row survives the keyboard.
- [x] **`.reveal-on-hover`** utility under `@media (hover: none)` — kills hover-only affordances
      on touch. Fine-pointer devices never match the query.
- [x] **`.lp-step-actions`** — `position: sticky` (not `fixed`) wizard action row under
      `@media (max-width: 1023.98px)`, docked to `--pn-bottom-inset`. Sticky keeps the row in
      flow so it reserves its own space and can never cover the last field.
- [x] **`lib/imgSrcSet.js`** — `srcSetFor()` rewrites the host's `w=` param into a srcset;
      returns `undefined` for any URL it can't prove is resizable, so it is a pure enhancement.

### Per-item
- [x] **F#4 tap targets → 44px.** `Card` heart/compare, `ResultsArea` filters + view toggles,
      `DealToggle`, `MobileFilterDrawer` close, `MobileField`, `ReviewsSection` chips,
      `DocumentsSection` consent, `Signup` terms, `Saved` remove, `LocationPricingStep` deposit
      quick-picks, `PriceInsights` EMI inputs, `PhotoUploader` delete, `MapGate` chips + inline
      links, smart-search inline icons. All `base + sm:` reset.
- [x] **F#5 wizard.** Sticky action row on all 6 steps; camera-capture "Take photo"; address
      `autoComplete` tokens (`address-line1..3`, `postal-code`, `organization`); owner-consent
      mobile → `type="tel"` + `autoComplete="tel-national"`.
      Scroll-to-first-error was **already implemented** (`list-property/validation.js`).
- [x] **F#9 listings filters.** Floating `Filters · N` pill in the thumb arc, docked to
      `--pn-bottom-inset`, `lg:hidden`. The old in-bar `filtersBtn` was `lg:hidden` too, so it
      was **deleted** — one control per width instead of two identical ones.
- [x] **F#12 gallery.** Full-bleed 4:3 mobile hero (`-mx-4 sm:mx-0`), arrows `hidden sm:flex`,
      tappable dot rail replacing the desktop thumbnail strip, `fetchPriority="high"` on the hero.
- [x] **F#13 responsive images.** `srcSet` + `sizes` on listing cards and featured cards.
- [x] **F#14 hover / `title=` sweep.** `CompareToggleBar`'s 4 icon-only controls had `title=` as
      their **only** label — invisible on touch; now `aria-label` (+ `aria-pressed` on toggles).
      Also `ResultsArea` view toggles, `ListingCard`, `InteriorRenovation`.
- [x] **F#16 Saved.** Horizontally-scrolling 3-tab strip (third tab off-screen with no
      affordance) → 3-up grid on phones, `sm:` restores the centred wrap.
- [x] **F#20 footer accordion.** Columns 2–4 collapse below 640px via a local `FooterCol`
      mirroring `ProfileTab`'s `CollapsibleCard`; `sm:block` panel + `sm:hidden` chevron.
- [x] **F#11 progressive disclosure** — verified **already satisfied**: `PropertyTabs.jsx`
      renders exactly one section at a time.

### Bug found by the new tests (not in the review)
- [x] The Nestor FAB (`.pn-assistant-slot`) **physically intercepted taps** on the new filters
      pill — both were bottom-right. Pill moved to bottom-left. A real user could not have
      opened filters on a phone.

### Deferred, with reasons
- [ ] **F#17 service worker** — manifest shipped in Phase 1; no SW. Listing freshness is the
      trust signal in a marketplace; cache-invalidation risk outweighs the offline win.
- [ ] **F#19 swipe-to-dismiss on sheets** — the grab handle is present and sheets close via
      backdrop/X. Touch-drag gesture handling is real state machinery for a P2 win.
- [ ] **F#22 CSS split** — `index.css` is large but bundled/minified; splitting is a build-level
      change with no mobile-visible effect.
- [ ] **F#23 mobile ops back-office** — explicitly out of scope.
- [ ] **F#24 landscape sweep** — needs a fourth Playwright project; no landscape-specific
      finding is currently open.

### Verification
- [x] `npm run build` green.
- [x] `npx eslint` on all changed files — **0 errors**, 6 warnings, all pre-existing.
- [x] New spec `e2e/tests/mobile-sheets-and-actions.spec.js` (sheets, filters pill, wizard
      sticky row, gallery hero + dot rail).
- [x] New desktop non-leak assertions in `desktop-noleak-guardrails.spec.js` — overlays stay
      centred dialogs, filters pill absent, wizard actions `static`, footer chevron hidden,
      gallery thumbnails visible / dot rail hidden, saved tabs `flex` not `grid`.
- [x] **`mobile` + `mobile-small`: 84/84 passed.**
- [x] `chromium` compared against the ~58-failure pre-existing baseline.

### Test-harness fixes made along the way
- `mobile-bottom-inset.spec.js` — `clear >= 0` → `> -1`. Measured value was **-0.140625**:
  fractional layout rounding, not an overlap. Documented in the assertion.
- Duplicate-link collision (the Phase-1 failure mode) recurred: the pill's accessible name
  collided with the in-bar Filters button in `mobile-space-optimization.spec.js`. Fixed at the
  root by removing the redundant control, not by loosening the locator.

---

## Home Phase 3 — Mobile: featured-first, search-on-demand (PLAN — awaiting approval)

Mobile-only. Desktop (>= lg) untouched. Builds on Phase 1 (`--pn-bottom-inset`, BottomNav)
and Phase 2 (sheet system, 44px ramp) — no new z-index values, no hand-tuned offsets.

### The measured problem (dev server, real DOM)

| viewport | first Featured card top | screens of scroll |
|---|---|---|
| 412x915  | y=1406 | 1.5 |
| 360x640  | y=1446 | 2.3 |
| 1440x900 | y=1292 | 1.4 (desktop — unchanged) |

Mobile hero budget above the 915px fold: h1 92, sub 170 (52h), trust chips 246 (110h),
search panel 386 (286h), map row ~672, chips ~720, stats 844 (52h), ticker, hero ends 990.
The search panel alone is 286px — 31% of the first screen. And `section.hero-bg` carries
`min-h-[100dvh]`, so even emptying it cannot shrink it below one full viewport. That
min-height is the actual blocker, not the content.

### Target mobile order

Hero (h1 + one-line inventory proof + search trigger)
-> **Featured properties**
-> Trust chips + stats
-> Browse by type (Categories)
-> Societies -> Recently viewed -> Flatmates -> WhyChooseUs -> ... (unchanged)

Projected first card top: ~400px on 412x915 — one full card plus part of a second visible
without scrolling. Desktop order stays Categories -> Featured.

### Work items

- [ ] **P0-1 Release the hero height.** `section.hero-bg` `min-h-[100dvh]` -> mobile auto,
      `lg:min-h-[100dvh]` restores desktop. Verify the decorative `.shape-*` layers and the
      bottom gradient still read correctly at the shorter height.
- [ ] **P0-2 Featured above Categories on mobile via CSS `order`.** Wrap the two sections in
      `flex flex-col`; `order-1`/`order-2` below lg, `lg:order-none`. DOM order is left
      untouched, so desktop DOM + visuals + every existing desktop spec are unaffected.
      Trade-off: on mobile the screen-reader order stays Categories->Featured while the
      visual order flips. One section's divergence — see Q6.
- [ ] **P0-3 Remove the inline search panel on mobile.** `HeroSearch` gets
      `hidden lg:block`... — decision pending Q1. It stays mounted for desktop; nothing about
      its internals, its `#hero-search-input`, its combobox a11y or its sticky "I'm done" bar
      changes. Every desktop spec that drives `.hero-search-wrap`
      (`home-entity-search`, `location-recovery`, `qa-location-search`,
      `search-property-types`, `home-search-combobox`) runs in the `chromium` project at
      1440 wide and is therefore unaffected.
- [ ] **P0-4 Search sheet + bottom-nav wiring.** Reuse the Phase 2 `ui/Modal.jsx` sheet
      variant; render `HeroSearch` inside it. BottomNav's Search slot on Home opens the
      sheet instead of focusing `#hero-search-input`; on every other route it keeps
      navigating to `/listings`. BottomNav lives outside the Home tree, so the trigger uses
      the codebase's existing cross-component channel — a `window` CustomEvent, same
      pattern as the `pn:store` badge bus — rather than a new context provider.
      `aria-current` on `/listings` is unchanged; the Home trigger gets `aria-expanded`.
- [ ] **P0-5 Relocate the trust chips + stats.** `.hero-trust` (4 chips) and `.hero-stats`
      (11,240+ / verified owners / localities) move below Featured on mobile, `lg:` restores
      them to the hero. Placement rationale: the "is this real?" objection fires *after* a
      user has seen listings, not before. WhyChooseUs already covers the same ground much
      further down — duplicating there would be weaker, not stronger.
- [ ] **P0-6 Keep the inventory count in the hero.** `p.hero-sub`'s "11,240+ verified
      properties" is inventory proof, not marketing — it stays, compressed to one line on
      mobile. (`city-propagation.spec.js` asserts on `p.hero-sub`; it must keep rendering.)
- [ ] **P1-7 Fix eager loading of the first Featured image.** `Featured.jsx:40` sets
      `loading="lazy"` on every card. Once card 1 is above the fold that is actively
      harmful — it delays the one image the 3-second rule depends on. First card ->
      `loading="eager"` + `fetchPriority="high"`, rest stay lazy.
- [ ] **P1-8 Trim the skeleton on mobile.** `featuredProperties(6)` renders 6 skeleton cards
      while loading. Above the fold that is a wall of grey. Show 2 on mobile, 6 at `sm:`.
- [ ] **P1-9 Move "Explore properties on map" + the popular/recent chip row into the search
      sheet** on mobile — they are query starters and a search modality, meaningless
      detached from the search context. `lg:` keeps them in the hero. See Q4.
- [ ] **P2-10 i18n** for any new label in `en`, `hi`, `mr`. 44px minimum on the search
      trigger and every new control.

### Verification
- [ ] Update `mobile-bottom-nav.spec.js:65` — "Search on Home focuses the hero search" is
      the exact behaviour being replaced; it becomes "opens the search sheet".
- [ ] New mobile assertions: first `.property-card` top < viewport height on 412x915 **and**
      360x640; `.hero-search-wrap` not visible on Home; sheet opens from the Search slot and
      still runs a real search; trust chips render below Featured.
- [ ] New desktop assertions in `desktop-noleak-guardrails.spec.js`: inline search panel
      present, Categories before Featured visually, chips in the hero, hero >= 100dvh.
- [ ] Run `mobile`, `mobile-small`, `chromium`. Baseline: 84/84 mobile green; ~58
      pre-existing `chromium` failures (`list-property-*`, map/geocode, `auth-*`) — flag
      only NEW ones.

### Open questions — need your call before I write code

- **Q1 (the big one). Does a slim search trigger stay in the hero?** Your ask was to remove
  the panel and reach search only from the bottom nav. My recommendation is to remove the
  286px *panel* but keep a single-row search *pill* (~56px, looks like a field, is a button)
  that opens the same sheet. Reason: a property site with no visible search box on home
  reads as broken to a first-time visitor, and the bottom-nav magnifier is an unlabelled
  second-guess. It costs ~56px of the ~546px we reclaim. **Pill (recommended) / bottom-nav
  only (your literal ask)?**
- **Q2. Trust chips destination** — directly below Featured (recommended), or folded into
  the existing WhyChooseUs section further down?
- **Q3. The `.hero-stats` trio** duplicates the count already in `hero-sub`. Drop it on
  mobile entirely, or move it down with the chips (recommended)?
- **Q4. Recent searches.** For a returning visitor the recent-search chips are a strong
  one-tap re-entry hook and cost ~50px. Move them into the sheet with everything else
  (simpler), or keep that row above the fold only when recent searches exist?
- **Q5. `ActivityTicker`** (live "someone just enquired in Baner" social proof, ~60px, end of
  the hero) — keep in the mobile hero, or move below Featured with the other proof?
- **Q6. `order` a11y trade-off.** P0-2 keeps DOM order and flips visual order on mobile, so
  the mobile screen-reader order stays Categories->Featured. The alternative is to reorder
  the DOM (Featured first, correct for mobile SR) and use `lg:order-*` to restore desktop
  visuals — but that changes the desktop DOM, which your constraint 1 discourages. I
  recommend keeping the DOM as-is. Confirm?
- **Q7. Does the sheet stay Home-only this phase?** Page-by-page discipline says yes.
  Promoting it to `ConsumerLayout` so Search opens a sheet on *every* route is a bigger,
  better change — but it is a separate phase.


---

# Mobile-only design improvements — Phase 3 (cross-cutting sweep)

Source: `mobile-design-review.md` §B/§D/§F, re-audited against the tree after Phase 2.
Several review rows were already satisfied and were struck rather than re-implemented:
F#21 (h-scroll arrows already hidden on `pointer: coarse`), §B row 55 (Categories already
has an `sm:hidden` "View All"), §B row 125 and J2 (`autoComplete` tokens already present).

Desktop evidence for every item lives in `e2e/tests/desktop-noleak-guardrails.spec.js`;
mobile evidence in `e2e/tests/mobile-phase3.spec.js` and `mobile-topbar-scroll.spec.js`.

## Wave H — finish the bottom-widget stack
- [x] `FinancesTab` "Add transaction" FAB docked to `--pn-bottom-inset` and moved to the
      left, out of the Nestor FAB's corner (it was at `z-40`, under the `z-70` tab bar).
- [x] `LegalPage` "Back to top" FAB docked the same way, via an arbitrary-value Tailwind
      class so the `lg:` reset can still win. Repo-wide sweep found no other offenders.
      `ToastContext` left alone deliberately — at `z-1600` it cannot be intercepted.

## Wave P — top navbar hide-on-scroll (user-approved)
- [x] Mirrored the bottom-inset system at the top: `--pn-nav-h` / `--pn-top-inset`, a
      `.pn-topbar` transform and a `.pn-nav-hidden` root class, all inside
      `@media (max-width: 1023.98px)` so the class is inert on desktop.
- [x] Five sticky sub-headers (`Property`, `Society`, `EnquiriesPanel`, `EmiCalculator`,
      `ResultsArea`) gained `.pn-docks-under-nav` and rise with the bar.

## Wave I — pickers and control sizing
- [x] `DatePickerDialog` / `TimePickerDialog` become bottom sheets below 640px; both
      `place()` helpers bail at that width and clear their inline anchor styles first.
- [x] Select/MultiSelect sheet conversion **rejected** in favour of ramping `--control-h`
      40px -> 44px on mobile: one line lifts all 12 consumers, including every dropdown
      option, which was the actual sub-minimum target.

## Wave J — forms and keyboards
- [x] `enterKeyHint` on `MobileField`, Signin, Signup, HeroSearch, flatmate search,
      Messages search and the chat composer. Not added to textareas, where Enter inserts
      a newline and "send" would lie.

## Wave K — auth
- [x] `.pn-auth-submit` pins the Signin/Signup submit below the `lg` breakpoint so the
      software keyboard cannot bury the primary action.

## Wave L — wizard
- [x] Mobile compaction of the (already sticky) `.lp-meter`: tier icon, encouragement line
      and milestone scale hidden, padding tightened, docked to `--pn-top-inset`.
- [ ] `l2` map-pin full-screen sheet — NOT STARTED. `LocationPicker` sits inside the
      `list-property-*` cluster that has ~36 pre-existing desktop failures, so a change
      there cannot be verified against a trustworthy baseline. Needs the baseline fixed first.
- [ ] `l3` autosave draft survival across a mobile tab eviction — NOT STARTED.

## Wave M — property owner card
- [x] Profile link, WhatsApp button and tenant-badge link all clear 44px on mobile and
      drop the sub-13px interactive type, with `sm:` resets restoring desktop.

## Wave Q — touch feedback
- [x] `-webkit-tap-highlight-color: transparent` plus an explicit `:active` opacity for
      interactive elements, inside `@media (hover: none)`.

## Wave R — drag to dismiss
- [x] New `frontend/src/lib/useSwipeDismiss.js`, consumed by the shared `Modal` sheet
      (drag down) and `MobileFilterDrawer` (drag left). Pointer capture is taken on the
      first qualifying move, never on pointerdown, so taps on controls inside still work.
- [ ] `n1` swipe-to-remove on Saved — DEFERRED. Destructive-by-gesture needs an undo
      affordance to be safe, and the existing remove button already does the job.

## Declined by the user
- Signed-out Saved empty state (keep the sign-in redirect).
- Dashboard mobile hub (finish cross-cutting work first).

## Verification
- `npm run build` green; `eslint` on all changed files: 0 errors.
- `mobile` + `mobile-small`: **112 passed, 4 skipped, 0 failed**.
- `chromium` full suite: 66 failed / 856 passed. The 11 failures outside the known
  `list-property-*` / map / `auth-*` clusters were re-run against a `git stash`ed clean
  tree and failed **identically**, so there are no new desktop regressions.
- `desktop-noleak-guardrails` + `feature-flags`: 40 passed, 4 skipped.

### Two real leaks the guardrails caught (and how they were resolved)
1. `.lp-meter` was already `position: sticky` at every width — my mobile block re-declared
   it, and the redundant declaration masked that fact. Removed; the mobile block now only
   compacts.
2. A desktop assertion on `-webkit-tap-highlight-color` was dropped: Chrome computes it as
   `rgba(0, 0, 0, 0)` by default on pointer devices, so it cannot distinguish "our rule
   applied" from "browser default". The `@media (hover: none)` bound is the real guarantee.

## Phase 4 — remaining `mobile-design-review.md` items

### §F #24 — Landscape phones + dynamic type ✅ DONE

- [x] **Root cause found by measurement, not by reading the review.** A rotated phone was
      spending **31–34% of its height on chrome** (measured on the running app: 128px of a
      412px viewport, 121px of a 360px one). The cause was *not* the bottom bar — the top
      navbar's height bump keys off `min-width: 768px`, and a landscape handset is ~915px
      wide, so it was being served the **72px desktop navbar on a 412px-tall screen**.
- [x] **Bar height moved off an inline style onto the token.** `BottomNav.jsx` had
      `const NAV_H = 56` applied as `style={{ height: NAV_H }}` on every slot. An inline
      style outranks any stylesheet, so shrinking `--pn-bottom-nav-h` would have shrunk the
      bar while leaving the tabs at 56px. Replaced with `.pn-bottom-nav__tab { height:
      var(--pn-bottom-nav-h) }` — the bar's height is now genuinely token-owned, which is
      what `--pn-bottom-inset` has always reserved against.
- [x] **Landscape block** `@media (orientation: landscape) and (max-height: 500px) and
      (max-width: 1023.98px)`: `--pn-nav-h: 52px`, `--pn-bottom-nav-h: 44px`, labels hidden
      (icon-only), raised FAB drops 56→44px so it stops overhanging a shorter bar.
- [x] **Navbar height and the docking token move together.** The navbar's real height is
      `h-16 md:h-[72px]` on an inner div; `--pn-nav-h` only tells sticky sub-headers where
      to dock. Changing one alone would have slid every sub-header *under* the navbar.
      Added a `pn-topbar__row` hook and set both. Needed a two-class selector
      (`.pn-topbar .pn-topbar__row`) — measured that a one-class rule beat `h-16` at 640px
      but *lost* to `md:h-[72px]` at 915px.
- [x] **Dynamic type.** The bottom-bar label was `text-[10px]`. A px font-size is immune to
      the browser/OS font setting — that reads as "safe" because nothing ever overflows,
      but it *is* the accessibility failure. Converted to `0.625rem` (identical at default)
      so it scales, plus `nowrap` + `text-overflow: ellipsis` so it degrades gracefully.
- [x] **Fixed a latent clipping bug the new test exposed.** `leading-none` (line-height: 1)
      is shorter than the font's ascent+descent, so all five labels clipped their glyph
      extents. Invisible at 10px, obvious at 20px. Now `line-height: 1.2`.

**Results (measured, before → after)**

| Viewport | Chrome before | Chrome after | Content gained |
|---|---|---|---|
| 915×412 landscape | 128px (31%) | 96px (23%) | +33px |
| 640×360 landscape | 121px (34%) | 96px (27%) | +25px |
| 412×915 portrait | 120px (13%) | **unchanged** | — |
| 1440×900 desktop | 72px | **unchanged** | — |
| 1024×768 tablet landscape | 72px | **unchanged** | — |

**Verification**
- `npm run build` green; eslint 0 errors (4 pre-existing `Navbar.jsx` warnings at 375/438).
- New `e2e/tests/mobile-landscape.spec.js` — 7 tests × 2 projects = **14 passed**.
- 4 new desktop guardrails in `desktop-noleak-guardrails.spec.js`, each proving one guard
  of the media query independently (short-desktop, landscape-tablet, 1440×900, bar absent).
- `mobile` + `mobile-small`: **124 passed, 0 failed**.
- `chromium` guardrails + feature-flags + bottom-nav: **44 passed, 0 failed**.

**Known limitation — needs a design decision (NOT a bug to silently fix)**
- [ ] At 200% font scale the **raised centre "Post" slot** cannot fit its 56px circle plus a
      24px label inside a 56px bar (needs ~74px), so that one label is squeezed. The other
      four tabs are clean. The fix is a design call — drop the redundant text under an
      already `aria-label`led FAB, the way Instagram/YouTube do — so it is left visible at
      default type and the spec documents the exemption rather than asserting a false pass.
      **Awaiting user decision.**

### §F #17 — PWA / service worker ✅ DONE (`vite-plugin-pwa` 1.3.0, devDependency)

Decision: use `vite-plugin-pwa` rather than a hand-rolled `sw.js` — it gives update
handling and precache revisioning that would otherwise be hand-maintained. Configured in
`frontend/vite.config.js` as a named `pwaPlugin()` alongside the existing `persistPlugin()`.

- [x] **Data is never cached.** `/api/*` is `NetworkOnly` and is the *first* runtime rule, so
      no later rule can claim it; `navigateFallbackDenylist` stops a navigation to `/api/*`
      being answered with `index.html`. Matched on `url.pathname`, not a regex over the
      whole URL — a bare `/^\/api\//` never matches `http://host/api/...` and would fail
      **open**. Also covers the dev-only `/api/__persist/` endpoint by the same prefix.
      **Proven, not assumed:** fetched `/api/__persist/probe_key`, then walked every Cache
      Storage entry — `leaked: false`.
- [x] **Established now, while it is cheap.** The app is still on mock data, so there is no
      data layer to cache wrongly yet. The `/api/*` boundary is written and tested *before*
      the real backend exists, so when it lands the correct behaviour is already in place.
- [x] **Selective precache, not all 7 MB.** `globPatterns` allowlists the initial load
      graph only (9 entries, 2.45 MB). Lazy route chunks are `CacheFirst` on first use —
      safe because Vite filenames are content-hashed, so a URL can never point at different
      bytes.
- [x] **Unsplash listing photography** `CacheFirst`, capped at 80 entries / 14 days so a
      long browsing session cannot fill the device storage quota.
- [x] **`manifest: false`** — `public/manifest.webmanifest` already existed and `index.html`
      already linked it. Generating a second one would create two sources of truth.
- [x] **`registerType: 'autoUpdate'`** — the shell must never lag the deployed API contract,
      and a reload loses nothing, so update silently rather than nagging.
- [x] **`orientation: portrait-primary` → `any`** (user decision). The lock would have made
      the landscape CSS dead code for installed users — exactly the audience the PWA targets.
- [x] **`devOptions.enabled: false`** — a worker on the dev server would serve stale chunks
      after an edit and make all ~900 specs nondeterministic. Verified empirically: dev
      reports `regs: 0, controlled: false, caches: []`.

**Measured against a production build (`npm run build && npm run preview`)**

| Check | Result |
|---|---|
| SW registers + controls page | ✅ scope `/`, active, controlled |
| Precache | 9 entries, 2.45 MB |
| `/api/*` in any cache | ✅ **never** |
| Offline reload after 1 visit | ✅ h1 + bottom nav render (4.4 kB text) |
| Offline deep link to an unvisited route | ⚠️ blank — chunk was never fetched |
| Dev server service workers | ✅ 0 registrations |

**Fixed along the way:** the first offline attempt rendered a *blank white screen* — worse
than a browser offline page, because it reads as "broken app". Traced with a request-failure
log (not guesswork) to three uncached chunks. `home-*` was an oversight; `vendor-charts` and
`vendor-jspdf` turned out to be **static** imports of the entry chunk.

**Verification:** build green · new `e2e/tests/mobile-pwa.spec.js` **10/10** (both mobile
projects) · full mobile suites **149 passed, 0 failed** · desktop guardrails + chart/PDF
consumers **75 passed, 0 failed**.

**Harness lesson:** a first run showed *16 failed / 9 flaky in 14.2 min*. Cause was three
orphaned Vite dev servers (one on port 3322) all polling the tree at 300 ms — not a
regression. After killing them: **149 passed / 0 failed in 3.8 min**. Check for orphaned
servers before believing a broad, scattered failure set.

- [ ] **NEW FINDING — bundle bug, not shipped as part of this.** The entry chunk *statically*
      imports `vendor-charts` (189 KB) and `vendor-jspdf` (382 KB) through
      `services/providers/mock/financeProvider.js → lib/data/finances.js → jspdf`, and both
      are `modulepreload`ed in `index.html`. **Every mobile visitor downloads 571 KB of
      charting and PDF code before the Home page paints.** Making that provider chain lazy
      would cut first-paint payload by ~571 KB and shrink the precache from 2.45 MB to
      ~1.9 MB. Not done here: it touches the services layer and needs its own verification
      pass against the ~58–66 failure desktop baseline. Tracked as `bundle-eager-vendors`.

## Bundle — eager vendor chunks (571 KB off first paint)

- [x] **Root cause was NOT the import chain alone.** Two distinct bugs, one shared mechanism:
  `manualChunks` left shared runtime modules unassigned, so Rollup folded them into a
  vendor chunk, which then dragged that whole chunk into the entry.
  - `react/jsx-runtime` -> `vendor-charts` (189 KB). The `vendor-react` rule matched
    `react-dom`/`react-router`/`scheduler` but **not plain `react`**.
  - `vite/preload-helper` -> `vendor-jspdf` (382 KB). Not under `node_modules`, so the
    `if (!id.includes('node_modules')) return;` guard skipped it entirely.
- [x] `frontend/vite.config.js` — pin both to `vendor-react`; match `react` via
  `/node_modules\/react\//` (precise, so `react-chartjs-2` is unaffected); chart rule kept
  before the react rule.
- [x] `frontend/src/lib/data/finances.js` — `exportStatementPDF` now `async` with
  `await import('jspdf')`. This module is in the eager graph via the mock provider registry
  (`import.meta.glob(..., { eager: true })`), so a static import put jsPDF in front of first paint.
- [x] `frontend/src/components/dashboard/FinancesTab.jsx` — `doExportPDF` awaits, so the
  "PDF downloaded" toast stays truthful.
- [x] PWA precache: dropped `vendor-charts-*` / `vendor-jspdf-*` from `globPatterns`
  (they are genuinely lazy now, so precaching them would cost a real 571 KB on install).

### Measured

| Metric | Before | After |
|---|---|---|
| Entry static imports | vendor-react, vendor-charts, vendor-jspdf | **vendor-react only** |
| `modulepreload` tags in `dist/index.html` | 3 | **1** |
| charts/jspdf requested on Home | yes | **none** |
| PWA precache | 2508 KB (9 entries) | **1938 KB (7 entries)** |

### Verification
- Traced with Rollup's real module graph (`getModuleInfo` importers), not grep. After the fix
  jspdf/chart.js/react-chartjs-2 all report "reachable dynamically only".
- Offline-after-one-visit still OK against a production preview (h1 renders, 170 KB HTML).
- chromium chart/PDF specs: 88 passed, 1 flaky, **1 failed**.
- mobile + mobile-small: 142 passed, 4 skipped, **0 failed**.
- desktop-noleak-guardrails + feature-flags: 48 passed.

### Pre-existing failure (proven, not absorbed)
`dashboard-owner-finances.spec.js:59` — `getByText(/days? overdue/)` not found. Proven
pre-existing by `git stash`-ing only the three changed files and re-running: identical
failure without the changes. Date-dependent due seeding; unrelated to this work.

### Known gap — PENDING VERIFICATION
No automated guard against this regressing. `manualChunks` only applies to `vite build`, so
it is invisible to the Playwright dev-server suites. Re-check manually after dependency or
chunking changes:
`cd frontend && npm run build` then confirm `dist/index.html` has exactly one
`modulepreload` (vendor-react).

### Phase 3 (Home: featured-first, search-on-demand) � SHIPPED

- [x] Hero `min-h-[100dvh]` -> `lg:min-h-[100dvh]` (the actual blocker)
- [x] `HeroSearchPanel.jsx` extracted � one source of truth for hero + sheet
- [x] `TrustProof.jsx` � chips/stats relocated below the Featured rail on mobile
- [x] `MobileSearchSheet.jsx` � full-height portal at z-1500, opened by bottom-nav Search via `pn:open-search`
- [x] Categories/Featured reordered with CSS `order` (DOM untouched, desktop identical)
- [x] First featured image eager + 2 skeletons on phones
- [x] `HeroSearch` gained `idPrefix` so the sheet copy cannot collide with the hero's ids
- [x] i18n `home.search.sheetTitle` / `closeSheet` in en/hi/mr

Measured first `.property-card` top: 412x915 1406 -> 436; 360x640 1446 -> 436; 1440x900 1292 -> 1292 (unchanged).

Verification: mobile + mobile-small full suite 148 passed / 1 fixed flake; chromium
`desktop-noleak-guardrails` + `home-search-combobox` + `home-entity-search` + `feature-flags` 55 passed.
Full chromium suite not re-run end-to-end (~23 min, ~58 known pre-existing failures) � the
specs that could plausibly regress from this change were run and are green.

## Home � mobile vertical rhythm (done)
- [x] Hero: marketing sentence swapped for the 4 proof chips below lg ( + "hidden lg:block" +  on  + "p.hero-sub" + ).
- [x] Chips redesigned as a borderless 2x2 checklist (tinted icon disc + short label), after
      pills-scatter and ruled-panel attempts were both rejected. New  + "*Short" +  i18n keys in en/hi/mr.
- [x] Featured subtitle hidden below lg (restates the rail beneath it).
- [x] Standardised the rhythm on two tokens, mobile-only (@media max-width 639.98px):
       + "--section-gap" +  2.5rem -> 1.75rem, new  + "--section-head-gap" +  1.25rem via  + ".section-head" + .
      Replaced four ad-hoc header margins (mb-3/6/8/10) across Categories, Societies,
      RecentlyViewed, Featured, Testimonials, WhyChooseUs, FaqSection; each keeps its exact
      desktop value as a paired  + "sm:mb-*" + .  + ".section-y-m" +  pulls FaqSection's hard-coded py-16 onto
      the token. Hero pb-12 -> pb-7, CTA/Flatmates inner gaps ramped with sm: resets.
- Verified: mobile + mobile-small full suite 151 passed / 1 flaky (pre-existing touch-feedback
  cluster) / 4 skipped. chromium desktop-noleak + city-propagation + home: 31 passed, 4 skipped,
  including a new guard that desktop header gaps stay varied at 12/24/32/40px and --section-gap
  stays 2.5rem. eslint clean.

## Fix � Flatmates section rendered raw i18n keys (done)
- [x] Renamed  + "home.shareFlat" +  ->  + "home.flatmates" +  and  + "lookingToShare" +  ->  + "lookingForFlatmate" +  in
      en/hi/mr  + "home.json" + ; refreshed the badge copy that still said "Share a Flat".
- [x] Added  + "
pm run check:i18n" +  static checker + a runtime raw-key guard on Home.
- Pre-existing: introduced by the flatmates rename, not by the mobile spacing work.

## Re-sync docs + OpenAPI to the flatmates redesign & mobile-first UI (DONE)

Docs-only pass. Zero source changes; `docs/flows/**` are documented FROM React source, so they were
re-derived from the current code rather than written to a target model.

### Audit (3 parallel read-only subagents)
- [x] `docs/system/design-system.md` vs `styles/index.css` + `components/ui/*`.
- [x] OpenAPI vs the whole flatmates domain (model/hooks/data/admin/ops).
- [x] Every other `docs/flows/**` doc vs its source.

### Consumer flows
- [x] `flows/consumer/flatmates.md` - rewritten. Three tabs (Flatmates/Rooms/Groups) -> two feeds
      `move-in` / `team-up` split by "is there an address yet?"; `PostChooser` single posting entry;
      `roomKind` / `priceBasis` / `occupancy` + the flat occupancy ledger; the owner flat-split;
      `ShareIntent` (solo/bring/match) on room enquiries; the Verified pill is now the shared
      DigiLocker badge (`AadhaarVerifyModal`), not a seeker OTP; alerts, reporting, raiseHint,
      cross-tab rescue, joint-agreement reissue, vacant-home disclosure.
- [x] `list-property-wizard.md` - `share=1` -> `flatmate=1` (and it does **not** preset
      `hostRole: 'tenant'`); success screen no longer always auto-navigates; per-step flatmate
      validation is two-tier; added the `PostSuccessSplitNudge` -> `splitFlat` section.
- [x] `dashboard-owner-hub.md` - panel inventory; the unified Requests inbox + `LeadSheet`;
      My Listings type filter and the "Let room by room" / "Stop letting room by room" controls.
- [x] `saved-alerts.md` - alert tabs `move-in`/`team-up` (+ legacy aliases), `normalizeTab` on
      "View matches", Saved category `share` -> `flatmates`, swipe-to-remove with undo.
- [x] `search-listings.md` - the "Discover flatmates" pill is gone (bottom-nav slot replaced it);
      mobile filter FAB; component list.
- [x] `property-detail.md` - component list + shared ReportModal adapter; the flat-share teaser
      (`/flatmates?startGroup=1&...`); mobile sticky CTA / docked tab rail.
- [x] `rent-agreement.md` - the joint-agreement reissue entry + a new 5.8; flagged that
      `useRentAgreement.js` reads only `invite`/`listing`, so `flat` + `reissue` are **inert today**.

### Admin / ops
- [x] NEW `flows/admin/flatmates-moderation.md` - `/admin/flatmates` had no doc at all. Records the
      honest gap: rooms (now the primary Move-in supply) live in localStorage and are invisible there.
- [x] `flows/ops/service-queues.md` - four queues, not three; `/ops/flatmate-review` route + no
      TeamRoute **and** no data narrowing; new 5.3 for the flatmate verification desk.
- [x] `flows/admin/trust-safety-reports.md` - intake is the shared `components/ReportModal.jsx` with
      per-surface reason sets; `REPORT_REASONS` in `lib/data/reports.js` is now an unused export.

### System docs
- [x] `system/design-system.md` - `--control-radius` is 10px not a pill; `--control-h` ramps to 44px
      below 640px; documented the 3-tier button system; added the whole mobile-first section
      (bottom/top chrome tokens, the four sheet shells, tap-target rules, hover-is-not-an-affordance,
      sticky action rows, floating-glass bottom nav, landscape height budget, safe areas, `dvh`,
      dual-render, rhythm/type, reduced motion, Devanagari, route-scoped CSS, primitives inventory).
- [x] `system/data-model.md` - flatmate entity -> schema map split into four rows.

### OpenAPI (1.2.0 -> 1.3.0)
- [x] `FlatmatePost`/`FlatmatePostCreate` -> `FlatmateSeekerPost`/`Create` (they modelled a room, the
      store holds a seeker requirement - semantically inverted).
- [x] New: `FlatmateTab`(+`Legacy`), `RoomKind`, `PriceBasis`, `Occupancy`, `HostRole`,
      `VerificationTier`, `ShareIntent`, `FlatmateMoveIn`, `FlatmateModStatus`, `FlatmateRoom`(+Create),
      `FlatmateGroup`(+Create), `AgreementDoc`, `FlatSplitRequest`/`Result`, `FlatmateInterestCreate`,
      `FlatmateRequest`, `FlatmateReview`, `FlatmateAlertCriteria`, `GroupApplication`, `HostEligibility`.
- [x] `SavedSearch`/`Create` gain `kind`/`criteria`/`label`/`mobile` + an `sms` channel;
      `Notification.type` documents the `share`/`listing`/`service` surface tags.
- [x] 28 new/changed operations: the tab-aware `/flatmates/feed`, seeker post CRUD, rooms + groups
      supply, seats/occupants/agreement-reissue, owner consent, interest/join, the host inbox
      (`/me/flatmate-requests`), the flat split under Listings, and the ops/admin moderation desks.
- [x] Validated: 161 paths / 133 schemas / 596 refs / **0 unresolved, 0 unused**, no YAML-1.1 boolean
      enums, no new duplicate operationIds.

### Index + link hygiene
- [x] `docs/README.md` + `docs/coverage-matrix.md`: 27 -> 28 flow docs (16 consumer, 10 admin, 2 ops).
- [x] Fixed 25 **pre-existing** dead links (`system/app-architecture.md`, `system/domain-model.md`,
      `system/api-contract.md`, `flows/_TEMPLATE.md` - all deleted in earlier sessions). Link check
      across `docs/**` is now 0 broken.

### Verification
- No source files changed, so no lint/build/Playwright run is applicable to this task. Checks run:
  OpenAPI parse + ref/unused/enum/opId audit, and a full relative-link check over `docs/**`.

### Findings handed back (source-side, NOT fixed here)
- [ ] `/services/rent-agreement?flat=&reissue=1` params are never read - the CTA opens a blank wizard.
- [ ] Room `share` intent is dropped by `addFlatmateRequest`; it survives only in the chat opener.
- [ ] `occupancyOf` collapses a stored `'filling'` to `occupied` (enum is `empty|occupied` at rest).
- [ ] `AdminFlatmates` reads `rawDb()` while the consumer flows write localStorage - rooms are
      invisible to admin moderation.
- [ ] Dead artefacts: `list-property/step1/FlatmateFields.jsx` (no importers),
      `listings/QuickFilters.jsx` (empty file), `REPORT_REASONS` in `lib/data/reports.js` (no importers).
- [ ] `useFlatmateDiscovery.jsx` "Unified sizing scale" comment claims `h-9`/`rounded-xl`; the next
      line emits `h-10`/`rounded-full`.
- [ ] Spec-wide: `openapi: 3.1.0` but ~23 uses of the 3.0-only `nullable` keyword (silently ignored
      in 3.1). Fix globally or drop to 3.0.3 - do not fix only the new schemas.


## Mobile gallery rail redesign (property detail) — DONE

Fixes the dead band under the phone hero: the dot strip and the "Request more photos"
dashed slab used to stack as two rows (~90px, mostly empty).

Attempt 1 (rejected by user): merged both onto one 44px line — dots left, request pill right.
Attempt 2 (shipped): the ask became the LAST SLIDE of the carousel; dots re-centred.

- [x] `Gallery.jsx` — `ask` local state renders a `[data-photo-ask]` panel over the hero
      (`absolute inset-0 z-20 bg-ink-2`, `sm:hidden`). Reached by swiping past the last photo
      or tapping the trailing dot; only a back-swipe leaves it (terminus, never wraps).
      Kept out of `active` on purpose — `active` also indexes the lightbox and the desktop
      thumbnails, where a `count`-th value would read `gallery[count]` as undefined.
- [x] Touch handlers moved from the `<img>` to the wrapper so the ask panel is swipeable too.
- [x] Dot rail: `justify-center`, 6 photo dots + a hollow ring dot for the ask. Each dot is a
      24x44 box (WCAG 2.5.8 AA, non-overlapping centres). Desktop still `sm:hidden`.
- [x] Gap fix (round 3): the rail's 44px touch box was stacking on top of the section's own
      `mb-6`, painting ~73px of dead air between the photo and the badges. `-mb-6 sm:mb-0`
      cancels one against the other -> 18px clear above and below the dot, symmetric, targets
      unchanged, and the two boxes meet exactly (no overlap, so the badges row can't swallow
      taps aimed at the bottom of a dot). Measured 73px -> 42px.
- [x] Removed the full-width dashed mobile button; desktop thumbnail tile untouched.
- [x] New i18n keys `property.requestPhotosShort` / `requestPhotosSlideTitle` / `requestPhotosSlideSub`
      in en/hi/mr. Side effect: the mobile control no longer collides with the desktop tile under
      `getByRole(/More photos/i)` (latent strict-mode ambiguity in `photo-requests.spec.js`).
- [x] Verified by probe at 430px: swipe-in / terminus / swipe-out / trailing-dot tap all correct,
      request toast fires. 39 passed across `property-detail`, `photo-requests`,
      `desktop-noleak-guardrails`, `dashboard-action-center`.
- [ ] PENDING AGENT REVIEW — `react-reviewer` / `code-reviewer` / `/simplify` not run (agents not
      available in this session).
- [ ] Pre-existing failure (NOT caused by this change; identical before and after): `photo-requests.spec.js`
      hardcodes `OWNER_MOBILE = '9530047855'`, but P5000's `ownerMobile` in
      `frontend/src/data/properties.json` is `9999047855`, so the localStorage assertion reads an
      empty key. One-line constant fix; flagged to the user, not changed unasked.

## Mobile-first Phase 6 — deferred-item sweep

Worked autonomously (user unavailable to answer the clarifying questions). Took the
recommended option on each item, and **declined the ones that are product-taste calls
or new features** rather than guessing at someone else's design intent.

- [x] **C4 was already done, and the audit mislabelled it.** The thumbnail strip is
      `hidden sm:block`; mobile already uses the dot rail built two rounds ago. What
      the audit measured as "22x44 thumbs" was that dot rail — and it *is* 2px under
      the 24px its own comment claims: `px-2` (8px a side) around a `w-1.5` (6px) dot
      = 22px. Fixed with `min-w-[24px]`, not more padding, because the active dot is
      `w-5` and a padding change cannot pin both states at once.
- [x] **A4 (partial): Outfit trimmed 7 weights → 5.** Grepped before cutting:
      `font-light`, `font-black`, `font-weight: 300|900` and inline `fontWeight` are
      **zero** uses, so 300 and 900 were pure download cost. The audit proposed
      cutting to 3 weights (400/600/800) — the evidence says 500 (16 uses) and 700
      (39 uses) are load-bearing, so that would have visibly flattened the type
      hierarchy. Cut only what is provably dead.
- [x] **D5 admin safe-area.** `<main>` had bare `p-4 sm:p-6`, so the last row of a
      queue sits under the home indicator on a notched phone — the row a field-ops
      user is actually reaching for. Routed through `--pn-safe-b` (verified declared
      on `:root`, so the admin tree inherits it); `env()` resolves to 0px off-device,
      so it is inert everywhere except an installed app on a notched phone.

### Declined, with reasons — these are decisions, not leftovers
- **Property price above the fold.** A real photo-vs-price product call (measured:
  price at y=551, sticky CTA at y=505; closing the gap costs ~90px of hero). Every
  option changes the visual hierarchy of the main money page. **Needs a human answer.**
- **E5 second half (share on society / flatmate).** There is no share control on those
  surfaces at all, so this is *new UI plus new strings in three languages* — a feature,
  not a deferred fix. Note for whoever picks it up: `share` in `RoomCard.jsx` means
  flat-sharing (roommates), not social share. Easy to conflate.
- **A3 English locale split.** Rejected after working it through, not skipped. The app
  merges every `en/*.json` into one `translation` namespace, so making part of it lazy
  lets components render before their strings land and paint **raw keys**. That is a
  visible regression on every route in exchange for ~35 KB gzip. Doing it safely needs
  a per-route loading gate — a bigger design than the review implied.
- **A1 / A2.** Unchanged: `rawLoad()` is synchronous across dozens of call sites, and
  `societies-rera.js` is on the critical path via Home's societies rail. Both are
  mock-layer code the backend deletes.
- **C1 blanket 12px floor.** The one badge with a *safety* cost (flatmates VERIFIED)
  is fixed. The rest is metadata — `10 min ago`, `₹9,786/sq.ft` — at 10–11px across
  ~40 files. Best driven test-first by the F3 sweep so each bump is justified by a
  failing assertion, not a blind 40-file diff.
- **A5 / A7 / D4 / E1 / E2 / E3 / E6.** Unchanged — see the review; E1/E3/E6 need the
  backend before they can be honest.

## Desktop e2e triage (2026-08-03)

Full chromium baseline: **84 failed / 2 flaky / 969 passed**. First established that
none of it is mine — stashed every tracked change and re-ran a four-spec sample at
HEAD: **identical 17 failures** with and without the mobile work.

Three root causes, not 84 separate bugs:

1. **The flatmates page was redesigned and the old specs were left behind.** It moved
   from three supply-shaped tabs (Flatmates / Rooms / Groups) to two intent tabs
   (Move in now / Team up) — rationale in `flatmates/model.js`. The old `?view=`
   values still resolve as *aliases*, so those specs kept loading a real page and
   asserting against the wrong tab. That is worse than a 404: it fails silently and
   looks like an app bug. ~40 failures. **The app is correct**; `flatmates-discovery.spec.js`
   is the current spec and passes, aliases included.
2. **A stale seed constant.** P5000's `ownerMobile` changed to `9999047855`, but five
   specs still carried `9530047855` and asserted on `puneNestContactReq:<old>` — a key
   nothing ever writes, so the symptom was a baffling empty array rather than "your
   constant is stale". ~13 failures.
3. **Strict-mode name collisions.** `Modal.jsx` labels its dismiss icon
   `aria-label={`Close ${title}`}`, so a loose `name: 'Close'` matches both it and the
   footer button. The a11y is *right* — a specific label beats a bare "Close" — the
   tests were loose. ~14 failures.

### Fixed
- [x] **Root cause 2 killed at the source.** Added `ownerMobileOf(id)` to `helpers/app.js`,
      which reads `frontend/src/data/properties.json` directly. Five specs now derive the
      number instead of copying it, so the next data change can't rot them. In
      `contact-owner-gate` the mask and formatted variants are derived too — verified
      against the real `maskPhone`/`fmtPhone` rather than trusting the old comment.
- [x] **Root cause 3:** tightened four locators in `admin-properties` with `{ exact: true }`
      and a note explaining the collision. Chose this over renaming the app's aria-labels,
      which would have made the icon button *less* descriptive for screen readers.
- [x] **`flatmates-filters.spec.js` rewritten** for the two-tab contract (Move-in on both,
      Sharing on Team up, Washroom on Move in now) and now drives the tabs through the UI
      instead of legacy deep links.
- [x] **`flatmates-smart-search.spec.js`:** the tab-count assertion used the removed
      "Flatmates, N available" label; now asserts the sighted and announced counts agree.
      Two hardcoded `toHaveCount(3)` became "narrowed but not to nothing" — the merge made
      it 4, and pinning any literal just re-arms the same trap for the next seed change.
- [x] Verified: **81 passed / 0 failed** across the six repaired specs, then **25 passed**
      across the three flatmates specs. Lint still 0 errors.

### Still stale — same root cause 1, group-flow specs RESOLVED

Eight of the nine rewritten (the group-creation family). Two further app changes
surfaced that the first pass had not seen — both found by probing the running app,
not by reading the specs:

- [x] **The three post buttons became one.** "Create a group", "List your room" and
      "Post your request" were replaced by a single **Post** button opening a chooser:
      "do you have a place?", then "just me or a group?". Added `postAsGroup`,
      `postHavingPlace` and `postAsSolo` to `helpers/app.js` — seven specs drove the
      old buttons directly, and inlining the new two-step walk seven times would just
      recreate the coupling. Every click is scoped to `.sf-modal`, because the seeker
      cards *behind* the overlay carry their own "Just me" control and an unscoped
      match resolved to four elements.
- [x] **A new group lands on the tab you are not looking at.** Creation returns you to
      Move in now, but an address-less group sorts into Team up (`tabOf()` in
      `flatmates/model.js`), so the card genuinely is not where the spec looked. Added
      `switchToTeamUp()` and placed it at each create/reload site.
- [x] **Two places where the blanket hop would have been WRONG**, caught by reading
      `tabOf()` rather than pattern-matching:
      - `flatmates-eligibility` "owner attaches a verified property" — attaching gives
        the group an address, so it sorts to **Move in now**. No hop.
      - `flatmates-guardrails` dedupe — the create is *blocked*, so the modal stays up
        and covers the tab strip. Cancel first, then hop.
- [x] Also fixed a test that was **passing for the wrong reason**: `flatmates-groups`
      asserted `toHaveCount(0)` after deleting a group, but did so on Move in now where
      the group was never listed — it would have passed whether the delete worked or not.
- [x] Verified: **55 passed / 0 failed** across all eleven flatmates specs.

### The last three specs (interactions / map-gate / prefreeze)
- [x] **`flatmates-interactions`** — same tab-visibility cause: a posted solo request
      creates a *seeker*, which lives on Team up, so the "Your live request" banner is
      never on the tab the spec landed on. Added the hop at all three sites. Its empty
      state CTA is also the unified `Post` now. The duplicate-post guard needed care:
      it lives in `openPostModal()`, reachable only via the chooser's
      "still looking → just me" branch, so clicking `Post` alone never triggers it.
- [x] **`flatmates-map-gate`** — `/Rooms available/` was a removed tab label; now
      switches via `Team up`, which is what "a new tab starts unfocused" means today.

### FLAGGED — a real layout regression, NOT a stale test — NOW FIXED
`flatmates-prefreeze.spec.js:87` asserts the first result card is above the fold on a
1440x820 laptop. It measured **y=881** against an 820px viewport, so a visitor landed
on a search page and saw no stock at all without scrolling. The test was doing its job.

**Root cause (measured, not guessed).** Walked every box above the first card. The
desktop advanced-filter grid is **308px** and sat permanently open (`hidden lg:grid`),
plus its `mt-4`: **324px** of controls between the visitor and the inventory. Mobile was
never affected — it puts the same controls in a drawer (measured y=669 of 915). Confirmed
via git that `FilterBar.jsx` matches HEAD, so this shipped with the flatmates redesign
(`5c075a9`), not with any of this session's work.

**Fix.** The desktop grid is now collapsible and starts collapsed — the same idea the
mobile drawer already used, with the room a wide viewport allows. The search box, tabs,
list/map toggle, sort and reset all stay on screen; only the advanced grid folds away,
behind a toggle carrying the existing active-filter count badge.

Rejected the alternative of trimming the hero: it is doing real work (badge, H1, trust
pills, two CTAs), ~60px was the most it could give, and that left only 19px of margin —
a longer Hindi or Marathi string would have silently reintroduced the bug.

- Measured **881 → 521** on 1440x820; mobile unchanged at 669.
- **Opens automatically when any filter is already active**, so a deep link like
  `?loc=Baner` never lands someone on a narrowed list with the reason hidden — that
  would be a worse bug than the scroll it saves. Verified: plain landing `aria-expanded=false`,
  `?loc=Baner` → `true` with a "1" badge.
- Updated the 7 filter specs that (correctly) failed once the panel closed, and added
  two new ones: the fold assertion, and the auto-open-when-active behaviour.


### Out of scope (agreed) — a ~30-failure unrelated tail
`society-community`, `society-community-v2`, `list-property-types`, `list-property-p3`,
`rent-agreement`, `admin-rbac`, `view-documents-flow`, `listing-freshness` and others.
All confirmed failing at HEAD too. Each needs individual diagnosis.



---

# SLICE 9 — Trust & Safety and the admin trust boundary

**Status: PLANNED.** Written before any code, per AGENTS.md.

## The finding that shapes this slice

**All 37 Moderation + Admin operations in the contract carry zero `x-roles`.** As written today,
any signed-in user — a buyer who registered thirty seconds ago — could:

| Operation | What it grants |
|---|---|
| `POST /users/staff` | **mint themselves a staff account** — total platform compromise |
| `GET /users` | page every user's name and mobile number |
| `PUT /admin/settings` | change platform fees |
| `PATCH /properties/{id}/archive` | delete any owner's listing |
| `GET /admin/audit-log` | read the record of who did what |
| `PATCH /properties/{id}/status` | approve or reject any listing |

This is the same defect class the project has already fixed twice — **S3** rescoped `GET /visits`
and the `/enquiries` fix added `x-roles: [admin]`, both after finding "(admin)" in a prose summary
with nothing enforcing it. The difference here is scale: it is not one operation, it is the entire
back-office, and `POST /users/staff` is privilege escalation.

So this slice is not "add 32 endpoints". It is **"introduce the admin trust boundary this codebase
has never had"**. The spec fix is a prerequisite, not a deliverable: implementing 37 operations
against a contract that declares them open would be building 37 doors and hanging no locks.

## Scope: 20 operations (not 32)

The full Moderation + Admin surface is 32 missing operations across two tags, backed by 49 frontend
files. That is nearly double slice 8 and would mix two different products — *takedown* and
*reporting*. Split:

- **Slice 9 (this one) — Trust & Safety, 20 ops.** The trust boundary, the report queue, property
  moderation, the verification maker-checker flow, user administration, the audit trail, and the
  review takedown that closes slice 8's one accepted risk.
- **Slice 10 (next) — Admin reporting & config, 14 ops.** `/admin/dashboard`, `/admin/analytics`,
  `/admin/finance`, `/admin/settings`, `/admin/content/*`, `/society-leads`. Read-mostly
  aggregation over data slice 9 will already be guarding.

Slice 9 is chosen first because it is the only remaining work that **closes an accepted risk**
rather than adding surface. Eight slices have added user-generated content to a platform with no
way to take any of it down.

### The 20 operations

**Reports — trust & safety intake (2)**
- `POST /reports` (createReport) → 201
- `GET /reports` (listReports) — staff queue

**Property moderation (5)**
- `PATCH /properties/{id}/status` (setPropertyStatus) → 200/403/404
- `POST /properties/{id}/toggle-featured` (toggleFeatured)
- `POST /properties/{id}/flag` (flagProperty) — body `ReasonRequest`
- `DELETE /properties/{id}/flag` (clearFlag) → 204
- `PATCH /properties/{id}/admin` (adminUpdateProperty) — body `ListingUpdate`

**Property verification — maker/checker (5)** — V5 `property_reviews` + checklist + message thread
- `GET /properties/{id}/verification` (getPropertyVerification)
- `POST /properties/{id}/verification` (initPropertyVerification) → 201
- `POST /properties/{id}/verification/messages` (addVerificationMessage) → 201
- `POST /properties/{id}/verification/read` (markVerificationRead) → 204
- `POST /properties/{id}/verification/decision` (verificationDecision) → 200/403

**User administration (6)**
- `GET /users` (listUsers) — paged, filters `role`/`q`/`archived`
- `GET /users/{id}` (getUser)
- `PATCH /users/{id}` (adminUpdateUser)
- `PATCH /users/{id}/archive` (archiveUser) — body `ReasonRequest`
- `PATCH /users/{id}/restore` (restoreUser)
- `POST /users/staff` (addStaff) → 201 — **the privilege-escalation surface**

**Audit (1)**
- `GET /admin/audit-log` (adminAuditLog) — paged, filters `actor`/`entity`/`from`/`to`

**Review takedown (1, closes slice 8's accepted risk)**
- Migration for the `archived` column `reviews` lacks, plus a moderation path to use it.

## Design questions to resolve, justify and record

**D9.1 — staff vs admin: who may do what?** `Roles` already distinguishes `staff` from `admin`.
Blanket `x-roles: [admin]` would make the ops team useless; blanket `[staff, admin]` would let any
ops hire mint accounts and rewrite fees. Proposal to justify: **moderation is staff+admin**
(reports, property status/flag/verification — the daily job), **user administration and staff
creation are admin-only** (archiving a user and minting a colleague are not daily ops work).
`POST /users/staff` is admin-only under every reading.

**D9.2 — `GET /users` returns mobile numbers.** Slice 3 built `common.trust.ContactGate` precisely
so mobiles are not handed out freely. An admin genuinely needs the mobile to do the job, so the
gate should *not* apply — but then a staff account becomes a bulk PII export, which is exactly what
`GET /users?q=` is. Decide: does an admin user-list read write an audit entry, and is the mobile
returned on the *list* or only on the *detail* read? Cheapest defensible answer: mask on the list,
reveal on the single-user read, and audit the reveal.

**D9.3 — report reason vocabulary.** V7 left `reports.reason` free text with an explicit note:
"a canonical reason enum is deferred (reconciliation #7) — add a CHECK in a later V* once the
vocabulary is frozen." This slice is that later V*. Freeze it from the frontend's report UI, or
consciously keep it free text and say why.

**D9.4 — property `flag` vs `status`.** `POST /properties/{id}/flag` and
`PATCH /properties/{id}/status` can both land a property in `flagged`. Two write paths to one state
is how state machines rot. Decide whether flag is a distinct concept (a reason-carrying marker that
does not change `status`) or sugar over `status='flagged'` — and make the other path refuse it.

**D9.5 — who may moderate their own case?** An admin archiving themselves, a staff member clearing
a flag on their own listing, an admin approving their own property. Each is a self-dealing hole.
Enumerate and block server-side.

**D9.6 — what writes to `audit_log`?** `AuditService` exists (REQUIRES_NEW, so an entry survives a
rolled-back business transaction) and is currently written by the deals/finance paths. Every
privileged mutation in this slice should write one. Decide the `action` vocabulary
(`property.approve`, `user.archive`, `staff.create`, …) and whether a *failed* privileged attempt
is recorded — the Javadoc argues it should be.

**D9.7 — `archived` on reviews, and who may pull one.** Reviews are the one user-generated surface
with no takedown. Decide whether takedown is a `reports`-driven flow (report → staff actions it) or
a direct moderation endpoint, and whether an archived review still counts toward the society
rating aggregate (it must not).

## Invariants to enforce server-side, each with a test

- A `buyer`-role token gets **403** on every one of the 20 operations. This is the slice's
  headline test and it must be table-driven across the whole route list, not per-endpoint —
  the defect being fixed is exactly "somebody forgot one".
- `POST /users/staff` as `staff` (not `admin`) → 403. Nobody promotes themselves.
- A staff member cannot moderate a property or report in which they are the owner or reporter.
- Every privileged mutation writes exactly one `audit_log` row with a server-resolved actor.
- The audit log is append-only: no endpoint updates or deletes a row.
- An archived review disappears from the public read **and** from the society rating aggregate.
- `GET /users` is paged, index-backed, size-capped, and sort-stripped (the V16/V17 lesson).
- Route-constant / security-matcher agreement, as every slice.
- No entity over the wire; soft-delete only; 404-not-403 on `/me/**`.

## Prerequisite: spec fix S28

Add `x-roles` to all 37 Moderation + Admin operations before implementing any of them, each with a
comment recording *why* that role — same house style as S3 and the `/enquiries` fix. SSOT wins:
the contract is changed first, then the code matches it.

## Build order

1. **S28** — the spec fix. Nothing else starts until the contract declares the boundary.
2. **9a** — role-guard test harness: the table-driven "every admin route refuses a buyer" test,
   written against the route constants so a future added route is caught by omission.
3. **9b** — reports (2) + the V18 migration (report reason CHECK, `reviews.archived`).
4. **9c** — property moderation (5), resolving D9.4.
5. **9d** — property verification maker/checker (5).
6. **9e** — user administration (6), resolving D9.1/D9.2, with `POST /users/staff` last.
7. **9f** — audit log read (1) + audit writes threaded through 9b–9e.
8. **9g** — review takedown, closing slice 8's accepted risk.

## Explicitly out of scope (recorded, not dropped)

- Slice 10's 14 reporting/config ops.
- Documents (7), Billing & Growth (14), Services & Support (22), messaging (5), share-flat (3).
- Any admin UI work — the frontend is complete and mock-only; this slice does not touch it.


## Slice 9 - RESULTS (Moderation / Trust & Safety)

**Delivered.** `mvn -o verify` green: **422 tests, 0 failures** (373 before this slice; +49).
Uncommitted on `feature/backend-integration` - the user commits manually.

### What shipped

| Area | Ops | Notes |
|---|---|---|
| Reports (abuse queue) | 3 | `POST` open to any signed-in user; `GET`/`PATCH` staff+admin |
| Property moderation | 4 | setStatus, toggleFeatured, flag, clearFlag - all self-dealing-blocked |
| Property verification | 5 | owner<->ops thread; participant-or-staff, decision staff+admin |
| User administration | 6 | masked list / audited reveal; writes admin-only |
| Audit log read | 1 | admin-only |
| Review takedown | 1 | `PATCH /reviews/{id}/status` - closes slice 8's accepted risk |

New bounded context `com.punenest.api.moderation` (rank 5 in `ArchitectureBoundaryTest`),
migration **V19** (`review_messages.read_at` + two indexes), spec fixes **S28-S34**.

### Design decisions (all six resolved, rationale in the Javadoc next to the code)

- **D9.1** moderation = staff+admin; user administration, `addStaff` and the audit log = admin-only.
  The audit log is admin-only on "who watches the watchers" grounds.
- **D9.2** mask mobile on the list, reveal on the single read, audit the reveal. A paged list is a
  bulk-export surface wearing the clothes of a search screen; per-person reads make exfiltration
  cost linear and leave a trail naming each subject. The list is deliberately **not** audited.
- **D9.3** report reasons are three vocabularies keyed by target type, enforced in code, **no DB
  CHECK** - a flat CHECK over the union would accept every nonsensical pairing while appearing to
  validate. (A vocabulary rule has no race to lose; this is not a counter-example to V9/V16.)
- **D9.4** flag sets **both** `status='flagged'` and `flag_reason`, matching
  `properties-admin.js#flagListing`. `clearFlag` -> `approved`, legitimate because only staff can
  reach it, so clearing a flag *is* the human review.
- **D9.5** self-dealing blocked in three places: staff cannot moderate or decide verification on
  their own listing, admin cannot archive themselves (only admins can restore, so a single-admin
  platform would lock itself out with no in-product recovery).
- **D9.7** review takedown needs **no new column**: `reviews.status` is already filtered by
  `aggregateFor`, so `rejected` removes the review from the page *and* the score in one write.
  Slice 8's assumption that an `archived` column was needed was wrong.

### Bugs this slice's own tests found (production code, not test code)

1. **`POST /properties/{id}/verification/messages` 500'd on every call.** `@UuidGenerator` and
   `@CreationTimestamp` populate at INSERT, so a response mapped from the freshly-added
   `ReviewMessage` carried a null id. Fixed with `saveAndFlush` before mapping; `initiate` given
   the same treatment, where it was correct only by coincidence.
2. **LIKE wildcard injection in the back-office user search.** `q` was concatenated with `%` and
   passed to `like` unescaped, so `?q=%` turned an anchored, index-backed prefix search into an
   unindexed scan of every user - on an endpoint any staff member can call, and the scan happens
   before the page cap does. Fixed with escaping at both ends (`likePrefix` + `escape '\\'`) and a
   regression test asserting both halves: wildcards are literal, honest prefixes still work.
3. **Non-deterministic audit-log pagination.** `order by at desc` with no tiebreaker silently drops
   and repeats rows across pages. Cosmetic on an ordinary list; on the audit log it is a missing
   entry in the one record consulted precisely when someone suspects something. Added `id desc`.

### Review triage

`security-reviewer`: 1 HIGH confirmed and fixed (the wildcard injection above), 0 CRITICAL.
`java-reviewer`: 1 MEDIUM **rejected with a written reason** - it proposed catching the audit
serialisation failure and writing `"{}"`, trading a loud failure for a quiet one on the one table
that exists to be trusted. The refusal is now documented in `AuditService`'s Javadoc so it is not
"fixed" by the next reader. 2 LOW confirmed and fixed.

### Deferred, recorded rather than dropped

- **`PATCH /properties/{id}/admin` (`adminUpdateProperty`) is not implemented.** Its body is
  `ListingUpdate`; it must reuse `catalog.listing.ListingService`'s field mapping rather than grow
  a second copy of it. Documented in `PropertyModerationController`'s Javadoc.
- Rate limiting on `POST /reports` - a third high-abuse public/authenticated write alongside
  `POST /cities/waitlist` and `POST /society-leads`. The platform-wide item still owns it.
- `providers/http/propertyProvider.js:151` names `DELETE /admin/properties/{id}/flag` in an error
  string; the real path is `/properties/{id}/flag`. Frontend-only, harmless.

---

## 2026-07-31 — Code-quality baseline into the register + a build-breaking regression

**Register:** `docs/system/tech-debt.md` gained **§3 "Decided: code quality — the measured baseline"**
and rows **D33–D39**. The section is measured, not asserted: 330 main files / 22,143 lines,
**42.7% comments**, 562 `@param` vs 26 `@return`, zero shared test fixtures, zero static-analysis
plugins. Headline finding: **class length is already fine** (only 2 files > 500 lines, one fixed by
D1 and one that should stay long) — the actual waste is comments and test duplication, ~1,200 lines
removable with zero behaviour change.

**Checkstyle (D36).** Config stored at `backend/config/checkstyle/checkstyle.xml`. The two supplied
files were byte-identical, so one copy is kept. One fix was needed to make it run: `LineLength` moved
from `TreeWalker` to `Checker` in Checkstyle 8.24. Baseline measured at **717 violations / 333 files**;
dropping `SingleLineJavadoc` (conflicts with D33) and settling the duplicated import-order rules
removes 79% of them. Plugin deliberately **not** wired into `pom.xml` yet — trigger is after the last
feature slice.

**Regression found and fixed.** 24 zero-byte / stub `.java` files had regenerated under
`com/punenest/api/auth/`, `com/punenest/api/user/` and `identity/` root, shadowing the real classes in
`identity/*`. One (`auth/LoginRequest.java`, containing the text `in`) was a **syntax error — the
module would not compile.** Deleted; `mvn -o verify` then passed **422 tests, 0 failures**, and the
main-source count returned to exactly 330. This is the *second* occurrence of an identical 24-file
set, so the two "Fixed" rows in the register's closed table were **reopened as D39** — the generator
needs root-causing, not a third deletion.

---

## Slice 10 - Documents & agreements - RESULTS

**11 operations, not the 15 first assumed.** `/me/subscription`, `/me/properties/{propId}/boost`,
`/me/service-orders` and `/me/referrals` are Billing & Growth and were excluded. Shipped:
`GET|POST /me/documents/{propId}`, `DELETE /me/documents/{propId}/{docId}`,
`GET /me/documents/requests`, `PATCH /me/documents/requests/{reqId}`, `POST /documents/requests`,
`GET /documents/shared`, `GET|POST /me/rent-agreements`, `GET|PUT /me/owner-kyc`.

**Verify:** `mvn -o verify` green - **466 tests, 0 failures** (baseline 422, so +44).
Nothing committed; the working tree is left dirty for a manual commit.

**Spec fixes (SSOT first, S35-S39).**
- S35 `DocumentRequestCreate` gains `acknowledgedDisclaimer` (+ `message`). The response advertised
  a consent flag the client had no way to set, so it could only ever read `false`.
- S36 new `OwnerKycUpdate {pan, aadhaar}`; `PUT /me/owner-kyc` no longer takes the full `OwnerKyc`,
  which had invited `status: verified` from the client - self-certified KYC.
- S37 `DocumentRequest.expiresAt` - `expired` was in the status enum but invisible on the wire.
- S38 new `RentAgreementCreate`; `POST /me/rent-agreements` now returns the created record (it was
  an empty 201, so the client never learned the id).
- S39 `PUT /me/owner-kyc` returns `OwnerKyc`.

**Decisions worth not re-litigating.**
- `FileStorage` gained `store(key, bytes, contentType)`. Without it the upload endpoint would have
  written a row naming an object that was never stored. Takes `byte[]`, not `MultipartFile`, to keep
  Spring web types out of the provider layer.
- Allowlist, never a blocklist, on upload (PDF + four image types, 10 MB). A vault that stores
  anything and serves it from a PuneNest URL is free phishing hosting.
- The share token is 256 bits of `SecureRandom`, URL-safe base64, unpadded - not a UUID (122 bits,
  and confusable with an id in a URL). It is the *entire* credential for the anonymous read.
- The expiry, not the status label, is authoritative on the share read. Nothing sweeps rows to
  `expired`, so the clock is checked on every read and a lapsed link dies instantly.
- Every share failure is the same 401. Unknown / declined / expired must not make the endpoint an
  oracle for probing forwarded links.
- Requests are idempotent only *while pending* - V20 uses a partial unique index. A total unique
  would have made a single "no" permanent, which is a policy nobody chose.
- The requester's mobile is masked unconditionally. Granting document access must not quietly route
  around the contact gate.
- No KYC gate on creating a rent-agreement draft: the wizard *collects* owner KYC as one of its
  steps, so gating draft creation locks the door from the inside. The gate belongs on the transition
  out of `draft`, which lands with `/service-requests`.
- Owner KYC lives in `identity.kyc`, not `documents` - user-scoped identity data, 1:1 by primary key.
  Resubmitting PAN/Aadhaar resets `status` to `pending`, so a badge cannot be earned with one
  identity and kept with another.
- `GET /me/owner-kyc` is a 200 with an empty record, not a 404: "not done yet" is a state of one's
  own account, not a missing resource.

**Route-precedence hazard, pinned by a test.** `/me/documents/requests` sits directly under the
`{propId}` template of `/me/documents/{propId}`. Spring's `PathPattern` comparator ranks the literal
above the variable so the inbox wins, but that is a resolution rule doing load-bearing work -
`DocumentRequestFlowTest.inboxRoute_beatsThePropertyVaultTemplateItSitsUnder` asserts it against the
live `RequestMappingHandlerMapping` rather than trusting it.

**Two test assumptions were wrong and the code was right:** bean-validation failures return **422**,
not 400. Fixed in the tests.

**Test config gotcha re-learned.** `src/test/resources/application.properties` *shadows* the main
file rather than merging, so the multipart ceilings had to be repeated there - without them Boot's
1 MB default would trip before `DocumentUploads.MAX_BYTES` and the 10 MB rule would be untestable.

**Security review:** no CRITICAL and no HIGH findings. Three items accepted as debt rather than
half-done: D40 (magic-byte sniffing), D41 (orphaned objects on delete), D42 (share token in the
query string - any request logging that is turned on must exclude it). D2 was widened to cover the
anonymous `GET /documents/shared` alongside authenticated writes. `DocumentsController`'s Javadoc was
corrected: it had asserted a logging guarantee that is only a default.

---

## Slice 11 — service requests + staff ticket queue (13 ops) — RESULTS

**Shipped.** `mvn verify` green: **513 tests, 0 failures** (baseline 466). Spec coverage measured
against the live router, not estimated: **137 of 179 operations**, up from 124. Zero routes served
that the contract does not declare.

### What landed

- `services.request` — the assisted-service workflow: raise, converse, ops transitions, draft
  share, customer decision, final document. 9 operations.
- `services.ticket` — the ops board: team-scoped list, create, update, notes. 4 operations.
- `V21__service_requests_and_tickets.sql` — `service_request_messages` plus three indexes.
- Spec fixes S40–S44. S44 alone corrected 8 operations that declared a bare `'200': Updated`
  with no content — a response shape the client had to guess.
- `SpecCoverageTest` — new permanent guard: no route may be served that the contract does not
  declare, and the implemented-operation count is a ratchet (floor 137).

### The design decisions worth remembering

- **Maker-checker is the security of this slice.** Ops is the maker, the customer is the checker.
  Three mechanisms hold it up, and each is separately testable: `STAFF_SETTABLE` keeps `approved`,
  `draft-shared` and `completed` out of reach of `PATCH /status`; `decideDraft` refuses any caller
  who is not the requester — **including admin**; and `completed` is reachable only from
  `approved`, only by uploading the file. "Done" therefore always has a document behind it.
- **Assignment and acknowledgement are the same act.** Moving a request to `assigned` takes it for
  the calling staff member. A queue where you can assign work to somebody else by id is a queue
  people dump work into.
- **404 for customers, 403 for ops — deliberately opposite.** A customer reading someone else's
  request gets "not found", because a 403 confirms that a particular person has a particular legal
  matter open. A staff member reaching across desks gets a 403, because they have already passed a
  staff guard and hiding one desk from another protects nothing while costing ops a real answer.
- **Team scoping fails closed.** Staff with no desk get a 403, not a full board. Staff naming
  another desk in `?team=` get a 403 rather than a silent substitution — a filter that quietly
  ignores you teaches you the wrong thing about the system.

### Security review — one real finding, and it was ours

The reviewer raised three items; two did not survive checking against source, one did.

**Fixed — a service request could push a file into a stranger's document vault.**
`POST /service-requests` takes `propertyId` from the body, and it must: a service request about a
flat is routinely raised by a tenant or a buyer, so ownership is the wrong question. But every
document uploaded to that request inherited the claimed property id, and the vault read was
`findByPropertyId(...)` — so any authenticated user could quote any listing's id and have a file
of their choosing appear in that owner's vault, and in any share granted from it. An
attacker-named "Sale Deed.pdf" in someone else's paperwork.

The fix is where the mistake was, not where it surfaced: **property-scoped document reads now
exclude service-request rows** (`findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc`,
and the same clause in `findSharable`). A service-request document is reached through the request,
which is access-controlled; the vault is what the owner put there. The vault delete was narrowed
the same way. Additionally both `create` paths now verify the listing **exists** — `property_id`
is a foreign key, so an unchecked id was a constraint violation rather than an answer. Malformed
stays 400, unknown-but-well-formed is 404: different mistakes deserve different answers.
Regression-tested by `ServiceRequestDocsTest.vaultIsNotAnInbox` and `propertyMustExist`.

**Rejected — "staff can re-team a ticket to a desk they don't belong to."** That is the feature.
Misfiled work must be able to reach the right desk, and the proposed fix (only reassign to your own
team) makes re-teaming impossible by definition. The action is audited with both the old and new
team.

**Accepted as debt, not half-done — `TicketDto` carries internal notes** and is returned to the
customer who created the ticket. Safe today only because a new ticket has none. Recorded as D47 and
must be split before any customer-facing board read.

### Recorded debt

D44 (service requests not team-scoped), D45 (ticket ↔ service-request mirroring), D46
(`TicketUpdate` cannot unassign), D47 (`TicketDto.notes` exposure), D48 (no optimistic locking),
D49 (`MessageCreate.attachments` accepted and dropped).

### Lessons

- **A claimed foreign key is not an authorisation.** `property_id` on a request said only "the
  requester typed this". Everything downstream that treated it as a relationship inherited a
  vulnerability. Ask of every client-supplied id: *what did the client prove by sending it?*
- **The reviewer's hit rate was 1 in 3.** Two findings dissolved on reading the source — one
  invented an attack requiring database write access, the other proposed a fix that was a no-op.
  Verify every claim against the file before acting on it.
- **A test can be wrong in the same direction as the code.** `documentsAppearOnTheRequestAndTheVault`
  asserted the buggy behaviour and passed, which is what a test written from the implementation
  rather than from the rule does.
---

## Slice 12 — conversations + support tickets — RESULTS

**Shipped.** `mvn -o verify` → **536 tests, 0 failures** (baseline 515, +21 new).
Spec coverage **147 of 178 operations**, measured against the live router by `SpecCoverageTest`,
whose floor is raised from 137 to 147 in the same change.

### Operations

`myMessages`, `startConversation`, `getConversation`, `replyConversation`, `readConversation`;
`listSupportTickets`, `createSupportTicket`, `getSupportTicket`, `replySupportTicket`,
`markSupportTicketRead`. Ten, not eleven: `listEnquiries` was **removed from the contract** rather
than implemented (S45).

### Spec fixes S45–S49

- **S45 — `GET /enquiries` and the `Enquiry` schema deleted.** The document had written its own
  sunset back in slice 4 ("NOT IMPLEMENTED and will not be"). Nothing writes `enquiries`; the
  operation could only ever have returned an empty page. An endpoint that is documented as never
  arriving is worse than an absent one — it is a promise the contract keeps making.
- **S46 — `replySupportTicket` returned a bare `'201': Replied`.** A client had no way to render the
  message it had just sent without re-fetching the ticket. Now returns `Message`. Same defect class
  as S44.
- **S47 — `GET /support/tickets` was "My support tickets (all for admin)."** One operation with two
  growth profiles. For a customer the collection grows with their own activity (bare array, §5.1);
  for an admin it grows with the platform (must be paged). Serving both means either a shape that
  changes with the caller's role or an unbounded PII export of every support conversation on the
  platform. Narrowed to the caller's own. `api-standards.md` §5.1 gained the general rule.
- **S48 — `startConversation` gained its actual contract:** the relationship requirement and the
  enumeration-oracle reasoning as a `description`, a `'200'` (already existed) beside the `'201'`,
  and the `'403'` that is the load-bearing rule of the operation. `replyConversation`,
  `readConversation` and `markSupportTicketRead` gained the `'404'` they always returned.
- **S49 — documented the masking asymmetry** on `Conversation.counterpartyMobile` and the direction
  of `SupportTicket.unread`.

Contract after: **142 paths / 178 operations**.

### The rule this slice is built around

`POST /messages` takes a **mobile number** and opens a chat. Without a guard that is two things
nobody asked for: a way to test a list of phone numbers against the user base — the answers differ,
so the answer *is* the oracle — and a channel for messaging strangers. So:

- Opening a thread requires an **approved contact request in either direction**, or staff/admin.
  Reuses `ContactRequestRepository.existsApprovedForOwner`, the same guard already blessed for
  `GET /tenant-profiles/{mobile}` (S10), called both ways.
- **Every refusal is identical** — unregistered number, registered stranger, yourself, a listing
  neither party owns. One `refuse()` helper, one status, one message.
  `ConversationEndpointsTest.refusalIsIndistinguishable` asserts the two responses are equal after
  stripping per-request fields. It reads like a redundant test until you remember that the
  difference is the vulnerability.

Note the deliberate contrast with `FinalizationService`, which answers **422** when a counterparty
mobile resolves to nobody. Correct there — the caller is already established as a party to the deal
and the number is one they were given. Wrong here. Same-looking input, different threat, different
answer; written into both Javadocs so nobody "makes them consistent".

### Masking is not relaxed by being in a thread

ADR-019 is asymmetric and stays that way: an approved contact request reveals the **owner's** number
to the buyer who asked, never the buyer's to the owner. So in one conversation the buyer sees
`9830000151` and the owner sees `98XXXXX152`. The reveal test is not "are these two talking" —
if it were, starting a thread would route around the contact gate — but "does the reader hold an
approved request against a listing the counterparty owns". A thread with no listing masks both ways.

A caller-supplied `propertyId` would otherwise have driven that decision, so `start` also requires
the listing to be owned by **one of the two parties**. This is the slice-11 lesson applied before it
could become a slice-12 vulnerability.

### The bug the database found

`Conversation` canonicalises its pair so a duplicate thread is unrepresentable rather than merely
unlikely — V22 adds `CHECK (user_a_id < user_b_id)` plus two partial unique indexes (two, because
Postgres treats NULLs as distinct, so one index cannot cover both the listing thread and the general
one).

The first implementation ordered the pair with `UUID.compareTo`. **It compares the two halves as
signed longs**, so any uuid whose first hex digit is 8–f counts as negative and sorts before
everything else; Postgres compares the 16 bytes unsigned. The two orderings disagree on about half
of all pairs, so 8 of 21 tests failed with a check-constraint violation — and the *other* 13 passed,
which is exactly what makes this class of bug survive a green suite. Fixed by comparing the
lower-case hex strings, which is order-isomorphic to Postgres's byte comparison, in one
`Conversation.ordersFirst` that both the constructor and the find-or-create probe go through.

Worth stating plainly: the constraint did not cause the failure, it *revealed* it. Without the CHECK
this would have shipped as an intermittently forked conversation.

### Other decisions

- **Find-or-create, not create.** Starting a thread that exists returns it, 200 rather than 201, so
  a client that has lost the id cannot fork the conversation by asking again.
- **Non-participation is 404, not 403**, on conversations and support tickets alike. Confirming that
  a thread exists is itself the disclosure.
- **Staff and admin are not exempt on conversations.** A private chat is not an ops surface and
  nothing in the contract asks for one. If moderation needs it, it should arrive as its own audited
  endpoint rather than as a role check hidden inside a participant guard (D53).
- **`messages.read` is one boolean** and works only because a thread has exactly two participants;
  the assumption is written on the entity so the day a third arrives, the model breaks loudly.
  Unread for a whole inbox is one `GROUP BY`, never a query per row.
- **Support tickets are a separate aggregate from the ops board.** `services.support.SupportTicket`
  is raised by a customer and has no assignee, priority or notes; `services.ticket.Ticket` is
  internal. Merging them would mean either showing ops fields to customers or nulling half a row on
  every insert.

### Honest correction to the plan

The slice plan claimed `/support-tickets` would "retire two debt items". It retires neither.
Building the customer surface as its own aggregate means **D47** (`TicketDto` carrying internal
notes, still returned to the creator of an ops ticket by `POST /tickets`) is untouched, and **D45**
(ticket ↔ service-request mirroring) is if anything now a three-way gap. Both stay open.

### Recorded debt

D50 (ops has no unread signal on support tickets), D51 (no platform-wide support list until
`/admin/support-tickets`), D52 (the frontend's conversation `state` field has no contract
equivalent), D53 (conversations are not moderatable), D54 (find-or-create races to a 500 rather than
to the existing thread).

### Reviews

`security-reviewer` and `java-reviewer` both returned **no findings** — the first clean pair this
project has had. Every claimed-safe property was re-checked against the source before accepting it.

### Lessons

- **A comparator is part of a constraint's contract.** `UUID.compareTo` and Postgres's `uuid` `<`
  are both "obviously" uuid ordering and they are not the same ordering. Any invariant enforced in
  two languages needs the comparison verified in both, not assumed.
- **A partially-failing test suite is more informative than a wholly-failing one.** 13 of 21 passing
  was the signal that the bug was data-dependent rather than structural, which pointed straight at
  the comparator instead of at the schema.
- **Deleting an operation can be the fix.** S45 removed `listEnquiries` rather than implementing it;
  coverage went from 137/179 to 147/178 partly by shrinking the denominator, and the contract got
  more honest, not less complete.
- **The plan's debt predictions were wrong and saying so is cheap.** Recording "this did not close
  what I said it would" costs one paragraph now and saves the next reader trusting a stale claim.


## Slice 13 — Billing & Growth (14 ops) — RESULTS

**Shipped.** `mvn -o verify` green: **559 tests, 0 failures** (up from 536). Spec coverage
**161 of 178** operations; `SpecCoverageTest.IMPLEMENTED_FLOOR` raised 147 → 161. Migration V23.

### What landed

- `billing/plan` — `GET /plans`, `POST /me/subscription`, `GET /me/subscription`.
- `billing/boost` — `GET /boost-packs`, `POST /me/properties/{propId}/boost`.
- `billing/marketplace` — `GET /service-catalog`, `POST` + `GET /me/service-orders`.
- `billing/referral` — `GET /me/referrals`, `POST /me/referrals/redeem`, and the staff fraud desk
  (`GET /referrals`, approve / reject / clawback).
- `billing/BillingPayments` — one facade the rent webhook offers every callback to; subscriptions
  and boosts each no-op on an order id they do not own.

### Rulings taken

1. **Priced purchases go through the gateway like rent does.** Row created `pending` against an
   order, `201` returns `paymentRef`, the HMAC-verified webhook activates it. A zero-price plan is
   `active` immediately with a null `paymentRef`. This removed S50's `402`-with-no-body dead end.
2. **A `pending` subscription entitles nothing.** `isEntitling` (active/past-due) is now a separate
   set from `isLive` (+ pending), and `GET /me/subscription` prefers an entitling row over a newer
   pending one — otherwise starting an upgrade and abandoning checkout silently downgraded you.
   Found by a failing test, not by review.
3. **The referral code lives in its own table** (`referral_codes`, PK = `user_id`) so billing never
   writes into identity's aggregate. Minted lazily on first read.
4. **Reward money is a frozen column on `referrals`**, and the "ledger" is
   `sum(reward_amount) group by status`. Because the totals are derived from status, a lost update
   cannot double-pay.
5. **`clawed-back` is its own status** (S52). Folding it into `rejected` destroys the never-paid vs
   paid-then-recovered distinction, which is the only one the finance side cares about.
6. **One undifferentiated 409 on redeem** — unknown code, own code and already-referred mobile are
   indistinguishable, so the endpoint is not an oracle for which codes exist.
7. **Service orders take no money.** `startingPrice` is a "from" price; `ServiceOrder.amount` stays
   null until ops quotes.
8. **`billing` ranks 2**, strictly below `finance` (3), so the webhook's `finance → billing` call is
   a legal downward arrow. `package-structure.md` §2's layering table was stale and was rewritten to
   the real six ranks.

### Review findings actioned

- **Concurrent approve/reject/clawback could file duplicate audit rows** (`security-reviewer`).
  Closed with a `@Lock(PESSIMISTIC_WRITE)` `findForDecision` query — chosen over the suggested
  `@Version` column because it needs no migration.
- **Catch-and-re-read after a constraint violation is dead code** (`java-reviewer`, verified with a
  throwaway probe test that printed `RECOVERY READ FAILED: JpaSystemException`). Hibernate poisons
  the persistence context the moment a constraint fires, so every one of those blocks turned a rare
  race into a confusing 500. Four were deleted; `GlobalExceptionHandler` now maps
  `DataIntegrityViolationException` to **409** platform-wide, logged at `warn` so a genuine
  not-null bug still surfaces. `ReferralService.codeFor` was restructured to check
  `existsByCode` *before* inserting rather than recover after. The one catch that survives is in
  `redeem`, and only because it touches no database on the way out.
- **`settlementDate` used the server's default zone.** A 23:30 IST callback with no `payment_time`
  stamped yesterday on a UTC host. Now `LocalDate.now(ZoneId.of("Asia/Kolkata"))`.

### Recorded debt

D55 (`sameDevice`/`sameIp` always false), D56 (`qualified` never produced), **D57 (nothing expires a
subscription — High)**, D58 (no service-order status endpoint), **D59 (a boost does not yet affect
search ranking — High, this is the thing being sold)**, D60 (`channel` derived from role),
D61 (referral farming is caught by humans by choice), D62 (silent catalogue fallback in the webhook).
D54 was downgraded from a 500 to a 409 by the platform-wide handler.

### Lessons

- **A test found the bug that both reviewers missed.** The `pending`-entitles-you defect was a
  business-logic error in the one method whose Javadoc promised the opposite; no static reading
  caught it, and the second test written did.
- **"Catch and retry" against a database constraint is a reflex worth distrusting.** It reads as
  obviously correct and is obviously wrong once you know the persistence context is poisoned — and
  the same pattern had been copied into four services before anyone checked. Proving it with a
  five-line probe test cost less than the argument would have.
- **Prefer looking before leaping to recovering afterwards.** `existsByCode` ahead of the insert
  removes the failure mode entirely for the non-concurrent case, which is every real case.
- **Reviewer hit rate improved but is still not free.** Of the security review's findings one was
  real; of the Java review's, two. Every other claim was checked against the file and rejected.

---

## RESULTS — slice 14 (Admin & Analytics, 13 ops) — SHIPPED

`mvn -o verify` — **614 tests, 0 failures**. Spec coverage **174 / 178** operations; the
`SpecCoverageTest` floor moved 161 → 174. One migration: **V24** (`society_leads`).

### What shipped

| Ops | Surface |
|---|---|
| 3 | `GET /admin/dashboard`, `/admin/analytics`, `/admin/finance` |
| 2 | `GET` + `PUT /admin/settings` |
| 5 | CMS authoring: list / create / patch / archive / restore under `/admin/content/{type}` |
| 3 | B2B pipeline: `GET` + public `POST /society-leads`, `PATCH /society-leads/{id}` |

New context **`admin`** (rank 6 in `ArchitectureBoundaryTest`), new context **`leads/society`**,
and CMS authoring added to the existing `content` package.

### Spec fixes first (S55–S61)

- **S55** — the five CMS ops had *no schema at all* (`{type: object}` on write, a bodiless 200 on
  read). Typed against new `ContentItem` / `ContentItemWrite`, plus a shared `ContentType` parameter
  replacing three inline copies of the enum.
- **S56** — `adminCreateContent`, `adminUpdateContent`, archive, restore, `updateSocietyLead` and
  `updateAdminSettings` all return bodies now. A bodiless write makes the ops screen guess the
  server-assigned id and re-read to find out what it saved.
- **S57** — `listSocietyLeads` was an unpaged array of every lead, each carrying a name and a mobile
  number: an unbounded response and a bulk contact export in one. Paged, with a status filter.
- **S58** — `createSocietyLead` documents `429`.
- **S59** — `adminAnalytics.metric` was required free text, so every client guess was a syntactically
  valid request. Enumerated to `[listings, users, deals, revenue]`, with the 366-bucket cap and the
  `from`/`to` defaults written down.
- **S60** — `updateAdminSettings` documented as **merge, not replace**.
- **S61** — `AdminKpis.revenue30d` made nullable, "null for staff".

### Rulings taken

1. **`admin` reads tables through native SQL, not other contexts' repositories.** `date_trunc`
   bucketing is inexpressible in JPQL, and injecting seven repositories from six contexts would give
   each a `countBy…` method existing only for this screen. The cost is named: a column rename
   elsewhere breaks this at runtime, which is why every query has an endpoint test.
2. **Revenue is admin-only, everywhere.** `/admin/finance` is admin by contract, so the staff-visible
   dashboard blanks `revenue30d` (S61) — otherwise the role split on the next endpoint is decorative.
3. **Revenue excludes GST** (collected for the government) **and service orders** (a quote is not a
   receipt). Paid markers had to be chosen per source because two of the three status vocabularies
   cannot distinguish paid from abandoned: rent `status='paid'`, subscriptions
   `payment_ref is not null and status <> 'pending'`, boosts `starts_at is not null`.
4. **`pendingModeration` counts `properties`, not `property_reviews`** — a review row may only exist
   once a moderator opens it, so counting reviews would under-report the queue.
5. **Settings PUT deep-merges.** Every `AdminSettings` property is optional, so `{"flags":{…}}` is a
   well-formed *whole* document; under replace semantics saving the feature-flag panel would delete
   the fee table and the platform would start charging its compiled-in defaults. Objects merge key by
   key, arrays and scalars replace wholesale, `null` is skipped, recursion bounded at depth 12.
6. **Society-lead mobiles are NOT masked**, the one deliberate exception on the platform. Elsewhere a
   number was given in order to sign in; here it was typed into a form that means "call me about my
   building", and masking it leaves ops a lead it cannot work.
7. **The public submit is rate-limited against the table**, 3 per mobile per hour, because there is no
   session to hang an in-memory bucket off and a counter that resets on deploy is not a limit.
8. **Society-lead status is not a state machine.** A `lost` lead that answers the phone goes back to
   `contacted`; only unknown values are refused.
9. **`ContentItem` is one flat record, not a `oneOf` of four.** The `{type}` path parameter is already
   the discriminator; a union would restate it eight more times.
10. **Archive and restore are idempotent** and only audit when they actually change something.

### Review findings actioned

- **The first weekly/monthly bucket under-counted** (`java-reviewer`, real). Java aligned the bucket
  list to Monday / the 1st but the SQL window still started at the caller's `from`, so a Wednesday
  request produced a Monday bucket holding only Wednesday onwards — a bucket silently reporting a
  fraction of itself, invisible on a chart. Fixed by aligning the query start too, with a regression
  test that inserts a Monday signup and asks from Thursday.
- **"Rent is bucketed in UTC while the others are in IST"** (`java-reviewer`, **rejected**).
  `paid_date` is a `date`; `cast(date as timestamp)` involves no zone at all, and the column already
  holds the IST calendar day written by `LocalDate.now(IST)`. The suggested fix — casting through
  `timestamptz` — would have *introduced* the shift it claimed to remove. A comment now says so.
- `security-reviewer` returned clean on all seven categories it was asked to check, including a
  full trace of the `String.formatted()` SQL fragments (every one is a compile-time literal chosen by
  a validated switch) and the new `permitAll` matcher (POST-only, exact path).

### Recorded debt

D63 (`payoutsCompleted`/`refunds` structurally zero), D64 (boost revenue inferred from `starts_at`),
D65 (service orders excluded from revenue), D66 (settings PUT has no version/ETag),
**D67 (`settings.permissions` and `customRoles` are stored and never read — High; an admin editing
the permission map will believe they changed access control)**, D68 (reports queue absent from the
dashboard), D69 (analytics uncached).

### Lessons

- **When the same value is computed twice, in two languages, test that they agree — not that each is
  individually plausible.** The bucket-alignment bug survived a test asserting the bucket *dates*
  were right, because the dates were right; only the counts inside them were wrong.
- **A reviewer finding can be confidently argued and still be backwards.** The rejected timezone
  finding came with a worked example and a patch that would have broken working code. Checking what
  `cast(date as timestamp)` actually does took two minutes; applying the patch would have cost a
  quarter's revenue reporting.
- **Flyway's "changes successfully rolled back" is not always true of the database you are pointing
  at.** A stale `society_leads` table from an aborted earlier run made every one of 613 tests fail
  with a context-startup error that named the migration, not the cause.

---

## RESULTS — slice 15 (share-flat + admin listing correction, 4 ops) — SHIPPED

`mvn -o verify` — **644 tests, 0 failures**. Spec coverage **178 / 178** operations; the
`SpecCoverageTest` floor moved 174 → 178, which makes it an equality rather than a ratchet. One
migration: **V25** (`share_flat_interests`). **The backend now serves every operation the contract
declares.**

### What shipped

| Ops | Surface |
|---|---|
| 3 | `GET` (public) + `POST /share-flat/posts`, `POST /share-flat/posts/{id}/interest` |
| 1 | `PATCH /properties/{id}/admin` — `adminUpdateProperty` |

New package `engagement/shareflat` (8 files) over V7's existing `share_flat_posts` table plus the new
`share_flat_interests`. No new context, so `ArchitectureBoundaryTest.LAYER` was untouched.

### Spec fixes first (S62–S67)

- **S62** — `ShareFlatPost.postedBy` typed as `allOf: [Party]` with `mobile` documented as **always
  null, not masked**. On a `security: []` list there is no caller to gate against and no request the
  poster could approve, and a masked number on an anonymous page is a published number with five
  digits removed. Precedent: `PropertySummary` carries no owner contact at all.
- **S63** — `createShareFlatPost` gains `x-roles: [buyer, owner]`.
- **S64** — bounds on `ShareFlatPostCreate`: title 4–120, locality 2–80, rentShare 1–10 000 000,
  occupation ≤80, `additionalProperties: false` on preferences, plus `422` and `429`.
- **S65** — `shareFlatInterest` gains `403`/`404`/`422`/`429` and states the contact ruling and the
  idempotency in the description, because neither is guessable from the signature.
- **S66** — `listShareFlatPosts` documented: newest first, archived excluded, `locality` an exact
  case-insensitive match on free text and deliberately *not* joined to the locality catalogue.
- **S67** — `adminUpdateProperty` gains `404` and `422`.

### Rulings taken

1. **The contact gate runs backwards on this surface, and that is correct.** Everywhere else a seeker
   asks and an *owner approves* before a number moves. A flatmate board has neither half of that:
   there is no listing to request against, and the poster is usually a tenant. So: the public board
   publishes **no** contact at all; pressing "I'm interested" hands over the **sender's own** name and
   number; nothing flows back. The gate exists to stop your number being given out without your say-so
   — it was never meant to stop you giving it out yourself, and pressing a button on one named ad *is*
   the affirmative act the gate exists to require.
2. **Delivery is a `Notification`**, because the contract offers no other channel (201, no body, no
   "who answered my ad" endpoint). This makes share-flat the **first and only writer of the
   `notifications` table** — recorded as **D70**, because a dismissed notification loses the lead.
3. **Interest is idempotent per (post, sender)**, enforced by a unique index. A resend rewrites the
   message and deliberately does **not** notify again: a channel where pressing a button repeatedly
   produces repeated alerts on a stranger's phone is a harassment tool with a rate limit on it.
4. **The two caps have deliberately different shapes.** Live posts are a **count** (5) — someone
   advertising thirty rooms is a brokerage whether it took an hour or a month. Interests are a
   **rate** (10/hour) — each one is *delivered* to a different stranger. A resend costs no budget.
5. **`adminUpdateProperty` does not revert the listing to `pending`** — the one behavioural difference
   from the owner's PATCH. Re-moderation exists so an owner's edit is seen by a moderator; here the
   moderator *is* the edit, so reverting would push their own correction into their own queue and take
   the listing off the site until someone re-approved it.
6. **It reuses `ListingService` rather than re-mapping `ListingUpdate`.** The field mapping was
   extracted to `private boolean apply(Property, ListingUpdate)` and is now shared by `update()`
   (owner, reverts) and `updateAsModerator()` (staff/admin, audits, does not revert). A second copy of
   that mapping would have drifted on the first new field.
7. **Two writes use `saveAndFlush` on purpose.** The notification *is* the delivery; flushing it at
   the point of the write attributes a failure to the interest that caused it rather than to whatever
   else is in the transaction at commit.

### Review

`security-reviewer` and `java-reviewer` both ran. Confirmed clean: no PII on the public endpoint
(`mobile` is hard-null), the released number is read from the authenticated principal and cannot be
spoofed from the body, the poster's number never flows back, authorisation is right on all four
endpoints, no injection, schema integrity sound, no PII in logs or audit payloads. The
`ListingService` extraction was verified field-by-field as behaviour-preserving for the owner path.

Findings acted on: **one**. The 5-post cap told the user to "archive one before adding another" when
no archive operation exists — reworded, and recorded as **D71**.

Findings rejected after checking the source, and why:
- *"`Page.map` lazy-loads outside the transaction"* — `PageImpl.map` converts eagerly, inside
  `board()`.
- *"`join fetch` + pagination paginates in memory"* — true for collection fetches; `poster` is
  `@ManyToOne`, which produces no duplicates and keeps `LIMIT` in SQL.
- *"`numericEquals` should also cover `price`"* — `ListingUpdate.price` is a `Long`; `bhk` is the only
  `BigDecimal` foundation field and it already uses it.
- *"a concurrent duplicate insert returns 500"* — it returns 409 via `GlobalExceptionHandler`, and the
  suggested catch-and-re-read is the pattern this codebase bans for poisoning the persistence context.
- *"the rate limits are racy"* — true, but `OtpService` and `SocietyLeadService` are identical.
  Recorded platform-wide as **D73** instead of patching one of three.

### Debt recorded

**D70** no read-back of who answered · **D71** no way to take a post down · **D72** the board is
unmoderated and public · **D73** check-then-write rate limits are racy platform-wide.

---

## RESULTS — D1 (Lombok on entities)

First tech-debt item after the vertical-slice programme finished. `docs/system/tech-debt.md` §1 had
this DECIDED with the trigger "after the last backend feature slice ships"; slice 15 fired it.

**Outcome: `mvn -o verify` green at 646 tests, 0 failures — the identical count to before.** That
equality is the whole proof: this was a pure refactor, so any change in the number would have meant
behaviour moved.

### What changed

| | |
|---|---|
| Entities converted | **62** |
| Class-level `@Getter` | 62 |
| Field-level `@Setter` | **139** |
| `@Getter(AccessLevel.NONE)` | 9 |
| Hand-written trivial accessors remaining | **0** |
| Hand-written accessors with real logic, kept | 4 |

Plus `backend/lombok.config` (new) and the Lombok wiring in `backend/pom.xml`.

### The one thing the register got wrong

§1 assumed **34 entities** and prescribed class-level `@Getter @Setter`. The survey found **62**
entities, 485 fields, 476 trivial getters — but only **139 trivial setters**.

That gap is the point. About **345 fields have no setter by design**; `City`'s own Javadoc says
*"Reference data — seeded, never written by application code, so no setters."* Class-level
`@Setter` would have generated a public setter for every one of them and silently undone the
immutability those entities were written to have.

So the rule applied was **class `@Getter` + field-level `@Setter` only where a setter already
existed**. The post-conversion `@Setter` count is 139, exactly matching the 139 removed — the
public API is byte-for-byte the same shape it was. §1 has been amended to record this.

### Deliberately not converted

- **9 fields keep no getter** via `@Getter(AccessLevel.NONE)`, each with a Javadoc reason. Three
  `idempotencyKey` fields (`Boost`, `ServiceOrder`, `Subscription`) must never reach a response
  body; `Referral.handledReason` is fraud-desk internal; `ReferralCode.createdAt`/`updatedAt` and
  `DealParty.updatedAt` are bookkeeping nothing reads. The sharpest are
  `ReviewChecklistItem.review` and `ReviewMessage.review` — `@ManyToOne` back-references where a
  getter closes the `PropertyReview → children → review` cycle into **infinite recursion** on
  serialisation.
- **4 accessors carry logic**: `Property.isPubliclyVisible()`, `OtpCode.isExpired()`,
  `RefreshToken.isExpired()`, `DocumentRequest.setCategories()` (defensive copy).

### Checks run rather than assumed

1. **Boolean naming — 0 collisions.** Lombok emits `isX()` for primitive `boolean`, `getX()` for
   the `Boolean` wrapper; the codebase already matched, so no call site or mapper moved.
   `Property.negotiable` is the wrapper case and keeps `getNegotiable()`.
2. **MapStruct really consumes Lombok output.** Read the generated `CityMapperImpl.java` and
   confirmed `city.getSlug()` / `getName()` / `isLive()`. `annotationProcessorPaths` is ordered
   lombok → lombok-mapstruct-binding → mapstruct-processor and that order is load-bearing.
   `PropertyMapper` has `unmappedTargetPolicy = ERROR`, so mis-ordering fails loudly. Do not relax it.
3. **The ban list bites.** Injected `@ToString` onto `City` → build failed with *"Use of @ToString
   is flagged according to lombok configuration"*, then reverted. Lombok locates the config by
   walking *up* from the source file, so moving `backend/lombok.config` would disarm every rule.
4. **Accessor audit re-run after conversion**: 0 trivial getters, 0 trivial setters, 4 non-trivial
   survivors, 139 setters. Numbers above come from that run, not from the conversion script.

### Constraint worth remembering

Builds run **offline**, and the Boot 4.1 BOM manages Lombok **1.18.46**, which is not in the local
repository (newest cached is 1.18.44). `pom.xml` pins `1.18.44`, which is sufficient — JDK 25
support landed in 1.18.40, Jackson 3 in 1.18.44. Drop the pin when the network allows 1.18.46.

### Review

`java-reviewer` on eight representative entities plus `lombok.config` and `pom.xml`: **no findings**
across all five categories asked (missing/renamed accessor, new getter, new setter, visibility
change, processor config). It did transcribe the config key as `lombok.equalsAndHashHash` — checked
the file, it is correctly `lombok.equalsAndHashCode` on line 22. Consistent with the standing note
that reviewer output here must be verified against the source before acting.

### One unplanned fix — `backend/bin/` was untracked but **not ignored**

Found while checking the index was clean at the end of the batch. Eclipse/the VS Code Java language
server writes an output tree at `backend/bin/` that mirrors the whole project: **713 untracked
files**, including `.class` files, a duplicate `lombok.config`, a duplicate `checkstyle.xml`, and
copies of the loose `.py` scripts. Nothing was tracked there, so there is no history to clean —
but a single `git add -A` would have committed all 713.

The cause is that `backend/.gitignore`'s `### STS ###` block is the Spring Initializr template with
three lines missing. Restored them verbatim:

```
bin/
!**/src/main/**/bin/
!**/src/test/**/bin/
```

Untracked count under `backend/bin/`: **713 → 0**. Total untracked across the repo: 713 → 394,
the remainder being genuine new source since `36d7651`.

Related but **not** touched: `backend/` also holds `flyway_checksum.py`, `gen_seed.py`,
`scan_spec.py`, `speccheck.py` and `apply_v9.sql` loose at its root. These are all **untracked**, so
they are not the D18 problem (which was about a *tracked* script) and moving them would break
whatever muscle memory you have for running them. Flagging, not fixing.

### Next in the register

**D34** (shared test fixtures — best value now that no further slice will add duplication), then
**D33** (trim ceremonial `@param` lines), **D36** (Spotless + ArchUnit, shrink Checkstyle).

---

## RESULTS — autonomous tech-debt batch (D23a, D31, D62, D39, D27, D18, D34, D43)

Everything in this block was picked by one filter: **no product decision, no spec change, no
external credential.** Anything needing an answer from you was left alone and is listed at the end.

**Build: `mvn -o verify` → 650 tests, 0 failures.** Baseline before the batch was 646; the four new
ones are named below.

### D23a — mobile pattern conformance (was High)

The register said two sites. There were **three**.

| File | Before | After |
|---|---|---|
| `deals/deal/DealCloseRequest` | `^[0-9]{10,15}$` | `^[6-9][0-9]{9}$` |
| `deals/deal/DealPartyCreateRequest` | `^[0-9]{10,15}$` | `^[6-9][0-9]{9}$` |
| `leads/conversation/ConversationCreate` | **no pattern**, `@Size(max=20)` | `^[6-9][0-9]{9}$` |

`DealPartyCreateRequest` is the one that carried a live bug: `DealService.addParty` stores
`body.mobile()` **unnormalised**, so a 15-digit value persisted verbatim and `MobileMask.mask()`
— which returns `null` for anything that is not exactly 10 digits — made every masked read of
that party come back `null`. A loose regex became a data-integrity bug.

`ConversationCreate` had no pattern at all, which the register never noticed.

New tests (3): `DealEndpointsTest.close_offContractMobile_rejectedBeforeItReachesTheDeal`,
`addParty_offContractMobile_rejectedRatherThanStoredUnmaskable`, and
`ConversationEndpointsTest.Oracle.malformedMobileIsRejectedAtTheEdge` — the last also asserts the
422 is **not** an enumeration oracle. No existing fixture relied on the loose form: every test
mobile already started 98/9876/9830.

**This is not D23.** D23 is the `common.validation` package that removes the *cause*, and it is
still blocked on Q1 (`open-questions.md` line 22 — "what is a valid mobile on input?"). The
register explicitly marks D23a separable; only the separable part was done.

### D34 — shared test fixtures (was Med-High, the largest item)

Re-counted the duplication before touching anything, and the register's estimate ("22 classes /
17 identical `bearer()`") **understated it**:

| | Before | After |
|---|---|---|
| classes autowiring `MockMvc` | 35 | 1 |
| classes autowiring `JwtService` | 34 | 1 |
| classes autowiring `JdbcTemplate` | 19 | 1 |
| `bearer()` declarations | 30 | 5 |
| …of which byte-identical | **26** | **0** |

New `support/AbstractApiTest` carries `@SpringBootTest + @AutoConfigureMockMvc + @Transactional`,
the three fields, and `bearer(User)`. **34 classes extend it**, ≈400 lines removed.

Three things worth recording:

1. **A base class, not the `@TestComponent` the register sketched.** Those three annotations must
   sit on the test class or something it inherits — they cannot be injected. Once a superclass
   exists for them, the fields belong there too.
2. **`user()` and `listing()` were deliberately NOT hoisted.** 24 `user()` declarations have **19
   distinct bodies**; 16 `listing()` have 9. They differ in display name, locality, price, status
   — they encode each test's preconditions. Hoisting means an unreadable parameter list or a
   default that silently changes what a test asserts. That half of D34 is closed as *not worth
   doing*, not as done.
3. **`services/ServiceFixtures` held a 27th copy** of `bearer()` and was not in any census. It now
   extends `AbstractApiTest` and keeps only what is genuinely slice-11's — the team-scoped
   `staff()` builder and the multipart helpers.

**The one real risk was `@Transactional` inheritance.** If Spring had not resolved it up the
hierarchy, tests would bleed data and fail on unique constraints. A full green suite at 650 is the
proof; there is no cheaper one.

**Boot 4 moved `AutoConfigureMockMvc`** to `org.springframework.boot.webmvc.test.autoconfigure`.
Guessing the Boot 3 path cost a red build and a stale-import sweep across 29 files. Worth knowing
before writing any new test base class here.

### D43 — collapse the `parseUuid` duplicates (was Low, "three copies")

There were **19**, under five different names: `parseUuid`, `parseId`, `parseTenancyId`, `tryUuid`,
`uuid`, and four `load(String)` methods that inlined the same try/catch before a `findById`. Three
distinct failure answers:

- **null** — services that have an existence check right after (`ListingService`, `VisitService`,
  `OfferService`, `FinalizationService`, `PropertyService.tryUuid`) → `Ids.parseUuid(t).orElse(null)`
- **404** — controllers with nothing further to look up, each with its own message →
  `.orElseThrow(() -> new NotFoundException("…"))`
- **400** — exactly one, `NotificationController`. Left alone; see below.

The four `load(String)` methods collapsed best — 9 lines to 4 — because parse-then-find-then-404
is one expression:

```java
private Property load(String id) {
    return Ids.parseUuid(id)
            .flatMap(properties::findById)
            .orElseThrow(() -> new NotFoundException("Property not found"));
}
```

Six one-line private delegators were **kept** rather than inlined, in the controllers with 4–8
call sites: inlining `orElseThrow` eight times reads worse than the helper. The duplication D43
targets is the try/catch, and that is gone. The per-site 404 message stays at the call site because
it is the only part of the decision that is genuinely local.

**New debt raised: D74.** `NotificationController` answers **400** for a malformed id and echoes the
token back, while `common.web.Ids` documents — with reasoning — that a non-UUID is a 404 miss.
Collapsing the parse without changing the answer was the honest move; changing an API response code
as a side effect of a refactor is not something to do unasked. No test asserts either code, so
nothing pins it today.

### The four smaller ones

- **D62 — silent catalogue-row fallback.** `BoostService` now warns when the `BoostPack` is gone.
  `SubscriptionService` was **restructured** to resolve `Optional<Plan>` first, because the old
  `.map(…).orElse(null)` could not tell **plan deleted** from **unrecognised billing cycle** —
  two different operational problems that logged as neither. They now warn differently.
- **D39 — ghost `.java` files.** New `foundation/SourceTreeHygieneTest` walks both source trees and
  fails naming any file that declares nothing after comments/`package`/`import` are stripped.
  **Verified by planting one** (a zero-byte `auth/LoginRequest.java` and a package-only
  `auth/Ghost.java`) and watching it fail with both names, then removing them. A JUnit test rather
  than an enforcer or antrun rule because **neither plugin's jars are in the offline repo** —
  `maven-enforcer-plugin` is absent entirely and `maven-antrun-plugin` is cached without Ant core.
  Accepted limit: a ghost carrying a syntax error still fails at compile first.
- **D27 — `AGENTS.md`.** The referenced `.github/instructions/ui-design-consistency.instructions.md`
  has never existed; now points at the skills. "Spring Boot 3" → 4.1.
- **D18 — `validate_spec.py`.** Moved to `backend/tools/`, `SPEC` made script-relative so it runs
  from any cwd, PyYAML import guarded, stale `createTenancy` check dropped. Verified: 142 paths /
  123 schemas / **178 ops** / 0 dangling refs / 0 orphans, exit 0.

### Deliberately not attempted

Each needs something I do not have.

| | Why not |
|---|---|
| D23 | blocked on **Q1** — what counts as a valid mobile on input |
| D33 | needs `api-standards.md` §10 amended first; delete the 232 `@param` lines without changing the rule that mandates them and they grow back. Changing a documented standard is your call |
| D2 / D73 | rate-limiting infrastructure — a design, not a fix |
| D22 | rotating the Maps key needs console access |
| D57 / D59 / D67 | High, but each needs a decision: a scheduler, a ranking design, and a wire-or-remove call on `settings.permissions` |
| D40 | magic-byte upload sniffing is self-contained and the best next candidate, but it changes upload accept/reject behaviour, so it wants its own test pass |
| D71 / D72 | need a spec addition |

### Next in the register

**D40** (upload content sniffing) is the largest self-contained item left. Everything above it in
priority — D2, D22, D57, D59, D67, D71, D72 — is waiting on a decision rather than on effort.

---

## RESULTS — tech-debt register audit and cleanup

Asked: what is left, and remove what is finished. Both done. `mvn -o verify` re-run after the
external edits that landed between sessions: **650 tests, 0 failures** — unchanged.

### Three items were already done and nobody had marked them

This is the part worth keeping. Reading the register top to bottom against the source found three
rows describing work that had shipped slices ago:

- **D3 — "ArchUnit boundary test for feature→feature imports."** `foundation/ArchitectureBoundaryTest`
  has been enforcing this for a while, and **not** the way D3 proposed. D3 wanted an allowlist and
  said the rule was theatre because it would ship with two entries. The test that exists instead
  ranks every context and permits imports only *downward*, so there is no allowlist to grow — and
  it catches fully-qualified inline references, which a bytecode import rule misses. D3's own
  trigger ("revisit when a third exception appears") is moot: the design has no exceptions. Closed
  as delivered-differently, with no ArchUnit dependency.
- **D6 — "Review moderation queue + `reviews.archived`."** The queue shipped. The column was
  **deliberately refused**, with the reasoning written into `V18__moderation_admin_indexes.sql`:
  `reviews.status` already carries moderation state and every read — including the rating aggregate
  — filters `status = 'published'`, so a second boolean would be two columns for one concept and a
  second way to be invisible that the aggregate does not know about. The migration even says it is
  recording this "so the deferred item is closed by reasoning rather than left looking forgotten."
  It was then left looking forgotten in the register for several slices.
- **D8 — "Tenancy creation on rent-close."** `DealService.close` calls
  `tenancyService.openFromClosedDeal` in the same transaction for RENT deals and logs both branches.

**The lesson is about the register, not the code.** All three were closed *in the artefact where the
work happened* — a test, a migration comment, a service method — and the register was never told.
Rule 4 already says an entry is marked done by the slice that does it; that step is the one being
skipped. Worth checking the register against source at the end of each slice, not only when asked.

### What was removed

13 delivered items lifted out of §4 into a new **§5 "Delivered"** table: D1, D3, D6, D8, D14, D18,
D23a, D27, D31, D34, D39, D43, D62.

They were **moved, not deleted.** The register's own rule 3 says an item that quietly stops being
mentioned is the unacceptable outcome, and the numbers are cited from source Javadoc (`Ids.java`
points at D43 and D74), from RESULTS blocks in this file, and from prior checkpoints. Deleting the
rows would leave every one of those references dangling. Numbers are never reused; new debt
continues at D75.

Also cleaned up, because they were stale the moment those items closed:

- the "Detail on the ones that need it" paragraphs for D3, D23a and D39 — each was advice on how to
  do work now finished;
- **D38's trigger was "with D3"**, which had silently become unreachable. Re-pointed at D36;
- §3's item index and effort-order line, which still led with D34 and D1;
- §5's two "REOPENED — see D39" rulings, now pointing at the guard that closed it;
- D36's row and the Checkstyle ruling, both of which described ArchUnit as future work.

### What remains: 62 items

**5 High, 2 Med-High, 29 Med, 26 Low.** Largest clusters: `design` 15, `security` 8, `reliability` 5.

**All five High items are blocked on something other than effort** — the most useful single fact
about the list, and now stated at the top of §4:

| # | Needs |
|---|---|
| D2 | a rate-limiter design (pairs with D73 — one atomic principal-keyed counter answers both) |
| D22 | console access to rotate the Maps key |
| D57 | a scheduler; nothing in the platform runs on a timer yet |
| D59 | a ranking design — what a paid boost is worth against relevance |
| D67 | a wire-or-remove call on `settings.permissions` / `customRoles` |

**Actionable today with no decision from you:** D40 (magic-byte upload sniffing) is the largest and
the best next candidate; then D36 (Spotless, if the repo has it), D66 (settings ETag), D48
(optimistic locking), D54 (find-or-create race), and the one-liners D24, D25, D35, D46, D49, D60,
D74.

**D33 is blocked** — not on effort but on `api-standards.md` §10, which mandates the Javadoc that
produced the 232 ceremonial `@param` lines. Deleting them without amending the rule just grows them
back, and amending a documented standard is your call.

### One new item found during the sweep — D75

Cleaning up temp scripts surfaced **sixteen 0-byte files**, all dated 2026-07-31 — the same day as
the D39 ghost-file regeneration. D39 was recorded as a `.java`-under-`backend/src` problem and the
guard was built to match. It is not; the generator reaches `.sql`, `.py`, `.mjs`, `.jsx`, `.js`
and `.md`.

Ten were untracked, unreferenced, and **deleted this pass**: `backend/apply_v9.sql`,
`flyway_checksum.py`, `gen_seed.py`, `scan_spec.py`, `speccheck.py`, `verify_checksums.py`,
`e2e/debug-live.mjs`, `_guard_probe.mjs`, `_race_probe.mjs`, and three in `tasks/`
(`_s7lessons.md`, `_s7results.md`, `slice7-plan.md`).

Six could not be deleted unilaterally and are now **D75**:

- `frontend/.../MapInner.jsx` and `.../QuickFilters.jsx` — both **committed at 0 bytes**, neither
  imported anywhere.
- `e2e/tests/listings-mobile-only-controls.spec.js` — committed at 0 bytes. **This is the one that
  matters.** Playwright finds no tests in it and reports nothing; the suite is green and the named
  scenario is untested.
- `e2e/_live_auth_probe.mjs` and `_crosstab_refresh_probe.mjs` — untracked and empty, but
  `LOCAL_DEV.md` lines 109 and 112 instruct a developer to run them. `node _live_auth_probe.mjs`
  exits 0, so the documented check appears to pass while doing nothing.

They are tracked or documented, so removing them is a frontend/docs change rather than a cleanup.
The fix D75 actually asks for is one-sided: widen `SourceTreeHygieneTest` past `.java` so the next
recurrence is found by the build instead of by accident.

Register now: **63 open**, next number **D76**.

---

## RESULTS — tech-debt batch: concurrency and one spelling of a rule

`mvn -o clean verify` green at **675 tests, 0 failures** (from 662). Spec guardrail clean: 142 paths,
123 schemas, **178 ops**, 0 dangling refs, 0 orphan schemas. Nothing staged — commits are yours.

Three items closed, and **all three shipped differently from what their register trigger proposed.**
That is the theme of this batch: each trigger was a guess written when the problem was noticed, and
in each case reading the code changed the answer.

### D48 — optimistic locking

- New `common.persistence.VersionedEntity`; `Ticket`, `ServiceRequest`, `SupportTicket` extend it.
  `V26__optimistic_locking_ops_queues.sql` adds `version bigint not null default 0` to those three.
- `OptimisticLockingFailureException` → **409**, with a different sentence from the constraint-
  violation 409: the caller did nothing wrong, and "reload and try again" is advice the other 409
  cannot give.
- **The trigger said "platform-wide, with `@Version` on the audited entities". Rejected.** That is
  **37** tables including `users`, `properties` and `transactions` — none of which have a second
  concurrent writer — in exchange for a new failure mode on every write path and a landmine under
  every raw-SQL test fixture. The reasoning is in `VersionedEntity`'s Javadoc, so the narrower scope
  reads as a decision rather than an oversight. The full suite confirmed it: nothing moved but the
  new tests.
- Three tests, **none threaded**. A race reproduced with threads is a race reproduced *sometimes*;
  what makes a lost update possible is staleness, not simultaneity, and staleness is deterministic.
  The suite's `@Transactional` harness hands two requests the same entity instance, so the test
  detaches one copy — which is what restores the situation production actually meets.

### D25 — one spelling of the mobile rule

- The regex was inline at **nine** sites with **three** different messages, so one rule was described
  three ways depending on which endpoint rejected you.
- New `common.validation.Formats` holds the pattern and its message **together**. §2 had sketched a
  separate `ValidationMessages`; splitting them is precisely what lets them drift.
- `foundation/SharedFormatsTest` fails the build on a tenth inline copy. Hoisting the nine that exist
  does nothing about the next one — and "nothing objected" is how three messages appeared.
- PAN, Aadhaar, IFSC and account number **stayed put**: one call site each, so §2's own admission
  criteria exclude them.
- **Not blocked on Q1.** Q1 decides what the regex *is*; D25 was only ever about there being one of
  it, and having one turns the eventual Q1 change from nine edits into one. (Same mistaken "with
  D23" trigger that D24 had.)

### D66 — conditional writes on `/admin/settings` (spec fix **S68**)

- `GET` returns a strong `ETag`; `PUT` honours optional `If-Match` and answers **412** — nothing
  written, no audit row. New `PreconditionFailedException` / `ErrorCodes.PRECONDITION_FAILED`.
- **`@Version` on `Setting` would have been wrong.** The resource is the union of several `settings`
  rows, so a per-row counter cannot describe "the document you were looking at". A content hash also
  gets a property a counter gets wrong: saving a block unchanged leaves the tag alone, so pressing
  Save twice does not invalidate a colleague's open editor for nothing.
- Body and tag return together (`SettingsDocument`), because computing them in two transactions can
  hand a caller a tag for a document they were never shown — and on the `PUT` path that fails in the
  *dangerous* direction.
- Optional header, so nothing existing broke. `*` and comma-separated lists honoured per RFC 9110;
  weak tags are not, because `If-Match` requires strong comparison. Seven tests.
- `api-standards.md` §3 now documents 412 and the 409-vs-412 split.

### Register

**55 open** (was 58): 5 High, 2 Med-High, 27 Med, 21 Low. Next number **D76**. Next spec fix **S69**.

The "actionable today" list is now genuinely short, and the §4 note says why: **D38** is 22 files of
prose whose value depends on the prose being accurate, and **D46 / D49 / D60** are each waiting on a
consumer that does not exist — an unassign gesture, a message attachment, a share channel. Building
the field before the caller is how `settings.permissions` (D67) happened. What remains above those
needs a product or infrastructure decision, not an afternoon.


### Follow-up — self-poisoning OTP durability test (found during final verification)

The batch's closing `mvn -o clean verify` failed with one error that had nothing to do with D48 /
D25 / D66:

```
OtpServiceDurabilityTest.failedAttemptsAccumulateAcrossTransactionsUntilTheCapTrips
  -> RateLimited: Too many login codes requested for this number
```

It failed on the test's **first** line, `sendLoginCode`, before reaching anything it guards.

**Root cause.** `OtpServiceDurabilityTest` is deliberately *not* `@Transactional` — that is the
whole point of the test, since a rolled-back transaction would hide the cross-transaction attempt
cap it exists to prove. But nothing rolls its rows back either, and `sendLoginCode` rate-limits on
exactly those rows: `MAX_SENDS_PER_WINDOW = 5` per mobile per rolling hour, counted straight out of
`otp_codes`. The test hard-codes one number and writes one row per run, so the **fifth run inside an
hour** fails — and fails in the least informative place possible. Every earlier green run was green
only because the counter had not filled yet.

**Fix.** The test now establishes its own precondition instead of assuming a fresh database: a
`@BeforeEach @AfterEach` method deletes `otp_codes` rows for its own number. Before, so a crashed
prior run cannot poison it; after, so it leaves nothing behind for the next one.

**Verified.** `mvn -o clean verify` -> BUILD SUCCESS, **675 tests, 0 failures**. A direct
`select count(*) from otp_codes where mobile = '9876500911'` after the run returns **0**, which is
the property that actually makes repeat runs safe — a green build alone would not have proved it.

**Checked for siblings.** The only other `@SpringBootTest` classes without `@Transactional` are
`PunenestApiApplicationTests`, `RecurringIntervalsTest`, `SpecCoverageTest` and the two Cashfree
provider tests. None writes durable rows that anything later reads, so none has this shape.

Not a register item and not added as one — it was a defect in a test, fixed where it was found.

<!-- above: feature/backend-integration | below: feature/ui-mobile-improvements -->

## Mobile review: B5 / C5 / D1 + CI (DONE) and B7 (blocked)

Worked the four items that were actionable without a backend, then stood up CI.

- [x] **B5 — z-index ladder now covers toasts, and the ladder is consistent.**
      The toast was already at 1600; what the audit missed is that the ladder was
      written down *twice* (`design-system.md` and the `:root` comment in
      `index.css`) and the two disagreed — the CSS copy was also missing the
      autosave flash at 90. Both now read
      `… blocking modals 1500 / toasts 1600`, with the reasoning for why toasts sit
      on top (a toast is a receipt for a user action, so it must outrank the surface
      that triggered it; hence `pointer-events: none` on the container).
      Swept every rung actually in use rather than trusting the item text, which
      found a *second* undocumented `z=2000`: the `/services/interior` lightbox,
      above the toast layer. Moved to the 1500 modal rung.
      The sweep also surfaced a whole upper band the ladder never described
      (`.pn-action-sheet`/`.pn-dropdown__menu--sheet` 9999, `.pn-cal` 2000, skip
      link 9999, maintenance overlay 99999). Documented as a table, including the
      honest note that an action sheet currently outranks toasts. **Not** restacked
      silently — that changes live tap/focus behaviour and needs its own pass.
- [x] **C5 — audited, no offenders remain.** Measured painted heights of every
      pill-shaped control at 360x640 across `/`, `/listings`, `/flatmates`,
      `/societies`, `/plans`, `/compare`, `/locality`, `/locality/:slug`.
      `--control-h` is 44px at that width and nothing lands under 40px except two
      deliberate `.tap-extend` controls (32px Back tile, 20px assistant Dismiss),
      both with a transparent 44px hit area. The 30–32px pills the audit saw were
      already fixed by the earlier control-token work.
- [x] **Genuine regression found while measuring** (not in the review): the
      Save-property heart on `/` Featured cards painted 36x36 with no hit
      extension and was failing `tap-targets.spec.js` on both mobile projects.
      Given `.tap-extend`, which keeps the 36px tile the card art is built around.
      Sweep went 2 flaky -> 24/24.
- [x] **D1 — field-ops route set defined.** `design-system.md` now opens the
      mobile-first section with which routes are mobile-supported: all consumer
      routes, plus `/ops` and its eight queues (enumerated from the router, not
      guessed) and `/admin/properties`. The other fifteen `/admin/*` routes are
      named as desk-only, with the bar they must still clear (usable, unclipped)
      separated from the one they need not (mobile polish).
- [ ] **B7 — blocked, needs a product call.** The density is real and measured:
      7 targets, 265px of painted control in a 360px row, 8px gaps, account pill
      ending at exactly x=360. But the item's escape hatch does not exist — the
      bottom nav is Reels/Search/Post/Flatmates/Services and has never held
      Saved/Notifications/Messages, and `acctItems()` carries a comment recording
      that those three were *deliberately removed* from the account drawer when
      they went inline. The top bar is currently their only route, so removing
      them would strand three destinations, not relocate them. Three options
      written up under the B7 row in the review; all seven targets already clear
      44px of hit area, so "accept the density" is a legitimate answer.

### CI (new — `.github/workflows/ci.yml`)

There was no `.github/` at all. Two jobs, split on purpose so a lint error is not
reported behind a browser install:

- `checks` — `npm ci`, lint, `check:i18n`, `check:help`, build, `check:size`.
  Each a named step so the failing gate is visible from the job list.
- `e2e` — matrix over `chromium` / `mobile` / `mobile-small`, Chromium only
  (all three projects are Chromium-based), report uploaded on `always()`.
  Playwright's own `webServer` starts the Vite dev server, so no manual step.

**`check:i18n` currently fails**, and CI will be red until it is fixed: 31
unresolved keys, all from two *untracked* files (`VerifyModal.jsx`,
`MobileSearchSheet.jsx`) belonging to in-flight work. The gate is correct; the
tree is dirty. Whoever owns those files needs to add the keys.

### Mobile suite after these changes: 322 passed, 1 flaky, 3 failed

None attributable to this work (my changes: `Featured.jsx`,
`InteriorRenovation.jsx`, an `index.css` comment, two docs):

- `phase3.spec.js` calendar docking (x2) — asserts on `.pn-cal`, which lives in
  `styles/components/date-time-fields.css`, an **untracked** new file from
  another session's in-flight work.
- `sheets-and-actions.spec.js` — "Close filters" width `43.99998474` vs a `>= 44`
  assertion. A sub-pixel rounding artifact, not a real undersized control; the
  assertion needs a tolerance.

## Home "Flatmates" tile — mobile optimisation (DONE)

Single file: `frontend/src/pages/consumer/home/FlatmatesSection.jsx`. CSS-class-only
change, no logic, no i18n, no new file.

- [x] Feature row (`Verified seekers` / `Women-only filter` / `No number sharing`)
      forced to **one line**: `flex-nowrap` + `whitespace-nowrap` + `shrink-0`,
      `text-xs` -> `text-[11px]` below `sm`, icons `w-4` -> `w-3.5`, gap `20px` -> `8px`.
      Measured: at 412px content == 340px == container width (exact fit, no scroll);
      at 360px it overflows 40px, so `overflow-x-auto no-scrollbar` + a
      `max-[399px]:` right-edge mask makes the cut intentional and swipeable.
      Fitting all three at 360 needs ~9.5px type, which is below a readable floor.
- [x] CTAs stacked full-width below `sm` (`w-full sm:w-auto`, `justify-center`,
      `py-3`), `hover:scale-105` scoped to `sm:` (no scale on touch).
- [x] Card padding `p-8` -> `p-5 sm:p-10`, radius `rounded-2xl sm:rounded-3xl`,
      body copy `text-sm` -> `text-[13px]`, tightened vertical rhythm.
- [x] Split-rent card: `p-6` -> `p-4 sm:p-7`, icon tile 44 -> 36, share price
      `text-2xl` -> `text-xl`, avatars 40 -> 32; `min-w-0` + `truncate` on the
      locality line and `shrink-0` on the arrow so the row never wraps or clips.
- [x] Verified: eslint 0, `npm run build` exit 0, no horizontal document overflow at
      412 or 360, `tests/consumer/home` 20 passed.

### Pre-existing failures (proven, not caused by this work)

Confirmed by `git stash push -- FlatmatesSection.jsx`, re-run, identical failure:

- `consumer/home/flatmates-rail.spec.js:18` — spec expects `/flatmates?view=flatmates`,
  the component has always navigated to `?view=team-up`. Spec and source disagree on
  the query param; needs a product decision on which is right.
- `consumer/home/entity-search.spec.js:84` — `page.goto` 30s timeout, part of the
  known `home-entity-search` / `qa-location-search` cluster already logged above.
