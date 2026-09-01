# Handoff — the mock-retirement migration

**Written:** 2026-08-17, at the end of a long autonomous session.
**Branch:** `feature/backend-integration`. **HEAD: `2fd0dff`. Nothing is pushed — the user pushes by hand.**
**Both suites are green at HEAD.** Full mock 844 passed / 1 flaky / 0 failed (20.4m). Full live
422 passed / 1 skipped / 0 failed (31.1m). This is a clean handoff point: there is no half-finished
edit in the working tree and no failing test to inherit.

---

## 1. What this migration is

The app was built against `frontend/src/lib/mockApi.js` — a localStorage-backed fake API seeded from
`db.json`. A real Spring Boot + PostgreSQL backend now exists. The migration moves every screen off
the mock and onto the live API, through the provider seam in `frontend/src/services/`.

**The end state is the deletion of `frontend/src/lib/mockApi.js`.** That file is the scoreboard.
Everything else is a step towards it.

### Where the seam is, and how it works

`frontend/src/services/config.js` is the only file that decides which implementation a domain gets.
Read it before touching anything in `services/`; it repays the ten minutes.

- `VITE_API_DOMAINS` (an env var) is parsed at line 24 into a lower-cased set. `.env.live` sets it
  to `*`.
- `isHttpDomain(domain)` (line 71) is `enabledDomains.has('*') || enabledDomains.has(domain)`.
- **`loadProvider(domain)` (line 138) falls back to the mock provider whenever `isHttpDomain` is
  false** — and it warns to the console rather than throwing. This is the single most useful fact
  about the seam, and it was the thing that unblocked register item 31: **you can add a mock
  provider for a domain that previously had only an HTTP one, and nothing else has to change.**
- Both registries are literal `import.meta.glob` calls and **they must stay lazy**. D208 records
  what happened when one was made eager: a live import cycle that booted the app to an empty
  `<body>`, with lint, build and the bundle gate all green. Nothing caught it but a human opening
  the page.

**Every API path literal in the app lives under `frontend/src/services/`.** If you find one
elsewhere, that is a finding, not a convenience.

### The coverage table

`tasks/todo.md` (around line 3640) holds the table of every file that still imports `mockApi.js`,
with the reason each one is still there. **It is the map. Keep it current — a stale map is worse
than none.**

As of `2fd0dff`: **29 non-provider importers remain** (there are 49 importing files in total, but 19
of those are mock providers, which are supposed to import it and die with it, and one is
`mockApi.js` itself).

---

## 2. Standing instructions from the user

These are verbatim and they still hold:

> "yes lets continue working in one go without stop as we have planned and your recommendation. Ask
> me any question on the fly if you want any decision."

> "its fine there is no hard stop at 5 hrs. you can continue on working those items where my
> intervention is not needed, finish everything what you can do on your own."

> "Delete freely when the code is provably dead, narrate it in the commit."

### What that authorises, and what it does not

**A DO — proceed without asking:**
- A pure port where both ends are already built and the UI does not change.
- A contract mismatch producing a wrong HTTP status.
- A register item whose Options section states a recommendation that reading the code confirms.
- Tooling for the migration itself.
- Retiring a write whose only reader is the mock DB.
- Deleting provably-dead code.

**NOT a DO — ask first:**
- **A new backend route.** This is the hard line. Several open register items are blocked on exactly
  this and they stay blocked.
- A new product capability.
- Deleting a user-visible control, *unless* a register item explicitly recommends it — and even then
  it goes in both the commit message and the `tasks/todo.md` narrative.
- Anything a register item flags as a product decision.

**"Provably dead" has a specific test**, learned the hard way — see §6.

---

## 3. State at HEAD

### Recent commits (newest first)

| Commit | What |
|---|---|
| `2fd0dff` | docs: correct four documents that described the browser-minted referral code as the product's |
| `c7df747` | docs(tasks): record D233, close the consumer half of register item 31 |
| `26129a2` | feat(referrals): the product was handing out a referral code the referral scheme could not resolve |
| `d6bcd34` | docs(tasks): record D232, close register item 28 |
| `368ad4f` | feat(dashboard): the owner was being handed a message from us, to them, to send to themselves |
| `3ca0df0` | docs(tasks): record D231, close register item 30 |
| `38c33a7` | feat(admin): port the reviews-moderation tab onto the live queue |
| `7b7c006` | test(live): restore genuinely-lost live coverage |
| `fbbfd18` | fix: the three pre-existing mock failures |
| `48386b2` | feat(api): `ReviewResponse.status` |

**The backend running on port 8081 carries `48386b2`.** Nothing since then has touched backend
source, so it is current — but check before assuming.

### The decision register

`tasks/DECISIONS-NEEDED.md` is the single record of every question raised and its answer.
As of 2026-08-17 **every question in it is answered** — nothing waits on the user except the five
entries under "Still genuinely undecided", none of which block a port.

Do not restate a decision here. Cite the number.

What remains is fourteen decided-but-unbuilt items, listed there in the order they should be worked
(by damage — what is silently wrong for a real user comes first).

---

## 4. The next piece of work — Wave D is written; the live run is what remains

Rent-agreement co-fill is built end to end. What is **not** yet done is running the new live e2e
against a real backend — the specs are written and syntax-clean, but a spec nobody has run is a
claim, not a check. That is the first thing to do next, and the section below records what it is
checking so a failure can be read rather than guessed at.

### What shipped

- **backend (`b7bc2fa`, suite green: 2057 tests, 0 failures)** — deferred co-fill create
  (`awaiting-payment` without opening checkout yet), invitee details submission, an explicit
  checkout-open endpoint, and an invite that can be addressed to a **mobile number that has no
  account yet**: held pending (`V107` makes `user_id` nullable and adds a `mobile` under an XOR
  constraint), claimed on sign-up, withdrawable by the requester, swept after 90 days, and erased
  with the number under `ErasureService`. The earlier plan for a typed `party_not_registered`
  conflict code is abandoned: refusing to invite an unregistered number is the thing V107 removed,
  so there is no longer a state for that code to name.
- **frontend seam** — `createCoFillServiceRequest`, `listMyServiceRequestInvites`,
  `decideServiceRequestInvite`, `submitServiceRequestPartyDetails`, `openServiceRequestCheckout` and
  `withdrawServiceRequestParty` across the facade and both providers. Two divergences are
  doc-blocked rather than faked: the mock's withdraw is a no-op read (its invite lives in the
  *invitee's* `localStorage`, which the requester's browser cannot reach), and
  `listPartyServiceRequests` stays `[]` live because it is the mock's second bucket and an accepted
  party is already in the main list — returning anything would double every row.
- **wizard** — the confirmation panel now distinguishes "waiting for them to sign up" (`pending`)
  from "waiting for them to reply", shows the masked number, and offers a withdraw. Strings in all
  three locales under `services.ra.invite.*`.
- **e2e** — two live tests replacing the old *"the co-fill party list has no endpoint"* assertion,
  which V107 made false. `COVERAGE.md` row rewritten.

### What to do first

```powershell
cd c:\Users\E159518\Documents\Learning\e2e
npx playwright test tests/live-property-integration.spec.js --config=playwright.live.config.js -g "co-fill"
```

Backend on :8081 under `dev,e2e`. Before blaming the spec, **check `serviceRequest` is in
`VITE_API_DOMAINS` in `playwright.live.config.js`** — `frontend/.env.live` is `*` and will tell you
everything is live when the test harness disagrees.

### After that

- **Work the ledger in order.** `tasks/DECISIONS-NEEDED.md` lists the fourteen decided-but-unbuilt
  items by damage. Item 36 carries a trap worth clearing early and independently of its build:
  `AdminAnalytics.jsx:35` calls `getAnalytics()` from `mockApi.js` and `:59` gates the whole page on
  it, so deleting the mock hangs the analytics page including the one tab that works.
- **The remaining `networkidle` sites** — 99 across ~26 mock specs, deferred in `daa0505`. Note that
  `e2e/tests/consumer/services/refer.spec.js:34` uses `waitUntil: 'networkidle'` and that page now
  reads from a provider, so it is worth revisiting first.
- **The 25 live `waitForTimeout` sleeps** — worst offenders `live-settings-debug.spec.js:30` (1000ms)
  and `live-home-featured-first.spec.js:142` (1200ms).
- **An opt-in HTTP-status tracker in `e2e/helpers/console.js`** — researched, not built. `page.on('response')`
  for 4xx/5xx on the API origin. Deferred because many live specs deliberately provoke 401/403/422,
  so it has to be opt-in per spec.

### Do not

- **Do not mass-delete the 195 "dead exports"** that `backend/tools/dead-exports.mjs` reports. That
  tool is sound in one direction only: it can tell you a symbol *is* referenced, not that it is not.
- **Do not edit an applied `V__` migration.** Next free versioned migration is **`V108`**.

---

## 5. Environment

**Windows, PowerShell 5.1.** Repo at `C:\Users\E159518\Documents\Learning`.

| Thing | Value |
|---|---|
| Backend | Spring Boot 4.1, Java 25, `JAVA_HOME='C:\Program Files\Zulu\zulu-25'` |
| Frontend | React + Vite |
| E2E | Playwright, `e2e/` |
| DB | PostgreSQL 13, `C:\Program Files\PostgreSQL\13\bin\psql.exe`, postgres/postgres |
| Live e2e DB | `punenest_e2e` |
| Backend test DB | `punenest_test` — **different**, so `mvnw test` is safe while a live suite runs |
| Backend port | 8081, profile `dev,e2e` |

**Jackson 3.** Databind imports are `tools.jackson.databind.…`, not `com.fasterxml`. **Annotations
stay on `com.fasterxml.jackson.annotation`.** This trips everyone once.

**There is no springdoc.** The OpenAPI document at
`backend/src/main/resources/static/openapi/punenest-api.yaml` (~11,000 lines) is hand-maintained and
guarded by `SpecCoverageTest` and `SpecSchemaParityTest`. **`SpecEnumParityTest` does not exist** —
do not go looking for it.

**Backend MockMvc tests use paths without the `/api` prefix.** 422 is bean-validation; 400 is
type-conversion or `BadRequestException`. `AbstractApiTest` lives in `com.punenest.api.support`.

**`ArchitectureBoundaryTest` ranks** — imports may only point at a strictly lower rank:
content 0, identity 0, catalog 1, documents/leads/engagement/billing 2, services 3, finance 4,
deals 5, moderation 6, admin 7.

---

## 6. Lessons that cost something to learn

These are the ones worth carrying. The full set is in `tasks/lessons.md` and in the `## D<N>`
narratives at the end of `tasks/todo.md`.

### On deleting code

> **A seed value equal to the default proves the read is a no-op for the seeded state. It says
> nothing about states a caller can reach — and `e2e/` is a caller.**

Three modules — `lib/store/billing.js`, `lib/data/managedProperty.js`, `lib/geoConfig.js` — were
each argued provably dead on exactly that reasoning, and each was refuted by the test suite
(`rent-agreement.spec.js:233`, `owner-hub.spec.js` AC3/AC6, `city-propagation.spec.js:12-30`).

**The operational form: before deleting a read, grep `e2e/` for the key it reads.**

### On tests

> **A test can be a green record of a bug.** When a test asserts the *shape* of a value that
> something else is the authority on, it stops being a check and becomes a second, competing
> specification — and the one that runs on every commit will win.

That is D233. `refer.spec.js` asserted the referral code matched `/^[A-Z]{3,4}\d{4}$/` — the format
the *browser* minted. The server minted a different one. The test was not failing to catch the
mismatch; it was asserting the wrong side of it.

> **When two components disagree about a value, no assertion about the value's *shape* can find it.
> Only an assertion that fetches both and compares them can.**

Related, from D231:

> **A console that agrees with you is more dangerous than one that errors.**

And note that `e2e/helpers/console.js:101` reads `if (m.type() !== 'error') return;` — **the
`consoleErrors` assertions are blind to `console.warn`.** The seam's mock-fallback warning is a
warning. No spec will ever see it.

### On comments and documents

> **A "this cannot be mocked" note ages badly when the module it sits on gains a second audience.**
> Check whether the objection is about the domain or about one endpoint's semantics.

`http/referralProvider.js` said there was no mock provider and gave three good reasons. All three
were about the *fraud desk*. None was about "what is my referral code". The note was right when
written and wrong by the time it mattered.

**House rule, applied 56 times now: when a claim in an existing Javadoc, comment, spec header or
document turns out to be false, quote it and correct it in place.** Do not silently delete it — the
correction is the useful artefact. **This applies to documents written minutes earlier in the same
session.** Conversely, when an existing Javadoc turns out to be *right*, quote it.

### On seams and UI

> **Hiding a field at the seam is how a seam starts lying.** The place to decide not to show a
> number is the component that would show it.

> **An error that the person in front of you cannot act on is not information, it is noise with a
> red border.**

> **An optimistic control makes a failed write invisible.**

> **A write with no reader is not a feature, it is a receipt the customer never gets.** (D232)

> **Making a broken control honest is not the same as deciding whether the control should exist.** (D232)

### On working

- **When N tests in a file fail and one passes, the passing one is the discriminator.**
- **A failure that is not yours is worth *proving* not yours** — stash and re-run.
- **"Smallest change" is not "safe change."**
- **A permanently-red test costs more than the test — it costs the attention of every future reader.**
- **When you delete a test claiming its assertions "moved", verify the destination contains them.**
- **A polling loop is a token leak.** See §7.

---

## 7. Verified commands

Everything below has been run successfully. The gotchas are real and each one cost a cycle.

### Running a long suite without burning tokens

**This is the single most important operational trick in this session.** Do not poll a running
suite from the agent loop — start it detached, then attach a `cmd` script that blocks in-process and
emits one short line every 25 seconds.

```powershell
# 1. start it detached
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx playwright test <args> > %TEMP%\<log>.log 2>&1" -WindowStyle Hidden

# 2. in a SEPARATE call, attach the waiter
$p="$env:TEMP\<name>-wait.cmd"; $body = "@echo off`r`n:loop`r`nfindstr /R /C:`"^  [0-9]* passed`" /C:`"^  [0-9]* failed`" `"%TEMP%\<log>.log`" >nul 2>&1`r`nif %ERRORLEVEL%==0 goto done`r`ntimeout /t 25 /nobreak >nul`r`nfor /f `"delims=`" %%A in ('powershell -NoProfile -Command `"(Get-Content `$env:TEMP\<log>.log -Tail 1)`"') do echo TICK %%A`r`ngoto loop`r`n:done`r`necho DONE`r`n"; [System.IO.File]::WriteAllText($p, $body, (New-Object System.Text.ASCIIEncoding)); cmd /c "$p"
```

The `create_file` tool refuses to overwrite, hence the `[System.IO.File]::WriteAllText`. TICK lines
render em-dashes as mojibake — cosmetic, ignore it.

**While a waiter is blocking a terminal, do not dispatch another command into it.** It produces
`Terminate batch job (Y/N)?` and you have to answer `N`. Use `grep_search` / `read_file` instead, or
wait for the completion notification.

**Never `get_terminal_output` on a long suite** — it replays the whole scrollback.
**Never `Start-Sleep` to wait.**

### Poll a running log once (safe, does not lock)

```powershell
$s=New-Object System.IO.FileStream("$env:TEMP\<log>.log",[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite); $r=New-Object System.IO.StreamReader($s); $t=$r.ReadToEnd(); $r.Close(); $s.Close(); $l=[regex]::Split($t,'\r?\n'); "lines=" + $l.Count; $l[($l.Count-2)..($l.Count-1)]
```

**`[System.IO.File]::ReadAllText` fails while Playwright holds the file** — it needs the
`FileShare::ReadWrite` stream above. Also: **never `-split "`n"`**, use `[regex]::Split`.

### Summarise a finished run

```powershell
$t=[System.IO.File]::ReadAllText("$env:TEMP\<log>.log"); $l=[regex]::Split($t,'\r?\n'); $l | Where-Object { $_ -match '\d+ (passed|failed|skipped|flaky)|^\s+\d+\) \[' } | ForEach-Object { $_.Trim().Substring(0,[Math]::Min(140,$_.Trim().Length)) }
```

### Suites

```powershell
# mock — ALWAYS kill vite first
Set-Location C:\Users\E159518\Documents\Learning\e2e
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'vite\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 2000
# then: npx playwright test <paths> --project=chromium --reporter=line

# live — backend must be UP; check first
$p=(Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count; "port8081=$p"
$env:PUNENEST_DEV_MACHINE='1'
# then: npx playwright test --project=chromium --config=playwright.live.config.js --reporter=line
```

**Always kill vite between live and mock runs. Always re-check `port8081` before a live run.**

| Suite | Size | Time |
|---|---|---|
| Whole mock | 845 tests | 20.4m |
| Whole live (chromium) | 423 tests | 31.1m |
| `tests/admin` | 154 | 3.9m |
| `tests/consumer/account` | 117 | 2.4m |
| `tests/consumer/services` + `auth` | 83 | 2.4m |

`playwright.live.config.js`: `retries: 0`, `workers: 1`, `testMatch: /live-.*\.spec\.js/` plus
`live-property-integration.spec.js`.

### Backend

```powershell
# tests — COMMAS between classes, not pluses. Next fresh build dir: target-d224x
Set-Location C:\Users\E159518\Documents\Learning; $env:JAVA_HOME='C:\Program Files\Zulu\zulu-25'
cmd /c "cd /d C:\Users\E159518\Documents\Learning\backend && .\mvnw.cmd -o -q test -Dtest=<Classes> -DfailIfNoTests=false -DbuildDirName=target-d224x > %TEMP%\c224x.log 2>&1"; "exit=$LASTEXITCODE"

# restart — next free log boot8081U
Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; Start-Sleep -Milliseconds 3000
$env:JAVA_HOME='C:\Program Files\Zulu\zulu-25'; $env:PUNENEST_DEV_MACHINE='1'
cmd /c "cd /d C:\Users\E159518\Documents\Learning\backend && .\mvnw.cmd -o spring-boot:run -Dspring-boot.run.profiles=dev,e2e -Dspring-boot.run.arguments=--server.port=8081 > %TEMP%\boot8081U.log 2>&1"
```

**`-q` swallows the `Tests run:` line. `-DfailIfNoTests=false` means a misspelt class name gives you
a green exit code.** Both have wasted time.

### Frontend

```powershell
Set-Location C:\Users\E159518\Documents\Learning\frontend
cmd /c "npm run lint > %TEMP%\felint62.log 2>&1"; "lint exit=$LASTEXITCODE"
cmd /c "npx vite build --mode development > %TEMP%\febuild34.log 2>&1"; "build exit=$LASTEXITCODE"
```

**Baseline: 0 errors, 372 warnings.** A change that moves the warning count is worth a look.

### Live API probe

```powershell
Invoke-RestMethod -Uri 'http://localhost:8081/api/auth/login' -Method Post -Body (@{mobile='9000000000'} | ConvertTo-Json) -ContentType 'application/json' | Out-Null
$r2=Invoke-RestMethod -Uri 'http://localhost:8081/api/auth/login' -Method Post -Body (@{mobile='9000000000';otp='000000'} | ConvertTo-Json) -ContentType 'application/json'
$tok=$r2.accessToken
Invoke-RestMethod -Uri 'http://localhost:8081/api/me/referrals' -Headers @{authorization="Bearer $tok"} | ConvertTo-Json -Compress
```

**Live auth is `POST /auth/login` twice** — first `{mobile}`, then `{mobile, otp:'000000'}`. There is
no `/auth/otp/request` and no `/auth/verify`.

### psql

```powershell
$env:PGPASSWORD='postgres'; & 'C:\Program Files\PostgreSQL\13\bin\psql.exe' -U postgres -d punenest_e2e -A -F ' | ' -c "<ONE statement>" 2>&1
```

**One `-c` per invocation. Always append `2>&1`. Always confirm a table or column name before
writing the query** — that has cost a cycle more than once.

### Appending prose to markdown (verified ~33 times)

```powershell
Set-Location C:\Users\E159518\Documents\Learning
$enc=New-Object System.Text.UTF8Encoding($false)
$add=[System.IO.File]::ReadAllLines('C:\...\backend\tools\_tmp_x.txt',$enc)
$t='C:\...\tasks\todo.md'
$l=New-Object System.Collections.Generic.List[string]
$l.AddRange([System.IO.File]::ReadAllLines($t,$enc)); $l.AddRange($add)
[System.IO.File]::WriteAllLines($t, $l, $enc)
Remove-Item 'C:\...\backend\tools\_tmp_x.txt'
git diff --numstat -- tasks/
"mojibake=" + ([regex]::Matches([System.IO.File]::ReadAllText($t,$enc),[char]0x00C3+'|'+[char]0x00E2)).Count
```

Use **absolute paths** inside `[System.IO.File]` calls. `todo.md` and `DECISIONS-NEEDED.md` baseline
at `mojibake=0`; `lessons.md` baselines at 1.

### Long commit messages

`create_file` the message to `backend/tools/_tmp_msg_<x>.txt`, then
`git add <explicit paths>; git commit -q -F backend\tools\_tmp_msg_<x>.txt; Remove-Item …`.

**Never use inline `git commit -m` when the message contains a `/`** — it is parsed as a pathspec.

### Gotchas that have each cost a cycle

- A generated `.ps1` containing prose writes mojibake. Use `create_file` for prose.
- `replace_string_in_file` can report success without reaching disk on very large files — verify
  with `git diff --numstat`. It fails silently if the anchor contains an em-dash typed as a hyphen.
- `multi_replace_string_in_file` can report success while changing **nothing**, and can introduce a
  **duplicate** when the replacement text already exists nearby. Re-read the surrounding block.
- `read_file` immediately after a PowerShell write may return stale content.
- `create_file` refuses if the file exists.
- `Get-Content` in PS 5.1 decodes as ANSI. `Set-Content -Encoding UTF8` adds a BOM.
- `git add` aborts entirely on one bad pathspec.
- **Always pass `--` and an explicit pathspec to `git grep`** — `git grep -A<n>` parses the `-A` as a
  revision. Prefer `grep_search`.
- **Never put `\"` or `['\"]` inside a double-quoted PowerShell command.**
- `Select-String` has no `-Recurse`. `Select-String -Pattern "^test\("` returns nothing — drop the `^`.
- **Subagents cannot write files.** They are useful for research only.

---

## 8. Fixtures and data

### Accounts (`e2e/fixtures/live.js`)

`ACTORS`: owner `9470744469` (Meera Deshpande), buyer `9700000001`, tenant `9700000002`,
admin `9000000000`.

`STAFF`: rental `9733798115`, legal `9223611750`, loans `9812733640`, interior `9710931232`,
packers `9542346771`, valuation `9743304170`.

**Spare active buyers still unused: `9328855615` (Nikhil Rao, referral code `PUNE-2NQ7`) and
`9395852523` (Sneha Iyer).** Everything else is taken — `9441541427` by `live-refer.spec.js`,
`9283184696`/`9396565787` by the flatmate agreement test, and ten mobiles by
`ops/live-referrals.spec.js`. **If you need a fresh account, use `uniqueMobile` from
`e2e/helpers/liveAuth.js` rather than picking one and hoping.**

### `e2e/helpers/liveAuth.js`

`E2E_OTP` = `'000000'`. `API` = `http://localhost:8081/api`.

**`apiLogin(mobile, { api = API } = {})`** — line 193. **It takes the mobile first and does NOT take
the Playwright `request` fixture**; it uses global `fetch`. Getting this wrong produces
`login [object Object] failed (400)` and cost a re-run this session.

**`authHeaders(mobile, opts)`** — line 225 — **already returns `content-type`. Adding
`'Content-Type'` again gives you a 415.**

Also: `signIn(page, mobile, {screen, role})` L64, `signedInAs` L158, `signedInAsNew` L244,
`uniqueMobile`, `grantAadhaarBadge`, `forgetSessions`.

### Seed counts (`punenest_e2e`)

users 81, properties 38, societies 348, localities 155 (15 rated), faqs 9, messages 18,
contact_requests 8, reports 7, visits 6, conversations 5, referrals 5, referral_codes 5,
rent_payments 3, flatmate_seeker_posts 3, saved_properties 3, **reviews 1 (published)**,
tickets 0, managed_properties 0, cms_services 0.

**The `settings` table** has columns `key | value | created_at | updated_at` and rows `fees`, `flags`,
`movePack`, `permissions`, `site`. **There is no `adminFlags` row**, so `AdminFlagsContext` falls back
to `DEFAULT_ADMIN_FLAGS` — everything enabled. There is no `platform_settings` and no `feature_flags`
table.

**`users` has a singular `team` column.** The plural `teams` array is minted in `teamProvider.js:51`.

### UI anchors that are not what they look like

- **`NativeSelect` / `Select.jsx` is not a native `<select>`.** Click `.pn-dropdown__trigger`, then
  `getByRole('option', { name })`. Live specs use the `pick(page, ariaLabel, option)` helper.
- **`TimeField` is not an input** — it is `div role="button" aria-haspopup="dialog"`.
- **`Switch` is `<button role="switch" aria-checked aria-label>`.**
- **`propertyMapper.js` publishes two identifiers**: `id: p.slug || p.id` (L95) and `uuid: p.id` (L98).
  **The app routes by slug.**

---

## 9. House style

Match it. It is the reason this codebase is navigable.

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

---

## 10. Known open findings

Recorded, not acted on:

- `ListingDuplicateProbe`'s unbuilt society branch.
- The reader-less `idx_properties_society_unit` index.
- The flatmates gender-filter `aria-pressed` gap — `FilterBar.jsx:130`.
- The `price` notification family is unwritten server-side.
- `PropertyResponse.adminPipeline` is NON_NULL-omitted (FINDING 5).
- The duplicates tab reports a false "supply looks clean".
- StrictMode double-POST on the review modal.
- **The `owner-hub.spec.js:95` rent-tracking flake** — the one flaky test in the mock suite. It has
  flaked before. Worth a look if it recurs; not worth chasing on a single occurrence.

---

## 11. Housekeeping

**Next free names**, so you do not collide with an existing file:

| Kind | Next free |
|---|---|
| Backend build dir | `target-d224x` |
| Backend test log | `c224x` |
| Backend boot log | `boot8081U` |
| Frontend lint log | `felint62` |
| Frontend build log | `febuild34` |
| Live spec log | `live-nj2` |
| Mock spec log | `mock-ref3` |
| Migration | `V89` |
| Decision narrative | `D234` |
| Register item | `37` |

The `backend/target-d2*` directories are throwaway build dirs from parallel test runs. There are
well over a hundred. **They are safe to delete but the user has not asked** — leave them.

**Session transcript** (if you need something this handoff does not carry):
`%APPDATA%\Code\User\workspaceStorage\bb7c9f8417f5855e4db16c47606b4b8d\GitHub.copilot-chat\transcripts\97037f27-5340-4087-92dc-f31b711d2b0c.jsonl`
