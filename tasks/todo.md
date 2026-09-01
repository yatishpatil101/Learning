# Worklog

> **A finished slice gets one index line here, not a narrative.** Git history is the archive; this
> file is the index into it. Open work gets a bullet, and the bullet is deleted the moment it is
> fixed or moves into a numbered ledger row. Do not restate a decision here — link to its number in
> [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md). Compressed 5,294 → 527 → 1,828 → 4,348 → this.

Where things live:

| Topic | File |
|---|---|
| Open decisions and the damage-ordered work queue | [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md) |
| Durable rules learned the hard way, and house style | [tasks/lessons.md](lessons.md) |
| Tech debt | [docs/system/tech-debt.md](../docs/system/tech-debt.md) |
| Unanswered product questions | [docs/system/open-questions.md](../docs/system/open-questions.md) |
| The frontend data seam | [docs/system/frontend-data-seam.md](../docs/system/frontend-data-seam.md) |
| Migration plan and phase status | [docs/migration/README.md](../docs/migration/README.md) |
| e2e coverage matrix (hard gate) | [e2e/COVERAGE.md](../e2e/COVERAGE.md) |

---

## In flight

### Phase 5 finish plan

- [x] **Lock the remaining Phase-5 decisions** — done 2026-08-22. Geo/cities is server-owned end to
      end (register 38); the audit tab stays read-only (39); post-on-behalf stays visible on Staff
      Activity (40); Sonar is the Phase-5 target and the Checkmarx-vs-CodeQL choice is explicitly
      deferred past functional close (41).
- [ ] **Finish the real admin migration debt** — convert/delete the remaining live-worthy admin
      specs (`properties`, `consolidation`, `finance`, `post-on-behalf`, `post-on-behalf-fixes`,
      `localities`, `property-recheck-queue`, `enquiries`, `settings`, `finance-disclosure`,
      `societies`, `maps-geo`, `duplicates`) and leave only deliberate mock-side keepers.
- [ ] **Clear the last cross-cutting live runtime pins to mock code** — consumer/service entry
      points, city propagation/runtime geo, staff login, admin dashboard/topbar helpers, and the app
      boot path (`main.jsx`) so a live build no longer needs the mock store to exist.
- [ ] **Burn down the remaining consumer legacy suite by dependency cluster** — services/read-mostly
      flows first, then property/search/account, then the stateful flatmates/list-property/society
      remainder.
- [ ] **Finish the last platform holdout and flip the default config** — `platform/city-propagation`
      live or intentionally retired, then `playwright.config.js` points at the live backend.
- [ ] **Delete the mock in one controlled cut (P5c)** — remove `services/providers/mock/*`,
      `lib/mockApi*`, the mock-only stand-ins in `lib/data/**`, the Vite mock-persistence route, and
      the deliberate mock-only keeper specs once nothing live depends on them.
- [ ] **Hardening / close-out** — backend tests in CI, Sonar wired, scanner decision recorded,
      bundle measured before/after the deletions, and docs/coverage brought to the true live end-state.

**Admin wave (P5b) — in progress.** `tests/ops` needed no wave at all (see below). `tests/admin`
now has **20 legacy files** left after `analytics` and `content` moved. The first pass that sized
this wave over-counted real debt: several of those files are now verified to be deliberate mock-only
keepers rather than conversion work — `command-palette`, `flatmate-moderation-reach`,
`societies-queues`, `services-moderation`, `flatmates`, `listing-freshness`; and `notes` is a
mock spec **as well as** a live one by design, because it catches the same validation rules in a
seconds-fast suite while `live-notes` proves the seam reaches Postgres and survives a second
account. The remaining *actual* conversion work is smaller than the raw file count makes it look.

The expensive ones are still the seeders — `post-on-behalf-fixes` (6 seed sites),
`property-recheck-queue` (5), `post-on-behalf` (4).

- ✅ **`analytics` (21 tests) → `admin/live-analytics-page.spec.js`.** Its header claimed Geography
  and Seasonal both computed in the browser and the file would follow "when they follow"; Geography
  has been live since register 36 and Seasonal is illustrative **by decision**, so there was no
  event to wait for. The sibling `live-analytics.spec.js` keeps the endpoint contracts and the two
  UI discriminators that prove the page is not silently on the mock. 34/34 live, coverage gate
  clean. The conversion earned its keep immediately: a page-wide "no `0h`" assertion failed,
  because `0h` is legitimately on the SLA tab from the generated Service Fulfillment and Concierge
  panels — invisible under the mock, and now scoped to the `Avg time to review` tile.

- ✅ **`content` (7 tests) → `admin/live-content-desk.spec.js`.** This desk had live data paths on
  both halves already — `adminContentService` for banners / FAQs / announcements, and `reviewService`
  for the Reviews tab — so the mock file was a real gap rather than a deliberate hold-back. The
  existing `tests/live-admin-content.spec.js` already owned the seam and the two Reviews-tab console
  decisions, so the conversion split cleanly: the sibling keeps the contract and moderation queue,
  the new file owns the four-tab shell, the banners counter, the FAQs tab, the create form and the
  route guards. The run earned its keep immediately: the mock spec's happy-path create filled only a
  headline and passed, while the live API answered `422 A banners item needs 'image'`; the desk now
  pins that refusal, names the offending field, and keeps the dialog open. Verified: 17/17 green
  across both live content specs together.

Remaining conversion targets, largest first: `properties` (39), `consolidation` (14),
`finance` (14), `post-on-behalf` (12), `post-on-behalf-fixes` (10), `localities` (9),
`property-recheck-queue` (9), `enquiries` (9), `settings` (7), `finance-disclosure` (7),
`societies` (6), `maps-geo` (4), `duplicates` (1). The other legacy admin files now have an
explicit reason to stay mock-side and are no longer counted as migration debt.

**Mock retirement.** All 18 seam domains have live consumers. Phases 0–4 are done; Phase 5 (retiring
`lib/mockApi.js` and the `lib/data/**` stores) is in progress. Remaining work is enumerated as
numbered rows in the ledger, in damage order. The consumer-first slice just closed is rent-agreement
co-fill: deferred checkout, an invite addressable to an **unregistered** mobile, and party-side
details submission. Written end to end; the live e2e run is the outstanding step.

Two things that are true and are not going to change soon:

- **The Cashfree sandbox-verify gap has no possible e2e.** The mock provider returns no
  `paymentSessionId`, so no automated run can reach the hosted checkout. It stays manual.
- **`PUNENEST_DEV_MACHINE` is mandatory for the `dev` profile.** The backend refuses to boot without
  it. It is set per machine, not in the repo.

### Closed recently

- **The ops folder needed no conversion wave, and one of its five specs was pinning a lie.** All
  five remaining legacy `tests/ops/*.spec.js` are deliberate mock-mode residue — route guards, which
  are properties of the router, and the "this desk needs the live API" panels, which are mock-mode
  truths that exist nowhere else. Each carries a header saying so and dies with the mock provider at
  P5c. What the read *did* find is that `/ops/referrals` justified shutting itself with a
  disagreement that no longer exists: "pays a perk where the server pays rupees" was reversed by
  **D31b**, which moved the server onto the browser's unit, so both pay owner contacts now. The
  claim survived in four places — the operator-facing panel, `http/referralProvider.js`'s header
  (which contradicted its own next paragraph), `ReferralDto.rewardAmount`'s `@param`, and the mock
  spec asserting the panel word-for-word, which is what held it in place. All four now state the
  half that survived: the mock grants a listing slot by looking the referrer up on a phone number
  the wire no longer carries. Verified: mock ops 14/14, live referrals 5/5, backend compile, lint
  0 errors, i18n OK.

- **The buyer's half of the document gate is on the server (D123 closed).** Uncommitted at the time
  of writing; verified below. `POST /documents/requests` now carries the buyer's *whole* category
  scope in one row, `GET /me/document-requests` is their status source, and the new
  `GET /me/document-requests/{reqId}/documents` is the signed-in read. The viewer route moved from
  `/view-documents?o=<owner mobile>&r=<id>` to `/view-documents/:requestId`, and
  `lib/data/viewDocuments.js` — which read another user's `localStorage` by owner mobile — is
  deleted.

  > **The bug this closes is a consequence of a masked field, not of a missing endpoint.** The old
  > path filed the request under `p.ownerMobile`, which on a live detail read is *masked* until the
  > contact gate is passed, while the owner's dashboard reads its inbox under the real number. Every
  > live document request was therefore filed where its owner could never see it — and the seeded
  > mock spec could not notice, because a mock has no reason to mask anything from itself.

  Three things worth knowing before touching it again. (1) **`shareToken` stays owner-facing.** The
  obvious fix — hand the buyer the token — would have made their own request list a bearer
  credential; the signed-in route gives them the read with nothing forwardable. (2)
  **`sharedDocumentCount` counts files, not categories**, because an owner can approve "Sale Deed"
  before uploading one, and the UI has to tell that honest zero from a usable grant; it is zeroed on
  the requester projection unless the row is granted. (3) **`expired` is derived at read time** from
  `expiresAt`, so the status the list shows and the refusal the document read gives cannot disagree.

  A security review (`security-reviewer`) returned no CRITICAL or HIGH and two worth acting on, both
  applied: `request()` answered a **buyer-facing** POST with the *owner's* projection — not
  exploitable, since only `grant()` writes a token and it moves the row out of `pending` in the same
  call, but it made the redaction a property of a status invariant two classes away instead of the
  by-name projection the mapper's own Javadoc claims; and `myAsks` counted the vault for every row
  before the mapper discarded the non-granted ones, so it now narrows to granted first. The
  reviewer's other three findings were verified and left: a nullable `documents.category` with no
  writer that can produce one, an ASCII-only case-folding difference between the Java count and the
  SQL read, and the mock provider's `localStorage` scan, which `config.js` cannot reach in http mode.

  **Verified:** backend `DocumentRequestFlowTest` 33/33 and `SpecCoverageTest` 3/3 (contract floor
  261 → 262); `document-parity.mjs` PASS; `npm run check:i18n` OK (4,484 keys × 3 locales);
  `npm run lint` at the 0-error baseline; mock e2e `doc-requests-grant` + `view-documents-flow` 4/4;
  live e2e 6/6 with `live-verification-disclaimer` (which shares the domain) and the
  `live-property-integration` vault round-trip re-run for fixture collision.

  **Deliberately not done:** the new endpoint is new, so there is no old code for its live spec to
  go red against — the regression proof is `SpecCoverageTest`'s floor moving, which fails if the
  route is removed. The **owner** inbox's `sharedDocumentCount` is deliberately *not* status-gated;
  every file it counts is in a vault that caller owns.

  The `document.granted` notification now points at `/view-documents/{requestId}` rather than at the
  listing (register 37). It could not before — the viewer route was keyed on the owner's mobile, so
  the divergence from the mock was forced rather than chosen. The accepted cost is that a
  notification outlives its grant, so past `GRANT_TTL` the link 404s; the viewer answers that with
  the neutral "Access not available" and a way out. That copy is deliberately the *same* for all
  four things the endpoint refuses — pending, lapsed, unknown, foreign — since a screen that tells
  them apart undoes the shared 404. An earlier draft read "Access has ended", which the stranger
  test caught: it confesses that something was once there.

  Two stale references were swept for and one was left on purpose. `gen-checklist-xlsx.mjs` now says
  `/view-documents/:requestId`, matching the `:slug` convention the rest of that table already uses.
  **`robots.txt` was left alone**: its line is `Disallow: /view-documents.html`, and so are all
  eleven others — `/dashboard.html`, `/saved.html`, `/signin.html` and the rest. The file is
  prototype-era in its entirety and there is no `frontend/public/`, so Vite does not ship it; it is a
  launch-time artifact needing one rewrite against the real SPA routes. Correcting a single line
  would leave it *more* misleading, by implying the other eleven had been checked.

- Ledger 20 (finance console) is shipped and verified (`023c311`).
- Ledger 35 (`GET /geo`) is shipped and closed in the decision register.
- Rent-agreement co-fill (V107) — backend at `b7bc2fa`, frontend seam, wizard and live e2e at
  `499732d`. Run and green: 5/5 in the live service-request block. The run earned its keep — it
  caught `http/serviceRequestMapper.toViewModel` dropping `parties` on the wire, which no mock spec
  could have seen, since the mock builds its own party list.
- **The three society gaps opened by `87f2d07` are closed on the server.** The cross-society
  residents queue is `GET /admin/society-residents` (read-only: deciding stays on the per-society
  route that already owns the one-verified-resident-per-flat rule). Claims carry `registrationNo`
  and `certificateDocumentId` again (V109). Mint provenance is `mint_origin` (V108), a separate axis
  from `source` rather than an extension of it, and null on every row minted before it existed —
  which the candidates chip now renders as nothing rather than guessing.
- **The society merge and the claim certificate have a server** (`da957af`). Merging is
  `/admin/society-merges` (V111) and is a pointer rather than a move, which is what makes the undo
  possible. The certificate is `GET /admin/society-claims/{id}/certificate`, keyed by the claim so
  that `societies:read` never becomes a key to arbitrary personal documents.
- **`SocietyMembershipService` is two services.** Adding the certificate read pushed it to 469
  lines and `ServiceSizeGuardTest` refused the build. It was split by use-case rather than by layer:
  residency stays in `SocietyMembershipService`, and claiming — `claim`, the ops queue, the
  certificate and the decision — moved to `SocietyClaimService`. The seam was already there, since
  "does this person live here" and "does this person speak for the building" are decided by
  different people on different evidence. The BASELINE escape hatch was deliberately not taken.

## Needs attention

Open items with no ledger row. Anything covered by a decision is cited, not restated.

**Two `consumer/property` mock specs will not be converted, and should not sit in the queue as if
they will.** Both were read in full and the reason is the same in each case: there is no server
behaviour behind them to point a live spec at.

- **`dedup.spec.js`** opens a blank page and then `await import('/src/lib/data/propertyIdentity.js')`
  and `/src/lib/imageHash.js` inside `page.evaluate`. It is a unit test wearing a browser: no route
  is visited and no request is made, so "converting" it would mean inventing a page for it to run
  on. The server-side half of the same protection is already covered live by
  `platform/live-own-duplicate` (COVERAGE.md:264). Its correct home is Vitest, and moving it there
  is a separate piece of work from this migration.
- **`detail.spec.js`** exists to prove the detail route survives malformed records — it publishes
  `{ id: 'P-notype', type: undefined }` and `{ createdAt: undefined }` and checks the page still
  renders. A validating server cannot return either shape, so live the test would assert that a
  situation which cannot arise is handled, which is not a fact about the product. Its third test is
  a pure-function check on `lib/format.js` and belongs with the other two in Vitest.

Recorded here rather than left silent because "not yet converted" and "will not be converted" look
identical from the outside, and the difference is the whole value of the note.

**Society ops console — what the migration could not finish** (opened by `87f2d07`)

- **Society review reports are not in the society console.** A review is reported as a plain `review`
  and is indistinguishable on the wire from a property review, so the console filters to
  `contribution|reply|question|answer|board` and society reviews stay in Admin ▸ Reports. Splitting
  them needs a target-type the reporter does not currently send.
- **Outstanding on the two migration commits** (`3e53d87`, `87f2d07`): the reviewer-agent pass and
  the `/simplify` pass. The `live-*.spec.js` and its `e2e/COVERAGE.md` row are done
  (`admin/live-societies`, 9 tests). Verified so far: full lint at the 0-error baseline, and 20/20
  parity harnesses green.
- **Two readers on `/admin/societies` are still the client catalogue.** ~~Three~~ — the **merge
  picker** was the load-bearing one and is now fixed: `searchSocieties` moved to the
  `societyService` seam over `GET /societies?q=`, so an operator can merge one freshly-minted
  duplicate into another and `live-societies.spec.js` no longer bends around the gap. The **overlay
  editor** now has a server behind it — V112 gave `societies` an `admin_note` column and `PATCH
  /admin/societies/{slug}` writes it — and the editor is repointed onto that route, so the edit is
  real rather than a note this browser keeps to itself. What remains is the **Directory tab** (`allSocieties()` + `resolveSociety`), which still enumerates the bundled
  348 rows. That one is a different problem from type-ahead: the tab wants the *whole* catalogue,
  not a ranked head, so moving it means paging the admin table off the server rather than swapping
  a lookup.
- **`societies:write` is bypassable on the residents decision path.** `PATCH
  /societies/{slug}/residents/{id}` guards on *role* (`isStaff`) rather than on the permission atom,
  because the other legitimate reviewer is a committee member, who holds no staff permissions at
  all. The effect is that an ops account granted `societies:read` and deliberately not
  `societies:write` can still verify and reject residencies. Pre-existing, and a policy call rather
  than a bug: the fix is either a second atom the committee path can satisfy, or accepting that
  residency review is role-gated and saying so in `cross-cutting.md`.
- **`useSocietyHub.js` sends a preview object where a URL is expected.** The photo contribution
  passes `cForm.photo` — the whole `{name, size, mime, dataUrl}` shape `readEvidenceDoc` produces —
  as `photoUrl`, which the contribution contract declares as a URL string. Pre-existing and
  unrelated to the certificate work, but adjacent enough to be worth naming: it needs the same
  upload-then-reference treatment the certificate just got.
- **`EvidenceUpload`'s 2 MB inline cap does not match the vault's 10 MB.** A certificate between the
  two now uploads and is readable by ops, but shows the claimant no preview of what they attached.
  Two limits with different jobs (one is "how much base64 will we hold in memory", the other is
  "how large a document will we store") that happen to be visible on the same screen; they should
  either be reconciled or the gap should be explained in the picker's own words.
- **`PersonalDocument.sizeBytes` is a nullable `Long`.** Rows predate the column, and the certificate
  adapter coalesces null to `0` — which renders as "0 bytes" beside a document that is plainly not
  empty. Worth a backfill from the stored objects rather than a growing pile of coalesces.
- **Mock vault caps inline bytes at 3 MB.** A larger mock certificate has a null `dataUrl`, so the
  ops console says the document is stored but cannot be opened here. Honest, and the same answer dev
  gives when no signing provider is configured — recorded so the next person to see it knows it is
  the design and not a broken button.

**The 25 red mock-mode e2e specs: 25 fixed, 0 outstanding**

A wide `tests/admin` + `tests/consumer` run reported **29 failed / 821 passed**. A serial re-run of
just the red files reproduced 27, so they were not worker contention. A worktree at `cd1018c` — the
commit before the society-console work — running the *same* files produced a failure list identical
apart from `doc-viewer-scheme.spec.js`, which a targeted re-run showed to be a flake cluster (all
three of its tests fluctuate between runs). **None of it was a regression**, including the
`tenant-profile.spec.js:73` failure previously reported here as one: it fails at `cd1018c` too.

Almost all of them were one class — a spec whose localStorage seed predates a seam migration,
asserting against a screen that no longer reads the key it seeds. The repair is the same each time:
boot the app, wait for `appReady`, then write into the store the app has just seeded (an
`addInitScript` write is overwritten on first load), reading the existing store rather than starting
from `{}`.

| Seed key the spec wrote | Specs | Fixed in |
|---|---|---|
| `puneNestContactReq:<mobile>` | `consumer/account/action-center` (2), `consumer/account/contact-request-verified-badge`, `consumer/account/photo-requests` | `9a02fbd` |
| `pnTenantProfile:<mobile>` alone | `consumer/account/tenant-profile:73` | `1aceaea` |
| `puneNestDocs:<mobile>` | `consumer/account/doc-info` (4), `consumer/account/owner-finances` (2) | `9c2ab72` |
| `puneNestDocs:<mobile>` | `consumer/account/doc-requests-grant` | `bf757af` |
| `puneNestListings:<mobile>` | `consumer/flatmates/eligibility`, `owner-id-inbox`, `prefill` (3), `consumer/property/scheduled-visits` (6) | `51551a9` |
| `pnSocietyReports`, overlay shape | `consumer/society/community-v2:260`, `consumer/society/onboarding-p2` (2) | (this slice) |

Three of them were not stale seeds but real product defects the stale seeds had been hiding:

- **`toRentalCard` was never given the listing** (`e1a7ca6`). Its docblock says a caller holding the
  listing should pass it in rather than have the function invent one; all three call sites passed
  nothing, so every tenant's My Rental card, Rent Wallet and Document Vault described their home as
  "Rented home".
- **The flatmate tenancy picker could not name its options** (`22bfc94`). Same root, different
  surface, and worse: `prefillGroupFromTenancy` derives locality from the title, so with every
  option reading "My tenancy" the prefill filled in nothing.
- **"Remove content" did not remove the content** (`a72ab70`). `mock/triageReport` ignored
  `decision.enforcement`, so a moderator got "Content removed & report closed" while the spam stayed
  on the hub — and the report left the queue, so nobody would come back to it.

Two society specs were stale in the other direction — asserting behaviour that was deliberately
removed, so fixing them meant changing the assertion, not the product:

- `community-v2:260` asserted a snapshot of the reported text. `ModerationTab` stopped rendering one
  on purpose: a report carries a target id, and a snapshot taken at report time goes stale the
  moment the author edits. It now asserts on the target id, keeping both behavioural assertions.
- `onboarding-p2:52` asserted that verifying a candidate sets `registration` and `conveyance` true.
  `verifyCommunitySociety` deliberately stopped doing that — an operator confirming a building
  exists was silently telling every buyer its conveyance deed was done. It now asserts the
  verification stamp, which is also what the server records (V105).

Known flaky, not red: `doc-viewer-scheme.spec.js` (:56/:68/:86 fluctuate), `owner-hub.spec.js:79`.
Known red outside this set and untouched: `live-property-integration.spec.js:689`/`:720` (P6
deferral), `platform/desktop-noleak-guardrails.spec.js` (4), `mobile/landscape.spec.js:101`,
`mobile/phase3.spec.js:157`, `mobile/topbar-scroll.spec.js:61`.

**Data and schema**

- ~~`idx_properties_society_unit` (V79) indexes a column combination nothing queries. Both options —
  drop it, or `comment on index` explaining why it is kept — cost a new migration, because V79 is
  applied and editing it breaks its checksum.~~ **Closed 2026-08-22:** dropped by `V113__drop_unused_society_unit_duplicate_index.sql`; the active duplicate probe is meter or `(locality_slug, address_key)` only.
- `flatmate_rooms.society_id` had the FK-as-409 shape that D218 fixed for `properties`. **Fixed**
  in `FlatmateSupplyService.requireSociety`, which also closed the worse half nobody had noticed:
  the mapper's `uuidOrNull` silently turned a malformed id into `null`, so the room was created
  `201` attached to no society and the host was never told. Now 400 for unparseable, 404 for
  unknown — the 404 matching D218 deliberately. `FlatmateRoomSocietyTest` pins all three cases.
- No guard test asserts that a `V__` migration never inserts into a table the e2e reset truncates.
  The V78 `message_template` incident is fixed; the class of bug is not prevented.
- ~~`confirmListingFresh` writes `freshenedAt` to localStorage and the API has no such column.~~
  **Stale — this was already built and the entry described the mock.** `V86__properties_last_confirmed_at.sql`
  added the column; `Property.lastConfirmedAt` has no setter, so `confirmAvailable(Instant)` is the
  only way in; `MeListingsController.confirmAvailable` serves `POST /me/listings/{id}/confirm-available`
  (no `@PreAuthorize` by design — `/me/listings/**` authorises by ownership, 404 not 403);
  `propertyMapper.js:149` maps it to `freshenedAt`. Only the **mock** store writes localStorage,
  which is correct. The two real readers are `lib/freshness.js:31` and `AdminProperties.jsx:295`.

**Silent failures**

- `toListingUpdate` drops non-whitelisted keys without warning. `AdminProperties.jsx:428` passes
  `bhk`; the mapper reads `bhkNum`, so a BHK correction is discarded and the toast says it saved.
- `flagReason` is ungated on the public property detail response — moderator-facing prose served to
  anonymous callers.
- There is no HTTP-level write throttle on any route. Rate limiting exists only on OTP.
- `postInternalOnce` scans the whole thread in memory on every write.
- `PropertyResponse.adminPipeline` is not flattened by any http mapper, so six back-office readers
  are silently dark on live builds. Precondition for ledger 27.
- `PropertyReviewModal.jsx:391` returns `null` when either the review or the thread fails to load, so
  a failed case-file load is indistinguishable from a dismissed click.
- **The admin moderation console reads a partial catalogue, and the tripwire is now red.** The
  e2e catalogue crossed the page ceiling (102 listings against `spring.data.web.pageable.max-page-size=100`),
  so `warnIfTruncated` fires on both `/admin/properties` reads and `live-property-integration.spec.js`
  `:689` and `:720` fail in their shared `afterEach` — their own assertions pass. Confirmed
  pre-existing, not a Wave C regression. Consumer surfaces are unaffected *today*: the public
  approved catalogue is 47. Fixing it is a **P6 slice**, deferred there by decision on 2026-08-20:
  `listForModeration` returns a flat array and four screens aggregate over it client-side
  (`AdminProperties` tabbed table, per-tab counts and the recheck queue; `AdminDashboard` headline
  counts; `AdminPostOnBehalf` pending list), so a real fix is a page envelope plus server-side counts
  plus pushing the table's filters and sort onto `/admin/properties` so the server pages a *filtered*
  set. Raising `PAGE_SIZE` is not a fix and the server clamps it anyway — that is the mistake the
  tripwire's own docstring records.
- The review modal's open effect double-POSTs under StrictMode. Harmless since D221's advisory lock,
  but it is why a real server bug hid for weeks.

**Content and admin surfaces**

- The three editorial content endpoints shipped empty for three different reasons: `banners` cannot
  round-trip through the admin console, `announcements` and `services` have no admin write routes at
  all, and production answers `[]` for FAQs. Each needs its own decision.
- The live FAQ list has no `Sort`, so it is heap order; the mock's order was editorial.
- `MyListingsPanel.jsx:258` calls `sendWhatsappTemplate`, which 403s for owners. Either widen the
  guard or drop the control — pinned in place by `admin/live-outreach` test 6.
- `sendOwnerReminder` has zero callers and dies with the mock.
- The audit tab needs three small rulings before `logAudit`'s 44 call sites are deleted: whether the
  clear button survives, whether the uuid column is shown, and what the detail sentence reads.
- Flatmates gender filter (`FilterBar.jsx:130`) carries selection only in a CSS class; its four
  siblings all set `aria-pressed`. Accessibility finding, product change.
- Three surfaces still average reviews in the browser (`useSocietyHub`, `Owner.jsx`,
  `locality/ReviewsBlock`) — D79's aggregate endpoint is property-only.
- `hasTenancy` in `ReviewsSection` is mock-only, so the "Tenant" reviewer badge cannot render live.
- The mock `propertyReviewProvider` is missing two D218 behaviours (ordering column, staff-note lane).

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

**Decided elsewhere** — geo policy → ledger 35 · locality queue → 24 · own-listing dedup → 23 ·
saved-search count → 33 · society follows → 34 · internal notes → 29 · referral reward → 31b ·
society binding → 19 · pipeline stages → 27 · managed properties → 32 · `services` CMS type → 26 ·
admin enquiries → 25 · finance console → 20 · analytics tiles → 36 · "Posted by PuneNest" badge →
still undecided · `wa-pricing` → resolved.

## Next up

The ledger's damage order. Items 35, 24, 23, 33, 34, 29, 31b, 19, 27, 26, 32 and 25 are built; the
queue is now **20 (finance console) then 36 (analytics tabs)**. Clear item 36's analytics trap early:
`AdminAnalytics.jsx:35` calls `getAnalytics()` from `mockApi.js` and `:59` gates the whole page on
it, so deleting the mock hangs the page including its one working tab.

---

## Shipped

Newest first. One line per slice; the commit is the record.

| Date | What shipped |
|---|---|
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
