# Tasks

## Mobile-first Phase 1 — unblock content + lock the size budget (DONE)

Implements Phase 1 of `docs/roadmap/mobile-ux-review.md`. All changes are UI/config
only, behind no backend dependency — the service seam (`services/config.js`) means a
later `VITE_API_MODE=http` swap touches none of it.

- [x] **A6** `scripts/check-bundle-size.mjs` + `npm run check:size` — gzip gate on the
      critical path, read from `dist/index.html` (entry + modulepreload + stylesheet)
      rather than guessed by filename. Ratchet at 560 KB (measured 550.7), target 180.
- [x] **B1** Nestor coach-mark: suppressed below `lg` on conversion routes
      (`/property/`, `/list-property`, `/checkout`, `/schedule-visit`, `/signin`,
      `/signup`); dismissal moved sessionStorage → localStorage with a 2-sighting
      budget so it stops reappearing on every page load. Ref-guarded against the
      StrictMode double-invoke (the exact trap `design-system.md` documents).
- [x] **B2** `/list-property` hero collapsed below `sm` (badge + subtitle desktop-only,
      tighter margins) — the first form control is now above the fold at 360×640.
- [x] **B3** Autosave "Draft saved" toast moved out of inline JS into
      `.pn-autosave-flash`; z-index 2000 → 90 (in the documented ladder, just above the
      tab bar) and offset rebuilt from the bar's own tokens so it no longer sits on it.
      Ladder updated in `docs/system/design-system.md`.
- [x] Contact-page consent checkbox: `.tap-target` on the label (was an ~18px hit area
      on a consent control). Sign-in/sign-up were **false positives** — their labels
      already meet the floor; the audit measured the `<input>`, not its label.
- [x] New spec `e2e/tests/mobile-content-budget.spec.js` (6 tests, both mobile
      projects) + `e2e/COVERAGE.md` row.
- [x] Corrected two wrong estimates in the review doc after measuring: **A5** CSS split
      is worth ~10–20 KB gzip, not 60–100 (209 KB raw → 37.9 KB gzipped); **A1/A2**
      re-rated S → L/M once the import graph was traced.
- [x] Full `mobile` + `mobile-small` suite: **366 passed, 2 failed**. Both failures are
      `help-i18n-urls` (the Hindi/Marathi footer-link cases) and are **pre-existing** —
      proved by stashing every source change and re-running the spec, which failed
      identically. `locales/mr/chrome.json` was already modified before this work began.- [x] Verified after restore: lint 0 errors (402 pre-existing warnings), build exit 0,
      size gate exit 0 (550.7 / 560 KB), content-budget spec 6/6 on both projects.
- [x] Desktop (`chromium`) suite: **957 passed, 85 failed, 13 flaky**. Proven **not
      mine** by an A/B run: stashed all six source edits, ran the four worst-hit specs
      (`list-property-p3`, `society-community`, `flatmates-eligibility`,
      `flatmates-groups`) → **12 failed / 9 passed**; restored the edits, ran the same
      four → **12 failed / 9 passed**. Byte-identical result.

### Pre-existing desktop breakage — NOT addressed here, needs a decision
The branch carries substantial uncommitted work from an earlier session that this task
did not touch: `InstallPrompt.jsx`, `uiEvents.js`, `MobileSearchSheet.jsx`,
`VerifyModal.jsx`, `CityChrome.jsx`, `CityContext.jsx`, `propertyTypes.js`, `Reels.jsx`,
`reels.css`, and six `i18n/locales/**` files. The 85 desktop failures cluster almost
entirely in flatmates (~80 of them) plus `list-property-p3`, `society-community` and
`help-i18n-urls` — i.e. exactly those areas. Representative failure:
`list-property-p3` expects `[data-err="documents"]` and gets 0 elements.

Left alone deliberately: it is someone else's in-progress work, and "fixing" a red test
by editing unfamiliar half-finished code is how real work gets discarded. Flagged for
the owner to triage.

## Mobile-first Phase 3 — touch targets the sweep missed (DONE)

`mobile-tap-targets.spec.js` sweeps a fixed route list; every control below sat
outside it, which is how a 6px slider rail and an 8px carousel dot survived a suite
of 178 specs. Baseline was captured **before** any edit this time.

- [x] **C2** EMI sliders (`/emi-calculator`): rail hit area 6px → 32px, thumb 20px →
      28px under `pointer: coarse`. The rail is still *drawn* at 6px via
      `background-size` — a fat bar reads as a progress meter, not a slider. Required
      moving the fill gradient out of an inline `background:` shorthand (which resets
      background-size/position and outranks any stylesheet rule) into a `--emi-pct`
      custom property.
- [x] **C2** Budget/area value labels (`.rng-val` on `/listings`): 15x16 painted →
      44x44 hit area via a transparent `::before`, same trade as `.tap-extend`. The
      `.rng` *thumbs* already grew to 28px on touch — that part was already correct
      and documented; only the labels were missed.
- [x] **C3** `/plans` carousel dots: 8x8 → 24x44. Deliberately not 44x44 — three 44px
      dots either overlap (ambiguous taps, worse than small ones) or spread so far
      they stop reading as one indicator. 24px is the WCAG 2.5.8 AA floor and puts
      adjacent centres 32px apart.
- [x] **D2** Admin header icon buttons: `.tap-extend` + real `aria-label` on Open
      menu / Close menu / Log out. They had `title` only, which never surfaces on a
      phone — an icon-only control named only by `title` is unnamed.
- [x] **D3** The two `/admin` Latest-activity cards: added `min-w-0`. A grid item
      defaults to `min-width: auto`, so the track refused to shrink and the card ran
      14px past the viewport with its Review button clipped off screen. The inner rows
      were already built to truncate; they just never got the chance.
- [x] New spec `e2e/tests/mobile-touch-targets-p3.spec.js` (5 tests) + COVERAGE row.
- [x] Verified: lint 0 errors, build exit 0, size gate exit 0 (550.8 / 560 KB),
      new spec 5/5, regression set **59 passed / 1 failed**.
- [x] The 1 failure (`admin-rbac` → "Team & Access renders seeded members") is
      **pre-existing**: stashed only the two admin files I touched, re-ran, failed
      identically. Same `/admin/team` seeding issue as the wider desktop breakage below.

### Not done, and why
- **C4** (property gallery thumb strip, 22px wide): the honest fix is to drop the
  thumbs below `sm` and rely on swipe + the existing `1/6` counter, not to grow them.
  That is a gallery-interaction decision, not a sizing tweak — raised, not taken.
- **A7** (preload the LCP image): deferred with A1/A2. The hero URL is only known
  after JS runs, so a static `<link rel=preload>` in `index.html` cannot name it; doing
  this properly means emitting the preload from the route, which is Phase 2 work.

## Mobile-first Phase 4 (partial) — native-app affordances (DONE)

- [x] **E7 measured first, and it is NOT a defect.** Scrolled `/listings` to y=1400,
      opened a property, pressed Back → restored to exactly 1400 (max scroll 3739, so
      the position was real, not a clamp). The `navType !== 'POP'` guard in `App.jsx`
      already works. Review row corrected from "gap" to "verified". No code written.
- [x] **E5 — found a real bug the audit had missed.** On `/property/:id`, dismissing
      the OS share sheet rejects with `AbortError`, which fell into the clipboard
      `catch` and raised a "Couldn't copy link" error toast. The single most common
      outcome of tapping Share on a phone reported a failure for working correctly.
      Reels and Refer already handled `AbortError`; this surface did not. Fixed, and
      the fix is regression-proven (see below).
- [x] **E4** `lib/haptics.js` + wired to save-a-listing (`tick`) and wizard step
      advance (`step`). Suppressed by BOTH `prefers-reduced-motion` and the existing
      `pnAppPrefs.reduceMotion` toggle — deliberately **no new setting**, since a third
      switch is one more thing to find and could disagree with the two that exist.
      Imports `getAppPrefs` from `store/account.js`, not the `store.js` barrel, so a
      tick does not drag the whole store graph into every component.
- [x] New spec `e2e/tests/mobile-native-affordances.spec.js` (4 tests) + COVERAGE rows.
- [x] **Proved the new test actually catches the bug:** stashed only the share fix,
      re-ran the spec → **failed**; restored it → **passed**. A regression test that has
      never been seen to fail is decoration.
- [x] Verified: lint 0 errors, build exit 0, size gate exit 0 (550.8 / 560 KB),
      regression set across property / wizard / saved / reels / refer / settings +
      all three new mobile specs — **58 passed, 0 failed**.

### Honest limits of E4
- **iOS gets no haptics.** No WebKit browser implements `navigator.vibrate`, so every
  browser on iOS is a silent no-op. India is ~95% Android so this still reaches nearly
  the whole audience, but iOS needs the Capacitor Haptics plugin — it is not a web fix,
  and pretending otherwise would be worse than the gap.
- Only two interactions are wired. The review listed four; filter-apply and
  contact-reveal were left until the two shipped ones have been felt on a real device.
  Haptics are trivial to over-apply, and a phone that buzzes constantly is worse than
  one that never does.

### Still open from Phase 4
- **E5 (the other half):** extending `navigator.share` to society pages and flatmate
  posts. The bug fix was the urgent part; the extension is additive.
- **E1** (offline state) and **E3** (pull-to-refresh) remain deferred — both need real
  network failure and real latency to be testable, which means the backend.
- **E2** (skeletons): buildable now, but mock data resolves instantly so the timings
  cannot be tuned honestly until there is a real API.

## Mobile-first Phase 5 — unreachable control + unreadable safety badge (DONE)

Two defects that produce **no** console error, no layout shift and no horizontal
scrollbar, which is why 180 specs never noticed them.

- [x] **`/societies` Verified filter was unreachable on a phone.** Measured at
      x=364..481 on a 412px viewport — 69px past the edge, clipped by an ancestor so
      there was no page scroll to reach it and nothing looked broken. Same root cause
      as D3: two `flex-1` selects with the default `min-width: auto` refused to shrink
      ("Sort: Recommended" alone claimed 186px). `min-w-0` + `flex-wrap`. Re-measured:
      all three controls now end at 383 inside a 396 toolbar, no wrap needed.
- [x] **`.badge-seeker` "VERIFIED" raised 9px → 11px below `sm`** (`/flatmates`). This
      is the badge that tells someone whether the stranger they might share a flat
      with has passed an identity check — the one place in the audit where small text
      has a safety cost, not an aesthetic one. Verified 7 badges render at 11px with
      0 overflow past card or viewport at 360px.
- [x] Two new tests in `mobile-content-budget.spec.js` (now 10 tests, both projects).
- [x] **Both new tests proven to catch their bugs:** stashed the two fixes → both
      failed (`controls escaping a 412px viewport`, `VERIFIED badge font-size`);
      restored → both passed.
- [x] Verified: lint 0 errors, build exit 0, size gate exit 0 (550.8 / 560 KB),
      regression set **63 passed / 3 failed**; the 3 are `flatmates-filters` and are
      **pre-existing** (stashed both my files, re-ran, failed identically — same
      flatmates cluster as the wider desktop breakage documented above).

### A correction to my own audit
The review listed `.badge-verified` / `.badge-rera` as 9px trust badges needing a fix.
I raised them, then measured: they render **zero times on a phone** — they belong to
the desktop-only list-row card variant. The change was reverted. The audit had read
`text-[9px]` in source and assumed it reached mobile users. Source-grep is not
evidence of what renders; only measurement is.

### Deferred, with reasons
- **A1** (`db.json` off the entry chunk): `rawLoad()` is synchronous and called from
  dozens of sites, so a dynamic import means an async refactor of the whole mock
  layer — code that is deleted when the backend lands. Do the `VITE_API_MODE` gate
  instead, or nothing.
- **A2** (`societies-rera.js`): on the critical path via Home's societies rail, so it
  is a data-shape change rather than a config tweak.
- **Property price above the fold at 360×640**: measured at y=551 with the sticky CTA
  at y=505. Closing that needs ~90px, i.e. shrinking the hero gallery on a property
  site. That is a photo-vs-price product decision, not a bug — raised, not decided.

## PMF test overlay — public mockup deploy with demand capture (DONE)

Temporary, non-invasive overlay to test product-market fit before backend/company.
Everything gated behind `VITE_PMF_MODE` (off by default → dev flow untouched).
Stack: Netlify (host) + Netlify Forms (capture) + GA4 (analytics).

- [x] `src/lib/pmf.js` — flag read, `track()` (GA4), `captureLead()` (Netlify POST); no-ops when off.
- [x] `PreviewBanner.jsx` — one-line honest "early preview" banner (App-level).
- [x] `NotifyMe.jsx` — gate-free email/WhatsApp capture on Home (top-of-funnel signal).
- [x] Instrumented existing contact actions (ContactOwnerModal + ContactBox) + `view_listing` + `page_view`.
- [x] `index.html` — hidden Netlify `pmf-lead` form + widened CSP for GA4.
- [x] `netlify.toml` + `public/_redirects` (SPA fallback); `.env.example` documents the flags.
- [x] Verify: lint clean on touched files (0 errors); build passes flag-off AND flag-on; overlay artifacts present in flag-on dist; contact/property e2e (6 specs) green.
- Kept existing sign-in + Aadhaar contact gate as-is (user decision).
- Pre-existing (not mine): `src/components/Header.jsx` is a broken placeholder file → 1 lint parse error; unused/unimported, build unaffected. Flagged to user.
- PENDING (needs user credentials): create Netlify site + set `VITE_PMF_MODE=on` & `VITE_GA_ID`; deploy; share URL.

## OpenAPI as the single source of truth for API design (DONE)

Goal: make `backend/src/main/resources/static/openapi/punenest-api.yaml` the one
authoritative API design; remove duplicated API design from every other doc.

### Phase 1 - Make the OpenAPI solid
- [x] Canonical `Role` enum -> `[buyer, owner, staff, admin]`; align `Party.role -> [buyer, owner]`.
- [x] `Team` enum -> `[rental, legal, interior, packers, valuation]`.
- [x] `bearerAuth` description: JWT claims `sub, role, mobileVerified, aadhaarVerified` + staff `team`.
- [x] `info` block: version `1.0.0 -> 1.1.0`; declared spec as SSOT + changelog note.
- [x] Validate: YAML parses, 403 `$ref`s / 0 unresolved.

### Phase 2 - Remove duplicated API design
- [x] `docs/system/api-contract.md` -> gutted 25KB catalogue; now a ~2KB pointer stub.
- [x] `docs/system/cross-cutting.md` -> removed literal error/pagination/role JSON; point to spec.
- [x] All 27 `docs/flows/**` -> "Target API endpoints" lead-ins repointed to the OpenAPI spec.
- [x] `README.md`, `docs/README.md`, `docs/coverage-matrix.md` -> repointed to spec.
- [x] `docs/roadmap/build-roadmap.md` -> repointed refs + added "Spring Boot 4.1.0 / Java 21".
- [x] `docs/system/backend-api-architecture-review.md` -> role list `-> [buyer, owner, staff, admin]`;
      rewrote "API Catalog" from "maintained in two places to avoid drift" to single-source.
- [x] `docs/system/app-architecture.md`, `docs/system/domain-model.md`, `backend/README.md` -> repointed.

### Phase 3 - Verify
- [x] OpenAPI re-parsed: 403 refs / 0 unresolved; role/team/party enums correct.
- [x] Grep sweep: no endpoint tables / request-response JSON remain in `docs/system/*.md`.
- [x] Remaining `api-contract.md` references are all legitimate (pointer-stub self-refs +
      one flow prose note about a sample-value discrepancy).
- [x] Temp validation scripts removed.
- [ ] `mvn -q verify` -- BLOCKED (pre-existing, not caused by this work): local JDK is **17**,
      but backend `pom.xml` targets **Java 21** (`release version 21 not supported`). Docs/OpenAPI
      changes touched zero Java. To build the backend, install a JDK 21+ toolchain.

## Mature OpenAPI to cover all React needs (retire path for domain-model.md) (DONE)

Goal: verify `docs/system/domain-model.md` captures everything React needs, then extend the
OpenAPI spec to cover it entirely so domain-model.md can eventually be retired.

- [x] Deleted `docs/system/api-contract.md`, `_audit_openapi.py`, `_oapi_check.py`; repointed links.
- [x] Gap analysis (domain-model 33 entities vs OpenAPI vs React). Verdict: domain-model was more
      complete; flow docs already flagged the gaps as "missing but implied".
- [x] Phase A - Societies (`Society`/`SocietyDetail` + `/societies`, `/societies/{slug}`, follow),
      Reels (`Reel` + `/reels`), entity reviews (`Review.targetType` += society|owner,
      `/reviews/{entityType}/{entityId}`).
- [x] Phase B - Messaging: `Conversation`/`ConversationCreate` + `/messages` (list/start),
      `/messages/{id}` (thread/reply/read).
- [x] Phase C - Referrals+fraud (`Referral` + admin `/referrals`, approve/reject/clawback);
      enriched `AdminSettings` (site/fees/movePack/flags/permissions/customRoles), `User`
      (team/status/verified/city/counters), `Property` (views/enquiries/featured/verification flags/
      owner{}/adminPipeline{}).
- [x] Phase D - field closers: `Transaction.recurring`, `OwnershipBasis.currentValue`,
      `Offer.history[]`, `Ticket` (customer/mobile/value/service/notes[]), `Locality`
      (demand/avgRent/focus/lat/lng/active), `DocumentRequest.acknowledgedDisclaimer`,
      `SavedSearch`/`SavedSearchCreate` (filters/channel/newCount) + **fixed YAML `off` bool bug**
      (unquoted `off` -> `"off"`).
- [x] Phase E - parity verified: 138 paths, 107 schemas, 452 refs, 0 unresolved, 0 unused. All 33
      domain-model entities now map to a schema.

### Retire path for domain-model.md (DONE - user chose the ADR path)
- Created `docs/system/data-model.md` (ADR): entity->OpenAPI-schema map + the DB-only truth that a
  wire contract can't hold (ER overview, ID/timestamp/money/soft-delete conventions, mobile-key->FK
  migration, the 10 seed-vs-contract reconciliations, migration strategy).
- Repointed every `domain-model.md` reference across 33 docs + root `README.md` + the OpenAPI header
  to `data-model.md`; reworded doc-map descriptions ("canonical entities" -> "ER map + persistence
  design; field shapes -> OpenAPI schemas").
- Deleted `docs/system/domain-model.md`. Repo-wide grep: no dangling `domain-model.md` links
  (only an intentional "Supersedes" mention inside data-model.md).
- Open decision still pending: delete the 2 stale `VERIFICATION_*.md` QA reports (reference a
  deleted `HTML_APP_MIGRATION_SPEC.md`; nothing links them)? Defaulted to KEEP.

## Notes / follow-ups
- `AGENTS.md:57` still says "Spring Boot 3" (skill description). Left unedited: it is instruction
  config, not API design. Flag for the user if they want it corrected to Boot 4.
- Non-auth enums intentionally keep `user`/`tenant` tokens: moderation `targetType`
  `[property, user, review, post]` and content `audience` `[owner, tenant, buyer, agent]`.


## Platform & solution architecture (MVP pass) (DONE)

Iterative, one-question-at-a-time design in `docs/system/platform-architecture.md`.
Criteria every decision: Performance / Security / Cost / Ops simplicity. Founder constraint:
free-tier-first ($0 until real usage forces it). 16 ADRs ratified:

- [x] ADR-005 Platform/compute = Cloud Run (Mumbai) + managed Postgres + Cloudflare Pages/R2 + FCM
- [x] ADR-006 Rejected Firestore/BaaS core; FCM push only
- [x] ADR-007 DB = Supabase Postgres (Mumbai), pure Postgres, PgBouncer pooler; India residency
- [x] ADR-008 Session = httpOnly+Secure+SameSite cookies, short access JWT + rotating refresh + CSRF
- [x] ADR-009 KYC = paid aggregator Aadhaar OKYC/OTP behind KycClient seam (first paid prod dep)
- [x] ADR-010 Notifications = WhatsApp Cloud API + Brevo + Postgres in-app, transactional outbox
- [x] ADR-011 Jobs = Cloud Scheduler -> internal endpoint + warming ping + startup CPU boost
- [x] ADR-012 Search = PostgreSQL (indexes + FTS + pg_trgm + PostGIS) behind swap seam
- [x] ADR-013 Media = pre-signed direct-to-R2, split public/private buckets
- [x] ADR-014 Payments = Razorpay, fee-only at MVP (rent off-platform)
- [x] ADR-015 Cache/limits = defer Redis; CDN + Postgres + in-process + Cloudflare edge/Turnstile
- [x] ADR-016 Ops = Secret Manager + GitHub Actions + Cloud Logging/Monitoring/Sentry; DR pg_dump->R2

Diagrams added: system context, high-level (full), deployment, + sequences (OTP login, contact
gate/OKYC, scheduled alert/outbox). Open (non-blocking): A-Q2 MVP scale, A-Q4 team size.
Two unavoidable paid prod deps: SMS OTP (DLT/TRAI) + Aadhaar KYC; free in dev via seams.

## KYC identity model refinement (ADR-009a) (DONE)

Clarified the Aadhaar/KYC design in `docs/system/platform-architecture.md` (§6.4):
- [x] Two OTPs, two proofs: login OTP secures registration mobile (A); Aadhaar OKYC OTP proves genuine
      unique identity (B). Aadhaar OTP is mandatory for every gated user.
- [x] No "mobile -> identity" lookup exists; aggregator releases data only on Aadhaar/VID + OTP consent.
- [x] Uniqueness via entity-scoped **UID token** stored as UNIQUE dedup anchor; **never store raw Aadhaar**.
- [x] Mobile-match policy (Option 1): buyers soft-flag on A!=B (no block); owners posting a listing
      hard-require A==B (403 mobile_match_required).
- [x] `kyc_verification` schema: user_id, uid_token UNIQUE, verified, name, dob, gender, aadhaar_masked,
      mobile_match, source, verified_at.
- [x] Updated contact-gate sequence diagram; added ADR-009a; aggregator must expose a stable UID token.

## Payment gateway free-tier clarification (ADR-014 refined) (DONE)

- [x] Clarified: no India gateway has a "free usage tier"; all are ₹0 fixed cost + free sandbox +
      pay-per-successful-transaction (fits $0-until-revenue). Razorpay/Cashfree/PhonePe PG/PayU/Stripe.
- [x] Key nuance: zero-MDR (govt-mandated 0% on UPI/RuPay) zeroes only the network cost, NOT the
      aggregator's service fee -> UPI through Razorpay is typically NOT free.
- [x] GPay/PhonePe are payer-side UPI apps, not merchant integrations; you accept UPI, any app pays.
- [x] Two routes recorded: Route A aggregator (Razorpay, chosen MVP - webhooks/reconciliation worth the
      tiny fee); Route B direct UPI collection (QR/deep-link, near-0% but manual reconciliation, UPI-only)
      as a documented future cost-reduction path behind the PaymentClient seam.
- [x] Added payments row to §4.1 cost map; enriched §6.8 + ADR-014. Flag: confirm live per-txn rates.

## Production prerequisites & legal dependencies (India) (DONE)

Added §9 to `docs/system/platform-architecture.md`:
- [x] 9.1 Needs a registered entity: Payments (Razorpay), Aadhaar KYC aggregator, SMS OTP (DLT/TRAI),
      WhatsApp (Meta Business verification) + cross-cutting: money collection (current a/c, GST) & DPDP.
- [x] 9.2 Personal-signup OK: Cloud Run/GCP, Google Maps, Supabase, Cloudflare, FCM, email, Sentry/
      UptimeRobot/GitHub Actions, Upstash.
- [x] 9.3 Go-live sequencing: build on mocks now; incorporate; start DLT + Meta first (slowest);
      then gateway/KYC KYC; GST+DPDP; flip seams mock->real with no code change.
- [x] Flagged as engineering map, not legal advice (confirm GST/DPDP/entity type with a CA).
## Architecture diagrams completed (platform-architecture.md §5)
- [x] 5.3 Component Diagram - modular-monolith internals: cross-cutting filter chain, feature modules, provider seams -> Postgres/external.
- [x] 5.4 API Interaction Flow - request lifecycle through edge + CSRF/JWT/role/gate filters -> controller/service/repo, audit+outbox in-txn.
- [x] 5.5 Data Flow Diagram - PII residency (Mumbai DB), R2 public/private buckets, minimum-data-out to seams; raw Aadhaar never stored.
- All seven views (5.1-5.7) now drawn; status header + §5 intro updated.
## Legal entity & compliance advisory (DONE)
- [x] Created docs/system/legal-entity-and-compliance.md (Pvt Ltd recommendation, SPICe+ roadmap, compliance checklist, tax/funding, IP, MahaRERA/DPDP flags, 30-day plan)
- [x] Cross-linked from platform-architecture.md 9 and registered in docs/README.md

## Cashfree provider consolidation persisted (platform-architecture.md)
- [x] ADR-017 - Cashfree as primary vendor: Secure ID (DigiLocker KYC) + PG (fee collection); Payouts deferred behind PayoutClient seam; Razorpay = documented fallback.
- [x] ADR-018 - Cloud Run prod 2FA for Secure ID/Payouts = RSA public-key signature (X-Cf-Signature), not IP-whitelist (dynamic egress IP).
- [x] ADR-009 amended - Aadhaar is Cashfree DigiLocker-only (no standalone OTP OKYC product); webhook-driven, no GET /status.
- [x] ADR-009a revived - DigiLocker success webhook returns `mobile`, so owner hard mobile-match IS feasible; buyers soft-flag.
- [x] ADR-009b - dedup via composite identity_hash = SHA256(name|dob|gender|care_of|uid_last4) UNIQUE; never raw Aadhaar; 409 on duplicate; admin transfer for re-registration.
- [x] Rewrote 6.4 (KYC) and 6.8 (Payments); added 2 sequence diagrams (DigiLocker KYC, Cashfree PG); updated contact-gate diagram + data-flow labels + component inventory for coherence.
- [x] 9.4 added - pricing-verification checklist (skill has NO pricing): per-verify price, monthly floor, live MDR, instant-settlement fee, festive-0% applicability, TDS 194-O, payout fee.
- Verified: 11 mermaid blocks, 22 fences balanced; no stale uid_token/OKYC refs (ADR-014 marked superseded).
- PENDING (user): obtain written Cashfree quote before commercial sign-off of ADR-017.
## Feature/business-model reviews documented (docs/feature review/)
- [x] Created "docs/feature review/" folder with README index.
- [x] 01-business-model-kyc-thesis.md - skeptical VC review of "mandatory KYC everywhere" thesis for buy/rent; verdict PIVOT; incumbents keep spam because brokers=paying customers + liquidity>purity; includes scorecard, 3 failure/3 win scenarios, steel-man, implementation checklist.
- [x] 02-flatmates-market-and-feature-review.md - flatmate market sizing (Pune SAM ~600-900k, high churn every 8-14mo) + feature review; verdict WEDGE-lead-with-it; KYC becomes an asset here; GrabHouse=monetization graveyard; corridor GTM (Hinjewadi-Wakad-Baner), women-safety hook, move-in-services monetization, MVP scope trims.
- Both docs are advisory (for founder review + later implementation), each ends with a lift-into-todo checklist.
- Note: market numbers are reasoned estimates (informal market, no audited data) - flagged as assumptions in-doc.
## Trust model pivot: "verification as a badge, not a gate" (docs/system/trust-and-verification-model.md)
- [x] Reframed thesis: PuneNest = structured, trustworthy home for the market now living in Pune Facebook/Telegram groups (free, direct, broker-optional) minus their spam/staleness/no-trust.
- [x] Defined 4-tier Trust Ladder (L0 anon -> L1 mobile -> L2 DigiLocker badge -> L3 deal-verified).
- [x] "When to offer KYC" matrix for owner/buyer/broker: offer/nudge at intent, REQUIRE only at L3 (token/agreement).
- [x] Anti-spam WITHOUT gates: freshness "still available?" ping + auto-expiry (top priority), duplicate collapse, verified+fresh ranking boost, reputation signals, community reporting, masked-contact request/approve.
- [x] Business model: free discovery/posting; revenue at deal layer (agreement/e-stamp/token/escrow/KYC), verified boosts, broker subscriptions, ancillary.
- [x] Phased build: P0 50-owner validation gate -> P1 MVP (listings+search+freshness+direct contact) -> P2 badge/ranking -> P3 deal room+both-side KYC -> P4 scale.
- [x] Proposed ADR-019 (badge-not-gate) + amend ADR-009a (mobile-match soft at MVP, hard only at L3) + ADR-009b (identity_hash soft signal at MVP, hard UNIQUE deferred).
- [x] Persisted ADR-019 + amended ADR-009a/009b + A-Q5/A-Q15 + status header + 6.4 enforcement bullets in platform-architecture.md (fences balanced).
- [ ] PENDING: 4 open questions (freshness cadence, L1 contact-reveal vs chat-only, broker-lane timing, first 5 localities).
- [ ] NEXT GATE: Phase 0 - hand-recruit 50 real Pune owners/listings before any new backend code.
## OpenAPI badge-not-gate KYC update (ADR-009a/009b/017/018/019) - DONE
- Bumped punenest-api.yaml -> 1.2.0 with changelog note.
- /me/verification/aadhaar: POST now STARTS Cashfree DigiLocker consent flow (202 + verificationUrl, no Aadhaar number); GET returns opt-in badge. Added 409 aadhaar_already_registered (identity_hash dedup, badge-flow only).
- Added POST /webhooks/cashfree/digilocker (HMAC-verified provider callback; RSA-signed egress per ADR-018; carries mobile for soft mobile-match).
- /contacts/request: removed blanket 403 aadhaar_required; now L1 sign-in only (401 if unauth); 403 verification_required ONLY when owner opted "verified contact only".
- Schemas: replaced AadhaarSubmit -> KycStartRequest/KycStart; expanded AadhaarVerification (badge/status/source/mobileMatch); added DigilockerWebhook; ContactStatus requiresAadhaar -> verifiedContactOnly + verificationRequired; User gains verifiedContactOnly + reworded badge fields; AdminSettings aadhaarGateEnabled -> kycBadgeEnabled.
- Auth note + Forbidden example de-gated. Validated: openapi-spec-validator (OpenAPI 3.1) PASS; all $refs resolve.
- NOTE: security-reviewer not spawned (contract/doc change only; change reduces surface by removing raw-Aadhaar intake and documents webhook HMAC). Re-review at backend implementation.
## OpenAPI end-to-end functionality annotations (links/callbacks/externalDocs/examples) - DONE
- Added root externalDocs -> platform-architecture.md (explains docs carry the cross-call journey).
- components/links (6, reusable): GetCurrentUser, PollKycBadge, CheckContactStatus, CloseThisDeal, FinalizationStatus, RespondToOffer.
- components/callbacks (2, reusable): DigilockerVerificationResult, PaymentResult.
- New PaymentWebhook schema + POST /webhooks/cashfree/payment path (parallels DigiLocker webhook; HMAC-verified, idempotent on orderId).
- Flow-entry ops annotated (narrative description + externalDocs + links, callbacks where a provider calls back):
  login->getMe; submitAadhaar (callbacks + examples + poll link); requestContact (status link + 2 examples); reserveDeal->closeDeal; submitOffer->respondOffer; requestFinalization->finalizationStatus; payRent/subscribe/boostListing (PaymentResult callback + pending-state narrative).
- Scope note: applied only to genuine multi-step/stateful/async flows, NOT plain CRUD GETs (links there would be noise) - matches "do it for all [flows]".
- Validated: openapi-spec-validator (3.1) PASS; all $refs resolve; all 6 link operationId targets exist. paths=140, schemas=110, links=6, callbacks=2.
## React badge-not-gate — Page 1: List Property (DONE)
- Removed the Aadhaar posting gate: deleted useListingGate.js + AadhaarGate.jsx.
- useListProperty.js: dropped requireAadhaar() guard from submitProperty/submitFlatmate; removed gate hook, isAadhaarVerified import, logout.
- progress.js: removed AADHAAR_WEIGHT; meter now = listing-field completion only.
- ListProperty.jsx: always render the form (no gate branch/verified banner).
- Build: PASS. i18n listProperty.gate.* strings now orphaned -> deferred to Page 8 sweep.

## React badge-not-gate — Page 2: Property contact de-gate (DONE)
- contact.js: removed blanket aadhaar gate in requestContact(); now L1-only, returns 'verification_required' ONLY when owner opted into verified-contacts-only. Added isViewerVerified() + ownerVerifiedOnly() helpers (verifiedContactOnly owner pref).
- ContactBox.jsx: aadhaar_required -> verification_required branch.
- ContactOwnerModal.jsx: request() -> verification_required; sendEnquiry() de-gated to L1-only (removed isAadhaarVerified block); simplified verify state to bool.
- Owner.jsx: aadhaar_required -> verification_required, message reframed to Verified-badge.
- constants.js: CONTACT_STATUS.AADHAAR_REQUIRED -> VERIFICATION_REQUIRED (was unused).
- Owner verified-only TOGGLE (to SET the pref) comes on Page 4; defaults false so contact is ungated meanwhile. Build: PASS.

## React badge-not-gate — Page 2 FIX: property-page 'Contact Owner' chat gate (DONE)
- Root cause: the popup came from a THIRD gate I'd missed — the in-app CHAT path, not requestContact. useProperty.js handleContact() blocked chat on isAadhaarVerified() -> opened AadhaarVerifyModal.
- useProperty.js: removed the isAadhaarVerified gate from handleContact; dropped aadhaarOpen state, isAadhaarVerified import, and the aadhaarOpen/setAadhaarOpen exports.
- PropertyModals.jsx: removed dead AadhaarVerifyModal block + import + unused props.
- MapDetailPanel.jsx: same de-gate on contact(); removed aadhaarOpen state, keydown dep, modal block, and 2 unused imports.
- Chat/contact is now L1-only across property detail + map panel. Build: PASS.

## React badge-not-gate — Page 3: Verify modal -> opt-in DigiLocker badge (DONE)
- AadhaarVerifyModal.jsx: reframed gate->badge. Title 'Verify your identity to continue' -> 'Get your Verified badge'; aria-label updated.
- Default subtitle/note reframed to opt-in trust + DigiLocker (govt-backed Aadhaar consent); removed false 'only verified users can contact owners' gate copy.
- Kept mobile-match/mismatch (ADR-009a) but softened 'verify and continue' -> 'earn your Verified badge'. Submit btn 'Verify & continue' -> 'Verify & earn badge'. Rewrote doc comment to badge-not-gate.
- ContactBox.jsx + ContactOwnerModal.jsx: pass context subtitle 'This owner accepts verified contacts only...' so the opt-in modal explains WHY it appeared.
- Mechanism unchanged (mock OTP stands in for DigiLocker consent) — deeper redirect mock deferred. Build: PASS.

## React badge-not-gate — Page 4: Profile badge + owner verified-only toggle (DONE)
- ProfileTab.jsx identity card: 'Identity verification' -> 'Verified badge'; gate copy ('Verify once to contact owners directly') -> optional DigiLocker badge/trust copy; button 'Verify now' -> 'Get verified'.
- Modal subtitle it passes reframed to opt-in DigiLocker badge; success toast 'Identity verified' -> 'Verified badge earned'.
- Added owner 'Accept verified contacts only' Switch (verifiedContactOnly pref) in the owner section; retitled 'Owner phone privacy' -> 'Owner contact preferences'. Kept 'Keep my number private'.
- Verified wiring: store.js re-exports getOwnerPrefs/setOwnerPrefs from contact.js -> same pnOwnerPrefs:<mobile> key ownerVerifiedOnly() reads (Page 2). Toggle now END-TO-END drives the verification_required contact case. Build: PASS.

## Page 5 — Society community actions (badge-not-gate) — DONE
- Store layer (society.js, societyMod.js): removed all 9 'kyc' blocks + isAadhaarVerified imports.
- useSocietyHub.js: renamed requireKyc -> requireSignedIn (login-only, no Aadhaar wall); updated all call sites; removed dead === 'kyc' conditions/branches; removed aadhaarOpen state + pendingAction ref, isAadhaarVerified import, unused useRef import, ctx exports. Kept resident/committee orbidden guards intact per user decision.
- SocietyModals.jsx: removed dead AadhaarVerifyModal import, props, render block.
- Updated stale "KYC-gated" comments (society.js, society/constants.js, tabs/CommunityTab.jsx) to "sign-in only".
- Build PASS. Grep confirms zero lingering 'kyc'/isAadhaarVerified/aadhaarOpen/pendingAction in society files.
- User decision: KYC gates removed; resident-only actions held as-is.
## Page 6 — Admin Settings flag (badge-not-gate) — DONE
- Renamed feature flag adhaarVerification -> kycBadgeEnabled to match OpenAPI AdminSettings schema (ADR-019).
- AppFlagsPanel.jsx: label "Aadhaar verification" -> "Verified badge (DigiLocker)"; desc reframed from "Require owner identity verification" -> "Offer the opt-in DigiLocker Verified badge — a trust signal, not a posting or contact gate".
- Renamed the key in settings.json and data/db.json defaults.
- Flag is display/config only (not consumed to gate any flow) — no logic change needed.
- Build PASS. Grep confirms only the 3 expected kycBadgeEnabled refs, zero adhaarVerification left.
## Page 7 — Admin Users (badge-not-gate vocabulary) — DONE
- Finding: AdminUsers.jsx had NO "Aadhaar verified" wording — the erified flag already renders as a generic Verified badge (BadgeCheck icon). Contract confirms User.verified = the opt-in Verified badge (L2, ADR-019). No dedup/unique columns present.
- Change = vocabulary alignment only, matching SoT term "Verified badge":
  - Row action tooltip/label: "Verify user"/"Remove verification" -> "Grant Verified badge"/"Remove Verified badge".
  - Single verify toast/note/audit: "User verified"/"Verification removed" -> "Verified badge granted"/"Verified badge removed".
  - Bulk: confirm label "Verify N user(s)?" -> "Grant Verified badge to N user(s)?"; toast/note/audit reworded; toolbar button "Verify all" -> "Grant badge".
  - CSV export "Verified" column left as-is (clear data column).
- No logic change (verified toggle unchanged). Build PASS.
## Page 8 — Consistency sweep (badge-not-gate) — DONE
Live gates removed:
- Flatmates supply gate (useFlatmateSupply.jsx): requireAadhaar -> requireSignedIn (L1 sign-in only, matches List Property). Removed isAadhaarVerified import, aadhaarGateOpen state, pendingSupplyAction ref, return exports; updated comments.
- Flatmates.jsx: removed dead <AadhaarVerifyModal> supply-gate block, destructured props (aadhaarGateOpen/pendingSupplyAction/setAadhaarGateOpen), and now-unused AadhaarVerifyModal import (fixed an accidental dup import).
Stale copy/comment:
- society.js header comment reworded from "Only Aadhaar-OTP KYC-verified users can add" -> "Any signed-in (L1) user can add".
Orphaned i18n removed (en/hi/mr):
- list-property.json: entire gate block (~30 keys, dead since Page 1).
- flatmates.json: identityVerified, aadhaarGateSubtitle, aadhaarGateNote (dead after supply de-gate). All 6 files re-validated as parseable JSON.
- Build PASS. Final grep: zero live gate logic (requireAadhaar/aadhaar_required/if(!isAadhaarVerified)) remains in app.

FLAGGED for founder decision (intentionally NOT changed):
- OpsReferrals.jsx: referral payout still requires aadhaarVerified + aadhaarUnique. KEPT — this is anti-fraud at a MONEY moment (L3-like), legitimate under the model, not a participation gate. Recommend keep.
- Marketing trust copy still says "Aadhaar-verified owners": home.json trustAadhaar ("100% Aadhaar-verified owners"), home.testimonials.aadhaarVerifiedOwners, homeData.js verifiedOwners stat, Testimonials.jsx line ~67, ActivityTicker.jsx. Under badge-not-gate not all owners are verified, so "100%" may be inaccurate — but this is founder marketing positioning, not a gate. Left for user to reword.
- Dashboard profileCompletion() still counts the Verified badge toward profile % — a nudge, not a gate. Left as-is.

## Migration status: all 8 pages COMPLETE (build PASS each).
Pending: (a) react-reviewer + security-reviewer on gate-bearing pages (1,2,3,5,8); (b) flow-doc re-sync (docs/flows/**) AFTER user signs off all pages.
## Add second "Get verified" entry point — DONE
- User request: only one "Get verified" existed (Profile & Settings). Add a more visible one.
- Chosen spot (user-approved): Dashboard Overview tab — dedicated opt-in "Get your Verified badge" trust card.
- OverviewPanel.jsx: added self-contained card just below Action Center. Shows only when !isAadhaarVerified(); "Optional" pill; DigiLocker trust/ranking copy; "Get verified" btn opens the shared AadhaarVerifyModal (which persists the badge). Auto-hides after earning; toast "Verified badge earned". data-testids: verify-badge-cta, verify-badge-btn.
- Non-blocking, badge-not-gate aligned. Build PASS. toast prop confirmed passed from Dashboard.jsx.
## Make "ID not verified" chip clickable — DONE
- ProfileTab.jsx: PendingChip now renders as a <button> when an onClick is passed (keeps <span> otherwise for backward compat). Hover/focus states + title "Get your Verified badge".
- Header chip "ID not verified" wired to open the existing AadhaarVerifyModal (setAadhaarOpen(true)) — same flow as the "Get verified" card below it. Verified users still see the static "ID verified" VerifiedChip.
- Build PASS.
## KYC rework — native DigiLocker consent flow (DONE)
Reworked the shared `AadhaarVerifyModal` from the mock "enter Aadhaar mobile + our OTP" flow to
the ratified **native DigiLocker** model (SoT `platform-architecture.md` §5.6; ADR-009a/019).
Because this modal is the single KYC surface, the change updates **all 5 entry points at once**
(ContactBox, ContactOwnerModal, ProfileTab, OverviewPanel, TenantProfile).
- Modal is now an explainer + consent screen: **Why** (trust, ranking, optional), **How it works**
  (redirect to DigiLocker -> enter Aadhaar+OTP *on DigiLocker* -> approve one-time consent), and a
  **Privacy** panel (we receive name/DOB/gender/address/photo + last-4 only; never the full Aadhaar
  or OTP; DPDP consent, withdraw anytime). Single **"Continue with DigiLocker"** CTA.
- Mock simulates the redirect->consent->success round-trip (production returns a DigiLocker consent
  URL + webhook). Records the badge via enriched `setAadhaarVerified` (source=digilocker,
  maskedAadhaar, mobileMatch soft signal).
- Dropped the on-page OTP/MobileField/mismatch UI and the stale `note` prop (removed the OTP-worded
  `misc.tpKycModalNote` usage from TenantProfile; backward-compatible record keeps aadhaarMobile/at).
- `cd frontend; npm run build` -> PASS (13.72s). Files: components/auth/AadhaarVerifyModal.jsx
  (rewrite), lib/store/listings.js (setAadhaarVerified enrich), pages/consumer/TenantProfile.jsx.
## KYC growth levers — Phase 1 (React only) — DONE 2026-07-27
Badge-not-gate (ADR-019). All 5 verify entry points share ONE AadhaarVerifyModal; wiring the
growth mechanism into its success handler covers everything. Build green after each step.

- [x] kyc-mech: applyVerifiedBadgeToListings(mobile) in mockApi/properties.js — flips ownerVerified
      on all owner listings (+250 rank) + FIRST-time free 7-day Featured (featuredUntil, featuredReason
      ='first-verify', +1000 rank). isFeaturedActive() shared in lib/featured.js; ranking pipeline
      (listingsResultsPipeline.js) + featuredProperties() switched to isFeaturedActive so the free
      perk expires honestly while paid/owner-set featuring stays.
- [x] kyc-modal: AadhaarVerifyModal accepts source + subtitle props; fires trackKyc funnel events
      (badge_cta_impression/click, digilocker_start/success/fail, badge_earned); calls
      applyVerifiedBadgeToListings(signedMobile) on success; passes perk to onVerified.
- [x] kyc-c1: PostSuccessVerifyNudge wired into ListProperty.jsx success card (new, unverified posts
      only) — i18n via listProperty.verifyNudge.* (en/hi/mr, 6 keys each).
- [x] kyc-a1: VerifyListingsBanner (panel-level, dismissible) in MyListingsPanel — shown only when
      owner has >=1 property and is unverified. One badge lifts ALL listings. source='my_listings'.
- [x] kyc-d1: "Featured · free Nd left" chip in ListingCard when featuredReason==='first-verify' &&
      isFeaturedActive(l). Paid featured path untouched.
- [x] kyc-i18n: C1 keys present + parity across en/hi/mr. A1/D1 live in the English-only dashboard
      area (matches surrounding ListingCard/MyListingsPanel house style) — no i18n gap introduced.

Guardrails verified: nothing gates browse/post/contact; C1 fires only AFTER listing goes live;
A1 dismissible; D1 is a reward. No nudge precedes a value moment.
Data plumbing: perk writes to mock DB -> loadMyListings reads mock DB -> cards reflect badge + chip.

PENDING (deferred, not blocking): react-reviewer + security-reviewer pass on the KYC-touched files;
Playwright coverage for the new nudges/chip. Flow-diagram/doc updates intentionally SKIPPED per user
(will update manually).
## KYC growth levers — review + i18n hardening (2026-07-27)
- [x] react-reviewer + security-reviewer run on KYC/badge-not-gate + growth-lever React changes. Verdict: both APPROVE. 0 Critical, 0 High blocking the mock phase.
- [x] i18n: new erify namespace (en/hi/mr erify.json); localized AadhaarVerifyModal (WHY/HOW/PRIVACY via <Trans>), VerifyListingsBanner (C2 plural headline), OverviewPanel badge card, EnquiriesPanel "Serious Buyer" x2, ContactOwnerModal buyer nudge, all AadhaarVerifyModal caller subtitles + "badge earned" toasts.
- [x] security M-1: kycTrack.js now strips PII-looking keys (mobile/phone/aadhaar/otp/name/email/token/address/dob) from extra before console/localStorage.
- [x] Build green (exit 0); en/hi/mr verify.json validated.

### Deferred — enforce server-side when backend lands (tracked, acceptable for localStorage-mock phase)
- [ ] SEC H-1: pplyVerifiedBadgeToListings sets ownerVerified client-side (forgeable). Backend must own verified state; only a DigiLocker webhook may set erified=true; frontend reads only.
- [ ] SEC H-2: replace isSeriousBuyer(mobile) with backend enquirer.verified flag; stop deriving trust from phone numbers; update call sites in EnquiriesPanel.
- [ ] SEC M-2: backend erifiedStats should COUNT(DISTINCT owner_id), not mobile numbers.
- [ ] i18n (pre-existing, out of KYC scope): ProfileTab identity chips ("Mobile verified" / "ID verified" / "ID not verified" + PendingChip title tooltip) are still hardcoded — localize in a dedicated ProfileTab i18n pass.
- [ ] Verification: no Playwright coverage yet for the verify funnel (modal → DigiLocker mock → badge earned → listings update). Add e2e spec.
## e2e — KYC badge-not-gate migration + mojibake fix (2026-07-28)
- [x] Rewrote 4 obsolete gate specs -> badge-not-gate: list-property-no-gate, contact-badge-not-gate, flatmates-no-gate, flatmates-seeker-verify.
- [x] Fixed 3 society specs (community, community-v2, location) from 'kyc' block to L1-allow.
- [x] New kyc-growth-levers.spec.js (dashboard DigiLocker verify funnel). COVERAGE.md updated.
- [x] tenant-profile.spec.js:48 rewritten OTP -> DigiLocker badge earn. 6/6 pass.
- [x] map-panel-contact.spec.js test2 rewritten to badge-not-gate (owner has no verifiedContactOnly). Both tests pass.
- [x] Root-caused map/price failures: mojibake rupee (U+00E2 U+201A U+00B9) instead of the real sign in 7 specs (22 occurrences). App/map are correct. Repaired all; re-run 35/35 green, KYC set 44/44 green.
- [ ] PRE-EXISTING, NON-KYC (out of scope, flagged to user): qa-location-search (x13) + admin-* (x9) time out for a different (non-rupee) reason; predate this session (no source changed by e2e work). Not investigated per user scope decision.
- [ ] Cosmetic: residual mojibake (em-dash/ellipsis/apostrophe) remains only in comments + test titles of those 7 specs (no assertion impact); left as-is per tight scope.
## e2e full-suite green + flows re-sync (session cont.)
- [x] Whole chromium e2e suite triaged (was 41 fail). Fixed the "pre-existing non-KYC" cluster after all:
  - qa-location-search (x15): shownCount() grabbed hidden mobile dup of countLine -> scope to `main p:visible`.
  - admin-consolidation/post-on-behalf (dual-render strict-mode) -> scope to `getByRole('table')`.
  - admin-users: bulk button renamed "Verify all" -> "Grant badge" (KYC migration) -> updated 3 regexes.
  - admin-reports "table shows report data": rows.count() is a NON-retrying snapshot taken before async listReports() populated -> wait for first row, then count.
  - admin-duplicates + property-dup-modal: addInitScript wrote a PARTIAL puneNestDB_v5 (only listings) before boot -> app boots on a 1-of-25-collections DB -> white-screen crash -> selector timeouts. Fixed by seeding the listing AFTER boot (merge into the full default DB), keeping only non-DB keys in addInitScript.
  - Cookie-consent banner (fixed bottom-0 z-[1400]) intercepts bottom-of-page clicks + hides the Nestor FAB (max-sm:hidden) on mobile when consent unset -> seed pn_cookie_consent_v1 (established pattern) in auth-flow, flatmate-e2e, flatmates-interactions, assistant, photo-requests, property-dup-modal.
  - Dashboard sub-tabs migrated button -> role="tab" -> photo-requests + scheduled-visits use getByRole('tab').
  - feature-flags Map view + view-documents filenames: dual-render -> [title=...]:visible / .first().
  - search-property-types: test.slow() (6 sequential search flows starved under max parallel load).
- [x] Final: full chromium suite 911 passed; residual hard-fails are stochastic parallel-load browser crashes that each PASS in isolation (not app/test bugs). Verified no frontend/src edits (e2e-only).
- [x] PHASE 2 - Re-synced docs/flows/** (14 files) to ADR-019 badge-not-gate FROM current source. Core rewrite: contact-gate-leads.md (contact = L1 + owner-approval + masked number; opt-in DigiLocker badge; verification_required only when owner sets verifiedContactOnly). Kept legit gates: L3 deal-KYC (rent-agreement), referral reward uniqueness, society resident-of-unit verification. Residual grep = intentional negations only.
- [ ] FYI (source, out of docs scope): frontend/src/pages/consumer/list-property/submit.js ~L366 has a stale comment "Identity is guaranteed by the Aadhaar gate" - real floor is L1 sign-in. Flag for future source cleanup.


## 3-way sync: platform-architecture.md (SOT) -> OpenAPI -> React (DONE)
Precedence SOT > Swagger > React. Full cross-domain enum/shape audit; drift report + per-decision approval.

### OpenAPI (punenest-api.yaml) - DONE, YAML validated
- [x] PropertyStatus -> [pending, approved, rejected, flagged, archived]
- [x] Team enum + `loans`
- [x] ContactRequest.status granted->approved; ContactStatus reshaped to badge (dropped remainingUnlocks/unlocked, added status enum)
- [x] FinalizationRequest.status proposed->pending
- [x] Offer.status rejected->declined; OfferResponse.action reject->decline
- [x] Deal rename: intent Deal->DealIntent; aggregate Deal2->Deal with status [active,reserved,closed]
- [x] Enquiry marked deprecated
- [x] Visit.status canonical -> [scheduled, confirmed, completed, cancelled, no-show]

### React (frontend/src) - DONE for decided items
- [x] deals.js pendingOfferCount + buyer_counter -> countered (+ from)
- [x] DealPanel.jsx disambiguate countered by o.from (You/Buyer countered)
- [x] visits.js requested->scheduled (5x); ReviewsSection.jsx scheduled check
- [x] A7/A8 ops/ticket vocab: DOCUMENTED mapping only (mock-only, never hits wire)

### Docs - DONE
- [x] service-queues.md five->six teams (+loans)
- [x] data-model.md Deal2->Deal/DealIntent; added "Status vocabulary - UI<->wire mapping" section

### Verification
- [x] OpenAPI parses (yaml.safe_load OK); orphan scan clean
- [x] eslint changed files: 0 errors (pre-existing warnings only)
- [x] e2e deals-offers.spec.js + scheduled-visits.spec.js: 15 passed
- [x] e2e contact/tickets/admin-properties regression: passed
- [ ] PRE-EXISTING FAILURE (NOT caused by this task): e2e services-loans-team.spec.js
      fails at line 33 filling input[type="tel"] on /home-loans (form UI/harness issue).
      Not in my change set; the loans-team routing my A9 change touched is never reached.
      Flagged to user; needs separate investigation.

---

## Rename: "Share Flat" -> "Flatmates" (DONE)

Product-wide rename of the flat-sharing feature. Functionality unchanged; only names,
copy, files, routes and identifiers moved. Driven by a reviewed 119-entry replacement
map (session `files/rename-map.tsv`) - explicit tokens only, no blanket `share` ->
`flatmate` rule, so social sharing, document sharing, PG occupancy ("2-sharing"),
"your share of the rent" and society share certificates were deliberately left alone.

- [x] Route: `/flatmates` is now canonical; `/share-flat` kept as a permanent
      redirect (`App.jsx`). This is the only remaining occurrence of the old name.
- [x] Query param `?share=1` -> `?flatmate=1` on the list-property deep link.
- [x] Ops route `/ops/share-review` -> `/ops/flatmate-review`.
- [x] Files/folders renamed (52): `pages/consumer/shareflat/` -> `flatmates/`,
      `ShareFlat.jsx` -> `Flatmates.jsx`, `ShareFlatSection.jsx` ->
      `FlatmatesSection.jsx`, `lib/data/shareFlat.js` -> `flatmates.js`,
      `OpsShareReview.jsx` -> `OpsFlatmateReview.jsx`, `ShareMap`/`ShareMapGate`/
      `ShareAlertCard` -> `FlatmateMap`/`FlatmateMapGate`/`FlatmateAlertCard`,
      `useShareFlat`/`useShareSupply`/`useShareDiscovery` -> `useFlatmates`/
      `useFlatmateSupply`/`useFlatmateDiscovery`, i18n `shareflat.json` ->
      `flatmates.json` (x3), 21 e2e specs, 2 docs.
- [x] Identifiers: two request families disambiguated - seeker's own post is now
      `FlatmatePost*` (`getFlatmatePosts`, `saveFlatmatePost`, ...), the host's
      inbound queue is `FlatmateRequest*` (`getFlatmateRequests`,
      `decideFlatmateRequest`, ...). They previously differed only by the word "Flat".
- [x] localStorage keys `puneNestShare*` -> `puneNestFlatmate*`.
- [x] i18n root key `shareFlat` -> `flatmates`; copy translated in en, hi and mr
      (Devanagari product-name strings were rewritten too, not just the English).
- [x] Backend OpenAPI: `/share-flat/posts` -> `/flatmates/posts`, `ShareFlatPost`
      -> `FlatmatePost`, operationIds updated.
- [x] Docs re-synced (`docs/flows/consumer/flatmates.md`, feature review, data-model,
      coverage matrix, e2e COVERAGE.md).

### Deliberately NOT renamed (judgement calls - raise if you disagree)
- [ ] Natural verb/adjective copy that is not the product name: "your share of the
      rent", "shared flats", "Share your flat & split the rent", "Sharing this flat?",
      "Flatmate / Shared".
- [ ] Internal enum values still spelled `'share'`: notification `type: 'share'`,
      Saved-page `cat: 'share'`, the notifications filter key, and `linkCls('share')`.
      Renaming these would orphan already-persisted localStorage notifications and saved
      cards for zero user-visible gain.
- [ ] PG occupancy vocabulary ("2-sharing", "3-sharing", "Shared / common", "Alone").

### Known caveat
Renaming the localStorage keys means any data a user already had under
`puneNestShare*` is not read anymore. Acceptable for the mock/prototype data layer,
but worth a migration shim if this ships to real users.

---

## Mobile-only design improvements — Phase 2 (all remaining `mobile-design-review.md` items)

Scope: every §F roadmap item not already shipped in Phase 1. Same hard constraint —
desktop (≥`lg`, or ≥`sm` where the change is layout-shape) renders identically. Every
mobile rule is either inside a `max-width` / `hover: none` media query or paired with an
explicit `sm:`/`lg:` reset.

### Systems built (consumed everywhere, never hand-tuned)
- [x] **Overlays → bottom sheets below 640px.** One `@media (max-width: 639.98px)` block on the
      shared `.pn-modal-backdrop` / `.pn-modal` classes converts all 7 consumer overlays at once
      (ContactOwner, ScheduleVisit, AadhaarVerify, OwnerConsent, Report, ServiceTracker, Review)
      with zero markup changes: bottom-docked, full-bleed, `88dvh` cap, top-rounded, grab handle,
      `pnSheetUp` entry, safe-area bottom padding. Added to `prefers-reduced-motion`.
- [x] **`components/ui/Modal.jsx`** (23 importers) does the same via base classes + `sm:` resets,
      with a flex header/scroll-body/sticky-footer so the action row survives the keyboard.
- [x] **`.reveal-on-hover`** utility under `@media (hover: none)` — kills hover-only affordances
      on touch. Fine-pointer devices never match the query.
- [x] **`.lp-step-actions`** — `position: sticky` (not `fixed`) wizard action row under
      `@media (max-width: 1023.98px)`, docked to `--pn-bottom-inset`. Sticky keeps the row in
      flow so it reserves its own space and can never cover the last field.
- [x] **`lib/imgSrcSet.js`** — `srcSetFor()` rewrites the host's `w=` param into a srcset;
      returns `undefined` for any URL it can't prove is resizable, so it is a pure enhancement.

### Per-item
- [x] **F#4 tap targets → 44px.** `Card` heart/compare, `ResultsArea` filters + view toggles,
      `DealToggle`, `MobileFilterDrawer` close, `MobileField`, `ReviewsSection` chips,
      `DocumentsSection` consent, `Signup` terms, `Saved` remove, `LocationPricingStep` deposit
      quick-picks, `PriceInsights` EMI inputs, `PhotoUploader` delete, `MapGate` chips + inline
      links, smart-search inline icons. All `base + sm:` reset.
- [x] **F#5 wizard.** Sticky action row on all 6 steps; camera-capture "Take photo"; address
      `autoComplete` tokens (`address-line1..3`, `postal-code`, `organization`); owner-consent
      mobile → `type="tel"` + `autoComplete="tel-national"`.
      Scroll-to-first-error was **already implemented** (`list-property/validation.js`).
- [x] **F#9 listings filters.** Floating `Filters · N` pill in the thumb arc, docked to
      `--pn-bottom-inset`, `lg:hidden`. The old in-bar `filtersBtn` was `lg:hidden` too, so it
      was **deleted** — one control per width instead of two identical ones.
- [x] **F#12 gallery.** Full-bleed 4:3 mobile hero (`-mx-4 sm:mx-0`), arrows `hidden sm:flex`,
      tappable dot rail replacing the desktop thumbnail strip, `fetchPriority="high"` on the hero.
- [x] **F#13 responsive images.** `srcSet` + `sizes` on listing cards and featured cards.
- [x] **F#14 hover / `title=` sweep.** `CompareToggleBar`'s 4 icon-only controls had `title=` as
      their **only** label — invisible on touch; now `aria-label` (+ `aria-pressed` on toggles).
      Also `ResultsArea` view toggles, `ListingCard`, `InteriorRenovation`.
- [x] **F#16 Saved.** Horizontally-scrolling 3-tab strip (third tab off-screen with no
      affordance) → 3-up grid on phones, `sm:` restores the centred wrap.
- [x] **F#20 footer accordion.** Columns 2–4 collapse below 640px via a local `FooterCol`
      mirroring `ProfileTab`'s `CollapsibleCard`; `sm:block` panel + `sm:hidden` chevron.
- [x] **F#11 progressive disclosure** — verified **already satisfied**: `PropertyTabs.jsx`
      renders exactly one section at a time.

### Bug found by the new tests (not in the review)
- [x] The Nestor FAB (`.pn-assistant-slot`) **physically intercepted taps** on the new filters
      pill — both were bottom-right. Pill moved to bottom-left. A real user could not have
      opened filters on a phone.

### Deferred, with reasons
- [ ] **F#17 service worker** — manifest shipped in Phase 1; no SW. Listing freshness is the
      trust signal in a marketplace; cache-invalidation risk outweighs the offline win.
- [ ] **F#19 swipe-to-dismiss on sheets** — the grab handle is present and sheets close via
      backdrop/X. Touch-drag gesture handling is real state machinery for a P2 win.
- [ ] **F#22 CSS split** — `index.css` is large but bundled/minified; splitting is a build-level
      change with no mobile-visible effect.
- [ ] **F#23 mobile ops back-office** — explicitly out of scope.
- [ ] **F#24 landscape sweep** — needs a fourth Playwright project; no landscape-specific
      finding is currently open.

### Verification
- [x] `npm run build` green.
- [x] `npx eslint` on all changed files — **0 errors**, 6 warnings, all pre-existing.
- [x] New spec `e2e/tests/mobile-sheets-and-actions.spec.js` (sheets, filters pill, wizard
      sticky row, gallery hero + dot rail).
- [x] New desktop non-leak assertions in `desktop-noleak-guardrails.spec.js` — overlays stay
      centred dialogs, filters pill absent, wizard actions `static`, footer chevron hidden,
      gallery thumbnails visible / dot rail hidden, saved tabs `flex` not `grid`.
- [x] **`mobile` + `mobile-small`: 84/84 passed.**
- [x] `chromium` compared against the ~58-failure pre-existing baseline.

### Test-harness fixes made along the way
- `mobile-bottom-inset.spec.js` — `clear >= 0` → `> -1`. Measured value was **-0.140625**:
  fractional layout rounding, not an overlap. Documented in the assertion.
- Duplicate-link collision (the Phase-1 failure mode) recurred: the pill's accessible name
  collided with the in-bar Filters button in `mobile-space-optimization.spec.js`. Fixed at the
  root by removing the redundant control, not by loosening the locator.

---

## Home Phase 3 — Mobile: featured-first, search-on-demand (PLAN — awaiting approval)

Mobile-only. Desktop (>= lg) untouched. Builds on Phase 1 (`--pn-bottom-inset`, BottomNav)
and Phase 2 (sheet system, 44px ramp) — no new z-index values, no hand-tuned offsets.

### The measured problem (dev server, real DOM)

| viewport | first Featured card top | screens of scroll |
|---|---|---|
| 412x915  | y=1406 | 1.5 |
| 360x640  | y=1446 | 2.3 |
| 1440x900 | y=1292 | 1.4 (desktop — unchanged) |

Mobile hero budget above the 915px fold: h1 92, sub 170 (52h), trust chips 246 (110h),
search panel 386 (286h), map row ~672, chips ~720, stats 844 (52h), ticker, hero ends 990.
The search panel alone is 286px — 31% of the first screen. And `section.hero-bg` carries
`min-h-[100dvh]`, so even emptying it cannot shrink it below one full viewport. That
min-height is the actual blocker, not the content.

### Target mobile order

Hero (h1 + one-line inventory proof + search trigger)
-> **Featured properties**
-> Trust chips + stats
-> Browse by type (Categories)
-> Societies -> Recently viewed -> Flatmates -> WhyChooseUs -> ... (unchanged)

Projected first card top: ~400px on 412x915 — one full card plus part of a second visible
without scrolling. Desktop order stays Categories -> Featured.

### Work items

- [ ] **P0-1 Release the hero height.** `section.hero-bg` `min-h-[100dvh]` -> mobile auto,
      `lg:min-h-[100dvh]` restores desktop. Verify the decorative `.shape-*` layers and the
      bottom gradient still read correctly at the shorter height.
- [ ] **P0-2 Featured above Categories on mobile via CSS `order`.** Wrap the two sections in
      `flex flex-col`; `order-1`/`order-2` below lg, `lg:order-none`. DOM order is left
      untouched, so desktop DOM + visuals + every existing desktop spec are unaffected.
      Trade-off: on mobile the screen-reader order stays Categories->Featured while the
      visual order flips. One section's divergence — see Q6.
- [ ] **P0-3 Remove the inline search panel on mobile.** `HeroSearch` gets
      `hidden lg:block`... — decision pending Q1. It stays mounted for desktop; nothing about
      its internals, its `#hero-search-input`, its combobox a11y or its sticky "I'm done" bar
      changes. Every desktop spec that drives `.hero-search-wrap`
      (`home-entity-search`, `location-recovery`, `qa-location-search`,
      `search-property-types`, `home-search-combobox`) runs in the `chromium` project at
      1440 wide and is therefore unaffected.
- [ ] **P0-4 Search sheet + bottom-nav wiring.** Reuse the Phase 2 `ui/Modal.jsx` sheet
      variant; render `HeroSearch` inside it. BottomNav's Search slot on Home opens the
      sheet instead of focusing `#hero-search-input`; on every other route it keeps
      navigating to `/listings`. BottomNav lives outside the Home tree, so the trigger uses
      the codebase's existing cross-component channel — a `window` CustomEvent, same
      pattern as the `pn:store` badge bus — rather than a new context provider.
      `aria-current` on `/listings` is unchanged; the Home trigger gets `aria-expanded`.
- [ ] **P0-5 Relocate the trust chips + stats.** `.hero-trust` (4 chips) and `.hero-stats`
      (11,240+ / verified owners / localities) move below Featured on mobile, `lg:` restores
      them to the hero. Placement rationale: the "is this real?" objection fires *after* a
      user has seen listings, not before. WhyChooseUs already covers the same ground much
      further down — duplicating there would be weaker, not stronger.
- [ ] **P0-6 Keep the inventory count in the hero.** `p.hero-sub`'s "11,240+ verified
      properties" is inventory proof, not marketing — it stays, compressed to one line on
      mobile. (`city-propagation.spec.js` asserts on `p.hero-sub`; it must keep rendering.)
- [ ] **P1-7 Fix eager loading of the first Featured image.** `Featured.jsx:40` sets
      `loading="lazy"` on every card. Once card 1 is above the fold that is actively
      harmful — it delays the one image the 3-second rule depends on. First card ->
      `loading="eager"` + `fetchPriority="high"`, rest stay lazy.
- [ ] **P1-8 Trim the skeleton on mobile.** `featuredProperties(6)` renders 6 skeleton cards
      while loading. Above the fold that is a wall of grey. Show 2 on mobile, 6 at `sm:`.
- [ ] **P1-9 Move "Explore properties on map" + the popular/recent chip row into the search
      sheet** on mobile — they are query starters and a search modality, meaningless
      detached from the search context. `lg:` keeps them in the hero. See Q4.
- [ ] **P2-10 i18n** for any new label in `en`, `hi`, `mr`. 44px minimum on the search
      trigger and every new control.

### Verification
- [ ] Update `mobile-bottom-nav.spec.js:65` — "Search on Home focuses the hero search" is
      the exact behaviour being replaced; it becomes "opens the search sheet".
- [ ] New mobile assertions: first `.property-card` top < viewport height on 412x915 **and**
      360x640; `.hero-search-wrap` not visible on Home; sheet opens from the Search slot and
      still runs a real search; trust chips render below Featured.
- [ ] New desktop assertions in `desktop-noleak-guardrails.spec.js`: inline search panel
      present, Categories before Featured visually, chips in the hero, hero >= 100dvh.
- [ ] Run `mobile`, `mobile-small`, `chromium`. Baseline: 84/84 mobile green; ~58
      pre-existing `chromium` failures (`list-property-*`, map/geocode, `auth-*`) — flag
      only NEW ones.

### Open questions — need your call before I write code

- **Q1 (the big one). Does a slim search trigger stay in the hero?** Your ask was to remove
  the panel and reach search only from the bottom nav. My recommendation is to remove the
  286px *panel* but keep a single-row search *pill* (~56px, looks like a field, is a button)
  that opens the same sheet. Reason: a property site with no visible search box on home
  reads as broken to a first-time visitor, and the bottom-nav magnifier is an unlabelled
  second-guess. It costs ~56px of the ~546px we reclaim. **Pill (recommended) / bottom-nav
  only (your literal ask)?**
- **Q2. Trust chips destination** — directly below Featured (recommended), or folded into
  the existing WhyChooseUs section further down?
- **Q3. The `.hero-stats` trio** duplicates the count already in `hero-sub`. Drop it on
  mobile entirely, or move it down with the chips (recommended)?
- **Q4. Recent searches.** For a returning visitor the recent-search chips are a strong
  one-tap re-entry hook and cost ~50px. Move them into the sheet with everything else
  (simpler), or keep that row above the fold only when recent searches exist?
- **Q5. `ActivityTicker`** (live "someone just enquired in Baner" social proof, ~60px, end of
  the hero) — keep in the mobile hero, or move below Featured with the other proof?
- **Q6. `order` a11y trade-off.** P0-2 keeps DOM order and flips visual order on mobile, so
  the mobile screen-reader order stays Categories->Featured. The alternative is to reorder
  the DOM (Featured first, correct for mobile SR) and use `lg:order-*` to restore desktop
  visuals — but that changes the desktop DOM, which your constraint 1 discourages. I
  recommend keeping the DOM as-is. Confirm?
- **Q7. Does the sheet stay Home-only this phase?** Page-by-page discipline says yes.
  Promoting it to `ConsumerLayout` so Search opens a sheet on *every* route is a bigger,
  better change — but it is a separate phase.


---

# Mobile-only design improvements — Phase 3 (cross-cutting sweep)

Source: `mobile-design-review.md` §B/§D/§F, re-audited against the tree after Phase 2.
Several review rows were already satisfied and were struck rather than re-implemented:
F#21 (h-scroll arrows already hidden on `pointer: coarse`), §B row 55 (Categories already
has an `sm:hidden` "View All"), §B row 125 and J2 (`autoComplete` tokens already present).

Desktop evidence for every item lives in `e2e/tests/desktop-noleak-guardrails.spec.js`;
mobile evidence in `e2e/tests/mobile-phase3.spec.js` and `mobile-topbar-scroll.spec.js`.

## Wave H — finish the bottom-widget stack
- [x] `FinancesTab` "Add transaction" FAB docked to `--pn-bottom-inset` and moved to the
      left, out of the Nestor FAB's corner (it was at `z-40`, under the `z-70` tab bar).
- [x] `LegalPage` "Back to top" FAB docked the same way, via an arbitrary-value Tailwind
      class so the `lg:` reset can still win. Repo-wide sweep found no other offenders.
      `ToastContext` left alone deliberately — at `z-1600` it cannot be intercepted.

## Wave P — top navbar hide-on-scroll (user-approved)
- [x] Mirrored the bottom-inset system at the top: `--pn-nav-h` / `--pn-top-inset`, a
      `.pn-topbar` transform and a `.pn-nav-hidden` root class, all inside
      `@media (max-width: 1023.98px)` so the class is inert on desktop.
- [x] Five sticky sub-headers (`Property`, `Society`, `EnquiriesPanel`, `EmiCalculator`,
      `ResultsArea`) gained `.pn-docks-under-nav` and rise with the bar.

## Wave I — pickers and control sizing
- [x] `DatePickerDialog` / `TimePickerDialog` become bottom sheets below 640px; both
      `place()` helpers bail at that width and clear their inline anchor styles first.
- [x] Select/MultiSelect sheet conversion **rejected** in favour of ramping `--control-h`
      40px -> 44px on mobile: one line lifts all 12 consumers, including every dropdown
      option, which was the actual sub-minimum target.

## Wave J — forms and keyboards
- [x] `enterKeyHint` on `MobileField`, Signin, Signup, HeroSearch, flatmate search,
      Messages search and the chat composer. Not added to textareas, where Enter inserts
      a newline and "send" would lie.

## Wave K — auth
- [x] `.pn-auth-submit` pins the Signin/Signup submit below the `lg` breakpoint so the
      software keyboard cannot bury the primary action.

## Wave L — wizard
- [x] Mobile compaction of the (already sticky) `.lp-meter`: tier icon, encouragement line
      and milestone scale hidden, padding tightened, docked to `--pn-top-inset`.
- [ ] `l2` map-pin full-screen sheet — NOT STARTED. `LocationPicker` sits inside the
      `list-property-*` cluster that has ~36 pre-existing desktop failures, so a change
      there cannot be verified against a trustworthy baseline. Needs the baseline fixed first.
- [ ] `l3` autosave draft survival across a mobile tab eviction — NOT STARTED.

## Wave M — property owner card
- [x] Profile link, WhatsApp button and tenant-badge link all clear 44px on mobile and
      drop the sub-13px interactive type, with `sm:` resets restoring desktop.

## Wave Q — touch feedback
- [x] `-webkit-tap-highlight-color: transparent` plus an explicit `:active` opacity for
      interactive elements, inside `@media (hover: none)`.

## Wave R — drag to dismiss
- [x] New `frontend/src/lib/useSwipeDismiss.js`, consumed by the shared `Modal` sheet
      (drag down) and `MobileFilterDrawer` (drag left). Pointer capture is taken on the
      first qualifying move, never on pointerdown, so taps on controls inside still work.
- [ ] `n1` swipe-to-remove on Saved — DEFERRED. Destructive-by-gesture needs an undo
      affordance to be safe, and the existing remove button already does the job.

## Declined by the user
- Signed-out Saved empty state (keep the sign-in redirect).
- Dashboard mobile hub (finish cross-cutting work first).

## Verification
- `npm run build` green; `eslint` on all changed files: 0 errors.
- `mobile` + `mobile-small`: **112 passed, 4 skipped, 0 failed**.
- `chromium` full suite: 66 failed / 856 passed. The 11 failures outside the known
  `list-property-*` / map / `auth-*` clusters were re-run against a `git stash`ed clean
  tree and failed **identically**, so there are no new desktop regressions.
- `desktop-noleak-guardrails` + `feature-flags`: 40 passed, 4 skipped.

### Two real leaks the guardrails caught (and how they were resolved)
1. `.lp-meter` was already `position: sticky` at every width — my mobile block re-declared
   it, and the redundant declaration masked that fact. Removed; the mobile block now only
   compacts.
2. A desktop assertion on `-webkit-tap-highlight-color` was dropped: Chrome computes it as
   `rgba(0, 0, 0, 0)` by default on pointer devices, so it cannot distinguish "our rule
   applied" from "browser default". The `@media (hover: none)` bound is the real guarantee.

## Phase 4 — remaining `mobile-design-review.md` items

### §F #24 — Landscape phones + dynamic type ✅ DONE

- [x] **Root cause found by measurement, not by reading the review.** A rotated phone was
      spending **31–34% of its height on chrome** (measured on the running app: 128px of a
      412px viewport, 121px of a 360px one). The cause was *not* the bottom bar — the top
      navbar's height bump keys off `min-width: 768px`, and a landscape handset is ~915px
      wide, so it was being served the **72px desktop navbar on a 412px-tall screen**.
- [x] **Bar height moved off an inline style onto the token.** `BottomNav.jsx` had
      `const NAV_H = 56` applied as `style={{ height: NAV_H }}` on every slot. An inline
      style outranks any stylesheet, so shrinking `--pn-bottom-nav-h` would have shrunk the
      bar while leaving the tabs at 56px. Replaced with `.pn-bottom-nav__tab { height:
      var(--pn-bottom-nav-h) }` — the bar's height is now genuinely token-owned, which is
      what `--pn-bottom-inset` has always reserved against.
- [x] **Landscape block** `@media (orientation: landscape) and (max-height: 500px) and
      (max-width: 1023.98px)`: `--pn-nav-h: 52px`, `--pn-bottom-nav-h: 44px`, labels hidden
      (icon-only), raised FAB drops 56→44px so it stops overhanging a shorter bar.
- [x] **Navbar height and the docking token move together.** The navbar's real height is
      `h-16 md:h-[72px]` on an inner div; `--pn-nav-h` only tells sticky sub-headers where
      to dock. Changing one alone would have slid every sub-header *under* the navbar.
      Added a `pn-topbar__row` hook and set both. Needed a two-class selector
      (`.pn-topbar .pn-topbar__row`) — measured that a one-class rule beat `h-16` at 640px
      but *lost* to `md:h-[72px]` at 915px.
- [x] **Dynamic type.** The bottom-bar label was `text-[10px]`. A px font-size is immune to
      the browser/OS font setting — that reads as "safe" because nothing ever overflows,
      but it *is* the accessibility failure. Converted to `0.625rem` (identical at default)
      so it scales, plus `nowrap` + `text-overflow: ellipsis` so it degrades gracefully.
- [x] **Fixed a latent clipping bug the new test exposed.** `leading-none` (line-height: 1)
      is shorter than the font's ascent+descent, so all five labels clipped their glyph
      extents. Invisible at 10px, obvious at 20px. Now `line-height: 1.2`.

**Results (measured, before → after)**

| Viewport | Chrome before | Chrome after | Content gained |
|---|---|---|---|
| 915×412 landscape | 128px (31%) | 96px (23%) | +33px |
| 640×360 landscape | 121px (34%) | 96px (27%) | +25px |
| 412×915 portrait | 120px (13%) | **unchanged** | — |
| 1440×900 desktop | 72px | **unchanged** | — |
| 1024×768 tablet landscape | 72px | **unchanged** | — |

**Verification**
- `npm run build` green; eslint 0 errors (4 pre-existing `Navbar.jsx` warnings at 375/438).
- New `e2e/tests/mobile-landscape.spec.js` — 7 tests × 2 projects = **14 passed**.
- 4 new desktop guardrails in `desktop-noleak-guardrails.spec.js`, each proving one guard
  of the media query independently (short-desktop, landscape-tablet, 1440×900, bar absent).
- `mobile` + `mobile-small`: **124 passed, 0 failed**.
- `chromium` guardrails + feature-flags + bottom-nav: **44 passed, 0 failed**.

**Known limitation — needs a design decision (NOT a bug to silently fix)**
- [ ] At 200% font scale the **raised centre "Post" slot** cannot fit its 56px circle plus a
      24px label inside a 56px bar (needs ~74px), so that one label is squeezed. The other
      four tabs are clean. The fix is a design call — drop the redundant text under an
      already `aria-label`led FAB, the way Instagram/YouTube do — so it is left visible at
      default type and the spec documents the exemption rather than asserting a false pass.
      **Awaiting user decision.**

### §F #17 — PWA / service worker ✅ DONE (`vite-plugin-pwa` 1.3.0, devDependency)

Decision: use `vite-plugin-pwa` rather than a hand-rolled `sw.js` — it gives update
handling and precache revisioning that would otherwise be hand-maintained. Configured in
`frontend/vite.config.js` as a named `pwaPlugin()` alongside the existing `persistPlugin()`.

- [x] **Data is never cached.** `/api/*` is `NetworkOnly` and is the *first* runtime rule, so
      no later rule can claim it; `navigateFallbackDenylist` stops a navigation to `/api/*`
      being answered with `index.html`. Matched on `url.pathname`, not a regex over the
      whole URL — a bare `/^\/api\//` never matches `http://host/api/...` and would fail
      **open**. Also covers the dev-only `/api/__persist/` endpoint by the same prefix.
      **Proven, not assumed:** fetched `/api/__persist/probe_key`, then walked every Cache
      Storage entry — `leaked: false`.
- [x] **Established now, while it is cheap.** The app is still on mock data, so there is no
      data layer to cache wrongly yet. The `/api/*` boundary is written and tested *before*
      the real backend exists, so when it lands the correct behaviour is already in place.
- [x] **Selective precache, not all 7 MB.** `globPatterns` allowlists the initial load
      graph only (9 entries, 2.45 MB). Lazy route chunks are `CacheFirst` on first use —
      safe because Vite filenames are content-hashed, so a URL can never point at different
      bytes.
- [x] **Unsplash listing photography** `CacheFirst`, capped at 80 entries / 14 days so a
      long browsing session cannot fill the device storage quota.
- [x] **`manifest: false`** — `public/manifest.webmanifest` already existed and `index.html`
      already linked it. Generating a second one would create two sources of truth.
- [x] **`registerType: 'autoUpdate'`** — the shell must never lag the deployed API contract,
      and a reload loses nothing, so update silently rather than nagging.
- [x] **`orientation: portrait-primary` → `any`** (user decision). The lock would have made
      the landscape CSS dead code for installed users — exactly the audience the PWA targets.
- [x] **`devOptions.enabled: false`** — a worker on the dev server would serve stale chunks
      after an edit and make all ~900 specs nondeterministic. Verified empirically: dev
      reports `regs: 0, controlled: false, caches: []`.

**Measured against a production build (`npm run build && npm run preview`)**

| Check | Result |
|---|---|
| SW registers + controls page | ✅ scope `/`, active, controlled |
| Precache | 9 entries, 2.45 MB |
| `/api/*` in any cache | ✅ **never** |
| Offline reload after 1 visit | ✅ h1 + bottom nav render (4.4 kB text) |
| Offline deep link to an unvisited route | ⚠️ blank — chunk was never fetched |
| Dev server service workers | ✅ 0 registrations |

**Fixed along the way:** the first offline attempt rendered a *blank white screen* — worse
than a browser offline page, because it reads as "broken app". Traced with a request-failure
log (not guesswork) to three uncached chunks. `home-*` was an oversight; `vendor-charts` and
`vendor-jspdf` turned out to be **static** imports of the entry chunk.

**Verification:** build green · new `e2e/tests/mobile-pwa.spec.js` **10/10** (both mobile
projects) · full mobile suites **149 passed, 0 failed** · desktop guardrails + chart/PDF
consumers **75 passed, 0 failed**.

**Harness lesson:** a first run showed *16 failed / 9 flaky in 14.2 min*. Cause was three
orphaned Vite dev servers (one on port 3322) all polling the tree at 300 ms — not a
regression. After killing them: **149 passed / 0 failed in 3.8 min**. Check for orphaned
servers before believing a broad, scattered failure set.

- [ ] **NEW FINDING — bundle bug, not shipped as part of this.** The entry chunk *statically*
      imports `vendor-charts` (189 KB) and `vendor-jspdf` (382 KB) through
      `services/providers/mock/financeProvider.js → lib/data/finances.js → jspdf`, and both
      are `modulepreload`ed in `index.html`. **Every mobile visitor downloads 571 KB of
      charting and PDF code before the Home page paints.** Making that provider chain lazy
      would cut first-paint payload by ~571 KB and shrink the precache from 2.45 MB to
      ~1.9 MB. Not done here: it touches the services layer and needs its own verification
      pass against the ~58–66 failure desktop baseline. Tracked as `bundle-eager-vendors`.

## Bundle — eager vendor chunks (571 KB off first paint)

- [x] **Root cause was NOT the import chain alone.** Two distinct bugs, one shared mechanism:
  `manualChunks` left shared runtime modules unassigned, so Rollup folded them into a
  vendor chunk, which then dragged that whole chunk into the entry.
  - `react/jsx-runtime` -> `vendor-charts` (189 KB). The `vendor-react` rule matched
    `react-dom`/`react-router`/`scheduler` but **not plain `react`**.
  - `vite/preload-helper` -> `vendor-jspdf` (382 KB). Not under `node_modules`, so the
    `if (!id.includes('node_modules')) return;` guard skipped it entirely.
- [x] `frontend/vite.config.js` — pin both to `vendor-react`; match `react` via
  `/node_modules\/react\//` (precise, so `react-chartjs-2` is unaffected); chart rule kept
  before the react rule.
- [x] `frontend/src/lib/data/finances.js` — `exportStatementPDF` now `async` with
  `await import('jspdf')`. This module is in the eager graph via the mock provider registry
  (`import.meta.glob(..., { eager: true })`), so a static import put jsPDF in front of first paint.
- [x] `frontend/src/components/dashboard/FinancesTab.jsx` — `doExportPDF` awaits, so the
  "PDF downloaded" toast stays truthful.
- [x] PWA precache: dropped `vendor-charts-*` / `vendor-jspdf-*` from `globPatterns`
  (they are genuinely lazy now, so precaching them would cost a real 571 KB on install).

### Measured

| Metric | Before | After |
|---|---|---|
| Entry static imports | vendor-react, vendor-charts, vendor-jspdf | **vendor-react only** |
| `modulepreload` tags in `dist/index.html` | 3 | **1** |
| charts/jspdf requested on Home | yes | **none** |
| PWA precache | 2508 KB (9 entries) | **1938 KB (7 entries)** |

### Verification
- Traced with Rollup's real module graph (`getModuleInfo` importers), not grep. After the fix
  jspdf/chart.js/react-chartjs-2 all report "reachable dynamically only".
- Offline-after-one-visit still OK against a production preview (h1 renders, 170 KB HTML).
- chromium chart/PDF specs: 88 passed, 1 flaky, **1 failed**.
- mobile + mobile-small: 142 passed, 4 skipped, **0 failed**.
- desktop-noleak-guardrails + feature-flags: 48 passed.

### Pre-existing failure (proven, not absorbed)
`dashboard-owner-finances.spec.js:59` — `getByText(/days? overdue/)` not found. Proven
pre-existing by `git stash`-ing only the three changed files and re-running: identical
failure without the changes. Date-dependent due seeding; unrelated to this work.

### Known gap — PENDING VERIFICATION
No automated guard against this regressing. `manualChunks` only applies to `vite build`, so
it is invisible to the Playwright dev-server suites. Re-check manually after dependency or
chunking changes:
`cd frontend && npm run build` then confirm `dist/index.html` has exactly one
`modulepreload` (vendor-react).

### Phase 3 (Home: featured-first, search-on-demand) � SHIPPED

- [x] Hero `min-h-[100dvh]` -> `lg:min-h-[100dvh]` (the actual blocker)
- [x] `HeroSearchPanel.jsx` extracted � one source of truth for hero + sheet
- [x] `TrustProof.jsx` � chips/stats relocated below the Featured rail on mobile
- [x] `MobileSearchSheet.jsx` � full-height portal at z-1500, opened by bottom-nav Search via `pn:open-search`
- [x] Categories/Featured reordered with CSS `order` (DOM untouched, desktop identical)
- [x] First featured image eager + 2 skeletons on phones
- [x] `HeroSearch` gained `idPrefix` so the sheet copy cannot collide with the hero's ids
- [x] i18n `home.search.sheetTitle` / `closeSheet` in en/hi/mr

Measured first `.property-card` top: 412x915 1406 -> 436; 360x640 1446 -> 436; 1440x900 1292 -> 1292 (unchanged).

Verification: mobile + mobile-small full suite 148 passed / 1 fixed flake; chromium
`desktop-noleak-guardrails` + `home-search-combobox` + `home-entity-search` + `feature-flags` 55 passed.
Full chromium suite not re-run end-to-end (~23 min, ~58 known pre-existing failures) � the
specs that could plausibly regress from this change were run and are green.

## Home � mobile vertical rhythm (done)
- [x] Hero: marketing sentence swapped for the 4 proof chips below lg ( + "hidden lg:block" +  on  + "p.hero-sub" + ).
- [x] Chips redesigned as a borderless 2x2 checklist (tinted icon disc + short label), after
      pills-scatter and ruled-panel attempts were both rejected. New  + "*Short" +  i18n keys in en/hi/mr.
- [x] Featured subtitle hidden below lg (restates the rail beneath it).
- [x] Standardised the rhythm on two tokens, mobile-only (@media max-width 639.98px):
       + "--section-gap" +  2.5rem -> 1.75rem, new  + "--section-head-gap" +  1.25rem via  + ".section-head" + .
      Replaced four ad-hoc header margins (mb-3/6/8/10) across Categories, Societies,
      RecentlyViewed, Featured, Testimonials, WhyChooseUs, FaqSection; each keeps its exact
      desktop value as a paired  + "sm:mb-*" + .  + ".section-y-m" +  pulls FaqSection's hard-coded py-16 onto
      the token. Hero pb-12 -> pb-7, CTA/Flatmates inner gaps ramped with sm: resets.
- Verified: mobile + mobile-small full suite 151 passed / 1 flaky (pre-existing touch-feedback
  cluster) / 4 skipped. chromium desktop-noleak + city-propagation + home: 31 passed, 4 skipped,
  including a new guard that desktop header gaps stay varied at 12/24/32/40px and --section-gap
  stays 2.5rem. eslint clean.

## Fix � Flatmates section rendered raw i18n keys (done)
- [x] Renamed  + "home.shareFlat" +  ->  + "home.flatmates" +  and  + "lookingToShare" +  ->  + "lookingForFlatmate" +  in
      en/hi/mr  + "home.json" + ; refreshed the badge copy that still said "Share a Flat".
- [x] Added  + "
pm run check:i18n" +  static checker + a runtime raw-key guard on Home.
- Pre-existing: introduced by the flatmates rename, not by the mobile spacing work.

## Re-sync docs + OpenAPI to the flatmates redesign & mobile-first UI (DONE)

Docs-only pass. Zero source changes; `docs/flows/**` are documented FROM React source, so they were
re-derived from the current code rather than written to a target model.

### Audit (3 parallel read-only subagents)
- [x] `docs/system/design-system.md` vs `styles/index.css` + `components/ui/*`.
- [x] OpenAPI vs the whole flatmates domain (model/hooks/data/admin/ops).
- [x] Every other `docs/flows/**` doc vs its source.

### Consumer flows
- [x] `flows/consumer/flatmates.md` - rewritten. Three tabs (Flatmates/Rooms/Groups) -> two feeds
      `move-in` / `team-up` split by "is there an address yet?"; `PostChooser` single posting entry;
      `roomKind` / `priceBasis` / `occupancy` + the flat occupancy ledger; the owner flat-split;
      `ShareIntent` (solo/bring/match) on room enquiries; the Verified pill is now the shared
      DigiLocker badge (`AadhaarVerifyModal`), not a seeker OTP; alerts, reporting, raiseHint,
      cross-tab rescue, joint-agreement reissue, vacant-home disclosure.
- [x] `list-property-wizard.md` - `share=1` -> `flatmate=1` (and it does **not** preset
      `hostRole: 'tenant'`); success screen no longer always auto-navigates; per-step flatmate
      validation is two-tier; added the `PostSuccessSplitNudge` -> `splitFlat` section.
- [x] `dashboard-owner-hub.md` - panel inventory; the unified Requests inbox + `LeadSheet`;
      My Listings type filter and the "Let room by room" / "Stop letting room by room" controls.
- [x] `saved-alerts.md` - alert tabs `move-in`/`team-up` (+ legacy aliases), `normalizeTab` on
      "View matches", Saved category `share` -> `flatmates`, swipe-to-remove with undo.
- [x] `search-listings.md` - the "Discover flatmates" pill is gone (bottom-nav slot replaced it);
      mobile filter FAB; component list.
- [x] `property-detail.md` - component list + shared ReportModal adapter; the flat-share teaser
      (`/flatmates?startGroup=1&...`); mobile sticky CTA / docked tab rail.
- [x] `rent-agreement.md` - the joint-agreement reissue entry + a new 5.8; flagged that
      `useRentAgreement.js` reads only `invite`/`listing`, so `flat` + `reissue` are **inert today**.

### Admin / ops
- [x] NEW `flows/admin/flatmates-moderation.md` - `/admin/flatmates` had no doc at all. Records the
      honest gap: rooms (now the primary Move-in supply) live in localStorage and are invisible there.
- [x] `flows/ops/service-queues.md` - four queues, not three; `/ops/flatmate-review` route + no
      TeamRoute **and** no data narrowing; new 5.3 for the flatmate verification desk.
- [x] `flows/admin/trust-safety-reports.md` - intake is the shared `components/ReportModal.jsx` with
      per-surface reason sets; `REPORT_REASONS` in `lib/data/reports.js` is now an unused export.

### System docs
- [x] `system/design-system.md` - `--control-radius` is 10px not a pill; `--control-h` ramps to 44px
      below 640px; documented the 3-tier button system; added the whole mobile-first section
      (bottom/top chrome tokens, the four sheet shells, tap-target rules, hover-is-not-an-affordance,
      sticky action rows, floating-glass bottom nav, landscape height budget, safe areas, `dvh`,
      dual-render, rhythm/type, reduced motion, Devanagari, route-scoped CSS, primitives inventory).
- [x] `system/data-model.md` - flatmate entity -> schema map split into four rows.

### OpenAPI (1.2.0 -> 1.3.0)
- [x] `FlatmatePost`/`FlatmatePostCreate` -> `FlatmateSeekerPost`/`Create` (they modelled a room, the
      store holds a seeker requirement - semantically inverted).
- [x] New: `FlatmateTab`(+`Legacy`), `RoomKind`, `PriceBasis`, `Occupancy`, `HostRole`,
      `VerificationTier`, `ShareIntent`, `FlatmateMoveIn`, `FlatmateModStatus`, `FlatmateRoom`(+Create),
      `FlatmateGroup`(+Create), `AgreementDoc`, `FlatSplitRequest`/`Result`, `FlatmateInterestCreate`,
      `FlatmateRequest`, `FlatmateReview`, `FlatmateAlertCriteria`, `GroupApplication`, `HostEligibility`.
- [x] `SavedSearch`/`Create` gain `kind`/`criteria`/`label`/`mobile` + an `sms` channel;
      `Notification.type` documents the `share`/`listing`/`service` surface tags.
- [x] 28 new/changed operations: the tab-aware `/flatmates/feed`, seeker post CRUD, rooms + groups
      supply, seats/occupants/agreement-reissue, owner consent, interest/join, the host inbox
      (`/me/flatmate-requests`), the flat split under Listings, and the ops/admin moderation desks.
- [x] Validated: 161 paths / 133 schemas / 596 refs / **0 unresolved, 0 unused**, no YAML-1.1 boolean
      enums, no new duplicate operationIds.

### Index + link hygiene
- [x] `docs/README.md` + `docs/coverage-matrix.md`: 27 -> 28 flow docs (16 consumer, 10 admin, 2 ops).
- [x] Fixed 25 **pre-existing** dead links (`system/app-architecture.md`, `system/domain-model.md`,
      `system/api-contract.md`, `flows/_TEMPLATE.md` - all deleted in earlier sessions). Link check
      across `docs/**` is now 0 broken.

### Verification
- No source files changed, so no lint/build/Playwright run is applicable to this task. Checks run:
  OpenAPI parse + ref/unused/enum/opId audit, and a full relative-link check over `docs/**`.

### Findings handed back (source-side, NOT fixed here)
- [ ] `/services/rent-agreement?flat=&reissue=1` params are never read - the CTA opens a blank wizard.
- [ ] Room `share` intent is dropped by `addFlatmateRequest`; it survives only in the chat opener.
- [ ] `occupancyOf` collapses a stored `'filling'` to `occupied` (enum is `empty|occupied` at rest).
- [ ] `AdminFlatmates` reads `rawDb()` while the consumer flows write localStorage - rooms are
      invisible to admin moderation.
- [ ] Dead artefacts: `list-property/step1/FlatmateFields.jsx` (no importers),
      `listings/QuickFilters.jsx` (empty file), `REPORT_REASONS` in `lib/data/reports.js` (no importers).
- [ ] `useFlatmateDiscovery.jsx` "Unified sizing scale" comment claims `h-9`/`rounded-xl`; the next
      line emits `h-10`/`rounded-full`.
- [ ] Spec-wide: `openapi: 3.1.0` but ~23 uses of the 3.0-only `nullable` keyword (silently ignored
      in 3.1). Fix globally or drop to 3.0.3 - do not fix only the new schemas.


## Mobile gallery rail redesign (property detail) — DONE

Fixes the dead band under the phone hero: the dot strip and the "Request more photos"
dashed slab used to stack as two rows (~90px, mostly empty).

Attempt 1 (rejected by user): merged both onto one 44px line — dots left, request pill right.
Attempt 2 (shipped): the ask became the LAST SLIDE of the carousel; dots re-centred.

- [x] `Gallery.jsx` — `ask` local state renders a `[data-photo-ask]` panel over the hero
      (`absolute inset-0 z-20 bg-ink-2`, `sm:hidden`). Reached by swiping past the last photo
      or tapping the trailing dot; only a back-swipe leaves it (terminus, never wraps).
      Kept out of `active` on purpose — `active` also indexes the lightbox and the desktop
      thumbnails, where a `count`-th value would read `gallery[count]` as undefined.
- [x] Touch handlers moved from the `<img>` to the wrapper so the ask panel is swipeable too.
- [x] Dot rail: `justify-center`, 6 photo dots + a hollow ring dot for the ask. Each dot is a
      24x44 box (WCAG 2.5.8 AA, non-overlapping centres). Desktop still `sm:hidden`.
- [x] Gap fix (round 3): the rail's 44px touch box was stacking on top of the section's own
      `mb-6`, painting ~73px of dead air between the photo and the badges. `-mb-6 sm:mb-0`
      cancels one against the other -> 18px clear above and below the dot, symmetric, targets
      unchanged, and the two boxes meet exactly (no overlap, so the badges row can't swallow
      taps aimed at the bottom of a dot). Measured 73px -> 42px.
- [x] Removed the full-width dashed mobile button; desktop thumbnail tile untouched.
- [x] New i18n keys `property.requestPhotosShort` / `requestPhotosSlideTitle` / `requestPhotosSlideSub`
      in en/hi/mr. Side effect: the mobile control no longer collides with the desktop tile under
      `getByRole(/More photos/i)` (latent strict-mode ambiguity in `photo-requests.spec.js`).
- [x] Verified by probe at 430px: swipe-in / terminus / swipe-out / trailing-dot tap all correct,
      request toast fires. 39 passed across `property-detail`, `photo-requests`,
      `desktop-noleak-guardrails`, `dashboard-action-center`.
- [ ] PENDING AGENT REVIEW — `react-reviewer` / `code-reviewer` / `/simplify` not run (agents not
      available in this session).
- [ ] Pre-existing failure (NOT caused by this change; identical before and after): `photo-requests.spec.js`
      hardcodes `OWNER_MOBILE = '9530047855'`, but P5000's `ownerMobile` in
      `frontend/src/data/properties.json` is `9999047855`, so the localStorage assertion reads an
      empty key. One-line constant fix; flagged to the user, not changed unasked.

## Mobile-first Phase 6 — deferred-item sweep

Worked autonomously (user unavailable to answer the clarifying questions). Took the
recommended option on each item, and **declined the ones that are product-taste calls
or new features** rather than guessing at someone else's design intent.

- [x] **C4 was already done, and the audit mislabelled it.** The thumbnail strip is
      `hidden sm:block`; mobile already uses the dot rail built two rounds ago. What
      the audit measured as "22x44 thumbs" was that dot rail — and it *is* 2px under
      the 24px its own comment claims: `px-2` (8px a side) around a `w-1.5` (6px) dot
      = 22px. Fixed with `min-w-[24px]`, not more padding, because the active dot is
      `w-5` and a padding change cannot pin both states at once.
- [x] **A4 (partial): Outfit trimmed 7 weights → 5.** Grepped before cutting:
      `font-light`, `font-black`, `font-weight: 300|900` and inline `fontWeight` are
      **zero** uses, so 300 and 900 were pure download cost. The audit proposed
      cutting to 3 weights (400/600/800) — the evidence says 500 (16 uses) and 700
      (39 uses) are load-bearing, so that would have visibly flattened the type
      hierarchy. Cut only what is provably dead.
- [x] **D5 admin safe-area.** `<main>` had bare `p-4 sm:p-6`, so the last row of a
      queue sits under the home indicator on a notched phone — the row a field-ops
      user is actually reaching for. Routed through `--pn-safe-b` (verified declared
      on `:root`, so the admin tree inherits it); `env()` resolves to 0px off-device,
      so it is inert everywhere except an installed app on a notched phone.

### Declined, with reasons — these are decisions, not leftovers
- **Property price above the fold.** A real photo-vs-price product call (measured:
  price at y=551, sticky CTA at y=505; closing the gap costs ~90px of hero). Every
  option changes the visual hierarchy of the main money page. **Needs a human answer.**
- **E5 second half (share on society / flatmate).** There is no share control on those
  surfaces at all, so this is *new UI plus new strings in three languages* — a feature,
  not a deferred fix. Note for whoever picks it up: `share` in `RoomCard.jsx` means
  flat-sharing (roommates), not social share. Easy to conflate.
- **A3 English locale split.** Rejected after working it through, not skipped. The app
  merges every `en/*.json` into one `translation` namespace, so making part of it lazy
  lets components render before their strings land and paint **raw keys**. That is a
  visible regression on every route in exchange for ~35 KB gzip. Doing it safely needs
  a per-route loading gate — a bigger design than the review implied.
- **A1 / A2.** Unchanged: `rawLoad()` is synchronous across dozens of call sites, and
  `societies-rera.js` is on the critical path via Home's societies rail. Both are
  mock-layer code the backend deletes.
- **C1 blanket 12px floor.** The one badge with a *safety* cost (flatmates VERIFIED)
  is fixed. The rest is metadata — `10 min ago`, `₹9,786/sq.ft` — at 10–11px across
  ~40 files. Best driven test-first by the F3 sweep so each bump is justified by a
  failing assertion, not a blind 40-file diff.
- **A5 / A7 / D4 / E1 / E2 / E3 / E6.** Unchanged — see the review; E1/E3/E6 need the
  backend before they can be honest.

## Desktop e2e triage (2026-08-03)

Full chromium baseline: **84 failed / 2 flaky / 969 passed**. First established that
none of it is mine — stashed every tracked change and re-ran a four-spec sample at
HEAD: **identical 17 failures** with and without the mobile work.

Three root causes, not 84 separate bugs:

1. **The flatmates page was redesigned and the old specs were left behind.** It moved
   from three supply-shaped tabs (Flatmates / Rooms / Groups) to two intent tabs
   (Move in now / Team up) — rationale in `flatmates/model.js`. The old `?view=`
   values still resolve as *aliases*, so those specs kept loading a real page and
   asserting against the wrong tab. That is worse than a 404: it fails silently and
   looks like an app bug. ~40 failures. **The app is correct**; `flatmates-discovery.spec.js`
   is the current spec and passes, aliases included.
2. **A stale seed constant.** P5000's `ownerMobile` changed to `9999047855`, but five
   specs still carried `9530047855` and asserted on `puneNestContactReq:<old>` — a key
   nothing ever writes, so the symptom was a baffling empty array rather than "your
   constant is stale". ~13 failures.
3. **Strict-mode name collisions.** `Modal.jsx` labels its dismiss icon
   `aria-label={`Close ${title}`}`, so a loose `name: 'Close'` matches both it and the
   footer button. The a11y is *right* — a specific label beats a bare "Close" — the
   tests were loose. ~14 failures.

### Fixed
- [x] **Root cause 2 killed at the source.** Added `ownerMobileOf(id)` to `helpers/app.js`,
      which reads `frontend/src/data/properties.json` directly. Five specs now derive the
      number instead of copying it, so the next data change can't rot them. In
      `contact-owner-gate` the mask and formatted variants are derived too — verified
      against the real `maskPhone`/`fmtPhone` rather than trusting the old comment.
- [x] **Root cause 3:** tightened four locators in `admin-properties` with `{ exact: true }`
      and a note explaining the collision. Chose this over renaming the app's aria-labels,
      which would have made the icon button *less* descriptive for screen readers.
- [x] **`flatmates-filters.spec.js` rewritten** for the two-tab contract (Move-in on both,
      Sharing on Team up, Washroom on Move in now) and now drives the tabs through the UI
      instead of legacy deep links.
- [x] **`flatmates-smart-search.spec.js`:** the tab-count assertion used the removed
      "Flatmates, N available" label; now asserts the sighted and announced counts agree.
      Two hardcoded `toHaveCount(3)` became "narrowed but not to nothing" — the merge made
      it 4, and pinning any literal just re-arms the same trap for the next seed change.
- [x] Verified: **81 passed / 0 failed** across the six repaired specs, then **25 passed**
      across the three flatmates specs. Lint still 0 errors.

### Still stale — same root cause 1, group-flow specs RESOLVED

Eight of the nine rewritten (the group-creation family). Two further app changes
surfaced that the first pass had not seen — both found by probing the running app,
not by reading the specs:

- [x] **The three post buttons became one.** "Create a group", "List your room" and
      "Post your request" were replaced by a single **Post** button opening a chooser:
      "do you have a place?", then "just me or a group?". Added `postAsGroup`,
      `postHavingPlace` and `postAsSolo` to `helpers/app.js` — seven specs drove the
      old buttons directly, and inlining the new two-step walk seven times would just
      recreate the coupling. Every click is scoped to `.sf-modal`, because the seeker
      cards *behind* the overlay carry their own "Just me" control and an unscoped
      match resolved to four elements.
- [x] **A new group lands on the tab you are not looking at.** Creation returns you to
      Move in now, but an address-less group sorts into Team up (`tabOf()` in
      `flatmates/model.js`), so the card genuinely is not where the spec looked. Added
      `switchToTeamUp()` and placed it at each create/reload site.
- [x] **Two places where the blanket hop would have been WRONG**, caught by reading
      `tabOf()` rather than pattern-matching:
      - `flatmates-eligibility` "owner attaches a verified property" — attaching gives
        the group an address, so it sorts to **Move in now**. No hop.
      - `flatmates-guardrails` dedupe — the create is *blocked*, so the modal stays up
        and covers the tab strip. Cancel first, then hop.
- [x] Also fixed a test that was **passing for the wrong reason**: `flatmates-groups`
      asserted `toHaveCount(0)` after deleting a group, but did so on Move in now where
      the group was never listed — it would have passed whether the delete worked or not.
- [x] Verified: **55 passed / 0 failed** across all eleven flatmates specs.

### The last three specs (interactions / map-gate / prefreeze)
- [x] **`flatmates-interactions`** — same tab-visibility cause: a posted solo request
      creates a *seeker*, which lives on Team up, so the "Your live request" banner is
      never on the tab the spec landed on. Added the hop at all three sites. Its empty
      state CTA is also the unified `Post` now. The duplicate-post guard needed care:
      it lives in `openPostModal()`, reachable only via the chooser's
      "still looking → just me" branch, so clicking `Post` alone never triggers it.
- [x] **`flatmates-map-gate`** — `/Rooms available/` was a removed tab label; now
      switches via `Team up`, which is what "a new tab starts unfocused" means today.

### FLAGGED — a real layout regression, NOT a stale test — NOW FIXED
`flatmates-prefreeze.spec.js:87` asserts the first result card is above the fold on a
1440x820 laptop. It measured **y=881** against an 820px viewport, so a visitor landed
on a search page and saw no stock at all without scrolling. The test was doing its job.

**Root cause (measured, not guessed).** Walked every box above the first card. The
desktop advanced-filter grid is **308px** and sat permanently open (`hidden lg:grid`),
plus its `mt-4`: **324px** of controls between the visitor and the inventory. Mobile was
never affected — it puts the same controls in a drawer (measured y=669 of 915). Confirmed
via git that `FilterBar.jsx` matches HEAD, so this shipped with the flatmates redesign
(`5c075a9`), not with any of this session's work.

**Fix.** The desktop grid is now collapsible and starts collapsed — the same idea the
mobile drawer already used, with the room a wide viewport allows. The search box, tabs,
list/map toggle, sort and reset all stay on screen; only the advanced grid folds away,
behind a toggle carrying the existing active-filter count badge.

Rejected the alternative of trimming the hero: it is doing real work (badge, H1, trust
pills, two CTAs), ~60px was the most it could give, and that left only 19px of margin —
a longer Hindi or Marathi string would have silently reintroduced the bug.

- Measured **881 → 521** on 1440x820; mobile unchanged at 669.
- **Opens automatically when any filter is already active**, so a deep link like
  `?loc=Baner` never lands someone on a narrowed list with the reason hidden — that
  would be a worse bug than the scroll it saves. Verified: plain landing `aria-expanded=false`,
  `?loc=Baner` → `true` with a "1" badge.
- Updated the 7 filter specs that (correctly) failed once the panel closed, and added
  two new ones: the fold assertion, and the auto-open-when-active behaviour.


### Out of scope (agreed) — a ~30-failure unrelated tail
`society-community`, `society-community-v2`, `list-property-types`, `list-property-p3`,
`rent-agreement`, `admin-rbac`, `view-documents-flow`, `listing-freshness` and others.
All confirmed failing at HEAD too. Each needs individual diagnosis.



---

## Mobile review: B5 / C5 / D1 + CI (DONE) and B7 (blocked)

Worked the four items that were actionable without a backend, then stood up CI.

- [x] **B5 — z-index ladder now covers toasts, and the ladder is consistent.**
      The toast was already at 1600; what the audit missed is that the ladder was
      written down *twice* (`design-system.md` and the `:root` comment in
      `index.css`) and the two disagreed — the CSS copy was also missing the
      autosave flash at 90. Both now read
      `… blocking modals 1500 / toasts 1600`, with the reasoning for why toasts sit
      on top (a toast is a receipt for a user action, so it must outrank the surface
      that triggered it; hence `pointer-events: none` on the container).
      Swept every rung actually in use rather than trusting the item text, which
      found a *second* undocumented `z=2000`: the `/services/interior` lightbox,
      above the toast layer. Moved to the 1500 modal rung.
      The sweep also surfaced a whole upper band the ladder never described
      (`.pn-action-sheet`/`.pn-dropdown__menu--sheet` 9999, `.pn-cal` 2000, skip
      link 9999, maintenance overlay 99999). Documented as a table, including the
      honest note that an action sheet currently outranks toasts. **Not** restacked
      silently — that changes live tap/focus behaviour and needs its own pass.
- [x] **C5 — audited, no offenders remain.** Measured painted heights of every
      pill-shaped control at 360x640 across `/`, `/listings`, `/flatmates`,
      `/societies`, `/plans`, `/compare`, `/locality`, `/locality/:slug`.
      `--control-h` is 44px at that width and nothing lands under 40px except two
      deliberate `.tap-extend` controls (32px Back tile, 20px assistant Dismiss),
      both with a transparent 44px hit area. The 30–32px pills the audit saw were
      already fixed by the earlier control-token work.
- [x] **Genuine regression found while measuring** (not in the review): the
      Save-property heart on `/` Featured cards painted 36x36 with no hit
      extension and was failing `tap-targets.spec.js` on both mobile projects.
      Given `.tap-extend`, which keeps the 36px tile the card art is built around.
      Sweep went 2 flaky -> 24/24.
- [x] **D1 — field-ops route set defined.** `design-system.md` now opens the
      mobile-first section with which routes are mobile-supported: all consumer
      routes, plus `/ops` and its eight queues (enumerated from the router, not
      guessed) and `/admin/properties`. The other fifteen `/admin/*` routes are
      named as desk-only, with the bar they must still clear (usable, unclipped)
      separated from the one they need not (mobile polish).
- [ ] **B7 — blocked, needs a product call.** The density is real and measured:
      7 targets, 265px of painted control in a 360px row, 8px gaps, account pill
      ending at exactly x=360. But the item's escape hatch does not exist — the
      bottom nav is Reels/Search/Post/Flatmates/Services and has never held
      Saved/Notifications/Messages, and `acctItems()` carries a comment recording
      that those three were *deliberately removed* from the account drawer when
      they went inline. The top bar is currently their only route, so removing
      them would strand three destinations, not relocate them. Three options
      written up under the B7 row in the review; all seven targets already clear
      44px of hit area, so "accept the density" is a legitimate answer.

### CI (new — `.github/workflows/ci.yml`)

There was no `.github/` at all. Two jobs, split on purpose so a lint error is not
reported behind a browser install:

- `checks` — `npm ci`, lint, `check:i18n`, `check:help`, build, `check:size`.
  Each a named step so the failing gate is visible from the job list.
- `e2e` — matrix over `chromium` / `mobile` / `mobile-small`, Chromium only
  (all three projects are Chromium-based), report uploaded on `always()`.
  Playwright's own `webServer` starts the Vite dev server, so no manual step.

**`check:i18n` currently fails**, and CI will be red until it is fixed: 31
unresolved keys, all from two *untracked* files (`VerifyModal.jsx`,
`MobileSearchSheet.jsx`) belonging to in-flight work. The gate is correct; the
tree is dirty. Whoever owns those files needs to add the keys.

### Mobile suite after these changes: 322 passed, 1 flaky, 3 failed

None attributable to this work (my changes: `Featured.jsx`,
`InteriorRenovation.jsx`, an `index.css` comment, two docs):

- `phase3.spec.js` calendar docking (x2) — asserts on `.pn-cal`, which lives in
  `styles/components/date-time-fields.css`, an **untracked** new file from
  another session's in-flight work.
- `sheets-and-actions.spec.js` — "Close filters" width `43.99998474` vs a `>= 44`
  assertion. A sub-pixel rounding artifact, not a real undersized control; the
  assertion needs a tolerance.

## Home "Flatmates" tile — mobile optimisation (DONE)

Single file: `frontend/src/pages/consumer/home/FlatmatesSection.jsx`. CSS-class-only
change, no logic, no i18n, no new file.

- [x] Feature row (`Verified seekers` / `Women-only filter` / `No number sharing`)
      forced to **one line**: `flex-nowrap` + `whitespace-nowrap` + `shrink-0`,
      `text-xs` -> `text-[11px]` below `sm`, icons `w-4` -> `w-3.5`, gap `20px` -> `8px`.
      Measured: at 412px content == 340px == container width (exact fit, no scroll);
      at 360px it overflows 40px, so `overflow-x-auto no-scrollbar` + a
      `max-[399px]:` right-edge mask makes the cut intentional and swipeable.
      Fitting all three at 360 needs ~9.5px type, which is below a readable floor.
- [x] CTAs stacked full-width below `sm` (`w-full sm:w-auto`, `justify-center`,
      `py-3`), `hover:scale-105` scoped to `sm:` (no scale on touch).
- [x] Card padding `p-8` -> `p-5 sm:p-10`, radius `rounded-2xl sm:rounded-3xl`,
      body copy `text-sm` -> `text-[13px]`, tightened vertical rhythm.
- [x] Split-rent card: `p-6` -> `p-4 sm:p-7`, icon tile 44 -> 36, share price
      `text-2xl` -> `text-xl`, avatars 40 -> 32; `min-w-0` + `truncate` on the
      locality line and `shrink-0` on the arrow so the row never wraps or clips.
- [x] Verified: eslint 0, `npm run build` exit 0, no horizontal document overflow at
      412 or 360, `tests/consumer/home` 20 passed.

### Pre-existing failures (proven, not caused by this work)

Confirmed by `git stash push -- FlatmatesSection.jsx`, re-run, identical failure:

- `consumer/home/flatmates-rail.spec.js:18` — spec expects `/flatmates?view=flatmates`,
  the component has always navigated to `?view=team-up`. Spec and source disagree on
  the query param; needs a product decision on which is right.
- `consumer/home/entity-search.spec.js:84` — `page.goto` 30s timeout, part of the
  known `home-entity-search` / `qa-location-search` cluster already logged above.
