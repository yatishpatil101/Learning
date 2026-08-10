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
> Compressed 2026-08-06 from 5,294 lines, and again 2026-08-09 from 527 (the 2026-08-06/07 seam
> narratives were collapsed into their one-line rows in the seam table below; the reasoning they
> carried already lives in the code and docs they describe).

---

## In flight

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

- **`RentMapper` carries a one-line `@Mapping(..., ignore = true)` that belongs to whoever is doing
  D167.** The working tree already held uncommitted D167 work (`RentPaymentDto.withPaymentSessionId`),
  which MapStruct reads as a second writable target under `unmappedTargetPolicy = ERROR`, so the
  backend would not compile. The ignore is an unblock, not a decision — delete it and map the field
  properly when D167 lands.
- **The two new 409s (D160) have no e2e coverage and cannot have any yet.** e2e runs mock-mode and
  the mock provider opens no gateway order, so there is no unpaid row to collide with; the cap is
  covered at the API level instead by `UnpaidOrderCapTest` (13 tests, both families, index names
  pinned) and the sweeps by `BillingCheckoutSweepTest` / `RentCheckoutSweepTest`. Revisit when the
  sandbox-verify item above gives e2e a real checkout to drive.
- **`backend/.env.local` was surfaced into an editor context during the 2026-08-09 debt wave.** It is
  git-ignored and was never committed, but it holds live sandbox secrets (Cashfree TEST secret key,
  R2 access key + secret, Supabase DB password) and its own header says not to paste it anywhere.
  Rotate if there is any doubt about where that context went.

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

### 2026-08-11 — D174, D175, D50/D51, D100, D42 and the e2e reliability pair (D28/D29)

Six parallel lanes. Six register rows deleted outright, two rewritten to the part of themselves that
is still true, and five new rows opened from findings the lanes surfaced along the way. Backend
**1079 tests, 0 failures, 3 skipped** (up from 1056); frontend lint 0 errors, i18n gates pass, build ✓,
bundle unchanged at 533.0 KB; targeted e2e 42 passed; spec clean at 179 paths / 159 schemas / 226 ops.

**D174 — an owner could be shown the wrong financial year on the morning their tax figure matters.**
`FinanceService` read the clock in the JVM's default zone. On a UTC host, between 00:00 and 05:30 IST
the server's "today" is yesterday in India — harmless for a list, not harmless for a boundary. At
02:00 IST on 1 April, `period=year` resolved to the **previous** Indian financial year and said
nothing about it. Closed with a new `common/PlatformTime.IST` constant and two private helpers,
`todayIst()` and `currentMonthIst()`, which are now the only date sources in the class.

The interesting decision was the seam. The clock field is deliberately **zone-agnostic**
(`Clock.systemUTC()`), with `PlatformTime.IST` applied at each use site, rather than a clock that
already carries IST. If the clock knew about IST, a test pinning it would be proving that *the test*
knows about IST. Keeping it zone-agnostic lets `FinanceIstBoundaryTest` pin a **UTC-zoned** clock —
the exact host misconfiguration that causes the bug — so every IST answer that comes back is the
service's own. The test pins `2026-03-31T20:00:00Z` (01:30 IST on 1 April: simultaneously the
previous day, month and financial year to a UTC host) and seeds one row either side, so a wrong
bucket shows up as the wrong rupee total rather than an empty result. It also asserts the cashflow
bucket's **label**, because a series that is a month out but internally consistent still misleads the
chart axis. The clock is set through `AopTestUtils.getTargetObject(...)`: writing it through the
`@Transactional` proxy sets the field on the CGLIB subclass and leaves the target object — whose
methods actually run — on the system clock, so the test would have passed for the wrong reason.

**D175 — the same tap answered 201 or 409 depending on timing.** All three flatmate interest doors
now lock, then re-read, then refuse with one 409 `already_interested`. The unique index catch stays
as an unreachable backstop with a `debug` log, not a `warn` — if it ever fires, that means the lock
has stopped working, which is worth being able to switch on and not worth waking anyone up for.

Two things were silently broken and are now not. On the group door the auto-accept block (add a
member, decrement `seatsOpen`) ran *before* the duplicate refusal, so a repeated press could add a
second membership row and spend a seat. And `FlatmateSupplyEndpointsTest.secondOpenJoinTakesNothing`
asserted `members == 1` — wrong, because the group creator is enrolled at create time, so the
truthful count after one real join is 2. **The production code was right; the expectation was not.**
Asserting 1 would have been asserting the host had vanished. The group-join fixture that was flagged
as missing last wave is now built and real.

**D50 + D51 — the support desk could not see its own queue.** `support_tickets.unread` was a single
boolean, so it could only ever mean one thing: "a staff reply the raiser has not read". Migration
**V53** adds `staff_unread` beside it, leaving the old column's meaning exactly intact so the customer
UI and every existing test still hold. Two booleans rather than a `last_message_at` + two
`last_read_at` trio: three nullable timestamps to derive a boolean the code already stores directly is
more state, not less. Rules are symmetric — the raiser writing (including the opening message) queues
it for the desk, a staff reply queues it for the raiser, neither marks the writer, and
`POST /support/tickets/{id}/read` clears **only the caller's side**. Backfill applies the same rule
once to history so the queue does not ship empty.

`GET /admin/support-tickets` is new, paged, and staff+admin — staff included deliberately, because
they could already read and answer any ticket by id, and withholding only the index leaves them able
to act on tickets they cannot find. `Pageables.unsorted` strips any client `?sort=`, since an
unvalidated sort property is a 500 any caller can guess into. The row shape is a **summary**: no
thread (a page of twenty threads is an unbounded response by another route), no mobile (a list is the
shape that gets exported) and no `notes`. The leak test asserts through the endpoint body *and*
reflectively over the DTO's components — a test reading the column directly would still pass on the
day nothing exposed it, which is the whole defect. `IMPLEMENTED_FLOOR` 216 → 217.

The admin queue **screen** is deliberately outstanding and now carries its own row (D51, rewritten).
`AdminSupport.jsx` is not it — that is the ops board over a different resource on a mock provider.

**D100 — a test harness was publishing to the live site.** `review-parity.mjs` posted a real locality
review on every run, and reviews are public, so "Parity probe review." rendered on `/locality/aundh`
to anybody browsing. It now deletes its own row by the id the create returned, inside a `finally`, so
a contract break does not also cost a public row. Every failure path either deletes exactly one row or
exits non-zero printing the surviving id **and** the `DELETE` to run by hand; the `psql` command tag
is treated as authoritative, so a `DELETE 0` can never read as success. One litter row was found and
removed (`66c9ad47-…`), printed in full before execution.

Two corrections worth recording. The register was **wrong about `conversation-parity.mjs`** — it
writes nothing to the database; its "creates" go to a client-side staging queue which, under Node, is
the in-memory stub the script installs itself. And a review pass caught a **HIGH in the new code**:
the failure path printed the database password, because `execFileSync`'s `Error.message` is
`Command failed: <argv…>` and the argv carries `-d <DB_URL>` — so taking the first line selected
exactly the line with the credential *and* discarded the stderr explaining the failure. Fixed by
preferring `err.stderr` and redacting on the **last** `@`, so a password containing `@` is removed
whole rather than half-shown.

A throwaway database was rejected as impossible here, not merely worse: the harness drives the real
HTTP provider, so the *backend* chooses the database. Read-only was rejected because the write **is**
the assertion — four of the invariants only exist on a row the server actually created.

**D42 — the share token is a 7-day reusable bearer credential in a URL.** Everything closeable is
closed: `LogSafeUri` redacts `token` and friends for any future request logger (denylist, deliberately
— a forgotten allowlist entry leaks a secret, a forgotten denylist entry makes a log noisy), the
Tomcat access-log pattern is pinned to `%m %U %H` so it never writes a query at all, and
`Referrer-Policy: no-referrer` is set chain-wide. The token itself is well built: 256 bits of
`SecureRandom`, scoped to one grant, expiry re-checked on every read rather than trusted to a sweeper,
and never shown to the recipient's counterparty. What remains is the URL — history, bookmarks, proxy
logs, and the recipient pasting it into chat. That needs a new contract operation, not an edit, and
it is **unusually cheap right now**: nothing in the frontend constructs a share link yet, so there is
nothing to keep back-compatible. That window closes the day a share button ships.

**D29 was never a bug.** Git settles it: the path in the register
(`e2e/tests/services-loans-team.spec.js`) was deleted by commit `57c3b68` — *the same commit that
wrote the note*. Before that commit, two byte-identical copies of the test ran concurrently in one
suite, both signing in as the same seeded buyer and both mutating the same `puneNestDB_v5`. The reorg
fixed it as a side effect and nobody re-triaged. The surviving spec at
`tests/consumer/services/loans-team.spec.js` passes standalone, inside its 98-test suite, and under
`--repeat-each=5 --workers=2 --retries=0`. Four robustness fixes were made anyway (chiefly
`networkidle` → `domcontentloaded`, which is a genuine fragility against a dev server that compiles
the module graph on demand) and **zero assertions were changed**.

**D28 — the console assertion was already half-gutted, and the fix made it stricter.** `pageerror`
was completely unfiltered, so one uncaught rejection on an offline machine failed any spec; meanwhile
four blanket text matches (`Failed to load resource`, `net::ERR`, …) swallowed **our own origin
returning 404 and 500** along with the map tiles, and bare `cdn`/`unpkg` were short enough to hide a
genuine application error that merely mentioned them. The helper now judges by **provenance, not
wording**: a failed request is classified by whose server failed, read from the console message's
URL. External failures are dropped; same-origin 404/500 is now *caught where it previously was not*.
Vite allow-listing covers only the **transport**, never a compile error, and a grep confirmed no
application websocket exists to be masked by it.

Proved in both directions. A 16-case classification probe caught a regression in the first draft (a
same-origin `favicon.ico` 404 misclassified as real, because the ignore list was only tested against
message text, not the URL). Then a real `console.error` was injected into `AdminEnquiries` — two tests
failed and the received array contained **only** the injected string, with no environmental noise
alongside it — removed, re-run, 7 passed. A 95-spec regression sample chosen to stress exactly what
changed: green.

**Findings opened as rows rather than fixed:** D177 (DPDP erasure is the real gap behind
`DELETE /reviews/{id}` — and the recommendation is explicitly **not** to build it as a moderation
power, because a hidden review is reviewable and a deleted one is not), D178 (`FinancesTab.jsx`
filters on the calendar year while the server filters on the Indian FY — the summary card and the
table directly below it disagree by up to three months, live, every January to March), D179 (four more
services on a bare `LocalDate.now()`, `RentService:220` being the same bug on the same surface), D180
(`rent-agreement.spec.js:116` is an unstable checkbox in the review step — a product defect, and
hardening a test around it is how a defect becomes permanent), D181 (the three flatmate interest
buttons never call the API at all, so D175's correct 409 is currently unreachable — with the note that
whoever wires them must route it to the benign strings that already exist).

### 2026-08-10 — D163, D132, D47, D129 (partial) and the flatmate duplicate-interest race

Five parallel lanes. Three register rows deleted outright, one rewritten to the third of itself that
is still true, and one live bug closed that had no row at all. Backend **1056 tests, 0 failures,
3 skipped** on a database rebuilt from empty, so the whole 52-migration chain is also verified.

**D163 — the platform was billing ₹0 stamp duty on a document that legally attracts more.** The seed
carried `stamp_duty = 0, registration = 0` for the rent row and D150 had already made the sidebar
render the server's breakdown, so the displayed price and the charged price were wrong *together* —
which is worse than wrong separately, because the agreement between them reads as confirmation. The
fix is not a better constant: a Maharashtra Leave & Licence duty is 0.25% of a consideration built
from rent, term and both deposits, so **there is no flat value that is right for more than one
tenancy**. `V52` therefore drops `NOT NULL` from the two columns and the seed publishes `NULL` with
the reason in `notes` — an honest schedule declining to publish a figure it cannot know — while
`catalog/fee/LeaveAndLicenceCharges` computes the real one per agreement. Integer-only, basis points,
`Math.*Exact`, consideration carried ×10 000 so the 10% deposit weighting cannot lose a paisa; a test
pins ₹917.50 → **918** to fix the rounding direction. Rejected: rate columns (four new columns
meaningless for the `buy` row, and a statutory rate changes by *legislative amendment*, which
deserves a code change with a test rather than a config row someone can set to 0.30% at 2am with no
reviewer); and seeding a flat "indicative" ₹918 (right for exactly one tenancy, and a confident wrong
number on a public page is worse than the zero it replaces). No response shape changed — `Fees`
declares no `required` list and `FeeResponse` already carried boxed `Long`. A term-less request still
prices at **₹2,359, byte-identical to today**; a stated-but-impossible one (rent > ₹100 cr, term >
600 months) is a **422**, not a clamp.

The frontend half was the part that mattered and it nearly shipped without: `feesProvider.js` coerced
`Number(row?.stampDuty) || 0`, justified in its own comment by "the server's columns are `NOT NULL`".
V52 retires that premise, and until the coercion was fixed **the sidebar showed ₹0 while the server
charged the real figure — the customer quoted less than they are billed.** Now an explicit `== null`
check comes first for those two fields only; the other four keep the coercion, which exists so a
money field arriving as a string cannot turn the sidebar's addition into `"1999360"`.

**D132 — the premise was already stale, and the real cost was elsewhere.** The row said the endpoints
"aggregate per call" and proposed a rollup table. In fact both repository queries already returned
one row per group; nothing was summed in the JVM. What was actually expensive was the **heap**:
`type` and `amount` were in no index, so Postgres found rows cheaply and then visited the table once
per row. `V51` replaces `idx_transactions_property` with a covering index — `(property_id, date)
INCLUDE (type, amount) WHERE archived = false` — equality column first, range column second, and the
two summed columns in `INCLUDE` because that is what makes the scan index-only. The old index is
**dropped**, not kept: its keys are byte-identical and differ only by a payload the planner ignores
when navigating, so a second one would be paid for on every write and chosen by nothing. Accepted
trade: entries are ~2× wider, so the paged ledger list reads more index pages — but it reads twenty
rows either way, while the aggregate scans the owner's whole history. **The rollup table was
deliberately not built.** These numbers are reconciled against bank statements and tax returns; a
stale rollup is a *wrong* ledger, which is worse than a slow one. The pinning tests were written and
run **before** the change (11 pass), then again after (12 — the extra one asserts the index exists in
`pg_indexes`, since an index is otherwise invisible to the tests it speeds up). No latency measured;
the claim is structural, not benchmarked.

**D47 — internal ticket notes were one triage rule away from reaching the customer.** `TicketDto`
carries `notes` and was returned from `POST /tickets` to the person who raised it. It was safe, but
only by coincidence of three unrelated facts: that endpoint was the only one reaching a non-staff
caller, it serialised the ticket *inside the transaction that inserted it* so the note query
necessarily saw an empty set, and `ticket_notes` is written only by a staff-guarded route. Break any
one — an auto-assignment, a triage rule stamping "raised via web", or the customer read the row
itself anticipated — and the leak ships **with no diff on that path for a reviewer to see**. Closed by
splitting the DTO: `CustomerTicketDto` has no `notes` component, so there is nothing to leak and the
guarantee is the compiler's rather than the timing's. Rejected: role-filtering at the mapper boundary
and `@JsonView`, both of which leave the field on the object the customer path constructs and make
correctness depend on every future call site remembering — converting a structural question into a
code-review question, at every site, forever. Follows the `PropertySummary` precedent, whose javadoc
makes the same argument for the same reason. The test asserts `notes` is **absent** (not null) from
the raiser's copy, that the note genuinely exists in the table, and that the staff board still
returns it with exact text — *the leak is not closed by breaking the feature*. `assignee` was kept:
the contract labels only `notes` internal. Honest limit: the final assertion is at the projection
boundary rather than over HTTP, because there is no customer read endpoint on this board today —
which is precisely the future D47 was filed against.

**Flatmate duplicate interest — a live 500, and it had no register row.** Both interest doors
check-then-insert against `uq_flatmate_requests_target_requester`, so two taps that interleave give
the loser a `DataIntegrityViolationException` and a 500. Now caught and translated to the **409** the
contract already declares. Sabotage proved the test is not a no-op: replacing the business refusal
with a rethrow reproduced the raw constraint violation and failed the test. Two things are recorded
rather than fixed — the pre-check answers **201** where the catch answers 409 (now **D175**), and
`V27`'s comment claims the index is "the reason the service does not check-then-insert" when the
service does exactly that, and has since V27 landed (now **D176**). The group-join door shares the
same private method but is untested; it needs a `FlatmateGroup` fixture with seat state.

**D129 — one third done, and it is the third that was still growing.** English locale JSON was the
only eagerly-bundled language (mr/hi were already lazy), so the remaining win was splitting English
*by namespace*: a 6-namespace eager shell, 14 route-deferred chunks, loaded inside the `lazy()`
boundary each route already had. Critical path **591.9 → 533.0 KB gzip (−9.9%)**; entry chunk −12.2%;
predicted 59.4 KB, delivered 58.9. No flash of untranslated content — `React.lazy` resolves only when
*both* the component chunk and `addResourceBundle` have settled, and both fetches go out together
under the existing Suspense fallback. English namespaces load in **every** language, because
`fallbackLng: 'en'` means a fallback that is not loaded is not a fallback. The lasting part is
`check-i18n-route-namespaces.mjs`, which walks the transitive import closure of every route and fails
the build if a route can reach a key it did not declare — so the class of regression this item
describes cannot silently return. **Not verified in a browser: runtime language switching still needs
a manual pass.** The other two thirds are not a bundling problem at all — `db.json` (236 KB) and
`societies-rera.js` (182 KB) compute at *module init*, and no amount of splitting defers a module
whose top level does the work.

**One test was wrong, not one lane.** `SourceTreeHygieneTest` defines an empty `.java` as one that
"declares nothing" — comments, `package` and `import` lines stripped. A `package-info.java` is by
definition nothing but a package javadoc and a package statement, so **every correctly-written one**
reported as a stub. The rule was authored when the repository contained none, so the false positive
lay dormant until package documentation landed. The zero-byte half still applies to it, which is the
ghost-file case the guard actually exists for. Separately, `docs/mobile-design-review.md` reappeared
at zero bytes after being deliberately retired in 59ab9c7 — the same regeneration the guard's javadoc
warns about, caught by the guard, deleted again.

### 2026-08-09 — D73, D92, D165 and the payment-hardening four (D169–D172)

Four register rows closed alongside D77 and D151, recorded here because the register keeps its
arithmetic by *deleting* retired rows (rows + gaps = highest id), so the reasoning has to live
somewhere that is not the table.

**D73 — every rate limit was check-then-write.** Closed with a transaction-scoped Postgres advisory
lock (`common.persistence.RateLimitLock`), taken immediately before the count and released by
Postgres when the transaction ends. Three things were considered and rejected, each for a reason
worth keeping: `WriteRateLimiter` counts **in memory, per instance, resetting on deploy** (D158) —
an OTP budget that resets on deploy is not a budget; `SELECT … FOR UPDATE` locks only rows that
*exist*, so the loser resumes on its pre-block snapshot and never sees the winner's insert (a
textbook phantom — the cap stays exactly as leaky); and the one-statement
`INSERT … SELECT … WHERE (SELECT count …) < N` reads the statement's own snapshot under
`READ COMMITTED`, so both writers see the pre-insert count. That last one *looks* atomic, which
makes it the worse bug. **It was four call sites, not three:** `ShareFlatService` was retired by
V28 and its ten-per-hour cap now has two entrances (`FlatmateSeekerService.express`,
`FlatmateSupplyService.record`) counting the same rows — so they deliberately share one lock
namespace, because giving each its own would leave the burst a second door.
The correctness tests run **outside** `AbstractApiTest`, which is `@Transactional` and rolls back
and therefore cannot observe a commit — the D90 lesson, and a race is a commit-time phenomenon.

**D92 — the last four notification writers.** `visit.confirmed` to the visitor,
`visit.rescheduled` to whichever side did *not* move it, `offer.received` to the owner,
`document.granted` to the requester. All via the `Notifier` port, which is **mandatory** for
`documents`: it is rank 2 and cannot import `engagement`, also rank 2, so the port is the only legal
route and `ArchitectureBoundaryTest` proves it. Each is tested for the property that matters — the
recipient gets exactly one row **and the actor gets none**. Deliberately still silent: offer
counter/accept/decline, document decline, visit completed/no-show, matching the `contact.approved`
precedent that a terminal "no" is not news to push at someone. `notificationMapper.js` gained
`visit.`→`visit`, `offer.`→`price`, `document.`→`document` and `message.`→`enquiry`; **that last one
was a pre-existing break** — every `message.received` row since the conversations slice has rendered
as a grey `system` row matching no filter chip.

**D165 — connectivity e2e.** Five tests. The one that earns the item: a request that never reaches
the server hedges (`unreachable`) **while `navigator.onLine` stays true**, because only the
browser's own signal licenses the confident "You're offline" — telling someone their connection is
down when it is not is worse than saying nothing. A 500 paints no banner at all, since the server
answered. Mock mode has no network to fault, so the spec rewrites the Vite-dev-served
`/src/services/config.js` module to put listings on the http provider; verified by **negative
control** — sabotaging the rewrite failed exactly the three network tests and left the two
browser-signal tests standing.

**D169–D172 — payment hardening.** `CheckoutTtl` owns one `Duration` and derives the sweep's
look-back and Cashfree's `order_expiry_time` by mirror-image methods, so the two windows are equal
*by construction* rather than by agreement (Cashfree's 15-minute floor is applied to the shared
value, not to one side, or a 5-minute config would sweep at 5 and expire at 15).
`ConstraintViolations.isOn` replaced what was about to become a fifth copy of a two-line index-name
match. `Subscription.fail()`, `Boost.fail()` and `RentPayment.settle(FAILED, …)` now release the
idempotency key — the PAID branch deliberately keeps it, because a replay of a successful payment
must return the same row. The free-boost promotion moved below the save, so a future
non-transactional caller inherits the survivable failure (a boost row with no promotion) rather than
the unexplainable one (a promoted listing nothing accounts for).

**One test was wrong, not the code.** `RateLimitLockTest.negativeHashesStayInTheirNamespace` asserted
`"zzzzzzzzzzzz".hashCode()` is negative — it is `+1097476992`, so the test failed on its own premise
while the masking it meant to verify was correct all along. Now keyed on `"9876500073"`, an ordinary
ten-digit mobile that genuinely hashes negative — the real shape of an OTP key, which makes it a live
defect rather than a contrived one.

### 2026-08-09 — D77: the inbound-demand reads are paged, and the half that was already paged now works

**The register said sixteen and named nine. Four were genuinely left.** Seven of the nine had already
been paged; the count was never measured. What the count *did* find is that the deal cluster had been
paged in the backend only: `dealProvider.js` and `visitProvider.js` still ran every response through
`Array.isArray(rows) ? rows : []`, so `/me/deals`, `/offers/mine`, `/me/offers`,
`/me/finalization-requests`, `/visits` and `/me/visit-requests` had all been returning `[]` against
the live API — six screens showing nothing, with a green parity harness, because every assertion on
those lists was a *negative* one (`!list.some(...)`, `Array.isArray(...)`) and an empty list satisfies
all of them. Positive assertions added to `deal-parity.mjs` and `flatmate-parity.mjs`, plus a direct
envelope check in `document-parity.mjs`, so the next half-migration is caught by its own harness.

Newly paged: `/me/flatmate-requests` (host inbox, `?status=` filtered in the query so `totalElements`
counts matches, not everything) and `/me/documents/requests` (owner inbox). Both ship their index in
V49 — an unindexed paged read is slower than the unpaged one it replaces, since the scan and the sort
still happen and a second `count(*)` pass is added on top. Screens without a pager read these through
one shared `unwrapFullPage(res, label)` in `http.js`, which asks for `size=100` and warns when
`totalElements` exceeds what came back; the pattern existed three times by hand before this.

**Left unpaged on purpose:** `/tenancies` and `/me/tenancies`. Their rows come from a deal the owner
themselves closed, which fails §5.1's inbound-demand test, and they are ordered by a `CASE` expression
no index serves — paging them correctly needs either an expression index or a changed published order,
which is a contract decision rather than a paging one. Recorded as the narrowed carve-out on D77.

### 2026-08-09 — D151: the identity numbers reach one operator, are logged, and then stop existing

A Leave & License names each party by PAN and Aadhaar. The paid-L&L security pass stopped both from
reaching the server — correctly, because `details` is plaintext `jsonb` echoed verbatim to every
staff read — and left the drafting desk with nothing. `PUT|GET /service-requests/{id}/identities`
over a new `service_request_identities` table (V47) is the channel that was missing;
`rejectIdentityNumbers` is untouched and the wizard still redacts. Reasoning lives in
[`docs/system/tech-debt.md`](../docs/system/tech-debt.md) (D151 detail) and beside the code.

**The register pointed at the document vault and this went elsewhere on purpose.** The vault's read
model is `FileStorage.signedDownloadUrl(key)` — a URL that carries its own authority, that nobody can
be excluded from, whose use never reaches our server — so neither of the two requirements that define
this item is expressible against it. It has no authenticated read at all, only a signer.
`DocumentUploads.validate` admits five image/PDF types by magic bytes, so numbers are not something
it can hold without weakening that allowlist, and `DocumentService.delete` leaves the object behind
forever, which is defensible for a sale deed and not for an Aadhaar. **Signed off 2026-08-10** — the
dedicated table is the agreed design, not an unreviewed departure from the register's first wording.

- **Only the assignee reads** — `assigneeId == caller.userId()`, or 403, with an admin refused like
  anyone else until they take the request. Unassigned refuses everyone: "whoever asked first" is not
  a name. Enforced by a refusal, not by an omitted DTO field.
- **Both outcomes are audited**, and the refusal is the more interesting entry. Counts and roles
  only — putting the numbers in `audit_log` would make the one table that must be trusted the second
  place they are held.
- **Retention is bounded by the work**: `purgeFor` runs from `transition` on every terminal move, and
  the rows survive with their names so "recorded, since discarded" stays distinguishable from "never
  recorded".
- **Only the requester writes.** A desk that could write these could invent them.
- **The wizard now sends what it used to discard** — one `PUT` after the live create, before the
  checkout modal (which can outlive the page), built from live state by `identityParties` and never
  held. Nothing new touches `localStorage`; mock mode drops them, because the mock store *is*
  `localStorage`.

Opened: D173 — the `GET` half has a tested server and no screen, because the ops back-office has no
live client for service requests at all. **Nothing was executed this pass** (parallel Maven runs
corrupt `target-cli/`): `ServiceRequestIdentityTest` is written, not run. No e2e spec is possible —
in mock mode the call is a deliberate no-op, so there is nothing observable to assert.

### 2026-08-09 — Every payment family now has the cap and the sweep, not just the one that needed them first (D160, D161)

Two register rows that were both "service requests have this and the other three do not". The cap
(D160) is a partial unique index on the open unpaid row plus an in-code count that agrees with it
exactly — `uq_subscriptions_open_unpaid` on `subscriptions (user_id) where status = 'pending'`,
`uq_boosts_open_unpaid` on `boosts (buyer_id) where status = 'pending'` (V44, V45), each violation
translated to the same 409 the service-request cap answers with, by matching the index name rather
than catching integrity violations wholesale. The sweep (D161) stopped being a service-request class
and became a port: `common.payments.AbandonedCheckouts` with one `@Scheduled` driver over whatever
implements it, so the fourth family cost an interface rather than a fourth copy of the same query.

What the reviews changed, which is the part worth indexing:

- **Six javadocs claimed `@Version` closed the sweep/webhook race and none of the three entities had
  one.** Under READ COMMITTED the sweep reads `pending`, the webhook commits `active`, and the
  sweep's update-by-primary-key overwrites it — cancelling a customer who has paid. V46 versions
  `subscriptions`, `boosts` and `rent_payments`; the comment on each column says what raw SQL
  bypasses. `service_requests` had been versioned since V26 and was the reason nobody noticed.
- **A paid webhook landing on a swept row logged at INFO and returned `true`**, which is exactly the
  shape that keeps the controller's "unreconciled" alarm quiet about the one case worth waking up
  for. Each family now has a `reportRefusedSettlement` with a family-appropriate predicate: benign
  when the row still entitles, ERROR naming the gateway order and the customer when it does not.
- **The sweep was unbounded.** `MAX_PER_SWEEP = 500`, on the port rather than four times — and now
  that the rows are version-checked a larger batch is not merely slower, it is likelier to achieve
  nothing, because one webhook winning a race anywhere in the set rolls the whole transaction back.
- **The migrations retire pre-existing violations rather than refusing to deploy**, newest-wins, and
  each retirement now `RAISE NOTICE`s its gateway order id — the deploy log *is* the reconciliation
  list, which is the only honest answer when the tiebreak can pick against an in-flight settlement.

Closed: D160, D161. Opened: D169–D172 — the sweep closes our side of a checkout the gateway still
considers payable (no `order_expiry_time` is ever sent; rent is a genuine double-charge window), plus
three pre-existing faults the reviews surfaced next door. Backend 966 tests green.

### 2026-08-09 — Paid Leave & License, and the thirteen register rows the review of it opened

The rent-agreement desk is now a paid service request end to end (`create` prices from
`platform_fees('rent')`, opens a Cashfree order, holds at `awaiting-payment` invisible to ops, and
the webhook settles it into the queue), and the review passes that followed closed thirteen register
rows across two parallel waves. The reasoning lives beside the code and in
[`docs/system/tech-debt.md`](../docs/system/tech-debt.md); what is worth indexing here is what the
reviews *found*, because in each case the shipped feature was correct and its surroundings were not:

- **The payment gate was opt-in by spelling.** `type` was free text priced by exact match, so
  `rental` bought the desk for free. Now a closed vocabulary + CHECK constraint + OpenAPI `enum`.
- **`details` is plaintext `jsonb` echoed to every staff read**, and the wizard was posting the
  owner's PAN and Aadhaar into it — the ops queue's first page was a bulk identity dump. Redacted at
  the client, refused at any nesting depth by the server, purged from `localStorage` (D149), and the
  hand-off to the people who actually draft from those numbers is now the open decision (D151).
- **A check-then-act cap is not a cap** (D153) — a partial unique index now enforces what the count
  observed. **An `awaiting-payment` row was a dead end** (D152) — a 45-minute sweep plus a requester
  self-cancel. **A cap with no release valve locks the customer out** for doing the most ordinary
  thing in a checkout modal, which is closing it.
- **`DETAILS_MAX_CHARS = 8000` was a guess** (D157). Measured: worst realistic wizard state is 7,875
  characters — 125 of headroom. Raised to 16,000 with the measurement recorded at both halves.
- **The app had no offline state at all** (D128) — `navigator.onLine` returned zero matches across
  `frontend/src`. One connectivity banner, one shared `useAsyncList`, ~0.7 KB gzip.
- **The dev-affordance gate was a fail-open denylist** (D147) and its replacement now requires a
  `PUNENEST_DEV_MACHINE` environment variable read outside Spring's relaxed binding, so no file in
  this repository can grant dev privileges. Automated test runs are exempted on a test-scoped
  classpath marker that is not present in the packaged app.
- **The register was wrong about D114's callers** — filed as an N+1 across three components, it has
  one. Fixed, then found to be only half-closable: the mobile it keys on arrives masked per D5.

Closed: D9, D128, D135, D147, D148, D149, D150, D152, D153, D154, D155, D156, D157; D114 in part.
Then a third wave closed the frontend and payment residue the second opened — D159 (the *draft*
autosave was still writing the two identity numbers D149 had just removed from the KYC record, on
the same origin by a shorter path; now redacted and purged on read), D160/D161 (subscriptions and
boosts had no cap on open unpaid orders and no sweep for rows stranded by a hard kill — the
service-request shape now applies to all four families through one `AbandonedCheckouts` port),
D162, D164, D166 (the connectivity nudge moved down into `services/http.js`, so every provider
failure feeds it rather than the two call sites that happened to use `useAsyncList`), D167, D168.

**Three things that pass reviews only find by looking sideways.** Six javadocs claimed `@Version`
closed the sweep/webhook race and none of the three entities had one — without it the sweep
silently cancels a customer who has just paid. A paid webhook landing on a swept row logged at INFO
and returned success, keeping the "unreconciled" alarm quiet about the one case worth waking up
for. And two e2e failures that looked like a revenue regression were a race: the tests read
`localStorage` the instant after a click, and the quota is spent when the request *resolves* — the
passing siblings had always awaited an observable effect. Proved by instrumenting both reads in one
run rather than assuming.

Opened: D163, D165, D169–D172. Register 82 open (was 89). Backend 966 tests green, lint 396/0,
bundle 591.6/595 KB.

### 2026-08-09 — The owner→visitor WhatsApp handoff was dead in the field names

`VisitsTab` read `v.customer` / `v.mobile`; the visit seam publishes `visitorName` / `visitorMobile`
and both providers write exactly those, so neither field was ever populated. The owner saw a
nameless visit row, and `isFullMobile(undefined)` suppressed the WhatsApp button — it **failed safe**,
which is why nothing caught it: the D5 test asserts the buyer side has *no* handoff, and that passes
whether the owner side works or not. Fixed at the eight read sites (component reads the seam's names;
no compat alias added in the dashboard enrichment, which would just have hidden the drift). New
regression test asserts the positive case — the visitor's name renders and the link resolves to
`wa.me/919811111111` with their name in the `aria-label`. 8/8 green. `AdminEnquiries`' `r.customer`
is a different, mock-only admin shape and is untouched.

### 2026-08-09 — Eight decision-blocked register items closed in one pass

Each had been sitting on a product ruling rather than on engineering. The rulings were taken, then
executed smallest-first. Reasoning lives in the code comments and in `docs/system/tech-debt.md`.

- **D115 — Pay-Rent deposit financing removed.** The CTA offered a product that does not exist; the
  tab, the EMI panel, the `depositFinancing` flag and the two e2e tests are gone rather than stubbed.
- **D93 — `DELETE /notifications/{id}`.** Dismiss was a client tombstone, so a notification cleared
  on a phone came back on a laptop. Server-side now; the client tombstone survives only as a fallback
  for rows the server never had. *(Malformed `@PathVariable UUID` answers **400**, not 404.)*
- **D85 — alerts require sign-in.** An alert nobody can be notified about is not an alert. Anonymous
  demand is still counted for the gap report; only the managed alert now needs an account.
- **D87 — `PATCH /visits/{id}/slot`.** Rescheduling meant cancel-and-rebook, which lost the thread.
  Either participant may move the slot in place; the visit resets to `scheduled`.
- **D71 — already built.** A stale register row: `flatmate_seeker_posts` has had the full archive
  triplet and a one-live-post cap for some time. Only the regression test was missing; it was added.
- **D122 — `POST /me/verification/aadhaar/simulate`, `@Profile("!prod")`.** The DigiLocker webhook
  cannot reach a dev machine, so the verified tier was unreachable locally. Synthesises a webhook and
  calls the **real** handler, so idempotency and the flag flips are exercised, not bypassed.
- **D59 — paid boost ranks, and says so.** Boost affects the **default sort only** — pinning paid
  listings above a sort the user explicitly chose is deception — and every boosted card carries a
  "Promoted" chip (ASCI paid-placement guidance). Read-side mirror `properties.boosted_until` (V40)
  so the catalogue never has to ask billing anything.
- **D57 — subscription lifecycle.** A scheduler alone only shrinks the "unpaid plan still works"
  window to one tick, so entitlement is decided against the clock on **every read** and the hourly
  sweep is bookkeeping on top. No grace period: nobody specified one, and inventing one is policy.
  *Single-instance only — needs a lock before this runs on more than one node.*

Also closed alongside these: **D5/Q2** and **D72**, both large enough for their own entries below.

### 2026-08-09 — D5 / open-questions Q2 closed: owner number is never revealed to a buyer (global policy)

Global privacy invariant: an owner's raw phone number is never shown to a buyer; approval unlocks
in-app messaging, not the digits. `users.hide_number` is retained but is now a no-op (the number is
hidden from buyers unconditionally). Backend enforced this first (`ContactStatuses.revealsContact`
= owner-only, contact/offer/visit/finalization mappers reveal mobile self-only; signed-lease /
closed-deal reveals stay). Frontend brought to parity: mock `contactProvider.gateFor` returns
`ownerHidesNumber: true` unconditionally; `VisitsTab` suppresses the buyer→owner WhatsApp handoff
(owner→visitor only) and guards every `wa.me` link with `isFullMobile` so a masked number never
forms a broken link. Dead seeker i18n keys (`waOwner`, `waSeeker`, `waReschedSeeker`) removed across
en/hi/mr. Two new regression specs (contact-identity-masking, scheduled-visits). 142 Java + 26 e2e
green. D5 closed in the register (83→82 open); open-questions Q2 answered.

### 2026-08-09 — Decision-blocked items closed (open-questions Q1, Q3, Q4, Q5)

Four answers taken off the engineering-decision queue in `open-questions.md`. One index line each;
reasoning lives in the closed-question entry, the code comment, or the repo-memory lesson.

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
| 2026-08-08 | **Encoding guard restored (D126 closed).** Stripped UTF-8 BOMs from 18 committed files via `node e2e/scripts/fix-mojibake.mjs` (BOM-only — 0 content bytes changed); `SourceTreeHygieneTest.noMojibakeOrBom` now green, so the ban on non-UTF-8 source writes is live again. Disproved D126's guess that the BOM broke `listing-freshness.spec.js` — it still fails on a nudge-banner assertion after the strip, so the two standing mock e2e failures are functional drifts, not encoding (re-recorded as D127) |
| 2026-08-02 | Re-sync docs + OpenAPI to the flatmates redesign & mobile-first UI |
| 2026-07-27 | 3-way sync: `platform-architecture.md` (SOT) → OpenAPI → React |
| 2026-07-26 | OpenAPI established as the single source of truth; matured to cover all React needs |
| 2026-07-25 | Platform & solution architecture (MVP pass), ADR-009a KYC, ADR-014 payments, legal/compliance advisory |

