# Lessons

> **One line per rule: trigger, then the rule.** Grep it for the symptom — do not read it whole. The incident behind each rule is in git.
> Add a new lesson as ONE line (≤ ~200 chars) in the matching section; merge it into an existing line if it is a near-duplicate.

## Crawling external sources

- **A 200 saying "No Records Found" is a failure** (MahaRERA answers overload with a short shell, not a 5xx). Detect on the body, never the status.
- **Mark work done only when it produced rows**; stamp each row with its source page so gaps are provable (empty "done" pages were skipped forever on resume).

## Upload policy

- **PDF compression is part of the document flow** (`pdf.worker.js`): digitally signed PDFs are unsupported, so ask for unsigned copies; never call rasterizing lossless or promise every file fits 1 MB.

## Tests: what green does not prove

- **A green build does not prove a new prop is passed.** When adding a prop, grep every `<Component` call site; Vite builds clean and crashes at runtime.
- **A spec never executed is a claim, not coverage.** The first full run found six broken specs, none a product bug.
- **A run longer than the token TTL is a different experiment**: a session replayed past 15 min presents a rotated refresh token and reuse detection revokes the family.
- **A spec that mutates a seeded actor breaks the next spec's premise** (DB resets once per run, not per file). Restore shared seed data.
- **Before enriching a shared seed row, grep who depends on it being bare**; a fixture that reads richer is often wrong. Select fixtures by the fields asserted, never `rows[0]`.
- **A `@Transactional` test base cannot see commit-time bugs, missing transactions or fetches**: wiring needs a bare `@SpringBootTest`.
- **A `@Transactional` MockMvc test cannot prove a REJECTED write did not persist** (follow-up read auto-flushes it); assert the status and say why the read is absent.
- **Arrange fixtures through the product's endpoint, never raw SQL on rows the transaction already loaded** (`jdbc.update` after MockMvc gave a 409 from the gate under test).
- **Grep the application log after a green run**: sweeps, schedulers and listeners fail silently.
- **Prove a regression test fails on old code** (`git show HEAD:<path>`, or `if (false)` the guard); a test passing via a side effect of the fix is not a regression test.
- **Before editing a red assertion, say whether the test or the product is wrong**; one in five was a real regression.
- **A gate that now refuses what it allowed has callers the old looseness served** (`PATCH /status → approved` re-listing a fallen-through sale got 409); enumerate them first.

## Assertions that assert nothing

- **`toBeVisible()` passes on `opacity: 0`, and e2e runs reduced-motion, which forces `.reveal` to opacity 1.** Assert the `visible` class `useScrollReveal` adds; prove it by deleting the hook call.
- **`[].every(...)` is true; `expect([]).toEqual([])` passes.** Every sweep needs a floor, returned by the helper; assert A is non-trivial before diffing A against B.
- **A "page loaded" assertion any page satisfies is not one** (`getByRole('heading').first()`, `waitForLoadState`, URL after client 404). Name the heading.
- **A negative assertion needs a positive anchor** ("counter still reads 0" passes for a button wired to nothing) **and a negative anchor that makes a lazy assertion fail**.
- **Prove provenance before asserting on content**: observe the request or `totalElements` first, or a silent fallback passes everything.
- **An absence assertion on the wrong ARIA role can never fail** (`Call`/WhatsApp render as `tel:`/`wa.me` anchors, not buttons). Read what the component emits.
- **Prove a negative with a tool you have seen return a positive** (a recursive `Select-String` falsely said `match.saved-search` existed nowhere); re-ask with a different command.
- **A rollback-only probe under `@Transactional` tests can be a permanent `false`**: only the bound `ConnectionHolder` is marked. Grep for a prior `isRollbackOnly()` first; red-check by deleting the exception from `noRollbackFor`.

## Playwright

- **`page.route(..., { times: 1 })` is spent by StrictMode's first, discarded load.** Route persistently and `page.unroute()` before the recovery action.
- **`setInputFiles` skips actionability checks** and sets files on a disabled input silently. Wait for the preceding operation to be observably finished (`[data-err="photos"]` `aria-busy="false"`), then assert the filename.
- **`getByText('X')` is a case-insensitive substring match** — use `{ exact: true }`. `title=` feeds the accessible name; scope modal footers to `getByRole('dialog', { name })`.
- **`components/ui/Table.jsx` renders rows twice (`sm:hidden` card + table).** Scope to `getByRole('row', { name })`; its empty state is a `tbody tr`, so `toHaveCount(0)` never passes.
- **Anchor phone regexes**: use `MOBILE` from `fixtures/live.js` (`/(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/`); unanchored matches inside ids and `Date.now()`.
- **`page.addInitScript` re-runs on every navigation**, overwriting later sign-ins. Seed with `page.evaluate` after load, then `reload()`.
- **`locator.count()` does not retry**: `expect(x.first()).toBeVisible()` first.
- **A `waitForRequest` predicate must identify the caller** (admin bell asks the same `/admin/properties?status=pending` with `size=5`); match on `size` or similar.
- **`if (await x.count()) await x.click()` is a silently skipped test, and a diagnosis-sounding `test.skip` stops anyone looking.** Fail loudly unless the environment is genuinely unsupported.
- **`waitForTimeout`: if the next line retries, delete the sleep; if it is a non-retrying read, replace it with an assertion on the LAST observable effect** (result count after `useDeferredValue`).
- **`waitForLoadState('networkidle')` is a sleep with a network-shaped excuse**; replace per route. `page.goto` resolving does not mean a `lazy()` route's effect ran — wait on its side effect.
- **Scattered failures across unrelated specs, or a much slower run, is machine contention**: check `Get-Process node` and ports; never build or run `graphify` during an e2e run.
- **`reuseExistingServer: !CI` attaches to a Vite you do not own**; uniform `ERR_CONNECTION_REFUSED` is infra (regressions cluster by feature). Keep infra-dependent specs out of the default suite.
- **Do not edit source while a suite runs** (hot reload; a new file matching an `import.meta.glob` such as `services/providers/http/*` is a call-site change).
- **`page.clock.install()` does NOT pause time** — only `pauseAt()` does. Under a paused clock `resume()` before the next `page.goto`; prove timer tests by deleting the code under test.
- **Probe a session helper once** (boot, print storage keys + one signed-in-only control): a `login()` seeding only `draazyUser` ran four tests anonymous.
- **Do not fabricate `draazyTokens`**: `http.js` 401 → `/auth/refresh` → `logoutUser()` spends it. Answer `/auth/me` and `/auth/refresh` with `page.route`.
- **A "nobackend" config can still reach a backend**: the Vite proxy forwards `/api` to :8080. State "no server" in code.
- **A `has:`/`hasText:` locator is re-queried relative to each candidate**: build the inner locator from `page`, not the scope, or it surfaces later as "not found".
- **The cookie banner intercepts bottom-anchored clicks**: seed `dz_cookie_consent_v1` for bottom-click or mobile-FAB specs.
- **Live specs need a value only the DB holds** (seeded row's exact figure); a new `providers/http/<domain>Provider.js` is globbed by `config.js`, unknown domains only `console.warn`.

## Service seam and API shape

- **An endpoint existing is not evidence it answers your question** (`GET /cities` lists what the DB knows, not what a shopper may switch to). One `select count(*)` first.
- **A list endpoint omits what detail carries** (`GET /properties` has `coverImage`, no `images`). Diff both field lists before moving a collection page.
- **Making a function async turns "cannot fail" into "fails invisibly"** and gives a handler a double-submit window; review callers.

## Contracts, mappers and migrations

- **An unmapped key on a write is dropped, not rejected**; a silent whitelist hides bugs. Absent is not zero (never send `0` for a flats-only floor).
- **`Number('N/A')` is `NaN` → `null` = "cleared"**: coerce with `Number.isFinite` and omit.
- **When a write path starts populating a column, re-read every projection of it**; when a field becomes written, every display-only place becomes a writer.
- **If the server redacts on read, render read-only**, omit from payload, validate on create only.
- **`id` is the routing token (`slug || id`); `uuid` addresses the row** — a route binding the wrong one is the recurring bug.
- **An allowlist duplicated across Java and JS drifts silently** (`transactionType` dropped by `pickListingFormDetails`; `DETAIL_KEYS` vs Java `TEXT`). `npm run check:enums` compares the sets; grep BOTH tables.
- **A field scoped on the way out must be cleared on the way back** (rental carried `possession: 'ready'` from a hidden control): enumerate what each branch hides.
- **`400 "Request body could not be read"` is a Jackson parse failure naming no field** (e.g. comma-joined string for `List<String>`); if the plainest listing fails too, it is the shared write path.
- **Editing an applied `V__` migration (comments too) breaks Flyway checksums**; correct with a new one. Re-read edited migrations in full (a deleted newline can comment out the next statement).
- **A repeatable `R__` migration re-applies only on checksum change**: force with `delete from flyway_schema_history where script = 'R__...'`. Reference data belongs in `R__` (e2e reset replays only `R__`).
- **`DELETE` a personal-data row rather than null its identifier** (half-erased rows leak free text).

## Backend — Spring, JPA, Postgres

- **`@Transactional` goes on the outermost reachable method**; self-invoked/`private` helpers never cross the proxy.
- **`:param is null` in JPQL fails on Postgres**: use `cast(:from as LocalDate) is null`.
- **A multi-column `@Query` returning `Object[]` silently nests**: use a projection interface with `as` aliases.
- **In a `@Transactional` `@SpringBootTest`, `JdbcTemplate` cannot see unflushed JPA writes**: `em.flush()` before raw SQL.
- **Per-test cleanup of committed rows is impossible in a `@Transactional` test** (rolled back, or deadlocks): use static `@AfterAll` with a captured `DataSource`, or drop `@Transactional`.
- **A non-`@Transactional` `@SpringBootTest` must erase the rows it commits** (`@AfterEach`): leftover verification rows broke other classes depending on run order.
- **"too many clients" in the full suite is the context cache**: each cached context holds a Hikari pool, so `src/test/resources/spring.properties` caps it at 12 to stay under `max_connections=100`.
- **A Maven run going quiet mid-suite is a lock wait**: check `pg_stat_activity` for `wait_event_type = 'Lock'`.
- **`NoClassDefFoundError` in a process that started fine means the classpath changed underneath it**; never leave `spring-boot:run` on a dir another build writes.
- **A durable cap is not race-safe**: `noRollbackFor` survives sequential transactions, `@Lock(PESSIMISTIC_WRITE)` serialises concurrent ones — need both.
- **A row lock cannot protect the absence of a row** (`findBy().orElseGet(insert)` races): transaction-scoped advisory lock + double-checked read, mutation-tested.
- **`spring.jpa.open-in-view=false` is a standing ruling (D185)**: fetch associations in the service; never re-enable OSIV.
- **Default a policy lookup to the stricter branch**: `"buy".equals(deal) ? SALE_GATE : RENT_GATE` gave unknowns the weaker gate; compare against the named constant and test unknown values.
- **`@Size` on a `@RequestParam` does nothing without class-level `@Validated`**; validate in the service.

## Security and privacy

- **A scanner stripping punctuation invents what it scans for**: space/dot/dash/bracket join digits, comma/slash/pipe/colon separate — `₹65,00,000 / 750 sq.ft` must not become a phone number.
- **Java `\s` is ASCII-only; pastes carry U+00A0.** Use `\p{Z}`/`\p{Pd}`, `Normalizer.Form.NFKC`, and `Character.digit(cp, 10)` for Devanagari/fullwidth digits.
- **A kill switch enforced only in the browser is not one.** For every client-published flag implying a server effect (`signupsEnabled`), the server must read it at the write site's decision point.
- **A server-side switch is only as durable as its row**: a regenerated `R__` seed with whole-document `ON CONFLICT DO UPDATE` restores defaults; grep the seed for admin-owned keys.
- **A flag stored as the wrong type is enforced as its opposite** (`"false"` read as on). Refuse the write, do not coerce; assert against `jsonb_typeof`.
- **"Exactly one caller" is load-bearing**: pin the call-site list with a source-scanning guard and red-check by aiming it at a many-caller method.
- **Participation is not authorisation**: non-participant → 404 (never confirm the row), participant who may not act → 403; two distinguishable 404s restore the existence oracle. A guard shared by read and write was written for the read.
- **Derive the sensitive value; do not validate what the client sent**; error messages that distinguish why a lookup failed answer questions the caller may not ask.
- **A mask that still parses is worse than one that throws**: validate a property bad input cannot satisfy (length 10), refuse rather than share a bucket, under-reveal; a normaliser's default branch must not be destructive.

## UI surfaces that lie

- **A locally computed answer renders a confident false negative forever** ("no duplicate clusters"); arithmetic on a creation date shown as history is fabrication.
- **Removing a rail leaves the documents it fed**: a Rent Passport PDF headed "Verified" from tenant-typed figures is a forgery. Seal it; grep downstream artifacts for "verified".
- **"Remove feature X" rarely means all of X's vocabulary**; restate the boundary to the user before deleting.
- **`aria-label` on a button with visible text overrides it** (breaks `getByRole({ name })`, WCAG 2.5.3); don't add one next to text it names (read twice). Label the state, not the thing already read.
- **A custom `Select` renders a `<button>`, so `htmlFor` cannot reach it**: give a visible caption that is a substring of `ariaLabel`, plus `ariaDescribedBy`.
- **A rename is not done until locale JSON moves in every language** (i18next renders the key). `npm run check:i18n` plus a runtime sweep for dotted-key text.
- **`components/ui/` may not use page-scoped i18n namespaces**: only the eager shell (`auth`, `chrome`, `common`, `help`, `home`, `misc1`) is preloaded; put shared keys in `chrome.json`, all three languages.
- **`isIn` (`!!user`) is false for "signed out" AND "not asked yet"** (`loading` seeds from `sessionHinted()`). Derive `gated` once, three-state, or the saved step is rewritten to 0.
- **Debounce the serialised string, not an object rebuilt each render** (`captureShareableState()`), or the 400 ms measures renders.
- **A debounced save cancels on unmount**: `flush()` before deliberate navigation (sign-in gates).
- **Never render `err.message`** (a stale PWA shell leaked `[services] could not load the "auth" provider.`): map refusals to an eager-namespace i18n key; assert the translated text and no server English.
- **Freshness is not publication status**: gate Active/Availability badges and reactivation on approval.
- **Don't change a sticky bar's position on input focus** — the blurring tap lands under the finger and is lost (`seam-write` caught it by asserting the stored value).

## Reviews, agents and surveys

- **A reviewer's severity is a hypothesis**: verify the mechanism; comment where you reject a finding so no one "fixes" it.
- **A delegated survey is a lead, not a verdict**: ~30% of citations were wrong though the shape was right; ask which directories were swept; verify each agent slice.
- **When a workaround proves load-bearing, grep the whole tree for it** (eight files, not two); search the rarer of two co-occurring anti-patterns.
- **A harness reporting only what it was told to find certifies its blind spots**: default to fail-until-judged, compare the union of keys, print which instance answered.
- **Ask the database about data, grep for source** (one `psql` join beat 30 KB of INSERT matches).
- **Do not fix a shared helper in passing**; don't reformat JSON to insert one key (anchor on a neighbouring key, `JSON.parse` only as validity check).
- **`graphify update` leaves the report stale and drops curated community names**: follow with `.\scripts\graphify.ps1 report`; names need `graphify label`.

## Architecture and product judgement

- **Draazy is owner-only: no brokers, builders or agent RERA numbers, anywhere.** Never offer, label, filter or store a non-owner poster type; anti-broker guardrails stay.
- **Two routes to one verdict are fine; two leaving the record saying different things are not.** The quiet route must write down that it ran and what it skipped.
- **When closing a record a shortcut never opened, don't tidy the evidence**: leave unticked checklists, and don't create the record.
- **Hoist preconditions the actor cannot fix before the first write** (a blank-locality refusal inside `publish` rolled back the reviewer's verdict).
- **Verification is a badge that earns visibility, never a precondition to act** (ADR-019).
- **A visibility blacklist leaks on the next state**: moderation is a whitelist; hidden-from-list but reachable by id is an unlisted page.
- **`pending ≠ active`**: a priced plan is granted by the payment webhook, not by buying.
- **A nullable limit means "no number stated"** — resolve to the safe floor (`plans.listing_limit` NULL → free tier); unlimited needs its own boolean (`unlimited_contacts`).
- **Cloud Run scales to zero, so `@Scheduled` cron is unreliable**: use an external trigger.
- **Never store a raw Aadhaar number**: use the aggregator's entity-scoped UID token. Login OTP proves the SIM; OKYC OTP proves identity.
- **Set the data-caching boundary before data exists** (`/api/* → NetworkOnly` in `vite.config.js`); a service-worker `urlPattern` must match `url.pathname`.
- **An unassigned `manualChunks` module folds into whichever chunk references it** (3 KB module pulled 189 KB charting): verify `dist/index.html`.
- **`docs/flows/**` describe current UI, not target**; the architecture doc is the target SoT. A rename is doc-wide: grep old vocabulary across `docs/**`.
- **Don't bolt a second search entry onto a results page** (mobile /listings locality combobox, Near-a-Place and budget preset chips were removed); ask before duplicating an entry point.
- **Keep real-world Indian listing options even if they break a clean taxonomy** (Power of Attorney ownership, as on MagicBricks/99acres); ask before removing one.
- **One thing, one picker**: grep the wizard for an existing control asking about the same objects before adding a group (AC/geyser/wardrobe).
- **An approve endpoint must apply what it approves** (flatmate request: add member, take seat, 409 on second decision); test the consequence.
- **An approved number request reveals the owner's number to that buyer** unless `hide_number` (D5 reversed). Ask which way the rule goes before calling a reveal a leak.

## Environment and tooling

- **Never round-trip a source file through `Get-Content`/`Set-Content`** (PS 5.1 mangles `—` `·` `…`, adds a BOM). Use `edit`/`create` or `[IO.File]::WriteAllText` with `UTF8Encoding $false`; scan for `U+FFFD`.
- **PowerShell 5.1**: no `&&`/`||` (use `;` + `if ($?)`); no heredocs; `Out-File -Encoding utf8` writes a BOM; `git show HEAD:path > f` needs `cmd /c` (else UTF-16).
- **Never put non-ASCII in a `.ps1`** (ANSI read; `—` ends in a U+201D delimiter; error line is wrong). Check `Select-String -Pattern '[^\x00-\x7F]'`.
- **The persistent shell mangles long `?`/`&` URLs and `@(...)` blocks**: write a `.ps1`. The edit tool matches raw bytes (use ASCII); concurrent edits to one file hit `EBUSY`.
- **Backend is Java 25 (`C:\Program Files\Zulu\zulu-25`), Spring Boot 4.1**; `mvnw.cmd` is in `backend/`; local entry is `.\run-local.ps1 -Port 8099`.
- **Local Postgres password is `postgres`; never prompt.** `$env:PGPASSWORD='postgres'; & 'C:\Program Files\PostgreSQL\13\bin\psql.exe' -U postgres -d <db> -P pager=off -v ON_ERROR_STOP=1 -c "..."` (psql not on PATH).
- **`max(version)` on `flyway_schema_history` is lexicographic**: use `max(version::int) where version ~ '^[0-9]+$'`.
- **An e2e lane serves the bytecode it compiled at start**: a 422 on legal values means stale. Compare source `LastWriteTime` to `target-<lane>\classes` and the listener's `StartTime`; `Stop-Process`, rerun the lane script, poll `/api/actuator/health`.
- **The dev DB `draazy` drifts stale versus `draazy_e2e`**: never conclude "no such column" from it; check `draazy_e2e` or the migration files.
- **`get_errors` on `.java` shows the IDE's stale view** — compile. `mvnw.cmd compile` without `clean` is often a no-op (MapStruct not regenerated): `clean compile` after DTO/record/entity changes.
- **CLI builds write `backend/target-cli/`; `backend/target/` is the IDE's, often stale.** Inspect generated sources in the one you built; Maven's exit code is untrustworthy — aggregate `target-cli\surefire-reports\*.txt`.
- **A running backend must not share a build dir with CLI builds** (500s on `POST /me/photos`): `run-local.ps1` builds into `target-local`, lane scripts into `target-<lane>`.
- **`-Dtest=A+B+C` matches nothing**: Surefire wants commas; with `-DfailIfNoTests=false` a typo still exits 1.
- **Never pair a bulk move with a force-delete on an untracked tree** (lost 22 files); `git mv` needs tracked files; diff Local History restores. Never run an unvalidated bulk-rewrite across the tree.
- **Comment hygiene is hand work, not a script**: regex pipelines mangled strings and a `//` holding `tests/mobile/**` read as `/*`, deleting half of `playwright.config.js`. Use the edit tool; diff comment-free code against HEAD.
- **Never `JSON.parse` → `JSON.stringify` a hand-formatted JSON file** (strips grouping blank lines). Line-edit on `^\s*"KEY"\s*:`, assert one hit, fix trailing comma, parse to validate.
- **An "unreferenced i18n key" list is a candidate list**: template-literal keys (`` t(`misc.${tKey}Title`) ``) are invisible to grep; open the component first.
- **A stale exemption is silent** (a path list never matches a deleted file). **A guard ALREADY RED hides a new violation**: diff its reported entries against HEAD (`ServiceSizeGuardTest`); a service shrunk under its `BASELINE` limit needs its entry deleted.
- **Network is a GitHub-only allowlist** (`raw.githubusercontent.com` works; modelscope.cn, huggingface.co fail TLS `SEC_E_ILLEGAL_MESSAGE`). Probe reachability before designing around a download; check CI shares it.

## House style

Match it; it is why the codebase is navigable.

- **Specs:** deltas not absolutes for append-only ledgers; never guess a UI anchor or wrap an assertion in `if (await x.isVisible())`; locate by role and name; assert the write's status, not the control; prove a write with a reload.
- **Register items:** `## N. <claim>`, `**Where:**`, `### What happens today`, `### Options` (recommendation bolded); when resolved, a `> **RESOLVED — …**` blockquote under the heading.
- **Commit messages:** long-form with reasoning, "Deliberately not done" and `Verified:`; keep a corrected wrong conclusion beside the correction (models: `26129a2`, `368ad4f`, `48386b2`).
- **`tasks/todo.md` D-entries:** `## D<N> — <commit subject>`, `###` sections, `**Verified:**`, commit hash, `### Deliberately not done`.
- **When a claim in a Javadoc, comment, spec header or doc proves false, quote and correct it in place** (also for docs written minutes earlier); when it proves right, quote it.
- **Name specs for the feature, not the backend**: `playwright.config.js` refuses `live-*.spec.js`; when a convention outlives its reason, remove it and add a guard.
- **The comment rule is a gate, not a memory**: >2-line and changelog comments reached commits three times. Run `node scripts/check-comments.mjs --staged` and ponytail-review on the staged diff before every commit; it only reports, so fix by hand.
- **Files containing JSX must be `.jsx`** (Vite parses by extension; ESLint can miss JSX in `.js`).

**Commit around the other session's staged index, never through it.** It keeps files staged (`A`)
in the shared index, so a plain `git commit` would sweep them in. Build the commit in a private
index: `$env:GIT_INDEX_FILE=<temp>; git read-tree HEAD; git add -- <our paths>`, take shared files'
hunks with `git apply --cached <partial.patch>`, commit, drop the variable, then
`git reset -q -- <our paths>` on the real index. Amend the same way (`read-tree HEAD` first).
