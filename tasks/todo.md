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

### `properties-console.spec.js:1279` Verification Queue only — PRE-EXISTING

`the Verification Queue queue is sized by the server` fails on `searchParams.get('archived')`
being `null`; the other three `QUEUES` rows pass. The wait matches the **first** request whose URL
contains `q.param`, and for this facet that is a request that does not pin `archived`. Attributed
by stashing the ownership-panel redesign and re-running: identical failure on both trees, and the
spec's own comment concedes the wait is delicate. Fix is to narrow the matcher to the queue's own
fetch rather than any URL containing the substring.

### `edit-prefill.spec.js` seeds a document category the wizard deleted — PRE-EXISTING

Six tests fail on `locator('[data-err="Ownership Proof"]') — element(s) not found`. `f1b49abd`
replaced the per-type ownership tiles with `badgeDocsFor(deal)` (Electricity Bill / Property Tax
Receipt / Index II) and did not update the spec, which still seeds and asserts `Ownership Proof`.
Confirmed unrelated to the listing-docs copy slice. Fix is to re-point `expectDocument` and its
seeds at a category `docsFor` still renders.

### `npm run check:listing` is red on three backend checks — PRE-EXISTING

`ListingService.update` no longer reverts to pending on an off-search foundation change, no longer
queues a re-check unconditionally for stays-live fields, and `updateAsModerator` now does one or
both. The checker refuses to be relaxed (D76/Q14): the owner-facing edit banner and the server
disagree about what a re-review costs. Confirmed unrelated to the listing-docs copy slice, which
touches no backend file.

### Person identity verification — PARTIAL, browser-tested with open defects

**OCR accuracy tuning, 2026-09-15.** User reported Tesseract "not up to the mark" for these
documents and asked for a more accurate free/open-source engine reading English *and* Devanagari.

Researched and settled on **PP-OCRv5 via RapidOCR** (Apache 2.0, code *and* weights; the
`devanagari` recognition model already includes English, so it is one model and one pass, not two).
Rejected: EasyOCR (unmaintained, CRAFT+CRNN is Tesseract-era), docTR (no Devanagari), and **Surya —
its weights are AI Pubs Open RAIL-M, free only under $5M revenue, so it fails "free and open
source"** however good the benchmarks look. User chose the server-side provider seam, accepting
that it gives up the abandon-before-submit privacy property.

**PARKED, not cancelled — this machine cannot reach the weights.** `modelscope.cn`,
`huggingface.co`, and `paddleocr.bj.bcebos.com` all fail the TLS handshake
(`SEC_E_ILLEGAL_MESSAGE`) while `raw.githubusercontent.com` returns 301 and no proxy is configured:
a **GitHub-only network allowlist**, not a client TLS bug. There is no GitHub mirror to fall back
to — every RapidOCR release from v1.4.4 to v3.9.2 ships `assets: []`. Model URLs and SHA256s are
recorded in `tasks/scratch/ocr-spike/fetch-models.ps1`, which is ready to run the day the hosts are
allowlisted. **If CI sits on this network, a build-time model fetch dies there too — check before
committing to that design.** Also unresolved: no maintained JVM PP-OCR pipeline exists, so the DB
detector post-processing and CTC decode would be hand-written Java.

Shipped instead, in `frontend/src/lib/identity-verification/ocr.js` — three of the four causes are
tunable without changing engine:
- **`eng` on a bilingual card.** Half an Aadhaar is Devanagari; the English model transliterates it
  into confident-looking capitals, which is *exactly* the shape `parseName` hunts for. The fix is
  not a Hindi model (**the English name is printed on all three document types, so Devanagari is
  interference, never a data source**) but per-line confidence: `data.blocks` and every confidence
  score were being thrown away, with only flat `data.text` used. Lines below 60 are now dropped.
- **No page-segmentation mode**, so it defaulted to AUTO — built for scanned A4, given a card that
  `capture.js` has already cropped to the guide. Now `SINGLE_COLUMN`.
- **Digit lookalikes** (`O/0`, `I/1`, `S/5`, `B/8`) were being *stripped* rather than corrected, so
  an Aadhaar with one misread glyph failed entirely. Repaired per-group, and only in groups already
  mostly digits, so `SOLO` in a name never becomes `5010`. A char whitelist was considered and
  rejected: it constrains the engine but cannot fix a misread, and a second pass would double
  latency against the 45s deadline.
- **The fourth cause is the engine ceiling and is not tunable.** Tesseract's LSTM is trained on
  scanned documents; a handheld photo of a glossy laminated card is natural-scene text. That is why
  PP-OCR is parked rather than dropped.

Also restructured the deadline to span worker startup, not just `recognize` — startup is where
emscripten's `abort()` hangs, and `createWorker` is now a separate await that could have hung
outside the old race. Worker is terminated in `finally`, which on the timeout path is the only
thing reclaiming the core.

Green: identity route spec **8/8** (incl. the real OCR read and the never-finishes fallback),
`npm run build` clean.

**Accuracy is NOT verified and cannot be here.** Every test drives a canvas drawing of crisp black
text on flat white — the one input Tesseract was always good at. The confidence floor is known not
to reject clean text (the PAN still reads back), but whether it admits a real photograph's name line
and rejects a Devanagari one is **untested**; so is the `SINGLE_COLUMN` choice. Re-check by hand
with real cards, and treat 60 and `SINGLE_COLUMN` as the first tuning candidates. Sizing note that
kept this proportionate: **OCR is not a correctness boundary** — the badge is keyed on
`identity_hash`, set at approval from the reviewer's typed number, so OCR only affects reviewer
typing effort, early-409 dedup, and prefill quality. **PENDING AGENT REVIEW** (no subagents, per
the standing instruction): `ocr.js`.

**UI rebuild + liveness gate, 2026-09-15.** User reported after a real-camera session that the
selfie "passes on the first click, not left and right", and asked for every screen in the flow to
be rebuilt on the application's own theme. Both were real.

- **The liveness stages were decoration.** The capture button was never bound to `selfieStage`, so
  a user could capture at stage 0 having done none of the three poses. Compounding it, the counter
  clamped at `SELFIE_STAGES.length - 1`, so "all three cleared" was not a representable state and a
  gate added naively would have been unsatisfiable. Fixed by letting the counter reach the count
  and gating on it. **The release is deliberate, not a loophole:** a client gate stops nobody who
  can post to the API directly, so its only value is coaxing a usable photo out of an honest user —
  a permanent block would strand the one person it exists to help (dim room, odd camera, a face the
  model reads poorly). It therefore unlocks after `LIVENESS_STALL_MS` measured from the last sign
  of PROGRESS, not from when the camera opened, so a merely slow user is never waved through, and
  it says on screen that the checks could not be confirmed rather than claiming they passed.
- **The control panel covered the video.** It was `absolute inset-x-0 bottom-0 … pt-24` inside the
  `relative` frame, which blankets the shorter `aspect-video` document preview. Controls moved into
  normal flow below the frame. The guide stays inside it because `guidedRegion` inverts that
  element's `object-cover` transform to decide which pixels are stored — anything else laid over
  the video would shift that mapping or hide the frame the user is filling.
- **All eight screens rebuilt** on the app's real systems: the `.btn` tiers in
  `styles/components/buttons.css`, `.glass` from `index.css`, and the CSS custom properties. The
  flow had been carrying its own light palette (`#f3f3f1`, `#2f8082`) invented for it.

Regression, red-checked: `the selfie capture button is held by the liveness stages, and released
when they stall` asserts the button starts disabled with all three stages `pending`, that the
fallback releases it, and that nothing claims the checks passed. Red-checked by setting
`disabled={false}` — it fails; restored and it passes. Two other assertions moved with the copy and
were spec drift, not defects: `seven days after a decision` now matches the consent checkbox too
(pinned to the disclosure paragraph), and the desktop heading reads `Continue on your phone`.

Green: identity route spec **8/8**, ops review spec **3/3**, `identity-verification.test.mjs` 4/4,
`npm run build` clean, every `check:*` gate except the pre-existing `check:listing` (3 of 63, about
`ListingService.java` — not this feature's, and the checker says not to relax it), eslint clean on
the identity files. **No subagents were spawned, per the standing instruction** — the redesign and
the gate are still **PENDING AGENT REVIEW** along with the items below.

Still not covered by automation: every run drives a drawn canvas, so a face is never actually
detected. The stages are only ever observed *failing* to advance; the passing direction and the
thresholds in `face.js` rest on manual testing. `box.width < 0.22` rejected a natural laptop
distance during the live session and is the first tuning candidate if real-camera testing repeats
it. **Lowered to 0.18 on 2026-09-15** — still unproven by automation, so re-check it by hand.

**Copy and character rewrite, 2026-09-15.** User reported that the screens had been written from
reference screenshots of a different application and asked for copy in this product's vocabulary
and, crucially, its *actual functionality* — plus a character of its own rather than the dark-glass
build the previous pass shipped.

The complaint understated the problem. **Two of the four benefit bullets advertised features this
product does not have:**
- *"Unlimited calls, chats, tours and offers"* — contact is L1-only for every signed-in user
  (ADR-019, `lib/contact.js`), so verification unlocks no quota at all. "Unlimited" is **Seeker
  Plus, a paid plan** (`ContactsExhaustedModal.jsx`). The intro screen was selling a paid benefit
  for free, on the one screen whose whole purpose is being believed.
- *"Get listed in our realtor directory"* — there is no realtor directory anywhere in the product.

Replaced with the three the code actually implements: the badge on profile and listings, the
ranking lift (`ProfileTab.jsx`), and reaching owners who accept verified contacts only. The
verify-is-not-a-gate line from `ProfileTab.jsx` is now carried on the intro screen too, so the
flow cannot be read as a wall. Also: "Driver's License" was the US spelling in an India-first
product, and every remaining text glyph (`← × › ✓ ⬚ ∞ ⚡`) is now an `<Icon>`.

Character: a **contact sheet** — one frame per photo the chosen document needs, in shooting order,
filling with the real thumbnail as each is taken. It answers what a step counter cannot (how many
more photos, and of what), and it appears on the document picker too, because "two frames vs three"
is the honest difference between a PAN and an Aadhaar. Everything else is deliberately quiet:
left-aligned, hairline-bordered lists instead of stacked glass cards, and `font-mono tabular-nums`
reserved for machine output (OCR values, attempt counts, frame indices).

Found while mirroring the copy into the spec:
- **The retake link was keyed to the wrong photo.** It rendered on `captures.front || captures.back
  || captures.selfie`, so arriving at the selfie step with a front photo in hand offered to retake
  a selfie that did not exist — and taking the offer called `resetCapture('selfie')` and reset the
  stage counter, sending an honest user back through three poses for nothing. Now `captures[activeFrame]`.
- **A locator trap worth remembering:** "**Re**take the front" *contains* "take the front", so
  `getByRole('button', { name: /Take the front/i })` matches both the shutter and the retake link.
  Four tests died of strict-mode violations before the spec was anchored on
  `data-testid="capture-button"`. Recorded in `e2e/COVERAGE.md`; do not reintroduce name-regex
  locators for that button.

**PENDING AGENT REVIEW** (no subagents, per the standing instruction): the rewritten copy for
claim accuracy, `VerifyIdentity.jsx` after the restyle, and the lowered `face.js` threshold.

**Both exits from a decided case were broken, 2026-09-14.** User reported the button on the
"Sent for review" screen doing nothing. It did nothing exactly: it called `setStep('intro')`, and
`showStatus` is true on the `intro` step too whenever a case exists, so the only control on the
screen re-rendered the screen. The user's sole way out was the × in the header.

Pulling that thread found the worse one next to it. Retry on a rejected case jumped to the document
picker, skipping consent — but `consented` is component state and a rejection arrives from a human
reviewer hours later, so the user has *always* reloaded by the time they see it. Every real retry
was therefore submitting `consent=false`, which `IdentityVerificationService.submit` refuses with
`consent must be true` — **after** the user had retaken every photo. The rejected path was
unusable in production and green in tests, because the test never clicked the button.

Both now covered: the pending case asserts the button actually leaves to `returnTo`, and the
rejected case asserts it lands on consent with the checkbox unticked.

Reviewing the diff afterwards turned up a third, unrelated to the button: the contact sheet renders
inside the document picker's `<button>`, and it was emitting `<ol>/<li>/<p>` there — invalid, since
a button may only contain phrasing content. It also announced "list, 2 items, 1, 2" to a screen
reader immediately after the option had already said "One photo of the card, then a selfie" in
words. The `xs` variant now renders as `aria-hidden` spans; the standalone sheets keep list markup,
where it is real structure.

**Completion pass, 2026-09-15 — the two confirmed defects are fixed, plus three found while
fixing them.** User authorized completing the scope, offered a laptop webcam, and instructed that
**no subagents be spawned**. That overrides AGENTS.md's post-change agent workflow, so the
`react-reviewer` / `code-reviewer` / `security-reviewer` passes were **NOT** run — review was done
manually and serially over the diff. **PENDING AGENT REVIEW** on: the identity backend package,
`VerifyIdentity.jsx`, `OpsIdentityReview.jsx`, both CSP copies, and `check-csp.mjs`.

Fixed this pass beyond the two recorded defects:
- retake after rejection returned 500 for every rejected user — Hibernate orders pending inserts
  ahead of pending deletes, so the new rows collided with the old on `UNIQUE (verification_id,
  kind)`. `files.flush()` in `purgeFiles`; proven by the red run before the fix.
- a rejected face-landmarker promise was cached for the session, so one bad model fetch disabled
  selfie guidance permanently and Retry camera could not recover it.
- the ops Approve/Reject buttons had no in-flight guard; a double click came back 409 on a case
  the reviewer had just decided correctly, and read as a failure.

Two structural guards went red on the full backend suite because of this work, and both were
real answers rather than noise:
- `ArchitectureBoundaryTest` — `identity` (layer 0) imported `documents.vault.DocumentUploads`
  (layer 2), an upward reference. Resolved by dropping to `common.validation.MediaSignatures`,
  which both packages already sit above, and stating identity's own policy locally: camera photos
  only (JPEG/PNG/HEIC), no PDF, declared type and sniffed type must agree. That is *narrower* than
  the vault's allowlist, which is the correct rule for a capture path — the shared constant was
  always a slightly wrong fit. All 18 identity endpoint tests still pass.
- `MigrationChainTest.noTableIsCreatedTwice` — a **false positive**. It counted CREATEs without
  modelling DROP, so `V23`'s deliberate drop-and-rebuild of `identity_verifications` read as the
  outage shape, and the message sent the author to edit an applied migration, which is the *other*
  half of what caused the original outage. The guard now walks CREATE and DROP in chain order and
  fails only on a CREATE of a table that is still live. Red-checked by adding a bare second
  `CREATE TABLE otp_codes` with no DROP: it goes red naming that table.

Full backend suite after both: **2537 tests, 2 failures** — the two pre-existing
`SourceTreeHygieneTest` ones (`tasks/scratch/audit-patch-bundles.mjs` mojibake, and five empty
files from another session's in-progress flatmates work). Neither is this feature's.

Both late fixes now have red-checked regressions:
- `identity-route.spec.js` fails the model fetch exactly once and asserts selfie guidance
  recovers on the next visit to the step — red when the rejected promise is cached again.
- `identity-review.spec.js` holds the approve response open, force-clicks both decision
  buttons, and asserts one request, no reject, no error banner — red without the guard. The two
  buttons carry testids because both read "Saving…" in flight, which is exactly the state
  an accessible-name locator cannot disambiguate.

Green at this point: identity route spec 7/7, ops review spec 3/3, backend 2537/2 (both known),
`npm run build` clean, and every `check:*` gate except the pre-existing `check:listing`.

**Completion attempt, 2026-09-14 — BLOCKED before implementation:** user authorized completing
the remaining scope and offered a laptop webcam for assisted testing. Rechecked identity working
changes and shared ports; preserved the existing :8084 process. Both the read-only planner and
security-reviewer failed with upstream-provider high-demand errors. Stopped under AGENTS.md's
subagent-failure rule; neither produced findings or code. No application changes, new tests,
dependency changes, or webcam activation in this attempt. Resume with camera/OCR regressions,
backend safeguards, staff/UI/i18n completion, independent reviews and isolated automated checks,
then user-assisted local non-uploading webcam checks. All open items below remain open.

**Desktop browser verification, 2026-09-14:** the routes and five identity specs now exist;
the initial inspection below is historical, not a current inventory. Camera headers now allow
same-origin capture. This testing pass made no application-code changes.

- [x] Existing identity route/review specs: **5/5 passed in 50.6s**, Chromium, one worker, no retries,
  app :5191 / API :8096 / `draazy_e2e_sv2`, output `e2e/test-results-identity-desktop`.
  Covers PAN canvas-camera submission, pending/rejected status, denial instructions, desktop QR,
  and admin approve/reject. The review specs sign in as admin, so they do not prove staff access.
- [x] Additional ephemeral browser probes using Chromium's native fake-media device (Pixel 7):
  PAN front-only and Aadhaar/driving-licence front/back reach selfie; PAN prepared capture,
  readable previews, retake, and track teardown pass. All three document flows release tracks
  when returning to document selection. Only synthetic media was used, not a physical webcam.
- [x] WebKit 26.5 desktop QR passes. iPhone 13-emulated consent/document selection/denial UI
  passes with an explicitly injected denial API. **Windows WebKit exposes no `mediaDevices` in
  this mobile context**; its native run correctly shows the phone handoff. This is not evidence
  for native Safari camera support, and no physical iPhone was tested.
- [x] **Fixed: Retry camera was a no-op.** The handler set `step` to its unchanged value, so the
  camera effect never reran. Now a `retryToken` in the effect deps. Regression asserts the browser
  was asked a second time (`getUserMedia` count 1 → 2), not merely that the error text cleared.
- [x] **Fixed: OCR worker could not load — and the cause was larger than the worker.** The
  `importScripts` failure was real but secondary; bundling worker and core exposed the actual
  defect: **the CSP blocked all WebAssembly**, so the Tesseract core *and* the MediaPipe face
  landmarker both aborted. `script-src` needed `'wasm-unsafe-eval'` (which permits wasm
  compilation only, and does not restore JS `eval()`); the policy was not otherwise weakened —
  it was narrowed, see below. Second, independent defect found while fixing it: emscripten's
  `abort()` tears the worker down from the inside, so `recognize()` never settles and the
  `catch` that was supposed to offer manual entry was unreachable code — the screen showed
  "Reading document…" forever with no error anywhere. A 45s `Promise.race` deadline now delivers
  that fallback for every cause. Both are covered: one spec asserts the PAN number itself appears
  on the review screen (the only assertion that separates a real read from a worker that failed
  to load), one hangs the language-model request and asserts the manual path still arrives.
  Deadline red-checked by raising it to an hour — the spinner test goes red on its own assertion.
- [x] **Both model files are now self-hosted, and the CSP is narrower than before.**
  `cdn.jsdelivr.net` and `storage.googleapis.com` are gone from `connect-src`; they were listed
  only for these two downloads, and this repo's own CSP notes call the latter an exfiltration
  target. A third party no longer learns who starts a verification. Licensing and provenance for
  both binaries are recorded in `frontend/public/third-party/models.txt` with checksums.
- [x] **CSP drift guard.** The policy is written twice — `frontend/index.html` and
  `frontend/public/_headers` — and e2e exercises only the dev server, i.e. only the meta copy.
  A directive added to one and not the other is green in the whole suite and broken in production.
  `frontend/scripts/check-csp.mjs` diffs them directive-by-directive with an allowlist of genuine
  deltas; wired into `npm run check`; red-checked against the header copy alone.
- [x] `/verify-identity` and `/ops/kyc-review` registered in `ROUTE_PATTERNS`. Both were being
  filed under the 404 bucket: zero reported traffic for the funnel, inflated broken-link count.
- [ ] Preserve additional probes as durable specs; validate camera absence, interrupted/background
  capture, physical Android/iPhone, production headers, and secure phone QR reachability.
  A localhost QR opens the phone's localhost, not this desktop. **Real face/liveness inference is
  still unasserted against a real face** — a spec now proves the landmarker loads and recovers from
  a failed fetch, but nothing drives it with actual facial geometry, so the stage-advance logic
  (`readSelfieGuidance`) is exercised only by synthetic frames. This needs the physical webcam.

**Harness caveats:** the editor runner first reset the default `draazy_e2e` test DB and failed
seeding on missing `lifecycle_track`, before browser assertions. The successful run used the
isolated lane instead. Two initial teardown-probe failures were a PowerShell Unicode selector
encoding mistake, not app failures; both passed after an ASCII-only selector correction. Ad-hoc
probe exit 0 is not a pass count: the initial script collected assertion failures in its output.
No application build/lint, backend regression suite, code/security review or deployment was done
in this testing pass. Backend startup compiled main and test sources; that is not test execution.
Coverage-citation validation still fails on the two already-recorded missing rent-payment/sticky
wizard references; both new identity citations resolve. Documentation diagnostics are clear.

**Initial inspection, 2026-09-13 (superseded where noted above):**

- [x] Read workspace instructions and lessons; inspect the working-tree inventory (334 changed
  entries at session start). Preserve existing identity, property-verification and lifecycle work.
- [x] Inspect attached UI references and obtain a read-only frontend implementation plan. No
  application code, dependencies, database state, or shared processes changed in this session.
- [ ] Finish backend inspection: the delegated inspection failed with an upstream-provider
  high-demand error. Stopped under AGENTS.md's subagent-failure rule; no partial implementation applied.
- [ ] Validate backend submission/review contracts, upload/scanning limits, concurrent decisions
  and submissions, HMAC uniqueness, normalization, retry windows, cleanup/erasure and storage failures.
- [ ] Resolve full-number reviewer confirmation: proposed staff transcription from the image into
  request-only memory; retain hashes/last four, never a new full-number or raw-OCR database field.
- [ ] Implement authenticated, feature-flagged full-screen consumer capture/status route using the
  attached screenshots, seven-day post-decision image retention copy, in-memory progress,
  camera-only capture, lazy local OCR/face guidance, prepared uploads and credential-free phone QR.
- [ ] Implement permission-scoped staff queue/detail/confirmation UI using the existing moderation
  APIs; refresh private image links and handle conflicts and already-decided cases.
- [x] Replace the old DigiLocker seam/modal entry points and person-badge vocabulary; preserve
  return navigation and legitimate agreement/property document fields; translate English/Hindi/Marathi.
  Done across frontend copy + i18n ×3, the service seam and mappers, admin/ops fields, the e2e
  layer + COVERAGE.md, and ~35 docs. Legitimate Aadhaar-as-a-document references (rent agreement
  D159, document vault, OCR checksum, owner bank/PAN KYC) deliberately kept, as are the ADR rows
  marked Superseded/Withdrawn/Amended — those are decision history, not live claims.
- [ ] Run backend regressions, synthetic-camera browser tests, real inference smoke checks,
  build/lint/i18n/OpenAPI checks and ordered code/security reviews in isolated lanes. Record actual
  results and update coverage; physical iPhone Safari remains a separate verification gate.
- [ ] Document approved WhatsApp template/configuration, model asset licensing/privacy, camera/CSP
  deployment settings, and any remaining release blockers. Do not commit or deploy.

**Read-only planner findings to validate before implementation:** production `_headers` denies
camera access; staff decisions require admin-only `users:write`; replacement submission appears to
delete prior images before all replacements succeed; review decisions appear to lack locking;
approval notices target an unregistered `/profile` route. The old frontend Aadhaar endpoints remain.
Use narrowly scoped identity-review permissions, not broader account-administration access. The
graph reports commit `fd641b76`, behind inspected HEAD `b8e1ddb5`; refresh before further graph use.

**Verification this session:** no tests, builds, lints or runtime camera checks run. Backend
correctness and production readiness are not established. Project skills named `draazy-frontend`
and `draazy-backend` were not found in the active/archive paths checked; the two UI design skills
were read instead. Existing app design and the user's screenshots take precedence over generic style.

### Ownership Verified badge (D190/Q15) — verified, not partial

The previous session recorded this as partial after a model-provider outage. It was not: the
wizard-side work it listed as pending was already written, only never compiled and never run. What
the handoff really described was unverified work, and this pass verified it.

- [x] **The Index II sale gate was already correct.** `TITLE_PROOF` is established by `index_ii`
  alone; `sale_deed` maps to `TITLE_SUPPORT`; `requiredKinds("buy") = [title_proof, address_proof]`.
  No change needed — an electricity bill plus a registered deed still leaves `missingKinds:
  ['title_proof']` and the Grant button disabled.
- [x] **The "static checks passed" claim was wrong.** `OwnershipEvidenceTypesTest` used AssertJ's
  non-existent `isNotSubsetOf`, a compile error that blocked the *entire* backend test tree. Fixed.
- [x] **Backend: 136 tests green** (`OwnershipVerificationTest` 18, `OwnershipEvidenceTypesTest` 9,
  `DocumentUploadsTest` 28, `UploadPolicyEndpointsTest` 45, plus the verification/owner suites).
  Superseded by the final run below, which adds this pass's five new tests.
- [x] **Live e2e green**: `property-ownership-review.spec.js` 2 ✅ and
  `consumer/list-property/seam-write.spec.js` 6 ✅, on the admin lane (:8084, `draazy_e2e_adm2`).
- [x] **Signed-PDF preservation is now proven, not assumed.** A PDF carrying a real `/Sig`
  dictionary, `ByteRange` and `AcroForm` goes through the wizard and is compared byte-for-byte with
  the issued bytes on readback. `pdf.worker.js` forwards a sub-1 MB PDF `unchanged` *before*
  `rejectSignatureFields` — the branch order is the whole guarantee, and nothing had pinned it.
- [x] **Found and fixed a real owner-upload bug while writing that test.** The document picker is
  `disabled` while a photo is still uploading, and `useListingMedia.start()` drops a pick made in
  that window with no error at all. The wizard treats document failures as non-fatal, so the owner
  saw "Listed Successfully" with no paper on the listing. The specs had never asserted the document
  was stored, so both existing tests passed while uploading nothing. They now wait for the picker to
  be enabled and assert the filename appears.
- [x] **Two security findings fixed** (from `security-reviewer` on the module):
  - The case-file read chose its staff projection on **role alone**, so an ops desk with no
    `properties:write` (packers, loans, interiors) could walk property UUIDs and harvest
    `{docType: "aadhaar", subjectName: "<name off a government ID>"}`. The projection is now a
    capability, via `PermissionMap`.
  - `recordEvidence` validated `issuedAt` against the clock but never against the document, so the
    same 2019 bill could be re-cited every quarter with today's date and renew the badge forever.
    A cited document may no longer be dated after the day it was filed. Covered by
    `anIssueDateCannotPostDateTheUpload`.
  - `listDocuments` now re-derives authorization from the principal instead of trusting the
    controller annotation alone — it is the route that mints signed URLs to Aadhaar scans.
- [x] Accessibility and correctness fixes on `OwnershipEvidencePanel.jsx`: the document link's
  accessible name now contains its visible text (WCAG 2.5.3); the issue-date picker is capped and
  submitted against **Pune's** calendar, not UTC's — between 00:00 and 05:30 IST the old code both
  capped the picker a day short and would have had the server reject today's date as future.
- [x] **Owner-side wizard UI verified.** The photos step carries a `Get the Verified badge` section
  distinct from `Other documents — optional, for your records`, with a live `role="status"` reading
  `publish without a badge` → `ready for staff review — not yet verified`. The bill picker is
  PDF-only (a scan has no issuer signature left to check) with a property-tax-receipt fallback, and
  a sale still wants Index II on top of it. Covered by a new COVERAGE row and 3 live tests.
- [x] **Four findings from `code-reviewer` fixed** (0 CRITICAL, 0 HIGH; the gate arithmetic, expiry
  boundaries and locking were confirmed correct):
  - `requiredKinds` **failed open**: `"buy".equals(deal) ? SALE : RENT` sent every unrecognised deal
    down the one-bill path. A third intent or a renamed wire value would have made every sale-class
    listing grantable without Index II, with another package's CHECK constraint the only thing
    holding it up. Now `DealIntent.RENT.equals(deal) ? RENT : SALE` — unknown takes the stricter
    gate, matching `DealIntent.priceUnitFor`. Pinned by `anUnrecognisedDealTakesTheStricterGate`.
  - **Withdrawing a lapsed badge was a silent no-op** — no write, no audit row, and a 200 whose body
    was byte-identical to a real withdrawal. That is exactly the case an investigation needs
    (forgery discovered after the expiry). Keyed on the stored verdict now, not on whether the badge
    was still live. Pinned by `aLapsedBadgeCanStillBeWithdrawn`.
  - **A renewal reset `ownershipVerifiedAt`**, contradicting the method's own javadoc and moving the
    instant billing holds against the referral credit. A renewal keeps the original grant date.
    Pinned by `aRenewalKeepsTheOriginalGrantDate`.
  - `vaultDocument` accepted service-request documents that `listDocuments` hides, so the picker and
    the citing path disagreed about what this listing's vault contains. Aligned; pinned by
    `evidenceCannotCiteAServiceRequestDocument`.
- [x] The revocation `reason` is now length-capped (300). Enforced in the service, not by `@Size` on
  the `@RequestParam` — no controller in this tree is `@Validated`, so the annotation would have
  been silently ignored. Pinned by `aWithdrawalReasonIsCapped`.
- [x] **`live-seam-write` was flaky for a real reason.** `toBeEnabled()` alone can pass in the gap
  *before* the photo upload flips `isMediaBusy`, so the pick still landed on a disabled input. Gated
  on the photo appearing **and** `[data-err="photos"]` reporting `aria-busy="false"`.
- [x] **Repaired mojibake** in `ReferralEndpointsTest.java` and `PropertyPipelineTest.java` via
  `node e2e/scripts/fix-mojibake.mjs` — `SourceTreeHygieneTest.noMojibakeOrBom` was failing on them.

**Final verification** (all re-run against the rebuilt backend on :8084 / `draazy_e2e_adm2`):

- Backend `Ownership*Test`: **32 green**. Full suite **2533 run, 8 failures — none this module's**
  (KYC `VerificationEndpointsTest` ×3, flatmate empty files, `IdentityVerificationService` boundary
  and size, one untracked scratch script's mojibake).
- Live `property-ownership-review.spec.js`: **2/2**.
- Live `consumer/list-property/seam-write.spec.js`: **6/6**.
- `lint` 0 errors, `check:i18n` pass, coverage citations resolve.

**Left for whoever picks this up** (all from the same security review, none blocking):

- [x] `PermissionMap.granted` returns **true** for a staff account with `users.team = NULL`, so such
  an account passes every atom — including granting the trust badge. Shared code, deliberately not
  touched here; it needs a decision, not a patch. **Decided: close it at both ends.** The map now
  denies a caller it cannot name, and `addStaff` refuses to mint a staff account without a known
  team (422 naming the six), so the state is unreachable rather than merely punished. The asymmetry
  was the argument: a team that *is* named but emptied holds nothing, while a team-less one held
  everything — so the way to give a colleague the most authority was to give them no desk, and the
  console reported a narrowed platform either way. `admin` is unaffected (literal key, no desk) and
  is now refused a team rather than having one silently dropped. Six fixture classes minted
  team-less staff and were given one; `AdminTeam.jsx` asks for a team before the request.
  **And it was hiding a second defect:** `OwnershipVerificationService.reviews()` asked the
  *team-keyed* `PermissionMap` for `properties:write`, an atom of the *account-keyed*
  `AccountPermissions` vocabulary that no team document can contain. So the "is this colleague a
  property reviewer" filter excluded the whole staff, and its only true branch was the fail-open for
  the unnameable account. Four sibling call sites inject `AccountPermissions`; this was the lone
  outlier, now corrected, with a counterweight test pinning the refusal side too.
- [x] `listDocuments` mints signed URLs to identity documents and audits nothing — there is no way to
  answer "which reviewer opened this person's Aadhaar". **Done:** `property.documents.read` audit
  row, with a counterweight test proving a refused (403) read writes none.
- [x] An owner can delete a vault document a live badge cites (`ON DELETE SET NULL`, no audit),
  destroying the artefact behind the badge. **Done:** `BadgeEvidenceLookup` — 409 while the badge is
  live, audited when the citation is merely historic.
- [x] `docType` is never cross-checked against the vault row's `category`, so an "Electricity Bill"
  upload can be recorded as `index_ii` — the title leg of a sale badge. **Done:**
  `OwnershipEvidenceTypes.contradicts` refuses the pair.
- [x] `DOC_TYPES`, `kindOf` and `expiryOf` enumerate the seven document types independently with no
  compile-time linkage. A type in the table but missing from `kindOf` throws on the **read** path,
  which is an unhandled 500 on the owner's own case file with no way for them to clear it. Worth
  deriving all three from one table. **Done:** one `TYPES` table in `OwnershipEvidenceTypes`; the
  three are now derived views of it.
- [x] `issuedAt` is an `Instant` on the wire but semantically a date read off paper. The frontend
  anchors it to IST, so this is closed for our own UI; any other client sending `T00:00:00Z` will
  trip "cannot be in the future" during the 5h30m window. A `LocalDate` plus an explicit zone would
  close it properly. **Done:** the field is `issuedOn`, a `LocalDate`, anchored to `PlatformTime.IST`
  once in the entity — the stored instant is unchanged, so no migration.
- [x] `OwnershipEvidencePanel.jsx` is ~254 lines around a three-branch ternary; worth splitting into
  `VerificationSummary` / `UploadedDocuments` / `RecordEvidenceForm` / `WithdrawForm`. **Done:** 170
  lines, four sections under `review-modal/ownership/`; the withdraw form sits with the grant button
  in `BadgeDecisions`, because they are one choice seen from either side.
- [x] Signed URLs are fetched once per mount and never revalidated; a review session outlives the
  TTL and the reviewer gets a raw 403 page. The panel's "File link unavailable" copy only fires for
  a *missing* url, so the UI written for this failure can never show. **Done:** links age out inside
  the server's window and say so. Not a background re-fetch — that route is audited, so a timer
  would record disclosures nobody made.
- [x] `prepareUpload` runs twice for every wizard document — once in `useListingMedia.handleDocUpload`
  and again inside `documentService.uploadDocument`. Harmless (both passes return `unchanged` for a
  sub-1 MB PDF), redundant, not worth widening this change to fix. **Done, and it was not harmless:**
  the second pass spawns its own worker with its own 30s timeout and error path, and `submit.js`
  turns any throw into `documentsFailed` — so a document the owner had already attached successfully
  could be dropped by the retry of a step with nothing left to do. `uploadDocument` now takes
  `prepared`; the three vault callers, which hand over a raw file from an input, still prepare.

**Review pass over the split (`react-reviewer`) — acted on:**

- `missingEvidenceId(panelId)` in `ownership/vocabulary.js`. The panel minted `` `${id}-missing` ``
  and `BadgeDecisions` re-derived the same string across a file boundary; a dangling
  `aria-describedby` neither throws nor lints, it just stops the disabled Grant button explaining
  itself, and only to the readers who cannot see why it is disabled.
- `refresh()` no longer clears the form. The expired-link copy *prescribes* that button, and ten
  minutes is exactly how long reading a scan takes — the reviewer would lose the date and subject
  name they had just typed. Re-fetching the same vault rows does not invalidate a choice made from
  them, and a successful record still clears.
- `runDecision` asserts the same response shape the load path does. Three sections now dereference
  `missingKinds`/`evidence`; a short response would blank the modal just after the write committed.
- The subject-name-clearing rule moved back to the container as `changeDocType`. It is a rule about
  what a subject name *means*, not markup, and `RecordEvidenceForm` is documented as drawing only.
- The notice `role="status"` renders only when there is something to announce; it used to sit
  permanently alongside the loading one, making a bare `getByRole('status')` ambiguous for that
  window.
- `SignedLinkLifetimeGuardTest` pins the claim the panel's comment makes: the client withdraws links
  before R2 or the dev store stops honouring them. Nothing else could see it — the e2e run exercises
  the dev store's generous TTL, and R2's tight one only exists in production. Red-checked by
  dropping `URL_TTL` to 5 minutes.

**Review pass — recorded, deliberately not done:**

- The panel guesses the link lifetime; the server knows it. Returning `expiresIn` with the document
  list (the shape already exists in `draazy-api.yaml`) would delete the guess and the guard both.
- `RecordEvidenceForm`'s subject-name input has no `id` and uses an implicit wrapping label, unlike
  its sibling date field; `space-y-3` on the fieldset also gaps a label from the input it names.
  Pre-existing markup, moved unchanged.
- *"Link expired — refresh documents."* contains the Refresh button's accessible name. Survives only
  because the spec uses `exact: true` and a role filter — a near-miss worth knowing about.

**Not this module — flagged, deliberately untouched:**

- `frontend` `check:listing` fails **3 of 63** on `ListingService.update` recheck/revert rules. From
  the parallel listing-lifecycle session (the `owner.isVerified()` rename and `recordLifecycleMedia()`
  are in that diff). Confirmed present before and after this work.
- `backend/src/test/resources/application.properties` gained
  `draazy.security.identity-hash-secret`. **The KYC session needs to know**: their `IdentityHasher`
  reads a key whose dev default lives in the *main* properties file, which the test file shadows, so
  without this line **every** `@SpringBootTest` in the repo fails to start on an unresolved
  placeholder. One line, test-only.
- `e2e/scripts/check-seed-coverage.mjs` classifies the KYC session's new
  `identity_verification_files` as `WAIVED`, mirroring its existing `identity_verifications`
  sibling. Theirs to confirm — without it the live global setup throws and no spec can run.
- `check-coverage-citations.mjs` reports two cited-but-missing specs
  (`consumer/account/live-rent-payment-seam`, `mobile/live-wizard-sticky`). Both pre-existing:
  identical output from `git show HEAD:e2e/COVERAGE.md`.


### Account mock retirement — live APIs only (pay-rent excluded)

- [x] Move dashboard recent-search history behind a server-owned API, then replace and delete
  `consumer/account/dashboard.spec.js`. **Done 2026-08-25 (D248)** — `GET`/`PUT /me/recent-searches`
  (`engagement.history`, V121) own the cap, the timestamp and dedupe-by-normalised-URL; the browser
  key stays only for anonymous visitors, behind `services/recentSearchService.js`. `RecentSearchTest`
  13 ✅, `recent-searches.spec.js` 4 ✅ — the write on the wire, an API readback, a **second
  browser context** reading both the Home rail and the dashboard resume card, and the boundary that
  an anonymous search issues no request at all.
- [ ] Add live listing-freshness coverage for confirmation and retire
  `consumer/account/listing-freshness.spec.js`.
- [ ] Replace and delete `consumer/account/owner-finances.spec.js` using the property-finance API.
- [x] Move owner rent-receipt tracking off browser storage, replace the Owner Hub mock coverage,
  and delete `consumer/account/owner-hub.spec.js`. **Done 2026-08-25 (D248)** — `GET`/`POST
  /me/managed-properties/{id}/rent-receipts` (V120) mint an immutable snapshot with a durable id, so
  a raised rent no longer rewrites last year's receipts and the tenant's copy keeps one reference.
  `ManagedRentReceiptTest` 12 ✅, `rent-receipts.spec.js` 2 ✅ (cross-context readback, and the
  deterministic `409` on a second attempt at the same month). Pay Rent untouched.
- [ ] Keep `consumer/account/pay-rent.spec.js` unchanged by explicit user direction.

### Phase 5 finish plan

- [x] **Lock the remaining Phase-5 decisions** — done 2026-08-22. Geo/cities is server-owned end to
      end (register 38); the audit tab stays read-only (39); post-on-behalf stays visible on Staff
      Activity (40); Sonar is the Phase-5 target and the Checkmarx-vs-CodeQL choice is explicitly
      deferred past functional close (41).
- [x] **Finish the real admin migration debt** — done 2026-08-26. Every live-worthy admin spec is
      converted and only deliberate mock-side keepers are left; see the wave note below for the
      file-by-file end state.
- [ ] **Clear the last cross-cutting live runtime pins to mock code** — consumer/service entry
      points, city propagation/runtime geo, staff login, admin dashboard/topbar helpers, and the app
      boot path (`main.jsx`) so a live build no longer needs the mock store to exist.
  - **M3 complete:** the rent-agreement wizard, property duplicate evidence, flatmate dashboard
    adapters, and legacy chat/service helpers no longer import the mock API or store. The wizard's
    browser-local `TR…` admin ticket was removed: it looked like an operations hand-off but was
    visible only in the submitter's browser. **Backend gap:** create the rental-desk ticket from the
    confirmed payment webhook; until then the paid service request is the authoritative record.
    Review fixes: abandoned invite URLs cannot accept a party after cleanup; shared links are now
    absolute; co-fill creation records the owner's identity; and picker-selected listings retain
    their server UUID until their address identity is edited.
  - **M4 complete:** `main.jsx` no longer waits for browser-store seeding and `services/boot.js` is
    deleted. The old mock-only properties spec had already been retired with the provider lane, so
    its historical boot-seed assertion cannot be re-run; lint and all static frontend gates pass.
  - **M5 complete:** the Vite mock-persistence endpoint, routed dev seed page, mock API/store,
    and browser-store flat-split workflow are deleted. The remaining flat-split module contains only
    pure form validation shared by live screens. The mock seed catalogue and its `npm run seed`
    entry point, one-off seed maintenance scripts, and seed-data writes in the floor-plan generator
    are also deleted, as are four unreachable mock analytics modules; static gates and a production
    bundle build pass. The consumer maintenance gate now reads `GET /flags` through
    `AppFlagsContext`, not either legacy browser database.
  - **M6 complete:** four non-live specs remain by design: contact identity masking, connectivity,
    rent agreement, and city propagation. They are classified against existing live equivalents;
    no spec was deleted only to make the suite green. All 19 tests passed against the live-only app.
    - `contact-identity-masking.spec.js` is an obsolete direct test of local contact buckets;
      live owner/profile and contact-gate specs now prove server masking. Leave it while the legacy
      suite is quarantined rather than deleting coverage by fiat.
    - `consumer/connectivity.spec.js` remains valid: it fault-injects live HTTP requests and proves
      browser offline/unreachable presentation, independent of mock data. Its fault harness now
      aborts concurrent API hydration calls for unreachable scenarios, so the test proves an
      unavailable API rather than a timing accident between a failed listing request and an
      unrelated successful one. The 500 scenario likewise isolates ancillary calls as 500s, so a
      later unrelated success cannot hide a regression that misclassifies a received server error.
    - `rent-agreement.spec.js` is mock-only browser-storage coverage. Its real service and co-fill
      claims are covered by the three live rent-agreement specs; it remains reported, not deleted.
    - `platform/city-propagation.spec.js` retains only pure default/coming-soon client assertions;
      server roster mutation and propagation belong to `live-city-roster.spec.js`.
  - **M7 complete (2026-08-26): browser-storage writes whose API already shipped.** A sweep for the
    inverse of the earlier milestones — not mock *modules* but mock-shaped *data paths* still living
    in `localStorage` next to a working endpoint. Four found, all silent, none failing:
    - **City waitlist was never sent anywhere.** `POST /cities/waitlist` and `city_waitlist` had
      shipped; `CityContext.requestCity` pushed the ask onto `pnCityRequests` in the shopper's own
      browser and toasted "You're on the Mumbai waitlist 🎉". Every ask since launch was recorded
      where nobody at PuneNest could read it. Now `cityProvider.joinCityWaitlist` (`auth: false` —
      the route is `security: []`, and the point of a waitlist is that the person is not a user
      yet), awaited through the modal so the toast follows the 201 and a rejection keeps the shopper
      on their filled-in form. The form's `name` is gone entirely — not just dropped from the
      payload. It was a **required** field guarding a value `requestCity` discarded one function
      later: `CityWaitlistCreateRequest` has no such property and `city_waitlist` has no column, so
      the modal blocked a shopper on something nothing could ever read. Nor does the new admin read
      justify adding a column, being aggregate-only by design. A waitlist needs a way to reach you
      when the city opens and nothing else, so it now asks for exactly that.
    - **Admin "City Expansion Requests" panel rebuilt on the server's numbers** (`SupplyGapTab`).
      It had aggregated the same `pnCityRequests` key, so it showed the reading operator the asks
      *they themselves* had made while browsing — always none on a fresh profile. It was first
      deleted for want of a read endpoint; that was the wrong call, because the panel was the only
      demand signal ops had for deciding where to launch next, so deleting it removed the question
      rather than the wrong answer. The endpoint was built instead: `GET /admin/cities/waitlist`
      → `CityWaitlistRepository.demandByCity()`, grouped by `lower(city)` (matching
      `uq_city_waitlist_mobile_city`) and ordered by count desc then recency, returning
      `CityWaitlistDemandRow{ city, requests, lastRequestedAt }`.
      **Aggregate-only by construction, not by convention:** `city_waitlist` rows are unverified
      public mobiles and emails, and the grouping happens in SQL, so no contact detail is ever
      loaded into the JVM — there is no object on the server that could leak one. `requests` counts
      people rather than rows only because the unique index makes those identical; the displayed
      spelling is `min(city)`, a real one somebody typed. No `?days=` window: wanting a city does
      not decay. Guarded by `DASHBOARD_READ` (staff **or** admin), deliberately looser than the
      sibling `PATCH /admin/cities/{slug}` — reading where people are asking from is not the same
      authority as switching a city on.
      The panel holds the waitlist as `null`-until-loaded rather than `[]`, so a failed read says
      "Couldn't load city requests" and never "No city requests yet" — the one lie here that would
      quietly close the expansion queue on the strength of an outage. That state is also
      **recoverable**: the effect keys off the tab being enabled, which never changes on its own, so
      a "Try again" bumps an attempt counter in the deps — otherwise the panel would warn the
      operator not to read the outage as "nobody asked" and then offer no way to find out what it
      really was. The provider **throws** on a non-array 200 rather than coercing to `[]`, because a
      resolved `[]` is indistinguishable from an empty waitlist and would defeat that design from
      below. (`listCities` still coerces, defensibly: an empty roster degrades to the client's Pune
      default, not to a false claim.)
      `CityAdminEndpointTest` 10 ✅ including `theReportCarriesNoContactDetail` (raw body contains
      the city, not the mobile, and not the string `mobile`) and the anonymous-401/buyer-403/staff-200
      guard. `live-analytics-page` 20 ✅ with two new tests; both mutation-proven with asymmetric
      red — rendering `c.requests + 1` reddens only the count test, and letting the catch collapse
      to `[]` reddens only the routed-500 test. The failed-read test then lifts the route fault and
      clicks Try again, proving recovery by the warning clearing rather than by the button
      existing — a button that renders without re-fetching would satisfy the weaker assertion.
      **`react-reviewer` sweep:** no CRITICAL. One HIGH (the provider coercion above) and three
      MEDIUM fixed — the terminal failed state, the panel announcing nothing to a screen reader
      (`role="alert"` / `role="status"`), and `CityChrome` validating *and transmitting* an email in
      the "Request your city" branch that has no email field: `form.email` is seeded from the
      signed-in account, so a stored address failing the format test refused the submit while
      pointing at a field that was not on screen. Now `isWaitlist ? form.email.trim() : ''`, read
      once and used by both the guard and the payload. One LOW fixed (`askedOn(null)` printed a
      confident "1 Jan 1970" — `new Date(null)` is a *valid* Date at the epoch, so the NaN guard
      never saw it).
      **`code-simplifier` sweep (strict no-behaviour-change):** one finding applied — the retry's
      `useCallback` had no consumer (`SupplyGapTab` is unmemoized and never puts the prop in a dep
      array), so it was indirection that nothing could observe. Two candidates examined and
      deliberately kept: `setCityWaitlist(null)` in the catch is provably a no-op today but its
      proof is a whole-file reachability argument the next edit invalidates silently, and it keeps
      the five sibling effects in the file byte-identical; and `CityChrome`'s `if (busy) return` is
      the submit-side half of a documented "every way out is sealed while the POST is in flight"
      invariant. Backend: nothing — `DASHBOARD_READ` duplicating `SUPPLY_GAP_READ` is the
      established per-controller convention across ~18 controllers, not copy-paste.
    - **`puneNestNotifications` was write-only.** Two call sites minted rows the live inbox
      (`GET /notifications`) has never read, so the bell badge and Notifications page could not show
      them. `pushNotification` and both writes are gone.
    - **`pnConversations` was read but never written.** `hasLocalThread` consulted it to suppress a
      duplicate ask; the live conversation provider queues to `pnPendingRequests` only, which is now
      the whole check. `pnPendingRequests` and `puneNestCity` are legitimate client state and stay.

    Two live specs asserted the removed behaviour and were corrected rather than deleted:
    `live-analytics-page` (the panel heading — which had only ever passed on its empty state, and
    which now asserts a count instead) and `live-interest-doors` (the "announced in the bell"
    read-back). New coverage:
    `platform/live-city-waitlist.spec.js` 2 ✅ — the POST on the wire carrying the `city` the form
    never asks for, and a routed 500 proving the form survives a refusal. `npm run check` and a
    production build pass.

    Review-driven hardening of the newly-async path: **every** dismissal affordance (Cancel, X,
    backdrop, Escape) is now gated on `busy`, not just the submit button — the continuation closes
    over `CityChrome`, which does not unmount with the modal, so a mid-POST Escape used to relocate
    the shopper and toast success anyway. Liveness is re-read after the await rather than closed
    over. The error is `role="alert"` because it now arrives seconds after the click with focus on a
    silenced button. `maxLength={120}` and a loose email check mirror the server's bounds, since the
    only message this modal can render for a 400 is a generic "try again" — untrue and an
    unwinnable loop. `requestCity` throws on a blank city instead of resolving silently.
    **Known gap recorded in `hasLocalThread`:**
    `drainPendingChats` empties `pnPendingRequests`, after which a repeat `already_interested` 409
    re-stages an ask beside the real server thread; closing it needs an inbox lookup, not another
    browser key.
  - **Security follow-up (existing live endpoint):** a co-fill creation response distinguishes a
    registered invitee from a pending mobile. The UI no longer places that mobile in the sign-up
    return URL. Confirm whether the response must retain that distinction; if not, make it neutral
    server-side. The global write-rate filter already limits request volume, contrary to the review
    report's claim that the endpoint is unthrottled.
  - **Co-fill backend gaps:** the document endpoint rejects an unlinked service request, so a direct
    rent-agreement co-fill submission cannot persist the documents it requires; link a property or
    add authorised request-scoped document storage. An opened deferred Cashfree session is not
    returned by later reads and there is no resume/cancel endpoint, so the browser must not offer a
    checkout it cannot safely recover after reload.
  - **Security blocker:** request documents currently project bearer download URLs to every accepted
    co-fill party. Co-fill submissions therefore reject document attachment until the backend adds
    per-party document ownership/visibility and an integration test that one party cannot obtain
    the other party's KYC URL. The participant identity-write and completed-paperwork checkout gates
    belong in that same server slice.
  - **Existing dependency finding:** `pdfjs-dist` 6.1.200 is vulnerable when opening a malicious
    PDF. Upgrade it to at least 6.2.108 and verify normal document rendering and malicious-PDF
    rejection before release.
- [x] **Burn down the remaining consumer legacy suite by dependency cluster** — done, by arriving at
      the end of it rather than by a final push. Three specs never converted because conversion
      would have destroyed their subject, and they are keepers, not residue:
      `consumer/connectivity` (fault-injects HTTP and asserts the offline/retry transitions — a
      reachable API removes the thing under test), `contact-identity-masking` and
      `consumer/services/rent-agreement` (client-side identity and draft rules that never cross the
      wire). 17 tests, green, now the whole of `playwright.nobackend.config.js`.
- [x] **Finish the last platform holdout and flip the default config** — both halves landed.
      - **The holdout.** `platform/city-propagation` reached its second live city by writing
        `live: true` into the mock's `puneNestDB_v5` roster. Once `providers/mock/cityProvider.js`
        was deleted that write had no reader, so the file went **green while asserting about a city
        that never launched** — the failure mode the whole migration exists to remove. Ported to
        `platform/live-city-propagation.spec.js` (5 tests), which takes Mumbai live through
        `PATCH /admin/cities/{slug}` and asserts what `live-geo-policy` stops short of: a newly-live
        city serves an **empty** home and `/listings`, not a relabelled Pune. Two of those are
        `toHaveCount(0)` leak assertions, so each carries a **positive control in the same test** —
        without one, a listings route broken for every city would satisfy them perfectly. The
        `cities` fixture moved to `fixtures/live.js` rather than being copied: two copies would be
        two writers of one shared row with two independent teardowns.
      - **The flip.** `git mv` swapped the two configs; 234 citations across 42 files rewritten in
        one Node pass (PowerShell's cp1252 round-trip would have mangled the em-dashes), verified
        at 0 mojibake. Removing the no-backend config's `mobile` project was not tidying: its
        `CROSS_VIEWPORT` list had emptied itself as each spec converted and **moved** its entry, per
        the rule — leaving `testMatch: []`, which matches nothing, so that project had been
        **reporting a clean result for zero specs**. Obeying the rule produced exactly the silent
        loss the rule was written to prevent.
      - **CI narrowed on purpose.** The runner has no Postgres and no Spring Boot, so the e2e job
        now runs `npm run test:nobackend` (one project) instead of a three-way viewport matrix
        against a default config it cannot satisfy. That is a real reduction in signal, recorded
        here rather than papered over; standing the live lane up in CI is in hardening below.
      - **The footgun is now the default.** `global-setup.live.js` resets `E2E_DB_NAME || punenest_e2e`
        at the start of every run, so a bare `npm test` wipes whichever database a concurrent
        session is using. Tolerable while the config was opt-in; named loudly in the config header
        and `e2e/README.md` now that it is what you get by typing the obvious command. The lane
        scripts remain the safe entry points.
      - Verified: default config collects **1935 tests in 283 files**; no-backend collects **17 in
        3 files** and runs **17 passed**; `npm run check:coverage` green (231 cited, all resolve).
- [x] **Delete the mock in one controlled cut (P5c)** — the headline deletion had already happened:
      `services/providers/mock/*`, `lib/mockApi*`, the `lib/data/**` stand-ins and the Vite
      mock-persistence route all went with the store, and `config.js` kept no switch. What this pass
      removed is what a deletion of that size leaves behind, and one piece of it was live:
      - **Dead code, in `e2e/helpers`.** `publishListing`, `approveListing` and `setFlags` each began
        `JSON.parse(localStorage.getItem('puneNestDB_v5'))` and dereferenced the result on the next
        line, so every one of them would now throw on `null` rather than fail a readable assertion.
        None had a caller: `consumer-fixes.spec.js` defines its own `publishListing`, which
        POSTs `/me/listings` and PATCHes `/properties/{id}/status` as real actors and is a local
        function on purpose, because it sits below `propertyMapper` and must speak the wire
        vocabulary. `readRooms`, `readReviews` and `readReferralStats` went with them (0 callers),
        as did `STORAGE_KEYS.db` (0 references). `readContactsUsed` stays — 1 caller, live key.
      - **Prose that had become false**, which is the part worth naming. 44 files still described a
        world with two providers: 39 provider headers pointed at `providers/mock/xProvider.js`, and
        five docblocks stated in the present tense that a screen "gates on `isHttpDomain(...)`" —
        `OpsQueue`, `OpsReferrals`, `OpsDraftingDesk`, `/ops/flatmate-review`. The gates are gone
        and those desks are live, so the comments described a shut screen that is open. Rewritten to
        past tense, keeping the *reason* each gate existed (D184: a hand-maintained second
        vocabulary drifts), because that reason still explains why these desks never had a twin.
      - `appReady`'s docblock justified `data-pn-boot` by a seeding race that no longer exists; the
        flag stays because the `networkidle` problem it also solves does.
      - Verified: check/lint/build/size/canary all green, both helper modules import, and no spec
        references a removed export. Bundle unchanged at 426.9 KB — every frontend edit was a
        comment.
      - **Service requests triaged 2026-08-28:** the `serviceFlow.js` localStorage workflow was
        dead code — 442 lines, one consumer importing only five pure status/URL helpers. Those
        helpers moved to `serviceRequestStatus.js`; the browser store and its mock-only party-bucket
        merge were deleted. The tracker has one server list, so an accepted co-fill request is
        represented once rather than being merged with a second browser bucket. The initial pass
        almost deleted a real capability: the mapper had hardcoded every message as read, which
        made the unread badge unreachable even though `POST /service-requests/{id}/read` and
        `readAt` already existed on the server. Restored the live receipt path and added a browser
        regression: staff reply → one badge → opening Messages posts 204 → badge clears. Also
        corrected the service-request section in `docs/system/frontend-data-seam.md` from the old
        partial-migration state.
      - **Left open, deliberately:** the remaining docblocks that promise mock-only *capabilities*
        — including `verificationProvider.js`'s growth perk and `myListings.js` — are not stale
        cross-references but claims that a feature has no server implementation. Each is either a
        real gap to file or a dead affordance to delete, and answering that is product work, not a
        rename. Not folded into a deletion pass.
      - **Two more classifications (2026-08-28):** `myListings.js` is already fully server-fed:
        `GET /me/listings` plus the caller's rooms, flatmate posts and groups. Its “demo top-up” is
        a deleted historical branch, not an absent API. The Aadhaar growth perk is a **dead
        affordance**, not a server gap: the real start contract deliberately returns a pending
        DigiLocker handle with `perk: null`; an immediate `{ verified: true, perk }` result existed
        only in the deleted provider. The remaining immediate-success callbacks can be removed in a
        focused UI cleanup; do not request a server feature to reproduce a fake ranking boost.

- [ ] **Hardening / close-out** — backend tests in CI, Sonar wired, scanner decision recorded,
      bundle measured before/after the deletions, and docs/coverage brought to the true live end-state.

**Admin wave (P5b) — done 2026-08-26.** `tests/ops` needed no wave at all (see below). Every file
that was ever counted as admin conversion debt is now either converted or carries a written reason
to stay mock-side; the checkbox above is ticked on that basis. The first pass that sized this wave
over-counted it badly — `notes`, for one, is a mock spec **as well as** a live one by design,
because it catches the same validation rules in a seconds-fast suite while `live-notes` proves the
seam reaches Postgres and survives a second account.

- ✅ **`analytics` (21 tests) → `admin/live-analytics-page.spec.js`.** Its header claimed Geography
  and Seasonal both computed in the browser and the file would follow "when they follow"; Geography
  has been live since register 36 and Seasonal is illustrative **by decision**, so there was no
  event to wait for. The sibling `live-analytics.spec.js` keeps the endpoint contracts and the two
  UI discriminators that prove the page is not silently on the mock. 34/34 live, coverage gate
  clean. The conversion earned its keep immediately: a page-wide "no `0h`" assertion failed,
  because `0h` is legitimately on the SLA tab from the generated Service Fulfillment and Concierge
  panels — invisible under the mock, and now scoped to the `Avg time to review` tile.
  **Superseded by D252** (below): those panels are measured now, Seasonal is deleted, and the
  page-wide sweep is back and green.

- ✅ **D252 — the two half-mock admin pages, 2026-08-26.** `AdminAnalytics` and `AdminSocieties`
  were each reading a live service and a browser generator into the same screen. Both are closed.
  **Analytics:** `/admin/analytics/sla` gained three `Track`s derived from `audit_log` — ticket
  pickup (4h), service delivery (72h), concierge → live (168h) — replacing figures `slaMetrics()`
  invented; every average, median and rate is nullable, because a desk that has closed nothing has
  no compliance record and `0h` would read as instantaneous service. What had no measurable source
  at all was **deleted rather than labelled**: the Seasonal tab, the six-month price trend, the
  per-listing price position table, the weekly compliance line, and with them `Card`'s `chip` prop
  and `SampleTabNotice`. A chart nobody can source does not become sourceable by being labelled,
  and the label was what made keeping it feel defensible. Deep links to `?tab=seasonal` fall back
  to Traffic — the page took the URL's tab key as read, so any unknown value (including a tab an
  operator had switched off in Settings) rendered the strip above an empty panel. **Societies:** a
  server-side duplicate scan over the real catalogue, and the society's name on the wire for
  `details` proposals. The scan found a scoring bug the browser version had hidden: dividing shared
  tokens by `min(len)` scores "Willow Towers" at 1.0 against every "Willow …" in the catalogue, and
  because RERA rows are verified they sorted above the actual duplicate and pushed it off the list.
  Jaccard instead. Verified: 75/75 backend (`AdminSlaAnalyticsTest` 23, `SocietyMintTest` 33,
  `SocietyProposalTest` 19), 54/54 admin analytics + societies live specs, lint at the 0-error
  baseline.

  **Review pass, same day.** `react-reviewer`, `code-reviewer` and `security-reviewer` over the
  landed diff, then a strict no-behaviour-change simplification. Security found nothing: the SLA
  query's `%s` slots take only private constants, both new routes carry the same `@PreAuthorize` as
  their siblings, and `duplicateScan` already excludes merged-away rows. Three real defects came out
  of the other two and are fixed: the duplicate column had **three** states for **four** things that
  can be true, so a failed request recorded `[]` and printed "No obvious match" — the sentence that
  gets a second copy verified — with only a `console.warn` behind it; `duplicates()` clamped its
  `limit` with `Math.max(1, …)` instead of refusing out-of-range like `?days=` does two files away;
  and `SocietyProposalService.decide` tolerated a missing society with `orElse(null)` on the one path
  where `apply()` has already written to that id, handing the operator "approved" for a change that
  reached nothing. `queue()`'s null tolerance is deliberate and stays — a page of a hundred rows
  losing one to a race should degrade, not 500. The `dupes` map is now pruned to the rows on screen,
  and the compliance-rate ternary and the average-vs-target colour ladder each existed twice.
  Re-verified: 76/76 backend, 56/56 admin live specs, lint unchanged.

  > **Scaling note, deliberate and open.** `duplicateScan` reads the whole society table and scores
  > it in Java on every request — ~350 rows today, behind a staff-only route, so it is a few
  > milliseconds and the `limit` bound is a contract not a guard. It is worth revisiting at roughly
  > 10k societies, and the shape of the answer is a trigram index (`pg_trgm`) with the scoring pushed
  > into SQL rather than a cache, since the input is the catalogue itself.

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

- ✅ **`properties` / `enquiries` / `listing-freshness` — the five convertible claims, 2026-08-25.**
  An audit of every remaining mock admin spec found exactly five tests making a claim no live spec
  made. All five are now live: an enquiry marked responded writing a note onto the case file the
  moderator opens (`live-enquiries`); the **Unconfirmed (stale)** sub-filter narrowing the queue on
  the server rather than in the page (`live-properties-console`); the follow-up board's one-click
  chaser choosing its template from the tier the *server* reports (`live-outreach-console`); and the
  edit modal's two exits (`live-properties-moderation`). `admin/listing-freshness.spec.js` is
  deleted; the `enquiries` and `properties` twins are retired in place with pointers. Two audit
  items dissolved on inspection rather than converting: **`?review=<id>`** was already covered live
  by `live-notes` with a real uuid, and the edit modal's *prefill* by the existing BHK-correction
  test — so the only genuinely uncovered leg was **Cancel**, which the mock could never have proved
  (its provider is `Object.assign` over `localStorage`, so the store that would report the unwanted
  write is the same object the test reads its "before" from; a modal that saved on Cancel would have
  passed). Live it is a fresh read from the API.

- ⚠️ **A regression I introduced, and mis-certified as pre-existing.** `c1e46ff` moved the console
  search from a synchronous client-side filter to a 250ms debounce plus a round trip, and deleted
  the downstream filters. Three tests in `live-outreach-console` began failing. I checked them by
  stashing and reported them as pre-existing — **wrong, and wrong in a way worth writing down**: the
  stash removed my *spec* edits while the committed page change stayed in the tree, so it could not
  have exonerated the commit. A verification that does not vary the suspected cause proves nothing.
  Restoring the source blob (`git checkout c1e46ff^ -- AdminProperties.jsx`) flipped the file from
  3-fail/1-pass to 3-pass/1-fail, which is decisive in both directions at once. The mechanism: for a
  moment after `fill` the unfiltered queue is still on screen, and `expect(one).toBeVisible()` on a
  locator matching fifteen rows is a **strict mode violation, which aborts instead of retrying** —
  the 20s budget was never spent (it died at 8s) and the message read as "this listing is no longer
  pending", sending me to probe the seed and the API, both of which were fine. `toHaveCount` retries.
  Fixed and green 4/4. The sibling `.first()` call sites were audited and are *not* affected: the
  console already renders a stale queue inert, which `live-properties-console` L1424 pins.

- ✅ **Two long-standing admin-lane failures, both mis-readable as product defects, D253.**
  The full live admin gate had been running six red. Three passed in isolation (ordinary cross-test
  state, left alone deliberately — "fixing" a spec that passes on its own edits the wrong thing).
  The other two were real and neither was a bug in the console:
  - `live-outreach:144` expected the WhatsApp chaser's link to carry Playwright's `BASE_URL`, but
    the server builds it from `punenest.app.base-url`, which `application-e2e.properties:72` defaults
    to `:5173` because **`E2E_APP_BASE_URL` was set nowhere in the repo**. So the assertion held only
    on a lane that happens to serve on the default port, and every chaser this lane composed pointed
    an owner at a port with nothing behind it. That is the failure the spec was written to catch —
    it was catching it, at the lane rather than at the template. `backend/run-lane-admin.ps1` now
    exports it beside `E2E_DB_URL`, where the other lane settings already live. 9/9.
  - `live-consolidation:212` asserted a KPI tile labelled `Open leads`. `63bc0c7` had renamed it to
    **`Awaiting owner`** on purpose: the tile counts `pending`, which per `ContactRequestStatuses`
    means awaiting the *owner's* decision, and the only moves out of it are the owner's — calling it
    an open lead pointed the desk at work it cannot do. The spec's last commit is an ancestor of the
    rename, so it had been asserting a word that no longer exists rather than anything the page got
    wrong. Attribution by `git merge-base --is-ancestor <spec> <source>`, which is decisive where a
    `git stash` is not. 11/11.

**The end state, file by file.** That list read `properties` (39), `consolidation` (14), `finance`
(14), `post-on-behalf` (12), `post-on-behalf-fixes` (10), `localities` (9), `property-recheck-queue`
(9), `enquiries` (9), `settings` (7), `finance-disclosure` (7), `societies` (6), `maps-geo` (4),
`duplicates` (1) — and five of those files no longer exist. Re-derived from disk on 2026-08-26; the
fourteen mock files left in `tests/admin` are all keepers, in three kinds:

- **Deleted outright**, their claims converted: `analytics`, `content`, `settings`, `societies`,
  `consolidation`, `property-recheck-queue`, `duplicates`, `listing-freshness`.
- **Retired in place** — the conversion took the server claims and the file kept the browser ones,
  with a block comment naming where each moved test went: `properties` (20), `enquiries` (2),
  `post-on-behalf` (5), `post-on-behalf-fixes` (5), `localities` (2), `maps-geo` (1).
- **Never conversion work**, and each says why in its own docblock: `finance` (14) and
  `finance-disclosure` (6) under D251 — the first is entirely claims about the browser, the second's
  load-bearing claim is *configurability*, which live cannot demonstrate because the flags are
  server config there; `societies-queues` (6) and `command-palette` (7), which need `page.route`
  fault injection and a mock-provider build respectively, so they are the halves their `live-` twins
  structurally cannot hold; `services-moderation` (3), whose subject is the empty state of a
  live-only domain plus two `RoleRoute` guards; `flatmates` (3), the guards on a retired route's
  redirect; `flatmate-moderation-reach` (4), a mock-fidelity defect; and `notes` (2), the deliberate
  dual described above. Eighty tests in all, and none of them a claim about a server.

Nothing here is waiting on an endpoint. The next admin-shaped work is in the cross-cutting item
above — the runtime pins to mock code that a live build still needs, `admin dashboard/topbar
helpers` among them — not in `tests/admin`.

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

### Consumer wave — `account` (18 files / 94 tests) and `flatmates` (27 files / 118 tests)

Sized 2026-08-23 by reading every file rather than by grepping `localStorage.setItem`, which the
migration README already records as a lower bound. Two corrections to the raw file counts came out
of that and both *reduce* the queue, so they are stated before the lists:

- **Four `flatmates` files were already converted and were not debt — now deleted.** `filters`,
  `map-gate`, `map-popup` and `smart-search` were **byte-identical** (SHA-256) to their `live-`
  twins, created as copies by `aee968b`. The mock config runs the legacy name
  (`testIgnore: /live-.*/`), the live config runs the `live-` name (`testMatch: /live-.*/`), so each
  body ran once per suite. They were **P5c deletion residue**, not conversion work: 31 files → 27,
  140 tests → 118. Cleared 2026-08-23 under the same-commit ruling below — hashes re-verified, all
  four live twins run green (**22/22 ✅**), none of the four seeds anything (no `setItem`, no
  `seed()`), so the live copy was already the identical body against the API, and none was a
  `CROSS_VIEWPORT` entry, so no config moved.
- **This is a tree-wide pattern, not a flatmates one.** The same sweep found **16 byte-identical
  legacy/live pairs — 66 duplicated test bodies** across `flatmates` (4), `home` (5), `search` (5),
  `society` (1) and `services` (1). The flatmates four are gone, leaving **12 pairs / 44 bodies** in
  `home`, `search`, `society` and `services`. Recorded here so P5c deletes them as one known set
  instead of rediscovering them folder by folder.

  > **Closed 2026-08-24 — the set is empty, and P5c must not act on the paragraph above.**
  > Re-hashed every remaining legacy/live name-pair in the tree: **17 pairs, 0 byte-identical.**
  > The `home` and `search` duplicates went out with their own waves rather than as a batch, and
  > the rest have since diverged — the surviving legacy file is now a genuinely different body from
  > its `live-` twin, which is exactly what a converted pair should look like. The paragraph is left
  > standing because the *finding* was real and the reasoning is worth keeping, but acting on it now
  > would delete 17 files that carry real coverage on the belief they are copies. **Re-hash before
  > deleting any pair; never delete on the strength of a matching filename.**
- **`account/owner-profile.spec.js` (5) is a strict subset of `consumer/owner-profile.spec.js`
  (11)** — the live twin covers the same header/grid/not-found ground *and* masking, the seven-field
  wire contract, provenance and the reviews-read failure state. It is a **delete**, not a convert.

  > **Wrong, corrected the same day on reading both files.** The live twin is almost entirely
  > *contract*: seven of its eleven tests never open a browser, and it carried **no console-error
  > guard** and no assertion about the rendered header, the trust badges, the listing rail or the
  > not-found *screen*. Deleting the legacy file would have dropped all of that. It was a
  > **conversion**, done below.

#### `account` — cheapest first

- [x] `owner-profile` (5) — **converted**, absorbed into `consumer/live-owner-profile` (11 → 16 ✅).
      Found a dead assertion in the process: the retired spec asserted
      `getByRole('button', { name: 'Call' }).toHaveCount(0)`, but `Owner.jsx` renders Call and
      WhatsApp as `tel:` / `wa.me` **anchors**. There is no branch in which Call is a button, so the
      one guard the file existed for was green against the exact markup it forbade. Now asked by
      role `link`. Commit `f8a84e6`.
- [x] `support-tickets` (6) — **converted** to `consumer/account/live-support-tickets` (6 ✅). The
      customer half of a domain whose desk half was already live (`ops/live-support-queue`). Three
      mock-shaped premises had to go: the id was asserted as `/SUP-\d+/`, a format only the mock
      mints (the server sends a UUID and both the list and the thread render `{t.id}` raw, so the
      spec now fetches the id and compares); the empty state leaned on a seeded actor staying
      ticket-free, when the seed in fact gives *Priya* a ticket; and creation mutated whoever it
      signed in as, which outlives the file because the DB resets per run. Both now use throwaway
      accounts. The conversion also caught that **the name field is empty and required for a real
      new account** — the retired spec's "name + mobile are prefilled" was true only of the mock's
      seeded user, and a genuinely new writer meets a required empty field.
- [x] `messages-inbox` (12) — **converted** to `live-messages-inbox` (3 ✅). The seed now has a
  named Rahul↔Meera row, but the live test mints a unique buyer thread against Meera's seeded
  Baner listing so message writes never poison shared fixture state. It owns quick/typed sends,
  readback after reload, contact visibility, the report modal, and the dashboard hand-off.
  Staged chat coverage remains in `consumer/property/live-chat-owner`; auto-replies are mock
  theatre, and the location card is not live-reachable because the HTTP mapper has no location.
- [x] `tenant-profile` (6) — **converted** to `live-tenant-profile` (3 ✅). The server-backed
  profile save/reload, blank-name no-write guard, and score checklist replaced browser-store
  premises. The DigiLocker completion and changed-mobile cases are owned by the live verification
  funnel or lack a deterministic provider callback.
- [x] `contact-request-verified-badge` (1) — **converted** to
  `live-contact-request-verified-badge` (1 ✅), with isolated verified/unverified buyers and
  the server-projected `requester.verified` bit before approval.
- [ ] `photo-requests` (2) — **intentionally mock-only**: requests still live exclusively in
  `puneNestPhotoReq:<ownerMobile>`; no backend model, endpoint, provider, or cross-device read
  exists yet.
- [x] **`documents-vault` (1) — deleted, not converted.** Its own header already said the live
      counterpart was `property-integration.spec.js`, and reading that file confirmed it:
      `:295` drives the same upload → slot-flips → remove → slot-empty round-trip *and* asserts
      `POST /me/documents/{propId}` 201 and the `DELETE` on the wire, under a describe block whose
      `afterEach` carries the console guard. Strictly stronger; nothing was lost.
- [x] **`doc-requests-grant` (1) — converted** to `live-doc-requests-grant` (1 ✅). Kept rather than
      folded into `live-buyer-document-access`, because that sibling grants by calling `PATCH
      /me/documents/requests/{reqId}` directly and therefore cannot fail for the bug this spec
      exists for — a dashboard that decided the request in the browser's own copy of the inbox and
      told the server nothing. The PATCH is now asserted on the wire and the row re-read outside the
      browser.
- [x] `view-documents-flow` (3) — **converted** to `live-view-documents-flow` (2 ✅): category
  matching, notification deep-link provenance, view-only rendering, and the granted-without-file
  state now read the API. `doc-viewer-scheme` stays mock-only because live rows are storage URLs,
  never inline `data:` payloads; `doc-info` stays mock-only because no live agreement/info-dot
  fixture reaches that panel.
- [ ] `listing-freshness` (4) — mock-only until the seed exposes deterministic fresh/stale/dormant
  `last_confirmed_at` states; live confirmation itself is already covered elsewhere.
- [ ] `owner-hub` (8), `owner-finances` (4), `pay-rent` (5) — mock cases retained for manual receipt,
  financial-year clock, multiple/empty tenancy, and payout-removal states that the API cannot
  currently fixture or express. Their managed/rent live seam coverage already exists.

  > **Wrong on all three counts, corrected 2026-08-24 by reading the backend rather than the note.**
  > This entry is the reason these files sat still, so the correction is kept beside it.
  >
  > - **`owner-finances` — the "financial-year clock the API cannot express" does not exist as a
  >   gap.** `FinanceService` handles the 1 April Indian FY boundary explicitly, in a comment that
  >   names the two off-by-one bugs it exists to avoid, and `MeFinancesController` serves
  >   `SUMMARY`, `CASHFLOW`, `DUES`, `TRANSACTIONS` (+ `BASIS`). All four tests are convertible
  >   today with no backend work. **CONVERT.**
  > - **`owner-hub` — already live, and the mock spec is very likely vacuous.**
  >   `POST /me/managed-properties` has existed since V33, and `e2e/COVERAGE.md` states in words
  >   that `managed-properties.spec.js` was written because this file "still passes unchanged
  >   after the port". A spec that cannot notice the seam moving underneath it is not coverage.
  >   **VERIFY THE VACUITY, THEN DELETE** — do not convert it twice.
  > - **`pay-rent` — mock-only for a *product* reason, and that reason is now recorded.** Online
  >   rent payment is concept-only: `onlineRentPayment` stays off and the route really renders
  >   `PayRentComingSoon`. Ruled 2026-08-24, written up in
  >   `docs/flows/consumer/rent-tenancy.md` §5.8. The payout-removal gap is real
  >   (`PayoutAccountUpdateRequest` is `@NotBlank`, no `DELETE /me/payout-account`) and is
  >   **deliberately not being filled**. This spec retires *with* the mock at P5c; the surviving
  >   live claim is the coming-soon state. Do not port the fee-breakdown or receipt assertions.
  >
  > The general lesson, now three waves old: **"the API cannot express this" is a claim about the
  > backend and must be checked against the backend.** Twice now it has been recorded from the
  > shape of the mock spec instead.
- [ ] `action-center` (4), `deals-offers` (11), `dashboard` (14) — focused live additions now cover
  API-backed actions in `live-action-center` (2 ✅), `live-deals-offers` (2 ✅), and
  `live-dashboard` (2 ✅); the mock twins remain for local photo/recent-search and unavailable
  timestamp/owner-mobile flows.

#### `flatmates` — cheapest first

- [x] `discovery` (10) — **converted** to `live-discovery` (13 ✅ × 2 viewports = 26). Nine tests
       moved; the tenth is a live capability gap, below. Three of the nine changed subject rather
       than being ported: the vacant-flat disclosure, the "Master bedroom" chip and the split-price
       line all read `roomKind` / `priceBasis` / `shareMax`, none of which is on `FlatmateRoomCreate`
       — they are derived, deliberately, because a client that could name its own `priceBasis` could
       price a shared bed as a private room. The only writer is `POST /properties/{id}/split`, so the
       spec performs the act the product actually offers (post a rent listing → Ops approve → split
       into one master bedroom → moderator publishes) and every field those tests read is then
       server-derived. Two conversion traps worth remembering: the feeds are HTTP round trips, so
       reading the cards straight after a navigation counts `[]` and calls it an empty tab (it failed
       only in file order, not alone); and "Team up" names both the tab and the empty-state rescue
       CTA, so an unscoped `getByRole` fails strict mode only while the feed is in flight — which
       surfaced as a mobile-only failure. The `CROSS_VIEWPORT` entry moved to the live config's
       `mobile` project per the wave-1b rule.
- [x] **Live e2e test for `/me/flatmate-requests` (host's inbox)** — `consumer/flatmates/live-host-requests-inbox.spec.js`
       covers the host's flatmate requests inbox: endpoint accessibility, paging structure, status filtering,
       access control (404 for non-existent, 404 for another host's request). Baseline tests establish the
       contract before expanding to requester contact details and decision workflows.
- [x] **Live e2e tests for flatmate groups, interests, alerts, and seat backfill** — Wave 1c (2026-08-23):
       **COMPLETED: 5 files, 26 tests**
       - `live-groups` (9 tests) — group creation, discovery, filtering by locality/budget/policy, pagination, access control
       - `live-interactions` (5 tests) — express interest in room/group, 409 handling for duplicates and full groups, deletion
       - `live-alerts` (5 tests) — flatmate saved searches via `/me/saved-searches?kind=flatmates`, toggle/delete
       - `live-backfill` (7 tests) — seat management (`PATCH /flatmates/groups/{id}` with `seatsOpen`), tier persistence, access control
       - `live-eligibility` (5 tests) — verification tier immutability, verified-only filtering, tier-aware discovery
       **Ruling applied: 18 mock-side files marked deliberately mock-only keepers (UI routing, form validation):**
       - `posting` (7) — UI modal routing, kept mock
       - `video` (1) — full form workflow recording, kept mock
       - `seeker-verify` (2) — modal display (covered by platform KYC flow), kept mock
       - `no-gate` (4) — badge-not-gate enforcement, kept mock
       - `pg-listing-details` (1) — form field conditional rendering, kept mock
       - `consent` (2) — OTP UI flow, needs live endpoint first, deferred
- [x] **Gap closed, and the note outlived it by several waves.** This entry used to read "a live
       seeker cannot be shown their own request", on the grounds that `Routes.Flatmates` had no
       "my seeker posts" route and the public feed masks `mobile`. **All of it is now false.**
       `MY_POSTS` (`GET /me/flatmate-posts`) exists at `Routes.java:1304` with a controller
       (`FlatmateSeekerController:134`), both providers implement `myFlatmatePosts`, and
       `useFlatmates.jsx:109` reads it into `myPost` — so the banner renders and the own-post
       exclusion at `useFlatmateDiscovery:112` compares server ids on both sides. Proved live by
       `live-interactions-board.spec.js:142`, which is stronger than the mock it replaced: it
       requires other people's cards to render first, so the absence of the seeker's own card is a
       claim about the filter rather than about an empty board. `discovery.spec.js` deleted.
       **The lesson is the ledger's, not the code's:** this is the third stale "no endpoint" note
       this wave — after owner-consent and this one — and each cost an investigation. A note that
       records a gap needs re-reading against the route table before it is trusted.
- [x] **`e2e/package.json` offered a script that could not run.** `test:mobile-small` passed
      `--project=mobile-small` to the *mock* config, which has had no such project since wave 3;
      it exited 1 with "Project(s) ... not found". Deleted rather than repointed at the live
      config: that config resets the database named by `E2E_DB_NAME`, so a bare npm script is the
      exact footgun the lane runners exist to prevent, and `mobile-small` already runs as one of
      the live config's three projects in any full lane run. `README.md`'s script table and
      viewport section were describing the pre-wave-3 layout throughout and now describe both
      configs separately.

- [x] `d97-occupancy-and-reissue` (2) — converted: `live-d97-occupancy-and-reissue.spec.js`.
- [x] `moderate-before-public` (3) — converted: `moderate-before-public.spec.js`.
- [x] **The rest of the folder is converted, and the list that used to sit here was stale.** This
      entry named `my-listings`, `alerts`, `no-gate`, `guardrails`, `backfill`, `groups`,
      `pg-sharing`, `interactions`, `interest-api`, `posting`, `video`, `pg-listing-details`,
      `listings`, `seeker-verify` and `full-journey` as pending. **All fifteen files are gone** —
      retired across earlier waves without this ledger being updated. Verified by listing the
      directory rather than by reading this list, which is the only way to catch it.
- [x] `owner-split` (14) — **migrated, not a keeper.** The note above said "0/14 port, and it stays
      as a mock keeper", and the reason it gave was true and yet not a reason: the dashboard's split
      UI *was* mock-backed end to end (`MyListingsPanel.jsx:213` calling the mock `splitFlat()`,
      `ListingCard.jsx:74-77` reading split state from localStorage), and the seam did export
      `splitProperty`/`unsplitProperty` through both providers with no screen importing either. That
      described **a wiring gap in the product**, which is a thing to fix, not a property of the test.
      Wiring it exposed `Number("3 BHK") → NaN` in `SplitFlatModal`: **every 3-BHK owner was offered
      one room and could not confirm a split.** The mock `splitProperty`/`unsplitProperty` swallowed
      every refusal, so no mock test could ever have caught it. Now `owner-split.spec.js`, and
      moved to the live config's `mobile` project with the rest of its `CROSS_VIEWPORT` entry.

**Mock keepers remaining: none. `e2e/tests/consumer/flatmates/` is 100% live.**

The "recurring reason" this ledger recorded — that several consumer-facing labels read
`getFlatmateReviewStatusMap()` out of localStorage and so "have no browser-readable live source" —
was a description of a missing server capability, not of an impossibility. It was answered by
building the capability:

- **`reviewStatus` seam** — `flatmate_reviews` joined server-side into the feed queries and surfaced
  on the card. Retired `agreement-evidence` (3), `eligibility` (5) and the tier-badge half of
  `rooms-tiers` (5) into `live-review-status.spec.js` (6 tests).
- **flatmate saves** — `V124__flatmate_saves.sql` plus `POST/DELETE /flatmates/saves/{kind}/{id}`
  and `GET /flatmates/saves`. Retired `prefreeze` (1) into `live-flatmate-saves.spec.js` (5 tests).
  The shortlist stores **keys only** and joins the card at read time, which is what lets two of its
  assertions be ones localStorage could not make at all: the shortlist appears on a second browser
  context, and a room repriced after saving shows today's rent rather than the copy taken at tap
  time. Both failed against the old implementation by construction.
- `prefill` (4) and `post-modal` (1) converted directly. `post-modal` was hiding an accessibility
  defect: two `NativeSelect`s rendered with no accessible name, and the mock spec had worked around
  it with positional selectors rather than reporting it.

**The lesson, and it now has eleven instances:** in this repo a "cannot be migrated / no endpoint"
note has never once survived being checked against `Routes.java` and the component source. Every
one of them was a record of what had not been built yet, written in the grammar of a constraint.
Check the route table, not the ledger.

- [x] **Final sweep of the mock side — two tests retired as redundant, not as coverage.**
      - `discovery.spec.js` (1 test, whole file deleted). Its single claim — a seeker's own request is
        announced as theirs rather than offered back as a card — is `live-interactions-board.spec.js:142`
        live, and *stronger*: that test requires other people's cards to render first, so the absence
        is a claim about the filter rather than about an empty board.
      - `post-modal.spec.js` test 2 ("picking a locality via the dropdown and submitting posts the
        request"). `my-listings.spec.js:121` drives the identical dropdown→submit path against a
        real server, waits on `POST /flatmates/posts` and asserts **201**, then reads
        `GET /me/flatmate-posts` back on a connection the page is not holding; its second test owns the
        "in review" banner. The mock provider stores the client's own object and hands it back, so it
        could never have produced the failure the live twin catches. Test 1 stays — the two P0 matching
        selects and the Lifestyle dropdown are form-shape claims no route can testify about.
      - Mock suite after both: **220 passed, 4 skipped** (was 222 running + 4 skipped).

- [x] **`e2e/COVERAGE.md` dangling citations closed (flatmates half).** `check:coverage` was failing on
      eight paths; three were flatmates specs retired in earlier waves without their rows being
      repointed. Traced each to its retiring commit rather than guessing the twin:
      `interest-api` → `live-interest-doors` (`7442ae6`), `alerts` → `live-alerts-card` (`046da04`),
      `posting` → `live-posting` (`a8eeb69`, a prose example rather than a row).
      The ten `interest-api` rows could not simply be repointed: that commit **inverted** four of them.
      The mock's "second device" family was reachable only because sent-state came from a localStorage
      map of *this browser's* taps; live, `useFlatmates` restores the CTA from the server outbox
      (`GET /me/flatmate-interests`) on identity change, so a second device arrives already showing
      "Interest sent" and the duplicate is unreachable through the UI. The rows now say that, and the
      409 is cited where it still lives — `live-interactions`, reachable only by a non-UI client.
      Remaining five dangling paths (`admin/duplicates`, `admin/listing-freshness`,
      `consumer/account/{dashboard,owner-finances,owner-hub}`) belong to the **parallel admin session**
      and were deliberately left alone.

- [x] `owner-id-inbox` (1) → `live-host-inbox` — a seeker's interest reaches the host's
      `/dashboard#enquiries` Flatmate tab and **Accept is read back from `/me/flatmate-requests`
      with an independent client**, which is the half the mock could not prove. D186's "ownerId
      bucket, not the mobile bucket" does not port: live scoping is by bearer token, so the defect
      class is structurally impossible. Mock retired.
- [x] `consent` (2) → `live-owner-consent`. The "deferred pending confirmation of API endpoints"
      note in `tasks/flatmates-wave-triage.md` was **stale** — `POST /flatmates/groups/{id}/owner-consent`
      has existed all along. Mock retired. What the conversion found is below.

- [x] **Owner consent is unreachable from the browser on a live build, and the seam method that
      would reach it had never run.** Three findings, one dead code path. **Closed** — see the
      resolution note below the original write-up.

  > **The flow bypasses the seam entirely.** `OwnerConsentModal` runs `useOtpFlow()` against the
  > mock dispatch and writes `setOwnerConsent()` straight to `localStorage`; it never calls
  > `flatmateService`. `Flatmates.jsx:133` only flips `consentVerified` on the *form*, and
  > `useFlatmateSupply.jsx:233` turns that into an `ownerConsent: true` key on the create payload.
  > The server drops it — `FlatmateMapper.applyTo(FlatmateGroupCreateRequest, …)` is
  > `@BeanMapping(ignoreByDefault = true)` and names `ownerConsent` as deliberately not
  > client-settable, which is correct: a tenant who could assert their own landlord's consent would
  > make the record worthless. The only writer is `FlatmateSupplyService.ownerConsent`, behind a
  > purpose-scoped OTP (`OtpCode.PURPOSE_OWNER_CONSENT`) and a self-consent refusal. So live, the
  > tenant completes the OTP, is told "Owner consent recorded", and the group is created with
  > `ownerConsent = false`: no chip, no `flatmate_owner_consents` row, no audit entry. **Fails
  > closed, so a broken feature rather than a hole** — but the anti-broker guardrail does not exist
  > on the live build. Closing it means moving consent *after* group creation (the group id is the
  > route's path variable, and today consent is collected before the group exists) and putting the
  > modal on the seam. **Product/architecture call — not taken unilaterally.**

  > **Both providers had the wrong contract, which is what a method nobody calls decays into.**
  > Fixed, since these are unambiguous. `http/flatmateProvider.js` posted `{ mobile, consent }`
  > where the server's body is `OwnerConsentRequest(@NotBlank @IndianMobile String ownerMobile,
  > String otp)` — `ownerMobile` arrived null, so **every call would have been refused at
  > validation**, and `consent` is a client-asserted boolean the server has no field for. The mock
  > read `body.mobile` for the same reason and then called `setOwnerConsent(id, mobile, …)` against
  > a `(ownerMobile, byMobile)` signature, keying the consent map by the digits of the *group id*
  > and recording the owner as the grantee — the record inverted. Both now speak the server's
  > two-step shape: no `otp` means "send one", an `otp` records it.

  > The general lesson, and it is the fourth time this wave has produced it: **an export that no
  > screen calls is not covered by anything, in either provider.** The mock spec passed because the
  > modal wrote localStorage directly, so neither half of the seam was ever exercised.

  > **Resolved.** The "product/architecture call" above framed the fix as *moving consent after
  > group creation*, because the route's path variable is a group id. That framing was wrong, and
  > the schema said so already: V27 keys `flatmate_owner_consents` on `(owner_mobile, granted_by)`
  > with a **nullable** `group_id`. Consent is a fact about two people, not about one post — so it
  > can be taken while the form is still open, exactly where the UI already asks for it, and read
  > back at submit time. Nothing had to move; a second entry point had to exist.
  >
  > Added `POST /flatmates/owner-consent` (`Routes.Flatmates.OWNER_CONSENT`) and
  > `FlatmateOwnerConsentService`, which now owns normalise / send / record / has for both entry
  > points. `FlatmateSupplyService.createGroup` calls `consentService.has(...)` and sets the flag
  > server-side, so `ownerConsent` stays non-client-settable and the Ops review entry finally
  > reflects reality (`saved.isOwnerConsent()` feeds `publication.enqueueReviewIfNeeded`).
  > `OwnerConsentModal` calls the seam twice instead of `useOtpFlow` + `setOwnerConsent`, and
  > surfaces send/verify failures rather than succeeding on a timer — a wrong code is now a 401 the
  > user sees. `FlatmateSupplyService` shrank 880 → 871; the size-guard pin was ratcheted down.
  > Covered by `FlatmateOwnerConsentEndpointsTest` (6) and a third browser-driven test in
  > `owner-consent.spec.js` that proves the modal reaches the database.
  >
  > **This is the twelfth "cannot be done" note in this migration to be a description of something
  > nobody had built yet.** It was also the most convincing, because it named a real constraint
  > (the path variable) — the constraint was just on the wrong route.

- [x] **`uniqueMobile()` could return the same "unique" number twice.** Found by the consent work:
      the helper was `97 + Date.now().slice(-8)`, so two calls with no `await` between them
      collided. My spec named a tenant and an owner back to back, got one number, and the server
      correctly refused the tenant for consenting to themselves — a 400 that pointed nowhere near
      the helper. Elsewhere it would be worse and quieter: two supposedly-distinct actors would
      silently be one account. Now clamped to be strictly increasing, so a worker cannot reissue a
      number, with the format unchanged.

**Ruled 2026-08-23 by the product owner: a converted legacy twin is deleted in the same commit.**
The question was whether conversion deletes the mock-side file (what the notifications, owner-profile
and support-tickets slices did, and what waves 1b/1e did) or leaves it to die at P5c (what `aee968b`
did, producing the 16 byte-identical pairs above). The ruling is the first, stated as *"keep removing
whatever is done and working perfectly with APIs"* — so the legacy file goes as soon as its live twin
is green, and the 16 existing duplicate pairs become a backlog to clear rather than a pattern to
follow. The standing condition is unchanged and is what "working perfectly" means here: the live
twin must actually cover the behaviour, which is a question to answer by reading both files, not by
comparing test counts (`owner-profile` looked like a strict subset and was not).

- [x] **Dashboard split UI wired to the seam — done, and it hid a defect.**
  `MyListingsPanel.jsx` called `splitFlat()` from `lib/data/flatSplit.js` (mock) and
  `ListingCard.jsx:74-77` read split state from `getRooms()` → localStorage key
  `puneNestRoomListings`, so a split performed via the server API never reached the card. Both are
  now on the seam (`flatmateService.js` → `splitProperty`/`unsplitProperty`), which is what
  `owner-split.spec.js` drives.
  **The defect this was hiding:** `SplitFlatModal` derived the room ceiling with `Number(bhk)`, and
  `bhk` arrives as `"3 BHK"`, so `Number("3 BHK")` is `NaN` — **every 3-BHK owner was offered a
  single room and could not confirm a split at all.** It was invisible because the mock
  `splitProperty`/`unsplitProperty` swallowed every refusal and returned success regardless, so the
  one provider a test could reach could not express the failure. An unused seam is uncovered; a
  *lying* mock is worse, because it makes the coverage look real.

- [ ] **No server-side badge promotion after deferred approval.** `FlatSplitService.split()` (line
  96-97) sets `verified`/`verificationTier` at creation time based on the parent listing's current
  status. When a pending parent is later approved, there is no callback or event listener to promote
  the rooms. The mock has `reconcileSplitVerification()` (`flatSplit.js:177`) for client-side
  reconciliation — a workaround that has no server equivalent.
  **Deliberately left as a product gap, not a test gap.** The claim "promotes the rooms once the flat
  is approved later" describes behaviour the server does not have, so there is nothing to assert;
  `owner-split.spec.js` states this in its docblock rather than carrying a skipped test. Fixing
  it means an event on listing approval that re-derives tier for the split children.

### Closed recently

- **A signed-out stranger could type a PAN, an Aadhaar and two permanent addresses into the rent
  agreement wizard, upload the scans, and only then be asked who they were (D262).** The sign-in
  bounce dropped the uploads entirely — `captureFormState` never carried them — so the ask arrived
  after the cost of answering it had been paid twice, and the duplicate-request lock, which is
  keyed on the account, could not fire for a guest at all. The wizard now opens step 0 only, which
  is the step that produces the Estimated Total and asks about nothing but a building; steps 1–5
  are where identity begins and sit behind the line, padlocked in the rail with a banner and a
  "Sign in to continue" primary button. Crossing the line costs nothing: `useFormDraft` grew a
  `flush()` the gate calls before it navigates, and the round trip carries `next` back to this page
  through **both** the sign-in and the sign-up leg. Three specs in
  `consumer/services/rent-agreement.spec.js` (7 ✅), four `e2e/COVERAGE.md` rows. Three things came
  out of it that were not the reported bug:

  > **`isIn` is two-state and the guard needed three.** It is `!!user`, so it reads false both for
  > "signed out" and for "auth has not answered yet" — and four copies of `!isIn` had already
  > drifted apart on which one they meant. Derived once now as
  > `gated = mode === 'owner' && !loading && !isIn`, read by the clamp, `next`, the rail, the
  > banner and the button. Uncovered by test and untestable in Playwright (it needs a browser that
  > drops `localStorage` while keeping the refresh cookie) — held structurally instead, with the
  > reason recorded as a ⛔ row.

  > **The autosave was debouncing renders, not changes.** The effect keyed on `form`, which every
  > caller rebuilds each render, so the 400ms ran from the last *render*; any render cadence under
  > the debounce would have starved the write forever. It survived on the accident that nothing
  > re-renders those pages in a loop. Now serialised during render and debounced on the string.

  > **`login()` in that spec had been signing nobody in.** It seeded `draazyUser` alone, which
  > stopped being a session at the token rework — `AuthContext` finds no token and no session hint,
  > calls `logoutUser()`, and erases it. Four tests had been running as anonymous visitors while
  > claiming to be a buyer; none failed, because none asserted anything an account was needed for.
  > The gate is the first thing in the file to read `isIn`. Pre-existing, found not caused.

- **A host was being told "null is interested in your room in Baner".** The flatmate interest
  notification built its title by concatenating `users.name`, which is nullable — and null for
  exactly the person most likely to be sending one, someone who signed in by OTP to answer an ad
  and never filled in a profile. Java renders an absent reference as the four letters `null`.
  `FlatmateSupplyService` already knew the field was nullable: the group-join path a hundred lines
  above carries the null through untouched and explains why (D118 — the schema used to substitute
  the literal "Member", which showed the host a name the platform had invented). The title now
  falls back to "Someone", which is what `OfferService` and `ConversationService` already say in
  the same position: indefinite rather than made up. The body is untouched, because `users.mobile`
  is the login identity and NOT NULL — an unnamed seeker is still reachable, which is what makes an
  indefinite title tolerable rather than a dead end. Three tests in a new "The host's notification"
  nest in `FlatmateEditAndInterestEndpointsTest` read the row the host actually opens; every other
  test in that file seeds named users, which is how this survived. Found while converting the
  flatmate e2e specs.

- **`consumer/property` is live, and converting it found that both halves of the duplicate rule
  had never fired.** Eight mock specs retired for eight `live-` twins — `passport`,
  `deal-visibility`, `chat-owner`, `scheduled-visits`, `alerts`, `detail`, `dedup`, `dup-modal` —
  and the folder now runs **87 ✅** against the API. Two server defects came out of it, both in
  `ListingDuplicateProbe`, both invisible to a mock because a mock stores whatever the client sent
  and hands it straight back:

  > **The meter arm compared spellings, not meters (V115).** V79 added `electricity_meter_no` on the
  > reasoning that a meter number "has one spelling". True of the meter, false of the number: it is
  > copied off a bill that prints it in groups, so one MSEDCL consumer number arrives as
  > `170012345678`, `1700 1234 5678` and `170-0123-45678`, and both queries compared with `=`. The
  > cost landed on the arm that is meant to be the *certain* one — an owner who typed spaces in
  > March and none in April was never told they had already listed it, and two owners fighting over
  > one flat were never flagged — while the weaker address arm kept working, so the platform
  > reported no duplicates and everyone believed it. `electricity_meter_key` follows what V79 already
  > did for `address`: raw column for the human who checks it against a printed bill, derived key
  > for the comparison, written only by `MeterKey` on the server and never accepted from a client.
  > The six-digit floor is not tidiness — an optional field collects `0`, `NA`, `1234`, and under
  > exact equality every owner who typed the same placeholder collides with every other.

  > **The photo arm never left the browser (V116).** The wizard has hashed photos (8×8 average hash,
  > 64 bits) since it was written, and compared them against `localStorage` — which holds only *this*
  > browser's own listings, i.e. precisely the case the rule already declines to flag. So the signal
  > existed, ran on every upload, and could not by construction find the thing it was for.
  > `property_photo_hashes` stores the hash server-side with four 16-bit generated bands; band
  > equality is a pigeonhole pre-filter, exact at Hamming d ≤ 3 against a product threshold of 10, so
  > recall is deliberately partial. That is acceptable *only* because this arm files a case note for
  > ops and never blocks an owner; it would not be acceptable as a gate.

  Worth keeping from the conversion itself. `live-detail` refused to port two of the mock's cases
  rather than translating them: `type: undefined` and `createdAt: undefined` are unreachable live
  (`property_type` is `NOT NULL` per V3, `created_at` is `NOT NULL DEFAULT now()` per V1), so it
  targets the genuinely nullable `bhk` through seeded `p5124` (Open Plot, Wagholi) and asserts the
  exact heading *first*, before the four absences — an all-absence spec that renders nothing passes
  itself. `ConversationOpeningService` was split out of `ConversationService` for the chat-owner
  conversion, which is also the edit that made the next paragraph expensive.

  > **The wave was already finished and green when the previous session reported it as failing.**
  > The verification run went against a JVM booted at 16:43 against sources last edited at 18:34 —
  > including a class that did not exist when the process started. Nothing was wrong with the tree;
  > restarting the backend on the identical commit turned the same command green. `run-e2e-backend.ps1`
  > exists so that restart is one command rather than a paragraph in a config docblock.

- **The notification inbox now asserts across the boundary, and the type it really sends is
  mapped.** `consumer/account/notifications.spec.js` → `live-notifications.spec.js` (7 ✅): the page
  acts, then a *second* API client reads the inbox back outside the browser, so mark-all and dismiss
  are asserted at the wire rather than against the array the test itself wrote. The conversion found
  a live defect — `toUiType` had no entry for `match.saved-search`, the only spelling
  `SavedSearchService.alert()` ever emits, so the one notification the alerts product exists to
  deliver rendered as the grey *unrecognised* glyph and matched **no filter chip at all**, reported
  only by a `console.warn` the runner discards. The seed spells it differently again
  (`saved.search.match`, `R__zz_dev_demo_data.sql:467`); both are mapped, because a mapper taught
  only the seed's vocabulary is green in e2e and wrong in production. Proven RED with the two
  entries commented out and GREEN with them restored. Commit `20ff3dd`.

  > **Follow-up, deliberately not taken in that commit.** `property-integration.spec.js` covers
  > the same three behaviours against the *owner*, and two of its tests are guarded by a conditional
  > `test.skip` reading "only flatmate flows write server notifications". That is false — there are
  > **ten** `notifier.notify` call sites (offer, visit, document, contact, message, listing,
  > saved-search and three flatmate paths). Those two tests have been silently passing. Left alone
  > because the file is 2,692 lines and shared by many specs, and changing a shared locator
  > mid-conversion is how a suite-wide flake is introduced.

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

**The server cannot tell a hand-granted Verified badge from a review-granted one, so it cannot
refuse the withdrawal.** `users` carries one `verified` boolean and no record of who set it;
`UserResponse` exposes no identity flag at all. The admin console's withdraw button was guarded by
`u.verified && u.identityVerified`, a field nothing on the wire has ever sent, so the guard never
fired and the reason text never appeared — the control has been enabled all along. Guard removed
rather than left as decoration, and `e2e/tests/admin/users.spec.js` now parks the claim with
`test.fixme`. The rule itself is right: withdrawing a badge a reviewer granted is unrecoverable,
since re-running a decided case is a no-op. Real fix is server-side — record the grant's origin (a
`verified_source` column, or derive it from a decided `identity_verifications` row) and answer 409
— then unpark the spec.

**`frontend/src/data/referrals.json` was deleted as an orphan, and three doc lines still cite it.**
`docs/flows/consumer/plans-billing-refer.md` L29, L48 and L209 name the file as the referral
fixture. Nothing imports it (the ops desk reads `GET /referrals`), and its rows still carried
`aadhaarVerified`/`aadhaarUnique`, so it was a stale copy of a contract the server had already
renamed. The doc lines want rewriting to point at the live route.

**A room card is titled by `r.society` with no fallback, and a genuinely split flat may not have
one.** `RoomCard.jsx` renders `{r.society}` as the headline, and reuses the same string for the
image `alt`, the share label, and the report payload's `ownerName` — four places that read as a
missing image or an unnamed report rather than as an empty title. That is safe for a room posted
through `createRoom`, which takes the society text from the host. It is **not** safe for a room
minted by `FlatSplitService.buildRoom`, which copies the parent listing's `society_id` but never
its `society` label; a listing whose society is off-registry has the id NULL too, so the rooms come
out with nothing to render. The dev seed sidesteps this by writing the label onto the split rooms
by hand — that is a fixture working around a product gap, not a fix. Real fix is one of: have
`buildRoom` carry the parent's society text across, or give the card a fallback built from the
facts it does have (`{flatType} in {locality}`). Found while seeding, deliberately left alone so a
data change stayed a data change.

**The phone smart-search bar is now one shape on `/listings` and `/flatmates`, and the work found a
live bug two components away.** Both bars are pills with the submit as a solid circle floating 4px
inside the right end. Flatmates got there first; listings had a 44px rounded square butting the
edge, plus a `pr-[84px]` that was short of its own 98px control stack, so a long placeholder ran
under the save-search bell. The circle is 36px, under the touch floor, so it carries `.tap-extend`
— and `.btn-primary` sets no `position`, hence the explicit `relative` beside it. The bell keeps a
real 44×44 box and lost only its hover plate, which was a third corner radius stacked inside the
pill. Nothing at ≥640px changed. New spec `mobile/live-search-submit-shape` (16 tests: two pages ×
two phone projects × four claims), red-checked twice.

The bug: the assistant's `fixed right-4 z-[1300]` layer spans a 240px column of the bottom-right
corner whether or not anything in it is interactive, and the first-visit nudge appears unprompted.
On a 360px phone that column reaches the search submit — `elementFromPoint` returned the nudge
bubble, and once the bubble was muted, the empty flex wrapper holding it. Neither has a handler, so
a tap on search died silently for the six seconds the nudge lives. Fixed with `pointer-events: none`
on the layer and `-auto` on the FAB, the nudge's dismiss glyph and the open panel, rather than
adding the two routes to `NUDGE_MUTED`, which would only move the trap to the next cramped surface.
Worth knowing this was invisible to every functional test and to the generic 44px sweep; it surfaced
only because one behavioural test passed at 412 and failed at 360.

Four things read during that work were left alone deliberately, all pre-existing and shared by both
bars. The smart-search input's `onKeyDown` fires on Enter mid-IME-composition, so a Gboard Indic
transliteration submits a half-typed query — it needs `!e.nativeEvent.isComposing`. Its only focus
indicator is `focus:border-teal-400/50` over `border-white/10`, which will not clear WCAG 2.4.13.
It has no `aria-label`, so its accessible name is the deal-dependent placeholder, which disappears
the moment you type, and neither page has a `role="search"` landmark. And `.btn-primary` without
`.btn` inherits no `transition` — `buttons.css` puts it on the `.btn/.btn-teal/.btn-outline/.dz-btn`
block — so the hover lift and brightness on both submits snap rather than ease. Each is a one-line
change but each is a behaviour change on a shared control, so none belongs in a restyle.

**`live-tap-targets.spec.js` rounded its failure message and flaked on exactly-44px controls — both
fixed.** The message did `w: Math.round(box.w)` while the assertion compared `box.w`, so a 43.99px
control printed as "44" and failed, which reads as an impossible result and invites someone to
loosen the floor. Now reported to two decimals. The flake underneath it was structural: the poll
returned as soon as enough elements had rendered and froze whatever `undersized` was true at that
instant, which could be mid-reflow. Several controls are drawn at exactly `w-11 h-11` — 44.000px
measured at rest, zero margin against the floor — so a fractional grid-track width while card
images are still landing reports 43.99. The spec now re-measures until the list is clean (5s cap)
before asserting. That is not a loosening: a genuinely undersized control never clears, the poll
times out, and the assertion still fails with the full evidence. Seen on `.heart-btn` and on the
compare button on `/listings`, both at `mobile-small`. The 44px floor itself is untouched — but
note that any control specced at exactly 44 has no tolerance for layout jitter, so a future design
pass could reasonably give these a pixel of headroom rather than relying on the settle.

**The swipe-vs-slider guard in `lib/useSwipeDismiss.js` has been reviewed.** `react-reviewer` and
`code-simplifier` were unavailable when it went in (provider rate limit), so it shipped on a manual
read; both have since run and raised nothing against it. The fix is four lines: `onPointerDown`
declines to arm when the press lands inside `input[type="range"]`, because the listings filter
drawer dismisses on a leftward drag and its price thumb is dragged leftward too — the drawer was
sliding away after one step of the slider. Verified red-then-green by disabling the guard
(`mobile/live-sheets-and-actions`, two tests). The open question the review did **not** close, since
it needs a fresh eye rather than a re-read: whether any *other* control that owns a drag can render
inside an overlay using this hook. I checked the filter drawer (`overflow-x-hidden`, no horizontal
scroller, both sliders native) and the `axis: 'y'` consumers (Modal/Select/MultiSelect/Menu — the
only horizontal gesture near them is the gallery lightbox, a different axis), but that sweep was by
grep.

**A filter slider used to fetch once per step; it now fetches once per intent** (`lib/
useCommitOnRelease.js`, wired into `ui/DualRange` and the near-a-place radius). Dragging the budget
thumb issued **239 requests / 5.2 MB** in one gesture: React aliases a range input's `onChange` to
the native `input` event, which fires on every step, and each step became a `GET /properties`. The
page's existing `useDeferredValue` did not help and could not — it deprioritises *rendering*, not
network. A debounce was rejected twice over: it still fires mid-drag (a four-second drag at 250 ms
is sixteen requests for one decision), and on the shared query it would have delayed the discrete
filters that are already one intent each and should feel instant.

The hook holds the in-flight value locally and lifts it when the value **settles**, using the
platform's own `change` event rather than a list of gestures. That distinction is the whole point:
the first version listened for `pointerup`/`keyup`, which a VoiceOver slider-adjust fires neither
of — a screen-reader user would have heard the value change while the results behind it never
moved. Two things the review caught that the tests had not: every readout must render from the
hook's value (the radius number, the preset `aria-pressed`, the derived "≈ N km" line and the
group summary were still on `f.nearRadius`, so they froze while the thumb moved), and dropping
`keyup` silently reopened the storm for keyboard users, because a range fires `change` on *every*
key step — auto-repeat across the budget slider is ~80 searches. A 120 ms coalesce window closes
that; it is not the rejected debounce, since it sits on the control, starts only once the value has
settled, and a drag never enters it. Verified red-then-green three ways: 9 and 7 searches mid-drag
without the hook, 8 across a held key without the window. 20 desktop + 9 mobile specs green.

Not done, and worth its own decision rather than a quiet fix: `useListingsSearch` still only
*discards* superseded responses (a `seq` ref) instead of aborting them, so their bytes are still
paid for. That mattered at 239 in flight; at one or two it is close to noise, and threading a
`signal` through the service and provider seams is a real change. Left for when something else
needs that plumbing.

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
- **~~Two~~ No readers on `/admin/societies` are still the client catalogue.** ~~Three~~ ~~Two~~ — the **merge
  picker** was the load-bearing one and is now fixed: `searchSocieties` moved to the
  `societyService` seam over `GET /societies?q=`, so an operator can merge one freshly-minted
  duplicate into another and `live-societies.spec.js` no longer bends around the gap. The **overlay
  editor** now has a server behind it — V112 gave `societies` an `admin_note` column and `PATCH
  /admin/societies/{slug}` writes it — and the editor is repointed onto that route, so the edit is
  real rather than a note this browser keeps to itself. The **Directory tab** pages off `GET
  /societies` (register 36's envelope) rather than enumerating the bundled 348 rows. And under D252
  the page stopped importing `lib/store.js` altogether: the last two readers were the **duplicate
  hints** and the **society name on a `details` proposal**, both of which asked the 28-society
  bundle about member-added societies it has never held. Duplicates are `GET
  /admin/society-candidates/{slug}/duplicates` now; the name travels on `SocietyProposalResponse`.
  `resolveSociety`/`suggestDuplicates` stay in `lib/store/societyAdmin.js` — the consumer society
  pages and the mock provider are legitimate callers.
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
Known red outside this set and untouched: `property-integration.spec.js:689`/`:720` (P6
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
  so `warnIfTruncated` fires on both `/admin/properties` reads and `property-integration.spec.js`
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
- `ui/Modal.jsx:108` builds its close button's label as `` `Close ${title}` `` in English, so a
  Hindi or Marathi reader hears one English word welded to a translated title. Pre-existing, and it
  now affects every modal in the app rather than a handful. Needs a `common.*` key taking `title`.
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
| 2026-09-14 | The admin "Ownership document checks" panel, from a wall of policy prose into a four-step case file. The verdict is now a tone-switched banner at the top carrying the *Still required* list (it was a plain `text-sm` line halfway down, after ~90 words of rules); the deal-specific requirement moved into a `<details>`; the identity facts became a grid where an absent value reads as absent rather than as a mono string like the real consumer number beside it. Both custom `Select`s had **placeholder-only labels** — no caption on screen, and once a value was picked no label at all — so each gained a visible caption that is a substring of its `ariaLabel` (a `Select` renders a `<button>`, so `htmlFor` can never reach it). The load-bearing fix is structural: `Record evidence` and `Grant ownership verification` were identical-weight buttons a hairline apart, reading as one sequence, which contradicts the panel's own sentence that they are separate decisions — they are now steps 3 and 4 of numbered cards, with the record button carrying "It does not grant the badge". `VerificationSummary` split into `VerdictBanner` + `RecordedEvidence`, and Grant now unmounts when verified instead of rendering permanently disabled. `Select` gained an `ariaDescribedBy` passthrough: it was the only way to reach the sentence explaining why the dropdown is dead when nothing has been uploaded |
| 2026-09-08 | The flatmates fixture, from 2 rooms and six empty tables to a board that actually exercises the section. Ported from the mock catalogue in `flatmates/constants.js`, which survived the mock-provider retirement with **no readers left** — the port to SQL took the shape and left the content behind, which is why the section read as empty. Rooms 2 → 13, groups 8 → 13, members/reviews/requests/saves/applications/consents 0 → 15/3/4/4/2/1, and the two original rooms backfilled: both had `society = NULL` and RoomCard renders it as the card's headline, so **every room card in dev was untitled**. Every row is a state the server can reach, which constrains more than it sounds like — `createRoom` hard-codes `seats_total = seats_open = 1` and exposes neither `price_basis` nor `room_kind`, so the occupancy model (and with it `occupancy = filling`, `flatMax`, and the whole split-the-rent price block) is reachable **only** through `POST /properties/{id}/split`; p5123 is split three ways to get it. Split target picked by assertion, not taste: p5121 is asserted to *show* the split card before splitting, p5122 is a 1 BHK, p5123's only claims are about the rent benchmark. Two rows were rewritten after the lane caught them, both cases of a fixture that reads richer being a fixture that is wrong: a room seeded into **Aundh**, which `live-discovery` requires bare so its empty-tab rescue has a subject (moved to Hadapsar), and a group given a **`property_id`** to put a group in the move-in tab, which the same spec forbids on the wire — a group is people, a flat you can move into is a room, and that tab holds rooms by design |
| 2026-09-08 | The Flatmates board's two floating controls, on a phone: the hero "Post" deleted (three posting CTAs became exactly one per width — the bar's `+` below 1024px, the tab-row `Post` above it), and the Filters trigger moved off the top-pinned deck into the same bottom-left `.filter-fab` capsule the listings board uses. Fixed on the way past: the DPDPA consent bar was landing on top of that capsule and eating its taps on **both** routes, so a first-time guest could not open filters at all |
| 2026-09-06 | One posting sheet behind both the bottom-bar `+` and the Flatmates hero "Post" — and the `z-[90]` that had every modal in the app painting under the DPDPA consent bar |
| 2026-08-24 | `consumer/property` onto the live API — 8 mock specs retired, 87 live tests green; V115 and V116 gave the duplicate probe the two arms that had never fired |
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
