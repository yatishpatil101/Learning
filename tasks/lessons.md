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

