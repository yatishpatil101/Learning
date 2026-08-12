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

- **Sandbox-verify plans + L&L together.** `backend/run-local.ps1` (Zulu 25, real `TEST_` keys,
  `CASHFREE_ENABLED=true`) + frontend with `VITE_API_DOMAINS` covering `plan`/`serviceRequest`.
  Drive `/checkout?plan=owner2` *and* the rent-agreement wizard through real Cashfree sandbox, and
  confirm the webhook moves each off its pending state. `npm run parity:serviceRequest` also needs
  the live backend (it prompts for an OTP) and has not been run against the paid path.
  **No e2e can cover this**: e2e runs mock-mode and the mock provider returns no `paymentSessionId`,
  so the checkout branch is unreachable there by design.
- **Every developer now needs `PUNENEST_DEV_MACHINE` set** or the backend refuses to start under the
  `dev` profile — see [`docs/LOCAL_DEV.md`](../docs/LOCAL_DEV.md), "One-time setup".

## Needs attention (not mine, not yet actioned)

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
- **Still-flaky specs — do not "fix" by relaxing an assertion:**
  `consumer/search/commercial-type-filter.spec.js:60`, `consumer/flatmates/video.spec.js:27`,
  `consumer/flatmates/prefreeze.spec.js:66`,
  `platform/desktop-noleak-guardrails.spec.js:267,282,291,328`, `admin/content.spec.js:59`. All
  animation/timing dependent — the shape that fails under CPU contention. Never run `graphify` or a
  build on the same machine during an e2e run.


## Next up

**The seam is complete — all 18 domains have a live consumer** (every
`frontend/src/services/providers/http/*Provider.js` is in `VITE_API_DOMAINS`). No next domain to flip.

- **Documents** — flipped on the honest subset; D124 closed, D125 fully resolved (2026-08-08). Buyer
  half, `useRentAgreement` vault reuse, `DocVault`, `PropertyPassport` stay on `lib/` by design (D123).
- **Societies** — UNBLOCKED (D104 closed 2026-08-08): catalogue now seeds the full 348 societies +
  155 localities and `GET /societies` carries `avgRating`/`reviewCount`. The service + provider +
  call-site flip is the next society-domain slice — not yet built, no longer 404s on real slugs.

---

## Shipped

Newest first. **A finished slice gets one index line, not a narrative** (see the rule at the top).
Entries below are collapsed to that form once committed — git history holds the full write-up.

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
| 2026-08-12 | **D133 closed won't-do, D158 re-verified still blocked — both were measurement tasks, and both registers were wrong about something.** D133: measured the dashboard load against a **production** bundle (`vite preview`, `VITE_API_DOMAINS=property,visit,contact,document`, Playwright intercepting `**/api/**`) — **6 requests / 6 distinct endpoints / 0 duplicates**, all concurrent, same for owner and seeker. The 4× duplicate the row remembered is gone, so no `GET /me/dashboard` was added. Two traps, both of which gave a wrong number first: the same run on `vite dev` reports **13 requests, every endpoint 2×** (`StrictMode`, dev-only), and `page.route` reported **0** for the seeker while the Vite proxy logged all six — page-level interception misses service-worker requests, so always corroborate a zero against the server log. D158: `RedisEval` still cannot ship; `mvnw -o dependency:get` confirms `spring-boot-starter-data-redis:4.1.0`, `lettuce-core:7.5.2.RELEASE` and `reactor-core:3.8.6` are all absent, and the online run times out against the mirror, so the "first time the build runs online" trigger has not fired. Corrected a stale claim in both the row and `RedisEval`'s javadoc: `netty:4.2.15.Final` **is** cached and stopped being a blocker; the trigger is now a runnable command instead of a paragraph. Guards green (37 tests, 0 failures) |
| 2026-08-08 | **Encoding guard restored (D126 closed).** Stripped UTF-8 BOMs from 18 committed files via `node e2e/scripts/fix-mojibake.mjs` (BOM-only — 0 content bytes changed); `SourceTreeHygieneTest.noMojibakeOrBom` now green, so the ban on non-UTF-8 source writes is live again. Disproved D126's guess that the BOM broke `listing-freshness.spec.js` — it still fails on a nudge-banner assertion after the strip, so the two standing mock e2e failures are functional drifts, not encoding (re-recorded as D127) |
| 2026-08-02 | Re-sync docs + OpenAPI to the flatmates redesign & mobile-first UI |
| 2026-07-27 | 3-way sync: `platform-architecture.md` (SOT) → OpenAPI → React |
| 2026-07-26 | OpenAPI established as the single source of truth; matured to cover all React needs |
| 2026-07-25 | Platform & solution architecture (MVP pass), ADR-009a KYC, ADR-014 payments, legal/compliance advisory |

