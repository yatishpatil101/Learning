# Lessons

> **One durable rule per bullet.** The incident that produced it is in git; this file is read at the
> start of every session, so it has to stay readable. If a bullet only makes sense to whoever was
> there, it does not belong here. Compressed 3,990 → this.

---

## Crawling external sources

- **A 200 carrying "No Records Found" is a failure that every status check passes.** The MahaRERA
  list answers an overloaded moment with a short friendly shell (~49 KB against ~114 KB) instead of
  a 5xx, so the parser sees a legitimately empty page. Detect it on the body, never on the status.
- **Never record a unit of work as done when it produced nothing.** Marking empty pages done meant
  resume skipped them, losing ~19 pages permanently and invisibly. Mark done only on success, and
  stamp every row with the page that produced it so a gap is provable after the fact.
- **A guard that stops loudly still needs the right diagnosis.** The abort blamed "markup changed"
  when the cause was transient throttling; re-fetching that page returned all ten rows. Reproduce
  the condition a guard claims to have found before acting on its message.
- **Require only the join key when parsing a record; let every other field be null.** Also demanding
  a name silently discarded a filing the portal names "NA", leaving one page short for a reason no
  later reader could reconstruct.

## Upload policy

- **browser-image-compression treats `maxIteration: 0` as ten retries.** Use one bounded retry
  with a deliberate initial quality, and supply the real byte target (converted from decimal MB
  to the library's MiB units); `maxSizeMB: Infinity` can reject files that would fit at the floor.
- **A magic-byte fixture is not necessarily an image.** Decode test PNGs before reusing them when
  adding client validation; replace fake PDF headers with generated valid PDFs, not looser gates.
- **PDF compression is part of the requested document flow, not a reject-only exception.** Use a
  separate PDF-capable library; disclose that digitally signed PDFs are unsupported and ask for
  unsigned copies. Do not describe rasterizing a PDF as lossless or promise every file can fit 1 MB.

## What a green suite does not prove

- **Freshness is not publication status.** A recent timestamp must not earn an unapproved listing an Active/Availability badge or a reactivation action; gate freshness UI on approval.
- **Fitting options on one row does not mean using the row well.** For a fixed three-choice mobile
  group, share the remaining width between tiles and assert the last tile reaches the right edge.
- **A "partial, blocked" handoff is a hypothesis, not a finding.** A session recorded as stopped
  mid-implementation listed three items as unfinished; all three were already written. What the
  handoff actually described was *unverified* work — and unverified turned out to include a hard
  compile error in a test file that blocked the entire backend tree, which the same handoff reported
  as "static checks passed". Before continuing someone else's stop, **compile it and run it**; the
  difference between "not written" and "never executed" changes the whole remaining plan.
- **A spec that has never been executed is a claim, not coverage.** Written, reviewed, cited in
  `COVERAGE.md` and merged is not the same as run. The first live run of the 739-test suite found
  six broken specs and none of them was a product bug.
- **Per-file green is a weaker claim than it looks.** Isolation suppresses exactly the failure modes
  that shared state and elapsed time produce. Only the full run measures the suite.
- **Any run long enough to cross a token TTL is a different experiment from a short one.** A cached
  session snapshot replayed past 15 minutes presents an already-rotated refresh token; reuse
  detection revokes the family and the test fails naming a locator on a screen it never reached.
- **A spec that mutates a seeded actor breaks the next spec's premise.** The live DB resets once per
  run, not per file. One spec verifying an owner republished another spec's unverified control forty
  tests earlier; both passed alone.
- **A fixture that reads richer is often a fixture that is wrong.** A shared seed is another spec's
  premise: a room seeded into Aundh took away the empty locality a discovery spec needs for its
  empty-tab rescue, and a group given a `property_id` put people into a tab that holds rooms by
  design — a shape the wire forbids. Grep for who depends on a row being bare before enriching it.
- **A stale-fixture failure and a code failure are identical in the log.** Select a fixture for the
  fields the test asserts on; never take `rows[0]`.
- **A `@Transactional` test base class cannot see a commit-time bug**, a missing transaction, or a
  missing fetch. Anything about the wiring above the unit needs a bare `@SpringBootTest`.
- **A `@Transactional` MockMvc test also cannot prove that a REJECTED write did not persist.** Every
  request joins the test's transaction, so a service rollback marks it rollback-only without
  clearing the persistence context, and the next request's query auto-flushes the rejected mutation
  and reads it straight back. Asserting "the row is unchanged" after a 4xx fails in the harness and
  passes in production — the reverse of the usual trap, and it will look like a real bug. Assert the
  status code and say in the test why the follow-up read is absent.
- **Grep the application log after a green run.** Background work — sweeps, schedulers, listeners —
  has no assertions pointed at it and fails in total silence.
- **Prove a regression test fails on the old code.** `git show HEAD:<path>` and re-run, or replace
  the guard with `if (false)`. Red on old, green on new, or the test is decoration.
- **A test that passes because of a side effect of the fix is not a regression test.** If the
  distinction it asserts cannot exist in the schema, say so in the test rather than passing.
- **Re-run a recorded failure before triaging it.** Notes rot; the reproduce step costs minutes and
  the alternative is investigating a bug that was fixed further down the same file.

## Assertions that assert nothing

- **Assert the absence of the wrong value, not just the presence of the right one.** A negative
  assertion found the fourth and fifth copies of a bad string, one of them in markup the desktop
  viewport does not display.
- **`[].every(...)` is `true` and `expect([]).toEqual([])` passes.** Every sweep-style test needs a
  floor proving the scan found something to measure — and the floor belongs in the helper's return
  value, not re-derived at each call site.
- **A "page loaded" assertion that any page satisfies is not an assertion.**
  `getByRole('heading').first()`, `waitForLoadState`, a URL check after a client-side 404 — all green
  on the error page. Name the heading, or assert something only the intended page renders.
- **If a test navigates, one assertion must depend on where it went.** Driving the API through
  `page.evaluate` decouples the test from the page it opened, which makes a broken `goto` symptomless.
- **A stale count is stale in the direction that cannot fail.** "all 7 tabs" against a strip that
  renders nine stayed green while two tabs had no test. Assert the count, not a list of names.
- **A counter and a list can legitimately disagree** — an uncapped `{rows.length} of {all.length}`
  over a `slice(0, PAGE_LIMIT)` list. Derive from the first number and cap it.
- **A negative assertion needs a positive anchor.** "The counter still reads 0" also passes against a
  button wired to nothing. If the app exposes no signal, add one to the test double.
- **Pick fixtures where the correct and incorrect implementations give different answers.** "Shows
  some listings" passes whether or not `/me/listings` was used; exactly 4 fails on any fallback.
- **Choose the negative anchor so a lazy assertion fails.** An anchor with no badges at all lets "no
  badges" pass for "the right badge absent".
- **Verify a count against a different endpoint, not against the field it came from.** Comparing a
  computed count to the stored one it replaced proves only that the migration copied a number.
- **Prove provenance before asserting on content.** Assert the response came from the API — a
  request observed on the wire, a `totalElements` — before any test asserts on rendered content, or a
  silent fallback to mocks passes the whole suite while verifying nothing.
- **An assertion of absence asked by the wrong ARIA role can never fail.**
  `getByRole('button', { name: 'Call' }).toHaveCount(0)` guarded a profile against Call and WhatsApp
  reappearing; the component renders both as `tel:` / `wa.me` **anchors**, so there was no branch in
  which the thing being forbidden was a button. Green against the exact markup it existed to forbid.
  Read the element the component actually emits before writing the negative.
- **An id or reference matched by *shape* is often a fact about the mock.** `/SUP-\d+/` was called
  "a server-style id" in a spec header; the server sends a UUID and `SUP-` was minted by the mock
  provider alone. Where two components must show the same identifier, fetch it and compare — the
  pattern-match passes for any provider that learns to imitate the format.
- **Prove a negative with a tool you have seen return a positive.** A `Get-ChildItem -Recurse
  -Include *.java | Select-String` sweep reported that `match.saved-search` existed nowhere in the
  backend. It is on `SavedSearchService.alert()`. The empty result was the pipeline, not the tree,
  and a false negative on a grep is indistinguishable from a real absence — re-ask with a different
  shape of command before concluding "no such thing".
- **A rollback-only probe under `@Transactional` tests can be a permanent `false`.** To prove
  `noRollbackFor` covers a new throw site, three probes look equally plausible and two cannot fail:
  `TransactionAspectSupport.currentTransactionStatus()` throws `NoTransaction` (the transaction in
  scope is TestContext-managed, not aspect-managed), the bound `EntityManagerHolder` is never
  marked, and only the bound `ConnectionHolder` is. `AuthEndpointsTest` had settled this
  empirically in a comment months earlier; the second author reasoned about which holder *ought* to
  carry the flag and shipped an inert assertion. **Grep the file for a prior `isRollbackOnly()`
  before writing a new one, and red-check by deleting the exception from `noRollbackFor` — the run
  must fail on that assertion's `as(...)` message. A red-check that passes is a failed red-check.**
  Do not substitute a replay-based proof: inside one test transaction the burnt OTP row is read
  back from the same connection, so the second request answers 401 either way.

- **A test that must be changed to match new code deserves the same scrutiny as the code.** Four
  specs here encoded contracts that had genuinely been retired (clearing a flag publishes; a browser
  `confirm` is what guards an approval), and a fifth — a listing sold and then re-approved — turned
  out to be the only thing that caught a real regression the change had introduced. **Before editing
  a red assertion, say out loud which of the two it is.** The ratio is the point: one in five was the
  product's fault, and it was invisible until the sentence "the test is out of date" was tested.
- **A gate that now refuses what it used to allow has callers the old permissiveness was carrying.**
  Routing `PATCH /status → approved` through the new publication gate was right, but that gate admits
  only `pending`/`approved` — so re-listing a home whose sale fell through, which staff do through
  exactly this route, started answering 409. Enumerate what the *old* looseness was silently serving
  before tightening it.

## Playwright

- **`page.route(..., { times: 1 })` is spent before the component sees it, under StrictMode.**
  `main.jsx` wraps the app in `<StrictMode>`, so in the Vite dev server a load effect runs twice and
  the first run's result is discarded by the component's own `cancelled` flag. A one-shot abort is
  consumed by that discarded run, the real run succeeds, and the error state under test never
  renders. Route persistently and `page.unroute(...)` before the recovery action — which is the
  stronger assertion anyway, since recovery is then proved by an actual re-fetch.
- **`setInputFiles` does not wait for the input to be enabled.** It performs no actionability checks
  (which is why it works at all on the `sr-only` file inputs this codebase uses), so it will happily
  set files on a control a person could not click. The wizard's document picker is `disabled` while
  a photo uploads and drops such a pick silently; two specs uploaded nothing for months and passed,
  because neither asserted the file was stored. Gate on `toBeEnabled()` first, then assert the
  filename appears.
- **…and `toBeEnabled()` alone is not that gate.** It can pass in the window *before* the state that
  disables the control has flipped — the photo upload had not yet set `isMediaBusy`, so the check
  saw an enabled input, the upload started, and the pick landed on a disabled one anyway. The spec
  read as flaky when it was a real race. Wait for the preceding operation to be **observably
  finished** (here: the photo thumbnail visible *and* `[data-err="photos"]` reporting
  `aria-busy="false"`), not merely for the next control to look ready.
- **`getByText('X')` is a case-insensitive substring match.** `getByText('PAN')` matched the seeded
  owner "Rahul Deshpande". Use `{ exact: true }`.
- **`title=` contributes to a button's accessible name.** A role-based selector is only safer about
  the *role*. Scope modal footers to `getByRole('dialog', { name })`.
- **`components/ui/Table.jsx` renders every row twice** — an `sm:hidden` card and a `hidden sm:block`
  table — so any unscoped text match hits the hidden copy or violates strict mode. Scope to
  `getByRole('row', { name })` or `getByRole('table')`. Its empty state is itself a `tbody tr`, so
  `toHaveCount(0)` on rows can never pass; what distinguishes empty is a row with >1 cell.
- **An unanchored regex finds its pattern inside an id.** `/[6-9]\d{9}/` matches inside
  `SR178634283919842` and inside a `Date.now()` stamp. Anchor it:
  `/(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/`. It lives in `fixtures/live.js` so there is one copy.
- **`page.addInitScript` re-runs on every navigation for the life of the page**, so a later sign-in
  is silently overwritten by the seeded one. Seed a session with `page.evaluate` after load, then
  `reload()`.
- **`locator.count()` does not retry.** `await expect(x.first()).toBeVisible()` first, then count.
- **A `waitForRequest` predicate must identify the caller, not just the question.** A queue test
  matched `/admin/properties?` + `status=pending` and read `archived` off the winner — but the admin
  topbar's notification bell asks the same question on the same page, and deliberately sends no
  `archived`. So the assertion read `null` and reported that the console had dropped a filter the
  console had in fact sent, on a request that was never the subject. Add whatever distinguishes the
  two callers (here `size`): the bell asks for five rows, a queue asks for a full page.
- **A failure that survives running the spec alone is not contamination, whatever the batch said.**
  Re-running the five suspect specs on their own turned 12 failures into 8: the two SLA assertions
  and one animation flake really were neighbours' traffic, and the other 8 were foreign regressions
  that batching had disguised as batching. Isolate before attributing in *either* direction.
- **`if (await x.count()) await x.click()` is a skipped test with a straight face.** It converts a
  loud failure into a silent change of scenario. The tell is no `else` and no comment.
- **A conditional `test.skip` whose message sounds like a diagnosis is the most expensive kind of
  comment** — it stops anyone looking again. Prefer a failing test whenever the condition describes a
  broken application rather than a genuinely unsupported environment.
- **`waitForTimeout` — ask "does the next line retry?"** If it is a Playwright assertion or an
  auto-waiting action, delete the sleep. If it is a non-retrying read (`innerText`, `count`,
  `evaluate`), the sleep is load-bearing and must be *replaced* by an assertion on the state change
  it was waiting for. Naming that state is where the value is.
- **The replacement anchor must be the LAST observable effect, not the first.** A chip leaving a
  filter strip renders a frame before the deferred result count moves (`useDeferredValue`); a draft
  picks up a field before it records the step change. "Caused by the click" ≠ "safe to wait on".
- **If the same sleep duration repeats across unrelated files, go read the component.** Forty of
  fifty-three sleeps were one detail — `Select.jsx` portals its menu one `requestAnimationFrame`
  after open. One helper, not forty edits.
- **`waitForLoadState('networkidle')` is the same mistake with better manners** — it is a property of
  the network, not the DOM the next line asserts on, and it looks principled enough to survive review.
  Replace per-route; changing 122 call sites blind trades one known flake for thirty unknown ones.
- **`page.goto` resolving does not mean a `lazy()` route's mount effect has run.** Wait on the
  observable side effect, never on a paint.
- **A console-error guard is worth more than the assertion it sits under.** A duplicate-key warning
  was the only symptom of ids minted as `Date.now() + random(0..99)`.
- **Scattered failures across unrelated specs, or a run several times slower than usual, is machine
  contention.** Check `Get-Process node` and listening ports before debugging code. Never run a build
  or `graphify` during an e2e run — that contention *is* the flake variable.
- **`reuseExistingServer: !CI` attaches Playwright to a Vite server it does not own**; when the owner
  exits, every navigation is `ERR_CONNECTION_REFUSED`. The tell is uniformity — real regressions
  cluster by feature, infrastructure failures hit specs sharing only a `page.goto`.
- **A green `--repeat-each` on an idle machine is not evidence a flake is fixed**, only that the load
  is gone. Re-derive the flaky set from a full sweep; never close a flake on "passed on retry".
- **Do not edit source while a suite is running.** The dev server hot-reloads mid-run and the result
  describes no version of the code. Adding a file that matches an existing `import.meta.glob`
  (`services/providers/{http,mock}/*`) is a call-site change, not an inert addition.
- **Keep infra-dependent specs out of the default suite**, with `reuseExistingServer: false`, so a
  failure still means "the app is broken" rather than "Postgres is down".
- **`page.clock.install()` does NOT pause time — it is a rigorous-looking no-op on its own.** It
  seeds a fake clock and leaves it running, so `setTimeout` still fires. Only `clock.pauseAt()`
  stops it. Proved by a ten-line probe: with `install({ time })` alone a 400ms debounce still wrote
  its draft after three real seconds. If a test's whole point is that a timer must not fire, the
  `install` line makes it *look* controlled while the timer wins exactly as before.
- **A paused clock must be `resume()`d before the next `page.goto`.** A fresh load needs its own
  boot timers; under a stopped clock the app never paints and the failure names whatever the test
  asserted next — here `toHaveValue` on a field that was "not found", which reads as the restore
  losing the data rather than as the clock still being stopped.
- **Never trust a timing-sensitive assertion you have not mutation-proved.** A test that clicked
  "with no intervening wait" to stay inside a debounce window passed with the code under test
  deleted: every `fill` and every locator resolution is a CDP round trip, so the real gap between
  the last keystroke and the click is not reliably under 400ms. "Fast enough in practice" is not a
  test; freeze the clock and make the window unbounded.
- **A helper named `login()` that does not log in makes every test in the file assert something
  weaker than its title.** This one seeded `draazyUser` alone, which stopped being a session at the
  token rework — `AuthContext` finds no access token and no session hint, treats that as
  definitive, and calls `logoutUser()`, erasing the blob the helper just wrote. Four tests ran as
  anonymous visitors for months and none failed, because none asserted anything an account was
  needed for. The first feature to read `isIn` is what exposed it. **Probe a session helper once —
  boot a page and print the storage keys plus one signed-in-only control — instead of trusting the
  name.**
- **Fabricating a credential is not the same as fabricating a session, and is worse.** Adding a
  placeholder `draazyTokens` took the suite from 4 red to 5: `http.js` answers a 401 on any authed
  path by calling `/auth/refresh`, and a refusal there calls `logoutUser()`. The token gets *spent*
  and gets a definitive no. Answer the two endpoints that decide and end identity —
  `/auth/me` and `/auth/refresh` — with `page.route` instead.
- **A "nobackend" config does not mean no backend is reachable.** The Vite proxy forwards `/api` to
  whatever is listening on 8080, so a real server answered these calls and 401'd them. Any harness
  premise of the form "there is no server" has to be stated in code, not assumed from the filename.
- **A `has:`/`hasText:` locator is re-queried RELATIVE to each candidate, so one rooted at a
  scope is looking inside the candidate for that scope again.** `sheet.locator('.filter-group',
  { has: sheet.getByRole('button', …) })` matches nothing — it wants a second `.filter-panel`
  inside the group. Build the inner locator from `page`. The failure is not "strict mode" or
  "filtered everything out"; it surfaces several lines later as "element(s) not found" on whatever
  you chained next, which reads as the *application* not rendering.
- **Prefer identifying a section by a control only it contains over its heading text.** A regex on
  the heading (`/^Budget/`) also matched the slider's own click-to-type end labels, and the header's
  accessible name was the very string under test — it says "Budget Any" before the assertion and
  "Budget ₹0 – ₹12,000" after. `{ has: page.locator('.rng-wrap') }` is stable across both.
- **A spec that opens a control rendered inside a results area needs the results' timeout, not the
  navigation's.** The `/listings` filter pill lives in `ResultsArea`, so it does not exist until the
  catalogue answers; the same 15s click that passed on the 412px project timed out on the 360px one.
  Reads as a viewport-specific layout bug and is plain latency.
- **When a comparison test diffs surface A against surface B, assert A is non-trivial first.** Two
  broken pages both yield `[]`, and `[] === []` passes.

## Mocks and the seam

- **A mock must copy the server's access rules, not just its business rules.** Guards live in
  annotations and shared helpers, not in the method body you transcribe from. A permissive mock means
  forbidden and empty states are first exercised in production, by the person they lock out.
- **Copy the server's guard *shape*, not just its intent.** 404-not-403 for a non-participant; a mock
  that 403s teaches a screen to render an error the live API never sends.
- **Any bug living in the difference between two providers is invisible to the provider that lacks the
  field.** Ownership, masking and identity are what mocks are worst at — a mock has no reason to hide
  anything from itself.
- **The check is "does the backend do this?", not "is this mock code?"** Those have different answers.
  A denormalised column with no writer outside the seed is a promise nobody kept: grep for the
  *writes*, not the reads.
- **"Still imports `mockApi`" and "still depends on the mock" are different questions.**
- **Write down which half of a behaviour each test can prove.** A mock spec can assert the payload
  shape; only a live spec can claim the request reached a server.
- **Prioritise conversion by "which server-side behaviour has no caller on the path that actually
  produces the data", not by "which pages still write to localStorage."**
- **An endpoint existing is not evidence that it answers your question.** `GET /cities` returns what
  the database knows, not which cities a shopper may switch to. One `select count(*)` settles it
  before the recommendation, not after.
- **A list endpoint does not carry what the detail endpoint carries.** `GET /properties` sends
  `coverImage` and no `images`. Diff both field lists before moving any page that renders a collection.
- **Making sync code async converts "cannot fail" into "fails invisibly".** When a function becomes
  async, its *callers* need review. And a handler that gains an `await` gains a double-submit window.
- **`Promise.all` in a bulk action is almost always wrong** — it discards which others succeeded.
  Use `allSettled` and report what actually happened.
- **"The form is prefilled" is a property of the fixture's user, not of the form.** A spec that
  filled only subject and message, under a comment saying name and mobile arrive prefilled, timed
  out against a real new account: the mobile is prefilled from the session, the name is empty and
  required. Every "already populated" premise needs re-asking against an account the seed did not
  furnish.
- **Two byte-identical specs are not two tests.** A tree-wide SHA-256 sweep found 16 legacy/live
  pairs — 66 duplicated bodies — created by copying rather than moving during earlier conversion
  waves. Whether that is deliberate staging or an oversight is a question worth settling once, in
  writing, because the two patterns are indistinguishable from any single file.
- **Adding a domain to the seam needs `VITE_API_DOMAINS` in `playwright.config.js`**, which is a
  hand-maintained list. `frontend/.env.live` is `*` and will mislead you. Three occurrences now
  (contact/saved/savedSearch/visit, referrals, analytics), and the failure mode never changes: the
  live spec passes, because `config.js` falls back to the mock provider on a `console.warn` rather
  than an error. **A live UI assertion that a mock could also satisfy proves nothing.** Assert a
  value only the database holds — a seeded row's exact figure, a real record's title — and the
  omission announces itself on the first run instead of years later.
- **A port that carries the shape and leaves the content behind reads as a feature nobody built.**
  The flatmate tables were ported to SQL from `flatmates/constants.js` while the catalogue inside it
  stayed behind, so the board served two rooms and six empty tables and nothing failed anywhere.
  After retiring a mock provider, grep its data module for readers: none left means the content it
  held is now owed to the seed.
- **Every seeded row must be a state the server can actually reach.** `createRoom` hard-codes
  `seats_total = seats_open = 1` and exposes neither `price_basis` nor `room_kind`, so occupancy,
  `flatMax` and the whole split-the-rent block are reachable only through `POST /properties/{id}/split`.
  A fixture written past that ceiling demonstrates a screen no user can produce, and the gap then
  surfaces as a missing feature rather than as a bad fixture.

## Contracts, mappers and migrations

- **An unmapped key on a write is dropped, not rejected** — the request succeeds and the value
  vanishes. A whitelist that fails silently hides bugs.
- **Absent is not zero.** Sending `0` for a floor that is only collected for flats gives every villa
  in a society an identical duplicate signal.
- **`Number('N/A')` is `NaN`, serialises to `null`, and the contract reads `null` as *cleared*.**
  Coerce with `Number.isFinite` and omit rather than send.
- **When a write path starts populating a column, re-read every projection of it as if it were new.**
  "Was this field already in the response?" is the wrong question — it was, and it was fine. The
  question is what it now contains.
- **If the server redacts a value on read, the console must render it read-only**, omit it from the
  payload, and validate it on create only. A round-trip of a redaction is data loss dressed as an edit.
- **A structured object flattened to a string at the edge is a shape the mock renders and the API
  cannot read back.** The fix is a real `jsonb` column and a bounded map.
- **Two identifiers on one view model is a defect waiting for a route that binds a type.** `id` is the
  routing token (`slug || id`); `uuid` addresses the row. A convention followed five times and missed
  once is a habit, not a convention — and the mapper predicted the exact mistake in prose.
- **An allowlist duplicated in two languages fails in the safe direction and stays invisible.** `Sale
  Type` was on both wizards, in both initial-form objects, and on the Review screen — and absent from
  `DETAIL_KEYS` and the Java `TEXT` table, so `pickListingFormDetails` dropped it before the request
  was built. No 422, no log, no red test: the client censors itself. Neither wizard was wrong and
  neither was the server; the gap lived only in the pair. When a screen collects an answer, grep for
  the key in **both** tables, not just the one nearer the code you are editing.
- **A field that must be scoped on the way out must also be cleared on the way back.** Possession is
  asked on the sale branch only, but the `deal` cascade cleared only the deposit and the tenant list,
  so a rental carried `possession: 'ready'` into the payload from a form that never showed the
  control. A cascade that handles one direction is half a cascade — enumerate what each branch hides,
  not what it shows.
- **A duplicated allowlist needs a check that compares the two copies, not one that tests each.** The
  Java validator had 16 green tests while `transactionType` was being dropped client-side, because
  every one of them asks "does the server handle this key correctly" and none asks "do the two tables
  hold the same keys". A per-member test can never see a missing member. `check:enums` now scans the
  Java `Set.of` blocks and asserts set equality against the exported JS set — mutation-checked by
  deleting a key, because a comparison that reads nothing passes as quietly as the drift it guards.
- **`400 "Request body could not be read"` is a Jackson parse failure and names no field.** A
  comma-joined string where the DTO declares `List<String>` fails the whole document before any
  validator runs, so every submit from that screen 400s — including the shapes nobody changed.
  Reproduce with the plainest listing the form can make: if residential fails too, the defect is on
  the shared write path, not in the feature under test. The tests that stayed green posted through
  the API helper with their own object and never crossed the mapper.
- **A rule enforced by a helper is invisible to every tool that looks at types.** `@PathVariable UUID`
  is greppable; `Ids.parseUuid(...).orElseThrow(...)` three files away is not. Put the constraint in
  the contract (`format: uuid`), where both ends can see it.
- **`localeCompare`, not `<`, when pinning a server-side `ORDER BY` on text.** Postgres collation is
  linguistic; a code-point compare disagrees on one row in 155.
- **Pin an order the server promises, not one it happens to produce.** Asserting heap order makes an
  accident look intentional.
- **A nullable free-text column is not an enum.** Define the vocabulary once — spec, validation, CHECK
  constraint — and keep NULL legal *and* meaningful. Fix the contract, not the client.
- **An `allOf` that redeclares an inherited property with a narrower incompatible type makes the schema
  unsatisfiable.** Adding a field to a base schema means checking every `allOf` that inherits it.
- **A red contract test has two causes and only one is a bug** — but a contract that has fallen behind
  cannot report the next drift, which might be a field meant to stay internal.
- **Editing an applied `V__` migration changes its checksum and fails Flyway validation on the next
  start** — comments included. A correction costs a new migration.
- **A repeatable migration only re-applies when its checksum changes**, so deleted seed rows stay
  deleted. Force it with `delete from flyway_schema_history where script = 'R__...'`.
- **Reference data belongs in `R__`, never in a `V__`** — the e2e reset truncates every table and
  replays only the `R__` seeds, while preserving `flyway_schema_history`.
- **An edit that deletes a newline can comment out the next statement.** A green suite does not
  exercise a migration its database has already run. Read migrations back in full after editing.
- **`DELETE`ing a personal-data row beats nulling its identifier column.** A half-erased row leaves
  free-text personal data behind while the classification says it is gone.
- **When two fields are halves of one answer, list the pairing once and have every writer read it.**
  A flatmate pill set `propertyType` *and* `homeTypeLabel` because Row House deliberately shares the
  `independent` type; two other writers moved only the type, so a restored "Villa" could ride out on
  a `flat`. Nothing type-checks a label against a type, so a second copy of the pairing drifts with
  no lint and no red. The corollary is the reason to go looking: **starting to write a field promotes
  every place that was merely displaying it into a writer** — re-audit them the same day, because
  until now getting them wrong cost nothing.

## Backend — Spring, JPA, Postgres

- **`@Transactional` belongs on the outermost method a caller can reach.** A self-invocation never
  crosses the proxy, so the annotation applies to nobody — the stack trace shows the proxy entered
  once and stepped around. Any `private`/self-called helper carrying it is decoration.
- **`:param is null` in JPQL is a Postgres landmine** — neither side has a known type and the *whole*
  statement fails. Use `cast(:from as LocalDate) is null`.
- **A multi-column `@Query` declared as `Object[]` silently nests.** Use a projection interface with
  `as` aliases.
- **In a `@Transactional` `@SpringBootTest`, `JdbcTemplate` cannot see un-flushed JPA writes.** Call
  `em.flush()` before any raw SQL read.
- **Per-test cleanup of committed rows is impossible in a `@Transactional` test** — an `@AfterEach`
  delete joins the test transaction and is rolled back, and forcing it to commit deadlocks on the
  rows the test transaction still holds. Use `@AfterAll` (static, with the `DataSource` captured
  from `@BeforeEach`), or drop `@Transactional` for the class.
- **A Maven run that goes quiet mid-suite is a lock wait until proven otherwise.** Check
  `pg_stat_activity` for `wait_event_type = 'Lock'`; the tell is the log stopping right after the
  first test's teardown.
- **`NoClassDefFoundError` at runtime in a process that started fine means the classpath changed
  under it** — never a defect in the endpoint that reports it. Never leave `spring-boot:run` serving
  `target/classes` while anything else builds into it.
- **Broad, shallow, cross-domain failures are the environment; deep, narrow ones are the code.** A
  failure cluster confined to one domain exonerates a change in another.
- **A durable cap is not a race-safe cap.** `noRollbackFor` survives sequential transactions;
  `@Lock(PESSIMISTIC_WRITE)` serialises concurrent ones. Concurrency needs both.
- **A row lock cannot protect the *absence* of a row.** `SELECT … FOR UPDATE` has nothing to lock, so
  `findBy().orElseGet(insert)` races. Use a transaction-scoped advisory lock plus a double-checked
  read — and mutation-test it, because a race test never seen to fail is not evidence.
- **StrictMode turns "idempotent when called twice" into two concurrent requests.** An effect's
  `cancelled` local only suppresses the `setState`; the request is already in flight.
- **A guard clause makes every caller a liar unless it reads the outcome.** Branch on what the domain
  *did*, never on what the request asked for.
- **`spring.jpa.open-in-view=false` is a standing ruling (D185).** A silent N+1 becomes a loud
  `LazyInitializationException`; fetch the association in the service and never switch OSIV back on.
- **Iterative date stepping clamps once and never recovers.** Step from the original anchor.
- **Check what the shipped UI can send before adding a server-side constraint.** `@PastOrPresent` on a
  transaction date rejects post-dated cheques, which is how much of Indian rent is paid.
- **Default a policy lookup to the stricter branch.** `requiredKinds` read
  `"buy".equals(deal) ? SALE_GATE : RENT_GATE`, so every value that was not exactly `"buy"` — a null,
  a renamed wire constant, a third deal intent added later — silently took the *weaker* gate. The
  compiler says nothing, no test fails, and the only thing left holding the rule up is a CHECK
  constraint in another package. A ternary on a wire string is a policy default: point it at the safe
  branch, compare against the named constant, and pin it with a case that feeds it unknown values.
- **`@Size` on a `@RequestParam` does nothing unless the controller is `@Validated`.** Constraints on
  a `@RequestBody` record are picked up by `@Valid`; constraints on loose method parameters need the
  class-level annotation, and without it the annotation reads as enforcement while enforcing nothing.
  Check the class before trusting one — or validate in the service, where it cannot be decorative.

## Security and privacy

- **A scanner that strips punctuation to defeat obfuscation will invent the thing it scans for.**
  The contact-detail guard stripped commas and slashes so that `98,765/43210` could not smuggle a
  mobile through — which also compacted the entirely innocent `₹65,00,000 / 750 sq.ft` into
  `6500000750`, a ten-digit run starting with 6, and refused an ordinary Pune listing as if the
  owner had printed their phone number in the title. **Separate the characters that join one number
  from the characters that separate two.** Space, dot, dash and bracket sit inside a number;
  comma, slash, pipe and colon sit between numbers, and stripping those is how a price becomes a
  phone number. The false positive is the worse failure of the two: the owner cannot act on a
  message naming something they did not write.
- **Java's `\s` is ASCII-only unless you ask otherwise, and the character that actually arrives is
  U+00A0.** Every paste out of WhatsApp Web, Word or a PDF carries non-breaking spaces, so
  `9876<NBSP>543210` walked past a guard written against `\s`. Reach for `\p{Z}` and `\p{Pd}` rather
  than enumerating code points, `Normalizer.Form.NFKC` before matching, and `Character.digit(cp, 10)`
  for the Devanagari and fullwidth digits NFKC does *not* fold — on a site with Hindi and Marathi
  locales those are not an exotic attack, they are how somebody types.

- **A kill switch enforced only in the browser is not a kill switch.** `settings.flags.signupsEnabled`
  hid the Sign Up link and guarded the `/signup` route, and nothing in `backend/src/main` read it —
  so a frozen platform still minted an account for any unknown mobile that reached `POST /auth/login`,
  while the back office reported "Closed". The failure is silent and arrives exactly when someone is
  reaching for the switch. **For every flag published to clients, ask whether its description implies
  a server-side effect (a row written, an action refused); if so, the server must read it too.**
  Enforce at the write site's decision point, and document at the write site that the gate exists so
  a future second caller does not walk around it.
- **A server-side kill switch is only as durable as the row it reads.** Enforcing the flag was the
  easy half; the flag lived in a row seeded by a *repeatable* migration with a whole-document
  `ON CONFLICT DO UPDATE`, and that file is mostly generated, so any locality regeneration would
  have quietly restored `signupsEnabled: true`. The gate would have worked right up to the next
  deploy and then stopped, with the console still reporting Closed. **When a value becomes
  admin-owned, grep the seed for its key** — the same file already documented this hazard for
  `cities.live` and applied the opposite rule to itself. Whether the row can afford `DO NOTHING` is
  decided by what *absent* means: safe for a flag that defaults ON, never for a price.
- **A flag stored as the wrong type is enforced as its opposite.** Every reader treats a
  non-boolean as undecided, so `{"flags":{"signupsEnabled":"false"}}` would be stored, echoed back,
  audited as a change, and read as **on** — the operator closes signups and signups stay open.
  Refuse the write; do not coerce it, because truthiness is a guess about intent and the wrong
  guess reopens the door. Assert the refusal against `jsonb_typeof`, not a JSON path: "absent" and
  "the string false" are indistinguishable to a path assertion, which is how the first version of
  that test passed for the wrong reason.
- **"Exactly one caller" is load-bearing and a comment will not hold it.** Gating at the caller of a
  create-method is often the right call, but it silently stops being safe the day someone adds a
  second caller, and nothing goes red. Pin the call-site list with a source-scanning guard, and
  red-check it by aiming the regex at a method with many callers — an enumerating guard is exactly
  the shape that passes vacuously.
- **Participation is not authorisation.** "May this caller see this row?" is strictly weaker than "may
  they take this action?" Split them: not a participant → **404**, never confirm the row exists; a
  participant who may not act → **403**. Whenever a guard is shared by a read and a write, assume it
  was written for the read.
- **Two distinguishable 404s restore the existence oracle the status code was chosen to remove.**
  Compare bodies, not just codes.
- **Derive the sensitive value; do not validate what the client sent.** If a field identifies *who a
  request affects*, take it from something the server already trusts. The tell is an error message
  that distinguishes *why* a lookup failed — it is answering a question the caller had no right to ask.
- **A mask that still parses is worse than one that throws.** `digits('98XXXXX210')` returns a short
  plausible string. Validate on a property the bad input cannot satisfy (length === 10), refuse rather
  than fall back to a shared bucket, and fail in the direction that under-reveals.
- **A rule copied a third time has already forked.** Consolidate and let the copies disagree loudly —
  `normalise` fails closed on user input, `mask` handles values already read back, so anything odd
  reaching `mask` means normalisation was skipped.
- **The default branch of a normaliser must not be the destructive one.** A two-way normaliser over
  asymmetric outcomes needs three branches, and the third throws the `ApiError` the server would
  have sent.
- **Two independent booleans rendered by one `||` will eventually claim the wrong one.** If the labels
  differ, compose them per flag.
- **A guardrail needing an allowlist for everything is the wrong rule.** "No feature package imports
  another" was false the day it was written; acyclicity is the property worth failing a build over.
  And a documented exception is worth re-testing rather than grandfathering.
- **A browser-writable audit log is not an audit log** — the client supplies both the prose and the
  author. The server takes a resolved principal, a dotted verb, a typed entity and structured context.
- **Anonymous lead-capture forms cannot move to an authenticated endpoint at all.** Authenticated locks
  out the visitor the form exists for; attributing it to whoever is signed in loses the mobile that was
  the point.
- **"Same-origin via a dev proxy" does not mean the server skips CORS.** Browsers send `Origin` on
  same-origin POSTs, the proxy forwards it, and the CORS filter still judges it. `changeOrigin: true`
  rewrites `Host`, not `Origin`.
- **A schema built for the old shape does not mean the API will accept it.** Read the DTO's Javadoc,
  not the table — withheld columns are usually withheld on purpose.

## Product surfaces that lie

- **A surface that computes its answer locally will render a confident false negative forever.** "No
  duplicate clusters — supply looks clean" is worse than no surface, because a moderator believes it.
- **A kill switch that reports success and does nothing is worse than one visibly absent.**
- **A modal that returns `null` when its data fails to load is indistinguishable from one that never
  opened.** The screenshot shows the page with the button still on it and no error anywhere.
- **A workaround disabled in the only environment that needs it is worse than no workaround** — its
  presence is evidence the problem was understood, so an auditor finds it and moves on. Read what
  disables a workaround before crediting it.
- **Removing a rail leaves the documents it fed behind, and a document is a stronger claim than a
  screen.** Withdrawing online rent payment left a Rent Passport PDF headed "Verified rent-payment
  record" that would now be built from figures the tenant typed in — a forgery with our logo,
  handed to a prospective landlord. Seal such an artifact and say why, rather than quietly
  repointing it at the replacement data source. **When a data source is swapped, re-read every
  artifact downstream for the word "verified".**
- **"Remove feature X" almost never means the whole vocabulary of X.** Here it meant only the
  tenant→owner payment rail; the owner's per-property finance ledger, its recurring rent records,
  and the tenancy and rent-agreement surfaces all shared the word and all had to survive. Restate
  the boundary back to the user before deleting anything — the confirmation costs one message and
  the over-deletion costs a day.
- **The tab that got ported is the tab that had data.** Before writing "half-ported", ask what the
  un-ported half reads. If the answer is a seeded PRNG, it is a demo with one real tab.
- **An empty timeline is honest; a computed one is not.** Timestamps derived by arithmetic on a
  creation date and rendered as history are fabrication on a screen someone makes decisions from.
- **`aria-label` on a button with visible text overrides that text as the accessible name.** Dropping
  the visible words breaks `getByRole({ name })` *and* violates WCAG 2.5.3. Fix the component, not
  the selector.
- **ARIA vocabulary is inconsistent within a single component.** Two controls being buttons, in the
  same grid, styled identically and behaving identically is not enough to make them the same control.
  Grep the exact control, not the file.
- **A rename is not done until the locale JSON moves with it, in every language.** i18next renders a
  missing key as the key itself; nothing fails. Guarded by `npm run check:i18n`, plus a runtime sweep
  for dotted-key-shaped text, because interpolated keys are invisible to static analysis.
- **A component in `components/ui/` may not reference a page-scoped i18n namespace.** English
  namespaces are code-split and merged per route by `loadNamespaces()`; only the eager shell
  (`auth`, `chrome`, `common`, `help`, `home`, `misc1`) is in the store before any route renders.
  A key like `listings.any` therefore resolves on `/listings` and renders as the literal string
  `"listings.any"` everywhere else — which is exactly the moment a listings-only component is
  promoted to shared. Move the key into `ui` (`chrome.json`) as part of the promotion, and check
  it in all three languages, not just English.
- **`isIn` is `!!user`, so it is false for "signed out" AND for "we have not asked yet".** Any guard
  that reads it as a two-state value silently treats an unresolved session as a refusal. The window
  is real — `loading` is seeded `!!readUser() || sessionHinted()`, so a cold boot with a live
  session-hint cookie but no cached user (Safari ITP dropping `localStorage` while the refresh
  cookie survives) spends a whole round trip there. In a gated wizard that meant padlocking a
  signed-in owner, clamping them back to step 0 — **rewriting the saved step to 0 on the way, so
  they returned to their answers but not their place** — and bouncing them to `/signin` from the
  click that pays. **Derive `gated` once, three-state, and have every consumer read that one flag.**
  Four copies of `!isIn` had already drifted: the clamp waited out `loading` and the rail did not,
  so the rail drew a padlock on the panel that was on screen while no dot was active.
- **An `aria-label` next to the visible text it names makes a screen reader say it twice.** A
  padlocked step dot labelled `"{{step}} — sign in to continue"` announced "Owner — sign in to
  continue", then "Owner" from the adjacent `<span>`. Label the state, not the thing already read.
- **A gate flag that can flip without a navigation needs `role="status"`.** Signing out from the
  navbar on the same page, or boot revalidation resolving to "no session", makes a banner appear
  and a primary button relabel itself with nothing announced.
- **Debouncing on an object that is rebuilt every render debounces the RENDER, not the CHANGE.** A
  form autosave keyed its effect on `form`, which every caller builds fresh via
  `captureShareableState()`; the 400ms was therefore measured from the last render, so any render
  cadence faster than the debounce starves the write forever. It worked only because nothing
  re-rendered those pages in a loop — an accident, not a guarantee. Serialise during render and
  debounce on the string; the string is what gets stored anyway, so it is work moved, not added.
- **A debounced save cancels its pending timer on unmount, so any deliberate navigation destroys
  the write it was counting on.** A sign-in gate that promises "your answers will be here when you
  come back" must `flush()` synchronously before it navigates, or the last field typed is the one
  field missing. Invisible in manual testing — a human takes longer than 400ms to move from the
  last input to the button.
- **A clamp that runs as a passive effect corrects AFTER paint.** Restoring a draft onto a
  forbidden step and clamping back in a `useEffect` flashes the forbidden panel for a frame — here,
  empty PAN and Aadhaar inputs on the exact surface the gate existed to make unreachable.
  `useLayoutEffect` for guard corrections that follow another effect's `setState`.
- **A custom `Select` renders a `<button>`, so `htmlFor` can never reach it.** Two admin dropdowns
  were labelled by placeholder alone — no caption on screen, and once a value was picked, no label
  at all. Give it a visible caption that is a real substring of its `ariaLabel`, plus an
  `ariaDescribedBy` passthrough, which is the only way to reach the sentence explaining why the
  control is dead when nothing has been uploaded.
- **Two identical-weight buttons a hairline apart read as one sequence, whatever the copy says.** A
  panel whose own prose called recording evidence and granting a badge separate decisions put them
  side by side at the same weight; they became numbered steps, with the record button carrying "It
  does not grant the badge". A control that no longer applies should unmount rather than render
  permanently disabled — disabled still reads as something you may yet do.
- **Rendering `err.message` to a user shows them the seam's own developer line.** A failed OTP send
  displayed `[services] could not load the "auth" provider.` — a stale precached PWA shell asking
  for chunks the deploy had replaced, which never reaches the network, so "try again" is a lie as
  well as a sentence nobody can act on. Map every refusal to a key in an eagerly-loaded namespace,
  render it on all four OTP surfaces, and assert the translated sentence AND the absence of the
  server's English.

## Reviews, agents and surveys

- **A reviewer's severity is a hypothesis; verify the mechanism before acting.** One review returned
  1 CRITICAL and 3 HIGH: two real, two already handled, and the CRITICAL had its polarity backwards.
  Elsewhere a HIGH "off-by-one" would have introduced the bug it claimed to remove. Leave a comment
  where you reject a finding so the next author does not "fix" it.
- **An agent's green build is evidence about the build, not the code.** Two of four delegated
  sub-slices contained real defects, and one agent-written test pinned an enumeration oracle in place
  by asserting the leaky error wording.
- **A delegated survey is a lead, not a verdict.** Roughly 30% of one survey's specific citations were
  wrong while the *shape* of the finding was right. Trust the shape, verify the instances, and ask
  which directories were swept — a partial sweep presented as complete turns a count into a floor.
- **A regex sweep for anti-patterns over a codebase that documents its anti-patterns over-reports.**
  Exclude comment bodies before counting.
- **A text scan cannot tell a call from a comment about a call, and the mistake is always in the
  safe-looking direction** — something looks *more* connected than it is, which hides work rather than
  inventing it. Require the hit to occur where a request can originate.
- **A comment can be load-bearing and false.** If a comment states a fact, go and read the fact; a
  comment asserting correctness is a good place to look for bugs.
- **When a workaround turns out to be load-bearing for a defect, grep the whole tree for it.** The
  guard appeared in eight files, not the two the survey found — and searching for the rarer of two
  co-occurring anti-patterns finds more than searching for the common one.
- **When an audit's premise turns out to have been too narrow, redo it even if the first answer was
  right.** An answer reached by a method that could not have seen the counter-examples is a coin that
  landed heads.
- **The value of an exhaustive list is the property it proves, not the rows.** "There is no importer
  whose fate is unknown" stays true while the rows churn — and a list where every row must have a
  reason turns a missing reason into a signal.
- **The audit that finds nothing is worth writing down**, especially as the second half of one that
  found something.
- **A harness that reports only what it was told to look for certifies its own blind spots.** Make the
  default outcome "fail until judged"; compare the union of keys across all rows, not `list[0]`; and
  print which instance answered, because a stale dependency and a real regression are
  indistinguishable from the assertions alone.
- **Fan out the audit, serialise the edits.** Read-only subagents in parallel produce evidence-backed
  drift lists; asking a subagent to *edit* races on shared files.
- **The first failure masks the rest.** "I fixed the error" is never "the test passes". A spec that has
  never run in a given configuration has several faults, not one.
- **Never set up a fixture with raw SQL for rows the same transaction has already loaded.** A test
  that started a case file over MockMvc and then ticked its checklist with a `jdbc.update` got a
  409 from the very gate it was arranging to pass: the entities were already in the persistence
  context reading `false`, so the UPDATE went to a database nobody re-read. The symptom looks like
  a product bug (`expected 200 but was 409`) rather than a fixture one. Arrange through the same
  endpoint the product uses — here `PATCH /verification/checklist` — or the fixture is arranging a
  state the code under test cannot see.
- **`graphify update` leaves the graph correct and the report stale, and silently drops the curated
  community names.** It re-clusters (825 labelled communities became 1038), so the saved LLM names
  no longer match and every one falls back to its hub symbol; it also does not regenerate
  `GRAPH_REPORT.md`, which then reports a node count and a commit from before the run. Follow it
  with `.\scripts\graphify.ps1 report`, and know that restoring names costs an LLM pass
  (`graphify label`) that `--code-only` deliberately avoids. Deleted files leave orphan annotation
  nodes with an empty `source_file` — harmless, since nothing points at the dead path.
- **When failures are broad, check the environment before reading a single assertion.** A ten-line
  spec hooking `page.on('pageerror')` diagnoses "everything is red" faster than reading failures.
- **Ask the database about data; grep source for source.** One `psql` join answered in seven rows what
  cost 30 KB of context as single-line `INSERT` matches — and answered it better.
- **Do not fix a shared helper in passing.** Changing a locator eleven specs depend on, mid-conversion,
  trades a documented gap for an unknown suite-wide flake.
- **Prove "pre-existing" instead of asserting it**, and never `git stash` to establish a baseline when
  untracked files are part of the change — you get a tree that measures nothing.
- **Don't reformat JSON to insert one key.** Anchor on a neighbouring key and edit lines; `JSON.parse`
  the result only as a validity check.

## Architecture and product judgement

- **Two routes to the same verdict is fine; two routes that leave the same record saying different
  things is not.** A listing could be approved from the verification desk (checklist gated) or from
  the moderation queue (never opens the case file, so bulk approve works at all). Both are
  defensible acts, but the queue route left `property_reviews` reading `pending`, unattributed,
  beside a live listing — the ops desk saw outstanding work on a decision already taken, and the
  audit said nobody approved a listing right beside a row naming who did. The fix is not to merge
  the routes or to gate the fast one; it is to make the quiet one **write down that it ran, and what
  it skipped**. Before collapsing two paths, ask whether they disagree about the *act* or only about
  the *bookkeeping*.
- **When closing a record a shortcut never opened, do not tidy the evidence.** Ticking the skipped
  checklist would have made the row look like a full document review — forging exactly the evidence
  the gate exists to demand. Unticked lines beside a closed case are the honest statement. Likewise,
  do not *create* the record where none exists: absence asserts nothing false, and a bulk action
  that opens forty case files files forty work items whose entire content is that the work did not
  happen.
- **A guard that throws after the verdict is written is a guard in the wrong place.** Publication
  refused a blank locality from inside `publish`, which runs after `review.decide` — so the rollback
  took the verdict with it and a reviewer who had just worked a whole checklist lost it to a
  curation task that is not theirs. Atomicity was right; the ordering was not. **Hoist the
  preconditions the actor cannot fix to before the first write**, and let both callers share the one
  message that names what to do about it.
- **Verification is a badge that earns visibility, never a precondition to act** (ADR-019).
- **A visibility blacklist is a leak waiting for the next state.** Moderation must be a whitelist, and
  hiding a row from a list while leaving it reachable by id is an unlisted page, not moderation.
- **`pending ≠ active`.** Buying a priced plan does not grant it; the payment webhook does. Same shape
  in plans, finalization and rent.
- **A nullable limit means "this plan states no number", and every reader must resolve it the safe
  way** — `plans.listing_limit` is NULL on tenant plans and resolves to the free-tier floor, not to
  "no cap". Where unlimited is a real entitlement, give it its own boolean (`unlimited_contacts`).
- **`totalElements` is an aggregate.** `?size=1` answers most "do we need a count endpoint?" questions.
- **Cloud Run scales to zero, so native `@Scheduled` cron is unreliable.** Use an external trigger.
- **"Deferring Redis" is not "deferring caching"** — CDN, cache-at-write and in-process Caffeine still
  cache at MVP. Redis adds a *shared* cache and distributed rate limiting.
- **Never store a raw Aadhaar number.** Use the aggregator's entity-scoped UID token as the dedup key.
  There is no legal phone→Aadhaar lookup; the OTP is the trust anchor. The login OTP proves control of
  the SIM, the OKYC OTP proves identity — do not conflate them.
- **Zero-MDR is not free UPI**: the network cost is mandated to zero, the aggregator's service fee is
  not. At MVP volume, paying the aggregator beats building reconciliation yourself.
- **Set the data-caching boundary before the data exists.** `/api/* → NetworkOnly` costs nothing while
  the app is on mock data; bolting it on later means experimenting on real listings.
- **A regex `urlPattern` in a service worker is tested against the whole URL and fails open.** Match on
  `url.pathname`, and assert the exclusion by walking Cache Storage.
- **An offline PWA fails to a blank white screen.** Test "load once → go offline → reload".
- **An unassigned module in `manualChunks` is folded into whichever chunk references it** — one 3 KB
  shared module pulled 189 KB of charting in front of first paint. Grep finds imports; only the
  bundler knows the graph, so verify `dist/index.html`, not the source.
- **`docs/flows/**` describe current UI behaviour, not target.** The architecture doc is the SoT for
  the target; re-sync flow docs *from* source only after the UI changes.
- **A rename is a doc-wide event.** Grep the old vocabulary across `docs/**` before declaring it done.

## Environment and tooling

- **Never round-trip a source file through `Get-Content` → `Set-Content`.** Windows PowerShell 5.1
  decodes with the ANSI code page and re-encodes as UTF-8-with-BOM, so every em-dash, `·` and `…` in
  the file is silently mangled and a BOM is prepended — which then shows up as
  `Parsing error: Unexpected character` from ESLint, or as an accessible name carrying an invisible
  `U+001D` that no `getByRole` will ever match. It corrupted a 550-row `COVERAGE.md` in one command.
  Use the `edit`/`create` tools for text, or `[IO.File]::ReadAllText` / `WriteAllText` with an
  explicit `UTF8Encoding $false`. If it has already happened to a tracked file, `git checkout` it
  and re-apply the change; if untracked, repair it and then scan for `U+FFFD` **and** control
  characters, because the two damage patterns are different and fixing one hides the other.
- **Backend is Java 25 (Zulu at `C:\Program Files\Zulu\zulu-25`), Spring Boot 4.1.** `mvnw.cmd` lives
  in `backend/`, not the repo root; `.\run-local.ps1 -Port 8099` is the intended local entry point.
- **The local Postgres password is `postgres` — never prompt for it, never stall on it.** It is the
  committed default in `application.properties` (`${DB_USER:postgres}` / `${DB_PASSWORD:postgres}`)
  and is local-only: `application-prod.properties` reads `${DB_URL}`/`${DB_USER}`/`${DB_PASSWORD}`
  with no fallback, so this value cannot reach a deployed environment. `psql` is not on PATH; the
  non-interactive form is
  `$env:PGPASSWORD='postgres'; & 'C:\Program Files\PostgreSQL\13\bin\psql.exe' -U postgres -d <db> -P pager=off -v ON_ERROR_STOP=1 -c "..."`.
  Without `PGPASSWORD` psql opens a hidden prompt and the call has to be abandoned.
- **`max(version)` on `flyway_schema_history` is a LEXICOGRAPHIC max and lies.** `version` is
  `varchar`, so `'9' > '97' > '89'` and a DB at V97 can report `9`. Always
  `max(version::int) where version ~ '^[0-9]+$'`. Reading the fake answer as "the dev DB is at V9"
  nearly triggered a pointless migration investigation.
- **An e2e lane serves the code it compiled at start-up, so a `422` can be two-hour-old bytecode.**
  A rejection whose every value is legal under the current validator is the tell. Compare the source
  file's `LastWriteTime` against its class in `target-<lane>\classes`, and the listening PID's
  `StartTime` (`Get-NetTCPConnection -LocalPort <port> -State Listen`), before reading the failure
  as a product bug. `Stop-Process -Force` then re-run the lane script and poll `/api/actuator/health`.

- **The three DBs drift and the dev one is the stale one.** `draazy` (dev) sat at **V76** while
  `draazy_e2e` was at **V97** — 21 migrations of columns (`room`, `sharing`, `tenants`, `land_use`,
  `pets`, `available_from`, `quality_score`, `last_confirmed_at`) exist in one and not the other.
  Never conclude "the server has no such column" from the dev DB; check `draazy_e2e`, or the
  migration files, which are the real source of truth.
- **`get_errors` on a `.java` file reports the IDE language server's stale view.** Never accept it as
  proof for backend Java — compile. And `mvnw.cmd compile` without `clean` is frequently a no-op, so
  MapStruct never regenerates; use `clean compile` when a DTO/record/entity shape changed.
- **The CLI build writes to `backend/target-cli/`; `backend/target/` is the IDE's own, often stale,
  output.** Always inspect generated sources under the one you built.
- **The Maven exit code is not trustworthy here** — aggregate `target-cli\surefire-reports\*.txt`.
- **`-Dtest=A+B+C` matches nothing.** Surefire wants commas, and with `-DfailIfNoTests=false` a typo
  still exits 1, so it reads like a test failure.
- **PowerShell 5.1**: no `&&`/`||` (chain with `;`, gate with `if ($?)`); heredocs do not exist (write
  a file); `Out-File -Encoding utf8` writes a BOM — use
  `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`;
  `Get-ChildItem -Filter` takes one string (use `-Include -Recurse`).
- **Never put a non-ASCII character in a `.ps1`.** PowerShell 5.1 reads scripts as ANSI, so a UTF-8
  em-dash decodes to a byte sequence ending in U+201D — a real string delimiter. The reported error
  line is not the broken line. Verify with `Select-String -Pattern '[^\x00-\x7F]'`.
- **The edit tool matches raw bytes**, so target ASCII-only substrings. Concurrent edits to the same
  file in one turn hit `EBUSY`; apply them sequentially.
- **`git show HEAD:path > scratch` must go through `cmd /c`** — PowerShell redirection writes UTF-16.
- **Backend source was once entirely untracked**, and pairing a bulk move with a force-delete lost 22
  files. Never pair a bulk move with a force-delete on an untracked tree; `git mv` presupposes tracked
  files. Recovery was VS Code Local History, whose snapshots can predate your most recent edits — diff
  a restore against the worklog before believing it.
- **Never run an unvalidated bulk-rewrite script across the tree.**
- **Never `JSON.parse` → `JSON.stringify` a hand-formatted JSON file.** The round-trip strips the
  blank lines that group keys, so deleting one key from a locale file produced a 1-added/38-removed
  diff. The tell is a diff wildly disproportionate to the change; the fix is a line-based edit that
  matches `^\s*"KEY"\s*:`, asserts exactly one hit, repairs the trailing comma when the deleted line
  was last in its object, and `JSON.parse`s the result before writing.
- **An "unreferenced i18n key" list is a candidate list, never a delete list.** Keys assembled by
  template literal — `` t(`misc.${tKey}Title`) `` — are invisible to a literal grep, so a dead-key
  scan confidently reports live keys as dead. Open the component before deleting.
- **Never anchor a string replacement on a decorative rule line.** Box-drawing banners
  (`/* ─── … ─── */`) do not survive being retyped; anchor on adjacent code or prose instead.
- **Run browser-coupled modules through Vite, not bare Node** —
  `createServer({ middlewareMode: true }).ssrLoadModule(...)` exercises the module the browser runs.
  A partial `globalThis.window` stub is worse than none: it passes the `typeof window` check written
  to detect its absence.
- **Playwright text matchers are byte-exact**, so a mojibaked character in an assertion never matches
  and surfaces as a generic timeout. Diagnose by dumping codepoints, not by eyeballing. Only mojibake
  inside assertion strings breaks tests; the same corruption in comments is cosmetic.
- **An exemption is a hole in a guard, and a stale exemption is silent by construction** — a path list
  never matches a file that no longer exists.
- **A guard that is ALREADY RED hides the violation you just added.** The size guard failed at HEAD
  with two services over the trigger, so a third — pushed over by twelve lines of comment on a new
  erasure step — arrived inside an expected failure and read as baseline. Diff the guard's *reported
  entries* against HEAD, never just its pass/fail, and `git diff --numstat` each named file to see
  whether you touched it. A known-failing gate needs its contents compared, not its status.
- **When prose duplicates an audit record, delete the copy rather than the record.** The "why the
  whole row goes" reasoning already lived in the erasure classification map; repeating it at the
  call site bought nothing and cost the budget that tripped the guard. Ask which file a reader
  actually consults for that question, and keep it only there.
- **This machine's network is a GitHub-only allowlist.** `raw.githubusercontent.com` answers;
  `modelscope.cn`, `huggingface.co` and `paddleocr.bj.bcebos.com` all fail the TLS handshake with
  `SEC_E_ILLEGAL_MESSAGE`, with no proxy set. The handshake error reads like a client TLS bug and is
  not one — it cost a round of "fix PowerShell's TLS 1.0 default" before a four-host reachability
  probe showed the real shape. **Probe reachability before designing anything around a downloaded
  asset**, and check whether CI shares the constraint before committing to a build-time fetch. Model
  weights are the usual casualty: RapidOCR publishes its only to ModelScope, and every GitHub release
  from v1.4.4 to v3.9.2 carries `assets: []`, so there is no mirror to fall back to.
- **The persistent shell mangles long single-line URLs containing `?` and `&`**, splitting them
  mid-string; and multi-line blocks with `@(`…`)` arrays get mangled too. Write a `.ps1` and run it.
- **`fetch_webpage` on a GitHub repo root or the releases API returns enormous duplicated
  boilerplate** and can exhaust the context budget in one call. Prefer `github_repo` search or a
  narrowly targeted raw-file URL.
- **The mock app stores its whole DB under one localStorage key with no merge to defaults**, so
  seeding a partial DB pre-boot white-screens the app. Seed extra rows after boot.
- **The cookie-consent banner intercepts clicks on bottom-anchored targets.** Any new bottom-click or
  mobile-FAB spec must seed `dz_cookie_consent_v1`.

## House style

Match it. It is the reason this codebase is navigable. (Rescued from `tasks/HANDOFF.md` when that
file was retired — the rest of it had gone stale, but this had no other home.)

**Backend Javadoc, SQL, OpenAPI:** bold lead-ins (`<p><strong>Why …</strong>`), the counter-example
that motivated the design, and an explicit statement of what the code deliberately does *not* do.
For withheld fields: *"Absent (NON_NULL) rather than null, so the shape of the response does not
advertise that a field is being withheld."*

**Frontend comments:** when you delete something, leave a comment saying what stood there and why it
went. When deleting N repetitive calls, write **one** consolidated block comment at the first site
and name the honest cost.

**Migrations:** a long `--` header giving why the object exists, why nullable, why no backfill, why
this index, why no FK. `V86`–`V88` are the models.

**Specs:** long docblock header ending `Fixtures: …`. Named constants with `/** … */`. Deltas, not
absolutes, for append-only ledgers. Never guess a UI anchor. Every sweep needs a floor. Never wrap
an assertion in `if (await x.isVisible())`. **`networkidle` is a sleep with a network-shaped excuse.**
Locate by role and accessible name. **Assert the status of the write, not the state of the control.**
An assertion of absence needs a positive readiness gate. An assertion of rejection needs a matching
assertion of acceptance. Prove a write reached the database with a reload. A live spec that mutates
shared seed data must restore it. **When two components must agree on a value, fetch both and
compare — never assert the value's shape.**

**Register items:** `## N. <one-sentence claim as a heading>`, `**Where:**` with file:line,
`### What happens today`, `### Why this is not a port`, `### Options` (numbered, recommendation
bolded), `### Related`. **When resolved, insert a `> **RESOLVED — …**` blockquote immediately under
the heading**, naming the commits, what was deliberately left undone, and where the coverage lives.

**Commit messages:** long-form, narrating the reasoning and what was deliberately *not* done, with
`##` sections, a "Deliberately not done" section, and a `Verified:` line. **When a wrong intermediate
conclusion was reached and corrected, keep both** — the correction is the useful part. Models:
`26129a2`, `368ad4f`, `38c33a7`, `7b7c006`, `fbbfd18`, `48386b2`.

**`tasks/todo.md` D-entries:** `## D<N> — <the commit's subject line>`, then the narrative with `###`
sections, a bolded generalisable rule in a blockquote where one emerged, a `**Verified:**` line, the
commit hash, and a `### Deliberately not done`.

**When a claim in an existing Javadoc, comment, spec header or document turns out to be false, quote
it and correct it in place.** Do not silently delete it — the correction is the useful artefact. This
applies to documents written minutes earlier in the same session. Conversely, when an existing
Javadoc turns out to be *right*, quote it.
