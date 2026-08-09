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

**89 open** — 4 High, 3 Med-High, 47 Med, 35 Low. Largest clusters: `design` 37, `frontend` 10,
`security` 8, `contract` 4. Highest number ever issued: **D145**; numbers are never reused
(rule 4), so the 56 gaps in this list are deleted items, not mistakes.

> **Counting this table by hand or by a naive script gets it wrong**, and has for months. Two traps:
> rows contain escaped pipes (`hasListings() \|\| …`), so splitting on `|` shifts every later column
> and silently mis-reads the priority; and the four High rows are *also* listed in the summary above,
> with fewer columns, so counting row lines double-counts them. Unescape first, and prefer the
> 7-column row for any id that appears twice. The figures above satisfy 4+3+47+35 = 89 and
> 89 + 56 gaps = D145, which is the check that they hang together.

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

**The four High items are blocked on something other than effort**, which is the single most
useful fact about this list:

| # | What it needs |
|---|---|
| D2 | a rate-limiter design (pairs with D73 — one atomic principal-keyed counter answers both) |
| D57 | a scheduler — nothing in the platform runs on a timer yet |
| D59 | a ranking design: what a paid boost is actually worth against relevance |
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

**Actionable today without any decision** — the honest short list is now short. **D38**
(`package-info.java` per context) is the only one of any size, and it is 22 files of prose whose
value depends entirely on the prose being accurate; done shallowly it is worse than not done.
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
| D2 | Rate limiting on **authenticated writes**, plus the anonymous `GET /documents/shared` | security | **High** | platform / first real deploy |
| D4 | `CashfreePaymentGateway.createOrder` live HTTP | payments | Low | whoever obtains the merchant account |
| D5 | Owner `hideNumber` preference (`users.hide_number`) | product | Low | product decision first |
| D7 | Saved-search alerting job writing `new_count` | engagement | Low | needs a scheduler |
| D9 | Frontend still computes the platform fee | frontend | Med | rent-UI integration slice |
| D10 | Refresh-token pruning job | auth | Low | when the table grows |
| D11 | `role` / `status` as `String`, not enums | style | Low | — (deliberate, see §2) |
| D12 | Staff-login timing equalisation | security | Low | if staff enumeration becomes a concern |
| D13 | Scoped-staff `roleId` / `moduleAccess` | admin | Med | admin slice (needs spec + backend) |
| D15 | Notification preferences (R9) | engagement | Low | no table, no contract |
| D20 | `ProfileTab.save` sends `city`, absent from `UserUpdate` | frontend | Low | silently dropped on http |
| D21 | Verify-funnel Playwright coverage (modal → mock → badge) | e2e | Med | e2e owner |
| D26 | Frontend derives trust client-side (`applyVerifiedBadgeToListings`, `isSeriousBuyer`) | frontend | Med | moot on `http` flip; live in mock mode |
| D28 | e2e `expect(errors).toEqual([])` assertions are network-dependent | e2e | Med | flaky offline / in CI |
| D29 | e2e `services-loans-team.spec.js` failing (pre-existing) | e2e | Med | e2e owner |
| D30 | Owner-scoped mock stores keyed on owner **mobile**, not `ownerId` | frontend | Med | Phase 3/4 integration |
| D32 | ProfileTab identity chips are hardcoded English | i18n | Low | ProfileTab i18n pass |
| D33 | **~195 `@param` lines still restate their parameter in a synonym** — the 2026-08-07 pass amended `api-standards.md` §10 first (the durable half: without it they grow straight back) and deleted the **42** that are provably empty — pure name restatements and `(required)`/`nullable` suffixes that duplicate the annotation on the next line. **The remaining ~195 were deliberately not deleted.** The register's criterion was "≤4 words", and applied literally that removes genuinely useful lines: `@param orderId the provider's {@code order_id}` is four words and says which external field it maps to. A synonym (`@param title headline`) is a judgement call a regex should not make unsupervised | quality | Low | by hand, per file, when that file is next edited — §10 now forbids adding more |
| D36 | **Formatter-first: Spotless owns layout, then reassess whether Checkstyle is worth keeping at all** — measured on the stored config (`backend/config/checkstyle/`, which carries the full baseline): **717 violations across 333 main-source files, of which only 12 (1.7%) actually need a linter.** 494 are layout a formatter fixes for free; 211 come from rules that contradict `api-standards.md` §10 and would have to be deleted. Enabling it as-is hands a human ~494 mechanical edits and finds zero bugs. The boundary third is already delivered by `ArchitectureBoundaryTest`, so this is a two-tool question, not three | build | Med | backend / blocked on repo access (Spotless is not in the offline repo) |
| D37 | **Service-split trigger: past ~450 lines, split by use-case, never by layer** — services top out at 405 lines and are trending up, so agree the rule now while it is free and nobody is defending a specific file. A `RentService` that grows becomes `RentBillingService` + `RentPaymentService`, never `RentServiceHelper`: a helper class named after its parent is a file split, not a design | architecture | Low | agree now, apply on the next service that crosses it |
| D38 | **One `package-info.java` per bounded context** — zero exist across 22 contexts. One short file per context, stating what it owns and what it may not import, lets class-level Javadoc **stop re-establishing context in every file**, so this is a net *reduction* in comment volume rather than an addition. It also gives the delivered boundary rules (`ArchitectureBoundaryTest`) a documented home, which is what turns them from folklore into something checkable. The value depends entirely on the prose being accurate — 22 files done shallowly is worse than not done | architecture | Low | with D36 |
| D41 | Deleting a document leaves its object in the store — needs a bucket lifecycle rule | storage | Low | with the real object store |
| D42 | Share token travels as a query parameter — any request logging that is turned on must exclude `token` | security | Med | platform / first real deploy |
| D44 | **Service requests are not team-scoped** — `service_requests` has no `team` column and `type` is free text, so every ops user sees every request while tickets are desk-scoped. Inferring a desk from `type` would silently hide work the day a new type appears | design | Med | when the service catalogue is a closed vocabulary (Billing & Growth slice) |
| D45 | **A ticket and a service request do not mirror each other** — the ops board and the customer's workflow are two tables with no link, so ops working a request has to find the ticket by hand | design | Med | with the Services & Support slice (`/support-tickets`) |
| D46 | **`TicketUpdate` cannot unassign** — a record cannot distinguish an absent field from an explicit `null`, so `assigneeId: null` is read as "leave it". Needs a sentinel or a dedicated endpoint | design | Low | when ops asks for it |
| D47 | **`TicketDto` carries internal notes** and is returned to the customer who created the ticket. Safe today only because a new ticket has none; it must be split before the board gains any customer-facing read | security | Med | before `/support-tickets` exposes a ticket to its raiser |
| D49 | **`MessageCreate.attachments` is accepted and dropped** on both message surfaces, matching the `PropertyVerification` precedent. The wire field exists, the behaviour does not | contract | Low | when the frontend actually attaches files to a message |
| D50 | **Ops has no unread signal on support tickets** — `support_tickets.unread` is a single boolean, so it had to mean one thing: "a reply the raiser has not read". A staff member cannot see which tickets have a customer reply waiting. Needs a second column or a per-side read table, not an overload of this one | design | Med | when a support queue screen exists |
| D51 | **No platform-wide support list** — S47 narrowed `GET /support/tickets` to the caller's own for every role, because "every support conversation on the platform" as one unpaged array is a PII export. Admin therefore has no support overview | design | Med | with the Admin & Analytics slice, as a paged `/admin/support-tickets` |
| D52 | **The frontend models a conversation `state`** (`active`/`incoming`/`pending`) in `frontend/src/lib/chat.js` that the contract has no field for. The contract wins; the UI will need either a derived value or a spec change | contract | Low | when the React client is wired to the real API |
| D53 | **A conversation is not moderatable** — participants only, staff and admin included, so a reported chat cannot be read by anyone. Deliberate (a role check hidden inside the participant guard is how private surfaces quietly stop being private), but moderation will need its own audited endpoint | design | Low | when abuse reporting covers messages |
| D54 | **Find-or-create on a conversation races to a 409** — two simultaneous first messages produce one row and one unique-index violation. Downgraded from a 500 in slice 13: `GlobalExceptionHandler` now maps `DataIntegrityViolationException` platform-wide. The loser still does not get handed the existing thread, it just gets a truthful status | reliability | Low | when a client complains — but **not** by catching the violation and re-reading: a constraint violation dooms the JPA transaction, so the retry has to happen outside it (a `REQUIRES_NEW` helper bean or a controller-level retry), which is more machinery than a truthful 409 and a client retry are worth today |
| D55 | **`sameDevice` and `sameIp` on a referral are always false** — no device fingerprint is captured anywhere and the request IP is not recorded, so the two strongest self-referral signals are absent from the fraud desk. Reported as `false` rather than omitted because the contract requires the fields; an absent signal is safer than a fabricated one, but the desk is working blind on exactly the fraud it exists to catch | design | Med | when request-IP capture lands (needs a proxy-header policy first) |
| D56 | **The `qualified` referral status is never produced** — a referral goes `pending` → `rewarded`/`rejected`. `qualified` was meant to mean "the invitee did something real", but nothing tracks invitee activation, so staff approve on judgement alone | design | Med | when there is an activation event worth gating on (first listing, first lead, first payment) |
| D57 | **`past-due` and `expired` subscriptions are never produced** — both statuses exist in the contract and in `SubscriptionStatuses`, but nothing ages a subscription past its `endsAt`. A lapsed paid plan keeps entitling forever until a human intervenes | reliability | **High** | before the first paid subscription renews — needs a scheduled job, which the platform does not yet have |
| D58 | **A service order has no status-advance endpoint** — `ServiceOrder.status` and `amount` can only change by direct SQL. Ops can take an order but cannot quote it, progress it or close it through the API | design | Med | with the ops back-office slice |
| D59 | **A boost does not influence search ranking** — `boosts` records a paid window and `PropertySearch` ignores it entirely, so the thing being sold does not yet do anything. The window is recorded correctly, which is what makes this safe to defer, not correct to ship. *(Narrowed by the API-polish pass: `GET /me/properties/{propId}/boost` now exists, so an owner can at least see the window they bought. What is still missing is the window doing anything.)* | design | **High** | before boosts are sold to a real customer |
| D60 | **`Referral.channel` is derived from the referrer's role, not from how the link was shared** — there is no share-channel parameter on redeem, so the field describes the wrong dimension. Harmless until someone builds a report on it | contract | Low | when redemption carries a share context |
| D61 | **Referral farming is caught by humans, not by code** — one person with several mobile numbers can redeem repeatedly; only `uq_referrals_referred_mobile` and the staff fraud desk stand in the way. Deliberate: automated velocity blocks would reject genuine roommates and flatmates, which is the platform's most common referral. Revisit only with D55's signals in hand | design | Med | when the reward budget makes manual review too slow |
| D63 | **`payoutsCompleted` and `refunds` on `/admin/finance` are structurally zero** — no payout and no refund path exists anywhere on the platform (`payout_accounts` stores a destination and nothing writes a remittance). Reported rather than omitted so the figures move the day payouts ship instead of appearing from nowhere, but a finance screen showing four numbers of which two can never be non-zero invites the reader to trust all four equally | design | Med | with the payout execution slice |
| D64 | **Boost revenue is counted from `starts_at`, not from a payment record** — `BoostStatuses.EXPIRED` conflates "the window closed" with "the payment failed", so the status column cannot answer "was this paid". `starts_at` is set only by `activate`, which makes it the truthful marker today, but it is a proxy: the day a boost can be activated without payment, revenue silently overstates | reliability | Med | when boosts gain a comp/manual-grant path |
| D65 | **Service orders are excluded from platform revenue** — `service_orders.amount` is a quote, not a receipt, and the marketplace takes no money through the gateway, so counting it would report revenue the platform has not received. The consequence is that `/admin/finance` under-reports the moment the marketplace does start collecting | design | Med | when a service order has a payment path (see D58) |
| D67 | **`settings.permissions` and `settings.customRoles` are stored and never read** — the contract declares both, the settings endpoint round-trips both, and no guard anywhere consults either. Authorisation is `@PreAuthorize` on four fixed roles. An admin who edits the permission map will believe they have changed access control and will be wrong. **Decision taken 2026-08-07: wire it, do not remove it.** That settles the "wire or remove" trigger and makes this a scheduled slice rather than an open question — but it is a slice, not an afternoon: it needs a permission-resolution layer, the four role checks rewritten to consult it, and a migration for accounts whose stored map disagrees with their role. Until then the fields are still inert, so the settings screen must not render a permissions editor | security | **High** | **decision made — wire it**; needs its own slice (resolution layer + guard rewrite). Do not ship a permissions editor before it |
| D68 | **The abuse-report queue is absent from the admin dashboard** — `pendingModeration` counts `properties` awaiting a decision and deliberately does not fold in `reports`, because the two queues are worked by different people against different SLAs. The consequence is that the one scorecard ops looks at does not show the reports backlog at all | design | Med | when the dashboard grows a second queue tile |
| D69 | **The analytics series is computed on every request with no cache** — four grouped scans, up to 366 buckets, available to any staff account with no throttle beyond the bucket cap. Correct and cheap at today's data volume; the first slow morning will be this endpoint | performance | Low | when a table it scans passes ~1M rows |
| D70 | **A poster's only record of who answered is the notification stream** — the contract has no "who replied to my ad" endpoint and `share_flat_interests` is not readable over the API, so the sender's name and number exist for the poster only as a notification. Dismiss it and the lead is gone, with the row still sitting in the table | design | Med | when share-flat gets a second screen — needs a spec addition, so it could not be fixed inside the slice |
| D71 | **Nothing can take a share-flat post down** — `share_flat_posts.archived` is written by no code path and the contract declares no delete or archive operation, so the five-live-post cap can be reached and never relieved. The 429 message was reworded to say "contact us" rather than "archive one", because the obvious advice is advice to do something impossible | product | **Med-High** | the sixth post a real user tries to write — needs one spec operation |
| D72 | **Share-flat posts are published unmoderated** — they appear on a `security: []` page the moment they are written, with no queue, no report action and no takedown (D71). Every other public-facing thing a user writes (listings, reviews) passes a moderator first. The board is free-text `title` and `locality`, which is exactly where a broker puts a phone number to route around the contact rules | moderation | **Med-High** | before the board is linked from anywhere public — pairs naturally with D71 |
| D73 | **Every rate limit on the platform is check-then-write and therefore racy** — `OtpService`, `SocietyLeadService` and `ShareFlatService` all `countBy…` and then insert, with no lock between the two. Concurrent requests all read the pre-insert count and all pass, so a burst clears a cap that a serial client could not. Raised by `security-reviewer` against share-flat's ten-interests-per-hour cap, recorded platform-wide because fixing one caller and leaving two is worse than fixing none. Bounded in practice: every send carries the sender's own OTP-verified number, and the unique index still stops repeat contact of the same person | security | Med | with D2 — the same infrastructure (a principal-keyed limiter with an atomic counter) answers both, and neither is a per-service patch |
| D76 | **The client's foundation-field list disagrees with the server's, in both directions** — `lib/store/listings.js` names twelve fields; the server reverts on the seven *searchable* ones. The client warns on `title`/`area`/`facing`/`floor`/`age` (which do not revert) and stays silent on `price` (which does), so the UI both threatens re-moderation that will not happen and conceals the one that will. The server half is fixed and self-enforcing (`ListingFoundationTest` reads the facets by reflection); this is the client half | frontend | Med | before the listing domain flips to http — it is a wrong warning on the owner's most consequential edit |
| D77 | **Sixteen more per-user reads grow with inbound demand and are still unpaged** — `/me/contact-requests`, `/me/offers`, `/me/visit-requests`, `/me/flatmate-requests`, `/me/finalization-requests`, `/me/documents/requests`, `/me/deals`, `/visits`, `/tenancies` and others. Rows are written by *other* users, so §5.1's "one user's own actions" test does not apply to them; the successful owner is the one an unpaged read punishes. `/me/saved` and `/messages` were paged in the API-polish pass because they were the largest payloads; the rest were left because the shape change is breaking and the frontend has no consumer for them yet | design | Med | with each domain's http provider — page it in the same change that first reads it, not after |
| D79 | **`GET /properties/{propId}/reviews` cannot be paged while the client computes the rating summary** — ruling D8.6 permits the unpaged read because the per-target UNIQUE index bounds it, and the property page computes the star average, the 1–5 distribution and the per-category averages from the full list. The bound is real, so this is not urgent; recorded because "page everything" applied here would make three visible numbers silently describe page one. `ReviewRepository` already has the aggregate query if the summary ever moves server-side | design | Low | only if the aggregates move server-side |
| D80 | **`FlatmateRoomDto` is 47 fields, by a distance the largest DTO on the platform** — the next largest is `PropertySummary` at 22. It is returned by the room feed, the mixed flatmates feed and now `GET /properties/{id}/rooms`. Not wrong today (rooms per flat is naturally small, and the derived occupancy fields are the point), but a 47-field row is a DTO that has stopped being a view of anything and become the entity with a different name | design | Low | if the flatmates payload ever needs trimming — split the feed shape from the detail shape |
| D84 | **The alert switch is a boolean over a four-state server field** — `SavedSearch.alertFrequency` is `off\|instant\|daily\|weekly`, but the only control is an on/off `Switch`, so the seam derives `alerts = alertFrequency !== 'off'` and writes back `daily` when switched on. Currently unreachable loss (nothing can produce a non-default cadence), but the moment a frequency picker ships, a user holding `instant` who toggles off and on lands on `daily`. The seam carries `alertFrequency` explicitly so the fix is a UI change, not a contract change | design | Low | when a cadence picker is designed |
| D85 | **Anonymous alert capture has no server home** — `NotifyMeCard` and `FlatmateAlertCard` exist to capture a *signed-out* visitor's demand against a mobile number, but `POST /me/saved-searches` is caller-scoped and `SavedSearchCreate` carries no `mobile`, so the call would 401 for exactly that visitor. Both cards now split: signed in → the seam; signed out → localStorage as before, so the alert is still claimed on this device after sign-in. The http provider throws a named error rather than silently writing locally while every read comes from the server — that would produce an alert the user was told they created and can never see again | design | Med | needs a public demand-capture endpoint, or an explicit "sign in to create an alert" product decision |
| D87 | **A visit cannot be rescheduled through the API** — the dashboard offers reschedule (pick a new slot, visit returns to `scheduled`), but `PATCH /visit-requests/{id}/status` carries a status and a note only, and there is no slot-update route. The http provider throws a named error rather than substituting cancel-and-rebook, which would mint a new id (breaking the row the UI holds), discard the visit's history, and hit the duplicate-visit 409 against the row it had just cancelled | design | Med | needs `PATCH /visit-requests/{id}` accepting a slot, or an explicit product decision that rescheduling is cancel-and-rebook |
| D88 | **`parseWhen` discards the year and reconstructs it from "now"** — the human `when` string carries a year (`"19 Jul 2026, 10:30 AM"`) but the parser matches only day + month and rolls forward when the result would be in the past. Harmless for upcoming visits, which is every visit the calendar sorts; wrong for a *completed* visit, which displays a year in the future. Surfaced while adding the slot↔when conversion for the visit slice: the parity harness has to use a future date for its round-trip assertion to mean anything | bug | Low | when visit history gets a real view — parse the year the format already contains |
| D91 | **The verification queue still cannot be enumerated** — `PropertyReviewRepository` exposes only `findByPropertyId(UUID)`, so the maker-checker case files (`/properties/{id}/verification`) can be read and decided one at a time but never listed. `GET /admin/properties?status=pending` now finds the *listings* awaiting review, which is what the Verification tab renders, so the tab works; what is still missing is a list of open **review cases** with their checklists and threads. `ensureReview`/`decideReview` therefore stay on `lib/` for now — wiring the decision without the list would let ops decide a case they cannot find | design | Low | when the verification thread UI is wired — needs a paged finder + `GET /admin/property-reviews` |
| D92 | **Almost nothing writes notification rows** — `new Notification(...)` appeared at exactly five call sites, all flatmates (`FlatmateSeekerService` ×2, `FlatmateSupplyService` ×2, `FlatmateModerationService`). A contact request approved, a visit confirmed or rescheduled, a listing approved or rejected, a document share granted, an offer made — none of them notify anyone. The inbox is wired to the API and correct; it is simply near-empty for any user who has not used flatmates, which is why the notification seam still merges client-derived alerts. **The gap is in the writers, not the seam.** *Partially closed 2026-08-06 by the conversations slice:* `ConversationService.send` now writes a `message.received` notification to the other side, through a new `common.trust.Notifier` port implemented by `engagement.notification.NotificationPublisher` — that port is the reusable mechanism, so the remaining writers are one injected dependency and one call each, not five more repository imports | design | **Med** | one writer per slice as each domain is touched — messages done; moderation and contact are the two with the clearest remaining need |
| D93 | **`dismiss` on a notification is a client-side tombstone** — there is no `DELETE /notifications/{id}`, so the http provider records dismissed ids in `pnDismissedNotifs` and filters reads through them. Consequences, all deliberate and all documented on the provider: it does not sync across devices, clearing site data brings the row back, and the unread count excludes tombstoned rows so the bell stays clearable. Chosen over hiding the X in http mode (removes a working control) or throwing (a dead button) | design | Low | needs `DELETE /notifications/{id}`, or a product decision that dismiss is device-local |
| D94 | **Notification preferences have no server surface at all** — `getNotifPrefs`/`setNotifPrefs`/`inQuietHours` cover email/sms/whatsapp channels, a master `matchAlerts` switch, quiet hours and language, and every one of them lives only in localStorage. `ProfileTab.jsx` was deliberately not touched by the notification slice for that reason. The practical consequence is that quiet hours suppress *client-derived* alerts only — a server-written notification arrives at 3am regardless, because the server has never been told | design | Low | needs `GET/PUT /me/notification-preferences`; pair it with the D92 writers, which are what would have to honour it |
| D96 | **14 specs still carry a local console-noise filter or none at all** — the 2026-08-07 pass moved **31** onto `helpers/console.js` and merged every local pattern into the shared `IGNORE` first, so consolidating could not silently *tighten* a spec. What is left is the tail: `search-property-types.spec.js` keeps a self-contained `pageerror`-only helper, `live-property-integration.spec.js` was left alone as in-flight work, and ~12 specs assert on `pageerror` only. **The register's "50 of 67 filter nothing" was wrong** — measured, only **9** had a genuinely unfiltered `console` listener; 35 track `pageerror` alone, which no proxy or CDN can manufacture, so they were never exposed to this defect | test-gap | Low | fold the tail in when those files are next touched |
| D98 | **Two mobile items blocked on a design/product call, not on engineering** — (a) at 200% font scale the raised centre "Post" slot cannot fit a 56px circle plus a 24px label in a 56px bar (needs ~74px), so that one label squeezes; the fix is to drop the redundant text under an already-`aria-label`led FAB, which is a design decision. (b) "B7" bottom-nav density: 7 targets and 265px of painted control in a 360px row, with the account pill ending at exactly x=360 — real and measured, but the item's suggested escape hatch does not exist, so it needs a call on what leaves the bar | design | Low | needs a design/product decision before any code |
| D99 | **Swipe-to-remove on Saved deferred** — *narrowed 2026-08-08: the sheet half already shipped.* `useSwipeDismiss` is wired into `Select.jsx` ("drag the grab handle down to dismiss"), so sheets are done; the register was still recording them as deferred. What remains is the **destructive** gesture: removing a shortlisted property by swipe. That needs an undo affordance to be safe, which is real state machinery for a P2 win, so it stays deferred deliberately | design | Low | only alongside an undo affordance |
| D100 | **The parity harnesses write into the dev database and cannot clean up** — `review-parity.mjs` posts a real locality review on every run, and reviews are **public**, so "Parity probe review." renders on `/locality/aundh` to anybody browsing. This was found the hard way: the first version of the live reviews e2e asserted on "seeded" aundh reviews that turned out to be four rows the harness had littered — *a test whose fixture is another tool's litter*. The e2e now writes its own fixture; the harness pollution remains. `conversation-parity.mjs` does the same but its rows are private, so the blast radius is smaller | testing | **Med** | needs either `DELETE /reviews/{id}` (moderation can hide but not remove), or the harnesses pointed at a dedicated throwaway database rather than `punenest` |
| D114 | **No batch endpoint for "is this person a verified tenant"** — `GET /tenant-profiles/{mobile}` answers it for one person, but every caller (`DealPanel`, `ReviewsSection`, `useFlatmates`) asks during render, about someone else, **inside a list**: the verified tick beside each offer, applicant and reviewer. Converting it would be one request per row — the N+1 the shortlist and the deal book were restructured to avoid, with no batch endpoint to restructure into. `isTenantVerifiedFor` therefore stays on localStorage and fails closed (a verified tenant may lose a badge; an unverified one can never gain it). Documented as a SEAM NOTE at the function | contract | Med | `POST /tenant-profiles/verified` taking a list of mobiles, or a `verified` flag on the party objects already embedded in offers and visits |
| D115 | **Deposit financing has no endpoint and no home** — the Pay Rent screen offers a security-deposit financing product, and the mock recorded it as a **rent payment** (`type: 'deposit-finance'`) in the same bucket, which every reader then had to filter out. It is not a rent payment: it is a loan. Against the API it cannot be written at all, so it is now local-only component state and disappears on reload. Either the product is real and needs a table and endpoints, or it should be removed from the page | product | Med | decide whether deposit financing ships; if so, model it separately from `rent_payments` |
| D118 | **`flatmate_group_members.name` is `NOT NULL` but sourced from nullable `users.name`** — `FlatmateSupplyService.join` passed `joiner.getName()` straight into the row. OTP sign-in never sets a name, so joining a group 500'd for exactly the users who had just signed up — the ones least able to interpret it. Fixed by falling back to `"Member"`. The underlying mismatch stands: a column the schema insists on, fed from one the schema does not | correctness | Med | either make `users.name` required at sign-up or make the member name nullable and render a fallback |
| D120 | **Service-request documents are multipart to the vault and do not resolve in dev** — draft and final documents are `multipart/form-data` returning **signed URLs** that a dev backend does not serve, and there is no customer upload surface behind the tracker (sharing a draft and uploading a final are staff transitions). The seam projects `draft`/`finalDoc` from `documents[]` by category for when they exist, but a customer-created request carries neither, and the per-request **document checklist** (six named items in the mock) has no read representation on the wire. So the tracker's document column and inline `draft.dataUrl` preview are mock-only; live mode shows the thread and the status, not the paperwork | design | Med | a dev-resolvable document surface (or a checklist read endpoint) before the tracker's document UI can flip to http |
| D121 | **Co-fill service requests have no counterparty endpoint** — the mock splits a rent agreement across two mobiles (`serviceFlow.createCoFill`, `listForParty`), keyed on the *other* party's `ownerMobile`; the customer API scopes every request to its requester, so there is no party view to fetch. `listPartyServiceRequests` returns `[]` in http mode (never `undefined` — the tracker spreads it) and `useRentAgreement.js` create stays on `serviceFlow.create` because its create is a co-fill. Also here: `markServiceRequestRead` is a no-op (no read-receipt endpoint) and `changes_requested` collapses server-side to `in-progress` (the maker-checker has `approve`/`reject` only), so a rejection is unrecoverable from the read shape | design | Med | a co-fill invite endpoint (and a distinct `changes_requested` state) if the two-sided rent-agreement flow ships live |
| D122 | **The Aadhaar badge cannot be earned in dev, and two mock affordances have no wire home** — `startAadhaar` is a **202 pending handle**, and the badge is granted only by the DigiLocker webhook (`POST /webhooks/digilocker`), which a dev backend never receives. So in http mode a user can start verification but never finish it: the badge stays `pending`, and the live suite asserts exactly that. Two mock-only pieces have no server counterpart and stay in the mock provider: the **growth perk** (`applyVerifiedBadgeToListings`, an instant listings boost on grant — the live handle's `perk` is null) and **`aadhaarMobile`** (DigiLocker returns no mobile, only the masked last four; the mapper carries it as `''` so mock and live answer the same keys). Not a bug — the seam is honest that the grant is a webhook away — but the badge's happy path is undemonstrable without a stubbed webhook | design | Med | a dev-only "simulate DigiLocker success" webhook trigger (or a seeded verified `identity_verifications` row) so the earned-badge state can be exercised in http mode |
| D123 | **The document seam is the owner's side only — the buyer's half has no faithful server mapping** — `documentService.js` covers the vault (list/upload/delete a listing's files) and the owner's request inbox (list/respond, `/me/documents/{propId}` and `/me/documents/requests`). The buyer's half cannot follow: the server is **token-mediated** (`POST /documents/requests` then `GET /documents/shared?token=`), giving a buyer no way to poll a request's status, so `DocumentsSection`/`ViewDocuments` keep reading `lib/data/documents.js` cross-user localStorage directly (never through the service). Also staying on `lib/`: the cross-user grant notification (`notifyBuyerDocsGranted`), the shared-doc count (`countSharedDocs`), the owner dashboard's per-listing doc-count badge, **rent agreements** (they overlap the already-live tenancy flow — created as a side effect in `lib/data/tenancy.js`), and every presentation helper (`DOC_CATEGORIES`, `DOC_INFO`, `docInfo`, `formatSize`, `docIcon`, checklist progress). The vault's signed-URL preview does not resolve in dev (the D120 pattern), so `toDoc` carries `url` for a viewer but the bytes only exist behind the mock's `dataUrl` | design | Med | a buyer-facing request-status read (`GET /me/document-requests` scoped to the requester) would let the buyer half join the seam; until then it is deliberately mock-only |
| D125 | **The flipped document vault degrades badly on failure** (item 2 resolved 2026-08-08) — Slice D moved the owner vault's list/upload/delete and the owner request inbox onto `documentService`, which is correct but surfaced four more rough edges the synchronous store never had, all resolved 2026-08-08 (see below). **(1)** every load `.catch`es to `[]`, so a failed `GET /me/documents/requests` does not degrade the buyer-request panel, it **removes** it (the whole card is gated on `docReqs.length > 0`) along with its pending badge — an owner is told they have no requests when the truth is the read broke; the same shape makes a failed vault read render a confident, wrong `0/10` loan checklist. **(1) — RESOLVED 2026-08-08:** each of the three lists now carries a `loading`/`error`/`ready` status, so a failed read shows a retry affordance instead of removing the panel, and a failed vault read no longer paints a confident wrong checklist (the checklist is hidden until the vault is `ready`). **(2) — RESOLVED:** `useDashboardData` now reads the inbox through `listDocRequests` and grants through `respondDocRequest` (the seam), the same service `DocumentsTab` uses, so the Documents tab, the `leads` badge and the Action Center share one source of truth and a grant issued from the dashboard reaches the server in http mode; `countSharedDocs`/`notifyBuyerDocsGranted` stay mock-only behind `!isHttpDomain('document')`. Covered by `consumer/account/doc-requests-grant.spec.js`. **(3)** there is no loading state: all three lists start `[]`, so a full vault first paints as an empty one (ring `0/26`, every tile in Upload) and then snaps — the late reflow is what destabilised `doc-info.spec.js`. **(3) — RESOLVED 2026-08-08:** a loading vault renders a skeleton and an indeterminate ring instead of a false `0/N` that snaps. **(4)** `uploadForCategory` captures `targetProp` but `setTick` refetches the *current* property, so uploading while the selector moves toasts success next to an unchanged tile; and `tick` is one scalar across all three effects, so one grant costs four round trips while the provider's own post-mutation return value is discarded. **(4) — RESOLVED 2026-08-08:** `tick` is gone; each mutation applies its provider return value to the one list it belongs to, guarded by a ref so an upload never lands on the wrong flat when the picker moves, and a grant patches only the answered row. **(5)** the http grant branch always toasts success, losing the mock's honest `approvedNoDocToast` for a category with no file behind it; and `openDocUrl` opens **any** `https?://` the API returns, so a dev signed URL (D120) yields a blank tab with a DNS error instead of the `noPreviewToast` it would have shown. **(5) — RESOLVED 2026-08-08 (viewer half):** the viewer treats the non-resolving dev storage-stub URL as non-previewable and shows `noPreviewToast`; the http grant toast is intentionally left as success — live mode has no client-side doc count to flag an empty grant, and the server is authoritative there | design | Med | all five items are resolved (item 2 by the dashboard-seam slice, items 1/3/4/5 by the `DocumentsTab` cleanup); delete this entry once both land on the same branch. The only deliberate residue is the live http grant toast noted in (5) |
| D128 | **The app has no offline or connectivity-failure state at all** — `navigator.onLine` returns zero matches across `frontend/src`. The service worker serves a cached shell, so on a dropped connection the app renders normally and every data call fails silently: the user sees an empty page, not an explanation. On the target device (mid-range Android, patchy 4G) this is the common case, not the edge case | frontend | **Med-High** | one shared connectivity banner + a retry affordance on the async-list hook that already carries `loading`/`error` |
| D129 | **~570 KB raw of application data is eagerly bundled onto the critical path** — `mockApi/core.js` imports `db.json` (236 KB), `societies.js` imports `societies-rera.js` (182 KB), and `i18n/index.js` uses `import.meta.glob(..., { eager: true })` for all locales (247 KB). The bundle-size gate (`npm run check:size`, CI line 81) guards against *regression* but was set above the current mass, so it locks the problem in rather than fixing it | frontend | Med | `db.json` should go with the mock seam; RERA data behind a dynamic import; load one locale eagerly, the rest on switch |
| D130 | **No bot defence on the public lead forms** — `captcha`/`recaptcha`/`turnstile` return zero matches in both `backend/` and `frontend/`. D2/D73 cover rate limiting, which is a different control: a limiter throttles a known principal, and these forms (`/society-leads`, share-flat, service quotes) accept anonymous posts. ADR-015 already chose the answer (Cloudflare Turnstile at the edge) — it was simply never wired | security | Med | wire Turnstile per ADR-015 before the lead forms see real traffic |
| D131 | **Uploaded documents are never scanned** — `virus`/`clamav` return zero matches in `backend/`, and there is no async worker anywhere (`outbox`, `KafkaTemplate`, `ApplicationEventPublisher` all zero). The vault accepts 10 MB files and hands back signed URLs that other users can open. ADR-013 explicitly deferred malware scanning; this row is that deferral made visible, not a new finding | security | Med | scan-on-upload before the vault is shared outside the owner |
| D132 | **Owner finance summaries scan the ledger on every request** — `/me/finances/{propId}/summary` and `/cashflow` aggregate per call with no rollup table (nothing named `*_rollup`/`*_summary` in 33 migrations). Distinct from D69, which covers the *admin analytics* series; this is the per-owner path that grows with each rent cycle | performance | Med | a maintained rollup, or accept and measure once real ledgers exist |
| D133 | **No aggregate/BFF endpoints** — `/me/dashboard` returns zero matches in both the Java tree and the OpenAPI spec, so the dashboard fans out to many small calls (the D-series has already caught one 4× duplicate fetch there). Recorded as an explicitly unresolved proposal rather than a decision | design | Med | confirm against the real dashboard call count before adding a bespoke aggregate |
| D134 | **No enforced minimum text size, and nothing that could enforce one** — the blanket 12 px floor was never applied (a large diff across ~40 files), and there is no legibility spec: `e2e/tests/mobile/` holds 25 specs and none sweeps computed font sizes. The `/property/:id` five-stat band renders all five labels at 11 px | design | Med | land the floor and the sweep together, or neither holds |
| D135 | **Three routes still show a full-screen spinner instead of a skeleton** — `/dashboard`, `/flatmates` and `/society` are not among the four files using the `skeleton` class (`Featured`, `listings/ResultsArea`, `Property`, `dashboard/DocumentsTab`). On a slow connection a spinner communicates less than a shaped placeholder and causes the same late reflow that destabilised `doc-info.spec.js` | frontend | Med | reuse the existing skeleton pattern |
| D136 | **The tap-target sweep does not walk the routes with the worst offenders** — measured but unswept: `/messages` tabs 172×32, `/dashboard` "View all" 48×20, `/society/:slug` breadcrumbs 55×20, `/help` article links 186×15, plus the whole admin/field-ops surface (topbar icons 28×28, row `View` 51×28). Admin needs an authenticated fixture the mobile projects do not carry, which is why it was skipped | e2e | Med | extend the sweep; the admin half needs the fixture first |
| D138 | **No Lighthouse or performance run in CI** — `.github/workflows/ci.yml` runs lint, i18n, help, build and `check:size`; nothing measures FCP/LCP, so the stated mobile performance targets are unverified by anything | build | Low | add once D129 has moved the bundle, or the first run just records the problem |
| D139 | **No pull-to-refresh on any list surface** — zero matches for `pull-to-refresh`/`usePullToRefresh`. Distinct from D99: that gesture is destructive and needs undo, this one is not | frontend | Low | one hook, applied to `/listings`, `/saved`, `/notifications`, `/messages` |
| D140 | **The services landings ship 1.26 MB of hero imagery** — the heaviest image payload measured anywhere in the app. `srcSetFor` is imported only by `Featured.jsx`, `listings/Card.jsx` and `property/Gallery.jsx`; the service pages never got it | frontend | Low | put the service heroes on the existing `srcSetFor` helper |
| D141 | **`/property/:id` is 5,447 px of scroll with no progressive disclosure** — the page has section tabs but no per-section collapse (`accordion`/`Collaps` matches only a comment). On the most important page in the funnel, the mobile user scrolls past everything to reach anything | design | Med | collapse the low-intent sections by default |
| D142 | **The mobile home fold has no search entry point** — the hero search panel is `hidden lg:block` by deliberate design (it cost 286 px) and no compact tap-to-search pill replaced it, so a first-time mobile visitor must already know to use the bottom-nav Search tab | design | Low | a single-line search pill, not the full panel |
| D143 | **The Saved tab strip is still a horizontally-scrolling pill row** — the signed-out shortlist state shipped, but the strip itself hides tabs off-screen on a 360 px viewport with no affordance that more exist | design | Low | reuse the bottom-sheet switcher, or wrap to two rows |

### Detail on the ones that need it

**D2 — rate limiting on authenticated writes.** Raised by `security-reviewer` during slice 3 and
deferred each slice since as platform-wide. Today only `POST /auth/login` is limited (OTP send, the
one `429` in the contract). Every slice since has added more authenticated write surfaces — contact
requests, offers, visits, reviews, saved searches. The right shape is a filter or interceptor keyed
on principal id, not a per-controller annotation. **This is infrastructure work that should land at
first deploy, not another slice's scope creep.**

**D5 — owner `hideNumber`.** The frontend mock has the preference; there is no backing column and no
contract field. Would live as `users.hide_number boolean not null default false`, masking the owner
mobile *even after approval*. Blocked on a product decision — `open-questions.md` Q2.

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
