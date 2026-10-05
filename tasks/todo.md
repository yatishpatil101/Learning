# Worklog

> **A finished slice gets one index line here, not a narrative.** Git history is the archive; this
> file is the index into it. Open work gets a bullet, and the bullet is deleted the moment it is
> fixed or moves into a numbered ledger row. Do not restate a decision here — link to its number in
> [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md). Compressed 5,294 → 527 → 1,828 → 4,348 → 2,893
> → this.

Where things live:

| Topic | File |
|---|---|
| Open decisions and the damage-ordered work queue | [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md) |
| Durable rules learned the hard way, and house style | [tasks/lessons.md](lessons.md) |
| Tech debt | [docs/system/tech-debt.md](../docs/system/tech-debt.md) |
| Unanswered product questions | [docs/system/open-questions.md](../docs/system/open-questions.md) |
| The frontend data seam | [docs/system/frontend-data-seam.md](../docs/system/frontend-data-seam.md) |
| e2e coverage matrix (hard gate) | [e2e/COVERAGE.md](../e2e/COVERAGE.md) |

---

## In flight

- [x] **e2e redundancy sweep** (uncommitted, shared tree): executions 2,541 → 1,436 (live 2,484 → 1,391, no-backend 57 → 45). Hollow tests, verified duplicates and pure-logic loops removed, journeys merged with `test.step`, Pixel 7 trimmed to six viewport-sensitive specs. COVERAGE gate green. Full run: every failure left in a touched file was re-run from a baseline copy and fails there too. Pre-existing failures, not caused by the sweep: admin-dashboard, back-office-functions, live-team-access, rbac, staff-two-factor, command-palette, live-consolidation, user-restore-email-collision, ops/{identity-review,registration-check,live-ops-board,drafting-desk,flatmate-moderation}, live-admin-services, live-route-redirects-404 and the /ops tap-target sweep (uncommitted back-office slice); rent-agreement-{reuse,cofill} (RA IGR slice); referral-rewards Escape on mobile (one Escape closes both dialogs); trust-badges:235, my-properties-card:60, live-city-waitlist:23, sheet-scroll-lock:24. A coverage-proof pass restored about 65 lost assertions. Three new gap specs (`admin/{finance-states,live-services-desk,society-desk-states}`) close the 4 ⚠️ COVERAGE rows. `scheduled-visits` no longer uses `networkidle`, because the SSE stream never idles. Final `run-fast -Full` NOT yet run (paused by the user).
- [x] **backend JUnit redundancy sweep** (uncommitted, shared tree): methods 2,922 → 2,713, executions 3,144 → 3,079 (folds keep each case as a row), surefire time 199 → 171 s.
  - Context merges: Cashfree and finance-disclosure moved to `ApplicationContextRunner`; plain `@SpringBootTest` classes and the OTP-budget set now share contexts.
  - The baseline lost 35 tests to "too many clients" context boots; the run after the cleanup had 0.
  - Only failure: D120 `tenantPoliceProofsFollowPortalConditions`, which also failed in the baseline (RA IGR slice).
  - Two java-reviewer passes found no coverage loss.
  - Run on a private DB (`TEST_DB_URL=…/draazy_test_becl2`). The shared `draazy_test` had a V65 checksum mismatch; it has since been dropped and recreated empty, and Flyway rebuilds it to V90 cleanly.

- [x] **RA deposit payments (IGR portal)** (2026-10-04, uncommitted): Terms step `DepositPayments.jsx` — UPI / Internet Banking / DD-Cheque / Cash rows in `_state.terms.depositPayments`, required and must sum to the deposit when deposit > 0; server `DepositPaymentRules` (shape + sum, not presence); details guard checks a well-formed `ref` on a UPI / Internet Banking / DD row for a PAN only (a 12-digit UTR can pass the Aadhaar checksum). Review + ops `DeedParticulars` list them (ops card flags rows that no longer add up after a deposit amendment). Backend targeted 32/0; no-backend RA specs 37/0. PENDING e2e (live): rent-agreement-submit/-cofill/-reuse — shard DBs refuse to boot on a V90 checksum mismatch (back-office slice edited V90 after it was applied), not this change.
- [x] **RA IGR L&L 2.0 field parity** (2026-10-04, uncommitted): gap vs the IGR user manual + tutorial video. Property `IgrPropertyFields.jsx` (taluka, village/city required; road, police station, attribute rows, gallery area) + terms parking area → `PropertyIgrRules`; party mother's name + DOB (required, sets age) + alias → `PartyIdentityRules`; per-tenant `TenantPoliceRecord.jsx` (`tenants[i].police`: permanent/previous address + proof types, workplace, family rows) → `TenantPoliceRecordRules`. All three server classes tolerate absent fields. Backend targeted 46/0; no-backend RA specs 43/0. PENDING e2e (live): submit/cofill/reuse/vault, same V90 blocker. Not collected (portal-side / ops): place of execution, address-proof & work-proof PDF uploads, presenter/challan party.
- [ ] users.team column unused after functions migration — drop later.
- [x] **Deploy gaps** (2026-10-05, uncommitted): sandbox `APP_BASE_URL`; `BOOTSTRAP_ADMIN_*` wired through deploy.yml (email/mobile as env secrets); `AdminBootstrap` recovery adopts the email-less admin by configured mobile (seeded `9000000000`); bootstrap-project.sh lists the 3 new secrets + Pages `ORIGIN_SHARED_SECRET`; swapped deploy.yml permission comments. AdminBootstrapTest 9/0. Push needs no deploy wiring until a real `PushSender` exists. Open: PAN/Aadhaar numbers vs card copies for RA — decide before dropping `IDENTITY_ENCRYPTION_KEY`.
- [ ] Back-office follow-ups (from 2026-10-05 security/React review): staff/managers can't read `adminFlags.tab` (`GET /admin/settings` is admin-only), so admin-disabled tabs still show for them — atoms still gate access; expose tab flags on a staff-readable route if it matters. Managers ignore `desk:*` narrowing (always all desks). Managers receive the invite URL for staff they create (by design, no sender seam).
- [ ] Drop the unused `rent_agreement_tenant_consents` table (tenant OTP retired) — new migration plus ErasureService/ErasureRetention cleanup.
- [x] **Staff portal on /staff + Properties tabs** (2026-10-04, uncommitted): back-office route table mounted at `/admin/*` and `/staff/*` (`BACK_OFFICE_ROUTES` in App.jsx); `BackOffice` gate sends staff to `/staff`, manager/admin to `/admin` (`portalBase`/`portalPath` in adminModules.js); logo label shows the role. Properties shows every tab to `properties:read` holders; moderation actions (incl. duplicate merge/dismiss) stay gated on `properties:moderate`. Lint/build/routes/cycle/i18n green. PENDING e2e (user runs): specs asserting `/admin/...` URLs for staff now see `/staff/...`.
- [x] **RA case modal sectioned** (2026-10-04, uncommitted): `rent-agreement/CaseParticulars.jsx` — Papers summary over horizontal tabs (Licensor / Licensee / Witnesses / ID numbers / Property / Terms / Other files, party tabs show verified/total); each party card holds its own papers (Open / Verify / Reject), ownership proof sits under Property, earlier copies + draft/final under Other files. `DocumentChecklist` split into `usePaperReview`/`PaperRow`/`PapersNotice`; `DeedParticulars` now exports `deedGroups`/`Fields`. registration-check spec selectors updated; PENDING e2e (user runs).
- [x] **Per-service desks + Rent Agreement desk revamp** (2026-10-05, uncommitted): one sidebar page per held service (`/admin/rent-agreement|legal|home-loans|interior|packers|valuation`, `desk:<x>` gated; `/admin/services` admin/manager only; `/ops|/admin/drafting-desk?type=` redirect). Rent Agreement = KYC-style queue (tabs To pick up/My cases/In progress/With customer/Closed with `GET /service-requests/queue-summary` counts, Overdue chip) + case modal (stage bar, next step, parties/terms, papers, draft approvals, rail actions). Backend: csv `status`, `mine`, `assignedToMe`, queue-summary; `desk:loans` also grants `tickets:read|write` (Home Loans is a ticket board); targeted 98/0 + 64/0. React review fixes applied (identity panel remounts on close/takeover, 60s auto-refresh, stacked-dialog focus in `useModalDialog`). Build/lint/route/i18n/help green. PENDING e2e (user runs): ops/drafting-desk (incl. RA desk), ops/registration-check, mobile/ops-field, admin/back-office-functions, ops/live-ops-board.
- [x] **Rent agreement pay-before-submit** (2026-10-05, uncommitted): a direct-owner review reads "Pay ₹X & Submit"; unpaid requests show "Unpaid · not submitted" and stay out of staff queues until the signed webhook (unchanged server gate). Tenant OTP consent removed (frontend modal, backend gate/controller/service/WhatsApp template; table kept). `/me` returns `desks`; desk labels superseded by the per-service desks line below. Local `@LocalOnly` `POST /service-requests/{id}/payment/simulate` plus a DEV confirm after mock checkout. Backend targeted 296/0. PENDING e2e (user runs): rent-agreement-submit/-reuse/rent-agreement, ops/drafting-desk, registration-check, mobile/ops-field, admin/back-office-functions.
- [x] **Back-office functions** (2026-10-05, uncommitted): staff hold grantable functions (V90 converts stored atoms; admin never narrowed, 422; staff with no document = dashboard only); shared `/admin` shell filtered by atom, `/ops/*` redirects; AdminTeam function checklist; manager-only Team Performance (`GET /admin/team-performance`). Security review fixed: V90 never widens (a function needs all its old atoms; backfill skips `kyc`), manager reset-2FA/reissue capped by its functions, atom checks added on support tickets, referrals, listing archive, society removals, ID-number reads. Backend suite 3105/0 (too-many-clients errors green in isolation). Need-to-know follow-up: `analytics` function (`analytics:read` guards Analytics, scorecard, SLA, pricing, supply gap, city waitlist; never backfilled) and staff "My work" dashboard (`GET /admin/my-work`, own counts + own functions' queues). PENDING e2e: `e2e/tests/admin/back-office-functions.spec.js` + `-Full` (user runs manually).

- [x] **Photo card copies + immutable CDN** (2026-10-04, uncommitted): `PhotoVariants` stores `.w960.jpg`/`.w480.jpg` beside each upload before the original; cards use `cardSrcSet`; R2 `storePublic` sets `public, max-age=31536000, immutable`; SW `dz-images` caches the copies only (cross-cutting.md §9, DEPLOY.md §3.2). PENDING VERIFICATION on R2: the header on a real upload, and the Cloudflare Cache Rule for extensionless originals. Follow-up if prod already holds photos: backfill copies (until then `PropertyImage` falls back to the original after one 404). Pre-existing, not this change: `goto('/dashboard#…', networkidle)` times out in `my-properties-card.spec.js:60`, `scheduled-visits.spec.js:99/122/214` and `my-rental.spec.js:6` because the uncommitted `ConversationContext` SSE `/messages/stream` keeps a request open — replace those waits with locator waits.
- [x] **Free public-read cache** (2026-10-04, uncommitted): `PublicReadCacheFilter` (30s memory + `max-age`/ETag/304) on 12 caller-invariant reference GETs; Pages proxy stores the same in the Cloudflare Cache API; signed-in reads bypass via `cache: 'no-cache'` (http.js); bespoke counts cache removed; build stamp omitted on these reads. Anonymous staleness ≤ 60s by design (cross-cutting.md §9). Test/e2e TTL is `0s`, so e2e cannot see the cache — PENDING VERIFICATION on a deployed Pages host (repeat anonymous `/api/flags` should not reach Cloud Run). Private test DB: `draazy_test_cachework` (dropped). Backend suite 2564/0 (too-many-clients errors green on rerun); targeted e2e 64/64 (app-update:85 flaked once, green on rerun); code review clean.

- [x] **Back-office hierarchy** (2026-10-04, uncommitted): single admin via bootstrap/recovery; real manager role below admin and above staff; Team create/reissue returns one-time staff-invite links with no sender seam; manager staff actions notify the admin. Backend/frontend targeted green in phases 1–2; phase 3 validation pending in this session. `-Full` e2e not run here. Pre-existing, other lane: `referral-rewards.spec.js:95 [mobile]` contact-owner dialog never opens.

- [x] **Unused API removal** (2026-10-03, uncommitted): 41 operations removed (locality admin + `GET /localities/{slug}`, reels, service catalog/orders, owner KYC, society leads, admin conversations, `POST /visit-requests`, public announcements/banners/services, `GET /admin/analytics`, flatmate list GETs + `/properties/{id}/rooms` + post interests, `GET /tenancies`, `GET /tenant-profiles/{mobile}`, boost purchase, unread/pending counts, deal party add/remove, message/support attachment uploads, outreach `/sent`, note PATCH); spec pruned to 400 ops, `IMPLEMENTED_FLOOR` 218; tables kept, no migration. Follow-ups: boost settlement/sweep dormant (no purchase path); CMS announcements/banners/services are admin-write-only with no public read; message attachments read-only legacy; a click-to-chat claim link can no longer be marked sent; staff-invite redeem UI and admin erasure UI still missing. Backend suite: 0 failures (errors were DB "too many clients", green on targeted rerun). e2e flatmate specs moved to `/flatmates/feed`; touched specs green except pre-existing trust-badges "pulling the listing" (other lane). Code review done; PENDING full `-Full` run before commit. Private test DB: `draazy_test_apiclean`.
- [x] **Boost feature removed** (uncommitted): `billing/boost` package, `boosted` on listing DTOs, Promoted badge, finance `featured` band/ledger kind, `boostEnabled` flag, plan copy and seeds; V83 drops `boosts`, `boost_packs`, `properties.boosted_until`. Newest sort = createdAt desc. Follow-ups: `featuredListing` fee + `paidFeaturedListings` flag have no consumer UI (likely dead); V83 may collide with the other lane's next migration number. Targeted backend 214/0, e2e 101 pass/1 skip; PENDING `-Full` before commit.
- [x] **Listing progress model** (2026-10-02, uncommitted): V81 facts → server-derived `progress {track, step, flags}` (owner 3 steps, staff 5); owner confirm `POST /me/listings/{id}/confirm` gates publish (409 `owner_not_confirmed`); dropped lifecycle_*/pipeline_stage/handback_milestone + pipeline endpoint; shared `ProgressTracker` on admin card, board and My Listings. Supersedes the Clarification stepper below. Backend 3178 (env errors only, reruns green); e2e -Full 2525: all green on rerun except 4 flatmate specs (backfill ×3, trust-badges:254) that hit the other lane's uncommitted flatmate seat/badge work — not this slice. Review fixes: V81 backfills HEAD-era clarifications to needs_info, reopens stale approved reviews on pending listings, grandfathers flagged staff listings; deal reopen goes through `reenterPending`. Follow-ups: tracker shows needs_info as a blocked step ("Waiting on owner/you"); admin All-listings status filter resynced to the progress steps + live/paused/sold/rented/rejected/flagged/archived, Verification Queue gains a server-side `progress` filter (unknown value → 400; `ModerationProgressFilterTest`, properties-console spec green). Admin card badge still reads Pending/Approved. Note: shared `draazy_test` DB has another lane's V65 checksum drift — use a private TEST_DB_URL.
- [x] **Admin card Clarification step** (2026-10-02, uncommitted, superseded by listing progress): Clarification loop: owner thread labelled Draazy Support + persistent link + notification deep link; staff bell "Owner replied" + card chips via `?unread=true`; bell deep link re-fires while mounted; e2e ops/clarification-loop green. PENDING AGENT REVIEW (react, code, security).
- [x] **Badge naming split** (2026-10-03, uncommitted): ownership-doc badge renamed "Verified property" everywhere (owner status card CTA, wizard docs card, buyer tags/filter, admin panel, help, FAQ, assistant); identity CTAs now say "Verify identity". Dead `listProperty.verifyNudge` keys removed. My Properties identity banner + owner listing status card: mobile layout (no dead rows, full-width CTA) + copy; e2e dashboard green. Follow-ups: PropertyHeader "Draazy Assured" prints a static "Verified owner" on every listing (false claim on unverified ones); plan features "Verified owner badge" (plans.json, misc1 `plansOwnerFeat3`, misc2 `coOwnerFeat2`) name no specific badge. PENDING AGENT REVIEW.

- [x] **KYC desk redesign** (2026-10-03, uncommitted): `/admin|ops/kyc-review` → tabs Needs review / QA sample / Decided, 10 per page, server filters (`q`, `docType`, `claim`, `overdue`, `outcome`, `sort`) + `/summary` counts via `IdentityReviewQueueService`; case dialog (images beside entries, per-doc checklist gates Approve, liveness group, collapsed history, one action rail) in `pages/ops/kyc/`. Opening a case held by another reviewer no longer attempts a claim. Specs identity-review, identity-claim-qa, new identity-queue (16/16 green). `awaitingQa` on the case lets the approver see an open QA (it blocks their revoke) without the sample date. Dev KYC seed `db/seed-local` (local profile only) + `DevKycSeedImages`; dev signed URLs now relative (CSP blocked the absolute `<img>`), and `openDoc.isViewableDoc` accepts same-origin root-relative paths (live-doc-viewer-scheme green). Note: `seam-write.spec.js:338` failed once under 4 shards at the vault upload step, passed alone — potential flake, not from this change.

- [x] **Notifications / Saved / Messages MVP** (2026-10-04, uncommitted; hunks interleave with other lanes in ~30 shared files — path manifest in the session's `wave-a-paths.txt`): Notifications server-only (fixtures deleted, one unread count, `NotificationBell` latest-5, Today/Earlier, repeats collapsed, swipe/long-press clear, 30-day read hide + 90-day sweep); Saved account-only, archived listings drop out, undo-staged unsave, 44px remove on phone rows; Messages Phase 1 (V84: idempotent reply, archive/mute/delete-for-me/block, first-contact 20/h, phone/email masking until reveal incl. inbox preview), Phase 2 (V85: SSE `/messages/stream`, typing, presence, delivered/read ticks with reciprocal privacy toggles), Phase 3 (V86: photos with EXIF strip, PII-free push seam — logging sender only, no VAPID). Reveal rule: approved buyer sees the owner's number unless `hide_number`. Pre-existing reds seen: property-integration :150/:1337/:1386, trust-badges :250, backfill ×3, live-interior-lead :65, live-tap-targets MahaRERA chip. Follow-ups: `ConversationService` over the 450-line guard (pinned 486); SSE hub is single-instance (multi-node needs LISTEN/NOTIFY); real Web Push sender.
- [x] **Comment hygiene + spec renames** (2026-10-04, uncommitted): every uncommitted file held to 1–2 line WHY comments (detector `cmt-check.js --all` = 0); 91 touched specs drop `live-`; push worker moved to `public/push-sw.js`; `/admin/kyc-review` added to ROUTE_PATTERNS. Bulk-script damage (lost `?`/unicode, truncated comments, emptied catches, deleted `playwright.config.js` block) repaired from HEAD. Untouched `live-*` specs keep their names.
- **Dashboard MVP audit fixes** (2026-09-29, uncommitted; hunks interleave with the verification slice)
  - [x] A backend: audit rows + idempotent repeat for contact/doc/photo/visit/host-room decisions; derived contact expiry
  - [x] B data/Requests/Action Center/LeadSheet: B1–B8, B12–B18, busy guards, refetch-on-focus, "Wants to contact you"/Accept copy
  - [x] C shell: 5-group nav keeping every tab id/alias, history push, loading skeleton, Overview = Action Center(3) + 2×2 stats + one nudge
  - [x] D owner: ListingCard primary+Edit+More, leadsFor by uuid, onChanged refresh, ProfileTab privacy copy + server notif prefs, per-visit host Confirm
  - [x] Integrate: build, eslint, backend targeted (315 green), dashboard e2e set green; docs + COVERAGE rows
  - Deferred: re-ask after contact expiry on `/contacts/status`; doc count in passport; server-side views aggregate
- **Full-suite red sweep** (2026-09-30, uncommitted) — 28 red from the 09-30 `-Full` run fixed across both
  sessions' files: dashboard tab/sub derived from the URL (Android Back desync), approved "Chat with Owner"
  back to a real link, alert-strip `newCount` shadowing `matchCount`, flatmates 44px targets + Back filter
  sync, Saved undo under the topbar, `/admin/flatmates` redirect, PriceInsights land note/TDS, wizard photos
  nudge, slider coalesce 450ms, pipeline board `capDisclosed`, stale specs. Backend: `flagReason` staff
  only (owner reads withhold it too), staff residents decision needs `societies:write`, Jackson body caps
  (5M string / 6M doc), help feedback 20/IP/slug/day then accepted-and-dropped (202, V73), stable FAQ
  order, conditional pending→decided updates. Second `-Full`: 2,468/2,488; its 14 reds fixed and green
  in targeted reruns.
  - Watch: `ops/verification-thread.spec.js:54` (staff 404 on duplicate-meter case) fails only in
    shard order, green alone — likely shared-fixture leakage, cause unknown
  - Watch: `consumer/connectivity.spec.js:156` now polls `hits()` — the list read goes out after
    flags/localities, so the banner can paint from an earlier abort first
  - [x] Flatmates reds fixed (12:40–13:30): `live-url-sync:41` — a Back landing before a filter's
    push commits merged into one no-op router transition, so `params` never changed; hook now also
    reconciles on `popstate`. `group-chat:120` — List/Map drawn as a 36px circle again with a
    centred 44px `::before` target. `discovery:192` — slider commit is 450ms, both `setBudget`
    helpers now wait for the URL `budget` instead of a 400ms sleep and the card read polls
  - Watch: `discovery:224` (sign-in `continue` timeout) and `group-chat:92` (context destroyed
    mid-evaluate) failed once under load, green on rerun
  - [x] Green on re-run: `owner-consent:130`, `photo-ux:32`, both `map-popup`, mobile-small
    `live-home-flatmates-tile:29` and `topbar-scroll:61`
  - [x] `consumer/account/dashboard.spec.js:94` green in a rerun (3/3), so the red was run interference
  - [x] `/flatmates` hero: HEAD layout kept (pills + subtitle on phones), photo banner under a
    left-to-right fade, flat-sharing copy (en only), solid Get verified; doc line in
    `flows/consumer/flatmates.md`. 8 hero/mobile specs 116/116 green
  - [ ] `npm run check` + `build`, one combined targeted rerun, then `graphify update` and `/now`
- **Flatmate ops desk revamp** (2026-09-29, uncommitted) — `/ops/flatmate-review` is now one merged
  Pending queue + Published + Hidden & removed, cards open a "Review flatmate post" popup (new
  `GET /admin/flatmates/{id}`, multi-state `modStatus` on the queue and on group applications). Old
  three boards deleted. Backend targeted green incl. `SpecCoverageTest`; e2e `ops/flatmate-moderation` +
  `tenant-badge-consent-and-registration` 13/13. Full `-Full` run not yet done.

- **Property verification MVP** (2026-09-29, uncommitted, shares files with the identity slice) — badge
  optional, light bill leads; one approve path through a 4-fact checklist, needs-info vs final reject +
  reason codes (V65), evidence any-one gate + share certificate (V66), edit re-checks, broker/duplicate
  signals, owner 3-state status card, admin decision panel, reminders/auto-archive, two-staff overrides,
  tenant agreements via the vault (`agreementDoc.id`). Targeted backend + e2e green; full e2e 2026-09-29:
  53 red, all photo-404 order pollution (pass in isolation) or listed below, except `live-interior-lead:65`
  (pre-existing). Follow-ups: a hard signal first raised *after* approval is not escalated when a
  stays-live re-check passes ("Looks fine" skips the two-staff gate); `properties-moderation:184`
  archive/restore 409 seen once, not reproduced.

- **Identity verification hardening + badge maker-checker** (2026-09-28, uncommitted, shares files
  with another session) — V59–V61; revoke/withdraw/expiry sweep, passport/voter ID, liveness,
  self-decide 403, masked queue, name lock, `badge_grant_requests` two-admin grant, 4-screen consumer
  flow. Backend 3015 green, targeted e2e green. Full e2e: 13 red after `-Failed`, none in
  identity/badge — 4 already listed below, 9 in other-session files (`saved-swipe-undo` ×6 →
  `Saved.jsx`; `flatmates/live-url-sync:41`; `property-integration:468` photo 404 → `FileStorage`;
  `live-pull-to-refresh:197` mobile-small). Wave 2 (V62–V64): approval overwrites `users.name` with
  the holder name; after-commit storage deletes + retry queue; en/hi/mr consent with language
  stored; dedup-409 dispute (note-only, server-recorded conflict); claim/QA maker-checker;
  7/12·8A·Property Card + POA evidence. DigiLocker dropped permanently. Security review fixed
  (unique upload keys, conflict/claim advisory locks, note redaction, 25% first-time QA). Open items:
  "Person identity verification — open items" below.

- **Origin gate** (2026-09-27) — `OriginGateFilter` + `X-Proxy-Auth` from the Pages Function, so
  `*.run.app` refuses direct callers (`DEPLOY.md` §4, `cross-cutting.md` §8.8). Targeted backend
  41/0, then 9 related suites 63/0. Security review: one Medium finding (ungated writes to probe
  paths let a forged XFF drain a victim's write budget once `INTERNAL_PROXIES` widens). Fixed by
  exempting only GET/HEAD; `OriginGateTest` 8/0. PENDING AGENT REVIEW (code-reviewer). No e2e coverage:
  the gate is off under the Vite proxy, and the deployed topology can't be exercised locally.
  **Uncommitted.** Before the next sandbox deploy, create `draazy-sandbox-origin-shared-secret`
  and the Pages secret `ORIGIN_SHARED_SECRET` with the same value, or the revision will not start.
  - [ ] Owner: provision both secrets, deploy `both`, `curl` a direct non-health route → 403.
  - [ ] Then widen `INTERNAL_PROXIES` per `DEPLOY.md` §4, against a real request's `X-Forwarded-For`.
  - [ ] Turn on the free Cloudflare WAF managed rules and one `/api/auth/*` rate-limit rule. Leave Bot Fight Mode off.

- **Post-property audit remediation** (2026-09-25/26, list-property lane) — every batch built: safe
  batch S1–S9, B1 privacy and data loss, owner-only (`V54`), B2 trust, security 3–6, B3 wizard fields,
  the final wizard batch, and the decisions batch (`V55` pause, `V56` `resubmitted_at`, deferred login,
  photo guardrails). **Uncommitted, awaiting the owner's review, commit and full e2e run.** Backend
  full 2,936/0 before `V56`, targeted 49/0 after.
  - Open (low): the contact filter lets comma/slash separators, letter O for zero and words between
    digit groups through (false-positive risk) · an ICC profile can carry device make/model, and
    padding inside kept segments needs a server re-encode · `scripts/listing-edit-prefill.test.mjs`
    "land is asked for a project name…" is red at HEAD too · `upload-policy:195` HEIC fetches an
    external sample
  - Deferred by the owner: city selector · SMS/WhatsApp · photo backfill · 1.5/2.5 BHK. Decided:
    no server-side draft; documents stay upload-at-submit
  - Not ours, seen in its runs: flatmates guest save/join blocked by the Cookie preferences dialog
    (`flatmate-saves:273`, `group-join-and-layout:147`)
- **Search-flow follow-ups** (waves 1–2 shipped in `26b71b39`, `c89da3a5`):
  - `homeData.STATS` hero/trust figures are still hard-coded — bind to `/properties/counts` and real
    aggregates
  - Not built for want of data: a "clear title" facet needs a wizard field and a document first
  - Real Android hardware Back on the filter sheet not yet tried on a phone
  - `flatmates/live-smart-search` flaked once inside a full run (green alone)
  - PG as a listing type and PG facets — deferred entirely (2026-09-24)
  - Not ours, seen in the Wave 1 run: flatmate tenant-tier verification (`eligibility`,
    `review-status`, `trust-badges` get tier `identity`), the `ops-field` drafting-desk touch floor,
    `live-home-flatmates-tile` trust row wrapping at 360px, and `property-integration` (take-down,
    admin list, rent co-fill `tenantName`, `svc.getIdentityStatus is not a function`, and `:1323`
    still expecting the retired `GET /flatmates/{rooms,posts,groups}`)
- **Rent agreement audit remediation** (2026-09-24) — every item built: decisions D-a…D-k, RA-1…RA-8,
  MC-1…MC-9, MOD-1…MOD-7, CON-1/CON-2 and the CON-1 residuals, LEG-1…LEG-3, UX-1…UX-8, DOC-1.
  **Staged by the other session, not committed.** Residual gaps the slices recorded:
  - MOD-4 refunds: the Cashfree refund is async with no refund webhook ("approved" means the gateway
    accepted it); a refund does not cancel the request; a later positive amendment prices against the
    gross amount
  - MOD-5 amendments: an overpayment after a decrease returns only through a MOD-4 refund;
    `incrementEvery` is not amendable; co-fill parties are not notified; a paid webhook on a
    withdrawn amendment only logs; a failed checkout resume needs the desk to withdraw and re-propose
  - MOD-6 SLA: no notification or sweep (ADR-011), wall-clock rather than business hours, and the
    clock does not pause while a rejected paper is awaited — **the targets are assumptions; confirm
    them with ops**
  - MOD-7 overlaps: a flat typed two ways is missed; the address match is a sequential scan (add an
    expression index if the table grows); legacy `rent_agreements` rows are not compared
  - CON-1: co-licensors, witnesses and invitee-typed co-tenants are not confirmed; consent binds the
    mobile, not name/Aadhaar; a second device re-asks; `payFiled` from the locked panel shows the 409
    instead of opening the modal; `draazy_tenant_consent_code` needs Meta approval
  - CON-2: the co-fill pay panel's "above details" has nothing above it — it needs a translated deed
    summary; the hi/mr declarations translate the hashed English text and are not hashed themselves
  - MOD-1: the co-fill side split is backend-only, with no spec. MC-4: approvals are exported but not
    erased (a disclosed gap). RA-2: the Gram Panchayat list is a seed that staff extend via `R__`
    until an admin UI exists, and it assumes the ₹300 DHC applies to rural areas too
  - [ ] `AbstractApiTest` is `@Transactional`, so MockMvc tests cannot catch a detached-entity write
    (it hid the MC-4 bug) — consider a non-transactional smoke base for controller → service handoffs
- **Rent agreement: reuse, registrable-at-SRO and Art. 36A slices** (2026-09-23/24, uncommitted,
  sharing files with the other session) — built and verified on the combined tree. Open:
  - Not covered by a spec: a top-up whose answers were edited is refused (`services.ra.locked.topUpChanged`)
  - Product: an owner who files the Pune police tenant verification personally needs the tenant's
    ID — a consented "share my ID with the owner" toggle would close it
  - a11y: wizard labels lack `htmlFor`/`aria-invalid`/`aria-describedby`; `PoaFields` `poaRegNo`
    has no accessible name; errors are many separate `role="alert"` regions
  - Pre-existing: `rent-agreement-cofill.spec.js:205` (signed-out invitee) — the invite-init effect
    calls `sendToSignIn` once per StrictMode pass
  - The multipart upload helper is duplicated across `ServiceRequestDocsTest` and
    `RentAgreementReadinessTest`
  - Known race (LOW, accepted): a vault pick while a camera file is still compressing saves the
    compressed file to the user's own vault
  - Pre-existing: `npm run check` fails at `check:help` (`HelpArticle.jsx` unwrapped
    `/help/a/${slug}`) and `check:routes` (`/admin/kyc-review` dead pattern)
- **Services hub + rent-agreement mobile pass** (2026-09-24) — shipped and green. Open (LOW): disabled
  tiles still take the gated `:hover` on desktop (`:hover:not(:disabled)`); `FeatureSelector` tiles
  are still `div role="button"`
- `GroupModal`, `PostModal` and `ContactOwnerModal` hand-roll only the Escape half of a dialog;
  adopting `useModalDialog` adds a Tab trap and focus restore, so it is an a11y slice with its own
  specs. `post-on-behalf.spec.js:618` still quotes the old `Area (sq.ft.)` string
- Graph communities are named by hub because `graphify label` finds no LLM backend on this machine;
  set `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY` and run `python -m graphify label . --no-viz`

### Mobile platform-layer audits — SHIPPED, hardware checks PENDING VERIFICATION

`/reels`, `/list-property`, `/listings`, `/flatmates` (two passes), the app-wide scroll lock
(`hooks/useScrollLock.js`, reference-counted on the root), `.fg-header` at 44px and the
`lib/isTopDialog.js` Escape guard are shipped, guarded by `mobile/reels-platform-layer`,
`consumer/list-property/custom-features`, `mobile/listings-platform-layer`,
`mobile/flatmates-touch-targets`, `mobile/live-flatmates-modals` and `mobile/live-sheet-scroll-lock`.
Emulation reports every `env(safe-area-inset-*)` as 0 and resolves `dvh` as `vh`, so these need a
real phone:

- [ ] `/reels`: landscape insets; the chip `:active` reads as a press; 44px chips do not crowd the
  top overlay at 360×640
- [ ] `/list-property`: the tile lift stops sticking after a tap; which `top` wins for `.lp-meter`;
  press feedback on the tiles and file pickers
- [ ] `/listings` map sheet: `86dvh`, pinch-zoom on `.dz-mdp`, `data-no-ptr`, grabber drag-dismiss;
  one pull-to-refresh spinner on a fast flick
- [ ] `/flatmates`: the `.dz-sp-*` locality popup (needs `GOOGLE_MAPS_API_KEY`) — taller rows against
  the 306px list; the drawer's top/left insets on a notched device in both orientations and as a PWA
- [ ] Maps on `cooperative` gesture handling read as help, not obstruction; home-indicator clearance
  on the flat-share sheet's Cancel/Post; the lock holds a thumb on older iOS Safari (fallback:
  `position: fixed` on the body with a scroll restore)
- [ ] Scroll lock on `Compare`'s picker, `DashboardReviewModal`, the society stack and the
  `AdminSocieties` dialogs

Open, found during the audits:

- `interactive-widget=resizes-content` is app-wide: `.dz-bottom-nav`, the cookie banner,
  `InstallPrompt` and the assistant FAB now sit above the Android keyboard — decide per element, or
  hide the tab bar on a `visualViewport` resize
- `/reels` mounts up to 24 reels × 5 full-screen images at once; `content-visibility: auto` on
  `.reel` would defer them, but a device must confirm the snap geometry survives
- `-webkit-tap-highlight-color: transparent` on `html` suppresses the flash on tappable
  `<div>`/`<li>` rows with no `:active` replacement; `.dz-lightbox img { touch-action: pinch-zoom }`
  is inert because the overlay's `touch-action: none` wins — relax the overlay, not the child
- `usePullToRefresh` ignores the app's own reduced-motion toggle (`html.dz-reduce-motion`); ~15 call
  sites pass `behavior: 'smooth'`, which outranks it — drop the argument
- The listings drawer has `aria-label` but no `role="dialog" aria-modal="true"` — copy
  `flatmates/FilterBar`
- `listings/Card.jsx:54` carries its own unguarded copy of the activation handler
  (`lib/onActivateKey.js` has the auto-repeat guard)

### Two notes left by the filter-correctness review — both deliberately out of that diff

- **`rangeChanged` is reinvented across a seam.** `ResultsArea.jsx` L27-28 hand-writes
  `f.rent[0] !== RANGE.rent[0] || f.rent[1] !== RANGE.rent[1]`, which is exactly `rangeChanged` in
  `lib/listings/filterState.js` L68 — unexported, so the results page grew its own copy. Exporting
  it changes a module's public surface and rewrites two call sites; too large for a
  no-behaviour-change pass.
- **The radius is not re-clamped when the near-a-place mode toggles.** `set({ nearMode })` leaves
  `f.nearRadius` alone. Latent only while `NEAR_MAX_MINUTES` and `NEAR_MAX_RADIUS` are both 25 —
  which is precisely the coincidence the two constants exist to stop anyone relying on. The moment
  they diverge, switching km→min can leave a radius above the new ceiling, with the slider pinned at
  a value the chip does not reflect. A real behaviour change, so it needs its own spec.

### Person identity verification — open items

Consumer flow, staff queue, claim/QA maker-checker, locking and backend/e2e coverage shipped (see
the In-flight identity entry). What is left:

- [x] Badge grant origin: back-office `UserResponse.badgeSource` (`identity`/`manual`, derived from
  the decided `identity_verifications` row); the console disables withdraw on an earned badge, the
  server already answers 409, `admin/users.spec.js:125` unparked (`BadgeSourceTest`).
- [x] Flatmate badge copies: `flatmate_seeker_posts.verified` and `flatmate_group_members.verified`
  now follow every grant/revoke/withdraw/expiry via `VerifiedBadgeCopy` (`FlatmateBadgeCopyTest`).
  The `name` copy is user-typed, not the verified name, so it is correct as is.
- [x] Server-anchored liveness: `POST /me/verification/identity/challenge` signs a pose
  (left/right/smile, HMAC, 15 min); the reviewer must confirm it (`poseConfirmed`); no challenge
  → always QA (V65, `LivenessCheckTest`, `IdentityLivenessChallengeTest`).
- [x] Full-number confirmation: the reviewer's typed number is the hash source; a mismatch with
  the applicant's entry is a 409 soft stop, `numberOverride` is stored, audited and always QA.
- [ ] PENDING VERIFICATION (hardware): real-face liveness on a physical webcam, Android and iPhone
  Safari; camera-denied and backgrounded capture. `readSelfieGuidance` is driven only by synthetic
  frames today.
- [ ] PENDING VERIFICATION (post-deploy): one real identity submit on R2 — checklist in
  `docs/DEPLOY.md`. (The pre-V64 duplicate-dispute cleanup is moot: `identity_dispute` never
  shipped, so no deployed DB can hold duplicates.)
- [x] OCR removed for good (Tesseract, then PaddleOCR/ONNX, both misread real cards): capture
  uploads photos + selfie only; the reviewer reads the number. Identity e2e 12/12 green.
- [x] Wizard "Who's listing?" pills removed (write-only `listerRelation`, read nowhere; key stays legal for
  stored rows). edit-prefill + seam-write green; photo-ux `:32` PENDING VERIFICATION — reruns blocked by
  the demo-seed psql failure from another lane's in-flight V41–V50 migrations.
- [x] Review checklist line "Lister is the owner or family, not a broker" removed (`VerificationCases`, V80
  clears it from open cases; checklist is now 3 facts). The `broker` needs-info/reject reason and broker
  reports stay. e2e 40/40 green; Spring tests PENDING VERIFICATION — test DB fails Flyway validate on
  another lane's untracked V65 and Postgres hit "too many clients".
- [x] Docs: `docs/DEPLOY.md` §3.3 (WhatsApp template, face/OCR licensing, privacy/retention,
  camera/CSP); hardware checklist in `docs/flows/consumer/contact-gate-leads.md` §9.
- [x] E2E identity set green (2026-09-29): identity-route 16/16; identity + ops + admin/users
  90/93 with 2 skipped. `:346` now follows the degraded-face-model path (as `:312`).

## Needs attention

Open items with no ledger row. Anything covered by a decision is cited, not restated.

- **Potentially pre-existing: `property-integration.spec.js:465` (admin list served by
  `/admin/properties` includes unapproved listings) fails (2026-09-29).** Outside identity work; the
  admin-properties / property-review files are mid-change in the other session's tree.

- **Potentially pre-existing: `consumer/list-property/required-fields.spec.js:153` and `commercial-subtype.spec.js:80` fail in isolation (2026-09-27).**
  Both break on steps 1–3 (strict-mode "2 dialogs" on the handover picker; `Next Step` click intercepted on step 1), which
  the guest submit-order / "Verify & submit" fix does not reach. Check the uncommitted `ListPropertyModals.jsx` first.

- **Potentially pre-existing: `consumer/search/type-aware-filters.spec.js` :56 and :163 fail (2026-09-27).** Both drive the
  plot "Land use" dropdown, which the verification-toggle fix does not touch. The tree also holds uncommitted
  `PropertyTypeSections.jsx` / `facetOptions.js` edits, so check those first.
- **Uncommitted `ListingService.requirePhotosOnCreate` breaks API-seeded e2e specs (2026-09-26).** `POST /me/listings`
  without images now returns 422, and many specs seed listings that way. Together with the uncommitted `RentAgreement.jsx`
  changes (no-backend rent-agreement reds), this accounts for 275 test locations that fail serially too, so they are not
  shard-induced. Seed photos in the helpers (or relax the rule for seeds) before trusting `run-fast.ps1 -Full`.
  The helpers now seed `listingPhotos` — never-uploaded keys — and 31 specs approve such listings; once one
  is public (e.g. `scheduled-visits`) every zero-console-error spec later on that shard fails on photo 404s
  (13 of 21 reds in the 2026-09-27 full run; all pass in isolation). Approved fixtures need `uploadedListingPhotos`.
  Four more reproduce in isolation and sit in other in-flight slices, none of them the ledger work:
  `live-filter-request-volume:91`, `settings-preferences:322`, `dashboard:99` (wizard never reaches Photos &
  documents), `signin-gates:80` (no `/auth/me` after a held refresh; `AuthContext.jsx` is modified).

- **Help article feedback has a writer and no reader.** `POST /help/feedback` (V36) collects the
  verdict, the language and the optional reason, and nothing on the platform reads a single row.
  That is the deliberate order — rows cannot be backfilled, screens can be built whenever — but the
  table earns nothing until someone builds the screen: helpful-rate per article per language, worst
  first, with the comments under each. Two obligations come with it and are written into the column
  comments rather than here, so the person who builds it sees them: a CSV or XLSX export must
  neutralise a leading `=`, `+`, `-` or `@` in `comment` (formula injection, which React escaping
  does not cover), and the text is a reader's own words, so it is quoted, never rendered as markup.
  A third obligation lives here because no column can carry it: **a negative files twice when the
  reader explains it** — once bare the moment they click No, once more with the prose. That is
  deliberate (counting only the explained negatives would hide the articles whose readers gave up),
  but it means the helpful-rate cannot be `count(*) filter (where helpful)` over raw rows. Count
  verdicts and comments separately, or collapse rows sharing a slug within a few minutes.
- **`AdminTopbarTools.jsx` hardcodes the runbook palette entries** that the staff help chunk now
  owns. The titles and paths are duplicated, so renaming a runbook silently breaks the ⌘K link.
  Deriving them from `virtual:help-content-staff` is the obvious repair and was left alone as
  unrelated to the split that prompted it.

- **`PATCH /flatmates/rooms/{id}` accepts and re-moderates `homeTypeLabel`, and has no caller.** The
  endpoint takes a full `FlatmateRoomCreateRequest` and `FlatmateEditRules` already lists home type
  among the fields whose change sends an approved room back for re-check. The frontend has no room
  edit path at all — `submitFlatmate` short-circuits on `editId` and the dashboard offers only delete
  — so the seam is dormant rather than broken. Noted because the request is *not* sparse: whoever
  wires room editing must carry the field through, since omitting it reads as "cleared" and would
  silently drop a home type the host set at create.

- Owner-consent OTP **says nothing about which flat**. `OtpSender.send(mobile, code)` carries a code
  and no context, and the address it gets filed against arrives in the *tenant's* own request body.
  So V30 pins which post a consent may vouch for, but it does not establish which flat the owner
  thought they were agreeing to — and `FlatmateGuardrails#fingerprint` falls back to
  `addr:<title>|<locality>` where the title is host-typed, so a deliberately generic title lets one
  consent key a succession of different flats (the duplicate guardrail blocks the parallel case, not
  the sequential one). Until the sender seam carries a purpose and a label, and that label is stored
  on the consent row, `ownerConsent` is corroboration for a moderator and must not be the sole input
  to anything automatic.

  **Not closable in code alone.** Meta forbids sending a one-time code as free-form text, and an
  AUTHENTICATION template takes the code and nothing else — `WhatsAppOtpSender#send` puts it in the
  body parameter and again in the copy-code button, which is the whole payload the template allows.
  Its body copy is Meta-authored, so there is no second AUTHENTICATION template that could name the
  flat: a template carrying an address must be a **UTILITY** one, and a UTILITY template may not
  carry a one-time code. Naming the flat therefore means *two messages* — a UTILITY send saying
  which flat is being asked about, then the existing AUTHENTICATION send — which is two approvals
  and a second billable conversation per consent, plus a `send(mobile, code, context)` seam that
  sequences them. That is a vendor/ops and unit-cost decision before it is a code one, so it is
  left stated rather than half-built.

  A review proposed binding the fingerprint at *send* time instead (store it with the issued code,
  refuse a `record` that names a different flat). **Rejected: it buys nothing.** The tenant composes
  both steps, so they would simply send under the same false address; nothing about the message the
  owner receives changes. The binding is only worth building once the template can actually show the
  owner what they are agreeing to, and then it comes free with it.

- Flatmate auto-approval compares `society_id` for rooms but only locality for **groups**, which
  carry no society field — closing it is a data change (a society on the group), not a predicate.

**Standing constraints.** The Cashfree sandbox-verify gap has no possible e2e — the sandbox returns
no `paymentSessionId`, so no automated run reaches the hosted checkout and it stays manual.
`DRAAZY_DEV_MACHINE` is mandatory for the `dev` profile; it is set per machine, not in the repo.

**Sticky-hover gate: one selector left unasserted.** The mobile-baseline pass wrapped every `:hover`
that moves a *card* in `@media (hover: hover)` — `.property-card`, `.cat-card`, `.feature-card`,
`.search-btn` in `index.css`, plus the two scoped halves that outranked them in `routes/saved.css`
and `routes/listings.css`. The property detail page's own leftovers went with the touch-states
slice (`.icon-btn` and `.main-image-wrapper:hover img` among fifteen), and the last four card lifts
— `.prop-row`, `.svc`, `.tile` in `index.css` and `.svc-card` in `routes/services-hub.css` — closed
it out. All four stop at `(hover: hover)` rather than adding `(pointer: fine)`, per the rule stated
with the tinted shadows: they sit beside `group-hover:` utilities that Tailwind emits under that
query alone, and a card whose caption tints without its lift is worse than either state. The first
three ship in the global sheet and are asserted from the property page's CSSOM. `.svc-card` is
gated but PENDING VERIFICATION: it ships in the `/services` route chunk, which that spec never
loads, and asserting it means lifting the `mediaWrapping` walker out of
`mobile/live-touch-states` into a shared helper. Worth doing when a second spec needs the walker,
not before.

**The home Featured card's hover lift is dead code.** `Featured.jsx` gives it
`property-card list-reveal`, and `.list-reveal`'s `animation: … both` pins `transform:
translateY(0)` in the *animation* cascade origin, which outranks any `:hover` declaration on any
pointer. The lift has never fired there. This is why the hover-gate specs witness on `.cat-card`
instead — see the comments in `mobile/phase3` and `platform/desktop-noleak-guardrails`.
Deciding whether Featured should lift is a design call, so the animation is left as-is.

**Anonymous reads have no per-IP budget.** `WriteRateLimitFilter` counts only `POST/PUT/PATCH/DELETE`,
so `GET /properties` is unmetered. `q` is now bounded at 120 characters and six tokens, but a search
still runs its spec twice (`findPage` + `countTotals`) and the `societySlug` `@Formula` re-plans per
textual occurrence. Extending the limiter to this read is the remaining half.

**A typed size is forwarded as free text, not parsed into `f.area`.** "1000 sqft" reaches `?q=`,
where it matches nothing, rather than the buy-only area range. Visible and removable via the chip,
so it is a missing feature and not the silent drop smart search was fixed to stop.

**Unverified until the next sandbox deploy.** Cashfree (D4): an order reaching the provider, the
modal opening on a real `payment_session_id`, the callback arriving at the notify URL, the signature
verifying, and settlement landing on a subscription and a rent-agreement request —
`e2e/COVERAGE.md:747` already states that this suite cannot prove money moves. R2: the startup line
`R2 object storage enabled (…)`, one identity submit, one listing photo, and the one thing nothing
here can assert — `Access-Control-Allow-Origin` on the public bucket, without which the wizard's
perceptual hash silently stops flagging duplicate photographs (`docs/DEPLOY.md` §3.2).

**Post-deploy, by hand, in this order.** Put the real `TEST…` / `cfsk_…` values into
`draazy-sandbox-cashfree-app-id` and `-secret-key` with `printf '%s' "$V" | gcloud secrets versions
add … --data-file=-`; PowerShell piping appends CRLF and `Out-File` prepends a BOM, either of which
401s every order **and** breaks the HMAC. Then one rent-agreement payment (it parks at
`awaiting-payment`, so a silent webhook failure is unmistakable) and one subscription, with the
console open — the `about:blank` bank-redirect branch is the one CSP surface never seen against a
live modal, and a violation naming an acquirer domain means widening `form-action`, not
`script-src`. `backend/tools/cashfree-probe.ps1` is untracked: add it deliberately or leave it out.

**Recorded against the Cashfree work and deliberately not fixed.** `orderRequest` is seven
positional parameters with five adjacent `String`s, so transposing `reference` / `customerId` /
`phone` compiles and files the wrong customer id on an order the webhook must later match — it wants
a parameter object. The webhook body is `@RequestBody String` re-encoded to UTF-8, byte-preserving
only because Cashfree sends `application/json` (`StringHttpMessageConverter.DEFAULT_CHARSET` is
ISO-8859-1); `byte[]` would remove the question. And
`ServiceFixtures.deliverSigned` asserts `status().isOk()`, which is also the answer to every refusal.

**The phone contact sheet** — raised by the review pass on that change, deliberately outside its diff.

- `ContactOwnerModal` has `aria-modal="true"` with no focus trap, initial focus or focus restore.
  Pre-existing, but the sheet went from 2 controls to 5 and is the only owner surface a phone has.
- The `revealed` branch builds `tel:` / `wa.me` from a server-masked string, turning `98XXXXX210`
  into a 6-digit dial. Truncated, not a leak. Gate the digit-bearing links on `/^\d{10}$/`, and fix
  `ContactBox` in the same change or the two predicates drift.
- `identityVerified` / `anyVerified` / `verifiedLabel` and the badge JSX are byte-identical in
  `ContactOwnerModal.jsx` and `OwnerCard.jsx` — a pure `(p, t) =>` extraction needing a shared module.
- `OwnerCard.jsx` is desktop-only now, so its `hidden lg:flex` wrappers and phone branches are dead;
  `hidden lg:block` hides without unmounting, so `ContactBox` still fires a second
  `useContactGate(propId)` request into `display:none` DOM.
- `PropertyHeader`'s `.dz-stat-facts` keeps its `border-top` when every child is hidden (a buy
  listing with a non-sq.ft area), leaving a stray hairline above the social block.
- `e2e/helpers/app.js` `openProperty()` waits on a `Request number` button that no longer renders on
  a phone, and has zero callers. Delete it next time that file is touched.
- `queuePendingChat` is not awaited before the sign-in redirect, so it races `drainPendingChats`.
  It will surface as a rare lost first message, not a reproducible bug.
- The sticky CTA opens the sheet even when the gate state is `owner`, offering an owner a chat with
  themselves. `isOwner` is already computed at `useProperty.js:106`.
- `p.ownerId` is optional on the wire, so the sheet's Profile link renders only for seeds that carry
  one and the e2e assertion passes by seed accident. Require the field in the DTO, or assert the
  link conditionally on the same value the component reads.
**The price block** — raised by the review pass on that change.

- "Zero brokerage — deal direct" is pushed for every listing, but `postedByType` admits `agent` and
  `builder` (`draazy-api.yaml:11159`) and the tooltip behind it makes the sharper fee claim. Either
  gate the tag on `postedByType === 'owner'` or decide the platform charges nothing regardless of
  who posted, and say so in the tooltip.
- `PriceInsights` renders for land sales (`PropertyTabs.jsx:138` gates on `!isRent` only) and
  hardcodes "/sq.ft." in three places, so a farm quoted in guntha gets a per-guntha figure under a
  per-sq.ft caption. Its EMI is not `isLand`-gated either.
- No seed carries a non-sqft `area_unit`, so the branch where a buy renders **no** facts tile is
  unreachable from the live lane and the `:empty` border rule that covers it is asserted by nothing.
  A single guntha farm seed would close all three of these at once.

**A room card is titled by `r.society` with no fallback, and a genuinely split flat may not have
one.** `RoomCard.jsx` reuses that string for the headline, the image `alt`, the share label and the
report payload's `ownerName`. Safe for a room posted through `createRoom`; not safe for one minted
by `FlatSplitService.buildRoom`, which copies the parent's `society_id` but never its label, so an
off-registry society leaves the rooms with nothing to render. The dev seed writes the label on by
hand — a fixture working around a product gap. Fix is to carry the parent's society text across, or
give the card a fallback built from `{flatType} in {locality}`.

**`frontend/src/data/referrals.json` was deleted as an orphan, and three doc lines still cite it.**
`docs/flows/consumer/plans-billing-refer.md` L29, L48 and L209 name it as the referral fixture;
nothing imports it and the ops desk reads `GET /referrals`. Rewrite the lines to point at the route.

**Left alone on the phone smart-search bar**, all pre-existing and shared by both bars: `onKeyDown`
fires on Enter mid-IME-composition, so a Gboard Indic transliteration submits a half-typed query
(it needs `!e.nativeEvent.isComposing`); the only focus indicator is `focus:border-teal-400/50` over
`border-white/10`, which will not clear WCAG 2.4.13; there is no `aria-label`, so the accessible name
is a deal-dependent placeholder that disappears the moment you type, and neither page has a
`role="search"` landmark; and `.btn-primary` without `.btn` inherits no `transition`, so the hover
lift and brightness on both submits snap rather than ease. Each is one line, and each is a behaviour
change on a shared control.

**Any control specced at exactly 44px has no tolerance for layout jitter.** `live-tap-targets` now
re-measures until the list is clean before asserting, which is not a loosening — a genuinely
undersized control never clears and the poll times out. A design pass could reasonably give
`.heart-btn` and the `/listings` compare button a pixel of headroom instead.

**Open after the `lib/useSwipeDismiss.js` review:** whether any *other* control that owns a drag can
render inside an overlay using this hook. The filter drawer and the `axis: 'y'` consumers
(Modal/Select/MultiSelect/Menu) were checked and are clean, but that sweep was by grep.

**`useListingsSearch` only discards superseded responses instead of aborting them** (a `seq` ref), so
their bytes are still paid for. That mattered at 239 in flight; at one or two it is close to noise,
and threading a `signal` through the service and provider seams is a real change. Its own decision.

**Society ops console — what the migration could not finish** (opened by `87f2d07`)

- Society review reports are sent as a plain `review` and are indistinguishable on the wire from a
  property review, so the console filters to `contribution|reply|question|answer|board` and society
  reviews stay in Admin ▸ Reports. Splitting them needs a target-type the reporter does not send.
- Outstanding on `3e53d87` and `87f2d07`: the reviewer-agent pass and the `/simplify` pass.
- `useSocietyHub.js` passes `cForm.photo` — the whole `{name, size, mime, dataUrl}` shape — as
  `photoUrl`, which the contribution contract declares a URL string. It needs the same
  upload-then-reference treatment the certificate got.
- `EvidenceUpload`'s 2 MB inline cap does not match the vault's 10 MB, so a certificate between the
  two uploads and is readable by ops but shows the claimant no preview. Reconcile the two limits, or
  explain the gap in the picker's own words.
- `PersonalDocument.sizeBytes` is a nullable `Long` and the certificate adapter coalesces null to
  `0`, so a document that is plainly not empty renders as "0 bytes". Wants a backfill.

**Data and schema**

- No guard test asserts that a `V__` migration never inserts into a table the e2e reset truncates.
  The V78 `message_template` incident is fixed; the class of bug is not prevented.

**Silent failures**

- There is no HTTP-level write throttle on any route. Rate limiting exists only on OTP.
- `postInternalOnce` scans the whole thread in memory on every write.
- `PropertyResponse.adminPipeline` is not flattened by any http mapper, so six back-office readers
  are silently dark on live builds. Precondition for ledger 27.
- `PropertyReviewModal.jsx:391` returns `null` when either the review or the thread fails to load, so
  a failed case-file load is indistinguishable from a dismissed click.
- The review modal's open effect double-POSTs under StrictMode. Harmless since D221's advisory lock,
  but it is why a real server bug hid for weeks.
- **The admin moderation console reads a partial catalogue, and the tripwire is red.** The e2e
  catalogue crossed `spring.data.web.pageable.max-page-size=100` (102 listings), so `warnIfTruncated`
  fires on both `/admin/properties` reads and `property-integration.spec.js:689`/`:720` fail in their
  shared `afterEach` while their own assertions pass. Pre-existing, and consumer surfaces are
  unaffected today (the public approved catalogue is 47). Deferred to **P6** on 2026-08-20 because
  `listForModeration` returns a flat array four screens aggregate over client-side: the fix is a page
  envelope, server-side counts, and the table's filters and sort pushed onto `/admin/properties` so
  the server pages a *filtered* set. Raising `PAGE_SIZE` is not a fix; the server clamps it anyway.
  2026-09-30: the pipeline board passes `capDisclosed` (its banner already says "newest N"), so the
  tripwire stays live for every other caller; the real paging is still P6.

**Content and admin surfaces**

- The three editorial content endpoints shipped empty for three different reasons: `banners` cannot
  round-trip through the admin console, `announcements` and `services` have no admin write routes at
  all, and production answers `[]` for FAQs. Each needs its own decision.
- `MyListingsPanel.jsx:258` calls `sendWhatsappTemplate`, which 403s for owners. Either widen the
  guard or drop the control — pinned in place by `admin/live-outreach` test 6.
- The audit tab needs three small rulings before `logAudit`'s 9 call sites are deleted: whether the
  clear button survives, whether the uuid column is shown, and what the detail sentence reads.
- Flatmates gender filter (`FilterBar.jsx:130`) carries selection only in a CSS class; its four
  siblings all set `aria-pressed`. Accessibility finding, product change.
- `ui/Modal.jsx:108` builds its close button's label as `` `Close ${title}` `` in English, so a
  Hindi or Marathi reader hears one English word welded to a translated title. Pre-existing, and it
  now affects every modal in the app. Needs a `common.*` key taking `title`.
- Three surfaces still average reviews in the browser (`useSocietyHub`, `Owner.jsx`,
  `locality/ReviewsBlock`) — D79's aggregate endpoint is property-only.

**Structure**

- `ListingService` is 17 lines from the 450-line guard. `updateAsModerator` extracts cleanly to
  `ListingModerationService`. Note that `frontend/scripts/check-listing-foundation.mjs` parses the
  file **as text**, by path and regex, so the split has to update the script in the same commit.

**Verification gaps**

- Property reviews have no live e2e; `review-parity.mjs` probes a locality instead.
- The two D160 payment-cap 409s cannot be reached by e2e yet.
- `RentMapper`'s `@Mapping(ignore)` belongs to D167 and is untested.
- `backend/.env.local` secrets were surfaced on 2026-08-09. Rotate if there is any doubt.

**Flaky set** — re-measured 2026-08-13 over a full sweep (1,708 tests, 0 failed, 9 flaky). All are
viewport, scroll or animation timing. **Never relax an assertion to close one**, and never run a
build or `graphify` during an e2e run.

- `platform/desktop-noleak-guardrails.spec.js` :267 :282 :291 :328
- `mobile/landscape.spec.js:101`
- `mobile/phase3.spec.js:157` — both mobile projects
- `mobile/topbar-scroll.spec.js:61` — both mobile projects

**Blocked on the commercial-fixtures workstream landing.** Found while closing out the property
density pass; none of it is in that diff.

- `live-detail-sale.spec.js:86` ("owner-declared, sub-type-specific fit-out fixtures") was passing
  for the wrong reason: the seed writes the sub-type fit-out into `amenities`, so `form_details`
  carried no `fixtures` and `declared` was always empty. The fix moves those three `UPDATE`s into
  `form_details->'fixtures'` and cannot be verified yet — `fixtures` is not on `PropertyResponse` at
  HEAD. Attempted and reverted; landing it early swaps one failing assertion for two.
- `floor-plan.spec.js:98` and `:131` fail for the same shape: the spec is untracked, publishes
  `{ floorPlan }`, and `floorPlan` is absent from `ListingCreate` at HEAD. **Rebuild the services
  lane before reading these as product bugs** — on 2026-09-18 it answered from classes built five
  hours before the field existed. Check compiled-vs-source timestamps in `backend/target-sv2/classes`
  whenever a live lane fails like a missing field; a stale lane and a real regression read alike.

**A shared handler's blast radius is every surface that calls it.** `useProperty.handleContact` is
used by the phone sticky CTA *and* the desktop `OwnerCard`/`ContactBox`. Replacing its sign-in
branch with `setContactOpen(true)` to improve the phone sheet silently moved the gate one click
deeper on desktop and turned three `signin-gates` tests red. The same shape lives in
`MapDetailPanel.jsx` with a comment saying it mirrors this one — grep both before editing either.

**PENDING AGENT REVIEW** — the property density diff (`useProperty.js`, `PropertyHeader.jsx`,
`index.css`, `mobile/property-contact.spec.js`) was reviewed by hand on 2026-09-19 because
`code-reviewer`, `security-reviewer` and `code-simplifier` were all rate-limited. The manual pass
found nothing, but it is weakest on the CSS cascade. Re-run the agents when they are available.

**Decided elsewhere**: every former open question has a ledger row in
[DECISIONS-NEEDED.md](DECISIONS-NEEDED.md), and all of them are closed. Link to the number; do not restate it here.

### Deliberate deviations, open to being overruled

- **Approval no longer demands current ownership evidence.** The gate asks for a document of the
  right kind rather than a re-upload on every re-review; an approved listing whose evidence predates
  the latest edit still passes.
- **The two approve routes stay separate, but the record now says which one ran**, so a moderator
  approval and an admin approval are distinguishable after the fact instead of collapsing into one
  indistinguishable status change.
- **An owner's resubmission needs no cooldown**, declining a review finding: the queue is the
  throttle, and a cooldown punishes the owner who fixes the problem fastest.

### Not fixed, deliberately

- **The lightbox is gated on `zoom` alone, not `zoom && planImg`.** It cannot open without an image,
  but could stay open across a back-navigation to a plan-less listing, rendering `<img src={null}>`.
  Left alone: it is still dismissable by button and backdrop, and the suggested guard would strand
  the `overflow: hidden` lock unless the effect were changed too — a trap strictly worse than the
  broken image it prevents.
- **Nothing constrains Floor Plan to one photo**; `find` takes the first with no feedback. Either
  the picker should enforce singularity or the rule should be visible. Low, and a product call.

## Next up

The ledger queue is empty. Pick the next slice from the open sections above.

- **Flatmate room edit** — no UI edits an existing room (backend PATCH exists). Detail page + My Listings offer View/Delete only for rooms. Also: My Listings shows flatmate group/post status as a hard-coded `approved`.
- **Safe production test accounts** — hidden internal plan, test-account marker (excluded from search/sitemaps/alerts/analytics/finance), ₹1 server-side price for marked accounts, plan refunds (D63). Why and what each unblocks: [docs/MANUAL_VERIFICATION.md §6](../docs/MANUAL_VERIFICATION.md#6-not-built-yet). Needs a plan before building.
- **Single point for user verification (open, product call)** — Admin → Users can still hand-grant the Verified badge (`BadgeGrantService`) outside the KYC Review queue; the Flatmate desk's "Badge verification / Ops-verified" is a host-tenancy check, not identity, but reads like one. Decide: fold hand-grants into KYC Review, and rename the flatmate axis.
- Watch: `ops/identity-review.spec.js` "approve with year-only DOB and revoke" got a 409 on revoke once in a 3-shard run (2026-09-30); green alone and as a whole file right after.
- [x] Society picker lists Google Maps buildings (`SocietySelect.jsx`; all 3 forms) — signed-in pick mints with Google coords. PENDING VERIFICATION: guest pick (binds name/pin/pincode unlinked, no mint) has no e2e.
- [x] Flatless flatmate posts (seeker posts, hunting groups) go live at once and queue as "Live · not yet reviewed"; contact details in their text 422. Flat groups and rooms stay pre-moderated. Legacy pending ones stay pending until Ops acts.
- **Flatmate reports can't take a post down from Reports** — `ReportEnforcement` gives `post` NONE only, and one `post` target type covers rooms, groups and seeker posts, so the id doesn't say which table. Staff decide in Reports → Posts, then remove on the Flatmate desk. Fix: carry the kind on the report, then call `FlatmateModerationService.moderate`.
- **Room free text has no `@NoContactDetails`** (groups and seeker posts do). Rooms are pre-moderated, so lower risk.
- Other session's uncommitted flatmate work breaks 4 e2e: `backfill` :88/:167/:184 (seats PATCH now grows `seatsTotal`) and `trust-badges` :259 (owner-tier demotion now sends the room to `pending`). The specs need updating to the new semantics.
- [x] Spare-room posts are Single (1 place) or Double sharing (2) at one **room rent** split equally; "People the flat can hold" dropped from the room wizard (owner split flow keeps its flat cap). Notes: editing a legacy per-person shared room re-prices it as a room rent (halves its per-person price); `GET /flatmates/rooms` budget filter still compares raw room rent (the board's `/feed` uses per-person); more than 2 sharers is out of scope.
- [x] Room wizard uses the same 4-step rail as every listing (`LISTING_STEPS`): Location and Price are separate screens; `FLATMATE_STEPS` and `validateFlatmateStep2` removed.
- [x] Ops flatmate desk: a badge claim whose room/group the host deleted (archived) no longer shows on Pending (`FlatmateReviewRepository.findForQueue` skips archived targets).
- [x] Flatmate room CTA: Send interest → Interest sent → Message owner once accepted; both sides open one pair thread via `POST /messages/flatmate-requests/{id}` (host: dashboard "Message"); Messages renders listing-less threads as person chats (initials avatar, "Direct chat", no listing card/attachments). Map popup row still shows "Sent" for accepted.
- [x] Listing wizard progress meter: no collapsed row on phones, the full card with the strength milestone track always shows; e2e checks the % climbs across tabs. Also declared missing route i18n namespaces (Saved, Messages, Flatmates, FlatmateDetail).
- [x] Flatmate seeker post: budget is one From/Up to range row like the group form; range shown on card, detail, map, saved card and own banner.
- [x] Own-post strip (`MyPostsStrip`): flatmates tabs and `/listings` show the viewer's own posts as ≤2 slim tap-to-detail tiles + "View all (n)"; owned items leave the flatmate feed (listings feed unfiltered). Room/group/seeker tiles simplified (photo or avatar, title, price, one facts line, save only); CTAs, share, review/consent chips and occupancy note live on the detail page. "Mark filled" banner action removed (stepper on detail page).
- [x] Flatmate tiles match the listing card: room tile h-48 photo, round save, title+price row (`₹X/mo` + short tag), icon facts, move-in chip; group/seeker tiles same rhythm with chips. `.badge-verified-icon` moved to shared `filters.css` (was unstyled on /flatmates). Known: legacy rooms without `seatsTotal` can read "Single room" yet "each, if shared" (`decorateRooms` headroom).

---

## Shipped

Newest first. One line per slice; the commit is the record.

| Date | What shipped |
|---|---|
| 2026-10-05 | Admin back-office restyle to the Property-verification layout (`af1cbb6a` + follow-up): every admin/ops page uses `WorkQueue.jsx` — underline `QueueTabs` with count pills, one `QueuePanel` (note, search/chips/pager toolbar), `RowCard` rows with labelled primary action and icon actions; KPI tiles and tables removed on Societies, Enquiries, Localities, Support, service desks, Referrals, Users (+Badge approvals tab), Team, Finance (Overview/Transactions); Settings/Team Activity/Content/Analytics on underline tabs. `DeskWithTickets` → `useDeskTickets`/`deskQueue`, `DealPills` deleted. Specs moved to `queue-row`/`role=tab`. |
| 2026-10-04 | (uncommitted) Admin Fees tab is the only price source: `/plans`, `/fees` rent row, the subscription charge and the rent-agreement charge all read `settings('fees')` via `PlatformSettings` (`PlanMapper.price`, `FeeController.withAdminRentFee`, `ServiceRequestPricing`); seed no longer overwrites admin fees; admin prices must be 1..100000 (422 otherwise); amendments reprice only the statutory lines, so a later admin fee change is never re-billed. `AdminFeesPriceEverySurfaceTest` + `fees-and-photos` reprice e2e. |
| 2026-10-04 | Help centre refresh. Ops playbook grows from 2 to 12 staff runbooks: new `staff-desks` (desk map), `identity-review`, `ownership-and-badges`, `reports-and-takedowns`, `society-moderation`, `post-on-behalf`, `drafting-desk`, `service-queues`, `flatmate-review`, `referral-fraud`; `verification-sla` and `ticket-escalation` rewritten against code (support conversations vs service-request tickets; dropped the unverifiable ₹2,000 agent refund cap). Admin ⌘K palette lists every runbook (`AdminTopbarTools.jsx`). 27 public articles corrected against code (filters, map, alerts, visits, messages, plans/prices, refunds, rent agreement, packers, sign-up, reporting, support). `check:help` green and the staff chunk's link/heading check green; playbook rendered as admin at 440px. Help e2e blocked: backend didn't compile (`AuthController` `rememberDevice()`, another lane's work) — PENDING VERIFICATION. Uncommitted |
| 2026-10-03 | Properties desk redesigned for desktop work: KPI tiles, Pipeline, Staff Posted and Featured tabs gone; 7 tabs (To verify default, Re-checks, Badge requests, Follow-up, Flagged, Duplicates, All listings) each fetching its own server page of 10 (`?page=`), pill counts from the summary (new `badgeRequests`, `unconfirmed`; `recheck` and `recheck=true` exclude badge-only entries; new `badge` facet; moderation-only sorts on `recheckRequestedAt`/`ownershipRequestedAt`). One filter row per tab (search, deal/progress/source chips, status on All, sort, pager); dense `QueueTable` rows with a per-queue SLA clock ("due soon"/"overdue") and an overflow menu. Review modal is two-pane: summary + section tabs (Overview, Details, Changes, Verified badge, Messages) beside a sticky checklist/decision rail. Code-review fix: an edit after a badge-only request restarts the re-check clock. Deleted `AdminPropertyCard`, `PipelineTab`, `QualityPills`. Follow-up sorts on `lastConfirmedAt` (moderation-only, nulls first, then `createdAt`). Pre-existing fix: the Changes section never showed on live data (the http mapper emits no `reReview`); it now reads `recheckReason` (minus `Ownership documents`) and lists changed fields as chips. Backend targeted 42/42. react-reviewer + code-reviewer done. 8 desk specs reworked, 39/39. `-Full` interrupted about a third of the way through: `notes.spec` :239 needed to open the Messages section first (spec fixed, not rerun); `duplicates` :128/:330 red at the API level (the desk read never clusters a shared-meter pair; the duplicate service has another lane's uncommitted edits), `live-search-combobox`, and the known flatmate failures are outside this slice. Uncommitted |
| 2026-10-03 | Desk follow-up: queue rows are cards again (photo with deal ribbon, title + status, locality line, specs, chips, chevron tracker; owner, price, waiting and stacked actions in columns sharing the header grid at xl). Verified badge tab flattened (verdict strip, divide-y sections, no nested boxes; "Granted Not recorded" fixed). Messages: thread + composer in one box, WhatsApp/comms log as flat rows. Location: separate Address/Society/Flat/Locality/City/PIN entries, "Not given" in amber, Google Maps link. Root fix: `textarea.dz-input` no longer forced to one control height. Lint clean; backend `PropertyModerationQueueTest` green. Verified by the e2e run in the next line. Uncommitted |
| 2026-10-03 | Desk rows reuse the old `.list-card .lr` card (photo left; title/status/hard signals, locality + id, specs, owner/views/enquiries/clock, chips, tracker; price + Review and View/Edit/Flag/Archive icon buttons right). Row checkboxes and all bulk approve/reject/archive removed (user call), with the `properties.bulkOps` flag and `PropertyBulkRejectModal`. Each queue tab note now says it holds open items only and when an item leaves; All listings notes it holds open and closed. Specs moved off the overflow menu. E2E on 28 desk/verification specs: 211 passed, 3 skipped, 7 failed, all outside the desk and owned by other lanes: `rbac` :51/:109/:125, `outreach` :176 and `post-property-sync` :66 hit 422/403 from the uncommitted `BackOfficePermissions` rewrite; `property-integration` :1337/:1386 hit the flatmate `svc.listRooms` breakage. Then: fixed 212px right column (Review top-right, price, icon row incl. icon-only Remind at the bottom), middle split by rules into header / labelled Property-Owner-Activity grid with fixed columns / chips + compact tracker; 6 desk specs 39/39 green. Uncommitted |
| 2026-10-03 | Verified badge moved to the Document Vault; the wizard (post and edit) has no document upload. Owner files a proof in `/dashboard?tab=documents&prop=<id>` (`BadgeRequestCard`, per-type proofs, exact-category match) and presses **Request Verified badge** (`POST .../verification/ownership/request`, owner-only; V82 `ownership_requested_at`/`ownership_declined_at`/`ownership_declined_reason`). An upload alone queues nothing. Staff see **Badge request:** in the Re-check Queue; the review banner offers **Decline badge request** with a reason (`POST .../decline`, status untouched, owner notified `listing.badge_declined`), which replaced **Close without badge** — so a paused listing can now be declined too. Status card: CTA → vault, chips **Badge under review** / **Badge not granted**. An open request also keeps the owner's vault readable to reviewers past the 30-day case window (code-review finding). Backend 129/129 targeted + new access test; e2e 13 affected specs + 13 step-rename specs + review-modal/console green (139 + 70 + 35). Uncommitted |
| 2026-10-03 | Badge requests reach staff: an owner uploading ownership documents to a live, unbadged listing now queues the stays-live re-check item `Ownership documents` (`Property.requestOwnershipReview`, from `DocumentService.upload`); granting the badge drops only that item. Re-check Queue card reads **Badge request:** with **Review** (no Looks fine/takedown); the verification popup shows an "Owner is seeking the Verified property badge" banner, opens the badge panel and offers **Close without badge** (live, badge-only). Owner card shows **Badge under review** instead of the CTA; the dead `badgeRequested`-style fields in `ListingStatusCard` are gone. Superseded by the vault slice above. Uncommitted |
| 2026-10-03 | Post on Behalf (staff) asks only the facts that are critical and unique to the property; the owner adds the rest after claiming. Kept: owner name, mobile and notes / type, commercial sub-type, BHK, area, floor and total floors, furnishing, shell type, land NA status, 7/12 other rights and buyer eligibility / locality, society, address / price, deposit, available-from, possession, RERA ID. About 40 descriptive fields were removed from the form, `INITIAL_FORM`, the cascade and the payload. Fixes along the way: internal notes were never sent (`ListingCreate` has no field for them) and now go to `addNote`; Ground floor now arrives as 0 instead of being dropped; floor above total floors is caught on step 2; a hidden available-from date no longer leaks into `formDetails`. Then cut from 6 tabs to the consumer's 4 (Details = owner + property / Location / Pricing / Photos & Review; draft key `v2` since a draft stores its step), and a home's society field is now the consumer `SocietySelect` (server catalogue + Google Places + inline add), sending `societyId`, `lat`, `lng` and `pincode`, which land and commercial never send; locality was already Google-backed via `LocalitySelect`. Every short option set (type, commercial type, BHK, furnishing, shell, NA status, other rights, buyer eligibility, possession) is now one-tap boxes instead of a dropdown; floor, total floors and locality stay dropdowns. Spec status: `post-on-behalf` + `post-property-sync` 22/22. react-reviewer done. Uncommitted |
| 2026-10-02 | Admin property review modal: the verification checklist rows are now `<label>`s, each wrapping a native checkbox, in place of the ✗/✓ icon toggle. A ticked row turns emerald. The group is named "Verification checklist". `property-review-modal` and `admin/notes` specs now drive checkboxes. The specs have not been run because another session holds the run-fast lock — PENDING VERIFICATION, PENDING AGENT REVIEW. Uncommitted |
| 2026-10-02 | List-property step 2: "Use my current location" is now a square icon button right of the map search (`AreaSearch` takes `children`), not a full-width row above the map. `location-smart` 6/7 — the society-above-map test read two `boundingBox()`es across Next Step's smooth scroll; now one atomic read. Re-run blocked by another session's run-fast lock — PENDING VERIFICATION. Uncommitted |
| 2026-10-02 | List-property society pick fills Locality (+ pincode gap) from the society's pin when the row has none — Google place `localityRaw`, else reverse-geocode, snapped canonical (`useListingLocation.fillFromSocietyPin`). `SocietySelect` gets coords only once the pin is placed, so a typed mint no longer files the society at the Baner default. geocode spec 17/17 (+2 tests), COVERAGE row added. Follow-up: mint sends `localityLabel` but server binds only `localitySlug`, so minted societies stay locality-less server-side. Uncommitted, PENDING AGENT REVIEW |
| 2026-10-02 | Dropped re-typed paperwork fields: flatmate agreement step asks only for the document (no reg. number / Registered on / Valid till); list-property bill tile asks for no consumer number. Backend: tenant tier = flag + document, badge = owner consent only; `AgreementRegistration.complete()` gone, OpenAPI updated. Own-duplicate guard now relies on address key + photo hashes; dup-guard seed anchor gains `address_key`. Legacy (later drop): `agreement_registration_*` columns/read-side, `electricity_meter_no`; an edit keeps a legacy registration while the same stored file stays attached. Review fixes: group agreements now need a vault document the host owns (was rooms only); dup-guard seed anchor pins `Baner Road` and `dup-modal` expects the step-2 block (street came from live geocode). Gap: new tenant badges carry no `validTill`, so they never expire — folded into the flatmate post-expiry decision. Backend Flatmate*/Spec*/OpenApi*/SizeGuard 321/0 (on `draazy_test_agr` — shared `draazy_test` fails Flyway on another session's V65 edit); flatmate agreement e2e 27/28 (trust-badges:254 pre-existing, L607). code-reviewer done; react-reviewer PENDING. Uncommitted |
| 2026-10-02 | Flatmate post expiry: V79 (`active_until`/`expiry_reminded`/`expired_from`, `expired` status; existing posts get 30 days from migration), `FlatmateExpiryService` hourly remind (3 days before) + expire sweeps, edit revives, `POST /flatmates/{kind}/{id}/renew` (owner only) + OpenAPI, dashboard Expired chip + "Renew for 30 days"; approval caps the badge at +11 months. Fixed review-status/eligibility group fixtures to upload a real agreement (new ownership check). Backend 323/0, e2e post-expiry + review-status + eligibility 20/20. No seeded expired row (spec stubs the read; backend test ages rows). Uncommitted, PENDING AGENT REVIEW |
| 2026-10-02 | Flatmates phone sort: "Sort posts" dropdown beside the results count on Rooms + Flatmates tabs (`lg:hidden`, `.dz-dd-sort`, shared `flatmateSortOptions`), removed from the filter drawer. `flatmates-filter-sheet` budget-floor test now polls (raced the refetch). interactions-board + filter-sheet + touch-targets green. Uncommitted |
| 2026-10-01 | Listing cards (grid + list) drop the compare toggle — compare stays on the property page; unused `listings.*Compare*` keys removed. Flatmates save is the listings heart (tiles, map rows, detail headers; saved = rose `#f43f5e`) instead of a bookmark. compare / feature-flags / signin-gates / flatmate-saves / map-popup / saved specs 63/63 green. Uncommitted |
| 2026-10-01 | Draaz assistant: open panel centred below `sm` and the page behind it scroll-locked on phones (`useScrollLock` + `useSheetViewport`; thread `overscroll-contain`); knowledge base in `data/assistant.js` rewritten against `docs/flows/*` (contact requests, listing status, flatmate groups, messages, societies, plans, referrals, route suggestions); 20 help articles + `categories.json` refreshed (check-help-content green). assistant 7/7, help + mobile specs 74/74 green. PENDING AGENT REVIEW. Uncommitted |
| 2026-10-01 | Flatmates match badge explains itself: `matchFor` (was `matchTier`) needs a shared locality, hides on a gender clash, budget-range overlap decides "Fits your Baner, ₹16k request" (12%) vs "Close to your …" (28% / no budget); freshness no longer scores. Rooms compare per-person rent, groups their per-head range. interactions-board + group-preferences 13/13 green. Uncommitted |
| 2026-10-01 | Listings cards (grid + list view) drop the "Posted / Updated <date>" footer to cut empty space; the date stays on the property page. Unused `listings.posted`/`updated` i18n keys removed. 4 listings specs 22/22 green. Uncommitted |
| 2026-10-01 | Searchable move-in: shared `flatmates/MoveInField.jsx` (Immediate / Flexible / date) on the group form (replaces the month dropdown) and seeker post (gains Flexible = null). Group `move_in_by` now filtered by `moveInDays` in `FlatmateSearchQueries` + `SavedSearchMatcher` (null passes; test `moveInFilterReadsMoveInBy`); untouched "Immediately" re-sends the stored date on edit. `moveInLabel` shows past dates as "Immediately"; rooms read "From <date>"; group card/detail, ops review modal, tenant profile and offer dates formatted. Backend targeted green; group-preferences / post-modal / room-card-cover / live-tenant-profile green. `group-lifecycle:123` red from the parallel card/"Your posts" strip redesign (own group is no longer an `.sf-card`), not this slice. Uncommitted |
| 2026-09-30 | Poster-written headlines: shared `components/ui/HeadlineField.jsx` + `lib/headline.js` (suggestion as placeholder, "Use suggestion", blank = suggestion, max 120, contact check) on list-property step 4, room wizard last step and seeker PostModal. Backend V78 `title` on `flatmate_rooms`/`flatmate_seeker_posts` (DTOs, OpenAPI, edit rules recheck, `FlatmatePostTitleTest`); cards/detail/map lead with it, legacy falls back to society/name. Ops review modal: clearer "Flat size" / "Already living in the flat" labels + Headline row. Flatmate*/Spec* backend green; 10 related specs green (68 + reruns). code-review done (1 fix: legacy "4+ BHK" generated titles still load blank on edit). Uncommitted |
| 2026-09-30 | Dashboard flatmate Edit stays on `/dashboard`: group/request forms open in place via `myListings/useFlatmateEditing.jsx` (reuses `useFlatmateSupply` + new shared `flatmates/SupplyModals.jsx` / `useGroupPickers.js`; supply gains `editGroup(id)` + `onGroupEdited`); Post/Group modal panels now opaque (`dz-modal-panel`, was see-through `.glass`); list-property "Go to listings" → `/dashboard#properties`. New spec dashboard-flatmate-edit; 6 related specs 41/41 green (1 skip). code-review done (2 fixes: reconcile sweep leak, recheck markers). Uncommitted |
| 2026-09-30 | Room cards show the real room photo: feed + detail room DTOs gain derived `cover` (first photo; `FlatmateMapper.coverOf`, OpenAPI + flatmates.md updated); RoomCard / map pin / saved card / interest thread read `cover` instead of the absent `photos`. New spec room-card-cover; 4 flatmate specs 21/21 green; FlatmateRoomShape/SpecSchemaParity/SpecCoverage/FlatmateHostRoomEndpoints 24/24. PENDING AGENT REVIEW. Uncommitted |
| 2026-09-30 | Flatmate group agreement "Registered on" / "Valid till" now use the shared `DateField` calendar (DD/MM/YYYY, bottom sheet on phones) instead of native `<input type="date">`; `DateField` gains an `id` prop; Valid till can't precede Registered on. 4 specs moved to `pickDate`; 24/24 green. Other native date inputs remain (TenantFinancesTab, LeadSheet, SocietyModals, ops PoliceIntimation/StaffWorkflowActions/OpsIdentityReview, admin RecordEvidenceForm, PackersMovers). Uncommitted |
| 2026-09-30 | My Properties card redesign: every action inline via `myListings/CardActions.jsx` (3-col ≥44px grid on phones, one row on desktop; `OverflowActions.jsx` deleted), type filter no longer collides with the quota note (note moved out of the header slot, now also shown with one type), squarer shadowless `.dd-type-filter`, tighter phone padding; `Icon` gains `edit`/`pause-circle`/`play-circle`/`undo-2` (all rendered a house). 7 affected specs 79/79 green (3 property-integration reds were unrelated flakes, green on rerun). PENDING AGENT REVIEW. Uncommitted |
| 2026-09-29 | Flatmate group chat unified into Messages + host removes members + List/Map toggle: V72 lets a `conversations` row be a group thread (`flatmate_group_id`, null pair; `conversations_shape` check) and adds `conversation_reads` (per-member read cursor). Participants come live from membership via the `common.trust.FlatmateGroupRoster` port. `POST /messages/flatmate-groups/{groupId}` finds-or-creates the thread (non-member → 404); inbox, detail, reply, read, moderation and DPDP export all cover group threads; one notification per unread burst; unread counts only messages since the reader joined (late joiners start at 0 ? code-review); export also keeps your own messages in groups you left (security-review). `DELETE /flatmates/groups/{id}/members/{memberId}` (host only; seat reopens, member can't re-ask). Frontend: Messages renders group rows (title, member count, sender names; no listing chip/phone/attach), polls the open thread 5s, marks read on open incl. deep links, 16px input on phones; group page has a "Group chat" link with unread count; host × per member. The separate group-chat code was removed. Backend targeted 415/415; `group-chat` 3/3 + messages/chat-owner/flatmate group specs 29/29. Gaps: polling only; removed members lose history; real-phone check PENDING VERIFICATION. Uncommitted |
| 2026-09-29 | Flatmate group cap + leave: a person may be in `settings.flatmates.maxGroupsPerPerson` groups (default 2, admin Settings card, 1–10) counting joined + pending; the 3rd ask and a host Accept past the cap are 409 `group_limit` (hosted groups don't count). New `DELETE /flatmates/groups/{id}/membership` (member leaves, seat reopens, host notified; host → 409). Group page shows You're in + Leave / Requested + Cancel (the unused withdraw endpoint is now wired, and its delete is now `where status='pending'` so a Cancel racing the host's Accept can't strip an accepted row — code-review); dashboard `#groups` sub-tab lists In/Waiting/Declined with View/Leave/Cancel. Also declared the by-id GETs of the detail pages in the contract (`FlatmateDetail`) — `SpecCoverageTest` was red on them. New `FlatmateMembershipEndpointsTest`; backend flatmate+settings 340/340, spec tests 6/6 (on isolated `draazy_test_fm2`: shared `draazy_test` fails Flyway on the other session's edited V65). New `group-membership.spec.js` (3) + 12 related specs 56/56. Gap: deleting a group leaves members' accepted request rows, so the dashboard still lists it and View 404s. Uncommitted |
| 2026-09-29 | Flatmate mobile redesign: group/room/post detail pages are one identity header, a price card (desktop side card), one divided content sheet and a sticky thumb-zone ask bar on phones (assistant FAB lifted above it); room photos are a swipe gallery with a counter; owner-panel and header buttons are 44px. `/flatmates` board: phone hero is just the title + verify button, search and List/Map share one row, room cards go horizontal (~240px vs ~420px tall), group/seeker cards tighter. New `mobile/flatmate-detail-sticky.spec.js` (mutation-checked); 25 flatmate + 8 mobile specs green (detail-page failed once on a stale lane photo 404, green after reset). Real-phone tap/safe-area feel PENDING VERIFICATION. Uncommitted |
| 2026-09-29 | Flatmate maker-checker: a host's Accept now takes the seat — group gains the member and loses an open seat (409 `group_full` when none left), spare room's seat closes, split room gains 1 (or 2 for "bring") occupants up to the flat cap (409 new `room_full`). Re-deciding an answered request is 409 `already_decided`; request/group/room rows are locked so a double Accept cannot over-fill; split-flat writes (accept, host occupant edit) lock every room of the flat in id order, and the open-policy join shares the group lock (both from code-review). Moderation now notifies the author (`flatmate.moderated.*`, deep link) when an ad goes live or is rejected/removed. Dashboard strips the 409 marker and refreshes the inbox on error. New `FlatmateAcceptanceEndpointsTest` (6) + gate test asserts; backend flatmate package 291/291; new `accept-takes-seat.spec.js`; all 25 live flatmate specs 142/142 (url-sync flaked once under load, green on rerun). Uncommitted |
| 2026-09-29 | Flatmates board cards cut to the essentials (title, locality, trust/status chips, headline price + move-in, save, one CTA; whole card opens the detail page). Detail pages redesigned per kind (`flatmates/detail/*`): gallery, sticky price/CTA aside, Details/Who's in/Terms/Lifestyle/About, owner panel holding seat steppers, reissue, edit, requests and delete. Report moved to the detail page; map rows open it. Fixes: `roomTitle` fallback for owner-split rooms with no society (empty card title), title link covered by the card overlay (`drop-shadow` filter trapped its z-index), `property` i18n namespace missing on a cold deep link; the board's debounced URL write bounced a fast card tap back to `/flatmates` while the lazy detail route loaded (now skipped once the path has moved on). code-review fixes: people stepper no longer toasts "added" when the server clamps (new `roomAtCapacity`, + disabled at the flat cap), open-group join reloads seats/members, seeker "verified only" gate + verify modal on the detail page, dead `setRooms`/`patchItems` removed. 314 flatmate/listings/notification/saved e2e: 311 green; after fixes discovery/url-sync/smart-search/detail-page 40/40 and steppers/lifecycle/board 54 green. code-review done. Uncommitted |
| 2026-09-29 | Flatmate detail pages `/flatmates/{group,room,post}/:id` with owner manage panel (status/Edit/Requests/Delete); `GET` by-id endpoints (host sees own pending ad, others 404); all flatmate notifications deep-link via `FlatmateLinks`; group edit (`?editGroup=`, PATCH); card titles + My Listings View link to the page; room "Edit" removed from My Listings (it created a *new* room — room edit is still missing, see Next up). PDF rent-agreement upload covered in `agreement-evidence-browser`. New `detail-page.spec.js`; backend detail 5/5; 349 flatmate/dashboard/notification e2e: 347 green, 2 red already listed (url-sync:41, home-flatmates-tile). code-review done (host consent number was returned masked → edit failed validation; fixed). Uncommitted |
| 2026-09-30 | Flatmate room card Move-in showed a dash: the public feed (`FlatmateRoomFeedDto`) never carried `availableFrom`. Now projected (shape pin + OpenAPI updated, not contact/door data). Backend flatmate + spec tests 290 green; live room specs 9/9 (`room-card-cover` asserts wire + "By 1 Dec" on the card). Uncommitted, PENDING AGENT REVIEW |
| 2026-09-30 | Group posting copy: "We're already a group" → "Start a flatmate group — People ask to join. Find a flat together, or fill seats in yours."; who-step subtitle, group modal subtitle and the flat toggle ("Do you have a flat yet?" / "I have a flat") say the host starts a group others join. e2e selectors + docs updated; 5 posting/group specs 36/36. Uncommitted |
| 2026-09-30 | Flatmate group preferences (V74): a group can team up before it has a flat. The form defaults to "Still looking for a flat" (up to 3 localities, BHKs, whole-flat rent range + live per-head, deposit range, furnishing, move-in month, gated only, bachelors allowed); "We have a flat" keeps the exact-terms form. Hunting groups post as tier `identity`, no property/declaration, `rent` = ceiling, land on Team up; card shows budget range + "N BHK · N sharing", detail page "The flat we're looking for" + owner/member "Find flats for us" → prefiltered `/listings`. Search (board locality/q/radius, saved-search matcher, legacy `GET /flatmates/groups`) matches any shortlisted locality and overlaps the budget range; export covers the new fields. New `FlatmateGroupClaim`, `FlatDescribedUnlessHunting`, `GroupPreferencesFields.jsx`; seed backfills `localities` for housed groups. code-review done (4 fixes: legacy feed, locality slugs, empty draft, off-list move-in month). Backend flatmate+search+spec+export 327 green (`draazy_test_fm2`); related e2e 44/44 incl. new `group-preferences`. `backfill` 88/167/184 red = the seat-resize slice below (spec not yet updated), not this one. `-Full` not run; hi/mr strings missing (locale files absent in tree). Uncommitted |
| 2026-09-30 | Flatmate hold-for-review (V75): `FlatmatePublication.stateFor` self-publishes only unflagged owner tier; tenant/identity posts are born `pending` until Ops Publish. V75 pulled existing non-owner self-published (`live`) rooms/groups back to `pending`; seed demo rows set to `approved`. V76 clears re-check markers on non-public rows. Owner-tier reconcile sweep now sends a demoted self-published (`live`) room/group back to `pending` and tells the host (`flatmate.moderated.held`). Moderator `live` verdict normalised to `approved`; approved posts survive non-foundation edits (identity tier used to re-queue on any edit). Group applications still auto-live (private) - follow-up if wanted. Backend engagement+moderation 1020 green; e2e ops/flatmate-moderation, trust-badges, terms-and-occupancy, review-status, live-alerts-card 31/31. PENDING AGENT REVIEW. Uncommitted |
| 2026-09-30 | Flatmate group seat counts: open seats never exceed seats minus members (`FlatmateGroup.maxOpenSeats`; create/edit clamp, legacy rows clamped on read); the group stepper now resizes the group (`PATCH …/seats` sets seatsTotal = taken + open, cap `MAX_SEATS` 12 → 400, re-checks "seats" on live groups) so share and "N sharing" follow; edit-form seat changes shift open seats by the same delta; "Who's in" shows off-platform filled seats; owner-panel stepper compacted (32px buttons, 44px hit area). Backend flatmate + guard tests 287 green (on `draazy_test_fm2`), live flatmate specs 18/18 (`seat-stepper` rewritten for resize). Uncommitted, PENDING AGENT REVIEW |
| 2026-09-29 | Flatmate room photo limit: already enforced by the shared admin-configurable cap (default 10); `PhotoLimit.require` now names the subject ("A room can have at most N photos"). New `consumer/flatmates/photo-limit.spec.js` (wizard + API). Backend 15 + e2e 8 green (private `draazy_test_photolimit`; shared `draazy_test` has a V65 checksum mismatch, not mine). Uncommitted, PENDING AGENT REVIEW |
| 2026-09-29 | Flatmates copy cut to the point across all flows (board, request/group modals, agreement upload, room wizard, split modal, alert card, map gate, owner-consent OTP, group-apply card, home teaser, post chooser). Sub-let duties condensed to one line (still owner + police + registration). 16 flatmate specs: 123/124 green, the 1 red is discovery:192 (Needs attention). Uncommitted, PENDING AGENT REVIEW |
| 2026-09-29 | Flatmates phone filter sheet: Clear / Show N results pinned like /listings (the old buttons were clipped by `.filter-panel` overflow:hidden), grabber + swipe/Esc dismiss, `.sf-page .filter-panel` padding rule removed. 29 e2e green. Uncommitted, PENDING AGENT REVIEW |
| 2026-09-29 | English-only frontend: hi/mr locales, language switcher, DPDP consent language toggle (user accepted the compliance call), help translations/hreflang/`/hi`,`/mr` help routes (now redirect to `/help/*`), `i18next-browser-languagedetector`, `check-i18n-locales`/`i18n-report` removed; i18next `t()` keys kept. Backend `en|hi|mr` CHECKs/patterns left as-is (accept `en`). 71 targeted e2e green. Uncommitted, PENDING AGENT REVIEW |
| 2026-09-27 | Post-property photos: one picker instead of Add + Take photo (no `capture`, so the phone offers both); guidance quotes `MAX_PHOTOS` (was a stale "10"); orphan root `uploads` locale keys removed. Specs 75/77, 2 skipped. Uncommitted, PENDING AGENT REVIEW |
| 2026-09-27 | Configurable photo limit: `settings.listings.maxPhotos` (default 10, 3-20) editable in Admin Settings > General, public `GET /listing-policy`, enforced on listing create/owner PATCH/moderator PATCH and flatmate room create/edit (strict for legacy >limit galleries); wizard reads it via `usePhotoLimit`. Backend tests + 54 e2e green. Uncommitted, PENDING AGENT REVIEW |
| 2026-09-27 | Dropdown search only from 16 options (`components/ui/dropdownSearch.js`, was 8): photo type, plot zone, sale docs and other short lists open as plain scroll sheets; localities/floors/amenities keep search. 38 e2e green. Uncommitted, PENDING AGENT REVIEW |
| 2026-09-28 | Power of Attorney restored to the listing Ownership dropdown (residential + commercial); retired-option shim removed, backend enum already accepted it; b3-fields asserts it is offered. 47 e2e green. Uncommitted |
| 2026-09-28 | In-flat features merged into the step-1 furniture picker (`FurnitureIncluded.jsx`), shown at every furnishing and titled by it; residential amenities are society-only (Piped Gas joins them); legacy in-flat amenities migrate on draft/edit open and on the detail page (`withInFlatAsFurniture`); an amenities PATCH carries furniture; admin post-on-behalf picker at every furnishing. 96 e2e + 2 unit green; unrelated unit failure `land is asked for a project name` (validation.js, other session). Uncommitted, PENDING AGENT REVIEW |
| 2026-09-27 | /list-property guest who dismisses the OTP sheet: Submit reads "Verify & submit" (flatmate: "Verify & post") and reopens the sheet — auth now checked before the photo floor, which silently failed before |
| 2026-09-27 | /listings filters: every short option list is a 2-column quick checkbox grid (commercial type, land use, amenities + pet-friendly, furnishing, room, possession, available-from, NA, fit-out); only Localities / Near a Place stay dropdowns; long grid labels wrap |
| 2026-09-27 | /listings Rent filters reordered (rent, localities, property type, tenants, BHK, furnishing, available-from first); Preferred Tenants is a checkbox grid |
| 2026-09-27 | Rent food filter is a single pick (Veg only / Jain only / Non-veg OK) end to end; rent wizard offers "Jain Only" |
| 2026-09-27 | Searchable Select/MultiSelect on phones open as a full-height picker ending at the keyboard (`useVisualViewportInsets`); short lists stay bottom sheets. PENDING DEVICE CHECK (iOS Safari + Android keyboard) |
| 2026-09-27 | Facing is four cardinals only (wizard, admin post-on-behalf, search filter as checkboxes); a cardinal search also matches its two corners (`PropertySpecs.FACING_MATCHES`) so older corner listings stay findable |
| 2026-09-28 | Wizard photos reorder by drag (`@dnd-kit/sortable`: press-and-hold on touch, Space + arrows on keyboard); the 44 px move buttons are gone. PENDING DEVICE CHECK (iOS Safari long-press) |
| 2026-09-27 | /listings Property type filter is a checkbox grid like BHK, not a dropdown; filter `set` accepts an updater so fast toggles don't read stale state |
| 2026-09-27 | Toggling a /listings Verification filter on a phone no longer blanks the filter sheet (`VerificationSection` row made `relative`) |
| 2026-09-27 | Ledger queue built out: 277–293, 44, 39b and 42 shipped or superseded (290); Featured is an Owner paid-plan perk (292), the claim link records its first open (43, `V58`), and every concierge `pipeline_stage` has a seed row (293) |
| 2026-09-27 | Decision ledger emptied of open questions: 12 rulings taken with the user, 16 stale rows closed against the code; this file compressed from 1,496 lines |
| 2026-09-25 | Search-flow audit wave 2 — facets and sorts, live home counts, mobile entity search, inline OTP sheet (`c89da3a5`) |
| 2026-09-25 | Search-flow audit wave 1 — trust and disclosure, real visit booking, alert matcher, search correctness, flatmate URL state, mobile filter sheet (`26b71b39`) |
| 2026-09-26 | Fast e2e: `e2e\run-fast.ps1` runs only the specs related to the diff (class-level backend dependents → endpoint patterns; unresolved → full), `-Failed` reruns failing tests by `file:line`, `-Full` spreads the suite over 4 isolated shards (own JVM/port/DB/storage each, duration-balanced, timeouts ×2). A green run needs every listed test reported by identity, no errors and every process exiting 0. 13/13 smoke green; full run 89 min on a dirty tree. PENDING VERIFICATION: a clean `-Full` green once the photo/rent-agreement work lands |
| 2026-09-23 | Drafting desk runs the whole workflow: share draft / upload registered copy / reply / files list (`service-queue/*`), cancel requires a reason that reaches the customer's thread + `service.cancelled` bell (`ServiceRequestStaffTransitions`), internal notes on `service_request` (V38), 24h/72h + 4-month registration ageing, `unassigned` + anchored `q` search, and a staff Take of a colleague's matter is a 409 (admin exempt). Backend 199 green, `drafting-desk` 15/15 + `service-draft-review` 4/4. PENDING AGENT REVIEW: the `code-review` agent finished but its output could not be read back; reviewed by hand |
| 2026-09-22 | `open-questions.md` stopped lying about five of its own entries. The file's lifecycle rule says a question moves to CLOSED when it is answered, but nothing enforces it, so a question stays OPEN forever unless someone remembers — and **an answered question sitting under "blocking specific work" reads as a blocker, which is worse than no ledger**: it invites the work to be re-argued from scratch. Q2 (`hide_number` shipped in V31, then overtaken by `ContactGateService`'s global mask-everyone policy, so the preference is a deliberate no-op) and Q13 (per-account, narrowing-only, over `GET /admin/permission-catalogue`, shipped as D192) were closed outright; both name tech-debt rows that no longer exist in the register, which was the tell. Q14 already said CLOSED but sat in the open section and pointed its SLA residual at **D76, also deleted** — so that residual was tracked nowhere and now says so. Q19 was narrowed: `TenancyRevocationIsForwardOnlyTest` pins retraction as ruled out (option 2 shipped), leaving only the badge-drop and card copy. Q20 later closed when the staff-account approval queue was removed for single-admin bootstrap. Every verdict was checked against the shipped code, not against the prose that claimed it |
| 2026-09-22 | The report-reason mirror is now enforced rather than asserted. Both sides' docblocks claimed `frontend/scripts/report-parity.mjs` diffed them; that script had been **deleted**, which is worse than never having had one — an unenforced obligation everyone believes is enforced. Folded into `check-enum-vocabulary.mjs` (57 → 67 checks) rather than resurrected as a second script, parsing the four `Set.of(…)` literals with `OTHER` substituted first, since a bare `"([^"]+)"` scan would have reported four identical phantom failures. `FOR_REVIEW` is asserted at size 3 rather than skipped, so building a review picker fails the build and sends you to the pairs above it. Mutation-proven in **both** directions before being trusted — a gate that has never failed proves nothing |
| 2026-09-22 | Five dead ends removed. `ENQUIRY_STATUS_OPTS` dropped `new`/`open`/`responded`/`closed` (a picker offering four options that select nothing, because the API emits only `pending`/`approved`/`declined`) and `AWAITING_STATUSES` narrowed to `['pending']`; `docs/flows/admin/enquiries-funnel.md` §5.2/§5.4/§7 followed the code. A `!startsWith('TR')` ticket guard went — `Ticket` ids are UUIDs and "TR" is not hex, so the branch was unreachable. A `dz-convs-change` listener pair went, having no emitter anywhere in the repo; the sibling `storage` listener that actually carries the cross-tab signal stays. `mockDispatch` → `inertDispatch`. `frontend/src/data/faqs.json` deleted — FAQs come from the API |
| 2026-09-22 | Working files de-mocked and pruned. 44 scratch console captures deleted (10.4 MB) and `.gitignore` taught to catch `/backend/*.txt` and `/e2e/*.txt`, which `*.log` never did because the habit is `> run.txt`. 306 stale mock citations swept out of 135 `frontend/src` files — comment-only, proven by comparing acorn token streams against HEAD. `COVERAGE.md` 935 → 869 lines with its spec counts re-derived (322 → 325; flatmates and mobile had both drifted) |
| 2026-09-22 | Documentation consolidated now the backend migration is done: ~4,300 doc lines retired against ~590 added. `docs/migration/` and `docs/misc/` are gone; `06-code-quality.md` moved to [docs/system/code-quality.md](../docs/system/code-quality.md) and every inbound pointer was repointed first |
| 2026-09-22 | `homeTypeLabel` reaches the server: a new `FlatmateVocabulary.HOME_TYPE`, a V35 CHECK, the OpenAPI enum and the client `VOCAB` mirror carry the same four tokens, and both pill writers default from one `HOME_TYPE_PILLS` list. 14 fixtures repaired onto a shared `FlatmateAgreementFixture.EVIDENCE` |
| 2026-09-22 | Two owner-consent residuals: a per-caller OTP quota (`requested_by`, V33, `MAX_CALLER_SENDS_PER_WINDOW = 5`, counted per purpose family) and auto-approval comparing `society_id` rather than the postcode, falling back to locality. Groups still fall back, stated in Needs attention |
| 2026-09-22 | Flatmate edit re-moderation keys off *what changed*, not off who the host is: `FlatmateEditRules` across all three supply shapes, a `ModerationRecheck` `@Embeddable` (V27), and an Ops queue carrying the room's photos with the host's mobile masked. 21 backend cases, one e2e case |
| 2026-09-21 | Flatmate trust badges read one verdict: the duplicate `verified` column dropped (V26), tier plus the standing verdict answering filter, card and map, `propertyId` reaching `deriveTier` on both write paths, and an hourly sweep plus `POST /admin/flatmate-reviews/reconcile-owner-tier` re-asking every standing owner claim. Backend 158/158, `live-trust-badges.spec.js` 5/5 |
| 2026-09-20 | The property detail page's touch behaviour: decorative `:hover` gated on fine pointers, the lightbox on `dvh` with four-sided safe-area padding, and the hero converted to a `snap-x snap-mandatory` scroll container with the request-photos overlay as its last slide. One spec (10 cases), two COVERAGE.md rows |
| 2026-09-19 | Smart search keeps what the shopper typed: parsed facets merge into the live filters, the unparsed remainder rides as `?q=` and a removable chip, and `publicTextSearch` widened to title + locality + society slug + property type, matched word by word. One e2e spec, three `CatalogEndpointsTest` cases |
| 2026-09-19 | Four filter-correctness bugs in the property search: an impossible facet sends `PropertyPossession.UNMATCHABLE` instead of returning the whole catalogue, nullable `ageYears`/`floor`/`area` survive a range filter and are counted as `unstatedElements`, a cleared radius keeps its centre, and locality names are escaped. Four specs, three `ListingSearchTest` cases |
| 2026-09-19 | Owner-supplied floor plans on buy and rent, residential and commercial: the plan reaches `ListingCreate` and the edit wizard's `FIELD_INPUTS`, and a PATCHed plan must already be one of the listing's own photos (422). Four cases in `frontend/scripts/listing-edit-prefill.test.mjs`, one e2e case. Land deliberately untouched |
| 2026-09-19 | The 25 red mock-mode e2e specs: 25 fixed, 0 outstanding. A wide `tests/admin` + `tests/consumer` run reported 29 failed / 821 passed and a serial re-run reproduced 27, so they were not worker contention — but a worktree at `cd1018c` produced an identical failure list, so **none of it was a regression**, including `tenant-profile.spec.js:73` |
| 2026-09-19 | Commercial listings — the field set, and the required/optional rules per flow. Code, gates and Playwright green |
| 2026-09-19 | Open Plot and Farm Land — the right fields per flow. Code and gates green, 4/4 |
| 2026-09-19 | Open Plot and Farm Land — the Maharashtra answers a buyer cannot proceed without |
| 2026-09-19 | Open Plot and Farm Land — the minimum a parcel is genuinely able to state |
| 2026-09-19 | Property detail, mobile density pass |
| 2026-09-15 | A failed OTP *send* renders a translated sentence rather than `err.message`: `classifyOtpSendError` (sibling of `classifyOtpVerifyError`) on all four OTP surfaces, and the two `signin-otp-session` specs assert the translation instead of the server's English |
| 2026-09-14 | The admin "Ownership document checks" panel rebuilt as a four-step case file: a tone-switched verdict banner carrying *Still required*, `VerificationSummary` split into `VerdictBanner` + `RecordedEvidence`, captioned `Select`s with an `ariaDescribedBy` passthrough, and Record/Grant as separate numbered steps |
| 2026-09-14 | Ownership Verified badge (D190/Q15) — verified, not partial. The wizard-side half a previous session had logged as still pending was already written; it had simply never been compiled or run |
| 2026-09-12 | D262 — the rent-agreement wizard opens step 0 only; steps 1–5 sit behind a sign-in line, with `useFormDraft.flush()` before the gate navigates and `next` carried through both sign-in and sign-up. 7 ✅, four COVERAGE.md rows |
| 2026-09-12 | Flatmate seed ported from `flatmates/constants.js`: rooms 2 → 13, groups 8 → 13, members/reviews/requests/saves/applications/consents 0 → 15/3/4/4/2/1 |
| 2026-09-08 | The Flatmates board's two floating controls on a phone: the hero "Post" deleted (one posting CTA per width) and Filters moved into the same bottom-left `.filter-fab` capsule the listings board uses |
| 2026-09-06 | One posting sheet behind both the bottom-bar `+` and the Flatmates hero "Post" — and the `z-[90]` that had every modal in the app painting under the DPDPA consent bar |
| 2026-09-01 | The buyer's half of the document gate is on the server (D123 closed): `POST /documents/requests`, `GET /me/document-requests`, the viewer moved to `/view-documents/:requestId`, and `lib/data/viewDocuments.js` deleted. `DocumentRequestFlowTest` 33/33, contract floor 261 → 262. Commit `61015de1` |
| 2026-09-01 | The `document.granted` notification points at `/view-documents/{requestId}` rather than at the listing (register 37); past `GRANT_TTL` the viewer answers one neutral "Access not available" for all four refusals. `robots.txt` deliberately left alone |
| 2026-09-01 | The flatmate interest notification no longer reads "null is interested in your room in Baner" — nullable `users.name` falls back to "Someone", as `OfferService` and `ConversationService` already do. Three tests in `FlatmateEditAndInterestEndpointsTest` |
| 2026-09-01 | The five remaining legacy `tests/ops/*.spec.js` are deliberate mock-mode residue and now say so in their headers; `/ops/referrals` stopped justifying its own shutdown with a disagreement **D31b** had already reversed, in all four places that stated it. Mock ops 14/14, live referrals 5/5 |
| 2026-09-01 | `SocietyMembershipService` split by use-case after the certificate read pushed it past `ServiceSizeGuardTest` — residency stays, claiming moves to `SocietyClaimService`. The BASELINE escape hatch was deliberately not taken |
| 2026-09-01 | Ledger 35 (`GET /geo`) shipped and closed in the decision register |
| 2026-08-23 | `consumer/account/notifications.spec.js` → `notifications.spec.js` (7 ✅), asserting the inbox at the wire through a second API client. It found `toUiType` carrying no entry for `match.saved-search`, the only spelling `SavedSearchService.alert()` emits. Commit `20ff3dd` |
| 2026-08-21 | The society merge and the claim certificate have a server (`da957af`). Merging is `/admin/society-merges` (V111) and is a pointer rather than a move, which is what makes the undo possible. The certificate is `GET /admin/society-claims/{id}/certificate`, keyed by the claim so that `societies:read` never becomes a key to arbitrary personal documents |
| 2026-08-20 | The three society gaps opened by `87f2d07` are closed on the server: `GET /admin/society-residents` (read-only), `registrationNo` and `certificateDocumentId` back on claims (V109), and `mint_origin` (V108) as a separate axis from `source` |
| 2026-08-20 | Rent-agreement co-fill (V107) — backend `b7bc2fa`, frontend seam, wizard and live e2e `499732d`, 5/5 green in the live service-request block. The run earned its keep: it caught `http/serviceRequestMapper.toViewModel` dropping `parties` on the wire, which no mock spec could have seen, since the mock builds its own party list |
| 2026-08-19 | Ledger 20 (finance console) shipped and verified (`023c311`) |
| 2026-08-17 | Every open migration decision closed; the 1,975-line register collapsed to a 205-line ledger |
| 2026-08-16 | Admin command palette stopped searching `db.json` fixtures on live builds |
| 2026-08-16 | D230–D234, and the closing summary of the autonomous window (`8cecfe5`..`45f9168`) |
| 2026-08-16 | D227–D229: the 36-row `mockApi.js` importer table, and its two corrections |
| 2026-08-16 | D226: the `ui-only` census bucket — routed screens that fetch nothing |
| 2026-08-16 | The route census (227 resolved / 35 unreached), now a committed script, and 195 dead exports |
| 2026-08-15 | D225: 105 sleeps and 122 `networkidle` calls triaged; the eight silent-skip guards |
| 2026-08-15 | D223/D224: the test-quality sweep and its corrections — what a green suite was hiding |
| 2026-08-15 | The `rawDb`/`mutateDb` cluster and the `fee()` survey, both closed |
| 2026-08-15 | Wave 4a: "Anonymous" → "Withheld", and the reason labels that had forked in five places |
| 2026-08-15 | D217: the propertyReview mock that copied the business rules and not the access rules |
| 2026-08-14 | D218: ordering column, duplicate detector, staff-only note lane — and four ways the green suite lied |
| 2026-08-14 | D219: the owner listing wizard onto the seam; six ways a never-run suite had rotted |
| 2026-08-14 | Wave 4: masked fields made read-only; `/admin` ruled administrator-only |
| 2026-08-13 | D216: outbound messages and templates, classified by the DPDP erasure guard |
| 2026-08-13 | Phase 5 pre-port audit — `permissions.js` and `contact.js` need no port, both already enforced server-side |
| 2026-08-13 | Debt wave 14: four e2e sweeps that died to infrastructure; the flaky set re-derived |
| 2026-08-13 | Phase 3: the referral retention sweep that had never once run; `punenest_test` reference data restored |
| 2026-08-13 | The prod profile became a tested contract; the container can be told its port |
| 2026-08-12 | Debt wave 10: seven write-disjoint lanes, ten register rows closed |
| 2026-08-12 | D133 closed won't-do; D158 re-verified still blocked — both measurement tasks, both registers wrong |
| 2026-08-11 | Debt wave 11 close-out: six register rows; debt wave 9: six lanes and the register's last High |
| 2026-08-11 | D193/D195/D198: a 404 that claimed to be a 500, an invented star rating, thirty unnamed buttons |
| 2026-08-11 | Society reviews get their own aspect vocabulary; Q14 answered — the foundation set splits |
| 2026-08-11 | D174, D175, D50/D51, D100, D42 and the e2e reliability pair (D28/D29) |
| 2026-08-10 | D79 wired up, plus the two defects hiding behind it; D163, D132, D47, D129 (partial) |
| 2026-08-09 | D77 paged inbound demand; D151 identity numbers reach one operator and stop existing |
| 2026-08-09 | Payment hardening (D169–D172); every payment family got the cap and the sweep (D160/D161) |
| 2026-08-09 | Paid Leave & License, and the thirteen register rows its review opened |
| 2026-08-09 | Eight decision-blocked register items closed; open-questions Q1–Q5 answered |
| 2026-08-08 | Encoding guard restored (D126); the contract's schemas enforced, not just its routes |
| 2026-08-08 | D144: nine shipped-but-undeclared endpoints declared; D145: catalog tests re-baselined against the seed |
| 2026-08-08 | D111/D112/D119/D109/D116/D97/D127/D113 — the flatmate and deals defect batch |
| 2026-08-06 | Worklog compression 5,294 → 527, and the OpenAPI 3.1 `nullable` fix (66 fields typed non-null) |

### The seam — 18 domains

| Date | Domain | The thing worth remembering |
|---|---|---|
| 2026-08-09 | Flatmate moderation | A visibility blacklist is a leak waiting for the next state |
| 2026-08-08 | Documents (17) | Multipart: a `FormData` body must not get a `Content-Type` header |
| 2026-08-08 | Identity verification (18) | `POST` is a 202 pending handle, not a granted badge — the webhook grants |
| 2026-08-08 | Service requests (16) | `details` was write-only until it became a real `jsonb` column |
| 2026-08-08 | Catalogue seed | 348 societies / 155 localities, generated from frontend data and FK-validated |
| 2026-08-07 | Flatmates (15) | Seats are set by the host, never inferred from `members.length` |
| 2026-08-07 | Rent and tenancies (14) | Paying rent yields `due`, not `paid`; the payout account returns a mask |
| 2026-08-07 | Deals and offers (13) | Every signature dropped its `ownerMobile` — that parameter was the caller naming whose data to read |
| 2026-08-07 | Subscription plans (12) | First domain read during render, so it is held in `PlanContext`. `pending ≠ active` |
| 2026-08-07 | contact/saved/savedSearch/visit | Shipped complete but absent from `VITE_API_DOMAINS`, so every live run had exercised their mocks |
| 2026-08-07 | Abuse reports (11) | Reason set is validated *against* target type; duplicate → 409 |
| 2026-08-07 | Support tickets (10) | Three controls had nothing behind them, so they are hidden in http — an unknown field is ignored, not rejected |
| 2026-08-07 | Reviews (9) | `context` is server-derived and readOnly; `avgRating` is null, not 0 |
| 2026-08-06 | Conversations (8) | Attributing by display name breaks the first time two users share a name |
| 2026-08-06 | Notifications (7) | Server and UI type vocabularies had zero overlap; every filter chip would have emptied the page |
| 2026-08-06 | Listing moderation | Four writes had shipped with no read that could find a listing to act on |
| 2026-08-05 | Visits (6) | The seam carries the human `when` string and converts to the wire's ISO slot |
| 2026-08-05 | Saved searches (5) | `POST /me/saved-searches` 401s for exactly the signed-out visitor the card exists to capture |
| 2026-08-04 | Saved shortlist (4) | Membership answered from `SavedContext`, never per card — 30 requests to draw 30 hearts |
| 2026-08-04 | Contact gate (3) | Keyed on `propertyId`: the grant is per listing, not per owner |
| 2026-07-30 | Property (2) | `construction`/`possession` broke a feature rather than degrading it — fixed in the contract |
| 2026-07-29 | Auth (1) | Established the provider pattern and the parity-harness habit |
| 2026-07-28 | Phase 2a | 21 files imported `lib/` directly; a seam with a bypass is not a seam |

### Backend slices — OpenAPI-first, 208 operations

| Date | Slice |
|---|---|
| 2026-08-07 | Tech-debt pass — D90, D82, D19, D22, D83, D86, D97(d), D95; the register's own numbers were the least reliable thing in it |
| 2026-08-02 | Tech-debt batches — Lombok, concurrency, register audit |
| 2026-08-01 | 15 share-flat + admin listing correction · 14 Admin & Analytics (revenue blanked for staff) |
| 2026-07-31 | 13 Billing & Growth · 12 conversations + support tickets · 11 service requests + staff queue |
| 2026-07-30 | 10 Documents (storage keys server-minted, content type derived from bytes) · 9 Moderation |
| 2026-07-29 | 8 Reviews · 7 Catalog & Search, pagination and OTP rate limiting — every sort index-backed |
| 2026-07-28 | 5 finance ledger + tenancy · 4 deals/offers/visits |
| 2026-07-27 | 3 contacts + gate + Aadhaar badge · 2 properties (slug-or-id resolution) |
| 2026-07-26 | 1 auth + users · bounded-context package layout |

### Database, mobile, trust, docs

| Date | Change |
|---|---|
| 2026-08-04 | One populated local DB, schema by Flyway only. Three permanent Flyway traps recorded in `R__zz_dev_demo_data.sql`'s header |
| 2026-08-05 | Mobile review B5/C5/D1 + CI; Home "Flatmates" tile |
| 2026-08-02 | Bundle: 571 KB off first paint — `financeProvider → finances.js → jspdf` was statically imported *and* preloaded |
| 2026-08-02 | Mobile Phase 4 incl. PWA and landscape; Phase 6 deferred-item sweep |
| 2026-08-01 | Home Phase 3 featured-first via CSS `order`, leaving DOM order untouched; Phase 2 waves H–R |
| 2026-07-31 | Mobile Phases 1/3/4/5; "Share Flat" → "Flatmates" (enum values stay `'share'` — renaming would orphan localStorage) |
| 2026-07-28 | Badge-not-gate migration, 8 pages (ADR-019); KYC growth levers; DigiLocker consent flow |
| 2026-07-27 | Trust model pivot documented; 3-way sync `platform-architecture.md` → OpenAPI → React |
| 2026-07-26 | OpenAPI established as the single source of truth |
| 2026-07-25 | Platform & solution architecture (MVP), ADR-009a KYC, ADR-014 payments, legal/compliance advisory |
