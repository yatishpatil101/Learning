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
> when the code is read; a worklog entry is not. Narratives are collapsed to index lines once
> committed; git history is the archive. Compressed 5,294 → 527 → 1,828 → this.

---

## In flight

- **Retire the mock — full-app migration to the live API + Postgres.** Plan (module-wise) lives in
  [`docs/migration/`](../docs/migration/README.md): R2 storage (already built, one flag), seed as a
  fixture contract, the new persistent `punenest_e2e` DB with real users, and the 22-domain
  migration matrix. Now also covers **moving business logic out of the browser into the backend**
  ([`05`](../docs/migration/05-logic-to-backend.md) — full `frontend/src/lib/` inventory) and
  **ponytail / comment hygiene / Sonar + Checkmarx**
  ([`06`](../docs/migration/06-code-quality.md)). Planning only — no code yet; branch
  `feature/backend-integration`. Start from the seed-fixture inventory (it sizes the effort);
  dominant cost is rewriting self-seeding e2e specs into seed-reliant / create-via-API specs.
  **Two open decisions:** Checkmarx (commercial, needs a licence) vs CodeQL (free, native); and
  whether to add caching once heavy lifting lands server-side — measure first per D133.

  **Phases 0, 1 and 3 are done** — `frontend/.env.live` + `dev:live`; the seed-fixture inventory and
  its named-fixture contract in [`docs/system/fixture-registry.md`](../docs/system/fixture-registry.md);
  and the persistent `punenest_e2e` database with real users that survive a backend restart, a fixed
  OTP under the `e2e` profile (three guards keep it out of production), and reset-to-baseline at run
  start. Phase 3.5 closed with no Java written. What each of those departs from the plan, and the
  proof behind it, is in [`03-e2e-database-and-users.md`](../docs/migration/03-e2e-database-and-users.md).
  Two things it left behind, both deliberately: `live-drafting-desk` was `test.describe.fixme`
  because **`/staff-login` was never converted to the live API** (that is Phase 4's `team` domain —
  since converted, and the spec now runs green), and **D216** records that an archived user reports
  `status: "active"` over the wire.
  The live property suite is now **green end to end** (39 passed / 8 skipped) against the persistent
  DB, and the sweep of the backend log afterwards found a scheduled job that had never worked —
  `ReferralSignalRetentionSweep` self-invoked past its own transactional proxy, so D55's ninety-day
  digest expiry had never run once. Fixed, mutation-proved by a deliberately non-transactional test,
  and written up in [`tasks/lessons.md`](lessons.md).
  **Phase 2 (R2) is done** and turned out to be a two-line change: `application.properties` already
  bound all six storage properties from `${R2_*}`, so the sandbox credentials in the git-ignored
  `.env.local` were the whole configuration and nothing committed moved. What it *was* worth doing
  was proving the public/private boundary above the storage class — the photo half had a live test,
  the document half had none, so a regression routing KYC files into the world-readable bucket would
  have passed the suite. `MePersonalDocumentsLiveTest` now closes that.
  **Phase 4 (the 22-domain matrix) is done**, and its long pole was not a domain but a screen:
  `photo`, `fees` and `team` were the last three ❌ rows, and `team` could not go live until
  `/staff-login` did, because it was the one page still authenticating against `lib/mockApi.js`.
  It now runs the same `/auth/login` mobile-OTP flow as everyone else and takes role and team from
  the server; the demo quick-access shortcuts survive only inside `{!authIsLive && …}` and go with
  the mock in Phase 5. Two findings worth more than the conversion itself. First, `live-drafting-desk`
  failed after being un-`fixme`d and the obvious reading — "the new sign-in is broken" — was wrong:
  Playwright's own page snapshot showed the staffer signed in correctly and the queue genuinely
  empty, because the fixture raised a `rent-agreement`, the one *priced* service type, which is
  created at `awaiting-payment` and excluded from `findForQueue` by design. The rental desk is
  therefore unreachable from e2e without forging a payment webhook or teaching the API to mark a
  request paid without money; both were refused and the fixture moved to the free `valuation` desk.
  Second, the photo test cannot assert its bytes come back, because `MockFileStorage.storePublic`
  mints URLs on a host that deliberately does not resolve — that claim belongs to
  `R2FileStorageLiveTest`, and asserting it in the browser would only have asserted which bean was
  wired. Reaching the photo input at all meant reaching wizard step 3, which the draft alone cannot
  do: `useFormDraft` restores `form` but not `locationSet`, so step 2 demands the map pin in *this*
  session — satisfied offline by the area search, which matches a known Pune locality against its
  own coordinate table before it ever calls Google.
  Next: Phase 5 (retire the mock provider). Two corrections to what this line used to say. The
  `feesProvider.js` NULL coercion it named as outstanding **does not exist** — the http provider
  already preserves the deliberately-NULL statutory pair and `useRentAgreement` already answers a
  NULL by deriving locally and listing the field in `cost.computed`, which is what makes the sidebar
  say "estimated total" rather than quote a price. And "retire the mock provider" understates the
  job by an order of magnitude: the legacy suite is 220 files / 1,541 tests, 164 of which seed
  through `localStorage`, and 58 source files import `lib/mockApi.js` directly, below the seam where
  `VITE_API_DOMAINS` cannot see them. Strategy chosen: convert in waves, delete last.

  **Wave 2b — the five per-team ops desks were retired rather than converted**, because in live mode
  they were already blind: consumers file through the seam into Postgres while `OpsServiceQueue`
  scanned `localStorage` keys nothing writes any more, rendering an empty, healthy-looking queue.
  A Ponytail check against the contract found three of their operations *cannot* exist —
  `setDocStatus`/`markDocsVerified` tick a checklist the server derives on read (D120) and
  `submitRegistration` sets a status `ServiceRequestStatus` refuses by name — so porting them meant
  re-implementing what the contract exists to prevent. The routes redirect into
  `/ops/drafting-desk?type=<team>`; `TeamRoute` and its `?denied=` banner were deleted, which
  widened nothing because `ServiceDeskAuthority.deskFilterFor` scopes a staff caller server-side
  (D44) — the guard only ever chose the error message, and the desk picker now does that job.
  Built in their place: the read-only D120 document checklist on the matter drawer. Lost honestly:
  share-draft, upload-final and document *viewing* have no ops surface at all. Full write-up in
  [`docs/migration/README.md`](../docs/migration/README.md).

  **Wave 2c — the ops ticket board went live-only**, because the mock's three statuses are not three
  of the server's five and there was no adapter to write. Dropped rather than ported: the client-side
  team narrowing (the server refuses another desk by name), the ticket ↔ service-request status
  mirror (it kept one `localStorage` store consistent with itself; the contract has no field for it),
  and the claim-also-advances behaviour — a claim now assigns and nothing else, because doing the
  second decision silently is how a queue reports work in flight that nobody has started.
  **Two infrastructure defects surfaced, both of which would have shipped:** the live Playwright
  config's `VITE_API_DOMAINS` is a hand-maintained list, not `*` (so every new live domain must be
  added there, and a manual `dev:live` will not reproduce the failure); and `services/config.js`
  built its known-domain set from the **mock** registry alone, so the first domain with no mock
  provider looked like a typo and blank-paged the entire app before React mounted.

  **Wave 2c part 2 — the referral fraud desk went live-only, and the Aadhaar gate moved to the
  server.** This is the migration's first *backend* change, and it is a Ponytail case that came out
  the other way: `canQualify()` greyed out Approve in the browser under a banner calling the check
  mandatory, while `POST /referrals/{id}/approve` paid anyone who called the endpoint directly. That
  is a hole, not a duplicate, so the rule was ported — reading the referee's **current** Aadhaar
  badge rather than the referral's `updatable = false` redeem-time snapshot, because redeem-then-verify
  is the ordinary order and gating on the snapshot would have refused the very referrals the scheme
  exists for. The refusal is a sentence rather than a boolean, since the generic "Referral is pending
  and cannot be rewarded" would have sent a desk hunting a status bug that does not exist.
  **Dropped rather than ported:** the perk grant (`creditReferrer`) — it looked the referrer up by a
  number the server masks, for a reward the contract declines to model; the reward is money now, and
  approving is the whole of the desk's part in paying it. Recorded alongside D95. **Flagged → High
  risk**, because there is no `flagged` status and that tab would have sat permanently empty while
  telling a fraud desk there was nothing suspicious. Three defects fell out of the live run: the new
  service delegated to `createProvider`'s resolver *function* instead of awaiting it (the seam has
  been async since D208 — it crashed the page into its error boundary, and lint and build both
  passed); `Badge` had no `clawed-back` tone, so a reversed reward rendered in the grey that means
  *unrecognised*; and `Badge` **relabels** `pending` as "Under Review", so the wire vocabulary is
  asserted in `ReferralEndpointsTest` rather than on screen.

  **Wave 2c part 3 — the flatmate desk went live-only, and the group-application loop was built
  rather than ported.** `/ops/flatmate-review` runs three boards; the mock modelled one.
  `lib/data/flatmates.js` knew host verification and knew nothing about the **D72 publication axis**,
  so the queue that decides whether *any* flatmate supply is visible had never been exercised by a
  test — and D72 is only a defensible policy if something clears its queue. The two axes are now
  proved to be independent in both directions (approving a badge does not publish; publishing grants
  no badge), because a desk that quietly conflated them would look correct on every screenshot.
  **The third board read a table nothing could write to.** `GET /admin/group-applications` existed
  and `flatmate_group_applications` existed, but there was no apply route — the rows
  `AdminFlatmates.jsx` moderated were two records seeded into `localStorage` by
  `lib/groupApplications.js`. Ponytail's usual answer is `git rm`; here the feature was genuinely
  missing, so **four routes were added that the OpenAPI contract does not name** — `POST
  /flatmates/groups/{id}/apply`, `GET`/`PATCH /me/group-applications`, `GET /me/flatmate-groups` —
  recorded as an intentional extension, not drift. The owner's `PATCH` is deliberately a different
  path from the admin's so no request is ambiguous about which column it writes: the owner owns
  `status`, the desk owns `modStatus`, and the desk cannot reach `status` at all. A stranger's
  `PATCH` returns **404 not 403**, to avoid an existence oracle. **Deliberate divergence:** the
  host's mobile is masked in the mapper even though the DTO sends it in full — a desk that can ring
  a host can be talked into ringing one on somebody else's behalf. **Absent on purpose:** `rejected`
  on the moderation axis, where it means exactly what `removed` means. Two backend lessons worth
  keeping: `PageResponse` serialises as **`content`**, not `items` (the frontend's `unwrapPage` does
  that translation, the wire does not), and Hibernate's L1 cache hid a `jdbc.update` fixture inside
  the single test transaction, so every apply failed with "this group is not live yet" until
  `em.clear()`. **Debt recorded, not fixed:** base64 agreements in JSONB, and no preview above the
  ~3 MB inline cap. **Two debts were answered instead of carried, and shipped in the same wave:**
  all three boards now page server-side at 25 with a `Previous`/`Next` control and a `1–25 of 137`
  readout (the 50-row window was a *silent* limit — 51 pending rooms showed 50 with no hint of the
  51st; the page resets when the tab or board changes, and deciding the last row on a page steps
  back rather than stranding the operator on an empty one); and **`/admin/flatmates` is retired** —
  it could not see rooms at all, had no view of the D72 publication axis, and moderated group
  applications nothing could create, so the route redirects to `/ops/flatmate-review` and
  `AdminFlatmates.jsx` is deleted. Its suite went 8 → 3 (redirect + two guards), and the mock tests
  that drove it in `flatmate-moderation-reach.spec.js` and `consolidation.spec.js` went with it,
  since `ops/live-flatmate-moderation.spec.js` asserts the same behaviour against the database.

- **Wave 2d — the ops support queue is live, and the run found two defects nothing else could.**
  The seam (`supportService.js`, `http/supportProvider.js`, `supportMapper.js`) had been written
  correctly and never exercised, so no frontend wiring was needed — but the conversion was still
  worth it twice over. **(1)** `SupportTicketMapper` filtered null author ids out of its name lookup
  and then dereferenced the same id three lines later, so a message whose author had gone — a state
  the contract explicitly provides for — returned **500 for the customer who raised the ticket**.
  The e2e seed contains exactly such a row. `ServiceRequestMapper` had the identical line over the
  identical nullable column and was fixed with it; `ConversationMessage.author_id` is
  `nullable = false`, so the other two call sites are safe. **(2)** `AdminLayout` mounts
  `AdminFlagsProvider` for the ops variant too, and that provider reads the admin-only
  `GET /admin/settings` — two guaranteed 403s on every `/ops` page load by a staffer, silent because
  the provider falls back to defaults, and invisible on the mock because the mock store answers
  anyone. The ops shell now mounts the provider for its shape and skips the read; it consults
  neither a tab flag nor a module gate. **What the mock could not express:** the two-sided read
  model (D50/V53) — one store and one flag made "the desk read it" and "the customer read it" the
  same bit, so the property that the desk cannot mark the customer's reply as seen was
  *unfalsifiable*, not merely untested. **Also:** the queue pages at 25 to match the flatmate
  boards, and the mock spec went 7 → 1 (the route guard, which is the router's property, not the
  API's).

- **Wave 4a — the moderation queue went live, and it had never been tested at all.** The two mock
  specs for `/admin/reports` (`reports` 13 tests, `reports-full` 42) are retired in favour of one
  live spec of 18, and the arithmetic is the point: **17 of the 55 asserted nothing a broken page
  could violate.** One ended `expect(true).toBeTruthy()`; one ended `expect(count)
  .toBeGreaterThanOrEqual(0)`; eleven were wrapped in `if (await x.isVisible().catch(() => false))`,
  which reports success when the feature is missing; one was named "only open reports have
  checkboxes" and carried a comment admitting it only checked for JS errors. Three more tested
  things that cannot exist — a Reopen button (`canTriage` gates on `open`/`reviewing`, so a decided
  report renders "Decided"), a `resolved` status badge (`resolved` has never been a wire value; the
  server records that decision as `dismissed`), and `?open=REP5000` against a UUID id space. And
  **none of the 55 ever triaged a report** — a moderation queue with zero decisions in it. The live
  spec files its own report over the API and dismisses it from the drawer, last in declaration order
  so it cannot perturb the seeded counts. **Four product defects fell out of the conversion**, all
  one family: the queue rendered `'Anonymous'` where live data always falls back, in *five* places,
  found in four separate rounds — the column, the drawer, the mobile card, and the CSV export's
  blank cell. What caught the last two was asserting the wrong string is **absent** rather than that
  the right one is present. The fifth defect was structural: `REASON_OPTS` carried a hand-written
  set with two codes the server recognises for nothing (so filtering by them always emptied the
  queue) and omitted nine it does, `broker` among them; and `REASON_LABELS` was a hand-copied flat
  table that had drifted from the vocabularies it was copied from *and* was wrong by construction,
  since four codes mean different things per target type. Both are now derived from one module,
  `frontend/src/lib/reportReasons.js`, which the modal, the filter and both providers import —
  deleting the duplicate rather than synchronising it. Seed expanded 1 report → 5 (three on p5002 to
  trip the `3x` escalation badge, two on Rahul, all four statuses present). One hazard recorded:
  `live-property-integration` files a real report during the same run, so the live spec asserts the
  property-side KPIs for **internal consistency** rather than absolutely — an absolute count would
  have been coupled to alphabetical file ordering. Deleting the two specs then turned up **two stale
  path references that fail open**: `SourceTreeHygieneTest.MOJIBAKE_EXEMPT` and the `EXCLUDE` set in
  `e2e/scripts/fix-mojibake.mjs` both named `admin/reports.spec.js`, and an exemption list silently
  never matches a file that no longer exists. Chasing them recovered a real assertion the deletion
  had thrown away — the queue renders no mojibake — which is now folded into the live spec's first
  test and builds its needles from code points, so it needs no exemption and stays covered by the
  guard it is asserting against. Both stale entries removed; `mvn test` 170 classes / 1283 tests / 0
  failures, `fix-mojibake DRY=1` clean over 2187 files.

  Then a review of the converted screen turned up **a whole tab that did not exist**. Every flatmate
  report — room, group or seeker — goes over the wire as `targetType: 'post'` → `kind: 'share'`, and
  the queue split its rows with `kind === 'listing' ? … : kind === 'user'`. Those rows matched
  neither branch and **rendered in no tab at all**: filed correctly, stored correctly, and invisible
  to the people whose job is to action them. It had been masked by an older bug in `Flatmates.jsx`
  that sent `kind: 'user'` — wrong, but *reachable* — so fixing the wire mapping is what made the
  reports disappear, which is the ordinary way a latent gap becomes visible. The KPI reconciliation
  in the new spec is what forced it out: `open + closed` counted the post reports and
  `listings + users` could not, and the two partitions could not be made to agree while a target
  type had no tile. Fixed with a third tab, a fifth KPI tile, `REASON_OPTS.posts` from
  `SHARE_REPORT_REASONS`, and a `TAB_KIND` map so the three-way correspondence is written down in
  one place instead of being re-derived in a ternary; triage there is `hide_content`, not
  `suspend_account`, because a post is content and its author may have done nothing worse than
  forget to delete it. Seed 5 → 7 reports (the Wakad room `open`/`filled`, the Kharadi group
  `reviewing`/`broker` — both pointing at real supply, since `reports.target_id` is plain `text`
  with no FK because it spans four tables). Spec 18 → 19 tests, green. Three more review findings
  fixed in the same pass: a `useEffect` clearing the reason filter on a tab change was replaced by
  **derived state**, because an effect runs after paint and so painted one frame of empty table,
  "0 of N" and a stale code in the filter trigger — and it also lied about `hasFilters`; both reason
  `Select`s got `searchable={false}`, because `Select` silently becomes an autofocusing search
  combobox at 8 options and both lists are exactly 8, which on mobile summons the keyboard over a
  bottom sheet; and `review` reports were falling through to the *listing* wording, since all three
  of its codes collide.

- **Wave 3 — the whole mobile suite is live, and six specs stopped inventing their own sessions.**
  All 28 specs in `tests/mobile/**` (~157 tests) moved as one piece and are now `live-*.spec.js`,
  running under the live config's `mobile` (Pixel 7) and `mobile-small` (360×640) projects. The
  folder went together because what it tests is the chrome — bottom nav, safe-area insets, the 44px
  tap floor, the 12px legibility floor — and splitting that across two stores would leave no single
  run that had seen all of it. **What the mock was hiding was identity, not layout.** Six specs
  signed in by writing a `puneNestUser` object into `localStorage`; the mock's auth check only
  asked whether the key was there, so it passed, but the object carries no token and against the
  API every panel behind it renders its signed-out state. `auth-keyboard` did the same one layer
  down with a `puneNestUsers` registry so "Send OTP" would not bounce to `/signup`; it now uses a
  seeded account and asserts the real OTP step. **Two things the move corrected outright:**
  `/property/P5000` is a **404** on the server (the slug matches exactly), so four sweeps would
  have measured a not-found page and passed by finding nothing — lower-cased to `p5000`; and
  `property-contact` reached into `puneNestDB_v5` to turn `inAppMessaging` off, which is a settings
  row now and goes through the `flags` fixture. **Config:** `mobile-small` moved across rather than
  being dropped (360×640 is where bottom chrome and labels break first), its now-empty definition
  in `playwright.config.js` was deleted, and the live `chromium` project gained a `testIgnore` for
  the folder — otherwise every phone assertion would also have run at 1280px, where a 48px tap
  target proves nothing about a phone. **One real defect fell out of it:** the Virtual Tour button
  measured 133×**38**, under the floor, over a swipeable photo — it had never been measured because
  the mock ran with `videoListings` off and the button was never rendered where a sweep could see
  it. **Three fixture gaps were closed in the seed** rather than papered over: a verified flatmate
  seeker post, a conversation between two *named* actors (the four seeded threads are between
  generated users, so messaging was unreachable from any actor session), and a second `buy`-deal
  saved listing for Rahul (`/saved` tabs by deal, so one card per tab left the undo spec with
  nothing to compare against). The conversation rows had to move *down* the seed file — it replays
  top-to-bottom under `ON_ERROR_STOP=1` and the named actors are inserted around line 445.
  **One capability gap recorded:** `live-ops-field` lost four tests (per-document Verify, Reject,
  View, Add-a-note have no server behind them); the two that survive were kept and retitled.

- **D217 — the `propertyReview` seam, and the mock that had to be made *less* capable and *more*
  strict.** Four new files (`propertyReviewService.js`, an http provider + mapper, a mock provider)
  put the property-verification case file behind the seam, ahead of D218 converting
  `PropertyReviewModal.jsx` and `AdminProperties.jsx`. **Named for a collision it makes twice:**
  `verificationService` is already the Aadhaar identity badge and `reviewService.listPropertyReviews`
  is already consumer star-ratings, so the desk read is `listPropertyReviewQueue`. **One backend
  change went with it** — `PropertyVerificationService.decide()` now composes the owner-facing
  decision sentence server-side, carried verbatim from `properties-admin.js`, so the copy did not
  have to move to two places; the explicit `saveAndFlush` in front of it is mutation-proved (drop it
  and the route 500s, because the new message is a transient child whose id `toResponse` reads
  before dirty-checking would have assigned it). **The mock is the richer end and almost all of the
  surplus is unbacked:** per-document verify/reject/annotate has no endpoint (the checklist is
  read-only `{item, pass}`), `in_review` and `clarification` are inventions, and
  `/admin/property-reviews` takes a `Pageable` and nothing else — so a "pending only" desk filters a
  page, not the queue. Recorded as decisions, not built. **What the reviews found, in order.** Code
  review: the obvious `startsWith('approve') ? … : 'reject'` normalisation made every typo,
  `undefined` and capitalised `Approve` a **rejection** — the destructive, owner-visible,
  audit-logged side of a two-way branch — and silently removed the server's 400; both providers now
  refuse an unrecognised verb. Security review, harder: the mock reproduced the server's *business*
  rules and none of its *access* rules, so in a demo build a signed-**out** visitor could approve a
  listing (and deciding publishes it), a stranger could post into someone else's case file and have
  it stored as the **owner's** own message, and any session could page the whole staff queue. Fixed
  with one `isParticipant` helper and one `staffOnly`, mirroring the server's deliberate 404-not-403
  so a screen is never taught an error state the API will not send. ~~**The e2e switch is currently
  inert** — `propertyReview` is in the live config's `VITE_API_DOMAINS`, but nothing imports the
  service yet, so no browser has exercised it; that lands with D218. The two behaviours most worth
  proving live are exactly the ones the mock got wrong: a non-participant read returning 404, and a
  non-staff decide returning 403.~~ **Closed (D219):** `ops/live-verification-access.spec.js` proves
  both against the real backend, plus two the plan did not name — that the stranger's 404 is
  byte-identical to a nonexistent listing's (two distinguishable 404s would restore the oracle the
  status code was chosen to remove), and that a staffer cannot approve their own listing, which is
  the one case where every role guard passes and only the maker-checker check stands between a flat
  and publication.


  `CASHFREE_ENABLED=true`) + frontend with `VITE_API_DOMAINS` covering `plan`/`serviceRequest`.
  Drive `/checkout?plan=owner2` *and* the rent-agreement wizard through real Cashfree sandbox, and
  confirm the webhook moves each off its pending state. `npm run parity:serviceRequest` also needs
  the live backend (it prompts for an OTP) and has not been run against the paid path.
  **No e2e can cover this**: e2e runs mock-mode and the mock provider returns no `paymentSessionId`,
  so the checkout branch is unreachable there by design.
- **Every developer now needs `PUNENEST_DEV_MACHINE` set** or the backend refuses to start under the
  `dev` profile — see [`docs/LOCAL_DEV.md`](../docs/LOCAL_DEV.md), "One-time setup".

## Needs attention (not mine, not yet actioned)

- **~~The live reset deletes reference data shipped in a versioned migration.~~ FIXED.**
  `e2e/scripts/reset-e2e-db.sql` truncates every table it discovers in `public`, and
  `global-setup.live.js` then replays exactly three `R__` seeds. A versioned migration is not
  replayed — and the reset deliberately preserves `flyway_schema_history`, so Flyway still believes
  it is applied and will not re-run it on the next backend start either. Any reference data seeded
  by a `V__` migration is therefore destroyed by the first live run and never comes back.
  Blast radius was exactly one table: `V78` created `message_template` and seeded its ten rows in
  the same file. `GET /admin/message-templates` had been answering `[]` on every machine that had
  run the live suite once, which is why the outreach feature could not have been demoed even by
  hand. `V28` also inserts, but it is a backfill of user data the demo seed recreates, not
  reference data, so it needs nothing.
  Fixed by moving the ten rows into `R__seed_reference_data.sql` with `ON CONFLICT (id) DO UPDATE`.
  **V78 is left untouched on purpose** — it has been applied, and editing an applied versioned
  migration changes its checksum and fails Flyway validation on the next start (the same trap noted
  below for V79). The duplication between the two files is the repair, not an oversight, and the
  seed says so at length.
  Worth knowing for next time: the seed file already stated the rule — *"Reference data, so it
  belongs here rather than in a versioned migration"* — so this was a known convention that one
  migration quietly broke, and nothing enforced it. A guard test asserting that no `V__` migration
  inserts into a table the reset truncates would have caught it, and is the obvious follow-up.

- **A consumer surface calls a staff-only endpoint, and it needs a product decision, not a fix.**
  `pages/consumer/dashboard/MyListingsPanel.jsx:258` calls `sendWhatsappTemplate(l.id, 'wa-dormant')`
  from the owner's own dashboard. Against the mock it "worked", because the mock asked nobody. Live
  it is a **403**, and it should be: outreach writes a message attributed to a staff member, so an
  owner triggering one would be putting words in an employee's mouth. Pinned as server behaviour by
  `admin/live-outreach` test 6 so that whichever way this is resolved — widening the guard, or
  removing the control — it is a decision someone makes rather than a 403 a user finds. It is the
  last caller of `sendWhatsappTemplate` in the app; the admin console no longer uses it.

- **`sendOwnerReminder` in `lib/mockApi/properties.js:304` now has zero callers.** It incremented a
  counter in localStorage and never sent anything, and the button above it said "Reminder sent to
  &lt;owner&gt;". Left in place rather than deleted here: removing it belongs with the rest of the
  mock in P5c, and a one-off deletion now would be scope that has nothing to do with the wave.

- **~~The chase button on the moderation card is unreachable from a screen.~~ FIXED.**
  `AdminPropertyCard.jsx:286` gates on `l.postedByAdmin && l.status === 'pending'` and no seeded
  listing had `posted_by_admin = true`, so three separate features — that button, the dashboard's
  "awaiting owner" queue, and `adminPipeline.reminderCount` — were all gated on a flag no row set.
  Fixed in `R__zz_dev_demo_data.sql` by converting four existing pending listings rather than adding
  new ones, so the property count stays 38 and no spec asserting a total had to change. One listing
  per `pipeline_stage` (listed / docs_submitted / photos_uploaded / claim_sent), because the funnel
  booleans are **derived** by `PipelineStage.reached` from the single stored stage — photos-uploaded
  without docs-submitted is not a state the server can hold, so four stages is the smallest set that
  produces all four boolean combinations. Named in `docs/system/fixture-registry.md`, covered by
  `e2e/tests/admin/live-concierge-funnel.spec.js`.

- **A listing has a current pipeline stage and no history of reaching it.**
  Found while retiring `getOwnerCommsLog`, which drew the review modal's communication timeline.
  Five of its seven event categories were not records: "Claim link sent" was the boolean
  `claimLinkSent` printed at `createdAt + 1 hour`, "Link opened by owner" at `+ 6 hours`, "Photos
  uploaded" at `+ 1.5 days`, "Aadhaar verified" at `+ 2 days`, "Listing approved" at `+ 3 days`.
  Those timestamps were arithmetic on the creation date, rendered as history, on the screen an
  operator uses to decide whether an owner has been left alone long enough to chase again.

  The panel now shows the one thing the server actually keeps — the outbound-message ledger — and
  the rest is gone rather than reimplemented against `adminPipeline`'s booleans, which would
  recreate the same fabrication one layer down. `properties.pipeline_stage` is a single current
  value; nothing anywhere records **when** it changed or **who** changed it.

  Two ways to close it, if it is worth closing. (a) The audit log already has rows: `AuditService`
  writes `property.outreach`, and `advancePipeline` could write `property.pipeline` beside it. But
  `GET /admin/audit-log` is admin-only **on purpose** — a staff member who can read the record of
  their own actions has been handed the means to check whether anyone noticed — and this is a staff
  screen, so it would render empty for exactly the people who use it. (b) A per-listing event table
  with its own, wider guard, which is a schema change and a real decision. Neither is urgent: an
  empty timeline is honest, and the ledger covers the question the panel is most often opened for.

- **Concierge listings were being created under the operator's own account.** *(fixed)*
  `AdminPostOnBehalf` called `addListing`, which is `POST /me/listings` — the route an owner uses
  to post their own property, which attributes what it creates to the **caller**. Against the live
  API a listing taken over the phone therefore came out owned by the staff member who typed it: it
  appeared in that operator's dashboard, never in the owner's, and there was nothing for the owner
  to claim. The wizard packed `postedByAdmin: true`, `postedByStaff: user?.name` and
  `postedByStaffMobile` into the body; `toListingCreate` drops all three, as it should — a client
  does not get to say who owns a record or who acted.

  Nothing caught it, and the reason is worth keeping. The mock store has one flat `owner` string
  per listing and no accounts at all, so writing the owner's name into the body **was** what
  ownership meant, and all nineteen mock post-on-behalf specs passed. Ownership is the kind of fact
  a mock is worst at, which is why the new spec asserts it from the owner's own session rather than
  from the response body.

  Now on `POST /admin/properties` via a new `createListingOnBehalf` on the property seam. The owner
  travels as a **mobile**, not an id — the operator is on a call with somebody who has never signed
  in — and the server provisions or finds the account behind it. `ownerName` is a provisioning
  fallback only; for an existing account it is ignored, so a name heard over a phone call cannot
  overwrite the one the owner typed. `postedByStaff` comes back as the caller's user id.
  Pinned by `e2e/tests/admin/live-post-on-behalf.spec.js`, from both sides of the boundary.

- **"Confirm still available" confirms nothing the server will remember.**
  `MyListingsPanel` calls `confirmListingFresh` straight from `lib/mockApi.js`, which stamps
  `freshenedAt` into localStorage. The API has no such column and `propertyMapper` maps no such
  field, so `lib/freshness.js` falls back to `createdAt` for every live listing — meaning freshness
  is measured from the day a listing was posted and **cannot be reset**. An owner who clicks the
  button gets a success toast, the badge clears until the next reload, and the listing is stale
  again. The seeded catalogue is dated April–June, so on the live API a good part of the dashboard
  shows a call to action that does nothing durable.

  Not fixed here because it is a product capability, not a wiring mistake: it needs a column, a
  route (`POST /me/listings/{id}/freshen`, owner-only, idempotent), a decision about whether staff
  may freshen on an owner's behalf, and a decision about whether freshening is an event worth
  keeping a history of rather than a single timestamp — the same question as the pipeline stage
  above. The admin queue's "Recheck" tab and `AdminProperties.jsx:296`'s sort both read the same
  absent field, so all three move together.

- **The Duplicates tab and the server's duplicate detection are not the same feature.**
  `findDuplicateClusters()` (`lib/data/properties-admin.js:99`) reads `rawDb().listings` — the
  mock store — and groups them into clusters for an admin tab with Keep/Drop/Dismiss actions.
  Against the live API it is grouping whatever happens to be in localStorage, which the live
  provider never writes to, so the tab is either empty or showing a different catalogue than the
  one being moderated.

  The server does not have this feature and does not want it in this shape. `ListingDuplicateProbe`
  runs at **write** time, compares meter number / address key / locality slug against active
  listings by *another* owner, and files a staff-only case note naming the other listing, its
  status, its owner's verification state and its age — deliberately a suspicion handed to a human
  rather than a cluster to be resolved, and deliberately invisible to the submitter, because a
  visible finding would turn the probe into an oracle for "is this meter number on the platform,
  and whose listing is it".

  So this is not a wiring job. Either the tab retires in favour of the case-note surface that
  already exists (the moderator sees the finding on the listing it is about, which is where they
  are already looking), or somebody decides a clusters endpoint is worth building and what
  "resolve" means to a probe that files notes rather than pairs. Recorded, not decided.

- **The geo policy is written to Postgres and read from localStorage.**
  `AdminSettings.saveGeo` goes through the seam — `updateSettings({ geo })` → `PUT /admin/settings`
  — so the city limit, the per-city bounds and live toggles, and the Places blacklist all persist
  server-side correctly. But every *reader* is `lib/geoConfig.js`, and its `readGeoSettings()` is
  `rawDb()?.settings?.geo`: the mock store, which the http provider never writes to and which the
  live suite explicitly asserts is not seeded. So on the live API the save reports success, the
  value is genuinely stored, and nothing in the application ever reads it. The blacklist is the one
  that matters — an admin hides a place from every locality search and it keeps appearing.

  It fails *safe*: `readGeoSettings` catches and returns `{}`, so every call falls back to the
  built-in `CITY_GEO` defaults (Pune live with real bounds, the rest coming-soon) and nothing
  misbehaves. It is a silently ignored setting, not a broken search.

  Not fixable in this seam, and the reason is the same one that produced `GET /flags`. `geoConfig`
  is deliberately synchronous and framework-agnostic — `getActiveCityGeo()` is called on every
  keystroke of the autocomplete — and it runs for **signed-out visitors**, while `/admin/settings`
  is admin-only in both directions on purpose, because the same document carries the fee table and
  the permission map. So the fix is a narrow public route publishing exactly the geo block, plus a
  cache the synchronous readers can consult, exactly as `Routes.Flags` did for the feature toggles
  and for exactly the reason recorded there: the browser read a copy out of local storage, which is
  why toggling maintenance mode reported success and did nothing. Backend work; not built here.

- **`logAudit` cannot be deleted until something live reads an audit log, and that reader carries
  two product decisions.**
  The plan of record was to retire the 44 `logAudit` call sites as one coordinated wave rather than
  piecemeal, on the grounds that the server already writes its own audit rows for the actions that
  reach it and the browser's copy is a localStorage fiction. That is still right, and the wave is
  still blocked, but not for the reason assumed: the blocker is the **reader**, not the writers.

  The only reader is `AdminSettings.jsx`'s Audit tab (`listAudit()` at L104, L230, L234, L240),
  which is still entirely on the mock. Delete the writers first and that tab goes permanently empty
  on both providers — the mock stops recording and the live seam does not exist — which is strictly
  worse than what is there now, because an empty audit log reads as "nothing privileged has
  happened" rather than as "this screen is not wired up".

  The route to read is already built and is not the problem: `GET /admin/audit-log`
  (`AuditLogController`, `Routes.Admin.AUDIT_LOG`) is paged, filterable on actor / entity /
  entityId / from / to, and is **admin-only rather than staff-visible** on the explicit reasoning
  that a reader who can also act is a reader with a motive to check whether they were noticed. It
  degrades a row with unparseable metadata to `{}` rather than 500-ing the page. Its response is
  `{ id, actor, actorRole, action, entity, entityId, checker, at, metadata }`.

  Two things have to be decided before that can be mapped onto the tab, and neither is a mapping
  question:

  1. **The "Clear log" button has no live counterpart and must not acquire one.** `wipeAudit()`
     calls `clearAudit()`, which empties the array. Server-side the table is append-only *by
     construction* — no write endpoint, no update, no delete, `updatable = false` on every column,
     and no `updated_at`. That is the property the log exists to have. So the button is not an
     unimplemented feature, it is a feature whose implementation would destroy the point of the
     surface; it has to be removed, not ported. Removing a button an operator currently has is a
     product call.
  2. **The tab's "User" column would print a uuid.** The mock's shape is
     `{ at, who, action, detail }` with `who` a display name; the server stores `actor` as an id
     string and does not resolve it on this route. `/admin/staff-activity` reads the *same table*
     under the *same* `audit:read` permission and does resolve names — deliberately, because it
     answers "what has this colleague been doing", which is the question that needs a name. The
     audit log answers "what happened to this record", which is why it does not. Either the tab
     accepts ids, or somebody decides the two surfaces have converged and the settings tab retires
     into the staff-activity page — which is a real possibility worth putting on the table, since
     the staff-activity page is already on a live seam and already renders this data with names.

  There is also a `detail` field with no server equivalent: the browser wrote a human sentence
  (`Added banner "Monsoon offer"`), the server writes `action` + `entity` + `entityId` + structured
  `metadata`. Composing a sentence client-side from those is straightforward but is a fourth thing
  to get agreement on, because the sentence is what the CSV export ships.

  Until then the writers stay. They are inert against the live API — nothing reads them — so they
  cost nothing but the import, and `AdminProperties.jsx`, `PropertyReviewModal.jsx`,
  `DuplicatesTab.jsx` and `AdminPostOnBehalf.jsx` keep their `logAudit` lines for that reason and
  not by oversight.

- **The editorial content endpoints were shipped empty, and only one of the four can be rewired.**
  `ContentController` has served `GET /announcements`, `/services`, `/faqs` and `/banners` since
  slice 8. All four answered `[]` on every environment — V8 creates the tables and nothing has ever
  populated them — while the copy they exist to serve sat in the browser's `db.json`. `faqs` is now
  seeded from that copy in `R__zz_dev_demo_data.sql` (moved, not written: the same nine strings), so
  the FAQ seam is buildable and testable. The other three are not, for three separate reasons worth
  keeping apart:
  - **`banners` cannot round-trip.** The mock's banner carries `cta` and `theme` — the button label
    and the colour — and `BannerResponse` has neither; it carries `image`, `link`, `headline` and
    `position`. Repointing would silently drop the button's text, which is the only part of a banner
    a visitor acts on. Either the wire shape gains the two fields or the surface stops rendering a
    button; both are product calls.
  - **`announcements` and `services` have no consumer that the public read can serve.** The only
    caller of either is `AdminContent.jsx`, which asks for `includeArchived: true` and then writes
    through `mutateDb` / `archiveRecord` / `restoreRecord`. There is no admin content route at all —
    no archived read, no create, no update, no archive. So AdminContent is not "not yet rewired", it
    is unbuildable against the current contract, and it stays on the mock until slice 8 grows its
    back-office half.
  - **Production still answers `[]` for FAQs, deliberately.** The seed is in `db/seed`, which only
    the dev and e2e profiles list. Putting help copy in `R__seed_reference_data.sql` would run it on
    prod and thereby decide what the live site tells its customers, which is a product call rather
    than a migration step — and it would freeze copy that support staff should be able to edit into
    a migration that needs a deploy to change. The honest sequence is: admin write path first, then
    the copy is data rather than schema. Until then, dev and e2e see the nine rows and prod sees
    nothing, which is at least a state somebody chose.

- **`idx_properties_society_unit` (V79) has no reader, and whether it gets one is a product call.**
  V79 creates three indexes for the duplicate probe and explains each. Two of them are read on
  every listing write. The third is not read at all: its comment says "the society branch of the
  rule matches on (society, floor, bhk)", in the present tense, and no society branch exists.
  `ListingDuplicateProbe.signalOf` compares `[electricityMeterNo, addressKey, localitySlug]` and
  `findDuplicateCandidates` queries on those three; the only other readers of `society_id` are the
  society hub's listing list and its counts, both of which want `(society_id, status, archived)`
  and are served by the older society index. So the index costs a write on every listing insert and
  update and returns nothing, and — worse than the cost — anybody who reads V79 to find out what
  the duplicate rule compares will come away believing in a branch that was never built.

- **The live FAQ list has no order, and the mock's did.** `ContentService.listFaqs` is
  `faqs.findByArchivedFalse()` with no `Sort`, so the nine rows arrive in whatever order the heap
  returns them — stable in practice for a freshly seeded table, and not guaranteed after the first
  update. The mock returned `db.json` order, which is editorial: the zero-brokerage question first
  because it is the platform's core claim, trust and payments before coverage. That ordering is a
  small piece of product judgement and it is currently being preserved by accident. `banners`
  already has the answer next door — `findByArchivedFalseOrderByPositionAsc()` — so the fix is a
  `position` column and the same treatment, not a new idea. Left alone rather than pinned by a
  spec, because a test that asserts an accidental order makes it look like a decision.

### The review modal asks the server to open the same case file twice, every time

`PropertyReviewModal`'s open effect calls `startPropertyReview` and then
`markPropertyReviewRead`. Under React's development double-mount that effect
runs twice, and the `cancelled` local it guards itself with only suppresses the
`setState` on the way back - the request is already in flight and is not
aborted. So every open of the modal in development sends two identical POSTs
concurrently, and in production every double-click sends two.

That is now harmless: `VerificationCases.ensure` takes an advisory lock and the
second caller finds the first one's row (D221). It is worth recording anyway,
because it is the reason a genuine server bug hid for as long as it did - the
duplicate write looked like a test artefact until it was traced, and the fix
belonged on the server either way. Aborting the in-flight request on teardown
would be a small correctness improvement rather than a bug fix, and is not
worth doing while it buys nothing but one fewer round trip.

### A verification case file that fails to load is indistinguishable from a closed modal

`PropertyReviewModal.jsx` line 391 is `if (!review || !thread) return null;`.
The open effect catches a failed load, raises a toast and sets `thread` to
null - so the modal renders nothing at all, and what the moderator sees is the
listing page with the Review button still on it, exactly as if their click had
not registered.

This is how the duplicate-key failure presented: a screenshot with no dialog in
it and no error anywhere on the page. The toast had already gone by the time
anything looked. Rendering an error state inside the modal shell instead - the
frame, and "this case file could not be opened" in it - would have named the
problem on the first look rather than the fifth. Not built here: it is a change
to what the product says to a moderator, which is a product decision rather
than a migration.

  The trap is now signposted in `ListingDuplicateProbe`'s class docblock, which is where the rule is
  actually defined and which, unlike a migration, can be corrected. What is left is the choice, and
  it is not a cleanup question:

  1. **Drop it** (a new `V__`, one line). Correct if the society branch is not wanted. Note that
     dropping is the decision that closes the option — re-adding it later is another migration, and
     the reason it was created has to be reconstructed from this note.
  2. **Build the branch.** A match on society + floor + BHK is a *much* looser signal than a meter
     number: in any tower with two 2 BHKs on a floor it fires on ordinary neighbours, and every
     firing is a staff-only case note that costs a moderator the time to dismiss. It would need a
     narrower predicate than the other two branches have — at minimum the unit number, which is
     what `addressKey` already carries, at which point it is unclear what the society branch adds
     over the address branch it would duplicate. That is the real question, and it is about how
     much moderator time a weak signal is worth, which is not a call to make from the code.

  Left in place deliberately. Nothing is broken either way; the index is a rounding error on write
  cost and the misleading comment is now contradicted where it matters.

- **The console's pipeline stages and the server's are two different funnels sharing one column.**
  Needs a product decision; nothing is broken until someone tries to advance a stage.
  `PIPELINE_STAGES` in `frontend/src/pages/admin/properties/constants.js` offers contacted /
  info_collected / listed / docs_submitted / under_review / live. The server's
  `properties_pipeline_stage_check` (V3, restated in `PipelineStage.ORDER`) allows listed /
  docs_submitted / photos_uploaded / aadhaar_verified / claim_sent / claimed. They agree on two
  values out of six. The disagreement is not a typo: the console's funnel tracks **how staff
  acquired the listing** (we contacted them, we collected the details, it went live); the server's
  tracks **what has come back from the owner** (documents, photos, identity, claim). Both are
  reasonable and only one can own the column. Until it is decided, `AdminProperties.jsx:342,477` and
  `PropertyReviewModal.jsx:99-100` still write `under_review` / `live` through the mock — pointing
  them at the live service unchanged would send the server a value its constraint rejects.
  Options, roughly: (a) the server grows the console's two extra stages and the hand-back milestones
  move to their own column; (b) the console adopts the server's six and the acquisition funnel
  becomes a separate field; (c) they stay separate and the console's is retired as a demo artefact.

  The server side of wave 4b is already built, so whichever option wins is a console change and a
  seam, not backend work: `POST /admin/properties` creates a listing on an owner's behalf (201,
  `postOnBehalf:write`, body `{ ownerMobile, ownerName?, listing }` where `listing` is the same
  `ListingCreate` the owner's own form posts — deliberately a wrapper, so both paths share one
  validation and one allowlist; `ownerName` is ignored when the account already exists, because an
  operator's transcription of a name heard on a phone call must not overwrite what the owner typed),
  and `POST /properties/{id}/pipeline` moves the stage (same atom, body `{ stage }`, returns the
  listing rendered `BackOfficeVisibility.VISIBLE`). Note the console's `AdminPostOnBehalf.jsx:157`
  writes `postedByStaff: user?.name` — the server writes the caller's **id** and ignores anything
  the client says, which is the same name-versus-id decision the concierge spec pins.

- **~~A re-check note can be posted on every PATCH, unbounded (D219 review, MEDIUM-2).~~ FIXED.**
  `ListingService.update` called `caseNotes.post` each time a stays-live foundation field moved, and
  that note — unlike the internal one — is not body-deduped. One owner looping
  `PATCH {price: 41000}` / `{price: 41001}` on one approved listing wrote a `review_messages` row
  per request and bumped `lastMessageAt`, which is the desk queue's sort key: ~7k messages an hour,
  permanently pinned at rank 1 of `findAllForDesk`. Only the global 120/min write limiter bounded it.
  Fixed by posting only when the desk's work item actually moved: `Property.requestRecheck` already
  merges this edit's fields into the set under re-check, so comparing `recheckReason` across the call
  distinguishes "the desk has something new to look at" from "the owner nudged the same number
  again". Comparing rather than suppressing repeats outright keeps the note for the case that
  deserves one — an owner who edited price yesterday and area today is still told about the area.
  Pinned by `ListingNoticesTest.aRepeatEditOnTheSameFieldDoesNotReopenTheThread`, which also asserts
  the *work item* still names both fields: the note was skipped, not the re-check.
  Still open, and cheaper now that it fires less: `postInternalOnce` scans the whole thread in memory
  per write, so a caller who does get through makes each of their own writes more expensive.
- **`idx_properties_society_unit` (V79) has no reader.** The `(society_id, floor, bhk)` arm was
  deliberately removed from `findDuplicateCandidates` — a fully client-asserted signal turns the
  probe into a unit-by-unit census — so the index costs write amplification on every listing
  insert/update and answers nothing. Either drop it or say in the migration that it is staged for a
  claim-backed society arm.
  ⚠ Note for whoever takes this: **the note cannot go in V79.** It is a versioned migration and has
  already been applied, so any edit — comments included — changes its checksum and fails Flyway
  validation on the next start. Both options therefore cost a new migration: `drop index` in one, or
  a `comment on index` in the other. That is also the reason this is still open rather than tidied
  up in passing.
- **~~`markRead` stamps `readAt` on staff-only notes.~~ FIXED.**
  `PropertyVerificationService.markRead` filtered on
  `!actor.userId().equals(message.getSenderId())`, and internal notes have `senderId == null`, so
  that test was true for them and an owner hitting the read receipt marked notes they cannot see as
  read. No disclosure — both unread counters filter `!isInternal()` — but it corrupted a record the
  desk reads, marking a duplicate finding as seen by the one person it is deliberately kept from.
  Fixed by reusing `mayReadNotes(actor)`, the same predicate the response filter uses, so the write
  cannot drift from the read: what you may mark as shown is exactly what you may be shown. Pinned by
  `ListingNoticesTest.aReadReceiptSkipsTheNotesTheOwnerCannotSee`, which asserts the internal note
  stays unread *and* the owner-addressed note goes read — the second half being what keeps the test
  honest, since "nothing was marked" would otherwise pass for a fix.
- **`flagReason` is ungated on the public detail response.** The duplicate probe never writes it, so
  there is no leak today; the hazard is that routing any future duplicate finding through it instead
  of through the internal note bypasses the whole oracle-closure design in one line. Worth a comment
  on the field at least.
- **No HTTP-level throttle on the verification thread (D218, security finding S4).** A participant
  can post messages into a case file as fast as they can issue requests; the only cost is a row.
  Platform-wide gap rather than a listing one — there is no rate limiter in front of any write route
  — so it is filed here rather than fixed inside `PropertyVerificationService`.
- **`flatmate_rooms.society_id` has the FK-as-409 shape that D218 fixed for properties.**
  `FlatmateMapper:197` copies a client-supplied `societyId` straight onto the entity; the FK
  (`V27__flatmates.sql:153`) does stop the write, but as a constraint violation at flush, so an
  unknown id answers 409 on a request that conflicts with nothing. Same one-line fix
  (`existsById` → 404 at the boundary) — left alone because it is a different bounded context and
  changing a status code there is somebody's contract change.
- **`toListingUpdate` silently drops keys it does not whitelist** (`http/propertyMapper.js:~330`).
  That is how three separate admin writes turned into `{}` without anybody noticing, and how
  `AdminProperties.jsx:428`'s BHK edit (passed as `bhk`, read as `bhkNum`) is discarded. Add a
  `console.warn` for dropped keys — a whitelist that fails silently is a whitelist that hides bugs.
- **A second internal-note store is still running in parallel with the server's.**
  `PropertyReviewModal` posts the moderator's approve/reject note via `submitNote` →
  `lib/mockApi.addInternalNote` (localStorage), while D218 added `review_messages.internal` on the
  server. In http mode a note one moderator types is invisible to every other. Post it through the
  verification thread instead — the wire now carries `internal`, so the plumbing exists.
- **`mock/propertyReviewProvider` does not reproduce two D218 behaviours:** it never opens a case on
  create (`ListingService.create` now does), and it has no equivalent of the owner-side 404 when a
  case holds only internal notes. Both are API-tested, but until the mock matches, mock-mode e2e
  cannot cover them.
- **`ListingService` is 17 lines from its 450-line guard, and the reviewer named the extraction.**
  Two moves, both mechanical: (1) pull `apply()` + `EditImpact` into a `ListingEditRules`
  collaborator returning `EditImpact` — it is a separate rule ("what does this edit cost"), with its
  own oracle test (`ListingFoundationTest`) and its own external consumer; (2) move
  `updateAsModerator` into `ListingArchiveService`, renaming it `ListingModerationService`, because
  it is cross-owner, resolves unscoped and authorizes by role — the exact inverted rule that class
  was extracted to isolate. Together those drop `AuditService`, `AuthPrincipal` and `Roles` from
  `ListingService` and leave it purely owner-scoped. **`frontend/scripts/check-listing-foundation.mjs`
  parses `ListingService` by path (`SERVICE`, line ~55) and by regex — update it in the same commit
  or the frontend guard silently reads an empty file and passes.**
- **V79's `idx_properties_society_unit (society_id, floor, bhk)` is dead.** The society arm was
  removed from `findDuplicateCandidates` (an owner-supplied society id turns the detector into a
  census oracle), so nothing queries it, and V79's comment still describes "the society branch of
  the rule" as if it existed. Drop the index and the comment in whichever migration next touches
  `properties`.
- **Standing ruling — `spring.jpa.open-in-view=false` (D185), approved 2026-08-10.** No controller
  returns an entity; every handler maps to a DTO inside the service transaction. The accepted trade
  is that a silent N+1 becomes a loud `LazyInitializationException`. If a 500 appears from
  serialisation, that is this setting talking: fetch the association in the service, **never switch
  OSIV back on**.
- **Property reviews have no live-API e2e, and that gap hid a total outage.** `listPropertyReviews`
  requested `/reviews/property/{id}`, which matches `GET /reviews/{entityType}/{entityId}` whose
  `entityType` is `society|locality|owner` — so every live property review read/write 404'd, and the
  page's catch-and-render-unreviewed branch presented it as "no reviews yet" on every listing. Path
  fixed; **coverage not**. `live-property-integration` and `review-parity.mjs` both probe a
  *locality*, which is why they stayed green. Same live config is the only place the "summary read
  fails, cards still render" branch is testable (logged ❌ in `COVERAGE.md`).
- **Three surfaces still average reviews in the browser**: `useSocietyHub.js`, `Owner.jsx`,
  `locality/ReviewsBlock.jsx`. Not a like-for-like swap — the D79 endpoint is property-only, so each
  needs its own aggregate first.
- **`hasTenancy` in `ReviewsSection` is mock-only** (reads a localStorage bucket the live path never
  writes, so always false against the real API). The visit half of the eligibility gate carries
  production. A live tenancy read on the seam closes it.
- **`RentMapper`'s `@Mapping(..., ignore = true)` belongs to whoever does D167.** It unblocks a
  compile break (`RentPaymentDto.withPaymentSessionId` is a second writable target under
  `unmappedTargetPolicy = ERROR`) — delete it and map the field properly when D167 lands.
- **The two D160 409s cannot have e2e yet** — the mock provider opens no gateway order, so there is
  no unpaid row to collide with. Covered at API level by `UnpaidOrderCapTest` + the two checkout
  sweeps. Revisit when sandbox-verify gives e2e a real checkout.
- **`backend/.env.local` was surfaced into an editor context on 2026-08-09.** Git-ignored, never
  committed, but holds live sandbox secrets (Cashfree TEST secret, R2 keys, Supabase DB password).
  Rotate if there is any doubt about where that context went.
- **Flaky set, re-measured on the full 2026-08-13 sweep (1708 tests, 38.6m, 0 failed / 9 flaky).**
  All nine passed on retry, and the set is *not* the one this file previously listed — the three
  long-standing suspects (`commercial-type-filter.spec.js:60`, `flatmates/video.spec.js:27`,
  `flatmates/prefreeze.spec.js:66`) did not flake at all, and `mobile/phase3.spec.js:157`, recorded
  as "fixed, environmental" on 2026-08-10, flaked on **both** mobile projects. That is the tell: it
  was never fixed, it is load-sensitive. Actual set — `platform/desktop-noleak-guardrails.spec.js`
  :267, :282, :291, :328 · `mobile/landscape.spec.js:101` · `mobile/phase3.spec.js:157` (mobile +
  mobile-small) · `mobile/topbar-scroll.spec.js:61` (mobile + mobile-small). Every one is a
  viewport/scroll/animation timing assertion. **Do not "fix" any by relaxing an assertion**, and
  never run `graphify` or a build on this machine during an e2e run — that contention *is* the
  variable.
- **`updateAsModerator` did not move with `apply()`, deliberately.** The approved extraction was in
  two halves: pull the edit rule out of `ListingService`, and move `updateAsModerator` into the
  archive service renamed `ListingModerationService`. Only the first half shipped, because only the
  first half was load-bearing — taking `apply()` out drops the file 449 → 232 and clears the 450-line
  ceiling with room to spare, while the second half is cohesion-driven and would additionally touch
  `PropertyModerationController`, rename a file, and rewrite assertion 3 of
  `frontend/scripts/check-listing-foundation.mjs` (which reads `update()` and `updateAsModerator()`
  out of `ListingService.java` **as text** and would silently start proving nothing). Worth doing;
  not worth doing inside a size fix.
- **The client-side audit log gets no seam — the 44 `logAudit` call sites get deleted.** The
  research pass found the server has no client-writable audit endpoint *by design*, and the Javadoc
  on `AuditLogController` says why: a browser could forge the actor. `logAudit('Listing', 'Archived
  "X"')` passes client-supplied prose with a client-supplied author; `AuditService.record` takes a
  server-resolved principal, a dotted verb (`property.approve`), a typed entity, and structured
  context. A browser-writable audit log is not an audit log. Same verdict for the 5 `logStaffActivity`
  writes — the read side already exists, already runs live, and is a projection of `audit_log`; there
  is no `staff_activity` table to write to. **Five consequences to carry, none of them plumbing:**
  (1) nothing server-side audits a settings change, a CMS archive/restore, a locality verify/dismiss,
  a society claim decision, a duplicate-cluster merge, or a feature-flag toggle — and several of
  those services do not exist yet; (2) there is no `detail` column, so the console's audit view has
  to change from "print the sentence" to "render verb + entity + metadata"; (3) `clearAudit`
  (imported by `AdminSettings.jsx:5`) has no counterpart and must not get one — record it as a loss;
  (4) both audit reads are `hasRole(ADMIN) and audit:read`, so **staff accounts lose the audit view**
  — correct server behaviour, but a visible product change somebody should agree to; (5)
  `addInternalNote` is the real gap — no general facility exists, nothing at all for
  `report`/`user`/`banner`/`faq`/`announcement`/`review`, and even `listing` cannot write
  `review_messages.internal` through the API. That one needs backend work before its call sites move.
- **Two readers bypass `getInternalNotes` and will silently return `[]`** the moment notes move
  server-side: `lib/mockApi/ownerComms.js:88` (keyed `'listing:'+listingId`, folded into the
  Communication Log as `type:'note'`) and `lib/mockApi/users.js:109` (keyed `'user:'+userId`). Also
  note `addInternalNote` is re-exported as `submitNote` from `components/ui/InternalNote.jsx:84`, so
  grepping the original name finds roughly half the sites.
- **`sendWhatsappTemplate` is called from a consumer surface but the endpoint is staff-only.**
  `MyListingsPanel.jsx:258` calls it; `POST /properties/{id}/outreach` is guarded `postOnBehalf:write`
  with roles `[staff, admin]`. An owner pressing that button will get a 403. Needs a decision —
  widen the guard, or drop the control from the consumer panel — before the outreach seam is wired
  to that call site.
- **Adding a file that matches an existing `import.meta.glob` is a call-site change, not an inert
  addition.** Creating `services/providers/{http,mock}/outreachProvider.js` while the live suite was
  running invalidated `services/config.js` — its two registries are `import.meta.glob` patterns over
  `./providers/mock/` and `./providers/http/` — and so HMR'd the whole services graph under the
  suite's own dev server. `live-i18n-urls.spec.js:238` failed within seconds of the write, and that
  spec is the most exposed one in the repo: it does `await import('/src/lib/helpUrl.js')` **at
  runtime through the dev server**, so a module-graph rebuild breaks it where an ordinary spec would
  only have re-rendered. Re-run that spec on a quiet tree before believing the failure. The working
  rule for the rest of this migration: a new file is only safe mid-suite if no glob in
  `frontend/src` would match it.
- **`PropertyResponse.adminPipeline` is not mapped by the frontend at all, so the entire
  post-on-behalf slice reads `undefined` live.** The server sends `{ postedByAdmin, postedByStaff,
  pipelineStage, claimLinkSent, photosUploaded, aadhaarVerified, reminderCount }` nested under
  `adminPipeline`; the mock store carries the same seven fields **flat** on the listing; and nothing
  in `services/providers/http/` bridges the two. Every reader is therefore silently dark live:
  `AdminPropertyCard.jsx` picks staff vs owner funnel steps at :98, colours the card at :109-111,
  renders "Reminded ×n" at :241 and decides whether the chase button exists at :286; `Card.jsx:78`
  drops the "Posted by PuneNest" badge; `analytics/sla.js:89` and `analytics/smartAlerts.js:43`
  filter to concierge listings and so both come back empty. **This is the precondition for wave 4b's
  post-on-behalf cluster** — flatten `adminPipeline` in the property mapper before wiring any of it,
  or the screens will look like they work while measuring nothing. Note the server's own doc on
  `reminderCount`: it is a count over the outbound messages, so once flattened the client must read
  it rather than keep the counter the mock used to bump.
- **`wa-pricing` is offerable but cannot render.** Migration V78 seeds ten WhatsApp templates whose
  ids match the mock's `DEFAULT_WA_TEMPLATES` exactly — a deliberate and very helpful choice,
  because the rewire can keep every template id. One of them, `wa-pricing`, contains
  `Avg rate: ₹{market_rate}/sqft`, and `OwnerOutreachService.variables()` does not supply
  `market_rate`. That omission is **deliberate and right**, and the source says so: the mock's value
  was the string `"9,500"` for every locality in Pune, and "carrying that across would be quoting an
  invented figure to an owner deciding what to charge." Unknown keys are left standing on purpose so
  the staff member sees the gap in the preview.
  The unfinished half is that `wa-pricing` is still returned by `GET /admin/message-templates` and
  still sendable, so the safeguard is a human noticing. Either give the line a real per-locality rate
  or set `active = false` on the template — V78 has that column precisely so a retired template still
  resolves for messages already sent. Inventing a number is not a third option.
- ~~Three templates (`wa-live`, `wa-stale`, `wa-dormant`) hard-code `punenest.com/property/{listing_id}`
  in the body rather than using `{claim_link}`, which is built from the configured base URL. Every
  message sent from a dev or staging box therefore points the owner at production. Lower severity
  than the above, same root cause: the body is data, so the environment cannot reach it.~~
  **Fixed.** The three now interpolate `{listing_link}`, which `OwnerOutreachService.variables()`
  builds from the same configured base URL as `claim_link`. Two things were needed beyond the seed
  edit, and both are the interesting part. The variable had to exist at all — `claim_link` is the
  sign-in page and could not stand in for a link to one specific listing. And the e2e profile now
  pins `punenest.app.base-url` to the dev server, because the production default is
  `https://punenest.com`: with it, the fixed template and the broken one render the *same string*,
  so no live assertion could have told them apart. Guarded from both sides in
  `OwnerOutreachTest#theListingLinkIsBuiltFromTheConfiguredBaseUrl` and in `live-outreach`, each
  asserting the configured base URL is present *and* that the production host is not.
- **No seeded listing is a concierge listing, so the whole post-on-behalf surface is empty live.**
  All 38 rows in `insert into public.properties` have `posted_by_admin = false` (checked by parsing
  every row, not by sampling: 38 rows, 38 parsed, 0 true). This compounds the `adminPipeline` gap
  above rather than duplicating it — mapping `adminPipeline` correctly would still leave every
  concierge affordance hidden, because `AdminPropertyCard.jsx:286` only renders the chase button when
  `l.postedByAdmin && l.status === 'pending'`.
  There is a sharper edge behind it. `POST /properties/{id}/outreach` does **not** require the
  listing to be staff-posted — it needs an owner with a mobile, nothing more. But
  `OwnerOutreachService.countsFor` filters to `Property::isPostedByAdmin` before counting (for a good
  reason it states: the mapper renders the count only for those). So on an owner-posted listing you
  can chase the owner, the row lands in `outbound_message`, the audit fires — **and
  `adminPipeline.reminderCount` stays 0 forever.** The write succeeds and the ledger disagrees. Any
  spec that chases an owner and then asserts a count must either use a staff-posted listing or read
  `GET /properties/{id}/outreach` instead, which is unfiltered.
  Wave 4b therefore needs seed work before it can be tested at all: at least one `posted_by_admin`
  listing per pipeline stage, with an owner who has a mobile.
  Two things that seed has to respect. **The three funnel booleans are derived, not stored** —
  `PipelineStage.reached` computes `claimLinkSent`/`photosUploaded`/`aadhaarVerified` from the single
  stored stage, deliberately, so that a second copy cannot disagree with the first. You therefore
  cannot seed a listing that has photos but no docs; you pick a stage and the booleans follow.
  **And the two funnels are not in the same order.** The server's is
  `listed -> docs_submitted -> photos_uploaded -> aadhaar_verified -> claim_sent -> claimed` (V3's
  check constraint, restated in `PipelineStage.ORDER`). The mock's demo rows put `claimLinkSent: true`
  on a listing still at `listed`, i.e. it treats sending the claim link as the *first* step and the
  server treats it as the second-to-last. So the console's funnel strip will not merely be empty
  live, it will fill in a different order. Whichever order is right is a workflow question for
  whoever runs concierge onboarding - but the server's is the one backed by a database constraint,
  so the console is the side that should move.
  Two mock fields have no server counterpart at all and will read `undefined` after flattening:
  `claimLinkOpened` (an open receipt nothing tracks) and `lastReminderAt` (the ledger has
  `preparedAt` per row, so a "last chased" date should come from the newest ledger entry rather than
  a mirrored column that can drift).
- **"Posted by PuneNest" on a consumer card cannot survive the migration, and that is the server's
  considered position, not an oversight.** `pages/consumer/listings/Card.jsx:78` renders the badge
  from the flat `postedByAdmin` the mock carried on every listing. `PropertyResponse` omits
  `adminPipeline` from consumer reads entirely — null rather than `{}` specifically so `NON_NULL`
  strips the key, because (its words) an empty object would still tell a buyer the field exists.
  The header states the omission is intentional: the pipeline belongs to the back office.
  So flattening `adminPipeline` in the mapper fixes the six back-office readers and cannot fix this
  one. The badge is a **product decision that has to be made rather than mapped**: either "we listed
  this ourselves" is a trust signal a buyer is entitled to, in which case the contract needs a single
  public boolean that is not the pipeline (the pipeline is staff workflow and none of a buyer's
  business), or the badge goes. Mapping it out silently is the one option that should not happen,
  because the badge currently reads as a trust marker and would disappear without anyone deciding it
  should.

## Next up

**The seam is complete — all 18 domains have a live consumer** (every
`frontend/src/services/providers/http/*Provider.js` is in `VITE_API_DOMAINS`). No next domain to flip.

- **`AppFlagsContext` is the next seam, and it is now urgent-ish (2026-08-13).** Adding the
  `settings` domain moved the admin console's *writes* onto the API, but three consumers of the same
  keys still read `rawDb()` — `ConsumerLayout.jsx:37` (`flags.maintenanceMode`, "block all consumer
  access"), `AppFlagsContext.jsx:7` (`flags`, which carries `signupsEnabled`) and `geoConfig.js:72`
  (the Places city limit + blacklist). Live, the admin toggles maintenance mode, gets a success
  toast, and nothing anywhere changes. Enforcement was never real — these were always browser-local
  and only ever gated the operator's own tab — so this is not a new hole, but a kill switch that
  reports success and does nothing is worse than one that is visibly absent. Move `AppFlagsContext`
  onto `settingsService.js` before anyone plans to rely on maintenance mode.
- **Documents** — flipped on the honest subset; D124 closed, D125 fully resolved (2026-08-08). Buyer
  half, `useRentAgreement` vault reuse, `DocVault`, `PropertyPassport` stay on `lib/` by design (D123).
- **Societies** — UNBLOCKED (D104 closed 2026-08-08): catalogue now seeds the full 348 societies +
  155 localities and `GET /societies` carries `avgRating`/`reviewCount`. The service + provider +
  call-site flip is the next society-domain slice — not yet built, no longer 404s on real slugs.

---

## Shipped

Newest first. **A finished slice gets one index line, not a narrative** (see the rule at the top).
Entries below are collapsed to that form once committed — git history holds the full write-up.

### 2026-08-15 — D219: the duplicate detector meets the path that actually produces listings

Three parts, all closing D218 review findings. **(1)** `ListingDuplicateSweep` re-probes the last
twenty minutes of signal-carrying listings every ten minutes, because the in-transaction probe runs
under READ COMMITTED and two simultaneous submissions are invisible to each other — the detector
caught the careless and missed the coordinated (HIGH-3). `postInternalOnce` compares bodies, so the
sweep cannot spam a case file.

**(2)** `address` became a **re-check** field rather than a foundation one (S8): an edit stays live
and searchable but raises a work item, since it is the field the address arm of the probe hashes
and it was previously going live with no moderation at all.

**(3)** The owner listing wizard now writes through the seam. `persistListing` posts to
`addListing`/`updateListingFields` instead of localStorage, which is what puts the server's
duplicate probe in front of the path that produces almost every listing — until now it was reachable
only from admin post-on-behalf. The localStorage write survives as a mirror for edit prefill, the
browser-side dedup and the documents shelf, none of which have crossed the seam yet.

**Review found one thing worth the whole exercise.** `address` carries the flat number — it has to,
because `AddressKey` is exact and an address that stops at the building flags a tower rather than a
unit — and `PropertyResponse.address` was ungated, so wiring the wizard would have published a
unit-level address book of every live listing to anonymous callers. That defeats the contact gate
outright: a stranger holding "A-902, Rohan Nilay" does not need the owner's phone number. It is now
behind the same `PrivateFieldVisibility` as the meter number, which costs nothing because nothing
rendered it (`toViewModel` never read it back) and is asserted on both the owner route and the
public one. Also from review: the sweep query is now `order by created_at` — unordered with a
per-tick ceiling means a stable arbitrary subset is swept forever and the rest ages out of the
window; the submit button has a re-entrancy guard, since posting became a network round trip and a
double-tap manufactures the one duplicate `findDuplicateCandidates` excludes by design (the caller's
own); `toListingCreate`'s fallback composition gained `street` so the desk and the owner produce the
same key for the same flat; a create that resolves without an id now fails instead of filing
everything under a local id that exists on no server; `properties.electricity_meter_no` is now
classified for DPDP erasure, having matched none of the classifier's tokens; and a live spec
asserting the duplicate note quotes the meter number was inverted — it never passed, and making it
pass would have copied a guarded field into free text outside every guard.

**Then the live suite was actually run, and it found two more.** The D218 verification-thread spec
had never executed against a backend; on its first run one test failed because it decided a case
that had never been opened. Creating a listing does not open a case file — only the duplicate probe
and an explicit submit do — so the spec was missing a call the real desk makes (`PropertyReviewModal`
posts `/verification` on open). The mock-mode wizard spec caught the second: `forTheWire` was sending
`floor` as the string the form holds, and because the mock provider stores what it is given while
the http mapper coerces, the two providers would have diverged on a field the duplicate signal
depends on. Both fixed; D218's three live tests and D219's live wizard test now pass, as do the
other 34 in `live-property-integration`.

**Plus the auth-guard spec the D217 review asked for**, `ops/live-verification-access.spec.js`, four
tests. A signed-in stranger gets 404 on every thread route — read, post, mark-read and open — and
the *bodies* are compared against a nonexistent listing's 404, not just the codes, because two
distinguishable 404s would restore the existence oracle the status code was chosen to remove. The
staff-only routes answer 403 instead, which is not an inconsistency: their guard is a role rather
than a relationship, so `@PreAuthorize` refuses before the id is looked up and nothing about the row
can leak through a method that was never entered. The fourth is the maker-checker rule, the only
refusal here about neither — a staffer listing their own flat is a participant *and* holds
`properties:write`, so every other guard passes and the flat would publish with nobody having read
it.

**Then the whole live suite was run for the first time — 739 tests, 63 files, 58 minutes — and it
found six broken specs.** 730 passed. None of the six was a product bug; all six were test defects
that per-file runs cannot surface, because isolation suppresses exactly the failure modes that
shared state and elapsed time produce. Two specs signed in as seeded `suspended` users, fixtures
picked before V77 made login enforce a column that had been decorative since V2. One PII assertion
matched a `Date.now()` stamp inside a ticket subject, using an unanchored mobile regex whose
anchored twin already existed one directory away, complete with a comment describing the trap.
And `live-property-integration`'s Aadhaar-simulate test permanently verified Omkar Kulkarni, who
owns `p5007` — the listing `live-verify-payoff` uses as its *unverified* control — so one file
republished another file's premise forty tests earlier, and each passed alone.

The sixth is the one worth keeping: past the 15-minute access-token TTL, `signedInAs`'s cached
snapshot goes stale, `http.js` refreshes and **rotates** the refresh token, and the next replay hands
the server a token it has already rotated. Reuse detection does the correct thing and revokes the
family (ADR-008), the session dies, and the test fails naming a locator on a screen it never
reached. The backend behaved correctly throughout. The cache now re-establishes past 10 minutes, so
an expired token is never presented and nothing rotates behind its back. Re-run of all five fixed
specs — deliberately together with the file that caused the collision — is green: 64 passed.

### 2026-08-14 — D218: the server learns to explain itself, and to notice the same flat twice

Two halves. **(C1)** The re-review explanation moved out of the browser. `PropertyReviewModal` had
been *typing* "Your recent edits have been reviewed and approved" into the thread, so an edit made
through any other client produced silence and the sentence claimed a verdict whether or not the
write had landed. `ListingService.update` now posts it, naming the fields that actually moved —
and only when `requestRecheck` really raised a work item, because that method refuses on a listing
that is not publicly visible and the note had been telling owners of pending, off-search listings
that they were live.

**(C2)** A duplicate detector: `properties.electricity_meter_no` + a normalised `address_key`
(V80/V81/V82), a probe that runs on create, on a signal-changing edit and on restore-from-archive,
and a **staff-only note** filed on the colliding listing's case file. The listing is published, not
refused — a second listing on one meter is often a broker relisting somebody's flat and sometimes a
genuine re-let, and refusing outright punishes the honest case to catch the dishonest one.

That note needed a lane. `VerificationMessage.internal` is now on the wire; a case holding *only*
internal notes answers the owner **404, not an empty thread** (an empty thread still discloses the
file), and the read is gated on the `properties:read` **grant** rather than the bare staff role —
the one verification route that cannot be gated at the controller, because it is participant-or-staff
and an owner holds no grants. Staff see it as a separate amber lane, because filtering alone left a
moderator unable to tell a staff-only finding from something the owner was told: both arrive as
`from: ops`, in one conversation.

Also: the desk's sort moved to `last_message_at desc, id desc` (V81's `coalesce` + partial index
could not be used by the planner and had no unique tiebreak — a paging bug); `DuplicatesTab` stops
rendering "supply looks clean" against a live API it never queries; `ListingCard`'s re-check chip
was keyed off a field the http mapper never emits, so live owners were told nothing at all.

Backend 170 classes / 1280 tests. New live spec `e2e/tests/ops/live-verification-thread.spec.js`.
Reviews: `code-reviewer` (12 findings, 9 fixed — it caught that an edit of mine had commented out
V82's backfill), `react-reviewer` (11, 5 fixed, 6 deferred above), `code-simplifier` (4 applied).

### 2026-08-12 — wave 14: the tech-debt register closed in one pass, 24 open → 17

Twelve lanes, **one subagent at a time** (concurrent `runSubagent` calls are what lost wave 13's
reports). **16 rows closed:** D120, D123, D121, D53, D49, D133, D80, D210, D211, D212, D208, D52,
D184, D98, D99, D84. Two new rows filed: **D214** (bundle budget now slack by ~59 KB) and **D215**
(44 unbatched provider chunks cost a round-trip, unmeasured). Bundle **495.5 → 437.6 KB**.

*The recurring finding was that the register was wrong about itself*, in five different ways, and
each correction is written into the row it belongs to:

- **D98b was filed against the wrong bar** — the "account pill at x=360" is the *top* bar; the
  account entry was already in the header. Compare moved into the mobile drawer instead (7→6 targets).
- **D99 was not deferred** — the swipe gesture and 5s window were already in HEAD; only the
  accessible half was missing (`UndoRow` with `role="status"`, focus moved to Undo).
- **D33 said 670 `@param` lines; there were 844.** A whole-tree hand pass read all of them and
  deleted 22 — 33 deletions, **zero insertions**. Stays open by design: none of the 822 kept is a
  provable restatement.
- **D11 said "style, Low" with no number behind it** — 30 vocabularies / 1,126 refs. Exactly one
  converted (`ServiceRequestStatuses` → a real enum). `Roles` (414 refs) is *impossible*:
  `@PreAuthorize` needs a compile-time `String` constant.
- **D158's blockers had moved** — netty is cached and the row never noticed. Three artifacts are
  genuinely absent; re-verified and still blocked. **D133 closed won't-do**: 6 requests, 6
  endpoints, 0 duplicates.

**Defect found during the final verification and fixed:** `AuthService.staffLogin` matched email
case-sensitively while `V70` indexes `lower(email)`, so a colleague enrolled as `A.Sharma@…` was
refused when typing `a.sharma@…`. Now `findByEmailIgnoreCaseAndArchivedFalse`; 51/51 green.

**⚠️ Coverage warning:** five identity-disclosure assertions were *moved* to
`e2e/tests/ops/live-drafting-desk.spec.js` and **have not been executed** — they need Postgres, the
backend on :8081, `PUNENEST_DEV_MACHINE` and `BACKEND_LOG`.

**Left open by decision:** D4 (merchant account), D41 (real object store), D176 (V27 is applied and
`validateOnMigrate=true`), D68 (Spotless — excluded outright).

### 2026-08-12 — D208 closed: the provider import cycle is gone, and the seam went async to do it

**The decision the register had been waiting on got made: the glob goes lazy.** `services/config.js`
now globs the providers without `{ eager: true }`, so it statically imports no provider at all. That
is what actually removes the cycle rather than defusing one instance of it — the graph is a DAG
(`*Service.js → config.js`; `providers/* → http.js → config.js`), so a provider body can no longer
be evaluated inside `http.js`'s own evaluation, which was the only thing that ever made a
module-scope read of an `http.js` export dangerous.

**The ripple, and why it stopped at the seam.** `createProvider` now returns a *Promise* of the
provider module, so **167 `provider().foo()` call sites across 22 `*Service.js` files** became
`(await provider()).foo()` with their enclosing function `async`. Nothing above the seam changed:
service functions have always returned Promises (`services/index.js` states it as the invariant), so
no caller can observe the extra tick, and the 10 non-service importers of `config.js` only ever
wanted `isHttpDomain`. Done with a one-shot espree codemod, not a regex — ~15 of those calls wrap
across lines and the rewrite needs the *enclosing function's* range, which no regex can see. Every
output was re-parsed before being written; the codemod was deleted after the run.

**What survived unchanged, deliberately.** The registry *keys* are still synchronous, so the D105
typo validation and the "no mock provider for domain" throw still fire at the same moment without
evaluating a provider. The cache holds the promise rather than the module, so concurrent first calls
share one import; a rejection is evicted, because a failed chunk fetch is a new failure mode that an
eager glob could not have and should not poison a domain for the session.

**The gate was updated rather than deleted, and re-proven red.** `check-provider-cycle.mjs` keeps its
module-scope check as defence-in-depth — it costs nothing, it names the offending file and line, and
it is the only thing that would still fire if someone reinstated the eager glob — and gained the
assertion that is now load-bearing: `config.js` must not glob with `eager: true`. Verified red (exit
1, naming `config.js:158`) before being trusted, then reverted.

**Unbudgeted win.** 44 provider chunks left the critical path, so `check:size` fell **495.5 KB →
437.6 KB** against a 497 KB budget — 1.5 KB of headroom became 59.4 KB.

**Verified by rendering a page, not by gates.** `npm run check` exit 0 with lint unchanged at 0
errors / 395 warnings; `consumer/home/featured.spec.js` 2 passed; a 328-test consumer sweep
(property + flatmates + account) green; and the boot canary 4 passed across `/`, `/listings`,
`/dashboard`, `/admin`. That last one is the point: three green static gates missed this exact
blank-page bootstrap on 2026-08-11.

Two stale docs corrected on the way past — `frontend-data-seam.md` and `cross-cutting.md` both
asserted the eager glob as present fact — plus three literal `\u2014` escape artifacts that had been
rendering as garbage inside the D208 row itself.

**`code-reviewer`: 0 critical, 0 high, five mediums — three taken, and the best one was in the gate
rather than the change.** Its `DEFERRED` set skipped `ClassDeclaration` and every arrow, so
`class Q { static page = { size: MAX_PAGE_SIZE } }` and `const paged = (() => ({ size: MAX_PAGE_SIZE }))()`
both ran at module scope and both passed — and the IIFE is one character from the fix the gate
itself prints, so it waved through the mistake a reader tidying this code is most likely to make.
Now it descends into classes and skips only method bodies and instance fields, and treats a function
as deferred only when it is not a call's callee. Proven on a throwaway provider carrying both
hazards plus two safe controls: 2 reported, 2 silent, then deleted. Also taken: the eviction comment
claimed a failed *chunk fetch* could be retried, which the host module map makes false — it now
claims only what it delivers; and a failed load is re-wrapped to name the domain, since Vite's own
message names a hashed URL and lands at whichever call site happened to be first. Two findings
filed rather than folded in — **D214** (the size ratchet is now slack by ~59 KB, but re-tightening a
shared budget would fail other lanes' uncommitted work) and **D215** (44 provider chunks add a
round-trip in front of each domain's first request; measure before grouping). Gates re-run after
the fixes: `check` exit 0, cycle gate green, boot canary + featured 6 passed.

Not committed; the tree carries other lanes' work.



### 2026-08-12 — D53 + D49: the moderation door, and attachments that survive the round trip

**Two backend rows closed together because they meet in the same place** — the moderated read has to
return attachments, and an attachment has to be exactly as private as the message carrying it.

**D53 — `GET /admin/conversations/{id}`.** Built as a separate endpoint in `moderation/`, because the
row's own text names the failure mode: a role check inside the participant guard is how a private
surface quietly stops being private. `ConversationService.mine(...)` is unchanged to the byte, and a
new assertion pins that — admin and staff both still get 404 on `/messages/{id}`. The read is audited
*before* the projection is built (`conversation.moderation_read`, both participant ids + message
count), so a read that then fails to render is still on the record. Gated on a new
`conversations:read` atom in the existing `BackOfficePermissions` vocabulary, **admin-only at
baseline** since the permission document may only intersect and a baseline grant to staff could never
be withdrawn per-account. No list endpoint and no write atom, both deliberate. No mobile numbers in
the projection; reading clears no unread flags.

**D49 — message attachments, both `MessageCreate` surfaces** (chat + support ticket; the service-request
one takes a `MessageRequest` and was never in scope). Two-step upload-then-reference rather than a URL
on the body — a client-supplied location the platform re-serves is a request-forgery surface. Storage
is the existing `provider/FileStorage` seam; the magic-byte table moved out of `documents/vault` into
`common/validation/MediaSignatures` so the two surfaces share it instead of drifting. Caps: 5 MiB /
file, 5 / message, 10 unsent / thread. Declared type checked against the bytes, sniffed type stored.
An attachment id is claimable only by its uploader, only on its own thread, only once. Read
visibility follows the message *by construction* — the only producer of the shape is a batched lookup
the mapper runs after the thread's own guard.

**Two mutation proofs, both reported red then restored green:** dropping the permission atom from the
guard turned `staffRefusedByThePermissionAtom` and `refusedReadIsNotAudited` red (403 → 200); removing
the `audit.record` call turned `readIsAudited` and `everyReadIsRecorded` red. 28 new tests, 89 green
across the two new classes plus the four neighbours they touch, seven guard tests green.

`V76__message_attachments.sql`; `IMPLEMENTED_FLOOR` 243 → 246; `message_attachments.file_name`
classified RETAINED in `ErasureCoverageTest`. Not committed — the tree carries other lanes' work.



### 2026-08-12 — debt wave 12: five lanes, and two of them find the register was wrong about itself

**Five register rows closed (D37, D63, D65, D125, D129), one opened-and-closed (D209) for a real
duplicate-account bug, and D208 narrowed rather than fixed.** Five write-disjoint lanes ran in
parallel — four implementing, one a read-only audit — and the two most valuable findings were both
corrections to the register rather than code.

**Lane A — D208, the import-cycle shape.** `MAX_PAGE_SIZE` moved into new leaf
`services/apiLimits.js` (imports nothing, and says in a header that adding one re-arms the crash);
`http.js` re-exports it, five providers import it directly. An audit established it is the *only*
non-function export of `http.js`, so nothing else can be read at module scope in a way that
matters. New `scripts/check-provider-cycle.mjs` parses every provider with espree — ESLint 8's own
parser, already in `node_modules`, deliberately **not** added to `devDependencies` to avoid
rewriting `package-lock.json` mid-wave — and is wired into `npm run check` as `check:cycle`
(`58 provider modules, no module-scope reads`). Proven red twice before being believed. And the
guard wave 11 asked for exists: `platform/boot-canary.spec.js` renders `/`, `/listings`,
`/dashboard` and `/admin` with a `pageerror` listener. **The cycle itself still exists** — the lazy
glob is the only fix that removes it, and it makes `createProvider` async across the whole seam.
That is an architectural call and it is not taken.

**Lane B — D63 + D65, finance disclosure.** Applied the standing ruling: *defer + document + make
configurable, don't build yet*. Three properties (`punenest.finance.payouts-measured`,
`.refunds-measured`, `.service-orders-counted`, env-overridable, all default `false` = today's
truth) ride the `AdminFinance` response and mark the structural zeros in place — the figures stay,
they are simply labelled as not measured. No payout path, no refund path, no fourth `union all` in
`REVENUE_BY_SOURCE`. Reasoning in `docs/flows/admin/finance.md` §5.11; three backend test classes
plus `admin/finance-disclosure.spec.js`.

**Lane C — D37, the service-split rule.** The rule is now `package-structure.md` §4.1 and
`foundation/ServiceSizeGuardTest`. **The row's premise was false**: it claimed services top out at
405 lines; the true maximum is 1087, and six services were already past the 450 it proposed to
agree "while it is free". The six are pinned at exact measured size — may shrink, never grow —
rather than split or excused by raising the threshold, with guards that fail if a pinned file
vanishes or drops under the line without its entry being removed.

**Lane D — read-only audit of D129 and D125.** Both verified CLOSE against source, file by file.
Two nits: the route-deferred chunk count is 15, not the 14 D129 claims, and D129's gzip figures
were never re-measured against a fresh build. One flagged defect turned out to be a **false
alarm** worth recording — a row containing `` `buyer\|owner\|staff\|admin` `` looks malformed, but
escaping pipes inside a code span is required in a GitHub table and is exactly what the register's
own counting snippet undoes.

**Lane E — D209, two live accounts could share an email.** `\d+ users` returned nine indexes and
**none touched `email`**. Archive is a soft delete, so *create → archive → re-create → restore the
first* produced two live rows on one address, and `AuthService`'s `.orElse(null)` over an
`Optional`-returning derived query then threw a **500 for both people** — while the restore had
reported success, so the audit trail said nothing. Fixed in three places: a repository check, a 409
in `UserAdminService.restore` that names the address, and `V70__users_live_email_unique.sql`
(`UNIQUE (lower(email)) WHERE archived = false AND email IS NOT NULL`). Four mutations run, not
assumed — including replacing the partial index with a total one, which proved partiality is
load-bearing. Zero duplicates in either database today.

**Verification (serial, on the merged tree).** Backend `Tests run: 1374, Failures: 0, Errors: 0,
Skipped: 3` / BUILD SUCCESS (up from 1356; +18 from the new classes, and it settled the one
question the lanes could not answer between them — two of them had reported test compilation broken
by a third's uncommitted constructor change). Frontend `check` / `lint` / `check:size` all EXIT=0,
0 lint errors against a 395-warning baseline, i18n 675 files and 4469 keys in each of hi and mr.
**`check:size` is at 495.2 KB of a 497 KB budget — roughly 1.8 KB of headroom, and no lane could
attribute its share of the +2.3 KB because four of them were editing the same tree.**

**Carried:** the lazy-glob decision (D208) needs an owner; `addStaff`/`update`/`updateMe` still set
emails case-sensitively, which the new index catches but only with a generic message; and
`AdminUsers.jsx` restores through `mockApi.restoreRecord`, a localStorage write, so the improved
409 is not yet reachable from an operator's screen.


### 2026-08-11 — debt wave 11: three lanes land, and the verification step finds the app does not boot

**Four register rows closed (D32, D183, D201, D205), one verified as already-shipped (D176), and
one opened (D208) for a crash that none of the static gates could see.** Three write-disjoint lanes
ran in parallel; the value of the wave turned out to be in the step after them.

**D201 — a role change now lands on the next request, not the next token.** New kernel-side port
`security/RoleSource`, satisfied directly by `UserRepository` (`extends JpaRepository<User, UUID>,
RoleSource`) so the shared kernel does not import a feature context — the mirror of what `User
implements TokenSubject` does on the issuing side. `JwtAuthFilter` rebuilds the principal when the
stored role disagrees with the token's copy. An empty `roleOf` is **not** a denial, and
`DataAccessException` is deliberately not caught. Mutation-proven both ways: reverting the fix gives
`expected: 403 but was: 200` *and* `expected: 200 but was: 403`, the second of which is what rules
out the cheap "distrust the token, assume the weaker role" pseudo-fix. `team` stays token-sourced on
purpose — a desk is a routing label, not a privilege level.

**D205 — the Team & Access console stops being theatre.** `AdminTeam.jsx` no longer imports
`lib/mockApi.js`; a new `services/teamService.js` fronts http and mock providers over the seven real
endpoints, so the last-administrator floor is now a genuine 409 instead of a mock that always says
yes. Pending approvals is a *third tab* on `/admin/team`, not a new route, which keeps it inside the
existing lazy boundary — critical-path bundle unchanged at 492.9 KB. `Remove` was deleted rather
than disabled: there is no hard-delete endpoint and there should not be one. One asymmetry survives
and is recorded rather than papered over — the mock's floor counts every `role === 'admin'`, the
server counts only those holding `users:write`, so the mock is conservative but not at parity.

**D32 / D183 — two small frontend debts.** ProfileTab's identity chips are translated (en/hi/mr),
with the still-English labels beside them named in the row rather than left to be discovered. The
flatmate duplicate-409 path now writes the hand-off record instead of showing a done state for a
thread that is not there; the guard has to check *two* places because `lib/chat.js` consumes the
pending queue the first time Messages mounts, so a queue-only check would duplicate.

**D176 was already done.** All three prescribed corrections were in the tree and live in both
databases — confirmed with `\d+`, not by reading the prose. The row is re-worded to say it is parked
until the next from-empty rebuild, because editing V27 moves its checksum and breaks every applied
database on boot. **A register row is a claim, not an observation.**

**Then the verification step earned the whole wave.** `check`, `lint` and `check:size` were green;
the backend suite was 1356/0/0; and the application rendered an **empty `<body>` on every route**.
`services/config.js` eagerly globs every provider and `http.js` imports `config.js`, so a provider
can be evaluated inside `http.js`'s own evaluation — and `dealProvider.js` and `visitProvider.js`
each read `MAX_PAGE_SIZE` at module scope, in its temporal dead zone. They had worked for months;
adding Lane B's unrelated `teamProvider.js` changed the glob's ordering and detonated both. Fixed by
deferring the read (`const paged = () => ({ size: MAX_PAGE_SIZE })`). Diagnosis took one throwaway
spec hooking `page.on('pageerror')` after two full suite runs had produced nothing but timeouts.
**D208** records the shape rather than the instance: three other providers are safe by accident, and
no static gate can ever catch this — a Vite build resolves an import cycle happily. The standing
rule it produces: *a frontend wave is not verified until one e2e spec has actually rendered a page.*

Three of the wave's own new tests then failed on a wrong assumption rather than a regression — a
fresh flatmate ask has `state: 'pending'`, which `Messages.inTab` files under **Requests**, and the
spec was asserting on Chats. The tell was that one of the three failed on the plain success path,
which the change had not touched.


### 2026-08-11 — the review of the review finds the alarm was never wired

**A code review of the D200 security fixes (below) found a genuine, pre-existing bug in code D200
never touched: refresh-token reuse detection had been rolling itself back.** ADR-008 treats a
replayed refresh token as evidence of theft and burns the whole family before answering 401 — but
`RefreshTokenService.rotate` and `AuthService.refresh` were both plain `@Transactional`, and the
revocations are dirty-checked entity mutations, so the throw discarded every one of them. The thief
got a 401 and **every sibling token stayed live for the remaining TTL**, which is exactly the window
the burn exists to close. Fixed with `noRollbackFor = UnauthorizedException.class` on *both*
methods — both, because a participating advice marks the shared transaction rollback-only and the
outer commit would then fail as a 500. That is tech-debt **D90**, already written up at length on
`OtpService.sendLoginCode`, two files away. Logged as **D207**.

**Why it survived, which is the part worth keeping.** The response is identical either way — a
replayed token is already revoked, so it answers 401 whether or not the family burned — and
`AuthEndpointsTest.refreshRotatesTokensAndOldTokenReuseRevokesFamily` asserted only that 401. The
suite reported the feature as covered by a test that could not have failed if the feature were
deleted. Second instance of a test-name-as-only-implementation in one review.

**And the replacement assertion was wrong three times.** The obvious fix — carry the successor
token forward and expect it dead — passes with the bug restored, because the revoked entities stay
managed in the test's own transaction and answer "revoked" whether or not the write would ever
reach the database. So do `TestTransaction.isFlaggedForRollback()` (reports the test's end-of-run
preference, `true` always) and the bound `EntityManagerHolder`. The `ConnectionHolder` is the thing
Spring actually marks; reading both under the restored bug gave `false/true`, which is what settled
it. Each probe was run against the reintroduced bug before being believed — which is the only
reason the fourth one is worth anything.

Also from the review: three new D200 behaviours had no tests at all (the refresh gate, the
archived-approver 403, the self-approval audit row) — **added, +3**; `approve()`'s `noRollbackFor`
was inert and its comment said otherwise (`AuditService` is `REQUIRES_NEW`, so the row survives
regardless) — **annotation dropped, comment corrected**; a duplicated comment block left by a
mutation-test cycle — **removed**; two comments overclaiming what a test pins — **rewritten**.
Suite **1354 green**, 0 failures, 0 errors, 3 skipped.


### 2026-08-11 — reviewing the new lock finds it fitted to the wrong door

**A security review of D200 (the maker-checker shipped hours earlier, below) returned no CRITICAL
and confirmed the core mechanic holds: there is no way to mint a usable administrator without a
second human.** It also found a permanent-lockout bug, a latent auth bypass, and three comments
asserting things that were false. All backend, all fixed here except two rulings. Suite **1351
green** (up two — the regressions below), 0 failures, 0 errors, 3 skipped.

**The lockout.** `UserAdminService.addStaff` asked `approvalIsPossible(creator)` *after* flushing
the new user. That query counts `role = 'admin'` accounts excluding the creator — so on a
single-admin platform, creating an admin colleague **counted the colleague**, held the account, and
left it approvable by nobody: the maker is refused by the maker-checker rule, and the held account
cannot obtain a token to approve itself. There is no reject or cancel route, so the account was
stranded permanently, on precisely the path the bootstrap escape exists to keep open. One line
moved. What makes this worth reading twice is *why sixteen green tests missed it*: the test that
should have caught it creates a **staff** account, which does not match the query's `role` predicate
and so never self-counts. Added `theSoleAdministratorCanMintAnAdministrator`, then **reintroduced
the bug to watch it fail** — exactly one test went red and it was the new one, which is the only
evidence that a regression test written from a review finding actually pins anything. The same
audit showed `archivingThePeerDoesNotReopenTheEscape` was **vacuous for the same reason** (count was
1 either way, so it would have passed with the `archived` filter it exists to forbid); kept, and
paired with a `role=staff` twin that genuinely pins it.

**The bypass.** `POST /auth/refresh` mints an access token directly rather than through `issueFor`,
so it never consulted the approval table — a held account with a live refresh token would have kept
refreshing for the whole TTL. Not exploitable today, and the reason is the interesting part: the
only writer of an approval row creates it in the same transaction as the user, so no token can
predate the hold. That is true of today's write paths and **nothing enforces it**; it stops being
true the first time anyone holds an *existing* account, which is the obvious incident-response use
this table's own comment invites. The gate now runs on all three issuing paths.

**Three false comments, including one in the database.** V67's table COMMENT claimed a pending row
blocks authentication "on every login path" — it did not, per the above. Editing an applied
migration turned out to cost the whole suite (`Migration checksum mismatch for migration version
67`, 33 tests erroring at 0.001s on context load), so the correction shipped as **V69**, which
states plainly what the old sentence got wrong rather than quietly replacing it. The `AuthService`
Javadoc claiming `refresh` was "covered transitively" and `AdministratorGuard`'s account of the
bootstrap escape were both corrected in place.

**Two smaller ones.** `ForbiddenException` joined `login`'s `noRollbackFor` — a held account's OTP
was burnt *before* the 403, and rolling back handed back the code's single-use property for its
whole TTL. And `approve` now audits the self-approval refusal and requires the approver to still be
live: reaching it proved only that the caller held a valid token, and an administrator archived five
minutes ago holds one until it expires. Every other definition of "an administrator who counts" in
that package runs through `AdministratorGuard.isCapable`, which excludes archived accounts; this
endpoint was the one place trusting the token alone.

**Opened D206 (High) rather than fixed it**, because it is a genuine trade and not a defect. The
maker chooses the new account's mobile and password; the checker is shown a masked number and no
`createdBy` at all — so the second signature attests to a *record*, not a *person*, and the original
D200 attack still runs with a co-signature attached. Surfacing `createdBy` and the unmasked mobile
would fix the judgement problem but cuts directly against `pendingApprovals`' deliberate masking,
whose own note calls an unmasked queue "a small bulk-export surface wearing the clothes of a to-do
list". Needs a ruling, and it should land **before** the D205 console is built rather than be
retrofitted onto one.


### 2026-08-11 — debt wave 10: back-office administration gets two keys, and the console it protects turns out not to exist

**Four lanes in parallel. Three register rows closed (D200, D202, D203), two opened (D204, D205).**
Lanes B and C wrote their own entries below; this one covers the rest and the merge.

**D200 — a narrowed admin could rebuild itself, closed by both halves.** Migration **V67**
(`staff_account_approvals`), `IMPLEMENTED_FLOOR` 233 → 237 with D194. *Maker-checker:* a
`POST /users/staff` creation writes an approval row and the account cannot authenticate until a
second administrator signs it off. The gate sits in `AuthService#issueFor`, not in each flow, so it
covers the password path **and** the OTP path — the latter being the one that matters, since a
freshly minted account has a mobile and needs no password. `approved_by <> created_by` and
"a decision has both a decider and a timestamp" are database CHECKs as well as service rules,
because a two-key rule enforced in one place is a one-key rule with extra steps. *The floor:*
`AdministratorGuard` refuses to archive or demote the last capable administrator, held under
`pg_advisory_xact_lock` so two concurrent archives cannot each see the other as the survivor. The
halves are load-bearing for each other — the bootstrap escape asks whether a second administrator
has *ever* existed, and the floor is what stops someone archiving their way back down to being the
only one. **The escape is the part to be suspicious of:** with one administrator, "two people
agreed" is unobtainable, so no row is written and the account is live at once; it is re-evaluated
per creation and audited as `user.staff.create.bootstrap` rather than folded into the ordinary
action, so "this account skipped maker-checker" is searchable.

**D205 opened, and it is the finding of the wave.** Closing D200 forced the question "closed
*where*" — and `users/staff` appears nowhere in `frontend/src`. `AdminTeam.jsx` imports
`saveTeamMember` / `setTeamMemberStatus` / `deleteTeamMember` straight from `lib/mockApi.js`,
bypassing the services seam, so the console that administers back-office accounts writes to
`localStorage` on every environment. Everything D192 and D200 built is enforced, tested, in the
OpenAPI spec, and unreachable from the product. The failure mode is not a missing feature but a
confident wrong answer: archive the last administrator in that console and it succeeds.

**D203 and three quick wins (lane D).** Bundle budget 540 → **497 KB** against a measured 492.9,
mutation-tested both ways (492 fails, 497 passes) so the threshold is known to be live rather than
merely written down. `VerificationAnnouncer`'s Javadoc rewritten — its *argument* was wrong, not
just its package name. Index II's verification overclaim fixed in `home.faq.a2` across en/hi/mr.
`Privacy.jsx` §1.2 gains the referral-capture bullet.

**Merge repair.** Four lanes each self-verified green; merged, the tree would not compile —
`AuthServiceRaceTest` builds `AuthService` by hand and lane A had added an eighth constructor
parameter. Then five D200 tests failed, all on the same cause in two directions: `AbstractApiTest`
is `@Transactional`, so a `jdbc` read cannot see an API write without `em.flush()`, and a `jdbc`
write cannot be seen by the code under test without `em.clear()`. One of the repaired assertions
expected **zero** and had been passing regardless of whether its subject worked. Full suite after
repair: **1349 tests, 0 failures, 0 errors, 3 skipped.** Frontend `check` 0, lint 394/0 (baseline),
`check:size` 0. See `lessons.md` for the flush/clear pair and why per-lane green proves nothing.


### 2026-08-11 — D194: a real tenant can finally review the flat they lived in

**One register row closed (D194), one opened (D204).** Migration **V68** (`tenancy_declarations`),
four new routes (`IMPLEMENTED_FLOOR` 233 → 237), one new backend test class (10 tests), one new
Playwright spec (2 tests). Backend: `TenancyDeclarationFlowTest`, `TenancyEndpointsTest`,
`ReviewEndpointsTest`, `VisitEndpointsTest`, `SpecCoverageTest`, `ArchitectureBoundaryTest` —
**87 tests, 0 failures**. Playwright: `tenancy-declaration.spec.js` + `review-composer.spec.js` +
`reviews-summary.spec.js` — **5 passed**.

**The bug.** `ReviewsSection` decided "has a tenancy" from `getTenanciesFor(myMobile())`, a
`localStorage` bucket nothing on the live path ever writes. Against the API it was unconditionally
false, so the review composer was shut to the one person most entitled to open it — and every
mock-mode test passed, because in mock mode that bucket answered both halves of the check at once.
It agreed with itself and with nothing else.

**The ruling it needed.** A stay is proven by a **brokered agreement** *or* an **owner-confirmed
self-declaration**, and nothing else. Both halves are built, because the first alone would have
fixed almost nothing: a `tenancies` row only exists when a rent deal closed *on this platform*, and
most Pune leases are signed off-platform, so the honest majority of ex-residents would have stayed
locked out of a door that now merely worked.

**What that cost.** The brokered half is `myTenancies()` off the seam, matched on the same
`p.uuid || p.id` the review routes bind — a UUID against http, a slug against the mock, true on
each. The declared half is a new resource: V68, `TenancyDeclarationService`, four routes, and
`PropertyExperienceService.standingOf` now reading both sources. Deliberately **not** a `tenancies`
row (V12 permits one active per property; a typed claim written there becomes indistinguishable from
a signed agreement at every later read, including the ones about money), **not** a second reviewer
badge (once the landlord agrees it is no longer a self-claim), and **not** confirmable by anyone who
merely happens to be verified — the check is against the listing's `owner_id`, because "someone real
said yes" and "the landlord said yes" are different facts. Revocation is a status, never a delete.

**The tests are pointed at the loophole, not the feature.** Making a resident eligible is easy;
doing it without minting a self-service review button is the whole problem. So the load-bearing
assertions are negative — a *pending* claim must not open the composer (422 server-side), and a
*withdrawn* confirmation must close it again — and both were **mutation-checked**: weakening
`hasTenancy` to accept any declaration turns the e2e red, and dropping the `status = 'confirmed'`
filter from the repository query turns 3 of the backend tests red. A "the button now appears"
spec would have passed both mutants.

**Three review agents, and the third one blocked.** `react-reviewer` and `security-reviewer` ran
first and their findings were applied. `code-reviewer` then returned **BLOCK** on a CRITICAL the
other two missed: the reversed-dates test asserted **400** while `GlobalExceptionHandler` answers
bean-validation failures with **422** and a `fields[]` array — the test passed only because the
request was refused for a *different* reason than the one it claimed to prove, and three comments
and the OpenAPI document had been written around the same wrong belief. It also caught that the
declaration list returned an unbounded array where api-standards §5.1 requires a `PageEnvelope` for
inbound demand (rows written by *other* users against the caller), which is now paged. Five further
findings applied, four branches added to the suite (revoke-of-pending, re-confirm-after-revoke,
stranger revoke, absent declarant). A `code-simplifier` pass followed in strict
no-behaviour-change mode; it applied five reductions and skipped seven as not provably equivalent.

**Opened as D204, not built:** revocation is not retroactive. `ReviewService` freezes the standing
into the review's `context` badge at write time, so *confirm → publish → revoke* leaves a published
review wearing a badge whose evidence has been withdrawn. Retracting the review on revoke would hand
every owner a delete button for criticism, which is the outcome the eligibility rule exists to
prevent — so this is a **product ruling and not an agent decision**, and it is carried as
`open-questions.md` **Q19**. The same row records that nothing prevents an owner confirming an alt
account they control; the audit log makes it detectable, not impossible.

**Not run:** `npm run parity:rent`. It requires a live backend on :8080 and one was not available in
this session. Nothing in the slice is provider-shape-specific beyond the four functions added to
both providers, but the harness has not confirmed it.

**Proved on the mock only:** the Playwright spec runs in mock mode, so it proves the UI agrees with
the mock provider — the same kind of self-agreement that hid the original bug. The server side of
the identical rule is proved against real HTTP in `TenancyDeclarationFlowTest`; a `live-*`
counterpart under `playwright.live.config.js` would close the remaining gap and does not exist.

**Blocked on someone else's tree, not mine:** `AuthServiceRaceTest` does not compile against the
in-flight `AuthService` (it gained a `StaffAccountApprovalRepository` argument that the test has not
been updated for), which fails `testCompile` for the whole module. The D194 backend suite was
therefore verified in a throwaway copy of `backend/src` with that one file removed; nothing in the
working tree was touched to get there. Re-run the module suite once that lane lands.



### 2026-08-11 — parallel debt chunk: verification becomes earnable, referrals become real, back-office access becomes narrowable

Six lanes run in parallel. **Nine register rows closed** (D190, D191, D192, D13, D55, D56, D60, D61,
D196), one verified already-closed (D129), **four new rows opened** (D200–D203). Backend suite
**1315 tests, 0 failures**; frontend `npm run check` green; Playwright 44/44 on the changed surfaces.
Three migrations landed: **V63** (ownership evidence), **V64** (referral qualification + signals),
**V65** (back-office permissions).

**D190 — the verification badge becomes earnable.** `property_ownership_evidence` records each
sighted document against the three facts Q15 requires, and the badge is set only when all three are
covered. It is a **derived read**, not a swept column: a sweep leaves a window where the badge is
live but unearned, and the platform's own scheduler could skip or double-run it. Per-type expiry
(recurring proof 90d, site photos 180d, registry and government ID never); a listing's verification
expires when its earliest relied-on document does. On lapse the badge drops and the listing stays on
search. The copy was also wrong in a way that mattered — it promised a registry match the platform
has never performed — and that, not the state, is what the new e2e asserts.

**D191/D56/D60/D55/D61 — the referral credit stops being a browser number.** `ReferralQualification`
implements `VerificationAnnouncer`, so `moderation` announces a verification and `billing` hears it
without either importing the other. Idempotent by construction: it only ever loads a *pending* row,
so a re-verification after lapse and a second verified listing are both no-ops without needing to be
told apart. It runs in the verification's own transaction — `REQUIRES_NEW` would commit a credit for
a verification that then rolled back. `sameIp`/`sameDevice` are salted SHA-256 digests, never raw
values, blanked at 90 days; unsalted would be reversible by enumerating 2^32 addresses, which turns
a fraud signal into a stored address, so `REFERRAL_SIGNAL_SALT` is a mandatory prod variable with no
default. The volume cap gates **automatic** minting only — past it a referral waits for the fraud
desk, exactly as every referral behaved before — so a genuine flatshare is delayed, never rejected.

**D192/D13 — back-office access becomes narrowable, and a one-word bug nearly shipped.** Resolution
is `effective = baseline ∩ document`. An intersection cannot yield a member neither operand had, so
narrow-only holds by construction, and `*` and unknown names are dropped by the same operation with
no wildcard branch to get wrong. Permissions are read from the database per request, deliberately
**not** from the JWT: a capability set inside a signed token is a client-held allow-list that cannot
be revoked before it expires. **The lane's agent crashed mid-flight and left the resolver as
`addAll` — a union — so every "narrowed" account silently kept its entire baseline.** The guard was
wired correctly; the resolver could never say no. The class's own Javadoc, V65's header and V61's
spec all already said intersect — only the code disagreed. Caught by running the *full* suite after
the merge, which per-lane green would never have shown, and confirmed by mutation.

**D196 — an inert sort key is worse than none.** `SocietiesSection` tie-broke on `entityRating`, a
reduce over a `localStorage` bucket a live session never writes: a constant zero, so the ordering it
promised never happened while reading as deliberate. Deleted rather than wired — reading the real
aggregate costs a four-page walk of the 348-row directory on the home page to break ties among eight
cards. With its last caller gone, `entityRating` itself is deleted.

**D129 — zero diff, and that was the finding.** Both halves were already closed in code; the
register entry was stale. Verified rather than assumed: `db-*.js` 22.33 KB and `societies-rera-*.js`
24.84 KB gzip, neither in `dist/index.html`, critical path 492.9 KB. Measuring it is what exposed
D203 — the 540 KB budget catches a both-file regression by 0.07 KB and catches neither file alone.

**Three lessons worth more than the lanes.**
1. **A crashed subagent may still have written everything.** Two lanes returned transport errors at
   the reporting stage; both had already landed their migrations and classes. Assess the tree before
   relaunching, or you re-run completed work on top of itself.
2. **Per-lane green does not prove co-existence.** Every lane passed its own tests. The full suite
   found 8 failures, one of them a privilege escalation.
3. **A new control re-prices the gaps around it.** D192 did not introduce D200 — `users:write` has
   always been able to mint an administrator — it made that fact load-bearing by putting a boundary
   next to it that someone might now rely on. Look for this after shipping any security control.

**Left open deliberately:** D194 (tenancy proof) and D63/D65 (finance) were scoped but not built —
D194 needs V66 and has a slug-vs-UUID trap that would fail silently while mock tests stayed green;
D63/D65 are a documentation-and-configurability item per ruling, not payout machinery.


### 2026-08-11 — D202: the evidence table's integrity, and the admin timeline that 500s when unfiltered

**D202 schema (V66).** Four repairs to V63's `property_ownership_evidence`, which is on disk and
checksummed, so all four are alterations rather than edits. `property_id` CASCADE → RESTRICT (the
table's own comment and `revoke()`'s Javadoc both promise the case file survives; the cascade made
that conditional on the listing outliving the dispute). `recorded_by` gets a stated RESTRICT rather
than an inherited default. `CHECK (expires_at IS NULL OR expires_at > issued_at)`. And
`subject_name`, required for `aadhaar`/`pan`: an `owner_identity` row that says an identity document
was seen without saying *whose* cannot be checked against anything, so it cannot be wrong, so it
proves nothing. The document number is deliberately not stored, masked or otherwise.

**D202 concurrency.** `PropertyRepository.findForVerificationDecision` (PESSIMISTIC_WRITE) is taken
by all three verification writes. Stated honestly: the duplicate referral credit this prevents is
already absorbed downstream by `ReferralRepository.findPendingForQualification`, whose own lock
exists for exactly this, so **no race test could go red and none was fabricated**. The lock is here
so the path stops depending on a guarantee another context owns.

**Two register claims were wrong, and finding that out was the point.** The `recorded_by` row said
archiving an ops user would be a foreign-key error — unreachable: erasure pseudonymises the `users`
row rather than deleting it. And the table was not "quietly skipped" by `ErasureCoverageTest`; no
column in it matched the classifier's personal-data vocabulary, so the heuristic legitimately never
fired. Adding `subject_name` is what forces classification — the sixth defect is what closes the
fourth.

**D202 audit log — a `? is null` with no type.** `GET /admin/audit-log` unfiltered was 500 on
PostgreSQL 13: `could not determine data type of parameter $5`. Fixed with HQL casts in the null
checks only, matching `TransactionRepository`. **Casting both occurrences is the same bug in a new
costume** — Hibernate types a parameter from how it is *used*, a cast is not a use, and a parameter
appearing only inside casts binds as `bytea`; the first attempt swapped a Postgres inference error
for `cannot cast type bytea to timestamp with time zone`. Verified both ways.

**One test was passing for the wrong reason.** `staffCanWithdrawABadgeAndTheCaseFileRemains` read
`ownership_verified` through `jdbc` with no flush, so it asserted the column's value from insert
rather than from the withdrawal. Nothing forced a flush until the new row lock introduced a query on
`Property`; the accident then became a red test. Fixed with an explicit `properties.flush()`.

**Four things a security review caught, all fixed in-slice.** (1) The audit entry initially copied
`subjectName` into `audit_log`, which has no retention window and about which `ErasureRetention`
tells the subject in as many words that they appear "as an entity id, not as a name or a number" —
copying it there would have quietly falsified a live disclosure, so the audit entry now points at
the evidence row instead of duplicating it. (2) `ErasureRetention.retainedWithReasons()` claimed
listing records "carry no contact data of their own", which `subject_name` made untrue; the
subject-facing text now names the retention and why. (3) Rows written before V66 can be identity
documents with no `subject_name` — the CHECK binds writes from V66 onward but cannot retrofit a name
nobody recorded — and `gate()` was still counting them as satisfying `owner_identity`, so the
badge could still rest on exactly the assertion this work exists to make falsifiable; `gate()` now
skips them and the listing stays unverified until ops re-sight the document. (4) `revoke` took the
row lock and only then rejected a blank `reason`; the validation moved ahead of the lock, and the
two-lock protocol this slice creates (`properties` then `referrals`, never the reverse) is now
written down on the finder rather than being discoverable only by reading three files.

`IMPLEMENTED_FLOOR` delta **0** — no new routes. Suite **1335 tests, 0 failures**, one pre-existing
error in another lane's `AdministratorGuardTest` (identical before and after this slice).


### 2026-08-11 — D197: the society rating stops being half invention, and the mapper that was hiding it

**D197.** `useSocietyHub` blended each aspect 50/50 with `baselineBars(soc)` — a deterministic
estimate seeded off occupancy and build year — for every society that was neither thin nor
community-sourced, i.e. all 348 curated rows. A society nobody had rated drew five confident bars; a
society one resident had rated 2.0 displayed **3.1** with "(1)" beside it, so the count made the
number look sourced. Deleted the baseline outright rather than labelling it: the honest states
already existed and were merely unreachable. `bars` is now `catAvg` filtered on `Number.isFinite`, so
a partly rated society draws a partial grid; `overall` is the residents' average or `null`. The hero
says "Not rated yet"; the Reviews tab renders nothing at the aggregate slot and lets the empty-list
line speak. Mutation-proven: restoring a constant `4.1` fallback failed exactly the two rewritten
specs and left the vocabulary one passing.

**The deletion uncovered a live-only defect the baseline had been covering.** `http/reviewMapper.js`
copied `categoryAverages` through one hardcoded allowlist holding the *property* vocabulary, and
`getEntityReviewSummary` shares that mapper — so all five society keys were dropped and `catAvg`
arrived `{}` on every society against the real API, permanently. Nothing failed: the mock provider is
target-aware so the suite was green, and `live-society-rating.spec.js` asserted the raw JSON via
`page.request.get`, which cannot catch a client mapper. Without the baseline this would have shipped a
headline over an empty grid. `toSummaryViewModel` now takes `entityType` and selects the vocabulary,
mirroring `ReviewCategories.forTarget` and the mock's `categoryKeysFor`; the live spec now reads a
rendered `society-bar-*` cell as well as the payload.

Gates: `tests/consumer/society` + the D198 composer spec 52 passed; lint 394/0 errors; i18n 4426 keys
(−1, `communityEstimate` deleted from en/hi/mr together) × hi/mr; bundle 492.9 KB of 540; coverage
citations 166/216 all resolving. Register recounted: 52 open, 24 Med / 28 Low.


### 2026-08-11 — three debts closed: a 404 that claimed to be a 500, an invented star rating, thirty unnamed buttons

**D193.** Every unmapped path under `/api` answered 500. `GlobalExceptionHandler`'s
`@ExceptionHandler(Exception.class)` catch-all outranks Spring's `DefaultHandlerExceptionResolver`,
so "no such route" fell into the generic bucket — it told integrators "we broke" when the truth was
"that route does not exist", and inflated error-rate alerting with non-errors. It only surfaced for
callers *holding a token*, because unauthenticated requests are answered 401 by the security filter
first. Added a `NoResourceFoundException` handler returning the standard 404 envelope, logged at
`debug` with method + path. Mutation-proven: `expected:<404> but was:<500>` without it.

**D195.** `SocietySection.jsx` rendered a hard-coded `4.2` star strip for societies nobody had rated
— the D101 pattern in quantitative costume, and the exact value the society *directory* had just been
taught to reject. Moved onto `getEntityReviewSummary('society', slug)`, the same read the hub uses, in
an `alive`-guarded effect. Three honest states now, where there was one lie: unknown/failed renders
the builder alone and claims nothing; `count === 0` renders "Not rated yet"; only a real aggregate
renders stars. This leaves `entityRating` with **one** call site (`home/SocietiesSection.jsx:56`,
D196) — resolving that item either way deletes the function.

**D198.** The property review composer's stars had no accessible name: thirty identical
`<button>`s wrapping an SVG in one dialog, WCAG 4.1.2 on the only control that writes user content on
a listing page. `StarInput` now takes an `aspect` and labels every star, wording copied verbatim from
the society composer built one directory away — the asymmetry that made this worth recording is gone.
Both new specs were mutation-tested before being believed: the D198 one passed on its first run, which
proves nothing when an eligibility gate could have left the dialog unopened.

Gates: backend 129 classes / 1259 tests green; `tests/consumer/property` + `tests/consumer/society`
117 passed; lint 394/0 errors; i18n 4427 keys × hi/mr; bundle 492.9 KB of 540.


#### Earlier waves — index only

| Date | What shipped |
|---|---|
| 2026-08-11 | society reviews get their own aspect vocabulary, and the composer actually sends it |
| 2026-08-11 | Q14 answered: the foundation set splits, and a price edit stops costing the owner search |
| 2026-08-13 | the D129 seed race, and the `\|\| '{}'` fallbacks that would have hidden it |
| 2026-08-13 | the prod profile is now a tested contract, and the container can be told its port |
| 2026-08-10 | D79 actually wired up, plus the two defects that were hiding behind it |
| 2026-08-10 | debt wave 11 close-out: six register rows closed |
| 2026-08-12 | debt wave 10: seven write-disjoint lanes, ten register rows closed |
| 2026-08-11 | debt wave 9: six write-disjoint lanes, and the register's last High |
| 2026-08-11 | D180: the rent-agreement "product bug" was another lane's dev server |
| 2026-08-11 | D181: the three flatmate interest buttons now reach the API |
| 2026-08-11 | D174, D175, D50/D51, D100, D42 and the e2e reliability pair (D28/D29) |
| 2026-08-10 | D163, D132, D47, D129 (partial) and the flatmate duplicate-interest race |
| 2026-08-09 | D73, D92, D165 and the payment-hardening four (D169–D172) |
| 2026-08-09 | D77: the inbound-demand reads are paged, and the half that was already paged now works |
| 2026-08-09 | D151: the identity numbers reach one operator, are logged, and then stop existing |
| 2026-08-09 | Every payment family now has the cap and the sweep, not just the one that needed them first (D160, D161) |
| 2026-08-09 | Paid Leave & License, and the thirteen register rows the review of it opened |
| 2026-08-09 | The owner→visitor WhatsApp handoff was dead in the field names |
| 2026-08-09 | Eight decision-blocked register items closed in one pass |
| 2026-08-09 | D5 / open-questions Q2 closed: owner number is never revealed to a buyer (global policy) |
| 2026-08-09 | Decision-blocked items closed (open-questions Q1, Q3, Q4, Q5) |
| 2026-08-08 | The contract's schemas are now enforced, not just its routes |
| 2026-08-08 | Docs: one owner per fact |

Newest first. Each line: what changed, and the one thing worth remembering.

### Frontend ↔ API integration (the seam)

| Date | Slice | Note |
|---|---|---|
| 2026-08-09 | **Flatmate posts, rooms and groups are moderated before they are public (D72 closed)** | The board published on write: anything a signed-in user typed was on the public feed immediately, and the only "moderation" was a blacklist (`mod_status not in ('flagged','removed')`) — so every state added later would have leaked by default. Now all three tables default to `mod_status = 'pending'` (entity default **and** column default, `V41`, so a row inserted by any route is held) and visibility is a **whitelist**: `FlatmateVocabulary.MOD_PUBLIC = {live, approved}` + `isPublic(...)`, applied to the feed native queries, their `countQuery` twins and the by-id `findVisible` JPQL on all three tables — hiding a row from the list while leaving it actionable by id is an unlisted page, not moderation. `MOD_HIDDEN` deleted so the blacklist cannot come back. Author-facing surfaces stay unfiltered: `getMyRequest` still returns the pending post, edit and delete still work, and the banner reads "Your request · in review" (amber, clock) instead of "Your live request", with the wait explained; the two create toasts said "is live!" and are now "saved — our team is checking it" (en/hi/mr). New `GET /admin/flatmates/moderation` (`STAFF_OR_ADMIN`, `kind`/`modStatus`/pageable) returns a `FlatmateModerationQueueDto` carrying the author's **name only, never their mobile**. Mock provider mirrors the same default + whitelist (`publicOnly`). Fixtures in the two existing endpoint suites now `publish(...)` explicitly, so the default is asserted once, in the dedicated `FlatmateModerationGateTest` (not-public / author-can-still-see-it / the-queue). 860/860 backend green; contract 174 paths, 0 dangling. New e2e `consumer/flatmates/moderate-before-public.spec.js`; eight sibling specs gained a named `approveFlatmates(page, …)` helper that stands in for the moderator. **Ships with no admin UI for the new queue — API only.** | A visibility **blacklist is a leak waiting for the next state** — name the states that may be public and let anything new fail closed. Changing a column default breaks every fixture that leaned on it: publish explicitly in the fixtures so the default is asserted in exactly one place. And a gate makes every "created it, now see it on the board" spec wrong — the fix is one named helper that plays the moderator, never a weakened default; the spec for the gate itself is the one that must not call it. A success toast that says "is live!" becomes a lie the moment a queue exists, so grep the copy when you add one. |
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
| 2026-08-07 | **4 domains switched on in live config** (contact/saved/savedSearch/visit) | They shipped complete providers + parity harnesses in `e330cd3` but were never added to `VITE_API_DOMAINS`, so every live run since had exercised their **mocks**. A harness imports the provider and calls it — it cannot see a call site that never awaits or a request fired for a session-less visitor. Five defects fell out (`isHttpDomain` casing, session-less 401 spam, `PageEnvelope.page` unwrap, un-awaited alert cards, reschedule-throws) → D105–D107 |
| 2026-08-07 | **Abuse reports** — seam domain 11 | First domain whose two ends have different audiences (anyone files, only ops reads). Reason set is validated *against* target type — every flatmate report passed `kind='user'` and would have 400'd. Duplicate→409 (a localStorage write can't fail, so the modal used to toast success), terminal-is-terminal (no Reopen), `resolved`→`dismissed` on the way out only; `reporterId` withheld from ops |
| 2026-08-07 | **Support tickets** — seam domain 10 | Three controls (priority, attachments, name) had nothing behind them → **hidden** in http, not merely not-sent: an unknown field is ignored, not rejected, so a kept `priority` would toast success for a ticket ops never sees as urgent. Status/author-role(`owner`=customer)/`updatedAt`(derived from last message) vocabularies reconciled |
| 2026-08-07 | **Reviews** — seam domain 9 | `context` (the reviewer-standing badge) is server-derived and readOnly; three call sites forged it. Reviews were keyed on `soc.id`/display-name while everything else used `slug` — the one holdout, invisible on mocks. `avgRating` is **null, not 0**, for an unrated society; fields moved *up* to `Society` so hub and directory can't drift |
| 2026-08-06 | **Conversations** — seam domain 8 | Five shape gaps ruled on (`state`/`youAre`/`property.*`/`from`/attachments — client-staged, derived or NOT-IMPLEMENTED). Added `authorId` because attributing by display name breaks the first time two users share a name. `img:''` re-requests the page as an image (live-only console error); the list contract drops `messages`, so the inbox must hydrate a thread on open |
| 2026-08-06 | **Worklog compression + OpenAPI 3.1 nullable fix** | 5,294→ lines; the 86 "open" boxes were 62 already-shipped / 3 fixed here / 21 moved to register / 2 dup — a worklog never pruned stops being read. OpenAPI declared 3.1 but used the 3.0-only `nullable:true` ×66 (silently ignored → 66 fields typed non-null); converted to `type:[x,'null']` |
| 2026-08-06 | **Notifications** — seam domain 7 | Server/UI type vocabularies had *zero* overlap; untranslated, every filter chip would silently empty the page. `dismiss` is a client tombstone (no endpoint) |
| 2026-08-06 | **Listing moderation** — `GET /admin/properties` + the 4 decisions | The four writes had shipped months earlier with **no read that could find a listing to act on**. Inferring the route from filter flags 403'd every owner's dashboard — authorization-relevant routing must be named by the caller |
| 2026-08-05 | **Visits** — seam domain 6 | The seam carries the human `when` string and converts to the wire's ISO slot. *(Reschedule had no endpoint when this shipped; `PATCH /visits/{id}/slot` closed that in D87, 2026-08-09.)* |
| 2026-08-05 | **Saved searches + alerts** — seam domain 5 | Anonymous lead capture stayed local because `POST /me/saved-searches` 401s for exactly the signed-out visitor the card exists to capture. *(D85 answered this the other way on 2026-08-09: the card now routes to sign-in; anonymous demand is still counted, but no alert is created without an account.)* |
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
| 2026-08-13 | **Phase 5 pre-port audit: `permissions.js` + `contact.js` need no port — both already enforced server-side. No Java written.** The plan flagged these two as a security finding to fix ahead of the domain order; running its own first checklist item (confirm against the contract *before* writing Java) answered "don't". **`permissions.js`:** `security/BackOfficePermissions.java` holds 16 `module:action` atoms and every route carries two independent fences (`ADMIN_ONLY + " and " + REQUIRE_USERS_WRITE`); stored grants intersect a role baseline so a document may only **narrow**. The client speaks `customRoles`/`roleId`/`moduleAccess`/`properties:verify` — deleted in V61 (D67/D13), and `PUT /admin/settings` now answers **422** for `customRoles`. So it fails *closed* (`customRoles` is `[]` live) and the defect is the inverse of the one assumed: the console cannot render the real model. **`contact.js`:** `providers/http/contactProvider.js` is complete and imports exactly one symbol from it — the frozen `NO_CONTACT_GATE`; every gate function is imported only by the *mock* provider, so it retires by `git rm` in Phase 4. Helpers (`digits`, `maskPhone`, `fmtPhone`, `isFullMobile`, `myMobile`, ~15 consumers) stay as column B. **Two real items banked, neither security-critical:** `AdminFlagsContext.jsx` imports `getCustomRoles` from `lib/mockApi.js` directly, bypassing the service seam (Phase 4); and the Team & Access grid should render from `GET /admin/permission-catalogue` — filed as **open decision 3** in `docs/migration/README.md`, recommendation **(c) defer to the `team` domain flip**, since that seam fix forces the question anyway and avoids touching the console twice. Not started — architectural. Plan docs 05 + README corrected so the superseded "port these first" instruction cannot be followed by mistake |
| 2026-08-12 | **D133 closed won't-do, D158 re-verified still blocked — both were measurement tasks, and both registers were wrong about something.** D133: measured the dashboard load against a **production** bundle (`vite preview`, `VITE_API_DOMAINS=property,visit,contact,document`, Playwright intercepting `**/api/**`) — **6 requests / 6 distinct endpoints / 0 duplicates**, all concurrent, same for owner and seeker. The 4× duplicate the row remembered is gone, so no `GET /me/dashboard` was added. Two traps, both of which gave a wrong number first: the same run on `vite dev` reports **13 requests, every endpoint 2×** (`StrictMode`, dev-only), and `page.route` reported **0** for the seeker while the Vite proxy logged all six — page-level interception misses service-worker requests, so always corroborate a zero against the server log. D158: `RedisEval` still cannot ship; `mvnw -o dependency:get` confirms `spring-boot-starter-data-redis:4.1.0`, `lettuce-core:7.5.2.RELEASE` and `reactor-core:3.8.6` are all absent, and the online run times out against the mirror, so the "first time the build runs online" trigger has not fired. Corrected a stale claim in both the row and `RedisEval`'s javadoc: `netty:4.2.15.Final` **is** cached and stopped being a blocker; the trigger is now a runnable command instead of a paragraph. Guards green (37 tests, 0 failures) |
| 2026-08-08 | **Encoding guard restored (D126 closed).** Stripped UTF-8 BOMs from 18 committed files via `node e2e/scripts/fix-mojibake.mjs` (BOM-only — 0 content bytes changed); `SourceTreeHygieneTest.noMojibakeOrBom` now green, so the ban on non-UTF-8 source writes is live again. Disproved D126's guess that the BOM broke `listing-freshness.spec.js` — it still fails on a nudge-banner assertion after the strip, so the two standing mock e2e failures are functional drifts, not encoding (re-recorded as D127) |
| 2026-08-02 | Re-sync docs + OpenAPI to the flatmates redesign & mobile-first UI |
| 2026-07-27 | 3-way sync: `platform-architecture.md` (SOT) → OpenAPI → React |
| 2026-07-26 | OpenAPI established as the single source of truth; matured to cover all React needs |
| 2026-07-25 | Platform & solution architecture (MVP pass), ADR-009a KYC, ADR-014 payments, legal/compliance advisory |


### The locality registry the search page uses is not the one the locality page uses

`pages/consumer/Listings.jsx` now reads `services/localityService.js` (server, 155 active rows,
alphabetical, live counts). `pages/consumer/Locality.jsx` — the `/locality/:slug` landing page —
still reads the bundled `data/localities.js` and `data/localityIntel.js` directly, below the seam.
So the two screens can disagree about which areas exist, and only one of them will notice when an
area is retired.

That is not an oversight to fix in passing. `GET /localities/{slug}` returns
`LocalityDetailResponse` with `about`, `connectivity`, `highlights` and `priceTrends`, and psql says
the seeded rows have those columns empty and `demand` NULL for most of the 155. The bundled intel is
hand-written editorial copy that nothing has ever written into the database. Moving the landing page
to the server without first moving the copy would replace a rich page with a blank one — so this is
a content migration and a product decision about who owns that copy, not a seam.

Recorded, not built. `Listings.jsx` was moved because it uses only `slug` and `name`, which the
server has.

### The mock's locality count was already wrong, and the seam now says so out loud

`db.json` localities carry a stored `listings` number that nothing recalculates; the server computes
`listingCount` on read (D7.2). `providers/mock/localityProvider.js` maps one onto the other and its
docblock states that the number it carries has been wrong for three of fifteen rows since before the
migration started. Nothing renders it today, so no screen is affected either way — but a future
consumer reading `listingCount` gets a live number on the server side and a stale one on the mock
side, and that difference is deliberate rather than latent.

### A code-point sort is the wrong oracle for a Postgres `ORDER BY name`

The first draft of `live-localities.spec.js` asserted alphabetical order with `a < b`. It failed on
one row out of 155: "NIBM Road", which a code-point compare puts before "Narhe" (`I` is 0x49, `a` is
0x61) and which Postgres's collation puts between "Narhe" and "Nigdi", because it compares letters
before it compares case. The server was right; the test was wrong. `localeCompare(b, 'en')` is the
correct oracle and is what the spec now uses.

Worth generalising: every future spec that pins a server-side `ORDER BY` on a text column has this
trap, and it only shows up when the data happens to contain an acronym or a mixed-case name. There
are 155 localities and exactly one triggered it.

### The reels feed cannot move to the seam, because the list endpoint has no galleries

`pages/consumer/Reels.jsx:7` still imports `listProperties` from `lib/mockApi.js` while every other
catalogue surface reads `services/propertyService`. That is not an oversight anyone forgot; it was
tried this session and reverted, and the reason is worth writing down before someone tries again.

The page's own header comment says the feed is "the live catalogue, not a curated list" — it was
rewritten away from eight hardcoded entries specifically so a newly posted home could appear. So in
live mode it is currently wrong in a way that looks fine: `/reels` scrolls the browser's bundled
`db.json` while `/listings` next door shows Postgres. Nothing errors. The two surfaces just disagree
about what is for rent in Pune.

**Why the one-line import swap does not work.** `GET /properties` returns `coverImage` and no
`images` array — verified against the running server, the list row carries exactly
`id, slug, title, deal, propertyType, bhk, price, priceUnit, area, areaUnit, furnishing, possession,
locality, localitySlug, city, lat, lng, coverImage, verified, ownerVerified, ownershipVerified,
postedByType, status, dealStatus, boosted, createdAt`. `GET /properties/{id}` does carry `images`
(6 for the first seeded row). `propertyMapper.toViewModel` maps `gallery: p.images ?? []`, so every
list row arrives with an empty gallery, and the page's `MIN_PHOTOS = 3` gate then rejects all of
them. The feed renders empty. It does not throw, and the page's own catch-all falls through to the
empty state, so the failure reads as "no reels today" rather than as a bug.

That omission is almost certainly deliberate on the server's part — a gallery per row on a 100-row
page is a large payload for a list nobody scrolls the photos of.

**The three options, none of which is a cleanup call:**

1. **The list response grows `images`.** Simplest for the client, and it makes every consumer of
   the search endpoint pay for photos that only this one page wants.
2. **A photo count on the list row** (`imageCount`), and reels fetches details only for the rows
   that pass the gate. Cheap on the list, and still 15 detail requests to draw the current feed —
   the per-row-request pattern `societyService`'s docblock exists to avoid, though bounded here.
3. **A dedicated feed endpoint** that returns the already-gated set with galleries. Most work,
   least waste, and it puts the editorial rule (homes only, three photos) on the server where it
   can change without a deploy.

Option 3 is probably right if reels is a surface the business cares about, and option 1 is right if
it is not worth an endpoint. That is a product call about how much reels matters, so it is recorded
rather than taken.

Until then `Reels.jsx` stays on the mock and the disagreement stands. Noted here because "reels
still imports mockApi" looks like a missed line during the P5c sweep, and deleting the mock without
answering this first will empty the page.

**RESOLVED (D1) — option 2 taken, and the page was worse than recorded above.**

Shipped: `PropertySummary` gained `imageCount`, the reels feed filters on it, and detail is fetched
only for the rows that pass. The count is a primitive so it cannot vanish under `NON_NULL`, and it is
computed on read rather than stored — a denormalised count is one write away from disagreeing with
the thing it counts, and it disagrees silently, which is the same argument that produced the trust
counters and the locality `listingCount`.

Two corrections to the write-up above, both worth keeping.

**The disagreement was not "mock feed vs live catalogue".** It was that in live mode the feed was
*empty and always had been*, and could not have been anything else: `MIN_PHOTOS = 3` measured
`gallery.length`, `gallery` comes from `images`, and the card projection has never carried `images`
on any endpoint. Every listing scored zero. There was no version of the seam repoint that would have
worked, which is why it read as an unexplained "it just shows nothing".

**And it did not show the empty state.** `feed` is `null` until the catalogue resolves and `null` is
the loading state, so a feed that resolved to zero rows rendered the spinner — a dead end disguised
as a slow network, which is precisely what that empty state exists to prevent. The `.catch` had
already been hardened for the rejection case; the zero-rows case had not, because nobody expected it.
That is the general shape worth remembering: a guard written for "the request failed" does not cover
"the request succeeded and answered nothing".

Option 3 (a dedicated `/properties/reels` endpoint) was not taken and should not be revisited unless
the feed grows past a few dozen. At today's catalogue the second round is ~16 detail requests fired
in parallel after one list read; a bespoke endpoint would buy a round trip and cost a second
definition of what a reel-eligible listing is — which is exactly the kind of duplicate rule the owner
facet was kept off its own route to avoid. `FEED_MAX = 24` caps the hydration so the shape stays
honest as the catalogue grows; past that the answer is paging the feed, not a new endpoint.

### `/help/faq` and `/support` will disagree once the FAQ seam is finished

**RESOLVED (D2) — `translations` exists on all four content types; `/help/faq` reads the seam.**

V84 adds a `translations jsonb not null default '{}'` column to `faqs`, `announcements`, `banners`
and `cms_services`, shaped language → wire field name → text:

```json
{"mr": {"question": "…", "answer": "…", "category": "…"}}
```

Nested rather than the mock's suffixed fields, and the reasoning is on the migration: suffixed
columns are six new columns on `faqs` alone, eighteen more across the other three, and twelve more
for a third language — and they spread one fact (this row, in Marathi) across three columns nothing
constrains to agree. All four tables in one migration because they are the same kind of object and
answering the question separately for banners later is how a codebase acquires two conventions for
one problem.

Typed `Map<String, Map<String, String>>` on the Java side, not the `Map<String, Object>` the other
four jsonb columns in this codebase use, because this shape is known: two levels, strings at the
leaves. `Object` accepts a nested array and fails at render time; the typed map refuses it at
deserialisation, which is where the bad value actually arrives. Nothing in the codebase mapped a
jsonb column to a typed nested map before this — `List<PriceTrendPoint>` was the closest precedent
and proved the Hibernate/Jackson plumbing needs no extra configuration.

`ContentWrite.translations` replaces the map whole rather than merging it, which is the one place
this field departs from the "null means leave alone" rule the rest of that record follows. Merge
semantics leave no request an editor could send that means "this row is no longer translated into
Marathi", because every key they omit is a key that survives. `null` still means leave it alone;
`{}` is how a language is removed. Both are pinned by `ContentTranslationsTest`.

`HelpFaq.jsx` now reads `services/contentService.listFaqs` and its `LOCALIZED_FIELDS` are the wire
names (`question`, `answer`, `category`), so `/help/faq` and `/support` finally read one source.
`lib/contentLang.js` reads only the nested shape; the mock content provider converts `q_mr` →
`translations.mr.question` on the way out, which is the same call that file already makes about
`q` vs `question` — the seam has one vocabulary and the side with an expiry date adapts.

Three findings recorded while doing it:

1. **The fallback is per field, not per record, and that is load-bearing.** A row can have a
   Marathi question and an English answer; that is the state real editorial work spends most of its
   time in. Falling back wholesale would discard a translation somebody wrote. The seed deliberately
   contains one such row (`f002`) so the live spec can prove it.

2. **The four content tables ship empty in production and that has not changed.** The nine FAQs live
   in `db/seed/R__zz_dev_demo_data.sql`, dev and e2e only, for the reason that file already argues.
   The two Marathi rows are appended there as `UPDATE`s rather than folded into the `INSERT`, because
   the insert is `ON CONFLICT DO NOTHING` — on any database that already has the nine rows, adding a
   column to the `VALUES` list would change nothing at all while appearing to work.

3. **`AdminContent.jsx` still cannot write a translation.** The admin console sits on the mock's
   `mutateDb` rather than on `/admin/content/{type}`, so the server-side write path proved by
   `ContentTranslationsTest` has no UI. That is the same blocker already recorded for that screen,
   not a new one — but it now blocks something a customer can see, which it did not before.

`pages/consumer/help/HelpFaq.jsx:7` still calls `getFaqs` from the mock. `Support.jsx` and the
assistant widget now read `services/contentService`. Same nine questions, two sources.

This one is blocked on a contract question rather than a payload one. `HelpFaq` runs each row
through `localizeRecord(f, ['q', 'a', 'cat'], lang)` — FAQs are admin-editable records, so their
translations live on the record (`q_mr`, `a_mr`, ...) rather than in the locale bundles, for the
reasons `lib/contentLang.js` sets out. `FaqResponse` is `(id, question, answer, category)` and has
no translation fields at all, so repointing the page would silently drop a capability.

It would drop an *unexercised* one — the nine seeded rows carry no `_mr`/`_hi` variants today, so
`localizeRecord` is currently a no-op and the page would look identical. That is precisely what
makes it dangerous to move quietly: the regression would not appear until the first translated FAQ
was written, by which time the cause would be several months upstream.

The decision is whether the FAQ contract grows per-language fields (and if so, whether as suffixed
columns like the mock or as a translations sub-object), which is the same question the banners and
announcements will ask when they move. Worth answering once, for all of admin-editable content,
rather than three times.

### Two different functions are called `createServiceRequest`, and one of them makes tickets

`lib/mockApi.createServiceRequest` (defined in `lib/mockApi/tickets.js:20`) pushes onto `db.tickets`
and returns a `T…` id. `services/serviceRequestService.createServiceRequest` posts
`POST /service-requests` and returns an `SR…` request. Same name, different entities, different
boards. `InteriorRenovation.jsx` and `PropertyValuation.jsx` import both in the same file and can
only tell them apart because one is aliased `createFlowRequest`.

That is worth renaming — `createTicket` is what the mock one does and what the seam already calls
its counterpart — but the rename touches the mock, which is scheduled for deletion in P5c, so it is
recorded rather than done. Anyone reading a call site in the meantime should check the import.

### The Move-in Pack booking is a lead that is lost entirely in live mode

`Services.jsx:213` (`bookPack`) writes a ticket to `localStorage` and nothing else. The ops board
reads `GET /tickets` in live mode, so a customer who books a Move-in Pack raises a request no one
will ever see. It is behind a sign-in gate, so unlike the waitlist below it *could* move today.

The move is `createTicket({ subject: 'Move-in Pack', team: 'packers', body: <the chosen items> })`.
`team` is fine — `tickets_team_check` allows `rental, legal, loans, interior, packers, valuation`.
What does not survive is `value`, the pack total, and that is a documented server decision rather
than a gap: `TicketCreate`'s Javadoc says `service` and `value` are "ops' commercial annotations —
a client that could set its own deal value would be writing the pipeline report." The `tickets`
table *has* `service`, `customer`, `mobile`, `value` and `detail` columns, so the schema was built
for the mock's shape; the create DTO deliberately withholds four of them.

Putting the total into `body` as free text would route around that decision rather than respect it,
so it should not be done quietly. The open question is whether the customer's accepted quote is the
same thing as ops' deal value — it is arguably not, and if it is not, `TicketCreate` may want a
`quotedValue` that ops can override. That is a product call.

Not moved, because the same commit should answer that question rather than drop a number silently.

**RESOLVED (D3) — `quotedValue` exists; the booking is live.**

The open question above was answered as it was framed: the customer's accepted quote is *not* ops'
deal value, so a second column exists rather than a shared one. `V83__tickets_quoted_value.sql` adds
`tickets.quoted_value bigint` with a `>= 0` check; `TicketCreate` accepts it, the entity declares it
`updatable = false` and `TicketUpdate` has no component for it, so a quote is write-once — a quote
that can be revised into agreement with the eventual bill is evidence of nothing.

`bookPack` now calls the real seam when `isHttpDomain('ticket')` and keeps the mock write otherwise,
because `ticketService.js` is live-only by design (its Javadoc explains why: the mock store speaks
three statuses to the server's five). `e2e/tests/consumer/services/live-move-in-pack.spec.js` covers
it; `TicketQuotedValueTest` covers the server.

Three things turned up that are worth writing down.

**`tickets.value` is not paise, and never was.** The entity's Javadoc said "deal value in paise" and
it is the only place in the codebase that made that claim: every other money field is documented
"whole rupees", the contract types money as `int64` rupees, and `OpsQueue` renders this column
straight through `fmtINR`. Nothing converted anywhere. The comment was simply wrong and survived
because the column has never held a value. Corrected on the entity, and `quoted_value` is rupees.

**`tickets.value` has no write path at all.** `TicketCreate` drops it by design, `TicketUpdate`
simply has no such field, and the seed never sets it — so the column V7 declared in 2024 has been
filled by nothing, ever. The Javadoc's talk of it being "ops-owned" is aspirational: ops have no way
to own it. `TicketQuotedValueTest.theQuoteSurvivesUnrelatedWork` was written to assert that a desk
setting `value` leaves the quote alone, and had to be weakened to "working the ticket leaves the
quote alone" because the first half is unreachable. **Not fixed here** — giving ops a way to record
a deal value is a decision about what the pipeline report is for, not a side effect of adding a
quote, and it wants its own answer about whether the board or the deals screen owns that number.

**The pack's prices are still read from browser storage.** `useMovePackConfig` calls `rawDb()`
directly, so `settings.movePack` — the prices and the coming-soon switch — does not come from
`GET /admin/settings` even when the `settings` domain is live. The *write* is now real; the *read*
is not. Moving it is not a one-liner: the consumer page would be reading an admin-only endpoint
(`/admin/settings` is `hasRole('ADMIN')` on both verbs, deliberately, because the document holds the
fee table and the permission map), so the pack config needs either a public projection of those keys
or a place in `GET /flags`. That is a contract addition and is recorded rather than taken.

### The Move-in Pack waitlist cannot move at all: it is deliberately anonymous

`Services.jsx:225` (`submitNotify`) carries the comment "No forced sign-up — we only need a valid
mobile to follow up," and it means it: the mobile comes from the form, not the session, and
`user?.name` is optional-chained because there may be no user. `POST /tickets` takes a
`@CurrentUser` principal and attributes the ticket to it.

So there are only bad mappings. Sending it authenticated 401s the anonymous visitor this form
exists for. Sending it as the signed-in user, when there is one, attributes a stranger's lead to
whoever last used the browser and drops the mobile that was the entire point of collecting it.

This needs an anonymous lead-capture route — a public `POST /leads`, or `POST /tickets` accepting a
`contactMobile` when unauthenticated with its own rate limit, since an unauthenticated write to an
ops queue is a spam surface and would need one. Both are product and security decisions.

**RESOLVED (D4) — `POST /service-waitlist` is a real public endpoint; the lead lands on the packers desk.**

The analysis above is right that there are only bad mappings *through `POST /tickets`* — but it
stopped one step short. The choice was never between the two bad mappings; it was between adding a
third route and leaving the lead in browser storage. A public route was the answer, and the reason
this had felt unaffordable was a wrong premise: the write-up assumed an anonymous write would need
a rate limiter built from scratch. The platform already has three, and two of them were already
pointed at exactly this problem.

`POST /service-waitlist` takes `{ service, name?, mobile }`. Everything the board acts on — team,
subject, priority, status — is derived server-side from the service slug by `ServiceWaitlists`, a
closed set. That is the whole security posture: a caller who could name the team could put a lead on
legal or loans, which is not a lead, it is a way to page whoever is on duty. The only
attacker-controlled string that reaches a human is a 120-character name.

Three controls stand in for the missing session, and none of them is sufficient alone:

- `WriteRateLimitFilter` caps writes per IP. Weakest here — a mobile network puts thousands of real
  people behind one address.
- `BotDefenceFilter` now lists this path in `CHALLENGED` alongside the other two anonymous writes.
  It is the control that costs an attacker something, and it is off on every developer machine and
  in the whole test suite, which is precisely why it cannot be the only one.
- `TicketService.joinWaitlist` caps signups per **mobile** per hour against the table, under
  `RateLimitLock.Limit.SERVICE_WAITLIST` (namespace 4, a new enum value). This is the one that
  survives the other two being unconfigured, and the only one keyed on the thing the platform cares
  about: the number ops will ring.

Three decisions in it worth naming:

1. **A ticket, not a `service_waitlist` table.** The tidier shape is a table beside `city_waitlist`,
   and it was wrong: nothing would read it. `CityWaitlistRepository` is honest that the admin surface
   which would consume it does not exist — acceptable for a signal somebody looks at once a quarter,
   not for a person waiting for a phone call. A row no screen shows is the same outcome as the bug
   this replaces.
2. **201 whether or not a row was written.** A repeat is not a conflict: the caller's intent is
   "make sure you have me", and after either outcome the desk does. A 409 would also turn a public
   form into an oracle for whether a given number is already listed. The duplicate check is scoped to
   the three unresolved statuses (`TicketStatuses.UNRESOLVED`), so a signup the desk has already
   closed does not silence the next one months later — that would be the original bug wearing a hat.
3. **`requesterId` stays null.** Nothing proves the number belongs to whoever typed it, so the row
   must not claim otherwise. Matching it to an existing account by number would attach a stranger's
   request to a real person's profile. `Ticket`'s Javadoc claimed "a ticket raised through the API
   always has a requester"; that claim is now false and has been corrected in place.

`V85` adds `idx_tickets_mobile_created`. Without it the budget count is a sequential scan on an
unauthenticated path, once per request — the rate limiter would be the cheapest denial of service on
the platform, and it would get slower the more successfully it was attacked.

Two things this deliberately did **not** fix:

1. **The Move-in Pack's prices and its live/coming-soon switch are still read from browser storage.**
   `useMovePackConfig` calls `rawDb()` directly, so the `settings` domain being live changes nothing
   on this page. Both this spec and `live-move-in-pack.spec.js` set the flag through localStorage.
   That is a read gap, already recorded, and untouched here.
2. **The demand-gap signal still has no server home.** `NotifyMeCard.jsx:50` calls
   `addDemandAlert`, which is a *different* feature from this one — "no results for this search,
   tell me when something matches" rather than "tell me when this service launches". There is no
   `demand_alerts` table, entity, repository, controller or route anywhere in the backend, and a
   sweep confirmed it. Unlike the waitlist, there is no existing queue it obviously belongs on: a
   search-alert is a standing subscription that has to be re-evaluated when listings change, not a
   lead somebody rings back once. Inventing the table and the matcher is a product decision.
   Recorded, not built.

### The ticket board and the service-request queue are two boards with no link, in live mode

`InteriorRenovation.jsx:94-95` and `PropertyValuation.jsx:107-108` create *both*: a mock ticket and
a seam service request, tied together by a `ref` the mock's `syncServiceTicket` uses to mirror
workflow status onto the board so nothing shows "new" after it has moved on.

In live mode the service request half already reaches Postgres and the ticket half does not, so
these leads are not lost — they land on the ops service queue and not on the board. Adding
`createTicket` here would put them on both, unlinked: `TicketCreate` has no field for a service
request, and `ServiceRequestCreate` (as the seam sends it) has no `ticketId`, although
`ServiceRequest.ticketId` exists and `GET /service-requests?ticketId=` is documented as answering
"which request came off this board item" (D45).

So the link exists in one direction on the server and neither call site can set it. Until it can,
creating both from the client produces two rows that look duplicated to whoever is on shift. The
question is whether these forms should raise a board ticket at all now that the ops queue is real,
which is a workflow decision about what the board is *for*.

Recorded. Nothing moved here.

**RESOLVED (D5) — the mock half is gone; the ops service queue is the system of record.**

Both call sites now file one service request and nothing else. The board was the wrong system to
reach for: it produced two rows out of one lead with no link between them, and against Postgres the
board half was not even a row — it was a localStorage write that no operator can read. A lead that
looks filed and reaches nobody is worse than one that is visibly not filed.

The part that took the thinking was what the ticket carried that the request did not: `customer`
and `mobile`. Those are not derivable from the account. The interior and valuation forms ask who to
call about *this job*, and in practice that is often a spouse, a tenant in the flat, or the site
contractor — the ticket was the only thing carrying them, and deleting it silently would have
turned an actionable lead into one somebody has to guess at. They now ride in `details` as
`contactName` / `contactMobile`, which `toCreate` passes through untouched (D119), so no contract
change was needed for a change that could easily have looked like it needed one.

Worth naming why this survived a seam sweep: `consumer/services/interior.spec.js` and
`valuation.spec.js` both stop at the signed-out sign-in gate and never submit. The pages' happy
paths had no test at all, so the double write was invisible to the suite even while the suite was
green. `consumer/services/live-interior-lead.spec.js` now submits, and its fourth test waits on the
POST armed before the click — the assertion the old code path would have failed while satisfying
every visible one.

The `ticketId` link (D45) is still one-directional and still unsettable from a client. That no
longer matters here, because nothing on these pages creates a ticket to link.

### The homepage trust counters have no server to read, and cannot be derived from the list

`pages/consumer/home/Featured.jsx:11` calls `verifiedStats(localitySlug)`, which reduces the mock
catalogue into `{ verifiedListings, totalListings, verifiedOwners }`. There is no server endpoint
for it — nothing in the backend answers anything resembling `verifiedStats` — so this is a new
route, not a repoint.

Two of the three numbers *could* be computed client-side from `listProperties`, since the list row
carries `verified`, `ownerVerified` and `ownershipVerified`. The third cannot: `verifiedOwners` is
a **distinct count of owners**, and `GET /properties` does not send `ownerId`. Counting distinct
owners on the client would also mean counting them only among the rows that happened to be on the
page, which is a wrong number that looks right.

These are trust counters on the front page. A wrong one is worse than an absent one, so this wants
a small server endpoint that counts in one query — the same shape as the locality `listingCount`
decision (D7.2), and for the same reason. Recorded, not built.

### The public owner profile has no route at all

`pages/consumer/Owner.jsx:7` calls `getOwner(id)`, which returns the user record **spread whole**
plus their listings. There is no public owner endpoint on the server, and the shape the mock
returns is the reason there should not be one built casually: `{ ...owner }` includes every column
the mock stores, and the standing ruling (D5/Q2) is that an owner's raw mobile is never revealed to
a buyer before a deal, on any surface.

So this needs a deliberately-shaped public projection — display name, badges, listing count, the
listings themselves — and an explicit decision about what a stranger may learn about an owner from
a URL they can guess. That is a privacy decision, not a mapping.

Recorded. It is the last consumer page still reading the mock for its main content, so it will be
the last thing standing before P5c.

### DONE (D6b) — the public owner profile now has a route

Shipped as `GET /owners/{id}` plus an `?owner=` facet on the public search. What the ruling above
asked for was a deliberately-shaped projection and an explicit decision about what a stranger may
learn from a guessable URL; both are now written down in `OwnerProfileResponse`'s Javadoc and
enforced by `OwnerProfileTest` and `live-owner-profile.spec.js`.

The ceiling is seven fields: id, name, **masked** mobile, verified, city, member-since **year**,
live listing count. The mobile is masked unconditionally — the old page revealed it to a viewer
holding an approved contact request against *any one* of the owner's listings, which turned a
per-listing grant into a per-person one without anyone deciding it should. The profile has no
listing in context, so there is no gate to apply and nothing to apply it to. Member-since is a year
rather than a timestamp: the page rendered four characters anyway, and a signup minute on a public
page is a correlation handle the reader gains nothing from.

Three things it deliberately does not do:

- **No `GET /owners`.** A public collection read would be a downloadable list of the platform's
  landlords, worth far more to a scraper than to any visitor.
- **No `/owners/{id}/listings`.** The listings are a facet on the ordinary catalogue search, so they
  inherit the same approved-and-unarchived floor, paging and card shape as every other surface. A
  bespoke route would be a second way to read listings and a second place to forget that
  non-approved and archived rows are not public — which is exactly what the mock did: it filtered on
  `ownerId` and nothing else, so an owner's public page showed strangers their rejected stock.
- **No 400 for a malformed id.** Unknown, malformed and archived all answer 404, because a 400 tells
  an enumerator their guess was badly formatted rather than wrong. The same value in the facet is an
  empty page rather than an error, for the same reason — a stale or hand-edited URL is a request for
  somebody who does not exist, and "nothing listed" is the honest answer to it.

The listing count is counted, not read from `users.listings_count`. That column counts every row a
person has ever posted including the rejected and the archived, while every surface showing the
number means the ones a visitor can open. The two must disagree the moment a listing comes down, and
the stored one disagrees silently.

**One follow-up left, now unblocked.** `Owner.jsx` still renders its review *cards* from the local
store. The blocker was that mock user ids were not server UUIDs; the profile is now on real UUIDs,
so the mismatch has moved to the review store's side, which is a smaller and different job — the
review read needs its own `entityType=owner` seam, keyed on the same UUID. Until then `SEED_REVIEWS`
render as cards but do not feed the average (the summary already comes from
`getEntityReviewSummary`), so a new owner shows an em-dash above three demo reviews. That is the
demo data being visible for what it is, not a regression.

### Wave 4c is mostly already done — the plan item was stale

Surveyed the three files the plan listed for retirement or absorption. Two of them are finished and
only the third is real work:

- **`admin/flatmates.spec.js` (3 tests) — already retired.** The file is no longer a desk suite; it
  is three tests that the redirect to `/ops/flatmate-review` keeps its guards, with a docblock
  explaining that the retired route stays as a redirect because operators have it bookmarked. That
  is the correct end state and it should not be touched again.
- **`admin/flatmate-moderation-reach.spec.js` (3 tests) — already truncated correctly.** The admin
  half died with `/admin/flatmates`; what remains is the consumer half, proving the mock board
  honours `MOD_HIDDEN`. Its own docblock says it "dies with the mock at P5c", which is right — it
  exists to keep mock mode an honest rehearsal of D72 for as long as mock mode exists. Leave it.
- **`admin/consolidation.spec.js` (18 tests) — the only outstanding one**, and it is a style
  problem rather than a provider problem. It imports `@playwright/test` directly instead of
  `fixtures/base.js`, hardcodes `BASE = 'http://localhost:5173'`, rolls its own `loginAsAdmin`, and
  uses `waitForTimeout(500)`. Its assertions are almost all provider-agnostic — routes redirect,
  nav items absent, tabs absent — so it would very likely pass unchanged against the live API.

  That makes it a good candidate to convert to the `login` fixture and promote to a live spec, but
  the assertions are the negative kind (`toHaveCount(0)`), and a negative assertion passes for free
  if the page fails to load at all. So the conversion needs a positive anchor per test — assert the
  destination heading, not just the URL — or it will pass while proving nothing.

Not started, because the live suite was running and two Playwright suites must not run at once.

### `admin/consolidation.spec.js` converted, and the reason it cannot be promoted to live yet

Eighteen tests became fourteen. The conversion was the routine part — the shared `login` fixture in
place of a private `loginAsAdmin`, relative paths in place of a hardcoded `http://localhost:5173`
(which ignored `BASE_URL`, so this file silently tested the wrong server whenever the port moved),
and anchor assertions in place of four `waitForTimeout(500)` sleeps.

The part worth recording is what the anchors found. Every assertion in the file was
`toHaveCount(0)` or `toBeHidden()`, because the file's job was to keep a round of removals removed.
That is the weakest shape a test can have: a page that fails to load, a route that 404s, a login
that silently did not happen and a typo'd selector all produce zero matches, and all of them pass.

And one of them *was* vacuous. `expect(page.getByRole('button', { name: 'Conversion' }))
.toHaveCount(0)` had been passing since it was written, but `Tabs` renders `role="tab"`, not plain
buttons — so that assertion would have gone on passing with the Conversion tab sitting in plain
sight. It is now asserted by role `tab`, and anchored on `Traffic` being visible first.

**Not promoted to live, deliberately.** `AdminAnalytics`, `AdminContent`, `AdminFinance`,
`AdminEnquiries` and `AdminServices` all still import from `lib/mockApi.js` and read nothing from
the API. Running these under `playwright.live.config.js` would execute exactly the same
localStorage-backed pages under a name claiming otherwise, which is worse than leaving them
honestly labelled. The two surfaces this file touches that *are* live-backed —
`/admin/staff-activity` and the audit log it cross-links — already have `admin/live-staff-activity.spec.js`.
The blocker is the pages, not the spec.

### Survey: the last consumer `lib/mockApi` call sites

Read-only survey done while the live suite was running. Eight sites remain, not six — the earlier
count missed `useDashboardData.js` and `list-property/submit.js`. Each is classified by whether a
server path exists today, because that is the only thing that decides whether it is work or a note.

| Site | Call | Server path? |
|---|---|---|
| `Contact.jsx:38` | `rawDb().listings.find(p => p.id === ref)` | **Yes — repointable** |
| `StaffLogin.jsx:149,164` | `getTeamMemberByMobile(mobile)` | Probably (`/auth/staff-login`, `/auth/me`) — needs a shape check |
| `dashboard/MyListingsPanel.jsx:244,251` | `confirmListingFresh(id)` | **No** |
| `dashboard/MyListingsPanel.jsx:258` | `sendWhatsappTemplate(id, 'wa-dormant')` | **No** (already recorded) |
| `listings/NotifyMeCard.jsx:50` | `addDemandAlert({...})` | **No** (already recorded) |
| `Listings.jsx:6` | `logSearchIntent` | **No** |
| `dashboard/useDashboardData.js:4` | `listEnquiries` | Needs a survey |
| `list-property/submit.js:19` | `requestRecheckFields`, `clearedRecheckFields` | Needs a survey |

**`Contact.jsx` is a clean repoint and should be done first.** `propertyService.getProperty(id)` is
already wired to an http provider, and `providers/http/propertyMapper.js` L101-L149 already renames
the server shape into exactly the fields this page reads — `type` from `propertyType` (L101),
`bhkNum` from `bhk` (L117), and the flat `owner` / `ownerId` / `ownerMobile` trio from the nested
`owner` object (L147-149). The mobile arrives already masked (`PropertyResponse` trust rule,
ADR-019), which is what the page renders anyway via `maskPhone`. The only real change is that the
lookup becomes asynchronous: today it is a `useMemo` over a synchronous `rawDb()`, and it has to
become `useState` + `useEffect` with a null first render. Everything downstream of `refListing`
already handles `null`, because the page has always had to render without a `?ref=`.

**`confirmListingFresh` is confirmed blocked, not merely unsurveyed.** A search across
`backend/src/main/java/com/punenest/api/**` for `fresh|Fresh|confirm-fresh|lastConfirmed` returns
only unrelated matches — webhook replay windows, refresh tokens, and prose. There is no freshness
endpoint, no route constant, and no column being written. This closes out FINDING 7: the "still
available?" confirmation an owner gives is a browser-local fact, and the staleness badge computed
from it is too.

### Wave 5 planning fact: most consumer specs cannot be mechanically moved onto the `login` fixture

Eighty-one spec files opened with a hardcoded `const BASE = 'http://localhost:5173'`. That one line
is now fixed everywhere (commit `b33b144`) — it was the part that mattered, because it meant those
files tested whatever was listening on 5173 rather than the server the run was pointed at.

What is *not* mechanical is the rest of the conversion, and it is worth writing down before someone
plans wave 5 as a find-and-replace.

The admin specs authenticate: they drive `/staff-login`, click **Admin**, and wait for `**/admin`.
Those are a clean swap to `login.asAdmin()`, and nine of them are converted.

The consumer specs mostly **do not authenticate at all**. They write `puneNestUser` /
`puneNestUsers` into `localStorage` in an `addInitScript` and let the app boot as though a session
already existed. A survey of `tests/consumer/property/` (18 files) found zero `mockApi` imports and
zero real logins — every one that needs a signed-in viewer fabricates one. The same pattern runs
through `consumer/account/`, `consumer/flatmates/` and `consumer/list-property/`.

That means swapping them to `login.asBuyer()` / `asOwner()` is a **behaviour change, not a
refactor**: it replaces a fabricated identity with a real authenticated one, which is the right
end state but which will surface every place the page depended on a field the fabricated user had
and the real one does not. Each file needs to be run and read, not batch-edited.

The practical consequence for sequencing: **the consumer spec conversion is gated on the consumer
pages being repointed, not the other way round.** A spec that fabricates a localStorage user is
testing a page that reads localStorage. Convert the page first, then the spec that guards it.

### Live-suite triage: two failures, two entirely different causes

The full live run stopped at 225/826 with two red tests. Both were re-run in isolation before any
conclusion was drawn, which is the only reason the second one did not get "fixed".

#### 1. `live-kyc-growth-levers.spec.js:31` — not a defect, and not sleep either

"an unverified user sees the opt-in badge CTA on the dashboard", failed after **12.8 minutes** in a
file where nothing else takes more than 13 seconds. Re-run in isolation: **passed in 8.3s**, with the
other three tests in the file green.

The first hypothesis was machine sleep. That was checked rather than assumed, and it was **wrong**:
`powercfg /q SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` reported the AC standby index already at
`0x00000000` (never), and `Win32_Battery.BatteryStatus = 2` says the machine was on AC the whole
time. So sleep was already disabled and cannot explain a 12.8-minute test.

What is left is a stall inside the run itself. Recorded rather than chased: it does not reproduce,
and a test that passes in 8s in isolation is not evidence of a product bug. Battery-mode standby
*was* set to 3 minutes and has been zeroed as a precaution; if this recurs on AC, the next step is
`--trace on` for that one file rather than another full run.

#### 2. `live-property-integration.spec.js:271` — two stacked races in the spec, both now fixed

"the owner wizard creates the listing through POST /me/listings (D219)" failed in the full run and
again in isolation, so this one was genuine. It reported:

    expect(locator).toBeAttached() failed
    Locator: locator('input[type="file"][accept*="image"]').first()

which reads as "step 3 never rendered" and says nothing about why. The wizard was in fact still on
step 2. It took two passes to find both reasons, and the first pass is worth recording because the
fix was right and the diagnosis was still incomplete.

**Race 1 — the locality fills asynchronously.** The failure screenshot showed the Locality control
displaying `Baner` **and** carrying a red border and *"Select the locality."* — a field that looks
filled and is being rejected. `validation.js:48` (`if (!form.locality) err.locality = true;`) is the
only thing that raises it, so `form.locality` was genuinely `''` when Next was clicked;
`useListingLocation.js`'s `applyAddressFill` writes it off the reverse-geocode, well after the map
search returns. The spec had been winning that race by accident. Fixed by waiting for
`[data-err="locality"] .pn-dropdown__value` to lose `is-placeholder` (`Select.jsx:271-274` puts that
class on an unset value) — the assertion the test was silently depending on.

**Race 2 — the cookie banner eats the click.** That fix cleared the locality error and the test still
failed at the same line, which is the useful part: a screenshot only shows what rendered, not what
was clicked. The Playwright *call log* in `error-context.md` named it outright —

    locator.click: Timeout 15000ms exceeded.
    - <div class="...fixed inset-x-0 bottom-... z-[1400]..."> subtree intercepts pointer events

`CookieConsent.jsx` is fixed to the bottom of the viewport at z-1400 and mounts a moment after the
page. Step 2 is long enough that "Next Step" sits at the bottom of the scroll — exactly underneath
it — and Playwright will not click through an intercepting element. So the banner silently decided
whether this test passed, purely on whether it mounted before or after the click landed. Fixed by
seeding `pn_cookie_consent_v1` in the existing `addInitScript`, the same pattern `doc-info.spec.js`
and `deals-offers.spec.js` already use. Green in 14.8s, down from a 26s failure.

**Lesson worth keeping:** when a click "does nothing", read the call log rather than the screenshot.
The screenshot shows the state; the call log names the element that intercepted the pointer. The
first fix here was correct and insufficient, and only the call log distinguished the two.

**Product observation, recorded and deliberately not fixed:** a user who clicks Next while the
geocode is in flight sees *"Select the locality."* under a box that then fills in with a locality.
The error is computed on submit and never recomputed when the async fill lands, so it lingers under a
field that is now valid. Harmless — clicking Next again succeeds — but it is real, confusing UI, and
it is a product change rather than a test change, so it is written down here rather than made
unilaterally.

**Second observation, same status:** the consent banner overlapping the wizard's primary action at
the bottom of a long step is not only a test problem. A real user on a short viewport who has not yet
dismissed the banner has "Next Step" covered by it. Worth a look at the wizard's bottom padding.

---

## Survey: the last three consumer `mockApi` call sites (D223)

The three remaining consumer-side imports of `lib/mockApi` outside the pages already
converted. Surveyed to decide, for each, whether it is repointable, blocked, or already
dead when the live provider is active. Verdicts differ, and only one is actually work.

### Site A -- `useDashboardData.js` -> `listEnquiries` -- BLOCKED, no endpoint

The mock's `collGetter('enquiries')` (`lib/mockApi/collections.js:5-9`) returns the raw
localStorage array, unfiltered by user. Consumed at `useDashboardData.js:287`,
`EnquiriesPanel.jsx:183-187,213` and `dashboardData.js:130`.

There is no consumer-facing route to repoint to. The only enquiries route is
`Routes.Moderation.ADMIN_ENQUIRIES = "/admin/enquiries"` (`Routes.java:1447`), guarded
`hasAnyRole('STAFF','ADMIN')` plus `REQUIRE_ENQUIRIES_READ` -- a buyer's dashboard cannot
call it, and should not be able to.

`Routes.java:1437` states the deeper reason outright: "There is no `enquiries` table; the
console's Enquiries page was a mock-side union of contact requests, chat threads, visits
and deals." So the consumer panel is not reading a table that exists behind a wrong
route; it is reading a view that was never modelled server-side at all.

Two further obstacles, recorded so the next attempt does not rediscover them:

- `AdminEnquiryDto.requesterMobile` is always masked, with no unmask parameter. The
  consumer panel's `tenDigits` check (`EnquiriesPanel.jsx:19-22`) discards masked numbers,
  so wiring the admin route in would make the verified badge silently vanish rather than
  fail loudly.
- Building the union client-side would need four reads per dashboard load and would
  reimplement, in the browser, a join the server has deliberately not committed to.

Seven directory sweeps confirmed the negative: `controller/`, `web/`, `api/`, and the
`leads`, `engagement`, `deals` and `moderation` modules. No consumer enquiries route
exists.

**Next step is a product decision, not a migration task:** either model an enquiries
projection server-side, or accept that the consumer dashboard's Enquiries panel retires
with the mock provider. Not actionable in this window.

### Site B -- `submit.js` -> `requestRecheckFields` / `clearedRecheckFields` -- REPOINTABLE

Both are pure functions (`lib/mockApi/properties.js:135-152`) returning
`{recheckPending, recheckReason, recheckRequestedAt}`. Consumed at `submit.js:390-405`.

This is not a server call site at all. The server write already happens earlier, at
`submit.js:291-294`; these two functions only compute the three fields the client then
holds locally. `grep 'recheck'` over `Routes.java` returns 0 matches, but
`PropertyResponse.java:143-159` carries all three fields and `propertyMapper.js:140-142`
maps them.

**So the repoint is: read the three fields off the `saved` response already in hand,
rather than recomputing them.** No field is lost, no new route is needed, and the
client stops holding an opinion about a value the server has already decided. Small and
well understood; the only care needed is that the local copy and the response cannot
disagree afterwards.

### Site C -- `StaffLogin.jsx` -> `getTeamMemberByMobile` -- ALREADY DEAD WHEN LIVE

Both call sites (L149, L164) sit below `if (authIsLive) { ... return; }` at
`StaffLogin.jsx:116-146`. Live staff sign-in goes through `POST /auth/login`
(`Routes.java:40`) and never reaches them. `docs/migration/04-modules.md:39` already
records this as done (2026-08-13).

The import survives only to keep the mock path working, and retires with it. **No work.**

### Summary

| Site | Verdict | Work |
|---|---|---|
| `useDashboardData` -> `listEnquiries` | Blocked: no consumer endpoint, and no `enquiries` table to build one on | Product decision |
| `submit.js` -> recheck fields | Repointable: read the fields off the response already returned | Small |
| `StaffLogin` -> `getTeamMemberByMobile` | Already dead code under the live provider | None |

The pattern worth carrying forward: "still imports mockApi" and "still depends on the
mock" are different questions. One of these three is real work, one is a decision nobody
has made yet, and one has been finished for months.

---

## D223 — suite-wide anti-pattern audit

After rewriting `admin/properties.spec.js` we swept all **242** spec files under `e2e/tests/`
for the three patterns that file was full of, to find out how much of the rest of the suite
shares them. Counts below are verified by reading each candidate in context, not by regex —
a naive regex pass reported 40 guarded assertions and 86 affected files, and almost all of
that was the rewritten specs' own docblocks *describing* the patterns they removed.

### Totals

| metric | count |
|---|---:|
| spec files swept | 242 |
| files with at least one occurrence | 55 |
| guarded assertions (pattern 1) | 10 |
| assertions that cannot fail (pattern 2) | 13 |
| `waitForTimeout` (non-`live-` files) | 107 |
| `waitForTimeout` including `live-` files | 133 |

**The headline: patterns 1 and 2 are nearly eradicated; sleeps are the remaining debt.**
107 of the 130 findings are `waitForTimeout`, concentrated in `consumer/list-property/`
(~40 across 12 files), `consumer/flatmates/` and `consumer/services/`.
`admin/properties.spec.js` itself now scores 0/0/0 — the rewrite held.

### Fixed immediately (this commit)

The four sharpest cases, all vacuous truth or a guard around the point of the test:

- `consumer/flatmates/owner-split.spec.js` — four `rooms.every(...)` assertions with no length
  floor. `[].every(...)` is `true`, so a split producing zero rooms passed tests named
  "grants the owner badge" and "promotes the rooms once the flat is approved later". The
  sibling test twenty lines up does it correctly (`toHaveLength(3)` before its `.every()`
  calls), so this was inconsistency rather than house style.
- `live-property-integration.spec.js:1510` — the save/shortlist write was wrapped in
  `if (await heart.count())`. The stated purpose is "the write is the only proof it reached
  the server"; the control disappearing is exactly the regression that breaks saving, and the
  guard reported success in precisely that case.
- `live-property-integration.spec.js:672` — `expect(detailBody.messages.every((m) => typeof
  m.authorId === 'string')).toBe(true)` with no length floor. A thread detail returning
  `messages: []` satisfied the assertion the `authorId` contract addition exists for. Sharpest
  find in the suite: the *same test*, thirty lines earlier, carries the comment "Asserted before
  the negative checks below, because a signed-out page would satisfy every 'X is absent'
  assertion trivially" — the author named this failure mode and then walked into it.

### Backlog, ranked

**P1 — six guarded assertions that disable the test they guard.** Each needs the same
treatment as the heart: assert the element present, because its absence is the failure.
- `platform/live-i18n.spec.js:164` — the *entire* body of "the date picker shows month names in
  the active language" sits inside `if (await field.count())`. A missing date picker leaves the
  test asserting only that an `h1` exists.
- `platform/live-desktop-noleak-guardrails.spec.js:321` — `if (r.pillH) expect(r.pillH).not.toBe('40px')`.
  `pillH` is `null` exactly when the element is absent, so a top bar that renders no pill and no
  icon box satisfies both guards. The only place in the suite where the guard variable's falsy
  value *is* the failure condition.
- `consumer/home/entity-search.spec.js` (2), `consumer/property/infotips.spec.js:—`,
  `platform/live-route-redirects-404.spec.js`, `mobile/live-sheets-and-actions.spec.js`,
  `mobile/live-touch-targets-p3.spec.js`.

**P2 — twelve conditional `test.skip` calls used as an environment shrug.** A skipped test
reports as skipped, so a regression that removes the element turns the run green rather than
red, and a summary read at a glance shows no failures. "no listings rendered" and "no filter
panel in this build" describe a broken application, not an unsupported environment. In
`mobile/live-sheets-and-actions.spec.js:136,154`,
`platform/live-desktop-noleak-guardrails.spec.js:139,254`, `mobile/live-topbar-scroll.spec.js:80`,
`live-property-integration.spec.js:558,582`, `consumer/search/qa-location-search.spec.js:193,224`,
`consumer/home/entity-search.spec.js:121`, `mobile/live-phase3.spec.js:67`,
`platform/help/live-article-feedback.spec.js:86`.
(The two in `live-property-integration.spec.js` are conditional on an empty inbox, not
unconditional — worth keeping, but the condition should seed rather than skip.)

**P3 — seven scan-and-assert-empty sweeps with no "the scan found anything" floor.** These
collect violations across a page and assert `toEqual([])`, which passes cleanly on a blank,
crashed or 404 page. In `mobile/live-text-legibility.spec.js:135,151,161`,
`mobile/live-content-budget.spec.js:173,204`, `mobile/live-touch-targets-p3.spec.js:135`,
`mobile/live-auth-keyboard.spec.js:82`.
The idiom is already applied correctly elsewhere — `mobile/live-tap-targets.spec.js:163` polls
`toBeGreaterThanOrEqual(MIN_CANDIDATES)` first, `mobile/live-safe-area.spec.js:136` and
`mobile/live-ops-field.spec.js:136` both assert a non-zero candidate count with a message saying
why — so this is uneven application, not an unknown technique. `live-text-legibility.spec.js` is
the pointed case: its own comment at lines 111-115 explains that a 404 page has no band to
measure and the sweep would pass by finding nothing, and then does not guard against it.

**P4 — 107 sleeps.** Lowest value per edit but the largest number, and each one is both slower
and weaker than the assertion it replaced. Worst files: `consumer/services/emi-calculator.spec.js`
(8), `consumer/list-property/types.spec.js` (8), `consumer/list-property/p3.spec.js` (7),
`consumer/services/refer.spec.js` (6), `consumer/list-property/progress.spec.js` (6).

### Not counted, deliberately

`expect(consoleErrors).toEqual([])` — ~200 occurrences. That is the house convention paired with
the `trackErrors` helper and the `consoleErrors` fixture, not an anti-pattern.

### Corrections to the sweep, found by spot-checking

Three of the reported findings did not survive reading the code, which is the reason
every claim in a delegated survey has to be checked before it is acted on:

- **`live-property-integration.spec.js:558,582` are not unconditional skips.** They are
  `if (!(await markAll.count())) test.skip(...)` and `if (!before) test.skip(...)`, both
  guarding on an empty notification inbox with a comment explaining that only flatmate
  flows write server notifications. Still worth converting -- the right answer is to seed
  a notification rather than to skip -- but they do run.
- **`live-property-integration.spec.js:236` is not a guarded assertion.** It is documented
  idempotency cleanup ("this test writes to a real database, and a failure between upload
  and delete must not make every later run fail on a full slot"). Correct as written.
- **`live-content-budget.spec.js:173,204` already have floors.** The first returns
  `['toolbar not found']` from inside the page evaluate, which fails loudly; the second is
  preceded by `await expect(badge).toBeVisible()`. Neither is unfloored.

Conversely one finding was **understated**. `live-sheets-and-actions.spec.js:137` skipped
with the message "wizard gated (auth/paywall) in this environment" -- but `/list-property`
is wrapped in `ProtectedRoute` (App.jsx:253) and the test never signed in, so it was not
gated *in this environment*, it was gated in every environment. That assertion had never
executed. The skip message was describing the test's own omission back to us, which is the
most expensive kind of comment: one that sounds like a diagnosis.

### Fixed in this pass

`owner-split.spec.js` (4 vacuous `.every()`), `live-property-integration.spec.js` (guarded
save-write, unfloored `authorId`), `live-i18n.spec.js` (whole date-picker test guarded),
`live-desktop-noleak-guardrails.spec.js` (null-means-absent guards),
`live-text-legibility.spec.js` (three unfloored sweeps; the helper now returns `measured`),
`live-auth-keyboard.spec.js` (unfloored field sweep),
`live-touch-targets-p3.spec.js` (unfloored card sweep, and its sleep replaced by the
assertion it was standing in for), `entity-search.spec.js` (skip -> assertion),
`live-sheets-and-actions.spec.js` (four: two guards, one loop-`continue`, one permanent skip),
`live-fees-and-photos.spec.js` (the draft-restore race that made the run's second failure).

Remaining from the backlog: the `/dashboard` and `/messages` legibility floors are covered by
the same helper change; the two notification skips want a seeded notification; the 107 sleeps
are untouched.

### D225 — the P4 sleep backlog, cleared

The ten worst offenders from the D223 sweep are done: **53 `waitForTimeout` calls removed, zero left in
any of them.** No file gained a sleep, and no assertion was weakened to make one go away.

| File | Sleeps | Now |
|---|---:|---:|
| `consumer/services/emi-calculator.spec.js` | 8 | 0 |
| `consumer/list-property/types.spec.js` | 8 | 0 |
| `consumer/list-property/p3.spec.js` | 7 | 0 |
| `consumer/services/refer.spec.js` | 6 | 0 |
| `consumer/list-property/progress.spec.js` | 6 | 0 |
| `consumer/flatmates/filters.spec.js` | 5 | 0 |
| `consumer/list-property/pricing-rera.spec.js` | 4 | 0 |
| `consumer/list-property/layout.spec.js` | 3 | 0 |
| `consumer/list-property/validation.spec.js` | 3 | 0 |
| `consumer/list-property/custom-features.spec.js` | 3 | 0 |

**Roughly forty of the fifty-three were one bug wearing forty hats.** `Select.jsx` portals its menu and
only sets `portalOpen` one `requestAnimationFrame` after the open (`Select.jsx:178`); until that flips,
the menu carries `opacity: 0; pointer-events: none` (`dropdown.css:198`) and gains `.is-portal-open`
afterwards. Every `waitForTimeout(200)` sitting between a dropdown trigger click and an option click was
waiting out that single frame. They are now a `menuOpen()` helper asserting `.is-portal-open`, defined
locally in each of the six files that needed it. `MultiSelect.jsx:308` uses the identical mechanism, so
the same helper covers it.

**Two of them were hiding a defect, not a delay.** `p3.spec.js:19` and `layout.spec.js:49` both read

```js
const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
if (await opt.count()) await opt.first().click();
```

`count()` does not retry. Whenever the sleep was a little short, the count came back 0, the click was
skipped in silence, and the wizard carried its *default* property type through a test whose whole
premise was that a type had been chosen. The guard existed because of the flakiness the sleep caused;
both are now `await expect(opt).toHaveCount(1)` followed by an unconditional click.

**One needed the application changed to be testable at all.** `refer.spec.js` asserts that a *cancelled*
native share does not count an invite — and a cancelled share deliberately mutates nothing, so there was
no signal to wait on and the test settled for "still 0, three hundred milliseconds after a click". That
assertion would have passed just as happily against a button wired to nothing. The `reject` stub in
`loginAndOpen` now counts attempts, so the test proves the handler ran before claiming the counter did
not move.

**The rest divide cleanly by whether the next line retries.** Where a sleep sat directly above a
Playwright assertion it was pure superstition and simply went. Where it sat above a non-retrying read —
`innerText()`, `.count()`, `allInnerTexts()`, `page.evaluate()` — it was load-bearing, and has been
replaced by whatever state change the test was really waiting for: `not.toHaveText(`${start}%`)` for the
progress meter, `toHaveValue('1200')` for a committed field, `not.toHaveCount(before)` for a filtered
card list, `toContainText('1')` for the referral counter, `toHaveClass(/selected/)` for a deal-type pill.

Two replacements are stronger than what they replaced rather than merely equivalent. `p3.spec.js:120`
asserted that submitting without a document raises *no* document error — which passes for free against a
form that has not validated yet, and at the moment of the click that is exactly the state it is in. It
now waits for the *photos* error to appear first, so the absence of a document error is a decision the
form made rather than a race the test won. Likewise the photo-upload test now waits for the thumbnail to
render (`PhotoUploader.jsx:59`) instead of for an error class to disappear, because a page that never
processed the upload also has no error class.


### D225 — P5: `networkidle`, 122 call sites, one of which just failed

Removing the sleeps surfaced the next tier of the same problem. `waitForLoadState('networkidle')` and
`goto(..., { waitUntil: 'networkidle' })` appear **122 times across 31 of the 242 spec files.**

| Count | File |
|---:|---|
| 19 | `consumer/services/rent-agreement.spec.js` |
| 17 | `consumer/dashboard.spec.js` |
| 9 | `scheduled-visits.spec.js` |
| 8 | `platform/live-desktop-noleak-guardrails.spec.js` |
| 7 | `my-rental.spec.js` |
| 7 | `tenant-profile.spec.js` |
| 7 | `mobile/live-sheets-and-actions.spec.js` |
| 6 | `owner-finances.spec.js` |
| 5 | `live-verify-funnel.spec.js` |
| 5 | `action-center.spec.js` |
| — | …21 more files with 1-4 each |

**This is not a style preference; one of them failed in the current live run.**
`live-text-legibility.spec.js` timed out after 20s on `/society/skyline-heights-baner` — and the
failure artefact's own page snapshot shows the route had rendered *perfectly*: breadcrumb, hero image,
Follow button, the lot. The page was fine. The wait was wrong.

`networkidle` does not mean "the page is ready". It means "no request has been in flight for 500ms",
which is a property of the *network*, not of the DOM the test is about to assert on. A surface with a
hero image, lazily-loaded tiles, a poller or any periodic beacon can simply never satisfy it. It fails
in both directions at once: it makes fast pages 500ms slower each time, and makes busy pages time out
at 20s — and the failure it produces names the load state rather than the page, so it reads like an
application problem when it is a test problem.

**Fixed here:** `live-text-legibility.spec.js` (3 call sites) now uses a `settled()` helper asserting
`main` is visible and non-empty, backstopped by the `MIN_MEASURED` floor added earlier today. If a
route paints its shell and nothing else, the floor fails loudly with the route name instead of the
navigation timing out anonymously.

**Not fixed:** the other 119. They are not currently failing, and changing 122 navigation calls without
running them is exactly the kind of blind edit that turns one known flake into thirty unknown ones. The
replacement is per-route rather than mechanical — each site needs the assertion that names what that
page is waiting for, which is the whole point. Recommended order when this is picked up: the four
files with 7+ occurrences first, since they concentrate a third of the total, and each is a coherent
surface that can be run on its own in under a minute.


### D225 (cont.) — the sleep backlog is finished, not just dented

Carried on past the ten surveyed files and swept the rest. **105 of the 107 non-`live-` sleeps are gone,
across 34 files.**

| Wave | Files | Sleeps removed |
|---|---:|---:|
| The ten worst offenders | 10 | 53 |
| `consumer/flatmates/` — video, full-journey, my-listings, alerts | 4 | 14 |
| `consumer/list-property/` remainder — reset, rent-maintenance, seam-write, geocode, map, possession, stepnav, consumer-fixes | 8 | 13 |
| listing-freshness, dup-modal, detail-improvements, detail-sale, qa-location-search | 5 | 10 |
| The sixteen singles | 15 | 15 |
| **Total** | **34** | **105** |

**Two left, deliberately.** `entity-search.spec.js:93` and `qa-location-search.spec.js:185/216` each run the
alphabet through the search box looking for a society or landmark suggestion in the seed. The suggestion
fetch is debounced, and *no result* is a legitimate outcome for most letters — so there is no signal that
distinguishes "the debounce has not fired yet" from "this letter matches nothing". Polling for a non-empty
list would fail on the empty letters; polling for any change would be satisfied by the previous letter's
results clearing. The honest answer is that this needs a marker the application does not currently expose,
and inventing one in the test would be worse than the 120ms. Recorded rather than faked.

**★★ The silent-skip guard was in EIGHT files, not two.** The full set:
`p3.spec.js`, `layout.spec.js`, `reset.spec.js`, `geocode.spec.js`, `map.spec.js`, `possession.spec.js`,
`stepnav.spec.js`, `locality-select.spec.js` — every one of them

```js
await page.waitForTimeout(250);
const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
if (await opt.count()) await opt.first().click();
```

Eight copies of a wizard step that could silently decline to pick a property type and carry the default
through the rest of the test. This is what copy-paste does to a workaround: the sleep and the guard
travelled together as a unit, and each new file inherited a defect nobody had noticed in the first one.

**Two more tests gained a signal rather than losing one.** The geocode-failure test asserted that a failed
lookup leaves the address fields empty — which is also true of a page that never called the geocoder, and
true of the fields *before* the search. The stub now counts invocations (`window.__geocodeCalls`), so the
emptiness is a consequence rather than a starting condition. Same shape as the cancelled-share fix earlier
today. Separately, `listing-freshness.spec.js` had its positive `Active` assertion sitting *below* two
`toHaveCount(0)` claims; moving it above them is the difference between "gone because confirmed" and "not
rendered yet".

**Diagnostics that were only ever `console.log` are gone.** `flatmates/video.spec.js` spent two sleeps and
three reads populating log lines nobody reads — stored-room count, tab visibility, whether the body text
contained the society. The one claim among them worth making (the post reached storage under this user) is
now an `expect.poll`; the rest went.


---

## FINDING (a11y): the flatmates gender filter is not announced, but its sibling is

Found while replacing a load-bearing `waitForTimeout` in
`e2e/tests/consumer/flatmates/alerts.spec.js` with the assertion it was standing
in for. The obvious assertion -- "the control says it is pressed" -- failed, and
the failure was correct.

`frontend/src/pages/consumer/flatmates/FilterBar.jsx`

- **L145**, lifestyle tags: `aria-pressed={filters.habits.includes(tag)}`
- **L130**, gender segment: no `aria-pressed` at all. Selection is carried only
  by the class `seg()` appends --
  `frontend/src/pages/consumer/flatmates/useFlatmateDiscovery.jsx:213`:

  ```js
  const seg = (active) => 'seg text-sm ... box-border' + (active ? ' active' : '');
  ```

So a screen-reader user is told whether "Non-smoker" is on, and is not told
whether "Men" is. The two controls sit in the same filter grid, look identical,
and behave identically; only one of them reports its state. Same pattern at
L114 (`moveIn`) and L156 (`attachedBath`), which DO carry `aria-pressed` -- the
gender row is the odd one out, which is what makes it look like an oversight
rather than a decision.

**Not fixed here.** It is a frontend behaviour change and this window's rule is
to record product changes rather than make them unilaterally. The test now
asserts `toHaveClass(/\bactive\b/)` on the gender button and keeps
`toHaveAttribute('aria-pressed', 'true')` on the lifestyle tag, with a comment
saying why the two differ and pointing here. When the attribute is added, the
test should be tightened to match and this entry deleted.

The lesson, which is the same one as the eight silent-skip guards: do not guess
a component's vocabulary. Read it. Both controls being buttons in the same grid
was not enough to make them the same control.

---

# Closing summary: the autonomous window (8cecfe5 .. 45f9168)

## What shipped

| Commit | What |
|---|---|
| `4d6b644` | wizard failure fixed; 9 admin specs verified and converted |
| `182330e` | `Contact.jsx` repointed to the live API |
| `a91ef30` | `admin/properties.spec.js` converted (33 passed) |
| `1c4b039` | `submit.js` -> `requestRecheckFields` repointed |
| `32218ed` | three RED backend contract tests |
| `3ce8c30` | anti-pattern survey findings that did not survive spot-checking |
| `71fc759` | the three deliberate surviving sleeps, recorded not faked |
| `3b19761` | eleven specs that were passing without asserting anything |
| `91611e9` | `networkidle` replaced with an assertion; legibility floor set by measurement |
| `45f9168` | 105 `waitForTimeout` calls removed across 42 specs, plus the silent skip eight of them hid |

## Gate results

- **Full live suite: 827 passed / 3 failed / 830 executed.** All three failures
  were then diagnosed and fixed, and one self-inflicted floor regression with
  them; re-verified at 135 passed and 22 passed.
- Mock suite over the 42 changed specs: 237 passed / 3 failed, all three fixed,
  re-verified at 34 passed.
- Backend contract guards (`target-d223d`): exit 0.
- Full backend suite (`target-d223c`): exit 0, 178 report files.
- frontend `npm run lint` 0, `npm run check` 0, `npm run check:coverage` clean,
  `graphify.ps1 update` clean.

## What is deliberately still open

**P5 -- `networkidle` backlog.** 122 sites across 31 spec files. One of them
actually failed in the live run. Three fixed in `live-text-legibility.spec.js`;
the other 119 left alone. `waitForLoadState('networkidle')` means "no request in
flight for 500ms", which is a property of the network rather than of the DOM.
Worst offenders: `consumer/services/rent-agreement` (19),
`consumer/dashboard` (17), `scheduled-visits` (9),
`platform/live-desktop-noleak-guardrails` (8), then 7 each in `my-rental`,
`tenant-profile` and `mobile/live-sheets-and-actions`.

**Sleeps that remain, on purpose.** 3 non-live, all inside
`for (const ch of 'abcdefghijklmnoprstuvw')` probes against a debounced search
box where *no result* is a legitimate outcome (`entity-search.spec.js:93`,
`qa-location-search.spec.js:185` and `:216`). Plus 25 in `live-` files, which
belong with the networkidle backlog.

**Five admin pages are still fully mock-backed:** `AdminAnalytics`,
`AdminContent`, `AdminFinance`, `AdminEnquiries`, `AdminServices`.
`AdminProperties.jsx` is hybrid.

**Blocked on product decisions, not on effort:**

- `useDashboardData` -> `listEnquiries`: there is no consumer endpoint. Only
  `Routes.Moderation.ADMIN_ENQUIRIES` exists and it is STAFF/ADMIN-guarded.
- the `society` catalogue: `societyService.js` is ratings-only; the catalogue is
  still the bundled `data/societies.js` (348 rows).
- `confirmListingFresh` (FINDING 7): confirmed blocked, cited in COVERAGE.md.
- the shared audit seam: design recorded, waiting on two product decisions.
- `tickets.value` has no write path; Move-in Pack prices read from browser
  storage; `AdminContent.jsx` cannot write a translation; `addDemandAlert` has
  no server home; `ServiceRequest.ticketId` exists server-side but no client can
  set it (D45).

**New this window:** the flatmates gender filter carries no `aria-pressed` while
its sibling controls do -- see the a11y finding above.

## For whoever picks this up

Nothing is pushed. `feature/backend-integration` is 30 commits ahead and the
working tree is clean apart from these notes. The next mechanical step is Wave 5,
and the planning fact that matters is that most consumer specs cannot be moved
onto the `login` fixture as-is: admin specs authenticate, consumer specs mostly
write `puneNestUser` into localStorage in an `addInitScript`.
`tests/consumer/property/` (18 files) has zero `mockApi` imports and zero real
logins. Convert the page first, then the spec.

---

## The `rawDb` / `mutateDb` cluster is closed (survey, not a task)

Swept every remaining importer of `mockApi.js`'s raw store accessors. Nothing further is deletable
without a decision. Recording *why* each one stays, so the next pass does not re-derive it:

| Importer | Why it stays |
|---|---|
| `pages/admin/AdminTopbarTools.jsx` | item 22 — the command palette searches fixtures |
| `pages/admin/AdminEnquiries.jsx` + `enquiries/helpers.js` | **item 25** — no server surface; cross-user PII decision |
| `pages/admin/AdminLocalities.jsx` | **item 24** — the curation queue is the wrong object |
| `pages/admin/AdminSocieties.jsx` | item 19 — society catalogue blocked |
| `pages/admin/AdminSettings.jsx` | item 18 — needs a decision on what "Clear log" means |
| `pages/admin/properties/DuplicatesTab.jsx` | duplicate clusters have no server home |
| `lib/chat.js` | reads one flag (`settings.flags.demoChatSeed`), nothing else |
| `lib/data/analytics/*` | the mock analytics engine — moves as one unit or not at all |
| `lib/data/finance-admin.js` | item 20 |
| `lib/data/managedProperty.js` | one write site (L164) |
| `lib/data/ownerIdentity.js` | its header says it *is* the mock `users` table |
| `lib/data/properties-admin.js` | mock half of the property seam + the duplicates feature |
| `lib/data/propertyIdentity.js` | item 23 |
| `lib/data/reports.js` | read only by the mock `reportProvider` |
| `lib/data/support.js` | **live** — do not touch |
| `lib/geoConfig.js` | 23 importers; high blast radius, no server counterpart |
| `lib/store/billing.js` | the `fee()` fallback layer — see below |
| `lib/store/referrals.js` | Q17 / D191 — the server pays ₹ credit, the client spends listing slots and contacts. Two currencies. Documented in the file's own header. |
| `lib/store/community.js` | items 19 and 24 |
| `services/providers/mock/*` | the mock half of each seam, by design |

### The `fee()` survey (closed)

Three readers, and they are not the same case:

- `Plans.jsx` — already flipped to `listPlans()`; `fee()` is a documented fallback for the moment
  before the catalogue resolves and for a failed fetch. Correct as it stands.
- `ListingPaywall.jsx` — was **not** flipped, and quoted `fee('ownerPlanYearly')` next to a button
  that opens `/checkout?plan=owner2`. Fixed in `3cda2cf`; same fallback shape as `Plans.jsx`.
- `Refer.jsx` — `fee('rentAgreementPlatform')`. Not a plan price. This is one of the non-plan
  charges the Fees panel genuinely owns, and it has a live source (`GET /fees` → `platformFee` on
  the `rent` row) that `useRentAgreement.js` already reads. Worth flipping later for consistency,
  but it cannot produce the Plans-class defect: nothing on `/refer` charges anybody.

`lib/store/billing.js#getFees` therefore stays as the fallback layer. It is not a seam waiting to
be flipped — it is the thing the seams fall back *to*.

## Pending frontend edits — blocked only on the live suite finishing

These are decided and ready; the live Playwright run holds the Vite server, so `frontend/src`
must not change until it finishes.

- **Four comment corrections for `{market_rate}`.** `bf1b438` made the server resolve
  `{market_rate}` from `localities.rate_per_sqft`. Four client comments still say it resolves to
  nothing, which was true when they were written and is not now:
  `lib/outreachTemplate.js` (~L22-27), `pages/admin/properties/PropertyReviewModal.jsx` (~L309-311),
  `services/providers/http/outreachProvider.js` (~L34-38),
  `services/providers/mock/outreachProvider.js` (~L22-30).
  Quote-and-correct in place, house style. Deliberately **not** touching
  `lib/mockApi/whatsappTemplates.js:48,106` (that is the mock, and `9,500` is what it really does)
  or `e2e/tests/admin/live-outreach-console.spec.js:17` (its claim is about the modal's old bug and
  is historically accurate).

- **`AdminDashboard.jsx` fetches an admin KPI object it never reads.** `getAdminKpis()` is one of
  nine parallel calls at L86, is stored into state at L97, and is then absent from the destructure
  at L116 — nothing in the file references `kpis` or `data.kpis` again. Every tile is recomputed
  from the raw collections a few lines below (`pendingVerif`, `activeListings`, `totalListings`,
  `totalUsers`, …). Deleting the call also makes `lib/mockApi/staff.js:71` dead, since
  `AdminDashboard.jsx` is its only caller. One fewer mock import on the screen with the most of
  them, at no behavioural cost.

  Worth saying what this does *not* unblock. The screen still needs `getAnalytics`, `getSettings`,
  `listEnquiries`, `listVisits`, `listTickets`, `listDeals` and `listUsers`, and the server's own
  scorecard is a different object anyway — `AdminKpis` is
  `{ totalListings, activeListings, pendingModeration, openReports, totalUsers, newUsers7d,
  dealsClosed30d, revenue30d }`, which overlaps the mock's
  `{ users, listings, approved, pending, archived, openTickets, deals, enquiries, revenue }` on
  about half its fields and agrees on the window of none of the time-bounded ones. Two of the
  mock's tiles (`enquiries`, `revenue`) are blocked on decisions 25 and 20 regardless. So this is a
  dead-code deletion, not a step of the flip.


## Six server routes the client has never called — all six built, one a pure port

Found by extracting every `public static final String` route in `Routes.java` (114 of them) and
testing each one's last path segment against the whole of `frontend/src/services`. Six came back
with no match. The heuristic under-reports — `/admin/reviews` passes it because the word "reviews"
appears in `reviewService.js`, which is exactly how item 30 hid — so six is a floor, not a total.

> **Corrected while writing register item 31: a much lower floor than this paragraph thought.**
> "114 of them" is every route declared as a *string literal*. `Routes.java` declares **243**
> route constants; **129 are computed** — `REDEEM = BASE + "/redeem"`, `MINE = BASE + "/mine"` and
> so on — and a regex over quoted strings cannot see any of them. This audit covered 47% of the
> surface. `POST /referrals/redeem` is one of the 129, and it is the missing entrance to an entire
> scheme (item 31). Rerun against all 243 before treating any number here as complete.

**All six have a controller.** The first pass of this note said three of them did not, because it
looked for controllers referencing a constant called `OWNER_KYC` or `MANAGED_PROPERTIES`. Those
constants are named `BASE` inside a nested `MeOwnerKyc` / `Managed` class, so the grep found
nothing and the absence looked real. Corrected by grepping the path literal instead, which is the
only spelling that cannot be renamed out from under you.

| Route | Controller | Client today |
|---|---|---|
| `/me/notification-preferences` | `MeNotificationPreferencesController` | `localStorage` (`lib/store/notifications.js:102`) |
| `/me/service-orders` | `ServiceCatalogController` | `localStorage` (`lib/store/billing.js:81-83`) |
| `/me/owner-kyc` | `MeOwnerKycController` | `localStorage` (`useRentAgreement.js:328`) |
| `/me/managed-properties` | `MeManagedPropertiesController` | `lib/data/managedProperty.js` |
| `/me/document-requests` | `DocumentsController` | nothing found |
| `/me/service-request-invites` | `ServiceRequestInvitesController` | nothing |


### Notification preferences is a pure port and should just be done

No product decision, no UI change, no vocabulary conflict, and it fixes a live defect. Both ends are
already built to fit each other. `NotificationPreferencesDto`'s own Javadoc says so:

> **Field-for-field the object the browser has always kept in localStorage.** The client-side
> default is `{ email:true, sms:false, whatsapp:true, matchAlerts:true, quietHours:{ enabled:false,
> start:'22:00', end:'07:00' }, language:'en' }` and this record is that, including the nesting.
> Naming is the whole job here [...] a server contract that renamed `matchAlerts` or flattened
> `quietHours` would make the migration a transformation rather than a move, and every
> transformation is somewhere for the two to drift.

That default is `NOTIF_PREF_DEFAULTS` at `lib/store/notifications.js:93-100`, character for
character. The endpoint was shaped to be dropped in and never was.

The defect it leaves is not cosmetic, and this branch made it reachable.
`MeNotificationPreferencesController`'s Javadoc describes it in the past tense:

> Before it, every one of these settings lived in one browser's localStorage, which meant the server
> enforced none of them: the quiet-hours window suppressed the alerts the client derived and nothing
> else, so a notification the server wrote at 03:00 arrived at 03:00.

Present tense, still. `ProfileTab.jsx:102` reads `getNotifPrefs()` and writes `setNotifPrefs()`, so
the server has never been told anyone's quiet hours and runs its deferral against defaults. Before
`87fded4f` that was theoretical, because the server wrote no alerts of its own. Saved-search alerts
now notify. So the one thing the owner can do about being woken at 03:00 is a switch that only their
own browser can see.

**Plan** (frontend, blocked only on the live suite holding Vite):

1. `services/notificationService.js` — add `getNotificationPreferences()` and
   `updateNotificationPreferences(patch)`; `providers/http/notificationProvider.js` calls
   `GET`/`PUT /me/notification-preferences`; `providers/mock/notificationProvider.js` keeps the
   existing `localStorage` behaviour so mock mode is unchanged.
2. `ProfileTab.jsx` — read prefs from the service on mount, write through it on change. The screen
   already has an `announce` flag on `changePrefs` for the time inputs, so the optimistic-update
   shape is in place; keep the local state optimistic and reconcile from the `PUT` response, which
   is why the server returns the document on write.
3. `lib/store/notifications.js` — `inQuietHours` stays. It is client-side suppression on the
   Notifications page and is still wanted; it just needs the fetched prefs passed in rather than
   defaulting to the localStorage read.
4. Spec + a `COVERAGE.md` row: set quiet hours as one user, sign in as the same user in a fresh
   context, assert the window survived the browser.

### The other four, and why they are not this

`/me/service-orders` is a purchase record — `Checkout.jsx:66` writes subscriptions and top-ups to
`pnServiceOrders:<mobile>` in `localStorage`, `Services.jsx:236` writes move-in-pack orders. Flipping
it is a billing question (what is an order, when is one created, what does the server consider paid)
and belongs with item 20 rather than being taken on the way past.

`/me/managed-properties` backs `PropertyPassport.jsx` and the owner dashboard through
`lib/data/managedProperty.js`, including a `publishManagedProp` path — a draft-to-listing
transition, which is the kind of thing to look at properly rather than in passing.

`/me/document-requests` and `/me/service-request-invites` have no client counterpart at all, so
there is nothing to flip. They are unbuilt screens, not stranded ones.


### `/me/owner-kyc`: the vault the comment points at is already there

`useRentAgreement.js:309-322` deliberately excludes PAN and Aadhaar from the browser copy and says
why, at length and correctly — "any XSS anywhere on this origin reads it, and so does the next
person to use a shared, borrowed or resold device", plus Aadhaar Act s.29. It then names
`/me/owner-kyc` as where prefill belongs "if it is ever wanted back", and instructs future readers
not to "fix" the missing prefill by putting the two numbers back.

`MeOwnerKycController` exists. So the conditional in that comment has been satisfied since whenever
it was built, and the comment reads as though the vault is hypothetical. That does not make the
exclusion wrong — it stays right either way — but it changes the shape of the follow-up from "build
a vault" to "point the form at the one there is".

Worth noting too that the same sentence argues against what remains in the browser: name, age,
gender, email and permanent address, unexpired, keyed by mobile number, on the shared device the
comment describes. Not a defect to fix silently, since the exclusion was weighed and the residue
plainly was too. But when the form is pointed at the vault, the address should move with the
numbers rather than be left behind.



## The route census, done properly: 227 routes resolved, 35 unreached, 12 of them findings

Supersedes the "six routes" note above, which saw 114 of 243 route constants because it read only
string literals. This pass parses `Routes.java` with the nested-class scope tracked, resolves
concatenations (`REDEEM = BASE + "/redeem"`) to full paths, and tests the static prefix of each
against every `.js` and `.jsx` under `frontend/src` except the mock. 227 of 243 resolve; the
remaining 16 are built from expressions this resolver does not evaluate and are the next
improvement if anyone reruns it.

35 came back unreached. Twelve are not findings:

| Route(s) | Why it is not a finding |
|---|---|
| `/properties/*`, `/owners/*`, `/localities/*`, `/societies/*` | Spring Security matchers, not endpoints |
| `/dev/storage/{*key}`, `/dev/storage/**` | Dev-profile object store |
| `/me/verification/aadhaar/simulate` | e2e and dev only |
| `/webhooks/cashfree/digilocker`, `/webhooks/cashfree/payment` | Server-to-server |
| `/auth/staff-invite/redeem` | Reached from an emailed link, not from the app. `authProvider.js:56` already says so |

That leaves 23 real routes across nine features. Every one is now either recorded or explained:

| Feature | Routes | Status |
|---|---|---|
| Referral consumer half | `/me/referrals`, `/referrals/redeem` | **Register item 31** |
| Review moderation | `/admin/reviews` | **Register item 30** |
| Notification preferences | `/me/notification-preferences` | **Port planned above — no decision needed** |
| Audit log reader | `/admin/audit-log` | **Register item 18** |
| Admin visits / deals / conversations | `/admin/visits`, `/admin/deals`, `/admin/conversations/{id}` | **Register item 25** — `AdminEnquiries.jsx:3` imports `listDeals`, `listVisits` from the mock, and the server has both |
| Society follow | `/me/societies/{slug}/follow` | **Register item 19** — the whole society surface is blocked there. `i18n/.../society.json` already carries `follow` and `followSociety` in three languages |
| Service catalogue and orders | `/service-catalog`, `/me/service-orders`, `+/{id}`, `+/accept`, `+/cancel`, `/service-orders/{id}/status` | **Register item 20** (finance). Five routes, not the two the earlier note found — the accept/cancel/status trio only appears once concatenations are resolved |
| Managed properties | `/me/managed-properties`, `+/{id}`, `+/{id}/publish` | Not recorded. Includes a draft-to-listing transition; wants looking at on its own |
| Admin dashboard | `/admin/dashboard` | Not recorded. See below |
| Boosts | `/boost-packs`, `/me/properties/{propId}/boost` | Not a finding — unbuilt client-side, not stranded. `savedService.js:7-9` records the unbundling |
| Document requests, service-request invites | `/me/document-requests`, `/me/service-request-invites`, `+/{partyId}`, `/admin/properties/summary` | Not findings — no client counterpart was ever built |

### `/admin/dashboard` is the one still worth a decision

`AdminDashboard.jsx` computes every tile in the browser from raw collections, and calls the mock's
`getAdminKpis()` in the same `Promise.all` — whose result it destructures and then never reads (the
dead call recorded in the pending-frontend-edits note). Meanwhile `AdminKpis` on the server is
`{ totalListings, activeListings, pendingModeration, openReports, totalUsers, newUsers7d,
dealsClosed30d, revenue30d }`, with `revenue30d` withheld from staff by spec fix S61.

The two disagree about what a dashboard is, which is why this is not a port: the client's tiles are
derived from whatever the console happened to fetch for other reasons, so they are consistent with
the tables on the same screen and wrong the moment a collection is paged. The server's are computed
from the database and correct, and one of them is access-controlled. There is no service file for
it — `frontend/src/services` has 38 members and neither `dashboardService.js` nor
`analyticsService.js` is among them.

### What this census cannot see

Three things, all worth stating so the next person does not read 35 as a total:

1. **The 16 unresolved constants.** Anything built from a helper call rather than a concatenation.
2. **Paths the client assembles from pieces.** The test matches on the static prefix, so a client
   that writes `` `/me/` + kind + `/orders` `` would read as unreached and is not.
3. **Routes reached only from `e2e/`.** Deliberate: a route exercised by a spec and by nothing in
   `frontend/src` is precisely the finding this is looking for, not a false positive.

Two consecutive audits of the same file were defeated by two different ways of writing a constant —
a nested class whose field is called `BASE`, then a concatenation. `Routes.java` is not readable by
pattern. If this matters again, resolve it properly or generate the list from Spring's
`RequestMappingHandlerMapping` at runtime, which is the only source that cannot be out of date.

---

## The notification-preferences port, done (commit `01a69e2`)

The four-step plan in the census section is executed. What it actually took, and the two
places the plan was wrong:

**The plan said "`providers/mock/notificationProvider.js` keeps the existing localStorage
behaviour so mock mode is unchanged".** True, but it understated where the work goes. The
`PUT` requires all six fields, so somebody has to widen a one-switch patch into a whole
document. The plan implied each provider would handle its own shape. Putting the merge in
`notificationService.js` instead — above both — is what stops the mock from accepting a
two-key write that the API would 422. Demo mode passing while production rejects is the
worst place for that difference to live.

**The plan said `inQuietHours` "just needs the fetched prefs passed in rather than
defaulting to the localStorage read".** Also true, but the caller it named needed more than
that. `Notifications.jsx:131` read prefs *synchronously* and used the answer as an early
return from an effect. Asynchronous prefs mean the effect can no longer decide to bail
before it knows, so the whole suppression check moved inside the promise chain.

The `default` parameter on `inQuietHours` stayed, and now carries a comment saying it is a
fallback rather than the normal path — a caller that forgot its argument would silently
reinstate the exact bug the port exists to end.

### What this closes

`/me/notification-preferences` leaves the unreached list: **34 unreached routes, not 35.**

The register does not gain an item. This was a port with both ends built and no UI change,
which is a do rather than a record — the precedent the standing rules already name.

### Two documents corrected in place

`notificationService.js`'s header table said preferences were "**`lib/` only** | no endpoint
at all; `ProfileTab` is untouched". `live-settings-preferences.spec.js`'s docblock said "the
conversion here is not 'move the state to the server'". Both quoted and corrected rather
than edited away, because *why* they were wrong is the useful part: both described the
symptom of an unfinished port and mistook it for the design. The endpoint had existed since
D94/D15 with tests and an OpenAPI entry the whole time.

### The spec, and one thing it deliberately does not do

The old persistence test read `localStorage.getItem('pnNotifPrefs:<mobile>')` back and
asserted `email === false`. That could only ever prove the browser agreed with itself. It
now asserts the `PUT` and its full six-field body — a partial body 422s, and a swallowed 422
looks exactly like a success on screen.

The new test is the one localStorage could never have supported: a second browser context,
its own storage and session, reading back two settings **both flipped away from their
defaults**, so a fallback-to-defaults regression fails both assertions instead of passing.

It does not drive the quiet-hours times. `TimeField` is a `role="button"` opening a portaled
dialog with two dropdowns, an AM/PM group and a Confirm; driving that would make the test
mostly about the time picker, which has its own coverage. Two booleans prove the same thing
about the same document over the same seam with a fraction of the anchors to break.

---

## Managed properties triaged: register item 32

The last unrecorded finding from the census now has a home. Six server routes, an applied
`V33`, zero rows, and no client call — the same shape as items 20 and 31 — but with one
difference that changes the recommendation.

In 20 and 31 the client had built a *substitute* for a server feature and the substitute was
wrong: a referral code minted in the browser that `POST /referrals/redeem` could never
resolve. Here `lib/data/managedProperty.js` is not wrong. It is a competent store and the
passport built on it works. What is wrong is that it is per-browser, plus **two** functions
that do things the server was never asked to do:

- `publishManagedProp` writes a listing row, links the record, *and* unshifts a client-local
  notification. The server's `publish` does the first two. Whether the platform should
  announce a submitted listing to its own owner is a real product question.
- `ensureManagedForListing` auto-creates a managed record as a side effect of **rendering a
  list** (`ownerProperties.js:35`, once per owned listing). Free on localStorage; against the
  API it is a `POST` per listing per dashboard load, and it would leave the table holding one
  row per listing — a different data model from the one `V33`'s own comment describes.

So the recommendation is a *partial* port rather than a flip: move the five clean operations,
leave publish and the bridge behind the seam guard with a comment. There is no fiction to
retire here, only a scope to correct.

### Census status after this

Of the 35 unreached routes, one is now ported (notification preferences) and every remaining
finding has a register item or a stated reason for having none. `/admin/dashboard` stays
argued-in-place rather than itemised: the `getAdminKpis` deletion in `01a69e2` records the
shape mismatch where the dead function was, which is where the next person will look.

---

## The census is a committed script now, and re-running it moved 9 routes out of "reached"

The section above ends with a recommendation: *"If this matters again, resolve it properly or
generate the list from Spring's `RequestMappingHandlerMapping` at runtime, which is the only source
that cannot be out of date."* The first half is now done — `backend/tools/route-census.mjs`. The
second half is still the right answer and is still not done, for a reason recorded below.

### Why committing it was the whole point

The census had been re-typed by hand into a PowerShell one-liner every time it was run, a dozen or
more times across this migration. Retyping it is how the "16 unresolved constants" in the list above
survived: the class-member pattern required `public static final String`, so every route class whose
`BASE` is declared `private` failed to resolve, and those constants were reported as *unresolved*
rather than as reached or unreached. Fourteen of the sixteen were in fact reached. The other two
were something better (below).

The note above blames `Routes.java` — *"not readable by pattern"* — and that was the wrong
conclusion. It is perfectly readable by pattern; the pattern was wrong, and it stayed wrong because
**a tool that is re-created from memory each time it is used cannot accumulate fixes.** It can only
accumulate the parts of itself that are memorable, and a visibility modifier in a regex is not
memorable. Committing it cost one file.

### Four separate mis-reports, each found by fixing the one before it

Every fix to the script changed the answer, which is the argument for the script existing:

1. **`private BASE`** — `unresolved` 16 → 0. Fourteen routes moved into "reached", two into (2).
2. **Shadowed routes.** `GET /me/documents/personal` has its own handler, but the client never
   writes that path: it calls `listDocuments(mobile, 'personal')`, which builds
   `/me/documents/${propId}`, and Spring resolves it to the personal handler because a literal
   segment out-ranks a template one. `MeDocumentsController`'s own Javadoc says so. A text census
   cannot see this by construction, so it now computes it: a miss is `SHADOWED` when some other
   resolved route is a pattern that also matches it. The first version of that test only compared
   the final segment, which reported `/me/documents/personal` as shadowed and
   `/me/documents/personal/{docId}` beside it as unreached — worse than getting both wrong, because
   the inconsistency reads as a real distinction.
3. **Security matchers.** `/properties/*`, `/dev/storage/**` and four siblings are constants handed
   to Spring Security's path matching, not endpoints. No client requests them, ever. Counting them
   as unreached kept the headline number six too high, permanently, which is how a report stops
   being read.
4. **Comment-only mentions — the worst of the four.** The index is text, so a route named in a
   comment counted as reached. Nine routes were being credited that way, and the comments in
   question are the ones saying the route is *not* ported. `contentService.js` says
   `/announcements`, `/services`, `/banners` are *"recorded rather than moved"*; `documentService.js`
   says the buyer's `POST /documents/requests` has no faithful contract surface;
   `useRentAgreement.js` says KYC *"belongs behind the access-controlled vault (`/me/owner-kyc`)"*.
   **The sentence explaining that a route is deliberately unported was the evidence that it was
   ported.**

   These are now a bucket of their own — `DOCUMENTED` — because they are the one category needing
   no investigation, and lumping them in either direction wastes the reader's attention.

### The numbers, and what they mean

```
defs=247 resolved=247 unresolved=0 considered=247
wired=202 matchers=6 shadowed=2 documented=9 unreached=28
```

`unreached=28` is the honest figure and it is not a to-do list. Every entry has a register item or a
stated reason: `ServiceCatalog.*` (5 routes) is item 20, `Referrals.*` item 31,
`Moderation.ADMIN_REVIEWS` item 30, `Admin.AUDIT_LOG` item 18, `MeManagedProperties.*` item 32,
`Admin.DASHBOARD` is argued in place in `AdminDashboard.jsx`, and the two Cashfree webhooks are
server-to-server and have no client by design.

### Still not done, deliberately

**Generating the route list from `RequestMappingHandlerMapping` at runtime.** It remains the right
answer for the same reason it always was — it is the only source that cannot disagree with what the
server actually serves, and it would have made all four bugs above impossible rather than fixable.
It is not done because it needs a running app, which turns a two-second script into a boot, and
because `Routes.java` is now fully resolved, so the marginal gain today is zero. The gain is not
zero *tomorrow*: the first `@GetMapping("/literal-path")` that skips `Routes.java` is invisible to
this script and would be caught by that one.

**Reading `e2e/` as well as `frontend/src`.** Still deliberate, unchanged: a route exercised by a
spec and by nothing in the app is exactly the finding being looked for.

---

## 195 dead exports, and the shape they make

`backend/tools/dead-exports.mjs`, committed alongside this note. It reports every `export function`
/ `export const` / `export class` in `frontend/src` that **no other file anywhere in
`frontend/src` or `e2e/` names**.

```
subjects=607 files_with_dead_exports=68 dead_exports=195
```

### Read the number correctly: the scan is sound in one direction only

It is a text search for an identifier, which makes it:

- **Conclusive when the count is zero.** Nothing can import, re-export or namespace-access a symbol
  without naming it. `export *` barrels do not defeat this — the barrel does not mention the name,
  but every *consumer* must, whether it writes `import { foo }` or `ns.foo`. So a zero is a proof.
- **Worthless when the count is not zero.** `lib/serviceFlow.js` exports `get`, `list`, `create`,
  `update`, `cancel` and `digits`. A word-boundary search finds `get` three and a half thousand
  times across the tree, essentially none of them this module. Short generic names are invisible to
  this technique, so the true dead count is **at least** 195 and there is no way to say by how much.

The tool therefore prints only the dead list and deliberately refuses to print a "live" column.
Offering both would present two very different kinds of claim as one table.

`services/providers/**` is excluded, because `services/config.js` loads all 64 provider files
through a *non-eager* `import.meta.glob` — no file names them, and a scan that did not know this
would report the entire live-API layer as dead. That exclusion is the one hand-maintained thing in
the tool, and it is a directory rather than a list because the whole directory shares the reason.

### The shape is the finding, not the total

The dead exports are not scattered. They cluster into whole **client-only sub-features that the
server never grew an equivalent for**, and each cluster is one coherent idea:

| File | Dead exports | What the cluster is |
|---|---|---|
| `lib/store/deals.js` | `saveOffers`, `offersFor`, `pendingOfferCount`, `requestFinalize`, `myFinalizeStatus`, `cancelFinalize`, `declineFinalize`, `pendingFinalizeCount`, `isDealReserved` | an entire offer-and-finalize negotiation flow, in localStorage |
| `lib/data/finances.js` | `setTransactions`, `getLoan`, `setLoan`, `getTenant`, `getBudgets`, `setBudgets`, `setBudget`, `calculateEMI`, `FIN_PERIODS` | budgets and an EMI calculator |
| `lib/store/referrals.js` | `referralJoinsTarget`, `referralListingSlotsPerReward`, `referralRewardsEnabled`, `getReferredBy`, `pendingReferralCredits` | the reward-accrual half of referrals (register item 31) |
| `lib/store/visits.js` | `setVisitStatus`, `pendingVisitCount`, `hasCompletedVisit`, `myVisitStatus` | visit status tracking |
| `lib/serviceFlow.js` | 13, incl. `createInvite`, `listInvites`, `getInvite`, `declineInvite`, `seedService`, `seedDemo` | half the co-fill invite feature, plus two demo seeders |

That is the useful observation. **These are not leftovers from deleted callers; they are features
that were written in the browser and never had a caller built**, and they are exactly the population
the mock retirement has to make decisions about. A dead `calculateEMI` is not litter — it is a
product question ("is there an EMI calculator?") that was answered in code and never in the UI.

### Why this is not being deleted wholesale

Two reasons, and neither is caution for its own sake.

1. **A dead export is not automatically a defect.** A constant published for a screen that has not
   been built yet is a judgement call. `lib/constants.js` exports `VISIT_STATUS`, `LISTING_STATUS`,
   `DEAL_TYPE`, `USER_ROLE` and `CONTACT_STATUS` — five enums that nothing imports, in a file whose
   entire purpose is to be the place those live. Deleting them is defensible; so is keeping them.
   That is a call for a person, and 195 of them in one commit is 195 calls nobody reviewed.
2. **The clusters overlap the open register items.** `store/referrals.js`'s dead half is item 31.
   Deleting it would pre-empt the decision that item exists to ask.

What *has* been deleted is the subset where the answer is not a judgement call — see the commit
immediately before this note, which removed four dead exports and one wholly unused import after
checking each against `frontend`, `e2e`, `scripts`, `docs` and `tasks` individually. The scan found
them; a person decided them.

### What this is actually for

Two things, both already paid for:

- **A "provably dead" check before a deletion**, which is what the standing rule requires and what
  was previously done by eye.
- **A tripwire on the mock retirement.** Every function that moves to the server should leave a dead
  client-side original behind, and this is the list that will show it. If a port lands and this
  number does *not* go up, the old path is still wired somewhere.

---

## The 26 unreached routes, triaged — and none of them is "nobody got to it"

`route-census.mjs` gained one bucket (below) and now reports:

```
defs=247 resolved=247 unresolved=0 considered=247
wired=202 matchers=6 inbound=2 shadowed=2 documented=9 unreached=26
```

Every one of the 26 was then looked up by hand. The result is worth stating plainly, because it is
the opposite of what an "unreached" list normally means:

| Reason | Count |
|---|---|
| Recorded as an open decision in `tasks/DECISIONS-NEEDED.md` | 20 |
| Argued in a code comment rather than the register | 2 |
| No UI has ever existed for the feature | 3 |
| Dev-only helper | 1 |

**Nothing is unreached because it was forgotten.** The unreached bucket is not a to-do list; it is
an index of decisions, and 20 of the 26 rows already have a written argument with options attached.
That reframes what the census is for — it is a cross-check that the register is complete, not a
backlog.

### Recorded in the register (20)

| Routes | Item |
|---|---|
| `MeManagedProperties.BASE`, `.BY_ID`, `.PUBLISH` | 32 — owner's private property record |
| `ServiceCatalog.BASE`, `.ORDERS`, `.ORDER`, `.ORDER_ACCEPT`, `.ORDER_CANCEL`, `.ORDER_STATUS` | 20 (finance) and 26 (`services` CMS type) |
| `Moderation.ADMIN_REVIEWS`, `.ADMIN_PROPERTIES_SUMMARY`, `.ADMIN_VISITS`, `.ADMIN_DEALS`, `.ADMIN_CONVERSATION` | 30 — review moderation queue |
| `Referrals.MINE`, `.REDEEM` | 31 — referral consumer half |
| `ServiceRequests.MY_INVITES`, `.INVITE_DECISION` | 21 — rent-agreement co-fill invites, live in `localStorage` via `lib/serviceFlow.js` |
| `Engagement.SOCIETY_FOLLOW` | 34 — new, written today |
| `Admin.AUDIT_LOG` | 18 — audit reader |

### Argued in a code comment instead (2)

- **`Admin.DASHBOARD`.** `pages/admin/AdminDashboard.jsx:98` carries a long comment (added in
  `01a69e2`) recording that `getAdminKpis()` used to be fetched here and its result never read, and
  that adopting the server's `AdminKpis` is a product decision rather than a cleanup. Re-checked
  today by reading both ends: `AdminKpis` has 8 fields, the screen renders ~16 tiles, and they
  disagree on meaning — `openReports` is not `flagged`, `dealsClosed30d` is not `dealsProg`,
  `revenue30d` is not "revenue this month". The existing comment is right and no item is needed.
- **`MeDocumentRequests.BASE`.** Its sibling `Documents.REQUESTS` *is* in the `documented` bucket,
  because `documentService.js` states that the buyer's ask has no faithful contract surface. The
  read side has no such sentence anywhere, so it landed in `unreached` while its write side landed
  in `documented`. The feature is one decision; the census split it across two buckets. See below.

### No UI has ever existed (3)

- **`Auth.STAFF_INVITE_REDEEM`.** The staff console was never built (D200/D206). This is the same
  fact that made `lib/mockApi/users.js:addStaff` dead code, deleted in `be44e87`.
- **`Boosts.PACKS`, `Boosts.LISTING`.** There is no boost purchase screen. `lib/store/billing.js`
  exports `boostListing`, which the dead-export scan proves has zero callers, and `isBoosted`, which
  has zero callers outside its own file. The *read* half of boosting is fully ported —
  `propertyMapper.js:185` maps `boosted` off the wire and `listingsResultsPipeline.js` ranks by it —
  so what is missing is the shop, not the plumbing, and it sits behind the `paidFeaturedListings`
  admin flag. **This is a feature with no client at all, not a mock waiting to be retired**, and it
  therefore does not block anything the migration is doing.

### Dev-only (1)

- **`Verification.AADHAAR_SIMULATE`** — `DevVerificationController`. Reached by tests and by hand,
  never by the app. The census cannot see this from the path (`/verification/aadhaar/simulate` says
  nothing about being a dev route) and it is left in the list rather than special-cased, because one
  row is not worth a rule that would have to guess.

### The bucket the tool gained, and the one it should not

**Added: `inbound`.** `Webhooks.CASHFREE_DIGILOCKER` and `Webhooks.CASHFREE_PAYMENT` are called by
Cashfree, not by us. Expecting the frontend to mention them is the same category error as expecting
it to mention a Spring Security matcher, and leaving them in `unreached` inflates the headline with
two rows that **can never be retired**. A number that cannot reach zero stops being read. The rule
is `path.startsWith('/webhooks/')` — derived from the path, so a webhook added next year is
classified without anyone remembering this file exists.

**Not added: a dev-route bucket.** It would need either a hand-kept list of route keys or a guess at
naming, and there is exactly one member. A hand-kept list inside a tool whose entire purpose is to
avoid hand-kept lists is worse than a single row of noise.

### The limitation this triage exposed

`documented` is computed by asking whether the route's literal prefix appears in prose but not in
code. That works, and it caught nine routes whose only mention is a comment saying they are *not*
ported. But **prose attaches to the route the comment happened to name, not to the feature the
comment is about.** `documentService.js` explains that document requests are unported and names
`/documents/requests`; nothing names `/me/document-requests`, so the two halves of one decision
landed in two different buckets with two different implied meanings.

There is no good automatic fix — grouping by route-class would merge unrelated members, and
grouping by path prefix would have merged `/me/documents` with `/me/document-requests`, which
`Routes.java` goes out of its way to explain are *deliberately* different authorisation scopes.
The honest response is this paragraph: when reading the census, treat `documented` and `unreached`
as one list sorted by whether someone happened to write the path down.

## `ui-only` — the census bucket for a route the browser owns and the app never fetches (D226)

`node backend/tools/route-census.mjs` now reports seven buckets, not six:

```
defs=247 resolved=247 unresolved=0 considered=247
wired=195 matchers=6 inbound=2 shadowed=2 ui-only=7 documented=9 unreached=26
```

`wired` fell from 202 to 195. Nothing was un-wired; seven rows were never wired
in the first place and the census had been crediting them to a React Router
screen that happens to spell its path the same way.

### The bug the bucket fixes

`App.jsx:303` declares `path="/admin/analytics"` for a browser screen.
`Routes.Admin.ANALYTICS` is `"/admin/analytics"` for a Spring controller. They
are unrelated — one is a URL the browser *shows*, the other is a URL the browser
*fetches* — and a text census cannot tell them apart. `AdminTopbarTools.jsx`
alone contributes nine more of these as command-palette entries.

`AdminAnalytics.jsx:3` reads its numbers from `lib/mockApi.js`. `GET
/admin/analytics` has no caller anywhere. The census said `wired`.

### The rule, and the check that it holds

A path counts as fetched only when something under `frontend/src/services/`
writes it, because that is where `http.js` and all 64 providers live.

That claim was tested before it was relied on. Four files outside `services/`
import `services/http.js`:

| File | What it takes |
|---|---|
| `context/AuthContext.jsx:6` | `NetworkError` |
| `hooks/useAsyncList.js` | (comment only) |
| `hooks/useConnectivity.js:40` | `NetworkError`, `observeReachability` |
| `lib/mockApi/team.js:24` | `ApiError` |

Not one builds a path. Nothing else in the tree imports the HTTP layer.

### Why a bucket and not a filter

Dropping these rows into `unreached` would have been the smaller edit and the
worse answer. "No caller at all" and "a screen exists, is routed, is in the
command palette, and does not use the endpoint" are different findings, and the
second is the more actionable one — it names the screen that should be doing the
fetching.

### The seven, and where each is already argued

| Route | Path | Recorded as |
|---|---|---|
| `Localities.ADMIN_BASE` | `/admin/localities` | item 24 |
| `Localities.ADMIN_BY_SLUG` | `/admin/localities/{slug}` | item 24 |
| `Reels.BASE` | `/reels` | item 1 |
| `Content.SERVICES` | `/services` | item 26 |
| `Moderation.ADMIN_ENQUIRIES` | `/admin/enquiries` | item 25 |
| `Admin.FINANCE` | `/admin/finance` | item 20 |
| `Admin.ANALYTICS` | `/admin/analytics` | **not recorded** |

Six of seven already have an argued item, which is the outcome the triage of the
unreached list was written to make checkable: a row without a matching item means
something was missed. `Admin.ANALYTICS` is that row.

`AdminAnalytics.jsx` is partly ported already — `SupplyGapTab` reads
`GET /admin/supply-gap` through `demandService`, and its own header says so — while
the other seven tabs read `getAnalytics` out of `lib/mockApi.js` via the seven
files under `lib/data/analytics/`. So the screen is not un-ported; it is
half-ported, and the half that is not has a server route sitting unused. That is
a register item, not a sweep, and it is not written here because the shape of
`GET /admin/analytics` (one metric bucketed over a date range) has to be compared
against seven tabs of client-computed series before anyone can say whether the
port is a rename or a rewrite.

> **Corrected the same day — see register item 36.** The comparison was done, and
> the framing above is wrong twice. It is not "half-ported": six of the nine
> `lib/data/analytics/` modules generate their numbers from `rng(424242)`, a
> seeded LCG in `analytics/internals.js:7`, so there is no data behind them to
> port. And the endpoint is not "the half that is not": `GET /admin/analytics`
> serves `listings`, `users`, `deals` and `revenue`, and not one of the eight
> tabs charts any of them. The endpoint and the tabs are about different things,
> so the port is neither a rename nor a rewrite — it is two unrelated gaps that
> happened to share a URL. Item 36 also records the trap this note missed: the
> `getAnalytics()` call at `AdminAnalytics.jsx:35` sits above the `!analytics`
> loading gate at `:59`, so deleting `mockApi.js` hangs the whole page including
> Supply Gap, the one tab that works.

### Limitation, unchanged

`documented` still attaches to whichever route a comment happened to name rather
than to the feature the comment is about. Adding `ui-only` does not touch that;
it is recorded here so the next reader does not assume the two limitations are
the same one.

## Every `mockApi.js` importer, and what has to be true before it can go (D227)

`frontend/src/lib/mockApi.js` is the last file of the migration (P5c). It cannot be
deleted while anything imports it, so the useful question is not "how many importers
are left" but "is any of them unaccounted for". This is that check, run to exhaustion.

Thirty-seven import sites, from
`git grep -rn "from '.*mockApi.js'" -- frontend/src`, minus the four that are the file
itself, its own submodules or dead-comment references (`lib/mockApi.js`,
`lib/data/support.js` — which carries a comment recording an import that "stood here and
was never used" — and the two mock provider trees, excluded because they are the thing
being retired).

### The table

| Importer | Takes | Blocked on |
|---|---|---|
| `main.jsx` | `ensureMockDb` | **last** — this is P5c itself |
| `components/ServiceLanding.jsx` | `createServiceRequest` | guarded mock branch by design |
| `pages/consumer/Services.jsx` | `createServiceRequest` | guarded mock branch by design |
| `.../rent-agreement/useRentAgreement.js` | `createServiceRequest` | guarded; item 21 |
| `pages/consumer/StaffLogin.jsx` | `getTeamMemberByMobile` | argued in place |
| `pages/admin/AdminPostOnBehalf.jsx` | `logStaffActivity` | argued in place |
| `components/layout/AdminTopbarTools.jsx` | `rawDb` | item 22 |
| `components/ui/InternalNote.jsx` | `addInternalNote`, `getInternalNotes` | item 29 |
| `pages/admin/AdminReports.jsx` | ~~`addInternalNote`~~ | **gone (`2884c61`)** — see correction below |
| `pages/admin/AdminContent.jsx` | ~~`listReviews`, `mutateDb`, `archiveRecord`, `restoreRecord`, `addInternalNote`~~ | **gone (`38c33a7`)** — item 30 |
| `lib/data/reports.js` | `mutateDb` | item 30 |
| `pages/admin/AdminSettings.jsx` | `logAudit`, `listAudit`, `clearAudit` | item 18 |
| `pages/admin/AdminSocieties.jsx` | ~~`logAudit`~~ | **gone (`2884c61`)** |
| `pages/admin/AdminLocalities.jsx` | ~~`logAudit`~~ | **gone (`2884c61`)** |
| `pages/admin/properties/DuplicatesTab.jsx` | ~~`logAudit`~~ | **gone (`2884c61`)** |
| `pages/admin/AdminEnquiries.jsx` | `listDeals`, `listEnquiries`, `listVisits`, `logAudit` | items 18, 25 |
| `pages/admin/enquiries/helpers.js` | `mutateDb` | item 25 |
| `pages/admin/AdminProperties.jsx` | `setPipelineStage` | item 27 |
| `pages/admin/properties/PropertyReviewModal.jsx` | `setPipelineStage` | item 27 |
| `.../dashboard/MyListingsPanel.jsx` | `sendWhatsappTemplate` | item 28 |
| `lib/store/referrals.js` | `mutateDb`, `rawDb` | item 31 |
| `lib/data/managedProperty.js` | `mutateDb` | **not item 32** — `owner-hub.spec.js` AC3/AC6 assert this write |
| `lib/geoConfig.js` | `rawDb` | item 35 — needs a public `GET /geo`, exactly as flags needed `GET /flags` |
| `context/CityContext.jsx` | ~~`syncGeoFromDisk`~~ | **gone (`67d872d`)** |
| `pages/admin/AdminAnalytics.jsx` | ~~`getAnalytics`~~ | **gone (`8315274`)** — see correction below |
| `lib/data/analytics/internals.js` | `rawDb` (re-export) | item 36 |
| `lib/data/finance-admin.js` | `rawDb` | item 20 |
| `pages/admin/AdminFinance.jsx` | ~~`getSettings`~~, `rawDb` | `getSettings` moved to `settingsService` (`67d872d`); `rawDb` is item 20 |
| `lib/store/billing.js` | `rawDb` | **not item 20** — `rent-agreement.spec.js:233` asserts this merge |
| `pages/admin/AdminDashboard.jsx` | `getAnalytics`, `getSettings`, `listEnquiries`, `listVisits`, `listTickets`, `listDeals`, `listUsers` | argued in place (`01a69e2`) |
| `lib/chat.js` | `rawDb` | dies with its own file |
| `lib/serviceFlow.js` | `logStaffActivity`, `syncServiceTicket` | dies with its own file |
| `lib/data/ownerIdentity.js` | `rawDb` | dies with its own file |
| `lib/data/propertyIdentity.js` | `rawDb` | dies with its own file |
| `lib/data/properties-admin.js` | `rawDb`, `mutateDb`, `archiveRecord`, `restoreRecord` | dies with its own file |

### Nothing is unaccounted for

Every row lands in one of four buckets:

1. **A register item** — 25 rows, spanning items 18–36. These need a decision, not code.
2. **Argued in place** — 3 rows, each carrying a comment in the file explaining why the
   mock call stays for now (`AdminPostOnBehalf`, `StaffLogin`, `AdminDashboard`).
3. **A deliberate mock branch** — 3 rows, where the live path exists and the mock call is
   the other side of an `isHttpDomain` gate.
4. **Mock infrastructure** — 5 rows that are not screens at all. `lib/chat.js`,
   `lib/serviceFlow.js`, `lib/data/ownerIdentity.js`, `lib/data/propertyIdentity.js` and
   `lib/data/properties-admin.js` exist to serve the mock providers, and their consumers
   are almost entirely under `services/providers/mock/`. They are deleted *with*
   `mockApi.js`, not before it, and they need no decision.

Plus `main.jsx`, which is the deletion.

### The check that was worth running, and what it caught

Bucket 4 was the one worth verifying rather than assuming, because a library that serves
the mock providers is exactly the kind of thing that quietly acquires a live consumer.

`lib/data/properties-admin.js` looked like it had three: `propertyReviewService.js`,
`providers/http/propertyReviewMapper.js` and `providers/http/propertyReviewProvider.js`
all name it. Every one of the three is a **comment** —
`propertyReviewMapper.js:4` "The mock this replaces lives in `lib/data/properties-admin.js`",
`propertyReviewProvider.js:13` "Replaces the `db.propertyReviews` half of ...",
`propertyReviewService.js:131` "Replaces `properties-admin.js#reviewUnread(id, who)`".
Not one is an import. No live provider imports mock-backed code anywhere in the tree.

That is the same false positive the route census had, in a different tool: a text match
credited prose as though it were a call. It is worth naming twice because the two were
found independently and the second was found only because the first had just been fixed.

### What this table is not

It is not a plan and it is not an ordering. Items 18–36 are unanswered questions, and the
answers may merge rows, delete rows, or turn a row into three. What it establishes is
narrower and load-bearing: **there is no importer of `mockApi.js` whose fate is unknown.**
When the last register item is answered, the file goes; nothing else is hiding behind it.

### Correction: one row was blocked on less than it claimed (D228)

The table said `pages/admin/AdminAnalytics.jsx` was blocked on register item 36, and item 36 is
a genuine product question — seven of eight analytics tabs are a seeded PRNG, and the server's
`GET /admin/analytics` charts four metrics no tab asks for. Both true. Neither was what held
that import in place.

`getAnalytics()` returned `db.json`'s `analytics.sources`: five rows, `Organic search 38 /
Direct 22 / WhatsApp 16 / Social 13 / Paid ads 11`. Nothing writes it, nothing derives it, and
it feeds exactly one doughnut — between two charts whose numbers are hardcoded inline in
`TrafficTab.jsx` and which have carried a `Sample` chip all along. The page held all eight tabs
behind `if (!analytics) return <Loading />;` waiting on a localStorage read for that.

Moving the constant to `analytics/constants.jsx` and giving its card the same `Sample` chip its
neighbours already had retires the importer without touching what any tab shows, and without
answering item 36. Done in `8315274`.

**What generalises.** The table's third column is the *reason a row is still here*, and one row
had the wrong reason — plausible, adjacent to the truth, and larger than the truth. The row sat
next to `lib/data/analytics/internals.js`, which really is blocked on item 36: its `rawDb`
re-export feeds six analytics slices and every PRNG tab. Two rows, one register item, and only
one of them meant it. So the number that matters is not how many rows are left but how many
have been *checked* rather than classified by proximity — and until this correction, that
number was unknown for at least one row.

The other twenty-four register-item rows have not been re-checked against this. That is the
open work this correction creates, and it is cheap per row: read what the import actually takes
and ask whether the register item is load-bearing for *that symbol* or merely true of the
screen around it.

Item 36 itself stays open, untouched and unanswered.

### The re-check the last correction asked for, and what it cost to be wrong three times (D229)

The D228 correction ended by saying the other twenty-four rows had not been checked
against their stated reason, and that the check was cheap. Three research passes over
twenty of them found **seven rows misclassified**. Six importers are now gone
(`2884c61`, `67d872d`). The interesting part is not those six. It is that of the four
rows the same passes called *provably dead reads*, **three were refuted by the test
suite within minutes of being acted on.**

#### The six that were genuinely misclassified

| Row | Was filed under | Actually |
|---|---|---|
| `AdminSocieties.jsx` (`logAudit` ×10) | items 18, 19, 34 | 19 is `societyForListing` on the *property* page; 34 is `society_follows` on the *consumer* dashboard. Neither names this symbol. |
| `AdminLocalities.jsx` (`logAudit` ×2) | items 18, 24 | 24 is the curation *queue*; `logAudit` is one line downstream of the decision. |
| `DuplicatesTab.jsx` (`logAudit` ×2) | items 18, 23 | 23 is owner-side dedup in `list-property/submit.js`. Shares the word "duplicate" and nothing else. |
| `AdminReports.jsx` (`addInternalNote`) | items 29, 30 | The note was already sent to the server on the line above, via `triageReport` → `ReportService.triage:203`. 30 is the *review* queue. |
| `CityContext.jsx` (`syncGeoFromDisk`) | item 35 | The function returns `false` on its first line whenever `DISK_OFF`, i.e. in production and under Playwright. |
| `AdminFinance.jsx` (`getSettings`) | item 20 | `services/settingsService.js` has exported a live `getSettings` all along; `AdminSettings.jsx` already imported it from there. |

None of items 18–36 was answered to remove any of them. The pattern in every case:
**the register item was true of the screen and not of the symbol.**

#### The three refutations, which matter more

Three further rows were argued to be dead reads on the strength of reading the source
and the seed data. All three arguments were internally sound. All three were wrong.

**1. `lib/store/billing.js` — `getFees()`'s `rawDb()` merge.**
The argument: `db.json:7076`'s seeded `settings.fees` is byte-for-byte identical to the
`FEE_DEFAULTS` constant ten lines above, and the only writer now goes to
`PUT /admin/settings`, so the merge can never change a value.
The refutation: `e2e/tests/consumer/services/rent-agreement.spec.js:233`, *"platform
service fee is driven by the admin Fees panel, not hardcoded"*, writes
`db.settings.fees.rentAgreementPlatform = 777`, reloads, and asserts `₹777` and `₹1,777`.

**2. `lib/data/managedProperty.js` — the `mutateDb` at L164.**
The argument: the managed-property store is this file's own `puneNestManagedProps:<mobile>`
key; the single `mutateDb` writes `db.listings`, which is a different object, and
`addUserListing` on the next line already records the listing for the owner.
The refutation: `e2e/tests/consumer/account/owner-hub.spec.js` asserts that write from
both sides. AC3 reads `db.listings` and requires the property to be **absent** before
publish; AC6 reads it again after clicking **Publish as listing** and requires
`status: 'pending'`, `visibility: 'public'`. The line is the subject of a paired
presence/absence assertion, which is the strongest form of "this is load-bearing."

**3. `lib/geoConfig.js` — `readGeoSettings()`'s `rawDb()`.**
The argument: `db.json:7124` seeds `{enforceCityLimit: true, cities: {}, blacklist: []}`,
which is observationally indistinguishable from `{}` at all six readers — `getActiveCityGeo`
falls through to `CITY_GEO`, `enforce = geo.enforceCityLimit !== false` is true for `{}`
too, `cityLiveFrom` falls to `CITY_GEO[name].live`, `getBlacklist` short-circuits on an
empty list. So replace the read with a module-level cache and drop the import — which is
also item 35's own recommended option 1.
The refutation: `e2e/tests/platform/city-propagation.spec.js:14` writes
`db.settings.geo.cities[c] = { live: true }` and reloads; three of the file's four tests
go through it. And the fix is worse than the diagnosis suggested — with the read gone,
the helper can only reach the cache through a setter exposed on `window`, which is a test
backdoor in shipping code.

`geoConfig` is therefore **still item 35, and the template for answering it is already in
the tree.** `AppFlagsContext.jsx` faced the identical problem for `settings.flags` — admin
writes going to the server while the only reader was a browser copy — and it was solved by
publishing a *public* route, `GET /flags`, precisely because the consumer needs the block
and `GET /admin/settings` is admin-only in both directions. Geo needs the same route and
the same context, and then `city-propagation.spec.js` drives it the way the flag specs
drive theirs. That is a backend contract change and stays the user's call.

#### What generalises

**A seed value equal to the default proves the read is a no-op for the seeded state. It
says nothing about states a caller can reach — and `e2e/` is a caller.** All three
refutations came from the same place: a spec that sets up a state by hand, exercising a
path no amount of reading the seed data reveals. Two of the three arguments explicitly
enumerated the writers and got the list right; what they missed is that a test is a
writer.

The operational form of this: **before deleting a read, grep `e2e/` for the key it reads,
not just `src/` for the functions that write it.** That check would have cost one command
and caught all three.

Second, smaller: **"smallest change" is not the same as "safe change."** The `geoConfig`
edit really is about eight lines. Those eight lines force a `window` setter into
production code, which is a larger commitment than the endpoint it was trying to avoid.

#### Bookkeeping fixed at the same time

- `lib/data/reports.js` was listed as blocked on item 30 (the review-moderation queue).
  It is the mock abuse-report seed, read only by `providers/mock/reportProvider.js:21`,
  and it dies with the mock provider. Line 2952 of this file had it right; line 3653 did
  not. The row belongs in bucket 4, and this note is the correction.
- The paragraph above stating that "`DuplicatesTab.jsx` and `AdminPostOnBehalf.jsx` keep
  their `logAudit` lines for that reason" is **stale in both halves**: `AdminPostOnBehalf`'s
  was already gone when it was written, and `DuplicatesTab`'s went in `2884c61`.
- `AdminContent.jsx` was filed under items 26, 29 **and** 30. Only one clause of one of
  them blocks it: `ReviewResponse.java:21` carries no `status` field, so `GET /admin/reviews`
  cannot drive the `r.status !== 'published'` render. Item 26 is a missing tab entry in a
  `TABS` array whose endpoints are already wired; item 29's `review:` notes are write-only.
- `AdminEnquiries.jsx` is load-bearing on item 25 for `listEnquiries`/`listVisits`/`listDeals`
  only. Its single `logAudit` is a separable passenger kept because the import survives anyway.
- `AdminSettings.jsx` is not a candidate at all: it **is** the reader item 18 defers, and its
  **Clear log** button has no live counterpart and must never acquire one, since the server's
  audit table is append-only. Removing an operator-visible control is a product decision.

#### Where the count stands

Six importers retired, none by answering a register item. Three more examined and
returned to the table with sharper reasons than they had. Item 18 — the audit-log
reader — is the only one that moved in substance, and only in the sense that fourteen
writes which could never have reached `/admin/audit-log` no longer pretend otherwise.

---

## D230 — the moderation queue's missing field, an optimistic toast, and three tests of pages that no longer exist

Three commits, one theme: each one is a place where the code said something that
was not true, and nothing was checking.

### `48386b2` — `ReviewResponse.status`

Register item 30 named this as "the only real decision in the item" and
recommended option (1). Reading the code confirmed the recommendation, so it was
a DO rather than a question held for review.

`GET /admin/reviews` returned a mixed-status list in which nothing distinguished
a live review from one already taken down. The endpoint's own Javadoc calls the
unfiltered call the useful one — "everything, newest first, which is how a
moderator finds a review nobody has reported yet" — and that mode did not work.
The `?status=` filter was a workaround for a missing field that was never
recognised as one.

`status` is now a NON_NULL component on `ReviewResponse`, populated only by a new
`ReviewMapper.toModerationResponse`. A second mapper method rather than a boolean
parameter: a flag would have put the decision at each of five call sites, whereas
`@Mapping(ignore = true)` on the public method means it *cannot* emit the field
and the compiler checks that, not a reviewer.

Follows the `PropertyResponse.adminPipeline` precedent (FINDING 5) exactly.

**Correction carried in that commit:** `SpecEnumParityTest` **does not exist**.
It was named in several session notes alongside `SpecCoverageTest` and
`SpecSchemaParityTest` as though all three were real. `file_search` for
`**/SpecEnum*.java` returns nothing. It survived undetected because
`-DfailIfNoTests=false` makes a misspelt class name a green exit — the flag that
makes a targeted run convenient is the same flag that makes a typo invisible.

### `c3ea034` — the WhatsApp reminder toast

`MyListingsPanel.jsx` toasted "WhatsApp reminder opened" whether or not anything
opened. `sendWhatsappTemplate` composes its URL from `db.listings.find(...)` in
the mock store, but this screen's listings come from the server
(`lib/data/myListings.js:108`), so in a live build it returns `null`, no window
opens, and the toast fired anyway.

The saved bug's exact shape, for the fourth time: **an optimistic control makes a
failed write invisible.**

### `fbbfd18` — three standing failures

The full mock suite had been finishing 841/844. All three failures were tests of
consoles this build deliberately no longer has:

| Test | Drove | Now |
|---|---|---|
| `agreement-evidence.spec.js:47` | `/ops/flatmate-review` | live-only, `OpsFlatmateReview.jsx:51` |
| `agreement-evidence.spec.js:83` | `/ops/flatmate-review` | same |
| `loans-team.spec.js:31` | `/admin/services` | live-only, `AdminServices.jsx:281` |

The assertions moved to `live-flatmate-moderation.spec.js` and
`live-admin-services.spec.js`, where they run against the API. What stayed is the
half a mock build can answer, which is also the half carrying the product claim:
the badge is withheld until somebody else grants it, and a home-loan request is
created against `loans` and not `legal`.

Each file gained a **new** test asserting the notice itself, plus a negative that
the removed control has count 0. Both pages argue in their own source that an
empty queue would be indistinguishable from a cleared backlog — and neither claim
had a test until now.

### Three lessons

**A failure that is not yours is worth *proving* not yours.** `git stash` the one
uncommitted change, re-run, compare. It turns "probably unrelated" into a line in
the commit message, and it took under a minute.

**When N tests in a file fail and one passes, the passing one is the
discriminator.** `agreement-evidence.spec.js:72` was the only test in that file
that never visits `/ops/flatmate-review`, which localised the fault to that page
before a single component was opened.

**A permanently-red test costs more than it looks.** Not the test — the attention
it spends from every future reader, who learns to scroll past red. Three known-bad
lines is how the fourth, real one gets scrolled past too.

### Coverage table delta

No importer retired. `AdminContent.jsx` is **unblocked on the server side**: item
30's server half shipped in `48386b2`, so the remaining work there is purely
frontend — point the Reviews tab at `reviewService`, add `status` to
`reviewMapper.toViewModel` (it currently drops it), and delete the Archive and
Restore buttons, which item 30 recommends and which `ReviewModerationController`'s
own Javadoc argues against as "a second, weaker notion of 'taken down' that the
aggregate did not honour".

Count stands at **31**.

---

## D231 — the moderation tab was deciding reviews in localStorage on a live build, and looked normal doing it

`7b7c006` closed the coverage debt. This closes register item 30, the last thing
on `/admin/content` that was still browser-side, and retires the whole
`AdminContent.jsx` importer: **31 → 30**.

### The failure this fixed is not an error

`AdminContent.jsx`'s Reviews tab read `db.reviews` out of `localStorage` and wrote
back to it. On a live build the tab rendered a hand-seeded fixture list bearing no
relation to the reviews real users had written, and Approve wrote a verdict into
the browser that no server ever saw.

Nothing about it looked broken. The rows had names, the badges had colours, the
buttons responded, the toast said "Approved". A moderator would have worked that
queue for a full shift and changed nothing, and the reviews they thought they had
taken down would still have been on the property page. That is worth naming as a
class: **a console that agrees with you is more dangerous than one that errors**,
because the error at least ends the shift honestly.

### Two service methods, one of which is a second mapper

`listReviewsForModeration` and `setReviewStatus` on `reviewService`, both providers
implementing them, so the seam's rule — no page knows which provider is live —
survives.

`toModerationViewModel` is a **second mapper method rather than a flag on
`toViewModel`**, mirroring `ReviewMapper.toModerationResponse` server-side and for
the same reason: `status` is a constant on every public read, because every public
read filters on it. A shared mapper carrying it would hand the consumer surfaces a
field that can never vary and invite a branch on something with one value. That is
now the second time this session the same argument decided the same way (the first
was `48386b2`'s NON_NULL omission), so it is worth stating as a rule:

> **A field that belongs to exactly one call site gets a second method, not a
> boolean parameter.** The parameter costs every other call site a decision it
> does not have.

It also composes `target` client-side from `targetType` + `targetId`. The wire keeps
them separate, which is right for a machine and wrong for a moderator scanning a
table — they have to know *what* is being reviewed before they can judge whether the
review is fair.

### Archive and Restore were deleted, and the server had already written down why

Item 30 recommended it; `ReviewModerationController`'s Javadoc had argued it before
the console was even looked at:

> Adding an `archived` column … would have created a second, weaker notion of
> "taken down" that the aggregate did not honour — the review would vanish from the
> page while still dragging the society's rating down.

That is exactly what the console offered. A moderator who archived a review would
have hidden it from their own table and left the rating it produced standing —
the precise thing they archived it to prevent. `rejected` is the one verdict that
does both, and the live spec proves it: the rejected review leaves
`GET /properties/{id}/reviews`, which is where the aggregate comes from.

**This deletes a user-visible control.** Three of them, in fact — Archive, Restore,
and the `window.prompt` internal note — plus the whole "Archived reviews" table.
Recorded here rather than only in the commit, because the standing rule is that
removing a control is a product change even when a register item authorised it.

The internal note went for the reason `AdminReports.jsx` lost its own in `2884c61`:
it wrote into a browser-side log this console was also the only reader of. The live
route takes an optional `reason` that reaches the audit log, which is a real record —
but wiring a prompt to it would re-add a control whose output nobody can read from
the product. **A write with no reader is not a feature, it is a receipt the customer
never gets.**

### The write is not optimistic, on purpose

`decide()` awaits the PATCH before touching state and restores the previous list on
failure. Same lesson as `c3ea034`'s honest toast: an optimistic row makes a refused
write invisible, and on this screen invisible means a moderator believing a review is
down while it is up.

### `listReviews` deleted; `db.reviews` deliberately kept

`collGetter('reviews')` had exactly one caller and a clean `e2e/` grep, so it went.
`db.reviews` itself survives, because the **mock** review provider now serves the
queue from it through `rawDb()` — the alternative is a mock build whose moderation
tab is empty and whose e2e coverage has nothing to assert on. That store is a fiction
(rating a locality on the mock build appends to `pnEntityReviews` and will never
appear on this queue) and the provider's header says so rather than pretending
otherwise. It ends when `mockApi.js` does.

Note for the importer table: `services/providers/mock/reviewProvider.js` now imports
`lib/mockApi/core.js`. That is a **seam-internal mock provider, not a page**, and is
the expected shape — the table counts pages that reach around the seam, and this is
the seam's own far side.

### Coverage

Five new tests in `e2e/tests/live-admin-content.spec.js`, which already owned the
console's API-level coverage:

- the queue is served by `GET /admin/reviews` and carries `status`, which no public
  read does;
- the queue is closed to consumers and to the public;
- `pending` is an intake state, not a verdict the route accepts (400) — the two
  buttons are the whole vocabulary because the API's is;
- the console reads the live queue, naming *this run's* author, and Archive/Restore/
  "Archived reviews" are asserted absent **paired with a positive** assertion that the
  actions column rendered, so absence cannot pass because the tab failed to load;
- rejecting from the console reaches Postgres (proven by a reload, not by the
  in-place state update) and the review leaves the public read — then is put back,
  because the seeded row is shared.

**Verified:** lint 0 errors / 372 warnings (baseline) · `vite build` exit 0 · live
`live-admin-content.spec.js` 10 passed (27.1s) · mock `tests/admin` 154 passed (3.9m),
with `consolidation.spec.js`'s Reviews-tab test unchanged — which is the point of
implementing both providers rather than making the tab live-only.

Commit: **`38c33a7`**. Register item 30 marked RESOLVED.

### Deliberately not done

No paging controls (the queue reads 100 and the table pages client-side, as before —
real paging is worth adding when a real backlog exists). No `reason` field on Reject
(needs a reader first). No status filter control, though the service passes the
parameter through, because inventing UI is not what this change is.
