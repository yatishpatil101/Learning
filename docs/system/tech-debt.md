# PuneNest Backend — Tech-Debt Register

**Status:** living document, and the **single source of truth for outstanding backend work**.
**Nothing here is scheduled until the backend feature slices are complete.** This is the parking
lot: the place a deliberate shortcut goes so it stops being a thing someone has to remember.

**Companion doc:** items that need a *human decision* rather than engineering time live in
[`open-questions.md`](./open-questions.md). The split is deliberate — mixing "we know what to do,
we haven't done it" with "we don't know what we want" makes a register unactionable, because you
cannot pick up the top item and start.

**Why this file exists.** Deferred items were accumulating inside `tasks/todo.md`, interleaved with
per-slice plans and RESULTS blocks across 2,600+ lines. That file is a *worklog* — chronological,
append-only, correct for "what happened in slice 6". It is the wrong shape for "what do we still
owe", because answering that meant grepping nine `### Deferred` headings and reconciling them by
hand. This register is the answer to that question, and it is the SSOT for it.

## Rules

1. **An entry needs a reason, an owner and a trigger.** "Deferred" with none of those is not debt
   management, it is forgetting with extra steps.
2. **Debt is deliberate.** A bug is not debt — fix it. Debt is a shortcut we would take again given
   the same information, and would not take with more time.
3. **A finished item is deleted, not archived.** Once the work is done and the reasoning lives
   somewhere it will actually be read — a Javadoc, a comment beside the code, a test that fails if
   the rule is broken — the register entry has no remaining job and is removed outright. *This
   reverses the original rule*, which kept a "Closed" table so nothing "quietly stopped being
   mentioned". That was the right instinct aimed at the wrong risk: a register nobody finishes
   reading is its own failure mode, and by 2026-08-07 the closed section was longer than the open
   one. Git history is the archive. **Two things are still never deleted:** a *ruling* (§2 — a
   settled "no", which exists precisely so it is not re-raised), and any closed item whose lesson
   has no home in code.
4. **Numbers are never reused.** Deleting D19 does not free D19. New debt continues from the
   highest number ever issued, so a reference in an old commit or comment can never resolve to a
   different item than it meant.
5. **This file does not schedule work.** When a slice picks an item up, it goes into `tasks/todo.md`
   as a checkable plan item; the entry here is deleted when that work lands.
6. **Per-slice RESULTS blocks stay in `tasks/todo.md`.** Only the *carried-forward* residue lands
   here, and it lands here **once** — no duplicate bookkeeping in two files.
7. **If it needs a decision, it is not debt yet** — it goes to `open-questions.md` and returns here
   once answered. An item blocked on "what do we actually want?" will never be picked up from a
   backlog, because the person reading the backlog is not the person who can answer it.

---

## 1. Open register

**71 open** — 1 High, 38 Med, 32 Low. Largest clusters: `design` 28, `frontend` 9,
`security` 6. Highest number ever issued: **D181**; numbers are never reused
(rule 4), so the 110 gaps in this list are deleted items, not mistakes.

> **Counting this table by hand or by a naive script gets it wrong**, and has for months. Two traps:
> rows contain escaped pipes (`hasListings() \|\| …`), so splitting on `|` shifts every later column
> and silently mis-reads the priority; and the High rows are *also* listed in the summary above,
> with fewer columns, so counting row lines double-counts them. Unescape first, and prefer the
> 7-column row for any id that appears twice. A third, smaller trap: D84's escaped pipe lands
> mid-priority so it parses as `daily\`; its true value is Low, and the figure below counts it as
> one. The figures above satisfy 1+38+32 = 71 and
> 71 + 110 gaps = D181, which is the check that they hang together.

> **The count above was wrong for months and is now derived, not asserted.** The header claimed
> "60 open" while the table held 78 rows — every pass edited the prose and not the arithmetic, so
> the one number a reader takes at face value was the least trustworthy thing here. Recount before
> editing it:
>
> ```powershell
> $l = Get-Content docs/system/tech-debt.md
> $s = ($l | Select-String '^\| # \| Item \| Area \| P \|').LineNumber
> $e = ($l | Select-String '^### Detail on the ones').LineNumber
> $rows = $l[$s..($e-1)] | Where-Object { $_ -match '^\| D\d+ \|' }
> $rows.Count
> $rows | ForEach-Object { ($_ -split '\|')[-3].Trim() -replace '\*','' } | Group-Object | Sort-Object Count -Descending
> ```

**The one High item is blocked on something other than effort** — which is the single most
useful fact about this list:

| # | What it needs |
|---|---|
| D67 | *decided — wire it.* Now blocked on slice capacity, not on a question |

> **API-polish pass (pre-integration).** The backend was reviewed end to end before frontend
> integration started. Five defects were found and fixed rather than recorded — they were bugs, not
> debt (rule 2): the 400 handler echoed Jackson's message verbatim, 405/415 were being swallowed into
> 500s by the catch-all, `server.servlet.context-path=/api` was documented everywhere and set
> nowhere, `punenest.web.cors.allowed-origins` was unset in prod, and the foundation-field rule
> covered five of the seven search facets, so an approved listing could be relabelled "furnished" or
> "ready to move" without re-moderation. Four endpoints were added (`listPropertyRooms`,
> `updateSavedSearch`, `listListingBoosts`, `listReviewsForModeration`) and four reads paged. Suite:
> 705 → 733 tests, green. The pass also *created* five new entries — D76–D80 below — because several
> fixes revealed adjacent problems that were out of its scope.

**Actionable today without any decision** — the honest short list is now short.
**D46**, **D49** and **D60** are one-liners, but each of the three is explicitly waiting on a
consumer that does not exist — an unassign gesture, a message attachment, a share channel — and
building the field before the caller is how the register filled up with `settings.permissions`
(D67). The remaining no-decision items are **D95** (one verify-funnel spec), **D96** (50 specs onto
the shared console helper), **D97(d)** (ops cannot see flatmate rooms — the one with a user-visible
consequence) and **D33** (trim the `@param` ceremony).

> **Debt pass, 2026-08-07.** Nine items closed: D90, D82, D19, D22, D83, D86, D97(d), D95, and the
> durable half of D33. Every fix was mutation-tested — the fix reverted, or damage deliberately
> planted, and the test watched to go red — because in each case a green assertion could have meant
> nothing.
>
> **Four of the nine were filed with the wrong size or the wrong cause**, which is the most useful
> pattern here: *the register's own numbers were the least reliable thing in it.* D19 said "7 files,
> cosmetic" and was 22 files including mangled rupee signs in live prices. D96 said "50 specs filter
> nothing" and was 9. D97(d) said "rooms are invisible" when ops could see nothing at all. D33 said
> 562 `@param` and it is 673. **Measure before scheduling, and re-measure before deleting.**
>
> Findings worth more than the items themselves:
>
> 1. **A `@Transactional` test harness cannot see a bug that happens at commit time.** D90 survived
>    750 tests because every HTTP test extends a rolling-back base class, and the defect was a
>    failing commit. The guard had to be written *outside* the harness that hid it.
> 2. **Detect by round-trip, not by a list of known-bad patterns.** The first D19 repair script used
>    a hand-built map and missed two whole families nobody had grepped for. A table can only ever fix
>    the damage somebody already noticed.
> 3. **A mock more permissive than its server passes tests the real thing would fail** (D97d).
> 4. **A mutation test caught a bad assertion, not just a bad fix.** The D95 one-shot-perk test
>    passed with the guard deliberately disabled: with no guard the perk moves to the *next* listing
>    rather than re-extending the first, so an assertion on the first listing's window could never go
>    red. Counting grants across the set can. An assertion that cannot fail is worse than no test —
>    it reads as coverage.
> 5. **Consolidating filters must merge them first.** The local console-noise lists were not subsets
>    of the shared one, so deleting them and pointing everything at `IGNORE` would have silently
>    *tightened* several specs. The shared list absorbed `gstatic`, `maptiler` and the React DevTools
>    banner first — but deliberately not bare `ERR_` or bare `maps`, which are broad enough to
>    swallow a real error.

> **D97(d) closed — and it was twice the item it was filed as.** The entry said "rooms are invisible
> to admin moderation". True, but the cause was broader: `AdminFlatmates` read `rawDb()` while
> **every** consumer flatmate flow writes localStorage, so ops could not see a single seeker, group
> **or** room a real user had posted — not just rooms. Worse, the second half was silent: nothing on
> the consumer side filtered `modStatus`, so *even the rows ops could see* were unmoderatable —
> "Remove" wrote a value no reader consulted and the post stayed on the board, while the page told
> the moderator that removed posts disappear.
>
> **The server was right the whole time**, which is what makes this a mock-fidelity bug rather than
> a product gap: `FlatmateRoomRepository`, `FlatmateGroupRepository` and `FlatmateSeekerPostRepository`
> filter `mod_status not in ('flagged','removed','rejected')` across nine queries, one commented
> *"the mod_status clause is not decoration: a flagged post must disappear"*. The mock now mirrors
> that set exactly (`MOD_HIDDEN` in `lib/data/flatmates.js`), the admin queue reads both stores and
> has a Rooms tab, and verdicts are written back to whichever store holds the row.
>
> **The filter went on the public board, not on the store getters.** `getRooms`/`getFlatmatePosts`/
> `getFlatmateGroups` have 31 call sites between them and the owner's own dashboard is one of them —
> an owner must still see a post that was taken down, with its status, rather than watch it silently
> vanish. Both halves are mutation-tested: drop the filter and the two "hidden" tests go red while
> the control stays green; revert the admin read and the visibility test goes red.
>
> **The lesson, which is bigger than flatmates:** a mock that is *more permissive* than the server it
> stands in for does not fail loudly — it silently passes tests the real thing would fail. Worth
> checking the other mock providers against their repositories for the same asymmetry.

**D36** (Spotless) is blocked on repo access, not on a decision. **D54** turned out to need more
machinery than its Low priority justifies — see its trigger. Everything else above the one-liners
now needs a product or infrastructure decision rather than an afternoon, which is the useful summary
of this list: **the backlog that could be worked around is worked; what is left is what was
deferred on purpose.**

`P` = rough priority. `T` = what unblocks it.

| # | Item | Area | P | Owner / Trigger |
|---|---|---|---|---|
| D4 | `CashfreePaymentGateway.createOrder` live HTTP | payments | Low | whoever obtains the merchant account |
| D7 | Saved-search alerting job writing `new_count` | engagement | Low | the scheduler now exists (`SchedulingConfig`, added for D57) — this is blocked on effort alone |
| D10 | Refresh-token pruning job | auth | Low | when the table grows |
| D11 | `role` / `status` as `String`, not enums | style | Low | — (deliberate, see §2) |
| D12 | Staff-login timing equalisation | security | Low | if staff enumeration becomes a concern |
| D13 | Scoped-staff `roleId` / `moduleAccess` | admin | Med | admin slice (needs spec + backend) |
| D15 | Notification preferences (R9) | engagement | Low | no table, no contract |
| D26 | Frontend derives trust client-side (`applyVerifiedBadgeToListings`, `isSeriousBuyer`) | frontend | Med | moot on `http` flip; live in mock mode |
| D30 | Owner-scoped mock stores keyed on owner **mobile**, not `ownerId` | frontend | Med | Phase 3/4 integration |
| D32 | ProfileTab identity chips are hardcoded English | i18n | Low | ProfileTab i18n pass |
| D33 | **~195 `@param` lines still restate their parameter in a synonym** — the 2026-08-07 pass amended `api-standards.md` §10 first (the durable half: without it they grow straight back) and deleted the **42** that are provably empty — pure name restatements and `(required)`/`nullable` suffixes that duplicate the annotation on the next line. **The remaining ~195 were deliberately not deleted.** The register's criterion was "≤4 words", and applied literally that removes genuinely useful lines: `@param orderId the provider's {@code order_id}` is four words and says which external field it maps to. A synonym (`@param title headline`) is a judgement call a regex should not make unsupervised. *Re-measured 2026-08-09: of the 670 remaining `@param` lines, **zero** are provably empty (name-restatement or bare `(required)`/`nullable`) — the durable pass took all of those. Every residual line carries units, an enum vocabulary, a default, a `{@link}` or a nullability semantic, so there is no risk-free bulk pass left; deletion stays per-line judgement per §10.* | quality | Low | by hand, per file, when that file is next edited — §10 now forbids adding more |
| D36 | **Formatter-first: Spotless owns layout, then reassess whether Checkstyle is worth keeping at all** — measured on the stored config (`backend/config/checkstyle/`, which carries the full baseline): **717 violations across 333 main-source files, of which only 12 (1.7%) actually need a linter.** 494 are layout a formatter fixes for free; 211 come from rules that contradict `api-standards.md` §10 and would have to be deleted. Enabling it as-is hands a human ~494 mechanical edits and finds zero bugs. The boundary third is already delivered by `ArchitectureBoundaryTest`, so this is a two-tool question, not three | build | Med | backend / blocked on repo access (Spotless is not in the offline repo) |
| D37 | **Service-split trigger: past ~450 lines, split by use-case, never by layer** — services top out at 405 lines and are trending up, so agree the rule now while it is free and nobody is defending a specific file. A `RentService` that grows becomes `RentBillingService` + `RentPaymentService`, never `RentServiceHelper`: a helper class named after its parent is a file split, not a design | architecture | Low | agree now, apply on the next service that crosses it |
| D41 | Deleting a document leaves its object in the store — needs a bucket lifecycle rule | storage | Low | with the real object store |
| D42 | **The document share token is still in the query string** — the leak paths that were closeable have been closed: `LogSafeUri` redacts `token` (and `access_token`, `code`, `signature`, `otp`) for any future request logger, the Tomcat access-log pattern is pinned to `%m %U %H` so it never writes a query, and `Referrer-Policy: no-referrer` is set chain-wide. What remains is the URL itself: browser history, bookmarks, proxy/CDN logs and the recipient pasting the link into chat all still see a 7-day reusable bearer credential. The fix is to stop putting it there — but the token must reach the server to be validated, so a `#fragment` design needs a **new contract operation** (`POST /documents/shared`, or an `X-Share-Token` header) plus an SPA route that reads `location.hash`, not an edit to the existing `GET`. **This is unusually cheap right now and gets expensive on a known date:** nothing in the frontend constructs a share link yet, so there is nothing to keep back-compatible. The day a share button ships, this acquires a 7-day compatibility window and a support tail | security | Med | before the first share button ships. Also tighten `frontend/netlify.toml`'s `strict-origin-when-cross-origin`, which sends the full URL including query on *same-origin* requests |
| D44 | **Service requests are not team-scoped** — `service_requests` has no `team` column and `type` is free text, so every ops user sees every request while tickets are desk-scoped. Inferring a desk from `type` would silently hide work the day a new type appears | design | Med | when the service catalogue is a closed vocabulary (Billing & Growth slice) |
| D45 | **A ticket and a service request do not mirror each other** — the ops board and the customer's workflow are two tables with no link, so ops working a request has to find the ticket by hand | design | Med | with the Services & Support slice (`/support-tickets`) |
| D46 | **`TicketUpdate` cannot unassign** — a record cannot distinguish an absent field from an explicit `null`, so `assigneeId: null` is read as "leave it". Needs a sentinel or a dedicated endpoint | design | Low | when ops asks for it |
| D49 | **`MessageCreate.attachments` is accepted and dropped** on both message surfaces, matching the `PropertyVerification` precedent. The wire field exists, the behaviour does not | contract | Low | when the frontend actually attaches files to a message |
| D51 | **The admin support queue has a server and no screen** — the paged `GET /admin/support-tickets` now exists (staff+admin, `PageResponse` envelope, server-fixed sort, `?awaitingReply=` filter, summary DTO carrying no thread, no mobile and no `notes`), backed by `staff_unread` and its partial index from V53. Nothing renders it. `AdminSupport.jsx` is **not** this screen — it is the ops board over `services.ticket.Ticket`, a different resource on a mock provider. Deliberately not half-built: a queue screen needs a real triage design, not a table bolted onto a working endpoint. `unwrapFullPage` will consume the envelope unchanged | frontend | Med | with the Admin & Analytics slice. Note `raiser` is a display name and may be null — the UI owes a fallback, which was deliberately not invented server-side |
| D52 | **The frontend models a conversation `state`** (`active`/`incoming`/`pending`) in `frontend/src/lib/chat.js` that the contract has no field for. The contract wins; the UI will need either a derived value or a spec change | contract | Low | when the React client is wired to the real API |
| D53 | **A conversation is not moderatable** — participants only, staff and admin included, so a reported chat cannot be read by anyone. Deliberate (a role check hidden inside the participant guard is how private surfaces quietly stop being private), but moderation will need its own audited endpoint | design | Low | when abuse reporting covers messages |
| D54 | **Find-or-create on a conversation races to a 409** — two simultaneous first messages produce one row and one unique-index violation. Downgraded from a 500 in slice 13: `GlobalExceptionHandler` now maps `DataIntegrityViolationException` platform-wide. The loser still does not get handed the existing thread, it just gets a truthful status | reliability | Low | when a client complains — but **not** by catching the violation and re-reading: a constraint violation dooms the JPA transaction, so the retry has to happen outside it (a `REQUIRES_NEW` helper bean or a controller-level retry), which is more machinery than a truthful 409 and a client retry are worth today |
| D55 | **`sameDevice` and `sameIp` on a referral are always false** — no device fingerprint is captured anywhere and the request IP is not recorded, so the two strongest self-referral signals are absent from the fraud desk. Reported as `false` rather than omitted because the contract requires the fields; an absent signal is safer than a fabricated one, but the desk is working blind on exactly the fraud it exists to catch | design | Med | when request-IP capture lands (needs a proxy-header policy first) |
| D56 | **The `qualified` referral status is never produced** — a referral goes `pending` → `rewarded`/`rejected`. `qualified` was meant to mean "the invitee did something real", but nothing tracks invitee activation, so staff approve on judgement alone | design | Med | when there is an activation event worth gating on (first listing, first lead, first payment) |
| D58 | **A service order has no status-advance endpoint** — `ServiceOrder.status` and `amount` can only change by direct SQL. Ops can take an order but cannot quote it, progress it or close it through the API | design | Med | with the ops back-office slice |
| D60 | **`Referral.channel` is derived from the referrer's role, not from how the link was shared** — there is no share-channel parameter on redeem, so the field describes the wrong dimension. Harmless until someone builds a report on it | contract | Low | when redemption carries a share context |
| D61 | **Referral farming is caught by humans, not by code** — one person with several mobile numbers can redeem repeatedly; only `uq_referrals_referred_mobile` and the staff fraud desk stand in the way. Deliberate: automated velocity blocks would reject genuine roommates and flatmates, which is the platform's most common referral. Revisit only with D55's signals in hand | design | Med | when the reward budget makes manual review too slow |
| D63 | **`payoutsCompleted` and `refunds` on `/admin/finance` are structurally zero** — no payout and no refund path exists anywhere on the platform (`payout_accounts` stores a destination and nothing writes a remittance). Reported rather than omitted so the figures move the day payouts ship instead of appearing from nowhere, but a finance screen showing four numbers of which two can never be non-zero invites the reader to trust all four equally | design | Med | with the payout execution slice |
| D64 | **Boost revenue is counted from `starts_at`, not from a payment record** — `BoostStatuses.EXPIRED` conflates "the window closed" with "the payment failed", so the status column cannot answer "was this paid". `starts_at` is set only by `activate`, which makes it the truthful marker today, but it is a proxy: the day a boost can be activated without payment, revenue silently overstates | reliability | Med | when boosts gain a comp/manual-grant path |
| D65 | **Service orders are excluded from platform revenue** — `service_orders.amount` is a quote, not a receipt, and the marketplace takes no money through the gateway, so counting it would report revenue the platform has not received. The consequence is that `/admin/finance` under-reports the moment the marketplace does start collecting | design | Med | when a service order has a payment path (see D58) |
| D67 | **`settings.permissions` and `settings.customRoles` are stored and never read** — the contract declares both, the settings endpoint round-trips both, and no guard anywhere consults either. Authorisation is `@PreAuthorize` on four fixed roles. An admin who edits the permission map will believe they have changed access control and will be wrong. **Decision taken 2026-08-07: wire it, do not remove it.** That settles the "wire or remove" trigger and makes this a scheduled slice rather than an open question — but it is a slice, not an afternoon: it needs a permission-resolution layer, the four role checks rewritten to consult it, and a migration for accounts whose stored map disagrees with their role. Until then the fields are still inert, so the settings screen must not render a permissions editor | security | **High** | **decision made — wire it**; needs its own slice (resolution layer + guard rewrite). Do not ship a permissions editor before it |
| D68 | **The abuse-report queue is absent from the admin dashboard** — `pendingModeration` counts `properties` awaiting a decision and deliberately does not fold in `reports`, because the two queues are worked by different people against different SLAs. The consequence is that the one scorecard ops looks at does not show the reports backlog at all | design | Med | when the dashboard grows a second queue tile |
| D69 | **The analytics series is computed on every request with no cache** — four grouped scans, up to 366 buckets, available to any staff account with no throttle beyond the bucket cap. Correct and cheap at today's data volume; the first slow morning will be this endpoint | performance | Low | when a table it scans passes ~1M rows |
| D70 | **A poster's only record of who answered is the notification stream** — the contract has no "who replied to my ad" endpoint and `share_flat_interests` is not readable over the API, so the sender's name and number exist for the poster only as a notification. Dismiss it and the lead is gone, with the row still sitting in the table | design | Med | when share-flat gets a second screen — needs a spec addition, so it could not be fixed inside the slice |
| D76 | **The owner-facing edit warning contradicts the server on what triggers re-moderation** — the dormant mirror `LISTING_FOUNDATION_FIELDS` in `lib/store/listings.js` was corrected 2026-08-10 to the server's seven searchable facets (`deal, locality, bhk, type, price, furnishing, construction`, per `ListingFoundationTest`), and its comment now cites that source — but the array has **no live consumer**. The warning the owner actually sees runs through `list-property/editPolicy.js` `classifyChanges`, whose Tier A/B model says the *opposite* of the server: `price`/`furnishing` sit in Tier B ("goes live instantly") while the server reverts both to `pending`, and `floor`/`facing`/`age`/`carpetArea` sit in Tier A ("re-check") which the server does not revert. So the live UI still tells the owner a price edit goes live instantly when it pulls the listing offline — the original defect, in a different file. **Now a product call, not an afternoon:** `editPolicy` deliberately models "edit stays live, flagged for re-check" whereas the server models "edit reverts to pending", and those are different UX contracts | frontend | Med | decide whether `editPolicy` Tier A/B should mirror the server revert set — belongs in `open-questions.md`; the `listings.js` mirror half is done |
| D79 | **`GET /properties/{propId}/reviews` cannot be paged while the client computes the rating summary** — ruling D8.6 permits the unpaged read because the per-target UNIQUE index bounds it, and the property page computes the star average, the 1–5 distribution and the per-category averages from the full list. The bound is real, so this is not urgent; recorded because "page everything" applied here would make three visible numbers silently describe page one. `ReviewRepository` already has the aggregate query if the summary ever moves server-side | design | Low | only if the aggregates move server-side |
| D80 | **`FlatmateRoomDto` is 47 fields, by a distance the largest DTO on the platform** — the next largest is `PropertySummary` at 22. It is returned by the room feed, the mixed flatmates feed and now `GET /properties/{id}/rooms`. Not wrong today (rooms per flat is naturally small, and the derived occupancy fields are the point), but a 47-field row is a DTO that has stopped being a view of anything and become the entity with a different name | design | Low | if the flatmates payload ever needs trimming — split the feed shape from the detail shape |
| D84 | **The alert switch is a boolean over a four-state server field** — `SavedSearch.alertFrequency` is `off\|instant\|daily\|weekly`, but the only control is an on/off `Switch`, so the seam derives `alerts = alertFrequency !== 'off'` and writes back `daily` when switched on. Currently unreachable loss (nothing can produce a non-default cadence), but the moment a frequency picker ships, a user holding `instant` who toggles off and on lands on `daily`. The seam carries `alertFrequency` explicitly so the fix is a UI change, not a contract change | design | Low | when a cadence picker is designed |
| D91 | **The verification queue still cannot be enumerated** — `PropertyReviewRepository` exposes only `findByPropertyId(UUID)`, so the maker-checker case files (`/properties/{id}/verification`) can be read and decided one at a time but never listed. `GET /admin/properties?status=pending` now finds the *listings* awaiting review, which is what the Verification tab renders, so the tab works; what is still missing is a list of open **review cases** with their checklists and threads. `ensureReview`/`decideReview` therefore stay on `lib/` for now — wiring the decision without the list would let ops decide a case they cannot find | design | Low | when the verification thread UI is wired — needs a paged finder + `GET /admin/property-reviews` |
| D94 | **Notification preferences have no server surface at all** — `getNotifPrefs`/`setNotifPrefs`/`inQuietHours` cover email/sms/whatsapp channels, a master `matchAlerts` switch, quiet hours and language, and every one of them lives only in localStorage. `ProfileTab.jsx` was deliberately not touched by the notification slice for that reason. The practical consequence is that quiet hours suppress *client-derived* alerts only — a server-written notification arrives at 3am regardless, because the server has never been told | design | Low | needs `GET/PUT /me/notification-preferences`; pair it with the D92 writers, which are what would have to honour it |
| D96 | **14 specs still carry a local console-noise filter or none at all** — the 2026-08-07 pass moved **31** onto `helpers/console.js` and merged every local pattern into the shared `IGNORE` first, so consolidating could not silently *tighten* a spec. What is left is the tail: `search-property-types.spec.js` keeps a self-contained `pageerror`-only helper, `live-property-integration.spec.js` was left alone as in-flight work, and ~12 specs assert on `pageerror` only. **The register's "50 of 67 filter nothing" was wrong** — measured, only **9** had a genuinely unfiltered `console` listener; 35 track `pageerror` alone, which no proxy or CDN can manufacture, so they were never exposed to this defect. *Re-measured 2026-08-09: the only spec still carrying a local `console` listener is `live-property-integration.spec.js` (deliberately deferred, in-flight); every other tail spec is `pageerror`-only, so adopting the shared `trackErrors` would **add** an IGNORE-filtered console listener they do not have today — a tighten, not a no-op. There is no risk-free bulk consolidation left; each conversion needs a green run to prove the tighten inert, which is exactly the when-touched trigger.* | test-gap | Low | fold the tail in when those files are next touched |
| D98 | **Two mobile items blocked on a design/product call, not on engineering** — (a) at 200% font scale the raised centre "Post" slot cannot fit a 56px circle plus a 24px label in a 56px bar (needs ~74px), so that one label squeezes; the fix is to drop the redundant text under an already-`aria-label`led FAB, which is a design decision. (b) "B7" bottom-nav density: 7 targets and 265px of painted control in a 360px row, with the account pill ending at exactly x=360 — real and measured, but the item's suggested escape hatch does not exist, so it needs a call on what leaves the bar | design | Low | needs a design/product decision before any code |
| D99 | **Swipe-to-remove on Saved deferred** — *narrowed 2026-08-08: the sheet half already shipped.* `useSwipeDismiss` is wired into `Select.jsx` ("drag the grab handle down to dismiss"), so sheets are done; the register was still recording them as deferred. What remains is the **destructive** gesture: removing a shortlisted property by swipe. That needs an undo affordance to be safe, which is real state machinery for a P2 win, so it stays deferred deliberately | design | Low | only alongside an undo affordance |
| D114 | **The verified-tenant badge cannot be answered live, because the mobile it keys on is masked** (batch half resolved 2026-08-09) — the row was filed as an N+1 problem and the register was wrong about the callers: `isTenantVerifiedFor` has exactly *one* consumer, `DealPanel` (two render sites); `ReviewsSection` reads a tenancy fact and `useFlatmates` reads the current user's own flag. **Resolved:** `POST /tenant-profiles/verified` now takes a list of mobiles and returns `[{mobile, verified}]`, the seam chunks at 50 and fails closed to a `Set` of confirmed-verified, and `DealPanel` makes one batched call in `reload()`. **What remains:** live `buyerMobile` on offers and finalizations arrives **masked** (`98XXXXX210`) until contact approval per D5, so a masked number never matches a real one and the live badge stays absent regardless of the endpoint. Mock mode is fully fixed; live mode needs the party objects to carry the answer rather than the key to it | contract | Med | a `verified` flag on `OfferDto.Party` / `FinalizationRequestDto.Party` — the option originally listed second, now the only one that closes the live half |
| D118 | **`flatmate_group_members.name` is `NOT NULL` but sourced from nullable `users.name`** — `FlatmateSupplyService.join` passed `joiner.getName()` straight into the row. OTP sign-in never sets a name, so joining a group 500'd for exactly the users who had just signed up — the ones least able to interpret it. Fixed by falling back to `"Member"`. The underlying mismatch stands: a column the schema insists on, fed from one the schema does not | correctness | Med | either make `users.name` required at sign-up or make the member name nullable and render a fallback |
| D120 | **Service-request documents are multipart to the vault and do not resolve in dev** — draft and final documents are `multipart/form-data` returning **signed URLs** that a dev backend does not serve, and there is no customer upload surface behind the tracker (sharing a draft and uploading a final are staff transitions). The seam projects `draft`/`finalDoc` from `documents[]` by category for when they exist, but a customer-created request carries neither, and the per-request **document checklist** (six named items in the mock) has no read representation on the wire. So the tracker's document column and inline `draft.dataUrl` preview are mock-only; live mode shows the thread and the status, not the paperwork | design | Med | a dev-resolvable document surface (or a checklist read endpoint) before the tracker's document UI can flip to http |
| D121 | **Co-fill service requests have no counterparty endpoint** — the mock splits a rent agreement across two mobiles (`serviceFlow.createCoFill`, `listForParty`), keyed on the *other* party's `ownerMobile`; the customer API scopes every request to its requester, so there is no party view to fetch. `listPartyServiceRequests` returns `[]` in http mode (never `undefined` — the tracker spreads it) and `useRentAgreement.js` create stays on `serviceFlow.create` because its create is a co-fill. Also here: `markServiceRequestRead` is a no-op (no read-receipt endpoint) and `changes_requested` collapses server-side to `in-progress` (the maker-checker has `approve`/`reject` only), so a rejection is unrecoverable from the read shape | design | Med | a co-fill invite endpoint (and a distinct `changes_requested` state) if the two-sided rent-agreement flow ships live |
| D123 | **The document seam is the owner's side only — the buyer's half has no faithful server mapping** — `documentService.js` covers the vault (list/upload/delete a listing's files) and the owner's request inbox (list/respond, `/me/documents/{propId}` and `/me/documents/requests`). The buyer's half cannot follow: the server is **token-mediated** (`POST /documents/requests` then `GET /documents/shared?token=`), giving a buyer no way to poll a request's status, so `DocumentsSection`/`ViewDocuments` keep reading `lib/data/documents.js` cross-user localStorage directly (never through the service). Also staying on `lib/`: the cross-user grant notification (`notifyBuyerDocsGranted`), the shared-doc count (`countSharedDocs`), the owner dashboard's per-listing doc-count badge, **rent agreements** (they overlap the already-live tenancy flow — created as a side effect in `lib/data/tenancy.js`), and every presentation helper (`DOC_CATEGORIES`, `DOC_INFO`, `docInfo`, `formatSize`, `docIcon`, checklist progress). The vault's signed-URL preview does not resolve in dev (the D120 pattern), so `toDoc` carries `url` for a viewer but the bytes only exist behind the mock's `dataUrl` | design | Med | a buyer-facing request-status read (`GET /me/document-requests` scoped to the requester) would let the buyer half join the seam; until then it is deliberately mock-only |
| D125 | **The flipped document vault degrades badly on failure** (item 2 resolved 2026-08-08) — Slice D moved the owner vault's list/upload/delete and the owner request inbox onto `documentService`, which is correct but surfaced four more rough edges the synchronous store never had, all resolved 2026-08-08 (see below). **(1)** every load `.catch`es to `[]`, so a failed `GET /me/documents/requests` does not degrade the buyer-request panel, it **removes** it (the whole card is gated on `docReqs.length > 0`) along with its pending badge — an owner is told they have no requests when the truth is the read broke; the same shape makes a failed vault read render a confident, wrong `0/10` loan checklist. **(1) — RESOLVED 2026-08-08:** each of the three lists now carries a `loading`/`error`/`ready` status, so a failed read shows a retry affordance instead of removing the panel, and a failed vault read no longer paints a confident wrong checklist (the checklist is hidden until the vault is `ready`). **(2) — RESOLVED:** `useDashboardData` now reads the inbox through `listDocRequests` and grants through `respondDocRequest` (the seam), the same service `DocumentsTab` uses, so the Documents tab, the `leads` badge and the Action Center share one source of truth and a grant issued from the dashboard reaches the server in http mode; `countSharedDocs`/`notifyBuyerDocsGranted` stay mock-only behind `!isHttpDomain('document')`. Covered by `consumer/account/doc-requests-grant.spec.js`. **(3)** there is no loading state: all three lists start `[]`, so a full vault first paints as an empty one (ring `0/26`, every tile in Upload) and then snaps — the late reflow is what destabilised `doc-info.spec.js`. **(3) — RESOLVED 2026-08-08:** a loading vault renders a skeleton and an indeterminate ring instead of a false `0/N` that snaps. **(4)** `uploadForCategory` captures `targetProp` but `setTick` refetches the *current* property, so uploading while the selector moves toasts success next to an unchanged tile; and `tick` is one scalar across all three effects, so one grant costs four round trips while the provider's own post-mutation return value is discarded. **(4) — RESOLVED 2026-08-08:** `tick` is gone; each mutation applies its provider return value to the one list it belongs to, guarded by a ref so an upload never lands on the wrong flat when the picker moves, and a grant patches only the answered row. **(5)** the http grant branch always toasts success, losing the mock's honest `approvedNoDocToast` for a category with no file behind it; and `openDocUrl` opens **any** `https?://` the API returns, so a dev signed URL (D120) yields a blank tab with a DNS error instead of the `noPreviewToast` it would have shown. **(5) — RESOLVED 2026-08-08 (viewer half):** the viewer treats the non-resolving dev storage-stub URL as non-previewable and shows `noPreviewToast`; the http grant toast is intentionally left as success — live mode has no client-side doc count to flag an empty grant, and the server is authoritative there | design | Med | all five items are resolved (item 2 by the dashboard-seam slice, items 1/3/4/5 by the `DocumentsTab` cleanup); delete this entry once both land on the same branch. The only deliberate residue is the live http grant toast noted in (5) |
| D129 | **Two application-data files are still eagerly bundled onto the critical path** — the locale third of this item is done (2026-08-09: English split into a 6-namespace eager shell and 14 route-deferred chunks loaded inside the existing `lazy()` boundary; critical path 591.9 → **533.0 KB gzip**, and a new `check-i18n-route-namespaces.mjs` gate proves from the import graph that every route declares what it can reach, so a new namespace can no longer silently join the shell). What remains is the harder two thirds, and neither is a bundling problem: `db.json` (236 KB) and `societies-rera.js` (182 KB) are pulled in at *module init* by `mockApi/core.js` and `lib/data/societies.js`, which compute `CATALOGUE` on import — no amount of code-splitting defers a module whose top level does the work. Also outstanding: `LoadError.jsx` reads `t('dash.retry')`, which drags the whole `dashboard` namespace (5.0 KB gzip) onto `/listings`, `/flatmates` and `/dashboard`; and `mr`/`hi` still fetch an entire language on switch rather than per namespace | frontend | Med | `societies.js` and `mockApi` must compute lazily rather than at import; `db.json` should not ship at all once the seam is fully live. The locale gate now holds the line in the meantime |
| D130 | **No bot defence on the public lead forms** — `captcha`/`recaptcha`/`turnstile` return zero matches in both `backend/` and `frontend/`. D2/D73 cover rate limiting, which is a different control: a limiter throttles a known principal, and these forms (`/society-leads`, share-flat, service quotes) accept anonymous posts. ADR-015 already chose the answer (Cloudflare Turnstile at the edge) — it was simply never wired | security | Med | wire Turnstile per ADR-015 before the lead forms see real traffic |
| D131 | **Uploaded documents are never scanned** — `virus`/`clamav` return zero matches in `backend/`, and there is no async worker anywhere (`outbox`, `KafkaTemplate`, `ApplicationEventPublisher` all zero). The vault accepts 10 MB files and hands back signed URLs that other users can open. ADR-013 explicitly deferred malware scanning; this row is that deferral made visible, not a new finding | security | Med | scan-on-upload before the vault is shared outside the owner |
| D133 | **No aggregate/BFF endpoints** — `/me/dashboard` returns zero matches in both the Java tree and the OpenAPI spec, so the dashboard fans out to many small calls (the D-series has already caught one 4× duplicate fetch there). Recorded as an explicitly unresolved proposal rather than a decision | design | Med | confirm against the real dashboard call count before adding a bespoke aggregate |
| D134 | **No enforced minimum text size, and nothing that could enforce one** — the blanket 12 px floor was never applied (a large diff across ~40 files), and there is no legibility spec: `e2e/tests/mobile/` holds 25 specs and none sweeps computed font sizes. The `/property/:id` five-stat band renders all five labels at 11 px | design | Med | land the floor and the sweep together, or neither holds |
| D136 | **The tap-target sweep does not walk the routes with the worst offenders** — measured but unswept: `/messages` tabs 172×32, `/dashboard` "View all" 48×20, `/society/:slug` breadcrumbs 55×20, `/help` article links 186×15, plus the whole admin/field-ops surface (topbar icons 28×28, row `View` 51×28). Admin needs an authenticated fixture the mobile projects do not carry, which is why it was skipped | e2e | Med | extend the sweep; the admin half needs the fixture first |
| D138 | **No Lighthouse or performance run in CI** — `.github/workflows/ci.yml` runs lint, i18n, help, build and `check:size`; nothing measures FCP/LCP, so the stated mobile performance targets are unverified by anything | build | Low | add once D129 has moved the bundle, or the first run just records the problem |
| D139 | **No pull-to-refresh on any list surface** — zero matches for `pull-to-refresh`/`usePullToRefresh`. Distinct from D99: that gesture is destructive and needs undo, this one is not | frontend | Low | one hook, applied to `/listings`, `/saved`, `/notifications`, `/messages` |
| D140 | **The service landings' hero imagery is still eagerly loaded full-size** — the `<img>` grids on `Services.jsx` and `InteriorRenovation.jsx` were put on `srcSetFor` (2026-08-10), so phones now fetch smaller variants for those. But the actual 1.26 MB heroes are CSS `background-image` divs rendered through the shared `components/ServiceLanding.jsx`, which `srcSetFor` cannot touch — a responsive `srcset` has no effect on a CSS background. Closing the rest needs `ServiceLanding` to render a real `<img>`/`<picture>` hero (with `fetchPriority="high"`) instead of a background div, a structural change the srcset pass deliberately did not make | frontend | Low | convert the `ServiceLanding` hero from `background-image` to `<img>`/`<picture>` so `srcSetFor` applies |
| D141 | **`/property/:id` is 5,447 px of scroll with no progressive disclosure** — the page has section tabs but no per-section collapse (`accordion`/`Collaps` matches only a comment). On the most important page in the funnel, the mobile user scrolls past everything to reach anything | design | Med | collapse the low-intent sections by default |
| D142 | **The mobile home fold has no search entry point** — the hero search panel is `hidden lg:block` by deliberate design (it cost 286 px) and no compact tap-to-search pill replaced it, so a first-time mobile visitor must already know to use the bottom-nav Search tab | design | Low | a single-line search pill, not the full panel |
| D143 | **The Saved tab strip is still a horizontally-scrolling pill row** — the signed-out shortlist state shipped, but the strip itself hides tabs off-screen on a 360 px viewport with no affordance that more exist | design | Low | reuse the bottom-sheet switcher, or wrap to two rows |
| D146 | **Visit mutations are read-modify-write with no optimistic lock** — `BaseEntity`/`AuditedEntity` carry no `@Version`, so `VisitService.updateStatus` and now `reschedule` (added by D87) both find → mutate → save the same `visits` row unguarded. Two concurrent writers last-write-wins: an owner confirming while the visitor reschedules can leave a `confirmed` visit at a slot nobody agreed to — exactly the state D87's reset-to-`scheduled` is meant to prevent — and two simultaneous reschedules silently drop one proposed slot. Raised by `java-reviewer` against D87, recorded because D87 knowingly added the second concurrent writer rather than inherit the gap unrecorded. Pre-existing on `updateStatus`; bounded in practice (a reschedule is rare and self-correcting on the next read) | design | Low | a `@Version` on the visit entity (or a re-read guard), ideally when the mutation model is next revisited platform-wide |
| D158 | **The write rate limit counts in memory, per instance** — `WriteRateLimiter` (added closing D2) holds its counters in a bounded map inside the JVM, so the real budget is the configured one multiplied by the number of running instances, and every deploy hands the whole platform a fresh allowance. Fine for one instance, which is what exists; wrong the moment a second is started, and wrong quietly — the limit does not fail, it just becomes a larger number nobody chose. Same single-instance caveat as D57's subscription sweep, and the two want the same answer | security | Med | move the counter to Redis when a second instance is provisioned; `tryAcquire(key, now) → retry seconds` is deliberately the whole interface, so this is a swap rather than a rewrite |
| D173 | **The desk's half of D151 has a tested server and no screen** — `GET /service-requests/{id}/identities` refuses everyone but the assignee, audits both outcomes and is covered by `ServiceRequestIdentityTest`, but nothing calls it: the ops back-office runs entirely on `lib/serviceFlow.js` against `localStorage` and has no live client for service requests at all (the seam records this as "staff transitions — the ops surface, not the customer tracker"). So the numbers now reach the server correctly and the operator still asks the customer. Distinct from D151, which was the *channel*: this is the ops seam, and building a one-off live call for this route alone would be the second half-migrated ops surface rather than the first migrated one | frontend | Med | lands with the ops service-request seam; the reveal is a button that calls the route once and holds the result in component state only — never in a list column, never in `localStorage`, and the refusal message is the one the server sends |
| D176 | **`idx_transactions_owner` appears to be dead, and `V27`'s comment about the flatmate unique index is false** — two independent findings from the same sweep, both cheap and both the kind that rot. No query in `TransactionRepository` filters on `owner_id`, so `idx_transactions_owner (owner_id, date) WHERE archived = false` is paid for on every ledger write and chosen by nothing; only that one repository was read, so this needs confirming across the module before dropping. Separately, `V27__flatmates.sql` says its unique index is "the reason the service does not check-then-insert" — the service does exactly that, and has since V27 landed, so the comment has been documenting the opposite of the code for its whole life. A wrong comment beside a correct constraint is worse than none: the next reader trusts it | quality | Low | confirm the index is unreferenced, then drop it in the same migration that next touches `transactions`; correct V27's comment in place (it is prose in an applied migration, so the checksum moves — do it when the test DB is next rebuilt, never mid-wave) |
| D177 | **`DELETE /reviews/{id}` does not exist, and the real gap it points at is DPDP erasure** — moderation can hide a review but not remove one, which is the **correct** default: a hidden review is reviewable, so "why, and by whom" stays answerable, while a hard delete destroys the evidence of a dispute at the moment it settles it. The register previously listed a delete endpoint as a way to let a test harness tidy up; that reason is gone (D100 closed by having the harness delete its own row directly). What remains is a genuine legal capability with a different shape: a **subject-initiated erasure** under DPDP, which must cascade beyond the `reviews` table and probably wants anonymise-and-retain rather than `DELETE`, with its own audit record and its own authorisation — not a moderator button | legal | Med | needs a decision on scope before any engineering; see `open-questions.md`. Explicitly **not** to be built as a moderation power |
| D178 | **The owner's finance screen filters on the calendar year while the server filters on the Indian financial year** — `FinancesTab.jsx` derives its own window client-side, and its `year` branch is `new Date(now.getFullYear(), 0, 1)` — 1 January. `SummaryPeriods.YEAR` on the server pivots on 1 April. So from January to March the summary card and the transaction table **directly below it on the same screen** disagree by up to three months of rows, for the same selected period. This is live and user-visible, and it is independent of D174: fixing the server's clock does not move the client's pivot. `lib/data/finances.js` carries a *third* copy of the arithmetic (that one pivots correctly on month index 3) with no test tying any of them together | correctness | Med | the honest fix is to stop deriving the window on the client and filter the table from the same answer the summary came from; found while closing D174 |
| D179 | **Four more services read a bare `LocalDate.now()`** — the same class of error D174 closed in `FinanceService`, deliberately left alone there to keep that lane small. `RentService:220` is the one to promote: it computes the rent due date with `withDayOfMonth(1)`, so it has the *identical* month-rollover failure on the same product surface. Also `AdminMetricsService:67,102`, `TenancyService:96,113` (which stamps tenancy start and end dates — a date written to the ledger, not merely displayed) and `FlatmateSeekerService:374`. Separately, three private copies of the zone constant now duplicate the shared one: `SubscriptionService:72`, `PaymentWebhookController:66` and `AdminMetricsRepository:40` (the same zone as a SQL string) | correctness | Med | point each at `PlatformTime.IST`; `RentService` wants the fixed-instant boundary test `FinanceIstBoundaryTest` already demonstrates |
| D180 | **`rent-agreement.spec.js:116` looks like a real product bug, not a flaky test** — the co-fill WhatsApp-invite spec times out at 30 s inside `submitFromReview`, on `locator('.step-panel.active').getByRole('checkbox').check()`, with Playwright reporting *"element is not stable"* and *"outside of the viewport"*. That is the signature of a scroll/animation fight in the review step, not of a bad locator. Two sibling specs (`:369` locked panel after submit, `:435` admin ticket status) and four `referral-rewards.spec.js` cases fail alongside it. Deliberately not fixed inside the D28/D29 lane: hardening a test around a product defect is how a defect becomes permanent | e2e | Med | needs its own lane — reproduce by hand at desktop width first and watch what moves under the checkbox |
| D181 | **The three flatmate interest buttons never call the API** — `onInterest` and `onRoomInterest` in `useFlatmates.jsx` and `onJoin` in `useFlatmateSupply.jsx` short-circuit on `hasInterestDB(key)` and write to the `localStorage` store in `lib/data/flatmates.js`. The HTTP providers `expressInterest`, `roomInterest` and `joinGroup` exist in `flatmateProvider.js` and are dead for these three paths. So the server's 409 `already_interested` (D175) is correct and unreachable, and an interest expressed on one device is invisible on another. **The trap for whoever wires these:** the benign 409 must route to the existing strings `flatmates.alreadyInterested` / `alreadyMessagedOwner` / `alreadyAskedJoin`, not to `common.somethingWentWrong` — otherwise a repeat tap becomes a red error toast. `group_full` is a *different* 409 on the same door and needs its own message | frontend | Med | with the flatmates live seam; found while closing D175 |

### Detail on the ones that need it

**D2 — rate limiting on authenticated writes. Closed 2026-08-09.** Raised by `security-reviewer`
during slice 3 and deferred every slice since as platform-wide, while every slice added more
authenticated write surface — contact requests, offers, visits, reviews, saved searches, service
requests. Only `POST /auth/login` was ever limited.

Closed by `WriteRateLimitFilter`, which sits after `JwtAuthFilter` in the security chain and counts
every mutating request against a fixed window keyed on the principal id, falling back to the client
address when there is none. The shape matters more than the number: a filter that limits writes *by
default* cannot be forgotten at a new endpoint, whereas the per-controller annotation this could have
been would have been forgotten at exactly the endpoint where it mattered. Reads are untouched — they
are cheap, cacheable and mostly anonymous, and `spring.data.web.pageable.max-page-size` is what bounds
their cost — with the single exception of `GET /documents/shared`, the anonymous token-guessable read
the register named alongside the writes, which is included by path because its risk is enumeration
rather than volume. The signed Cashfree callbacks are exempt: they are HMAC-authenticated, they all
arrive from a handful of addresses that would share one bucket, and a refused callback is a customer
who paid and was not credited.

Two things it does not do, both deliberate and both recorded rather than assumed. It counts in memory
and per instance (**D158**). And it does not close **D73** — that is a check-then-insert race inside a
transaction, which a request-level limiter narrows but cannot fix; the two were expected to share one
principal-keyed counter and it turns out they cannot, because D73's counter has to be atomic with the
insert it guards. (D73 was closed separately on 2026-08-09 by a transaction-scoped advisory lock; see
below. This paragraph is why the two limiters remain distinct rather than one.)

A `security-reviewer` pass over the finished slice found four ways the first version could be walked
past, all now fixed and all worth recording because they rhyme. Three were the same mistake in
different clothes — *the identifier the filter compares is not the identifier the dispatcher uses.*
The client address was the proxy's address, because nothing set `server.forward-headers-strategy`, so
every anonymous caller on the internet shared one bucket and a single host could have 429'd every
anonymous write on the platform: the limiter becoming the outage it was added to prevent. The prod
profile now sets `native` with the balancer's CIDR pinned in `server.tomcat.remoteip.internal-proxies`
as a `${INTERNAL_PROXIES}` lookup with no default, so a deploy that has not decided its topology fails
to start rather than silently keying every user together. The path was the raw URI, so
`GET /documents/share%64` reached the protected handler without being counted; it is now decoded and
cleaned before matching. And the method check was `GET`, but Spring dispatches `HEAD` to `@GetMapping`
handlers and only drops the body — the status code answers the enumeration question perfectly well —
so limited reads are now matched on path alone.

The fourth was worse in kind. The map was bounded by refusing to track new keys past a ceiling and
letting them through unlimited, which is the protection failing in precisely the attacker's direction:
50,000 addresses — one routed IPv6 /64 — would have switched the limit off for everyone arriving
afterwards, while the flood's own traffic held the map full. It is now bounded by *eviction* instead
(an access-ordered `LinkedHashMap` with `removeEldestEntry`), which deletes the fail-open, the O(n)
inline sweep it needed, and a race where the sweep could drop a counter between lookup and increment
and silently discard the request it had just counted. Both misconfigurations of the knobs — a zero
window, which limits nothing while looking healthy, and a zero budget, which refuses every write — are
now rejected at construction rather than clamped.

One bound it still does not have: the per-user budget is not the platform ceiling, because signup is
passwordless and self-service, so an attacker can mint accounts and with them fresh buckets. The real
ceiling on that path is set by the OTP send limits, which is why those are re-pinned in the prod
profile rather than inherited from the loosened local defaults.

A second review pass over those fixes found four more, and the pattern in them is worth more than the
individual bugs: **a security control expressed as configuration is only as reliable as the weakest
way that configuration can go missing.** The proxy fix had been written as two `server.*` lines in the
prod profile, which fails silently in two ways — a staging or preview deploy simply never loads that
file (the magic-string trap already recorded as D147), and Boot's `@ConfigurationProperties` binder
resolves placeholders with `ignoreUnresolvablePlaceholders`, so an unset `INTERNAL_PROXIES` binds the
literal text rather than failing, while the far more common declared-but-empty case makes Tomcat trust
nothing, rewrite nothing and log nothing. The topology is now a property this code owns
(`punenest.security.trusted-proxies`), in the base file so every profile has an answer, read through
`@Value` — which genuinely throws — and validated by `TrustedProxyConfig` before the server starts.
`none` is a legitimate answer for a directly exposed instance; saying nothing is not. And because a
wrong answer is still possible, `WriteRateLimitFilter` logs once, loudly, if a request ever arrives
carrying `X-Forwarded-For` while the declaration says nothing is in front — which is proof the
declaration is wrong, obtained from traffic rather than from trust.

The other three: anonymous callers are now keyed on the IPv6 **/64** rather than the address, because
a single host is routinely assigned a whole /64 and would otherwise have 2⁶⁴ free budgets — the
cheapest possible defeat of the limit, and the thing that made the tracked-key ceiling meaningless in
principle. Path parameters are stripped before matching, since Spring routes `/documents/shared;x=1`
to the protected handler; `StrictHttpFirewall` rejects that shape today, which is a reason to expect
the code to be exercised rarely and no reason to depend on it. And the provider callbacks are no
longer *exempt* — they now have their own budget at fifty times the ordinary one, plus a 64 KB body
ceiling. A blanket exemption had made them the only completely unthrottled writes on the platform, and
they are `permitAll`: the HMAC does reject an unsigned body, but only after the container has buffered
it and the handler has materialised it as a string, and nothing else in this stack bounds a JSON body
at all.
A third pass found two more, and both were the same species as everything above: **a guard that is
correct about the value it examines and wrong about which value that is.** The path helper cut at the
first `;` and *then* decoded, while Spring decodes first and strips afterwards — so `%3B` reinstated
the bypass, this time taking the new body ceiling with it, since a callback path that fails to match
`PROVIDER_CALLBACKS` never reaches the size check. And the size check itself read
`getContentLengthLong()` and tested only whether it *exceeded* the cap; an unknown length reports as
`-1`, which exceeds nothing, so `Transfer-Encoding: chunked` streamed an unbounded body onto the heap
through an unauthenticated route in a single request. Both are now closed: decode-then-strip, and an
undeclared length is refused outright, which costs nothing because the provider always sends one.
`StrictHttpFirewall` happened to block the first today — which is exactly why the second matters, as
it demonstrates what depending on that would have been worth.

The through-line across all three passes is worth stating plainly, because it will apply to the next
control as much as this one: **every finding but one was a mismatch between the string the security
code compared and the string the framework acted on** — the address, the path, the method, the
encoding, the declared length. None was a mistake in the rate-limiting logic itself.
The pre-existing local guards remain and remain worth having: `ServiceRequestService` still caps a
principal at one *outstanding unpaid* request per desk, which is a cap on open orders rather than a
rate, and `OtpService`/`SocietyLeadService` still hold their own DB-backed per-mobile limits — keyed
on something more meaningful than an address, and therefore not superseded by this.

**D73 — the count-then-insert race inside those limits. Closed 2026-08-09.** Four call sites, not the
three the row named: `ShareFlatService` had been retired by V28, and the cap it was raised against
now lives in the flatmates domain behind *two* entrances — `FlatmateSeekerService.express` and
`FlatmateSupplyService.record` — which count the same rows of `flatmate_requests` against the same
ceiling of ten an hour. Locking those two separately would have left the burst a second door, so they
share one lock namespace; `OtpService` (per mobile *and* purpose) and `SocietyLeadService` (per
mobile) have one each.

**The interesting part is what did not transfer.** D153, D160 and D170 closed the same shape three
times with a partial unique index plus `ConstraintViolations.isOn` — the database refuses the second
row and the catch translates the named collision. That works because "at most one" has a key. "At
most N in the last hour" has none: there is no column, and no expression over columns, whose
uniqueness is a count over a moving window. Two further candidates fail for reasons worth writing
down, because both look right.

*The one-statement conditional insert* — `INSERT … SELECT … WHERE (SELECT count(…)) < N` — is the
tempting one, and it is a worse bug than the one it replaces. Under `READ COMMITTED` the subquery
reads the statement's own snapshot, so two concurrent inserts both see the pre-insert count and both
proceed. It is atomic in the sense that it is one statement and not atomic in the sense that matters,
and it would have looked like a fix in review.

*`SELECT … FOR UPDATE` over the counted rows* fails on the phantom. Locking the rows already in the
window does make two writers queue, but the loser resumes holding the snapshot it took before it
blocked: it never sees the row the winner inserted, because that row did not exist when the loser
looked and nothing the loser locked was modified. The cap stays exactly as leaky. Locking an
*owning* row would work, and two of the four sites have no owning row to lock — a society-lead submit
is anonymous, and an OTP send names a mobile that usually has no account.

What is left is a transaction-scoped advisory lock, which is what `common.persistence.RateLimitLock`
takes: no row required, an arbitrary key, and released by Postgres itself when the transaction ends,
so no path — thrown exception, dropped connection — leaks it. It depends on `READ COMMITTED`, which
is the default and is not overridden anywhere, and the dependency is not incidental: the whole point
is that the count issued *after* the lock is a new statement with a new snapshot. Raise the isolation
level on these paths and the lock would be held, paid for, and useless.

**Reusing `WriteRateLimiter` was considered and rejected.** It counts in memory, per instance, and
resets on deploy (D158) — and two of these limits explicitly refused an in-memory counter when they
were written. An OTP budget that resets on deploy is not a budget, and a public form with no session
has nothing to hang a bucket off. Folding them in would have deleted three limiters and the guarantee
they exist for. The two controls remain complementary and neither subsumes the other: D2 bounds how
fast one caller can arrive at the API at all; this bounds what a burst can spend once it has.

**The tests had to leave the harness.** `AbstractApiTest` is `@Transactional` and rolls back, so its
writes are never visible to another connection — and this bug is, by definition, a second writer's
count failing to include a first writer's *committed* row. A rolling-back test would pass identically
before and after the fix, which is D90 exactly. `RateLimitRaceTest` and `FlatmateInterestRaceTest` are
therefore plain `@SpringBootTest` classes with real threads, real commits and their own cleanup, and
they assert on both the number of refusals and the number of rows that survived — a limiter that
refused the right number of callers and still wrote the wrong number of rows would be just as broken.
The one cost is that they are bounded by the deliberately small test connection pool: the flatmate
race runs two threads rather than three because the winner needs a second connection for its
`REQUIRES_NEW` audit write.

**D151 — the identity numbers the drafting desk drafts from. Closed 2026-08-09.** A Leave & License
names each party by PAN and Aadhaar; the paid-L&L security pass stopped both from reaching the server
at all, correctly (`details` is plaintext `jsonb` echoed verbatim to every staff read, so carrying
them there made the ops queue's first page a bulk identity dump), and left the desk with nothing.
`PUT|GET /service-requests/{id}/identities` is the channel that was missing, over a new
`service_request_identities` table (V47) that is outside `details` in every sense —
`rejectIdentityNumbers` is untouched and the wizard still redacts.

**The register named the document vault and this went elsewhere, deliberately.** The vault's read
model is `FileStorage.signedDownloadUrl(key)`: a URL that carries its own authority, that nobody can
be excluded from, and whose use never reaches our server — so neither of the two requirements that
define this item ("only the assigned operator", "every access recorded") is expressible against it.
`FileStorage` has no authenticated read at all, only a signer. Two further facts settled it:
`DocumentUploads.validate` admits PDF/JPEG/PNG/HEIC/WebP proved by magic bytes, so a set of numbers
is not something the vault can hold without weakening the allowlist that keeps non-documents out; and
`DocumentService.delete` deliberately leaves the stored object behind, which is a defensible trade
for a sale deed and an indefensible one for an Aadhaar number. The vault would have made this a
permanent, un-revocable, un-auditable copy of the most sensitive field the platform touches.
**The deviation was put to the owner and signed off on 2026-08-10**, so the dedicated table is the
agreed design rather than an unreviewed departure: `service_request_identities` stands, and any
later proposal to move these numbers into the vault has to answer the three objections above first.

**Only the assignee reads, and that is enforced by a refusal rather than by an omission.** Not
"staff", not "admin" — `request.assigneeId == caller.userId()`, or 403. An unassigned request refuses
everyone, because "whoever asked first" is not a name. An admin who needs the numbers assigns the
request to themselves first, which costs two visible moves when somebody else holds it (there is no
`assigned → assigned` edge, so it goes back through `in-progress`) and writes a timeline entry the
customer can read plus an audit row naming them. The control is accountability, not prohibition. Both
reads and refusals go to `audit_log`; the refusal is the more interesting entry, because it is
somebody reaching for a matter that is not theirs. The numbers themselves are never in the audit
row — counts and roles only, keyed by request id, so the one table that must be trusted does not
become the second place they are held.

**Retention is bounded by the work, not by a policy document.** `purgeFor` runs from
`ServiceRequestService.transition` on every move into a terminal status: `completed` because the
registered document now carries the numbers, `cancelled` because nothing will be drafted from them.
The rows survive with their names and a `purged_at` stamp — "recorded, and since discarded" and
"never recorded" are different facts about a matter. Nothing else on the platform holds a raw
Aadhaar (`identity.kyc` stores masks by design), so this exception is time-boxed as well as narrow,
which is what Aadhaar Act s.29 asks for.

**Only the requester writes**, staff and admin included in the refusal: a desk that could write the
parties' identity numbers could also invent them, and the agreement would then name somebody the
customer never identified.

**Still open after this.** The ops back-office has no live client for service requests at all — it
runs entirely on `lib/serviceFlow.js` against `localStorage` — so the `GET` half has a tested server
and no screen yet. That is the ops seam's slice, not this one; recorded as D173.

**D22 — Maps key rotation.** A real key was committed in `.env.example` and is in git history across
two commits. A placeholder is committed now, but **history exposure means the key must be rotated** —
replacing the file does not undo the leak. This is the highest-urgency item in the register and the
only one that is externally exploitable today.

**D26 — client-side trust derivation.** `applyVerifiedBadgeToListings` sets `ownerVerified` in the
browser, and `isSeriousBuyer(mobile)` infers trust from a phone number. Both are forgeable. The
backend now owns verified state properly — only the DigiLocker webhook may set it — so **the durable
fix is the `mock→http` flip, not a patch to the mock.** Recorded so the flip is understood as closing
a security item rather than only swapping a data source. Live in `AadhaarVerifyModal.jsx`,
`lib/mockApi/properties.js`, `lib/seriousBuyer.js`, `dashboard/EnquiriesPanel.jsx`.

**D28/D29 — e2e.** `expect(errors).toEqual([])` treats *any* console error as a failure, including
ones from third-party network calls, so the suite is green only on a good connection — it will fail
in CI for reasons unrelated to the code under test. `services-loans-team.spec.js` was failing before
the work that recorded it and has not been re-triaged since. Neither should be confused with the
`qa-location-search`/`admin-*` cluster, which **was** root-caused and fixed.

**D30 — owner-scoped mock stores keyed on mobile.** Deals/visits mock stores key on the owner's
mobile. A masked number (`98XXXXX210`) strips to a short-but-plausible digit string, so two owners
can collapse onto the same key. The durable fix is re-keying on `ownerId`, which the API already
returns (`propertyMapper.js:125`) and which the mock fixtures lack. Backend slices 4+ made
deals/offers/visits server-authoritative, so the remaining exposure is mock-mode only.

---

## 2. Standing rulings — do not re-litigate

The only permanent section. Everything here is a settled **"no"** or a deliberate choice that looks
like an oversight, so each entry exists to stop the same question being re-raised by the next
reviewer. Unlike a finished debt item (rule 3), a ruling has no artifact to be deleted into —
its whole value is that it is still written down.

**The delivered-work archive that used to sit here was removed on 2026-08-07.** It had grown to 22
long entries and was longer than the open register above it, which is a real cost: the file people
must read to know what is owed had a majority of text describing what is not. Every entry's
reasoning had already been written into the thing it changed — `VersionedEntity`, `SettingsDocument`,
`common.validation.Formats`, `DocumentUploads`, `Ids`, `NotFoundException`, `ArchitectureBoundaryTest`,
`SharedFormatsTest`, `MigrationChainTest`, and the header of `R__zz_dev_demo_data.sql` — all verified
present before deletion. Git history holds the rest.

| Item | Ruling |
|---|---|
| Records vs Lombok for DTOs | **Records.** Immutability is load-bearing for the trust model: the contact gate rests on "the mapper decides what to reveal, and that decision is final", and a setter on `PropertyResponse` turns that decision into a default. A record is also already shorter than the Lombok equivalent, so there is nothing to save. Full policy in `backend/lombok.config`. |
| A central `ValidationService` / rule engine | **No.** Consider what `OfferService.respond()` enforces: caller is buyer-or-owner (needs the JWT plus two repositories), accept/decline is owner-only, `counterAmount` is required when countering, plus the status transition table. Centralising that means injecting `Offer`, `Property`, `Deal`, `ContactRequest` and `User` repositories into the validation package — then repeating it for 32 other services. It inverts the dependency graph into a god-package and separates each rule from the transaction that makes it atomic. **A service enforcing its own invariants is not scattered validation; that is what a service is.** Format rules may move (`common.validation.Formats`); invariants stay. |
| Centralising status/vocabulary constants in one package | **No.** §7.1 stands; a shared vocabulary package would import every feature's concepts. |
| `role`/`status` as `String` not `enum` | Deliberate (`api-standards.md` §7.1). Feature-owned constants mirror the DB `CHECK` and the spec vocabulary; enums add a mapping layer and break on a spec-side value addition. |
| Duplicated `maskMobile` in two mappers | Deliberate. Both are `private` so MapStruct cannot adopt them as implicit `String→String` converters. A security rule readable in place beats one you have to go find. |
| `reportMapper` / `reviewMapper` duplicating the page-envelope unwrap | Deliberate. Every other unwrap site now calls `unwrapPage` from `services/http.js`, but those two mappers are the only modules in the seam with **no imports at all**. Pulling the transport module into a pure mapper to save four lines makes every consumer of a mapper transitively depend on `API_BASE` and token storage. The duplication is four lines with identical semantics; the coupling would be permanent. |
| `tools.jackson` import "is wrong" | It is correct. Spring Boot 4 ships Jackson 3. |
| **Should we hold deposits, or become a party to the tenancy?** | **No — and this is the one to not re-litigate.** Rescued 2026-08-08 from `docs/feature review/02` before deletion; it existed in exactly one place while an open register row (D115) asked the question it answers. Taking custody of deposits or standing between landlord and tenant converts a marketplace into a balance sheet: it makes us the principal in every dispute, exposes us to defaults we do not price, and drags in NBFC-adjacent regulation we have no licence for. That is the failure mode that broke Nestaway. **We stay the venue, never the counterparty.** Consequence for D115: deposit financing is only shippable as a *referral* to a lender who carries the risk — if it cannot be built that way, it comes off the page. |
| `pendingContactCount` / `pendingOfferCount` etc. | **Superseded 2026-08-08 — this ruling was false.** It read "client-derived from the list responses; no endpoint, no spec addition", but `GET /me/contact-requests/pending-count` shipped as D78 precisely because a client-side count over one page is wrong past the first page. Kept as a correction rather than deleted: a stale "do not re-litigate" is worse than no ruling, and someone will otherwise re-derive the client-side version. |
| Server mask format `98XXXXX210` vs mock `+91 98••• ••10` | Server format stands; the prettier rendering is client-side presentation. |
| `GET /reels` declares `page`/`size` but returns a bare array | Correct for an infinite-scroll feed — bounded input, no total needed. |
| `ReviewResponse.categories` empty-not-null | Deliberate, so clients iterate without a guard. |
| Mojibake / BOM "should just be a grep for the bad sequences" | **No — detect by round-trip.** A pattern list only ever catches damage somebody already noticed: the first repair pass used one and missed two whole families. `SourceTreeHygieneTest.noMojibakeOrBom` re-encodes each non-ASCII run to CP1252 and decodes it as UTF-8, accepting only a valid, strictly shorter result — which also leaves genuine `Café` / `पुणे` / `₹` alone. |
| Collapsing the 5 bespoke exception subclasses into one parameterised type (C5) | **No.** `AadhaarAlreadyRegistered`, `ReviewNotEligible` and friends each carry a distinct wire error code the React client branches on. Named types are greppable, testable, and impossible to get subtly wrong at the call site; collapsing them saves ~5 files and costs the one property that matters. |
| Splitting `common/web/Routes.java` because it is 591 lines | **No.** Its length is the feature — one greppable registry of every route (`api-standards.md` §2.1). Splitting it by feature reintroduces the scatter the rule exists to prevent. |
| "Classes are too long, we need to split them" | **Measured and false.** Only 2 main files exceed 500 lines, and one of those should stay long (`Routes.java`, above). The measured waste was elsewhere: a 42.7% comment ratio and test duplication — which is what D33 and the `AbstractApiTest` consolidation addressed. |
| "Just upgrade Checkstyle to the latest and turn it on" | **No — the version is the smaller problem.** Measured: **12 of 717 findings (1.7%) actually need a linter**; 494 are layout a formatter fixes for free and 211 come from rules that must be deleted because they contradict D33. Upgrading 10.13.0 → 13.9.0 and enabling it would hand a human ~494 mechanical edits and still find zero bugs. Formatter first (Spotless), then reassess whether the residual 12 justify keeping Checkstyle at all — the boundary rules that would have been ArchUnit's job already ship as `ArchitectureBoundaryTest`. Open as **D36**; the full baseline lives in `backend/config/checkstyle/README.md`. |

### A note on `tasks/todo.md` unchecked boxes

A sweep of that file found **34 unticked `- [ ]` items**; the majority are *stale plan checkboxes*
from slices that subsequently shipped, not outstanding work. They were verified individually against
the source, spec and migrations before landing here. **This register — not the checkbox state in
`todo.md` — is authoritative for what remains.**
