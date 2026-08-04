# Lessons

## Deals sub-slice A2

- **`Map.of()` rejects null keys** — `ImmutableCollections$MapN.get(null)` throws NPE.
  When batch-loading counterparty users, guard `get()` with a null check on the key before
  passing it to the immutable map. Java's unmodifiable Map implementations are not null-safe.

- **JPA `save()` does not flush** — in `@Transactional` tests, a JDBC query in the same
  transaction won't see unflushed JPA writes. Use `saveAndFlush()` when the next assertion
  uses raw JDBC to verify side effects (e.g., soft-delete `deleted_at IS NOT NULL`).

<!-- above: feature/backend-integration | below: feature/ui-mobile-improvements -->

## Mobile-first audit + Phase 1 (this session)
- **Measure before rating effort.** Two items the audit called "S" were wrong once the
  import graph was traced: `db.json` can't be dynamically imported without making the
  whole mock layer async (`rawLoad()` is sync, called everywhere), and `societies-rera.js`
  is on the critical path via Home's societies rail. A doc that hasn't opened the call
  sites is guessing at cost.
- **Raw KB != wire KB.** The stylesheet is 209 KB raw but **37.9 KB gzipped**; the review's
  "save 60-100 KB" for a CSS split was really ~10-20. Always quote gzip for perf claims.
- **Budget gates must read the document, not guess filenames.** `index-*.js` matched both
  the entry chunk AND an unrelated vendor chunk. Parsing `dist/index.html` for
  `<script type=module>` + modulepreload + stylesheet is exact and needs no upkeep when
  chunking changes. Also: fail loudly if 0 assets match — a gate reporting 0 KB looks green
  while waving through every regression.
- **The StrictMode double-invoke trap is real and repeats.** A per-visit counter in an
  effect spent its entire 2-view budget on one load. `design-system.md` already documented
  this for InstallPrompt; the same fix (ref guard) was needed for the Nestor nudge. Any new
  "show N times" counter needs it.
- **`scrollIntoViewIfNeeded` stops at the viewport rect**, which includes the strip behind
  a sticky bar — so it parks the element under exactly the chrome you're testing for. Scroll
  to a reading position (`top - 160`) instead.
- **`elementFromPoint` returns null off-screen.** Returning "nothing is covering it" for an
  element that isn't on screen is a pass for the wrong reason. Return OFFSCREEN explicitly.
- **A/B a red test against `git stash` before claiming "pre-existing".** The 2 `help-i18n-urls`
  failures reproduced with all source changes stashed -> genuinely not mine. Cheap and
  conclusive; asserting it without the experiment is just hoping.
- **Not every audit finding is a bug.** Sign-in/sign-up "sub-44px checkboxes" were false
  positives — the *labels* carry `.tap-target` and clicking a label toggles its control, so
  the label is the touch target. Only `/contact` genuinely lacked it. Measure the thing the
  finger actually hits.
- **Some findings are product decisions, not defects.** The property price sits at y=551 on
  a 360x640 screen; lifting it above the fold means shrinking the hero gallery on a property
  site. Raised it, didn't silently decide it — and made the test assert the unconditional
  invariant instead (no *fixed* overlay on the price; scrolling under a sticky bar is fine).

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

## Lesson: a mask that still parses is worse than one that throws

`digits('98XXXXX210')` returns `'98210'`. Not an error, not empty - a short, plausible
string that every downstream key builder happily accepted. The masking itself was correct;
the damage came from a *sanitiser* (`digits()`) silently turning a redacted value back into
something that looked like an identity.

Rules taken from this:
- Validate on a property the bad input CANNOT satisfy. Here: length === 10. Sniffing for
  `X` or the bullet char would have been a guess about mask formats; length is structural.
- When identity is unknown, return `null`/refuse. Do NOT fall back to a shared bucket -
  `|| 'anon'` was the same bug wearing a different name.
- Fail in the direction that under-reveals. Every rejected case here hides the number.
- Don't let a function report success for a write that did not land. `requestContact()`
  returning `'pending'` after a no-op write was how this stayed invisible.

## Lesson: prove a regression test fails on the old code

My first collision test passed against the buggy `contact.js` - it used two unmasked
numbers, so the buckets were legitimately distinct and the leak was never exercised. It
looked like a thorough test and asserted nothing that mattered.

Restoring the pre-fix file from `git show HEAD:<path>` and re-running is cheap (~25s) and
is now the standard step for any bug fix: **red on old, green on new, or the test is
decoration.** The rewritten spec fails 3/6 against the old file.

## Lesson: don't reformat JSON to insert one key

Round-tripping `property.json` through `JSON.parse` + `JSON.stringify(j, null, 2)` inserted
the key correctly and silently deleted 36 blank lines per locale - a 108-line diff for a
3-line change. Reverted and inserted the line textually by anchoring on the neighbouring
key instead. For i18n files with non-ASCII values, script the edit (so the encoding is
preserved) but operate on lines, not on the parsed object - then `JSON.parse` the result
purely as a validity check.

## Lesson: re-run a "known failing" suite before triaging it

`tasks\todo.md` carried an open item to classify 22 e2e failures (qa-location-search x13,
admin-* x9) as pre-existing and unexplained. They had in fact been root-caused and fixed in a
later session further down the same file; only the carry-over checkbox was stale. Two full runs
gave 290/290 green with zero retries consumed.

Cost of the reproduce-first step: ~5 minutes. Cost of trusting the note: an investigation of a
non-existent bug. **Always reproduce a recorded failure before analysing it**, and when closing a
failure, grep the tracker for every entry mentioning it - not just the one you are editing.


## Lesson: participation is not authorisation

The worst defect in slice 4 shipped inside a green build. `OfferService.respond` asked "is the
caller a participant in this offer?" and, satisfied, allowed any action -- so the **buyer could
accept their own offer**, agreeing a price with no owner involvement and flipping the very status
that controls whether a phone number is revealed.

Once named, the same shape appeared in two more places written the same week: the finalization
initiator could accept their own request, and a visitor could mark their own visit `completed` --
forging the anti-fake-review signal that gates the "Visited" badge.

The check answers a question ("may this caller see this row?") that feels like the authorisation
question but is a strictly weaker one. Split them explicitly, and give them different status codes:

- not a participant -> **404**, never confirm the row exists
- a participant who may not take *this* action -> **403**

Whenever a guard is shared by a read and a write, assume it was written for the read.


## Lesson: derive the sensitive value, do not validate what the client sent

`FinalizationService.request` took `counterpartyMobile` from the request body and checked only that
it belonged to *some* registered user. Two findings fell out of that one mistake: a buyer could aim
a proposal at any account on the platform, and the two distinct error messages ("invalid" vs "not
registered") turned the endpoint into a **registered-mobile oracle** -- on a marketplace whose whole
model is not leaking phone numbers.

Both closed with one change: take the counterparty from `property.getOwner()` and use the body's
value only to confirm the caller already knew it. There is now exactly one legitimate answer, so
there is nothing to enumerate and one uninformative error suffices.

Generally: if a field identifies *who a request affects*, the server should derive it from something
it already trusts. Validating a client-supplied identifier only narrows the attack; deriving it
removes the surface. Watch for the tell -- an error message that distinguishes *why* a lookup failed
is usually answering a question the caller had no right to ask.


## Lesson: a rule copied a third time has already forked

`maskMobile` existed privately in `PropertyMapper` and `ContactMapper`; slice 4 was about to add a
fourth. When they were gathered up, `VerificationService.digits` and `DealService.normaliseMobile`
turned out to have drifted into *different* leniencies -- and the loosest would cheerfully accept a
**masked** number and store it as an identity.

Nobody chose that. Each copy was locally reasonable; the divergence is what copying is.

The consolidated `MobileMask.normalise` now fails closed (exactly ten digits or `null`), and it
deliberately **disagrees** with `mask` about country codes: `normalise` handles user input, `mask`
handles values already read back from the DB, so anything unusual reaching `mask` means
normalisation was skipped -- and `null` makes that loud instead of quiet. That asymmetry is now
pinned by a test, because it looks like a bug to anyone who meets it cold.


## Lesson: an agent's green build is evidence about the build, not the code

Four sub-slices were delegated; each came back green and each was re-verified by hand. **Two of the
four contained real defects** the passing suite did not see -- including the self-accept
authorisation hole.

Worse, one agent-written test actively pinned a bug in place:
`requestFinalization_unregisteredMobile_returns400` asserted the *leaky* error wording. It read as
coverage and functioned as a lock on the enumeration oracle.

So: read the security-sensitive service yourself, whatever the test count says. And when a test
asserts an error *message*, ask what that message tells an attacker before treating it as a
requirement to preserve.

The standing counter-measure, used throughout the slice: **prove a regression test fails against the
broken code.** Replace the guard with `if (false)`, re-run that class, confirm red, restore. Every
invariant test in slice 4 was pinned this way; without it you get thorough-looking tests that assert
nothing.


## Lesson: when a guardrail needs an allowlist for everything, fix the rule

The ArchUnit boundary test was deferred twice, and both deferrals were correct for the wrong reason.
The rule on the books -- "no feature package imports another feature package" -- was false the day
it was written: `identity` is "who" and `catalog` is "which listing", so every transaction context
needs both. Six such edges existed. An allowlist naming nearly every pair permits everything and
therefore guards nothing, which is why writing it never felt worth it.

The property actually worth failing a build over was narrower: the context graph must stay
**acyclic**. Enforcing a *layering* (`identity -> catalog -> leads -> deals`, imports point strictly
downward) is true today, cheap, and catches the thing that would be irreversible.

It found a violation on its first run -- the one previously recorded as a permanent exception,
`security.JwtService` taking the `identity.user.User` entity. That is the single direction the rule
cannot tolerate, because the kernel is imported by everything. And the dependency was not even real:
the issuer read five scalars. Inverting it (`TokenSubject` in `security`, implemented by `User`)
changed no callsite.

Two things generalise. **A documented exception is worth re-testing rather than grandfathering** --
this one had been accepted for three slices and dissolved in ten minutes. And **a rule you keep
declining to enforce is usually the wrong rule**, not a chore you are avoiding.


## Lesson: PowerShell 5.1 traps that cost real time this session

- Heredocs (`<<'EOF'`) **do not exist**. Piping a script into `python -` fails at the parser.
- `Out-File -Encoding utf8` **writes a BOM**, which ends up in the first line of a commit message.
  Use `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))`.
- Chain with `;` and gate with `if ($?) { ... }`; never `&&`.
- The Maven exit code is not trustworthy here -- always aggregate
  `target-cli\surefire-reports\*.txt` for the real totals.

## Lesson: `:param is null` is a Postgres landmine in JPQL

`(:from is null or t.date >= :from)` looks like the standard optional-filter idiom and compiles
fine. Postgres rejects it at execution: `ERROR: could not determine data type of parameter $2`.
Both sides of the `is null` are unknown, so the driver cannot infer a type, and the **whole
statement** fails -- not the branch, the query. This broke **100% of `/summary` calls** and was
invisible until a test hit the endpoint.

Fix: `cast(:from as LocalDate) is null`. Any optional parameter compared to `null` in JPQL needs
the cast. Grep for `:x is null` before shipping a repository.

## Lesson: a multi-column `@Query` declared as `Object[]` silently nests

Spring Data models a multi-column projection as `List<Object[]>`. Declare the return type as
`Object[]` and you get a **one-element array containing the row** -- so `result[0]` is itself an
`Object[]`, and the cast blows up at runtime with a `ClassCastException` that names neither the
query nor the column.

Use a projection interface with `as` aliases in the select. It is typed, it is self-documenting,
and it deleted a pile of `((Number) x).longValue()` casts on the way out. Cost: five lines.

## Lesson: in a `@Transactional` `@SpringBootTest`, `JdbcTemplate` cannot see un-flushed JPA writes

They share the transaction but not the persistence context. `save()` only queues the insert, so a
raw-column assertion after a successful `201` fails with `EmptyResultDataAccessException` -- which
reads like "the endpoint did not write" and is actually "the endpoint has not flushed". Call
`em.flush()` before any raw SQL read in a test. Worth a named helper so the next person does not
spend the same twenty minutes.

## Lesson: check what the shipped UI can send before adding a server-side constraint

Three near-misses in one slice: `@PastOrPresent` on a transaction date would have rejected
post-dated cheques, which are how a large share of Indian rent is actually paid.
`familySize: integer` cannot express "Bachelor (Male)", which is the single most consequential fact
in a Pune tenancy screening. And `TenantProfile` carried `employer`/`budget`/`preferredLocalities`
that no screen has ever collected, while **four of the six trust-score inputs had no column at
all** -- so a faithful server would have halved every tenant's score on cutover.

The contract is law, but the contract can be wrong. Read the form before you constrain the field.

## Lesson: iterative date stepping clamps once and never recovers

`next = next.plusMonths(1)` from 31 Jan gives 29 Feb -- correct -- and then 29 Mar, 29 Apr, 29 May.
The clamp is **sticky**, because each step is measured from the already-clamped date. Month-end
rent silently walks two days earlier, forever, after one February.

Always step from the original anchor: `anchor.plusMonths(n)` re-derives the 31st in every month
that has one. The Javadoc here confidently described the broken behaviour as the correct one, which
is exactly why it survived the first read -- **a comment asserting correctness is not evidence of
it**, and is a good place to look for bugs.

## Lesson: reviewer findings are input, not instructions

Of six ranked findings from this slice's review, two were real (the date drift, a misleading log),
two were already handled (a null guard the reviewer read past), and two were style dressed as
risk. The one ranked **HIGH** -- an "off-by-one" in an occupancy day-count -- was wrong: half-open
`[start, end)` is the correct interval convention, and "fixing" it would have double-counted the
day one tenancy ends and the next begins. Applying it would have introduced the bug it claimed to
remove.

Triage every finding against the code and the domain. Then leave a comment where you rejected one,
so the next reviewer does not re-raise it and the next author does not "fix" it.

## Slice 6 - the rent money rail

**A "pause" you cannot undo is a trap, not a safety feature.** The mandate write refused any
re-activation, reasoning that debiting a bank account needs fresh consent. That reasoning is correct
for *revoke* and wrong for *pause*, and collapsing the two made the pause button a one-way door
disguised as a toggle. The tell: the `MandateStatuses` constants had already encoded the right state
machine, and the service overrode it with a special case. **When a service adds an `if` in front of
its own `canTransition`, one of the two is wrong -- and it is usually not the state machine.**

**A status filter in a lookup is a policy decision, and it hides.** `findActiveByTenancyId` filtered
`status = 'active'`, so a paused mandate was invisible to the write path and could never be revoked:
an uncancellable standing instruction against someone's bank account, created by a `WHERE` clause.
The word "active" in a finder name looks like a detail and is really the answer to "who is allowed
to reach this row". **Ask of every filtered finder: what becomes unreachable, and is that intended?**

**Scope idempotency keys to the resource, in the index and not only the query.** A global
`findByIdempotencyKey` hands anyone who guesses a key the payment it belongs to -- from a path whose
whole job is to *skip* the checks. Scoping the unique constraint to `(tenancy_id, idempotency_key)`
makes the isolation structural: the query cannot be written unscoped, because the caller must supply
a tenancy it was already authorised for. **Corollary: authorise first, replay second.** The original
ordering replayed the key before resolving the tenancy, which is exactly what made the leak possible.

**"The index is the real guard" is only true if you catch the violation.** Both a service `exists`
check and a unique index were in place, with a comment explaining that the check was a courtesy and
the index the guard. But nothing caught `DataIntegrityViolationException`, so the loser of the race
got a 500 for behaving correctly. **A constraint you rely on for correctness needs a catch block that
turns it into the status code the check would have produced.**

**Reviewer findings are input, not instructions -- and the confident ones need checking hardest.** Of
16 findings across two reviewers, 6 were real. One MEDIUM ("missing foreign keys allow orphaned
payments") was simply false: every one of those columns is `NOT NULL REFERENCES` in V6, which the
reviewer did not read -- and a second finding was stacked on top of the same mistake. Two more asked
for redundant `save()` calls on managed entities inside a transaction, i.e. cargo cult dressed as
consistency. **Verify the premise before accepting the fix; a wrong premise usually arrives with a
plausible sibling.**

**Declare every status code the server can actually return.** `payRent` documented `201`/`422` while
returning `404` and `409` too, and seven *already-shipped* slice-4 operations had the same gap. An
undeclared status has no branch in a generated client, so a perfectly good "the rent changed, confirm
again" surfaces to the user as an unhandled error. **A contract that under-declares is not merely
incomplete -- it actively produces bad UX at the exact moments the server is being careful.**

**Backfill from the data, not from the clock.** V14 filled a new `NOT NULL due_date` with
`current_date`, which would stamp every historic payment with today and quietly break overdue
calculations and month-by-month reporting. `date_trunc('month', created_at)` preserves the real
order. The table is empty today -- which is precisely why the mistake was easy to write and would
have been discovered much later.

**Let the provider's number reconcile, never write.** The payment callback's amount is compared with
what we billed and logged loudly on mismatch, but it never overwrites the ledger and a mismatch never
blocks settlement. Both halves matter: writing it would let the provider's rounding become our
revenue figure, and refusing to settle would leave a tenant who genuinely paid showing as unpaid.

## Slice 7 (Catalog & Search)

### Postgres: `ON CONFLICT ON CONSTRAINT` cannot name an expression index
A `UNIQUE` **constraint** cannot be declared over an expression, so `lower(city)` can only ever be a
`CREATE UNIQUE INDEX`. The explicit-looking `ON CONFLICT ON CONSTRAINT uq_...` form was therefore
never available - it 500s. Use the inference form `ON CONFLICT (mobile, lower(city))`, which must
match the index's columns *and* expression exactly and so still fails loudly if the index changes.
Same guarantee, different spelling.

### Catching `DataIntegrityViolationException` around `save()` inside `@Transactional` is a trap
The failed flush marks the transaction rollback-only. Swallowing the exception produces a caller that
believes it succeeded and a commit that then throws - the worst of both. `INSERT ... ON CONFLICT DO
NOTHING` avoids the exception existing at all. I wrote the buggy version first and caught it before
compiling; it would have passed a single-threaded test.

### `src/test/resources/application.properties` SHADOWS the main file, it does not merge
Same filename, test classpath first. Anything production config needs and tests must exercise has to
be written **twice**. This nearly let me ship a page-size cap that the test run did not actually have
- the tests would have "proved" a protection that only existed in prod config.

### Spring's default `max-page-size` is 2000
It silently applied to a public endpoint shipped five slices earlier, whose contract had said
`maximum: 100` since day one. A published limit that nothing enforces is not a limit. Set
`spring.data.web.pageable.max-page-size` globally, not per-controller.

### Spring binds a `Pageable`'s sort even when the endpoint declares no sort parameter
`?sort=anything` is bound and appended to the derived query; an unknown property becomes a **500 an
anonymous caller can trigger by guessing**. Where sorting is not offered, strip it
(`PageRequest.of(page, size)`). A whitelist is the right answer only where sorting *is* offered.

### A counter that measures the wrong predicate is worse than no counter
The stored `listing_count` columns did not merely drift - they counted *all* properties while every
surface that displays them means approved-and-unarchived. Stale can be refreshed; wrong-by-construction
was wrong the day it was written and looks trustworthy the whole time. Enforce the fix structurally:
leave the columns **unmapped on the entity** so reading them is impossible, not just discouraged.

### Do not let a reviewer's confidence substitute for evidence
Of the code review's 1 CRITICAL + 2 HIGH, only the CRITICAL survived. One HIGH (division by zero) was
invented from a mapper signature by a reviewer that said outright it had not read the service - there
is no division in the package. The other (MapStruct silently rebinding to a future entity getter,
defeating the whole counter decision) was a plausible, load-bearing claim, so I **tested it**: added
exactly that getter, compiled, and read the generated mapper - it still binds the parameter. A
whole-parameter match beats an entity property. Cost: about four minutes. Verify claims that are cheap
to verify, especially the ones you would otherwise act on.

### Flyway operational notes (cost me a failed run each)
Applying migrations by `psql` leaves no `flyway_schema_history`, so the next boot refuses with
"non-empty schema but no schema history table" - let Flyway own the DB, or rebuild it empty. And
editing any already-applied versioned migration changes its checksum, which means another rebuild of
`punenest_test`.


## Pagination pass + OTP rate limiting

- **A contract that declares a status nobody implements is a bug report you already filed.**
  `POST /auth/login` carried `429` in the spec and had no limiter. Grepping the spec for declared
  error responses with no server-side counterpart is a cheap, repeatable audit - do it per slice.
- **Rate-limit state does not need new infrastructure if the thing you are limiting already writes
  a row.** `otp_codes` had one row per send, so the limiter is a single indexed query: no Redis, no
  bucket cache, and it survives restarts and multi-node deploys for free. Look for the existing
  write before reaching for a counter store.
- **Key a limiter on the thing being harmed, not on the caller.** The victim's mobile is what gets
  spammed and billed, and it is the one identifier the attacker cannot rotate while still attacking
  their chosen target. Keying on caller/IP would have been both weaker and forgeable.
- **A limiter keyed globally is a DoS you built yourself.** The per-number isolation test exists
  purely to stop a future "simplify this counter" refactor turning one attacker into an outage for
  everyone. Test the *shape* of a defence, not just that it fires.
- **JPA writes are not flushed when raw JDBC runs in the same transaction.** A test that backdates
  rows with `JdbcTemplate` matched zero rows until `em.flush()` ran first - and without
  `em.clear()` after, the next repository read was served the stale first-level-cache entity and
  never saw the new timestamp. Flush before, clear after.
- **A spec audit that ignores `$ref` parameters will lie to you.** The first pass read
  `p.get('name')` and so missed every `$ref`-style parameter, making paged endpoints look
  unparameterised. Resolve refs *before* drawing any conclusion from a spec scan.
- **"Scope is not the test; growth is."** `/me/rent-payments` looks personal and bounded because of
  its path. It grows a row a month forever. The right question for pagination is never "whose data
  is this?" but "what makes this list longer, and does it ever stop?"
- **Before writing a rule, check whether the codebase already follows one.** The spec's 9 paged
  endpoints were exactly the platform-scale ones - a consistent, deliberate rule that had simply
  never been written down. Documenting the existing rule beat inventing a new one, and shrank the
  work from 42 endpoints to 3.
- **A client-side pager is a smell, not a solution.** `Table.jsx` slicing a full array on 19 admin
  screens was the evidence that the product had already decided those lists are paginated; the mock
  made server paging free, so the intent never reached the contract. When the UI pages and the API
  does not, the API is wrong.
- **Spring binds `?sort=` whether or not your endpoint offers it.** An unknown sort property reaches
  the query and surfaces as a 500 that any caller can trigger. Where sorting is not part of the
  contract, rebuild the `Pageable` with `PageRequest.of(page, size)` and drop the sort.
- **PowerShell 5.1's `Set-Content -Encoding UTF8` prepends a BOM**, which `javac` rejects with
  `illegal character: '\ufeff'`. Never rewrite a source file that way - use Python with explicit
  UTF-8, or `utf-8-sig` on read to strip an existing BOM. PowerShell also has no heredoc: pipe a
  script *file*, never `python - <<'PY'`.
- **Two paged reads over the same table still need two tests.** The rent pair (`/me/rent-payments`
  tenant-side, `/me/rent-ledger` owner-side) share a table and differ only in the join column - the
  exact shape where a copy-paste bug makes one return the other's rows.


## Slice 8 (Engagement) — lessons

### An index that contains the sort column still may not back the sort
V16 caught `idx_notifications_user (user_id, read, created_at DESC)` failing to back
`WHERE user_id = ? ORDER BY created_at DESC` — `read` sits *mid-key*, so Postgres uses the
`user_id` prefix to find rows and then sorts every one of them. The index looked right at a glance
and contained every column involved. Auditing the rest of the slice found two more (V17).

The check is not "does the index mention created_at" but **"is the sort column reachable as an
unbroken prefix continuation after the equality predicates"**. Read the `CREATE INDEX`, not the
comment above it — and when one instance of this turns up, sweep the whole slice, because it comes
from a habit rather than a slip.

Corollary worth keeping: small editor-curated tables (`banners`, `faqs`, `announcements`,
`cms_services`) should be left unindexed and the reason written down. The planner will seq-scan
them anyway. The distinction that matters is **bounded by an editor's patience vs bounded by user
growth**, and it is not visible from the query.

### Architecture tests that match on source text can be evaded by SQL — don't
`ArchitectureBoundaryTest` ranks bounded contexts and fails the build on an upward import. Reviews
(engagement=2) needed visit facts (deals=4) and tenancy facts (finance=3). A native query naming
those tables would have passed the test silently, because a SQL string mentions no package.

That is worse than the import it evades: it swaps a compile-time dependency on another context's
*API* for an invisible runtime dependency on its *schema*. The port inversion (`PropertyExperience`,
`RatingLookup` on the `common.trust` kernel, following the existing `ContactGate`) is more code and
the right answer. **When a boundary test blocks you, the question is whether the boundary is wrong,
never whether the test can be slipped past.**

### `Routes` composition can silently rename a path variable
`Routes.Properties.BY_ID` is `/properties/{id}`; the contract's review route says `{propId}`.
Composing the constant would have produced a working route with the wrong variable name — no
compile error, no test failure until something reads the wrong path variable. Reuse of a route
constant is only safe when the *variable names* match too, not just the path shape.

### The fix that looks tolerant can be the dangerous one
`POST /notifications/read` with a malformed id threw `IllegalArgumentException` → 500. The obvious
"tolerant" fix — skip ids that don't parse — would have been an escalation: an all-garbage list
arrives **empty**, and empty is the sentinel for "mark *all* read". A client typo would have
cleared the entire inbox, silently, with a 204.

**When a collection has a sentinel value (empty = all, null = everything, 0 = unlimited), any code
path that can *shrink* that collection can reach the sentinel by accident.** Filtering into a
sentinel is a bug class, not a one-off. Reject at the edge instead.

### A validation pattern that is too tight is the same bug as no pattern
Adding `@Pattern` for `alertFrequency`/`channel` fixed a user-triggerable 500 — but a wrong pattern
would simply move the failure. So the test asserts all **12** legal combinations are accepted, not
just that two illegal ones are rejected. Vocabulary tests need both halves; the accept-half is the
one people skip and the one that breaks real clients.

### Reviewer output is a lead, not a finding
Standing practice after an earlier slice produced fabricated review claims: **verify every claim
against the source before acting.** This slice: 6 findings confirmed and fixed, 1 closed with a
written reason, 2 rejected on inspection (one the reviewer retracted mid-report; one was my own
suspicion that the code already handled). And the highest-severity real bug — the notification
sentinel above — was found by hand, by *reading around* a line a reviewer had quoted for an
unrelated reason. Reviewers are good at breadth and unreliable at depth; the reading is not
optional.

### Where a deliberate decision gets written down matters
"Reviews publish immediately with no moderation queue" was flagged as a security finding. It is
actually the product posture — pre-moderation means an author cannot see their own review, which
suppresses honest reviews far more than dishonest ones, and the eligibility bar (a real tenancy or
completed visit on *that* property) is the actual defence. The reason now lives in
`ReviewService`'s Javadoc, next to the line that sets the status — not only in a task file. A
decision recorded where the reader is already looking does not get re-litigated by the next
reviewer, or quietly "fixed" by the next author.

### A REQUIRES_NEW write escapes the test's rollback
`AuditService` is `@Transactional(REQUIRES_NEW)` on purpose, so an audit row survives a rolled-back
business transaction. The consequence in tests is easy to miss and makes a suite quietly
order-dependent: the rows outlive `@Transactional` rollback and accumulate across runs. Two
assertions failed on each other's data. The fix is in the test, never the propagation - **scope
every assertion to the specific row under test (`entity_id`), never to the emptiness of a table** -
plus an `@AfterEach` that deletes what the class created. "Assert the table is empty" is a
test-isolation bug waiting for a second test to be written.

### jsonb is stored normalised, so never assert on its text
An audit-metadata assertion compared `"from":"pending"` as a substring and failed against
`"from": "pending"` - Postgres had reformatted it. Asserting on the serialisation of a document
column is asserting on formatting. Read it back through `metadata->>'key'` and compare values.

### `Set-Content -Encoding ascii` destroys Unicode silently
A regex replace round-tripped through ascii turned 12 em-dashes into `???` across a source file.
`-Encoding UTF8` is not the fix either - it prepends a BOM, which broke the OpenAPI YAML a slice
earlier. PowerShell 5.1 has no `utf8NoBOM`. **Edit files through Python with
`encoding='utf-8', newline='\n'`, or through the editor tool.** Also: `python -c "..."` from
PowerShell mangles nested quotes and `$`; write a `.py` file and delete it after.

### Spring's default bean name is the simple class name, so contexts collide
`moderation.verification.VerificationController` and the existing
`identity.verification.VerificationController` (Aadhaar KYC) produced a
`ConflictingBeanDefinitionException` at startup. A new bounded context can silently collide with an
old one across the whole application. Renaming to `PropertyVerificationController` was clearer
anyway - it is *listing* verification, not identity verification.

### Grep the controllers, not the obvious service, before building an endpoint
I re-implemented `PATCH /properties/{id}/archive|restore` and got an ambiguous-mapping failure:
they already shipped in slice 2, with the correct owner-or-staff rule. `PropertyService` is
read-only, which misled me - the writes live in `catalog.listing.ListingService`. The route is the
identity of an endpoint; search for the route string across controllers first.

### Entities get their id at INSERT, not at construction
`@UuidGenerator` + `@CreationTimestamp` populate on flush. Any DTO built from an entity created in
the same transaction - especially a child added to a cascaded `@OneToMany` - reads nulls. This
500'd every verification message post, and it was **found by a test written for an unrelated
invariant**, not by a reviewer. The tell is `save(...)` where the response exposes a generated
field; `saveAndFlush` before mapping. Worth applying even where the response happens not to read
the id today, because that correctness is a coincidence a future field will break.

### Escaping a LIKE term is not defensive coding, it is the feature
`q + "%"` looks anchored and isn't: the caller can supply their own `%` or `_` and step outside the
anchor. Without `pg_trgm`, the index only serves anchored patterns, so `?q=%` degrades a
staff-callable endpoint to a full scan - and a page cap does not help, because the scan happens
before the limit does. The regression test asserts **both** halves: wildcards are matched
literally, and an honest prefix still returns its row. A test for only the first half passes
happily against a search that has stopped working.

### A reviewer's fix can be worse than the bug
A MEDIUM finding proposed catching audit-serialisation failures and writing `"{}"`. That converts
a loud failure into a silent one on the single table whose entire purpose is to be trusted - if an
action cannot be recorded, the right answer is to refuse the action, not to perform it and file an
empty note saying it happened for reasons unknown. Rejected, and the reasoning written into the
Javadoc beside the line, so the next reader does not "fix" it back.

<!-- above: feature/backend-integration | below: feature/ui-mobile-improvements -->

## 2026-07-31 - Never run an unvalidated bulk-rewrite script across the tree

**What happened.** A PowerShell rename script built its replacement map as
`@( @('a','b') @('c','d') )`. PowerShell *flattens* nested array literals when they
are newline-separated inside `@()`, so `\` became a flat string array. The loop
`foreach (\ in \) { \.Replace(\[0], \[1]) }` then indexed
*characters*, turning every replacement into a single-character substitution. ~800 files
under `frontend/src`, `e2e/tests`, `docs`, `backend/src` and `tasks` were
character-mangled in one pass.

**Why it was recoverable.** Tracked files came back with `git reset --hard`. The
uncommitted Phase 1 work survived only because an earlier `git stash push -u` /
`git stash pop` had left unreachable commits in the object store
(`git fsck --unreachable`): `8ac3eb7` (tracked mods) and `26c0142` (untracked files).
Two edits made *after* that stash had to be re-applied by hand, and `tasks/todo.md`
content was lost.

**Rules going forward.**
1. Commit (or `git stash create`) before any scripted bulk rewrite. Uncommitted work is
   the only thing git cannot give back.
2. Dry-run first: print the planned per-file diff count and rewrite **zero** files until
   the map is verified on one sample file.
3. Validate the map's shape before use - assert every entry is a 2-element array and that
   both elements are non-empty multi-character strings.
4. Prefer `git ls-files` to scope a rewrite to tracked files only.
5. PowerShell hashtable keys are case-insensitive; a case-sensitive rename map must be an
   array of pairs, and building it needs an explicit comma between elements.

## Mobile-only design work (Phase 2)

- **Shared CSS classes are the cheapest lever.** Seven consumer overlays all use
  `.pn-modal-backdrop` / `.pn-modal`. One media query turned every one of them into a
  bottom sheet with zero markup edits. Look for the shared class before editing components.

- **A new floating control can physically block an existing one.** The filters pill and the
  Nestor FAB both anchored bottom-right; Playwright caught `.pn-assistant-slot subtree
  intercepts pointer events`. Any new `position: fixed` element must be checked against the
  bottom-chrome inventory (bottom nav, FAB, cookie bar, CityChrome, sticky CTA), not just
  against z-index.

- **Two controls for one action = a strict-mode failure waiting to happen.** The in-bar
  Filters button and the new pill were both `lg:hidden`, so both rendered below 1024px with
  the same accessible name. The fix was deleting the redundant one, not renaming it — if a
  locator can't tell two controls apart, neither can a user.

- **Measure animated elements after the animation settles.** `getBoundingClientRect()` right
  after `appendChild` catches a sheet at `translateY(100%)`. Await
  `el.getAnimations({ subtree: true })` `.finished` first.

- **Sub-pixel is not a bug.** A "bar overlaps footer" assertion failed at **-0.140625px**.
  Assert `> -1`, and say why in a comment, rather than chasing fractional layout rounding.

- **`position: sticky` beats `fixed` for in-flow action rows.** The wizard's step actions stay
  in flow, so they reserve their own space and can never cover the last field — no per-step
  `padding-bottom` bookkeeping.

- **`title=` is not a label on touch.** `CompareToggleBar` had four icon-only controls whose
  only name was a `title` attribute — completely invisible on a phone. Grep for `title=` on
  icon-only buttons during any mobile pass.

- **Enhancements should fail closed.** `srcSetFor()` returns `undefined` unless it can prove
  the URL is resizable, so a bad URL yields a plain `src` rather than a broken image.

## Mobile-only work — Phase 3

- **An inline `style` beats a responsive Tailwind class.** Writing a FAB offset as
  `style={{ bottom: 'calc(...)' }}` alongside `lg:bottom-24` silently changes desktop,
  because the inline style wins at every width. Use an arbitrary-value class instead.
- **Check whether a rule already exists before adding it in a media query.** `.lp-meter`
  was already `position: sticky` unconditionally; re-declaring it inside the mobile block
  hid that fact and made a desktop guardrail look like a regression. Grep the base rule first.
- **Some properties cannot prove a non-leak.** Chrome computes
  `-webkit-tap-highlight-color` as `rgba(0, 0, 0, 0)` by default on a pointer device, so a
  desktop assertion on it is meaningless. When a property has the same value by default,
  the media-query bound is the guarantee — say so in a comment instead of writing a
  test that always passes for the wrong reason.
- **`window.scrollTo(x, y)` then reading `scrollY` returns 0** when the app sets
  `scroll-behavior: smooth`. Use `scrollTo({ top, behavior: 'instant' })` in specs.
- **`waitForLoadState('networkidle')` is not enough for a `lazy()` route.** It can fire
  before the chunk mounts; a probe measured an empty document and looked like a bug.
  Wait for a real element (`getByRole('heading')`).
- **Measure a detached probe element bare, not inside its hidden parent.** Appending a
  `.pn-dropdown__option` inside a `.pn-dropdown__menu` measures zero because the menu is
  hidden until opened.
- **Take pointer capture on the first qualifying move, never on pointerdown.** Capturing
  eagerly retargets the following `click` to the capturing element and breaks every button
  inside the panel.
- **`git stash -u` + re-run is the only trustworthy way to separate new failures from a
  noisy baseline.** The desktop suite went 58 -> 66 failures; stashing proved all 11
  suspect failures were pre-existing rather than guessing from cluster names.

## Phase 4 lessons

- **An inline `style` silently defeats a token system.** `BottomNav` set `height` from a JS
  constant, so the bar's height was only *apparently* owned by `--pn-bottom-nav-h`. Any
  media query that changed the token would have desynced the bar from its own slots. Before
  trusting a CSS variable, grep for an inline style on the element that consumes it.

- **`min-width` breakpoints cannot tell a landscape phone from a tablet.** A rotated handset
  is ~915px wide, so `min-width: 768px` served it the desktop navbar on a 412px-tall screen.
  When a rule is really about *available height*, key it off height/orientation, not width.

- **A px font-size is not "safe" from dynamic type — it is the accessibility failure.**
  `text-[10px]` never overflows at 200% because it never scales. Passing an overflow test
  for that reason is a false negative. Convert to `rem` and add an overflow guard.

- **`leading-none` clips glyph extents.** line-height 1 is shorter than ascent+descent, so
  `scrollHeight > clientHeight`. Harmless at 10px, visible once the text scales.

- **Specificity ties are decided by which Tailwind variant is live, not by source order
  alone.** A one-class rule beat `h-16` at 640px but lost to `md:h-[72px]` at 915px. When
  overriding a responsive utility, go two classes deep rather than reaching for `!important`.

- **Measure the fix at the viewport that must NOT change, not just the one that must.** The
  landscape guard only earns trust because 1024×768 landscape-tablet and 1440×460
  short-desktop are asserted to stay at 72px — those prove the height and width guards
  independently.

- **When a constraint is physically unsatisfiable, say so.** The raised centre slot cannot
  fit a 56px circle plus a 24px label in a 56px bar. Scoping the assertion and documenting
  the exemption is honest; loosening it silently, or redesigning the slot without asking,
  is not.

## PWA lessons

- **Set the data-caching boundary before the data exists.** Writing `/api/* → NetworkOnly`
  while the app is still on mock data costs nothing and is fully testable; bolting it on
  after a live backend means experimenting on real listings, where a stale "available" flat
  is a trust failure.

- **A regex `urlPattern` fails open.** `/^\/api\//` is tested against the *whole* URL, so it
  never matches `http://host/api/...` — the rule silently does nothing. Match on
  `url.pathname` via a function, and assert the exclusion with a test that walks Cache
  Storage rather than trusting the config.

- **Precache the initial load graph, not the build output.** `dist` was 7 MB / 200 files;
  precaching it all would mean a 7 MB download before first paint.

- **An offline PWA fails to a blank white screen, which is worse than the browser's offline
  page.** `navigateFallback` serves `index.html` happily, then the lazy route chunk 404s and
  React never mounts. Always test "load once → go offline → reload", and read the
  `requestfailed` log instead of guessing which chunk is missing.

- **A service worker in dev would poison an entire e2e suite.** Keep `devOptions.enabled:
  false` and add a test asserting zero registrations in dev, so turning it on cannot happen
  quietly.

- **Scattered failures across unrelated specs + a 6× slower run = machine contention, not a
  regression.** Three orphaned Vite dev servers with `usePolling` turned 0 failures into 16.
  Check `Get-Process node` and listening ports before debugging the code.

## Bundle / chunking lessons

1. **An unassigned module in `manualChunks` is not "left in the entry" — it gets folded into
   whichever chunk happens to reference it.** If that chunk is a lazy vendor bundle, the entry
   now statically imports the *entire* bundle. One 3 KB shared module (`react/jsx-runtime`)
   pulled 189 KB of charting code in front of first paint.
2. **`if (!id.includes('node_modules')) return;` silently drops Vite's virtual modules.**
   `vite/preload-helper` has no `node_modules` in its id, so it fell through to "unassigned"
   and landed in vendor-jspdf — 382 KB eager, for a helper used by every dynamic import.
3. **A `vendor-react` rule that matches `react-dom` does not match `react`.** Substring rules
   read as if they cover the family; they don't. Match the path segment (`node_modules/react/`)
   and order the rules so the more specific package (`react-chartjs-2`) is claimed first.
4. **Grep finds import statements; only the bundler knows the graph.** The initial hypothesis
   ("fix the 5 jsPDF importers") was wrong twice over: 4 of the 5 were already lazy, and fixing
   the 5th did not remove the preload at all. Rollup's `getModuleInfo().importedIds` /
   `dynamicallyImportedIds` gave the answer in one run.
5. **Verify the artifact, not the source.** After the source graph reported "dynamic only",
   `dist/index.html` *still* preloaded both chunks. Source-level correctness and bundle-level
   correctness are different claims and need separate evidence.
6. **`manualChunks` is build-only, so no dev-server test can catch this.** The whole class of
   bug is invisible to the Playwright suites. Assert on `dist/index.html` after a build.
7. **Prove "pre-existing" instead of asserting it.** `git stash push -- <only the changed files>`
   gives a clean before/after on the exact suspect file without disturbing ~237 other
   working-tree entries, and `stash pop` restores it.
8. **Cold dev servers manufacture flakiness.** Right after killing stray servers, the mobile run
   showed 8 flaky (all bottom-nav/inset); the same specs on a warm server were 25/25 clean.
   Re-run before believing a flake cluster.

## Dev-server "first click hangs" — diagnosis (not a PWA bug)

Reported symptom: clicking a page link the first time takes ~1-2s and feels hung; instant after.

Measured, cold browser cache (fresh context per route), first in-app click:

| Route | Dev server | Production build |
|---|---|---|
| EMI calculator | 1488-1780 ms | **164 ms** |
| Flatmates | 1081-1258 ms | **155 ms** |
| Services | 1309-1681 ms | **109 ms** |

- Service worker in dev: `{ regs: 0, controlled: false, caches: [] }` — `devOptions.enabled: false`
  means no SW exists there, so **vite-plugin-pwa cannot be the cause**. In production the SW makes
  repeat loads faster, never slower.
- Only 3-7 requests / ~14-32 KB per first click, so it is not download size — it is Vite
  transforming the route module on demand. The result is cached, hence "fast from the second time".
- Dev-server idle CPU measured at 0 over a 5s window, so `watch.usePolling` is not a factor.

**`server.warmup` was tried and REVERTED — it did not help.** A/B with identical restarts:
control 1488/1081/1681 ms vs warmup 2235/2221/1021 ms. Warmup competes for CPU at startup and
the first click still pays for the rest of the route graph. Reverted rather than shipping config
that looks like a fix but measurably is not.

## i18n renames are silent failures
- The Share-a-Flat -> Flatmates rename moved  + "ShareFlatSection.jsx" +  ->  + "FlatmatesSection.jsx" +  and its
   + " ('home.shareFlat.*')" +  calls ->  + " ('home.flatmates.*')" + , but left the  + "shareFlat" +  block in
   + "i18n/locales/*/home.json" +  untouched. i18next renders a missing key as the key itself, so
  the home page shipped  + "home.flatmates.headingLead" +  as visible copy. No test, lint rule or
  build step failed.
- Lesson: a rename is not done until the locale JSON moves with it, in every language.
- Guard added:  + "rontend/scripts/check-i18n-keys.cjs" +  ( + "
pm run check:i18n" + ) resolves every static
   + " ('a.b.c')" +  against the merged English bundle. Proven to catch this exact regression (13
  keys) by temporarily renaming the block back. The trailing  + "[,)]" +  in the regex is what
  separates a complete key argument from the literal half of  + " ('a.b.' + kind)" + .
- Interpolated keys are invisible to static analysis, so a runtime guard was added too:
   + "mobile-home-featured-first.spec.js" +  walks Home's text nodes and fails on anything shaped
  like a dotted key.

## Docs/OpenAPI re-sync after a large feature redesign

- **The git history was one squashed commit, so there was no diff to work from.** When "what
  changed?" is unanswerable from VCS, the only reliable method is to re-derive the docs FROM the
  current source. Do not trust a doc's own "Status: documented from React source" line - the
  flatmates doc claimed it while describing a tab model that had been deleted.
- **Fan out the audit, serialise the edits.** Three read-only subagents (design-system, OpenAPI,
  other flow docs) produced evidence-backed drift lists with file+line citations in one pass; writing
  the edits afterwards was then mechanical. Asking a subagent to *edit* would have raced on shared
  files.
- **A rename is a doc-wide event, not a doc-local one.** `Flatmates/Rooms/Groups -> move-in/team-up`
  leaked into saved-alerts (alert `tab` values), ops (a new queue), admin (a whole missing doc),
  search-listings (a removed cross-sell pill), property-detail (a deep link), rent-agreement (a
  reissue entry) and the coverage matrix counts. Grep the old vocabulary across `docs/**` before
  declaring a rename documented.
- **Document the inert wiring honestly.** `?flat=&reissue=1` is produced by Flatmates and never read
  by `useRentAgreement.js`. Writing "this exists" without "and it currently does nothing" would have
  buried a real bug in a doc that reads as a spec.
- **YAML flow scalars break on `: ` (colon-space), not on semicolons.** A description like
  ``An open-policy group (`policy: any`) auto-accepts`` is a parse error; the same sentence with a
  semicolon is fine. Either quote the whole scalar or reword to `policy` = `any`.
- **Validate the spec after every batch, not at the end.** A ~30-line PyYAML script that reports
  paths / schemas / refs / unresolved / unused / boolean-enums / duplicate operationIds catches the
  YAML-1.1 traps and orphaned schemas in seconds. Expect unresolved == 0 and unused == 0.
- **A relative-link check over `docs/**` is worth running even when you did not touch links** - it
  surfaced 25 dead links left by earlier sessions that deleted `app-architecture.md`,
  `domain-model.md`, `api-contract.md` and `flows/_TEMPLATE.md` without repointing their referrers.
- **Docs-only changes have no Playwright story.** Say so explicitly instead of skipping the
  verification step silently - "no source changed, so the applicable checks are the spec parse and
  the link check" is a verification result, not an omission.

