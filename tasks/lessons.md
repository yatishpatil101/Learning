# Lessons

## PMF overlay session
- **Temporary/experimental overlays must be flag-gated so the dev flow is never touched.**
  `VITE_PMF_MODE` off by default; every hook (`track`, `captureLead`, banner, NotifyMe) no-ops
  unless the flag is exactly `on`. Verified by building both flag-off and flag-on.
- **When a `create` fails because the parent dir is missing, RE-CREATE the file after `mkdir`.**
  The first `PreviewBanner.jsx` create failed; I made the dir but forgot to retry it, so only the
  build caught the missing import. Always re-run the failed create, or verify with a dir listing.
- **Netlify Forms + client-rendered SPA:** the deploy bot can't see a JSX `<form>`. Declare a hidden
  static form (with all field names) in `index.html`; the app POSTs url-encoded with `form-name`.
- **`index.html` has a strict CSP** — any new third-party (GA4) needs script-src/connect-src widened.

## API design source-of-truth (this session)
- **Single source of truth for the API = the OpenAPI spec**
  (`backend/src/main/resources/static/openapi/punenest-api.yaml`). Do NOT re-describe endpoints,
  request/response JSON, error shapes, pagination wrappers, or role enums in other docs. Other docs
  may only *reference* the spec. `docs/system/api-contract.md` is now a pointer stub, not a catalogue.
- **Canonical auth roles = `buyer, owner, staff, admin`.** `staff` is scoped by `team[]`
  (`rental, legal, interior, packers, valuation`). Admin RBAC `manager/member` are permissions, not
  roles. `tenant` folds into `buyer`. Keep this consistent everywhere.
- Non-auth classification enums legitimately use other tokens: moderation `targetType` includes
  `user`; content `audience` includes `tenant`. These are NOT the auth `Role` enum - leave intact.

## OpenAPI as spec — extension gotchas (this session)
- **YAML 1.1 `off`/`on`/`yes`/`no` are booleans.** An unquoted enum value like
  `enum: [off, instant, daily, weekly]` parses `off` as boolean `false`. Always quote such literal
  string tokens: `enum: ["off", instant, daily, weekly]`. (Was a live bug in `SavedSearch`.)
- Fast feedback loop for a large spec = a tiny PyYAML validator that resolves every `$ref` and prints
  paths/schemas/refs/unresolved + unused-schema counts. Run after every edit batch; expect
  unresolved==0 and no unused schemas.
- Before retiring a data doc in favour of OpenAPI, remember **persistence-only truth is not
  expressible in an API contract** (soft-delete columns, ID-prefix scheme, key-migration, Flyway/
  JSONB, DB reconciliations). Those belong in a data-model ADR, not the spec — so a domain-model doc
  can only be *slimmed to DB-only concerns*, never fully deleted, unless that content is relocated.

## Auth+users vertical slice (this session)
- **pom.xml "manual sync" silently reverted to the committed minimal pom** — dropped
  `spring-boot-starter-data-jpa`, `-security`, `postgresql`, `flyway-core`,
  `flyway-database-postgresql`, and the JJWT trio, and reset `java.version` to 21. The failure was
  *masked* for a while because `target/` still held classes compiled against the fuller pom. Lesson:
  when a from-scratch compile suddenly reports "package X does not exist" for whole dependency groups,
  check the CURRENT pom against git, don't chase the code. Restore deps (BOM-managed ⇒ no version;
  JJWT 0.12.6 pinned) and rebuild.
- **`@Transactional` + `throw RuntimeException` silently discards side effects in prod.**
  `OtpService.verifyLoginCode` recorded a failed attempt then threw → default rollback-on-runtime undid
  the counter, so the brute-force cap NEVER fired in production (each HTTP request is its own tx). The
  `@Transactional`(rollback) test masked it because @SpringBootTest shares ONE persistence context, so
  the in-memory increments accumulated regardless. Fix: `@Transactional(noRollbackFor = {…})` on BOTH
  the inner method AND the outer caller that owns the physical tx (rollback is decided at the outermost
  boundary). Treat expected client errors as non-rollbacking when they must persist an attempt/audit.
- **Interrupted/`stop_powershell`-killed Maven builds corrupt `target/classes`.** The incremental
  compiler then KEEPS the half-written `.class` (its mtime is newer than the unchanged `.java`), so a
  later build fails with "cannot find symbol" for record accessors/interface methods that plainly exist
  in source (`ApiError.error()`, `PageResponse.content()`, `saveAndFlush`). Fix: delete
  `target\classes` + `target\test-classes` and recompile. Don't debug the source — it's fine.
- **Offline (`-o`) + `clean` can't rebuild the full dependency classpath in this env** (whole groups
  report "does not exist"); a from-scratch compile must run ONLINE. `-o` is only safe for incremental
  builds where `target/` is already populated.
- **Boot 4 test quirk (still true): `@Autowired ObjectMapper` has no bean** — use
  `new ObjectMapper()` in the test. Also `@JsonInclude(NON_NULL)` means an auto-provisioned buyer's
  null `name` is ABSENT from JSON, so assert `has("name")` is false / don't require it.
- Toolchain now: **Java 25 on Zulu-25** (`JAVA_HOME=C:\Program Files\Zulu\zulu-25`); the older
  "Java 21 / JDK 17 gap" note above is obsolete.

## Environment / tooling
- Backend targets **Java 21** (Spring Boot 4.1.0) but the dev machine has **JDK 17**, so
  `mvn verify` fails with `release version 21 not supported`. This is a pre-existing toolchain gap,
  independent of doc/spec changes. Need a JDK 21+ install to compile the backend here.

## Windows / PowerShell + edit-tool gotchas
- Several docs contain UTF-8 em-dashes/arrows that render as `?` in view/grep. The `edit` tool
  matches raw bytes, so `old_str` must be **ASCII-only** - target ASCII substrings and avoid the
  special chars. For whole-line rewrites that include them, use a PowerShell regex replace with `.*`.
- PowerShell here: no `&&`/`||` (chain with `;`); heredocs don't work (write a `.py` file and run it);
  `Get-ChildItem -Filter` takes a single string (use `-Include` with `-Recurse` for multiple globs).
- Concurrent `edit` calls to the *same* file in one turn can hit `EBUSY: resource busy or locked` -
  retry the failed edit on the next turn.


## Platform architecture (free-tier-first) lessons

- Cloud Run scales to zero: native @Scheduled cron is unreliable (skips at zero, double-fires when
  scaled out). Use an external trigger (Cloud Scheduler -> secured endpoint); a warming ping keeps one
  instance warm at ~$0 because default Cloud Run billing charges CPU only during requests.
- "Deferring Redis" is not "deferring caching": CDN + Postgres cache-at-write + in-process Caffeine
  still cache at MVP. Redis only adds a shared-across-instances cache + distributed rate limiting.
- Aadhaar OTP e-KYC is legally restricted to licensed AUA/KUA; a startup cannot call UIDAI directly.
  Use a licensed aggregator (OKYC/OTP) or DigiLocker. Aggregator preserves the inline-OTP UI.
- Safest SPA session model = tokens in httpOnly+Secure+SameSite cookies (JS can never read them),
  short access JWT + rotating refresh with reuse-detection + CSRF; locally feasible via a Vite proxy
  that makes SPA+API same-origin. Only the frontend `http` provider changes; components untouched.
- Provider-seam pattern makes vendor/timeline risk cheap: build gate/flows against a mock now, pick or
  swap the real provider later (KYC, SMS, payments, storage) with no caller changes.

## KYC / identity uniqueness lessons

- Don't conflate the two OTPs: the LOGIN OTP proves control of the registration SIM; the AADHAAR OKYC
  OTP proves a genuine, unique identity. The registration mobile is secured by our own login OTP, not by
  Aadhaar. So not matching the two mobiles does not open a spam hole.
- There is no legal "phone number -> Aadhaar identity" lookup. KYC data is released ONLY on the holder's
  Aadhaar/VID + OTP consent; the OTP is the trust anchor.
- Never store the raw Aadhaar number. Use the aggregator's entity-scoped UID token (stable, irreversible,
  unique per Aadhaar per business) as the UNIQUE dedup key -> "one Aadhaar = one account" compliantly.
- Mobile-match (registration == Aadhaar-linked) is exclusion-heavy in India (stale Aadhaar mobiles).
  Layer a hard match only where fraud hurts (owners posting listings); soft-flag elsewhere.

## Payment gateway (India) lessons

- Payment gateways have NO "free tier" like SaaS; the right lens is ₹0 fixed cost + free sandbox +
  pay-per-successful-transaction. You pay only when a customer pays -> already fits $0-until-revenue.
- Zero-MDR != free UPI. Govt mandates 0% MDR on UPI/RuPay (the network cost), but an aggregator's own
  service fee is separate and still applies -> UPI through Razorpay is usually NOT free.
- GPay/PhonePe are payer-side UPI apps, not merchant plug-ins. Merchant accepts "UPI"; any app can pay.
- Genuinely-free UPI = direct collection (VPA/QR/deep-link via a PSP), but you trade fees for building
  reconciliation + verification yourself (often no webhooks, UPI-only). At MVP volume, paying the tiny
  aggregator fee beats building that. The PaymentClient seam lets us add UPI-direct later with no caller change.
## Cashfree / KYC architecture lessons
- Cashfree has NO standalone Aadhaar-OTP OKYC product; Aadhaar identity = DigiLocker flow only (verify-account -> create-url -> redirect+OTP+consent -> webhook -> get-document). Status is webhook-only; there is no GET /status endpoint.
- The DigiLocker SUCCESS *webhook* payload includes `mobile` even though the synchronous Get-Document response does not. Always check webhook payloads separately from sync responses before declaring a field unavailable.
- DigiLocker returns only masked UID (last-4) + per-request ids (not per-identity), so raw-Aadhaar dedup is impossible. Use a deterministic composite identity_hash on canonical UIDAI fields instead.
- Cloud Run has dynamic egress IPs -> Cashfree Secure ID/Payouts prod 2FA must use RSA public-key signature, not IP-whitelisting. (PG API itself needs only client-id/secret + domain whitelist.)
- The installed cashfree-skills bundle contains NO pricing; the settlements skill numbers are illustrative. Always flag pricing as "verify on dashboard/quote".
- Skill local policy: do NOT run the npx telemetry/start-integration or send data to Cashfree without explicit consent; treat as no-ops. Architecture/doc analysis does not trigger the App-ID ask.
## Docs discipline + build sequencing (badge-not-gate)
- `docs/flows/**` are "documented from React source" - they describe CURRENT UI behaviour, not target. Do NOT edit them to a new model before the React app implements it (creates false doc/code drift). `platform-architecture.md` is the SoT for the TARGET; re-sync flow docs FROM source only AFTER the UI changes. (Reverted 4 flow-doc rewrites for this reason.)
- Ratified build order once architecture is frozen: (1) update the contract (OpenAPI / api-contract.md) to badge-not-gate; (2) change the React UI against the MOCK provider and validate the UX/conversion bet (cheap, no infra, runs Phase-0); (3) build backend vertical slices to the frozen contract, flip VITE_API_MODE mock->http per slice. UI-first because the pivot is a UX/conversion change and badge-not-gate backend is LESS work than the old hard-gate (nothing wasted).
## e2e / encoding lessons (badge-not-gate migration)
- Playwright text matchers are byte-exact: a mojibaked non-ASCII char in a spec (e.g. rupee saved as UTF-8-then-Windows-1252 double-encoding => U+00E2 U+201A U+00B9) NEVER matches the correct live UI text, surfacing as a generic 20s waitFor timeout that LOOKS like a broken map/component. Always check the failure screenshot (the marker WAS visible) before assuming an app regression.
- Diagnose mojibake by dumping char codepoints of the assertion string, not by eyeballing (terminal/editor re-mangle it). Fix by String.Replace(mojibake, realChar) and write UTF-8 preserving the original BOM state.
- Scope discipline: only mojibake inside assertion strings (hasText/getByText/getByRole name) breaks tests; the same corruption in comments/titles is cosmetic. Flag pre-existing non-scope failures instead of chasing them.
## e2e full-suite lessons (badge-not-gate, cont.)
- Playwright `locator.count()` is a NON-retrying snapshot (unlike toBeVisible). If data loads async, count() can read 0 before render. Always `await expect(rows.first()).toBeVisible()` THEN count().
- The mock app stores its whole DB under one localStorage key (puneNestDB_v5) and `rawLoad()` uses a stored value AS-IS with NO merge to defaults. So writing a PARTIAL DB via addInitScript BEFORE boot => app runs on an incomplete DB => white-screen crash. Seed extra rows AFTER the app boots (page.evaluate: read full DB, unshift, save), or only seed non-DB keys pre-boot.
- The DPDPA CookieConsent banner (fixed bottom-0 z-[1400], inner card pointer-events-auto) intercepts clicks on bottom-anchored targets and drives the assistant FAB max-sm:hidden. ~30 specs seed pn_cookie_consent_v1 to dismiss it; any new bottom-click/mobile-FAB test must too.
- Responsive dual-render is pervasive: mobile card (sm:hidden) + desktop table (hidden sm:block). On desktop, scope assertions to the VISIBLE copy (getByRole('table'), [title=...]:visible, or .first() only when both copies are visible) to avoid strict-mode / hidden-first timeouts.
- When UI is refactored, roles change: dashboard sub-tabs went button -> role="tab". Match the CURRENT role, don't assume `button`.
- Before "fixing" a red test, open the failure screenshot: if the app clearly rendered the expected data, the fault is the selector/setup, not the app. Two full runs yielding DIFFERENT hard-fail sets == load-contention flakes, not deterministic bugs.


## 3-way sync session (SOT/OpenAPI/React)
- **Same-file parallel `edit` calls -> EBUSY in this env.** Apply edits to the same file
  one-per-turn (sequential), or use PowerShell literal `.Replace()` with match-count asserts
  for multi-occurrence changes.
- **Deal rename ordering:** rename intent `Deal->DealIntent` refs BEFORE aggregate `Deal2->Deal`,
  else collision. `#/.../Deal'` (trailing quote) does NOT match `Deal2'` - safe literal replace.
- **React is mock-only (no http provider).** "UI<->Swagger sync" = aligning enum/shape tokens so a
  future http seam drops in cleanly; status tokens live in localStorage and never serialize yet.
  Some domains (ops/ticket) keep a simpler UI vocab; mapping is documented in data-model.md.
- **SOT delegates wire shapes to OpenAPI** (names it "SSOT for wire shapes"), so most enum fixes
  land in OpenAPI + React; the main SOT doc needed no edits.
- **Working tree was already dirty** from prior sessions; always scope-check failures against
  `git diff --name-only` before assuming a test failure is yours.

## Package restructure + data-loss recovery (this session)
- **Backend source is entirely UNTRACKED in git**, so `git mv` fails on it and a follow-up
  `Remove-Item -Recurse -Force` in the same "move" script DELETED 22 source files with no git copy.
  Recovery: VS Code **Local History** (`%APPDATA%\Code\User\History\<hash>\entries.json` maps a
  `resource` file-URI -> timestamped backups; pick the max-timestamp entry per file). Lesson: never
  pair a bulk move with a force-delete on untracked trees; and `git mv` presupposes tracked files.
- **Local History can PREDATE your most recent edits.** The restored snapshot was behind by 3
  reviewed-and-shipped security fixes; `tasks/todo.md` (which recorded them as DONE) was the proof they
  had existed. Lesson: after any Local-History restore, diff the recovered code against todo.md-
  documented "done" work and re-apply anything the snapshot missed � don't assume the newest backup is current.
- **Version-skew from Local History** = restored files come from different save moments, so accessors/
  signatures disagree (e.g. a private `revokeFamily` vs a caller needing public `revokeAllForUser`; a
  static factory `otpSent()` colliding with a record accessor). Reconcile by compiling, not by eyeballing.

## Concurrency: durable cap != race-safe cap (this session)
- Fix C (`@Transactional(noRollbackFor=...)`) made the OTP attempt cap durable ACROSS sequential
  transactions, but two CONCURRENT verifies could still both read `attempts=4` and both pass under
  READ COMMITTED. The complete guard needs BOTH: `noRollbackFor` (cross-tx durability) AND
  `@Lock(PESSIMISTIC_WRITE)` on the finder (serialize same-row concurrency). Same pattern fixed the
  refresh-token double-submit replay window. `@Lock` on a Spring Data derived query needs the call to
  run inside a `@Transactional` method (it does). Chose pessimistic lock over `@Version`/optimistic
  because the latter needs a schema column + migration; the lock is one annotation, no DDL (ponytail).

## Properties+search slice (build/env)
- **Incremental mvn test corrupts arget/classes in this env.** javac/ECJ bakes error-recovery
  stubs into class files: "java.lang.Object cannot be resolved / indirectly referenced from required
  .class files", "@interface CurrentUser cannot be converted to Annotation", "BigDecimal cannot be
  converted to BigDecimal", "cannot access Long/UUID". A GREEN mvn test can flip to ALL-errors
  (context-load failures on every test) after a single-line edit triggers an incremental recompile.
  SUPERSEDED (slice 3) = the root cause was CLI Maven and the VS Code Java language server sharing one target\ directory and overwriting each other's class files. backend\.mvn\maven.config now sets -DbuildDirName=target-cli, so CLI artifacts land in target-cli and target belongs to the IDE. Do NOT reach for clean as a workaround; just use the configured layout. Original (now unnecessary) advice was: ALWAYS mvn clean test for a verifying run; deleting only
  target\classes+target\test-classes is not always enough � use clean.
- **All-tests-errored (not failed) + first error is a bean/context init** => it's an infra/compile
  corruption, not a logic bug. Read a surefire-reports\*.txt for the real Caused by (the console
  CONDITIONS EVALUATION REPORT buries it); "Unresolved compilation problems" there == stale target.
- **JSONB List<String> via @JdbcTypeCode(SqlTypes.JSON) validates clean under ddl-auto=validate**
  against a jsonb DEFAULT '[]' column (Hibernate 6 / Boot 4) � no hypersistence-utils needed.
- **Pageable in a controller just works** on Boot 4 (SpringDataWebAutoConfiguration resolver);
  first repo usage confirmed at runtime.

## MapStruct on JDK 25 + Spring Boot 4.1 (this session)
- MapStruct 1.6.3 works on JDK 25 (spike generated impls cleanly). The trap was the BUILD wiring, not
  MapStruct itself. Symptom: main compiles + `*MapperImpl` generate fine, but **test-compile** fails
  deterministically with symbol corruption on UNCHANGED files: `cannot access Optional/OtpService`,
  `UUID cannot be converted to java.util.UUID`, `saveAndFlush cannot find symbol`.
- Dead ends (all still corrupted or broke worse): plugin-level `annotationProcessorPaths` + an
  execution override; `provided`-scope processor + `maven.compiler.proc=full` property (property beats
  per-execution `<proc>`, so processing ran on tests anyway); per-execution `proc=full`(main)/`none`(tests).
  Pattern proven by bisection: **whenever `target/classes` contains generated impls, the next
  test-compile javac can no longer READ `target/classes`** � even main classes like `OtpService`.
- ROOT CAUSE (corrected after full bisection — the earlier `useIncrementalCompilation` theory was
  wrong; it merely masked the problem for one lucky build): the **VS Code Java language server**
  (redhat.java / m2e) continuously compiles this project into `target/classes` using its own bundled
  **JDK 21** and the Eclipse compiler. CLI Maven writes Java 25 bytecode into the same directory, and
  the IDE overwrites it mid-build. Hence the non-determinism and the impossible-looking errors:
  `NoClassDefFoundError: BigDecimal` (descriptor lost its package) and, tellingly,
  `java.lang.Error: Unresolved compilation problems` — an **Eclipse-compiler** message that plain
  javac can never emit. That one string is the smoking gun.
- How it was proven (keep this technique): copy `src` + `pom.xml` to `%TEMP%\pn_build` and build
  there. Outside the workspace it was green (59 tests) every time, with identical sources and pom.
  **If a build fails only inside the workspace, suspect the IDE, not the compiler.**
- Exonerated by bisection — do not re-blame: MapStruct; javac (standalone javac with the same
  processor and the same flags — release 25, `-g`, `-parameters`, UTF-8 — was clean every run);
  Maven's argument list (Maven's own verbatim command line, run by hand into a scratch dir, was clean);
  `fork=true` + explicit `<executable>` (confirmed genuinely forking, still corrupt).
- FIX: separate the output directories. `<buildDirName>` property in `pom.xml` (default `target`,
  for the IDE) + `backend/.mvn/maven.config` containing `-DbuildDirName=target-cli`, so every CLI
  build writes to `target-cli` automatically. 3/3 deterministic green (59 tests), including a build
  immediately after touching a source file — the exact case that used to fail.
  `useIncrementalCompilation=false` is kept as cheap insurance, not as the fix.
  `java.autobuild.enabled: false` is ALSO set in `.vscode/settings.json`: the separate directory
  alone still left an intermittent `ClassNotFoundException` during `mvn verify` (the LS full-builds
  on import/startup regardless), so both guards are kept. IntelliSense/squiggles are unaffected.
- Takeaway: when a build failure is non-deterministic and the bytecode itself looks malformed, the
  suspect list should start with "who else writes to this directory", not "which compiler flag".

## URL path + domain vocabulary constants (this session)
- Extracted route paths into `common.web.Routes`, error codes into `common.error.ErrorCodes`,
  and domain vocabulary into `catalog.property.PropertyStatus` / `DealIntent` /
  `security.Roles.Wire` / `OtpCode.PURPOSE_LOGIN`. Documented as rules in
  `docs/system/api-standards.md` sections 2.1, 4 and 7.1. 59 tests stayed green.
- The strongest argument for route constants was NOT DRY - it was security. A path is duplicated
  between the controller that declares it and SecurityConfig that decides if it is public. A typo
  there fails no build and no happy-path test; it just silently leaves an endpoint guarded (outage)
  or a matcher too broad (exposure). Same reasoning for ErrorCodes: the client BRANCHES on those
  codes, so they are API surface, not log text.
- Design rule that made routes work cleanly: ABSOLUTE paths only, and drop the class-level
  `@RequestMapping`. The tempting alternative (class-level base + relative method constants)
  forces every route to exist as TWO constants - a relative one for the controller and a composed
  absolute one for the security chain - which reintroduces exactly the drift being removed.
- Watch for: `@Pattern`/`@PreAuthorize` need COMPILE-TIME constants, so values used there cannot
  be derived at runtime (hence roles are declared in both lower-case wire and upper-case authority
  form, side by side, rather than calling `toUpperCase()`).
- When a ternary encoding a domain rule appears at 2+ call sites, move it next to the constants as a
  method (`DealIntent.priceUnitFor`) - two copies of a pricing rule that disagree would show a
  sale price as a monthly rent.
- Deliberately NOT converting these to Java enums yet: columns/DTOs/filters all carry String to match
  the contract's string enums, so enums would need converters + DTO changes + a migration story for
  unknown values. Revisit per-vocabulary when a value gains behaviour. Recorded in api-standards 7.1
  so it reads as a decision, not an oversight.


## Slice 3 - contacts + gate + Aadhaar badge

- **MapStruct silently hijacks no-arg "factory" methods.** A `default AadhaarVerificationResponse none()`
  on a `@Mapper` interface is treated as an **object factory**: the generated `toResponse(entity)` became
  `return none();` and every verified user's badge came back blank. `unmappedTargetPolicy = ERROR` does
  not catch it - the mapping is "complete", it just goes through the factory. Symptom to recognise: an
  endpoint returns the empty/default DTO while a direct repository read in the same transaction shows
  correct data. **Rule: a mapper interface may only contain mapping methods. Canonical empty shapes live
  as a static factory on the DTO.** Always read `target-cli\generated-sources\annotations\**\*Impl.java`
  when a MapStruct result looks wrong - the answer is right there in five lines.
- **Spring Boot 4 ships Jackson 3**: the import is `tools.jackson.databind.ObjectMapper`, not
  `com.fasterxml.jackson.databind.ObjectMapper` (2.x is present only as a runtime transitive of jjwt).
- **`src/test/resources/application.properties` REPLACES the main one, it does not merge.** Every new
  `@Value("${...}")` with no default must be re-declared there or every `@SpringBootTest` context fails
  with `PlaceholderResolutionException` - which surfaces as *all* tests erroring, including untouched
  ones. When that happens, find the one surefire report that does NOT say "failure threshold exceeded";
  that is the only one carrying the real `Caused by`.
- **Autowiring `RequestMappingHandlerMapping` by type is ambiguous** once actuator is on the classpath
  (`requestMappingHandlerMapping` vs `controllerEndpointHandlerMapping`). Qualify by bean name.
- **A signature is not a freshness check.** HMAC over `timestamp + body` proves authenticity forever;
  without an explicit skew window the captured payload is replayable indefinitely. And a *blank* HMAC
  key verifies every forgery, so `${SECRET}` being merely "present" is not enough - reject blank at
  construction.
- **Enforce idempotency in the schema, not just the service.** Check-then-insert reads as idempotent and
  is not. If the API promises "no duplicate row", there must be a UNIQUE constraint behind it and a
  `DataIntegrityViolationException` catch in front of it.
- **Trust carve-outs stay hand-written and `private`.** Masking helpers must be `private` so MapStruct
  cannot adopt them as implicit `String->String` converters and apply (or stop applying) them silently.
- **When hardening beyond the contract, fix the contract too.** Adding `@Size` without adding
  `maxLength` to the OpenAPI spec makes the server diverge from the SSOT. Change both in one commit.

## Backend schema materialization (this session)
- **Schema already existed** as Flyway migrations V1-V9 + R__seed_reference_data under
  `backend/src/main/resources/db/migration`. Local Postgres 13 runs on :5432; `psql` at
  `C:\Program Files\PostgreSQL\13\bin\psql.exe` (not on PATH). DBs: `punenest` (dev, EMPTY) and
  `punenest_test` (test schema, 62 tables).
- **`punenest_test` was one migration behind (V8).** The app-boot Flyway did NOT auto-apply pending
  V9 on the current Spring Boot 4.1.0 / Java 25 stack (no Flyway migrate logs; V9 never attempted) -
  worth verifying Flyway auto-migration is wired before relying on boot-time migration in dev/prod.
- **Applied V9 history-safe without the network.** No flyway-maven-plugin in .m2 and the corporate
  artifactory download hung, so I applied V9's DDL via psql AND inserted the flyway_schema_history
  row with Flyway's exact checksum. Reproduced Flyway's SQL checksum in Python: CRC32 over each
  line's UTF-8 bytes (no terminators, BOM stripped, `splitlines()`), cast to signed int32.
  **Proved correct** by recomputing V1-V8 and matching all 8 stored checksums before trusting V9.
- **`ddl-auto=validate` green boot = entities match schema** (repo's own proof pattern). Test config
  (`src/test/resources/application.properties`) targets `punenest_test`; dev/main has no datasource.

## Local DB seed for API integration (this session)
- **UI = source of truth for test data.** Derived the seed from the frontend real mock JSON
  (`frontend/src/data/localities.json`, `properties.json`, `db.json`) via a Python generator ->
  SQL, so market values/localities/owners match what the app actually shows. Highest fidelity,
  least invention.
- **Deterministic uuid5 ids** (fixed namespace + frontend key) give stable PKs across re-seeds and
  let FK links (owner_id, property_id) resolve inside one generated script. Idempotent with
  `ON CONFLICT DO NOTHING`. Great for hardcoding ids in integration tests.
- **Seed demo data must NOT be a Flyway migration** (esp. not `R__`) - it would run in prod too.
  Reference/master data (cities/settings/fees) belongs in `R__seed_reference_data`; demo listings
  are applied out-of-band to `punenest_test` only.
- **Respect CHECK/enum + token mapping when seeding:** furnishing `semi`->`semi-furnished`,
  rent->`price_unit=per-month` / buy->`total`, role in {buyer,owner,staff,admin}, team clamped to the
  allowed set or NULL, mobile must match `^[6-9][0-9]{9}$`. Validate before insert to avoid partial loads.
- **Cross-session handoff:** the session SQL DB (incl. `inbox_entries`) is per-session isolated - you
  cannot write into another session's inbox. To notify a parallel session, drop a durable repo
  artifact (`backend/LOCAL_DB_STATUS.md`) AND give the user a copy-paste message. Don't assume a
  silent cross-session channel exists.

## UI-API integration: auth vertical (this session)

- **Refresh-token single-flight must be cross-tab, not just in-process.** The backend treats replay
  of a rotated refresh token as theft and revokes the **entire family** (`RefreshTokenService.rotate`).
  Two tabs share `localStorage`, so a per-tab in-flight promise does nothing for them: both 401, both
  refresh, the loser replays a consumed token and signs the user out **everywhere**. Fixed with the
  native `navigator.locks` Web Lock plus a re-read of the token *inside* the lock (a tab that waited
  must use the winner's new token, never replay its own stale one). **Proved by A/B test**: with the
  lock both tabs stay on /dashboard and `/auth/me` returns 200; without it tab B lands on /signin with
  tokens wiped. Lesson: when a security control is server-side "burn everything on reuse", the client
  needs a matching *global* mutex - and prove it by removing the fix, not by reasoning about it.

- **Boot 4 split auto-configuration into per-technology modules.** `flyway-core` on the classpath is
  no longer enough; without `org.springframework.boot:spring-boot-flyway` the autoconfiguration never
  loads and Flyway silently does nothing - **no log output at all**, which is what made it look like a
  DB permissions problem. If an integration produces *zero* log lines, suspect a missing starter/
  autoconfig module before suspecting the external system.

- **Never point dev at the test database.** Tests that assert exact row counts require a schema Flyway
  built from empty; seeded dev data silently breaks them (5 failures that looked like code regressions
  but were `expected 2, got 18`). Symptom to recognise: every failure is "expected N, got N + seed".

- **Verify "pre-existing failure" claims by stashing, never by assertion.** The auth e2e specs fail
  8/22 - identical with and without this work (`git stash push -u -- frontend e2e`, re-run, pop).
  Without that measurement the honest statement "I did not regress anything" is unavailable.

- **A shared hook is a shared blast radius.** `useOtpFlow` is used by 5 *non-auth* verification flows
  (owner consent, society hub, share-flat). Wiring it directly to `authService` would have sent
  **login OTPs for owner consent**. Fixed by injecting the dispatcher (`useOtpFlow(dispatch)`), with
  non-auth callers keeping the mock delay. Always enumerate a hook's callers before rewiring it.

- **Mock mode must pay nothing for integration.** `AuthContext.loading` initialises to
  `isHttpDomain('auth') && !!readUser()`, so on mocks it is `false` and no spinner ever flashes.
  An integration seam that degrades the default developer experience will be worked around.

- **A relative API base is a security feature, not just convenience.** `VITE_API_BASE` pointed at the
  absolute `http://localhost:8080/api`, which bypassed the dev proxy and was **silently blocked by the
  page's `connect-src 'self'` CSP** - surfacing only as a generic "login failed". Relative `/api` +
  a proxy `rewrite` stripping the prefix keeps everything same-origin. Added a dev-only warning so the
  next person gets a signal instead of a mystery.

- **Triage review findings; do not apply them wholesale.** The security review's headline "CRITICAL"
  described a `writeKeyed` ordering race that cannot occur (the `removeItem` targets the *other*
  store, and Web Storage writes are atomic) - but the underlying cross-tab concern was real and worse
  than described. Two other findings were rejected outright: the claimed `useState` initialiser race
  (both lazy initialisers run in the same render, before paint) and a client-side error-message
  safelist (contradicts `api-standards.md`, which makes the server's envelope the user-safe contract).
  Value came from investigating the *mechanism*, not the severity label.

- **Contract parity has to be executed to be true.** `frontend/scripts/contract-parity.mjs` runs the
  real mock provider (Web Storage stubbed in Node) and the live API through the same call sequence and
  diffs the shapes. It immediately found `user.name` present on mocks but absent for a freshly
  provisioned live user. Classifying fields as REQUIRED (no fallback => breaks) vs OPTIONAL (read as
  `user?.x || default` => degrades) is what makes the check actionable instead of noisy.

- **A seam with a bypass is not a seam.** 21 files imported `listProperties` straight from
  `lib/mockApi.js` while `services/propertyService.js` sat there with one consumer. Flipping the
  property domain would have changed *one* component and silently left 20 on localStorage - a
  half-real UI that reads as a mapping bug. Before claiming a switch works, grep for direct `lib/`
  imports in `pages/` + `components/` and require zero results.

- **e2e specs hardcoding `const BASE = "http://localhost:5173"` ignore `baseURL`.** Combined with
  `reuseExistingServer: !CI`, the tests silently hit whatever is already on 5173 - including a dev
  server running in a different `VITE_API_DOMAINS` mode. Starting a server on another port does not
  redirect them. This produced 63 phantom failures and cost a full investigation cycle. Always
  confirm which server the tests actually reached (fetch `/src/services/config.js` from it).

- **Never A/B by stashing files against a live Vite server.** HMR applies a partially-consistent
  module graph, so the "baseline" you measure never existed. This manufactured a convincing phantom
  "Phase 1 regression" that evaporated on a clean restart. Any stash-based A/B must restart Vite (and
  ideally clear `node_modules/.vite`) before measuring.

- **`expect(locator).toHaveCount(0)` asserts absence and passes on the first poll.** If React has not
  rendered yet, it succeeds for the wrong reason - green when the app is broken, flaky under parallel
  load. Wait for a *positive* signal first, then assert the absence. And `getByRole(..., { name })`
  matches by **substring**: `name: "Notifications"` also matched "Sign in to view notifications".
  Use `exact: true` when the word appears in unrelated copy.

- **Prove a test can still fail.** After fixing the flaky guard assertion, breaking `ProtectedRoute`
  on purpose confirmed it fails correctly. A stabilised test that can no longer detect the bug it
  guards is worse than a flaky one, because it is silent.

- **`useIncrementalCompilation` is inverted, and with annotation processors it silently ships stale
  bytecode.** Despite the name, `false` hands javac only the sources Maven thinks are stale; `true`
  recompiles everything when anything changed (MCOMPILER-209). Under `false`, adding a field to a DTO
  record recompiled the record but never re-ran MapStruct, leaving a `PropertyMapperImpl.class` that
  called the old constructor - green compile, `NoSuchMethodError` at runtime, 18 tests failing with
  HTTP 500. A follow-up `mvn compile` then printed **BUILD SUCCESS while skipping compilation
  entirely**. Proven by experiment: an unmappable field is silently ignored under `false` and fails
  the build under `true` with "Unmapped target property" - i.e. `unmappedTargetPolicy=ERROR`, the
  guard the mapper's Javadoc promises, only actually works under `true`.

- **Corollary: `Copy-Item` preserves the source timestamp, which defeats timestamp-based staleness.**
  Reverting a file from a backup made it look *older* than its `.class`, so the compiler plugin
  skipped it and the suite failed against stale bytecode again. When restoring a file mid-experiment,
  touch it (`(Get-Item f).LastWriteTime = Get-Date`) or the build measures the wrong tree.

- **A "silent" bug is worse than a loud one, and slugs are where they hide.** Owner-created listings
  were saved with `locality_slug = null`, so they rendered perfectly on their own detail page while
  being invisible to every locality facet, `/locality/{slug}` page and saved-search alert. Nothing
  errored; the owner just quietly got no leads. When a column is the key that joins a record to its
  discovery surfaces, "nullable" needs a test that proves the record is *findable*, not merely that
  it saved.

- **Natural keys are a trap for locality/city names.** `localities.name` has no uniqueness
  constraint, changes for marketing reasons, and has genuine spelling variants
  (Hinjawadi/Hinjewadi, Wakad/Wakhad). The slug is the PK, the FK target and the SEO URL. Before
  removing an identifier that looks redundant, check whether it is load-bearing for FKs, URLs and
  normalization - here it was all three.

## Verification harnesses must fail closed, and must not sample one row

Two bugs in my own parity check, both of which produced a **green PASS over a broken feature**:

1. **Unclassified fields were invisible.** Fields in neither the REQUIRED nor OPTIONAL list were only
   printed as informational output and never affected the verdict. `construction` — which drives a
   search filter facet — sat behind a green check. Fix: any mock field not explicitly classified
   REQUIRED / OPTIONAL / WAIVED is now a **failure**. It immediately caught `rera`, which I had missed.
2. **Comparing one sample object hid seven fields.** The check diffed `list[0]`. Fields carried by
   only some listings (`commercialType`, `shellType`, `washrooms`, `powerBackup`, `fixtures`, `form`,
   `priceStr`) were absent from that row, so they never entered the diff. Fix: compare the **union of
   keys across all rows**. (Use a single real row for *semantic* cross-field checks like
   `bhk` vs `bhkNum` — a unioned object can mix rows and fail spuriously.)

Lesson: a harness that can only report what it was told to look for is a harness that certifies its
own blind spots. Make the default outcome "fail until judged", not "pass unless listed".

## Run browser-coupled modules through Vite, not bare Node

The mock provider chain reaches `db.json` imports and `import.meta.env`. Bare `node` fails on both.
The temptation was to edit product source to suit the script (`with { type: 'json' }`, `?.` guards).
Better: `createServer({ middlewareMode: true }).ssrLoadModule(...)` — no new dependency, zero source
changes, and the script then exercises the *actual* module the browser runs rather than a Node-adapted
lookalike. Only Web Storage and `addEventListener` need stubbing.

## A nullable column is not a free-text enum, and the gap only shows under a real client

`properties.possession` existed from V3 as nullable free text, was never written, and was NULL in
every row. It looked harmless for three slices. It was only when the catalogue was pointed at the
real API that it became a **silently broken filter** — the UI sent `ready`, nothing matched, and the
result was an empty page with no error anywhere.

Two things made the fix correct rather than expedient:

1. **Fix the contract, not the client.** The tempting patch was to hide the facet in http mode. That
   would have left the vocabulary undefined and the same bug waiting for the next consumer. Defining
   the enum once — spec, validation, CHECK constraint — makes it impossible to reintroduce.
2. **NULL had to stay legal and had to mean something.** "Not stated" is genuinely different from all
   three states; collapsing it into "ready" would have made the filter promise what the data cannot
   support. Plots have no possession state and correctly stay NULL forever.

Also: an `allOf` that redeclares an inherited property with a *narrower and incompatible* type makes
the schema unsatisfiable. Adding `possession` to `PropertySummary` silently contradicted the free-text
`possession` still declared in the `Property` detail block. Adding a field to a base schema means
checking every `allOf` that inherits it.

## A verification harness must name what it verified against

`npm run parity:property` defaults to `--base http://localhost:8080`. A backend running pre-V10 code
was listening there, and the harness failed with `construction: absent live` and
`localitySlug: absent live` — **the exact shape of a genuine code regression**. Several minutes went
into re-reading a diff that was correct.

The harness was right to fail; it was fail-closed, as designed. The defect was that its output did
not distinguish "your code is wrong" from "you asked the wrong server". It now prints
`live API: <base>` before any comparison. Any harness that talks to an external system should state
which instance answered, because a stale dependency and a real regression are indistinguishable from
the assertions alone.

## Degrading gracefully is not the same as degrading silently

The reviewer flagged unknown possession values mapping to `undefined`. Two of its three concerns did
not survive checking the code — `http.js:109` already drops `undefined` query params, so nothing ever
sends `possession=undefined`; and `JSON.stringify` omits `undefined` keys, so a PATCH cannot NULL the
column. Verifying each claim mattered more than counting them.

But the third was right for a reason worth keeping: `undefined` was the *correct* value in every
case, and the fault was that nobody would ever find out. An unrecognised value now warns, and the
parity harness asserts that exactly two warnings are emitted — so the warning itself cannot rot. The
write path warns only when *both* candidate sources fail, since dropping a possession the user
actually chose is silent data loss, while a payload carrying one shape and not the other is normal.

## `totalElements` is an aggregate — you rarely need a new endpoint to count

I nearly escalated "server-side aggregate endpoints vs. capped fetch" as a product decision. It was
a false dilemma: a paginated list endpoint already returns an exact count over the full result set.
`?size=1` and read `totalElements`. Six of the eight "needs a backend change" pages dissolved once I
noticed that. Check what the existing contract already answers before proposing to extend it.

## A reviewer's severity is a hypothesis; verify the mechanism before acting

A review of this diff returned 1 CRITICAL and 3 HIGH. Two were real. Three were the same
misunderstanding: React runs the previous effect's cleanup **before** the next effect run, so a
per-run `let alive = true` closure already discards stale responses when the dependency changes.
Adding "query matches what I asked for" guards would have been noise defending against nothing.

The inverse also happened: the CRITICAL was described with its polarity backwards (claimed the mock
returned `[]` for a null user; it actually returned *everything*). Acting on the description alone
would have produced a fix for a bug that didn't exist while leaving a worse one in place. Read the
code the review points at — the pointer is valuable even when the analysis is wrong.

## Making sync code async silently converts "cannot fail" into "fails invisibly"

`archiveListing` was a localStorage write; it could not reject, so no call site had error handling.
Routing it through the seam made it a network call — and every one of those call sites now had a
silent failure path that logs a false audit entry and toasts success. When a function becomes async,
its *callers* need review, not just the function.

Related: `Promise.all` in a bulk action is almost always wrong. It fails fast, so one failure
discards the knowledge of which others succeeded — and the UI then reports a count that never
happened. `allSettled` and report what actually occurred.

## A test harness that can't load your product code is telling you something

The parity script only drove the http *mapper*, not the provider. Making it drive the real provider
immediately failed on `window.location.origin` in `services/config.js` — the service layer could not
be loaded outside a browser at all. That is a real constraint on testability, not a script problem.
The related trap: the harness set `globalThis.window = globalThis`, which passes a `typeof window`
check while having no `location`. A partial stub is worse than no stub, because it defeats exactly
the guard written to detect its absence.

## Never `git stash` to establish a baseline when untracked files are part of the change

`git stash push -- frontend/src` left the untracked http provider directory in place while reverting
everything that referenced it, producing a "baseline" of 20 failures that measured nothing but the
inconsistent tree. It also reverted far more than the change under test (the whole session's work).
If a baseline is needed, use a clean worktree or a stash including untracked files — and sanity-check
that the number is plausible before drawing any conclusion from it.

Corollary learned the same day: don't edit source while a Playwright suite is running. The dev server
hot-reloads mid-run and the result describes no version of the code.

## "Same-origin via a dev proxy" does not mean the server skips CORS

The Vite proxy comment said requests stay same-origin so CORS never applies. The browser side of
that is true — no preflight, no blocking. The server side is not: browsers send `Origin` on POSTs
even when same-origin, the proxy forwards it, and the backend's CORS filter still judges it. It
worked only because the default dev port matched the allow-list, so it would have kept working right
up until someone changed the port and got a bare 403 with no CORS wording anywhere.

Two lessons. First, `changeOrigin: true` rewrites `Host`, not `Origin` — the name misleads. Second,
when a comment asserts a class of problem "can't happen", check whether it can't happen or merely
hasn't yet; a coincidence that looks like a design is the expensive kind of comment.

## Prove provenance before asserting on content in an integration test

The first live test asserts the *response came from the API* (`totalElements` present, request
observed on the wire) before any test asserts on rendered content. Without that, a silent fallback to
mocks makes the whole suite pass while verifying nothing — and it would look like strong evidence.
Same reason the count assertion checks for a `locality` query param: a client-side count also renders
a plausible number, so only the request shape distinguishes the two implementations.

## Pick the assertion that a regression would actually break

`My Listings` is asserted against a seeded owner with 4 listings, one `flagged`. Public search shows
3. Asserting "shows some listings" would pass whether or not `/me/listings` was used; asserting
exactly 4 fails the moment anything falls back to public search. Choose fixtures where the correct
and incorrect implementations give *different* answers — then mutation-check it.

## Keep infra-dependent tests out of the default suite

The live spec needs Postgres, a backend and a specific dev-server env. Putting it in the main run
would mean a failure no longer says "the app is broken" — it might mean "Postgres is down". Separate
config, `testIgnore` in the main one, and `reuseExistingServer: false` so a leftover mock-mode dev
server can't serve the wrong bundle to a test that believes it is live.
