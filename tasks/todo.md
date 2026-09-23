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

- The flatmates board filtered nothing: `ba52efe1` silently reverted `ee145b75`, leaving
  `flatmateProvider.feed()` forwarding only `tab`/`locality`/`page`/`size`. Under
  [D263](DECISIONS-NEEDED.md) the browser predicates that used to re-filter the page were *deleted*,
  so a facet dropped in the provider is not narrowed late — it is not applied at all. Budget,
  gender, move-in, habits, sharing, attached-bath, verified-only, proximity, sort and the `me`
  match facets are restored, along with `signal` (cancels a superseded read) and `verifiedTotal` /
  `pageCount`, whose absence had made the pager's clamp `NaN`. Found by asking the API directly —
  `/api/flatmates/rooms?maxBudget=10000` returned 4 of 13 rows, which put the bug entirely on the
  client in one command; attributed with `git log -L '/export async function feed/,/^}/:<path>'`,
  which shows a function's own history when `git log --oneline` on the file does not.
- Two overlays took the scroll lock without announcing themselves — the `/compare` picker and
  `DashboardReviewModal` now carry `role="dialog" aria-modal="true"` and a name, and the keyboard
  half of that claim as well: `useModalDialog` (Escape, Tab trap, focus in and back out) was
  extracted from `Modal.jsx`, which now uses it, rather than copied into two more files. The review
  modal is named by `aria-labelledby` on its own `<h3>` — a fixed string would have announced a
  name that appears nowhere on screen, since the heading is the listing's title. Deliberately
  **not** applied at the other three Escape sites: `MobileNav` and `CategorySwitcher` put `role` on
  the *backdrop* while their ref is on the inner panel, so the guard would compare a non-dialog and
  kill Escape outright, and none of the three can stack (`/saved` renders no second dialog;
  `SocietyLocationModal` is mount-gated and mutually exclusive with its seven siblings).
  `compare.spec.js`'s `Area (sq.ft.)` assertion was stale, not broken — `ba28fdc0` moved the
  unit into each cell because a parcel is measured in acres or guntha.
  `post-on-behalf.spec.js:618` still quotes the old string. Open: `GroupModal`, `PostModal` and
  `ContactOwnerModal` still hand-roll the Escape half only — adopting `useModalDialog` there would
  *add* a Tab trap and focus restore, so it is an a11y slice with its own specs, not a refactor.
- `check-coverage-citations.mjs` had been permanently red, which is the one state a gate must never
  sit in — a red it is meant to have is a red nobody reads. Two unrelated causes: a spec renamed by
  `23aa4651` (`mobile/live-wizard-sticky` → `mobile/wizard-actions`, found with
  `git log --diff-filter=D`), and the closed-items table at the foot of `COVERAGE.md`, which names
  deliberately deleted specs because recording what each taught is its purpose. Rows the doc marks
  `(retired …)` are now skipped. Proven still able to fail by appending a bogus citation.
- Graph communities are named by their hub (`"authHeaders"`) rather than described, because
  `graphify label` finds no LLM backend on this machine — the `claude` CLI on PATH is not one, it
  wants `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY`. Queries are unaffected. Set a key and run
  `python -m graphify label . --no-viz` to restore names; note every `label`/`report` run
  re-clusters, so the community count drifts a little each time.

### `/reels` mobile platform-layer audit — SHIPPED, three items PENDING VERIFICATION
Six fixes in `styles/routes/reels.css` (`mobile-native` skill), guarded by
`e2e/tests/mobile/reels-platform-layer.spec.js` (8 green) with `consumer/live-reels` +
`consumer/property/live-reels` (14 green) and the four neighbouring mobile specs (48 green)
unchanged. `overscroll-behavior-y: contain` on `.reel-wrap` — `overscroll-behavior` does not
inherit, so the root's containment never reached the feed's own scroller and a flick past the last
reel rubber-banded the document behind it. `.reels-chip:hover` moved behind
`@media (hover: hover) and (pointer: fine)` with an `:active` scale taking over as the press
response — ungated, the fake hover left a chip lit and an unselected filter reading as selected.
Chips lifted to `min-height: 44px`. **The `@media (max-height: 700px)` rail override was a silent
no-op**: it asked for 42px icons but was declared *before* the base `.rail .ic` rule, and a media
query contributes no specificity, so it lost on source order and had never applied — moved after
the base rule and raised to 44px. `env(safe-area-inset-left/right)` on `.rail`, `.reel-info` and
`.reels-top`, which `viewport-fit=cover` had been putting under the sensor housing in landscape.
`pointer-events: auto` narrowed from `.reels-top > *` to `.reels-filters`, so the topbar's
full-width `space-between` gutter stops swallowing taps meant for the play/pause toggle underneath.
Three same-selector blocks that were each declared twice in the file merged.

- Needs hardware: the landscape inset (emulation reports every `env()` as 0), whether the chip
  `:active` reads as a press rather than a bounce, and whether the now-44px chips crowd the top
  overlay at 360×640.
- **Deferred, not fixed:** the feed mounts up to 24 reels × 5 full-screen background images at
  once, so every frame is decoded whether or not it is ever swiped to. `content-visibility: auto`
  with a matching `contain-intrinsic-size` on `.reel` would defer both layout and the fetch, but it
  creates a containment context on a scroll-snap child and wants a device to confirm the snap
  geometry survives. Not a platform tell — a weight problem — so it is out of this slice.
- **Not from this slice, found during it.** `e2e/COVERAGE.md` cites two specs that are not on disk
  — `consumer/account/live-rent-payment-seam` and `mobile/live-wizard-sticky` — so
  `scripts/check-coverage-citations.mjs` exits 1. And `tasks/todo.md` carries an uncommitted
  −2,520/+491 rewrite that predates this work (`tasks/todo.md.bak` holds the HEAD copy); it drops
  four `PENDING AGENT REVIEW` and three `PARTIAL` markers and must not be committed unreviewed.

### `/list-property` mobile platform-layer audit — SHIPPED, three items PENDING VERIFICATION
Eight fixes (`mobile-native` skill) across five files: the route sheet's five ungated `:hover` rules
moved behind `@media (hover: hover) and (pointer: fine)` with `.upload-zone.drag-over` split out of
the gate (a drag is not a hover); dead `.thumb-card` rules deleted; `FeatureSelector`'s tiles given
`role="button"`/`tabIndex`/`aria-pressed` and Enter-Space activation; `Toggle` given `.tap-extend`
and `[role="switch"]` added to the app-wide `:active` response; `.upload-zone`/`.doc-upload` given
their own `:active` (they are `<label>`, which that global rule deliberately skips); `.lp-meter`'s
literal `top: 84px` replaced with `top-[var(--dz-nav-h)]` in the JSX so `.dz-docks-under-nav` owns
the offset below `lg` unopposed; `.lp-step`'s slide-in gated on `prefers-reduced-motion`; and
`.radio-pill` lifted to `min-height: var(--control-h)` under 640px — it reads neither `--btn-h` nor
`--control-h`, so the phone ramp had been missing it. The Enter/Space handler `Pill`, `Toggle` and
the tiles each carried a copy of moved to `lib/onActivateKey.js` with the auto-repeat guard all
three were missing. Guarded by `consumer/list-property/custom-features` (3 green) plus the
`/list-property` route in `mobile/live-tap-targets` and the furnishing-pill geometry test in
`mobile/wizard-actions`, both already green. Needs hardware: whether the tile lift stops sticking
after a tap, which `top` wins at runtime for `.lp-meter`, and the feel of the new press feedback on
the tiles and file pickers.

- `services/rent-agreement/StepTerms.jsx:65` carries the identical `<div onClick>` `.furn-tile`
  pattern and was left out of scope — it ships in the `/services` chunk, not this page.
  `listings/Card.jsx:54` has its own copy of the activation handler, also unguarded.
- Three failures seen during that audit's verification run, none of them from it. **(a)**
  `mobile/wizard-actions.spec.js:83` expects `.lp-meter__cheer` to read the *warmup tier* line on a
  freshly opened wizard, but `computeProgress` returns `nudge: 'photos'` for any form with fewer
  than `STRONG_PHOTO_COUNT` photos and `ProgressMeter` renders a nudge in preference to the tier
  cheer — so on an empty form the assertion cannot pass. Spec and `progress.js` are both clean
  against HEAD; whichever of the two is wrong belongs to the nudge-priority slice. **(b)**
  `post-property-sync.spec.js:127` gets `403` from `PATCH /properties/{id}` with
  `{"status":"approved"}` — server-side, no frontend involvement. **(c)**
  `mobile/wizard-actions.spec.js:148` times out on `.lp-step-actions` against an a11y snapshot
  showing a **Sign In** link, i.e. the login never took: session flake, mobile-small only.

### `/listings` mobile platform-layer audit — SHIPPED, three items PENDING VERIFICATION
Seven fixes across nine files; five are guarded by `e2e/tests/mobile/listings-platform-layer.spec.js`
(10 green, plus 66 green across the four neighbouring mobile specs). The rest need hardware:

- The three map-sheet fixes — `86dvh`, `.dz-mdp { touch-action: pinch-zoom }` with `pan-y
  pinch-zoom` handed back to `.dz-mdp-scroll`, `data-no-ptr`, and the grabber dismissing on a
  downward drag — are unasserted. Reaching `.dz-mdp` at phone width needs the Maps SDK and live
  pins, and Chromium resolves `dvh` exactly like `vh` and reports every `env(safe-area-inset-*)`
  as 0, so two have no signature under emulation at all. Confirm pinch still magnifies the sheet.
- `interactive-widget=resizes-content` is app-wide, not `/listings`-only. Every fixed bottom
  element now sits *above* the Android keyboard rather than under it: `.dz-bottom-nav` (mounted on
  every consumer route but chat/auth), the cookie banner, `InstallPrompt`, the assistant FAB. On a
  halved viewport a 56px capsule above the keys may be worse than the overlay it replaced — decide
  per element, or hide the tab bar on a `visualViewport` resize. Also confirm one pull-to-refresh
  spinner on a fast flick, not two.
- For the concurrent touch-states slice, not this one: (a) `-webkit-tap-highlight-color: transparent`
  moved to `html`, so being inherited it now suppresses the flash on tappable `<div>`/`<li>` rows
  with no `:active` replacement; (b) `.dz-lightbox img { touch-action: pinch-zoom }` is inert and its
  comment claims the opposite — the gesture walk intersects with ancestors up to the first scroll
  container, and `.dz-lightbox` (`touch-action: none`, no `overflow`) is not one, so the floor plan
  it was added for is still un-zoomable. Relax the overlay, not the child.
- `tests/mobile/live-tap-targets` and `tests/mobile/live-flatmates-filter-sheet` fail on the
  concurrent `FilterGroup` slice's 20px `h4.fg-header` button. Not this diff.
- Adjacent, deliberately left alone (from the review of this slice):
  - `usePullToRefresh` gates only on `(prefers-reduced-motion: reduce)`, so the app's own toggle
    still gets the finger-tracking indicator. Same gap `html.dz-reduce-motion` was added to close.
  - ~15 call sites pass an explicit `behavior: 'smooth'`, which outranks that rule — `LegalPage`,
    `ServiceLanding`, `ArticleToc`, `Contact`, `TenantProfile`, `AssistantWidget`,
    `SocietiesSection`, `Categories`, `HScroll`. Dropping the argument is the fix everywhere:
    the default `auto` already defers to the computed `scroll-behavior`. Only `Reels` honours it.
  - The listings drawer has `aria-label` but no `role="dialog" aria-modal="true"`, so it is modal
    for scroll containment and not for a screen reader. Its `.filter-panel` sibling in
    `flatmates/FilterBar` already carries both — copy that. Pre-existing, not a regression.
  - `.filter-panel` is shared with `/flatmates`, so that drawer gained scroll containment too.
    Desirable, but it is blast radius outside `/listings` and untested there.

### `/flatmates` mobile platform-layer audit — SHIPPED, two items PENDING VERIFICATION
Four fixes in `styles/routes/flatmates.css` plus the `p-6` removal from `flatmates/FilterBar.jsx`,
guarded by `e2e/tests/mobile/flatmates-touch-targets.spec.js` (3 green in both phone projects,
red-checked with the stylesheet stashed). The app-wide baseline needed nothing — viewport meta,
tap-highlight, `user-select`, `:active` feedback, `100dvh` shell and the `--control-h` ramp were
already correct, and Tailwind's `hoverOnlyWhenSupported` already gated every `hover:` utility. The
gaps were all in this route's hand-written CSS.

- **Unasserted: the whole `.dz-sp-*` locality-popup group.** Five hover gates, `overscroll-behavior:
  contain` on the 306px inner list over a 460px map, and the `var(--btn-h)` floor under
  `pointer: coarse` for its 30px save and ~26px CTA. `FlatmateMap.jsx:122` early-returns
  `<MapUnavailable/>` without `GOOGLE_MAPS_API_KEY`, so the popup never renders under e2e. On
  hardware, confirm the taller rows still read as a compact card over a live map — `.dz-sp-list`'s
  `max-height: 306px` was chosen against the old row height, so it now shows fewer rows before
  scrolling. `MAX_ROWS` still caps the list, so this is a look, not a break.
- **Unasserted: the drawer's top and left insets.** Chromium reports every `env(safe-area-inset-*)`
  as 0, so only the bottom is provable (driven through `--dz-safe-b`); the other two are read off
  the CSS declaration via CSSOM, which proves they are *written*, not that they *land*. Confirm on
  a notched device in both orientations and as an installed PWA — the manifest ships
  `orientation: any`, so the notch reaches the drawer sideways.
- `.btn-ghost`'s new height floor is behind `@media (pointer: coarse)` deliberately: `--btn-h` is
  40px on a mouse rather than unset, so an ungated rule would inflate the deliberately compact
  `h-8` reissue pill (`RoomCard.jsx:140`), the `h-9` empty-state button (`Empty.jsx:30`) and the
  `py-2` sort controls (`Results.jsx:59-61`) on desktop. The spec pins the gate, not just the height.
- `live-flatmates-filter-sheet.spec.js:138` (budget floor) fails identically with this diff stashed.
  Pre-existing, not this slice.

### `/flatmates` second pass — SHIPPED, two items PENDING VERIFICATION
The first sweep read `styles/routes/flatmates.css` and `FilterBar.jsx` and concluded the baseline
was clean. `.sf-modal` escaped it: it lives in `index.css` but is used by nothing outside this
route, so neither pass owned it. Chasing that turned up an app-wide defect.

- **Every scroll lock in the app was dead.** `index.css:459` gives html `overflow-x: clip`, and
  body's overflow only propagates to the viewport while the root's own is `visible` — the
  stylesheet already says so at line 469 about `overscroll-behavior`. So the
  `document.body.style.overflow = 'hidden'` that 17 overlays carried set a property nothing reads,
  and the page scrolled behind all of them. All 17 now call `hooks/useScrollLock.js`, which writes
  the root and reference-counts: overlays nest (a `Select` inside a `Modal`, the owner-consent
  sheet over the flat-share form), and without the count the inner one's cleanup releases the
  outer one's lock. Guarded by `e2e/tests/mobile/live-flatmates-modals.spec.js`, red-checked.
- `.sf-modal` gained `overscroll-behavior: contain` and a `var(--dz-safe-b)` bottom inset, and its
  gutter moved from `vh` to `dvh`. The submit row is the last of the scroll, so under
  `viewport-fit=cover` it was landing under the home indicator. Guarded by the same spec.
- `FlatmateMap`, `PropertyMap` and `SocietyMap` moved from `gestureHandling="greedy"` to
  `cooperative`: each is embedded in a scrolling document, so a greedy map swallowed the one-finger
  drag meant for the page and a thumb landing on it could never get past. `LocationPicker` and
  `MapBoundaryEditor` stay greedy — panning is the task there.
- The lock fix had two follow-on defects, both caught in review and both now fixed. Giving the two
  flat-share sheets Escape handlers made one press close the picker *and* the form under it, so
  both now carry `role="dialog"` and ignore the key unless they are the last one in the DOM, and
  `Select`/`MultiSelect` stop the event at the menu. And holding the root still takes the scrollbar
  with it, which reflowed the page behind all ~15 desktop overlays as they opened —
  `html { scrollbar-gutter: stable }` reserves the track. Both guarded by the same spec.
- PENDING VERIFICATION, needs hardware: (1) that `cooperative` reads as help rather than
  obstruction on a real phone — the two-finger hint toast is the tradeoff; (2) the home-indicator
  clearance on Cancel / Post request, since emulation reports every `env(safe-area-inset-*)` as 0
  and the spec can only assert the token the rule consumes; (3) that the lock actually stops a
  thumb on older iOS Safari, where root `overflow: hidden` is not reliably honoured for touch
  scrolling — the durable technique is `position: fixed` on the body with a scroll-offset restore,
  which costs a scroll-position round trip and is not worth paying until a device says it is needed.
- Regression-checked against a stashed baseline rather than by eye. Of 130 failures in the first
  full mobile run, 122 were one dead backend (its launcher ends in a synchronous `cmd /c`, so the
  JVM dies with the terminal — start it through `ShellExecute` instead). Of the 8 real ones, 6
  reproduce with this work stashed and belong elsewhere: the `/listings` and `/flatmates` sweeps
  both trip on the filter drawer's `fg-header` accordion buttons being under 44px, the budget
  filter's floor is not dropping an underpriced post, and `.lp-meter__cheer` copy has drifted from
  what `wizard-actions` expects. The 7th, the home tile's trust row wrapping to two lines, passes
  in isolation both with and without these changes — cross-test contamination in the shared lane.
  The 8th was this pass's own new spec, now fixed.
- `scrollbar-gutter: stable` is a sitewide desktop change, so the desktop lane was run against the
  same stashed baseline: the 57 geometry-asserting `chromium` specs (`desktop-noleak-guardrails`,
  `live-filters`, `live-group-join-and-layout`, `interactions-board`) give 50 passed both
  before and after. Six failures are identical in both runs. The seventh appeared only in the
  changed run and passes in isolation — a `not stable` / `outside of the viewport` click flake in
  `live-group-join-and-layout:147`, the same contamination signature as the home tile. No desktop
  layout assertion moved, which is what the reserved gutter had to be checked against.

### Seven more overlays still take no scroll lock at all — FIXED
All seven now take `useScrollLock`; asserted on the two phone bottom sheets in
`mobile/live-sheet-scroll-lock`. `Compare`'s picker, `DashboardReviewModal`, the society stack and
the `AdminSocieties` dialogs are PENDING VERIFICATION — each needs a fixture out of proportion to a
one-line hook call whose mechanism that spec already proves.

### The `/listings` and `/flatmates` filter accordions are under the thumb floor — FIXED
`.fg-header { min-height: 44px }` behind `pointer: coarse` in `styles/routes/filters.css`.

### `ContactOwnerModal` → `ContactsExhaustedModal` have the same unguarded Escape pair — FIXED
Guarded by `lib/isTopDialog.js`, extracted from the three copies now that it is a fourth site.
`role`/`aria-modal` were already present on both. Covered in `consumer/services/referral-rewards`,
whose `openListing` helper had to disable `inAppMessaging` first: with it on the phone's sticky CTA
queues a chat and navigates to `/messages` (`useProperty.handleContact`), so the contact sheet never
opened and all five of that file's mobile tests were timing out on a button that cannot appear.
Review caught that `[role="dialog"]` was too wide a population — the cookie bar, install prompt and
help assistant are non-modal dialogs `ConsumerLayout` renders after the outlet, which left Escape
dead on all three guarded sheets whenever the bar was up. Narrowed to open `aria-modal` dialogs, and
the flat-share filter drawer gained `inert={!drawer}` to declare itself closed; covered in
`mobile/live-flatmates-modals`.

### The wizard's document slots drifted away from three specs — ONE FIXED, TWO OPEN
`badgeDocsFor` now opens with `Electricity Bill` carrying `originalPdf: true`, so that slot accepts
only the original MSEDCL PDF: any spec addressing `.doc-upload input` by `.first()` with an image is
refused at the picker, stages nothing and never posts. `Ownership Proof` is no longer a wizard slot.

- `property-integration.spec.js:233` (D219) — FIXED: the upload is addressed to
  `[data-err="Property Tax Receipt"]`, the other half of the same badge, which accepts a photo.
- `upload-policy.spec.js:299` — ~~OPEN. Expects a `.dz-field-error` naming a signed PDF; the guidance
  keys (`PDF_GUIDANCE_KEY`, `DOCUMENT_GUIDANCE_KEY`) were removed from `PropertyDocumentUploads.jsx`
  by the uncommitted document-card rework. Belongs to that slice.~~ **Closed 2026-09-22; the recorded
  cause was wrong.** The guidance keys were never removed — they are still exported from
  `lib/uploads/policy.js` and read by `DocumentsTab.jsx` and `DocVault.jsx`. The document-card slice
  had already rewritten the assertion to an oversized PDF on the `Electricity Bill` slot. Whole file
  re-run: 17 passed, exit 0.
- `fees-and-photos.spec.js:180` — ~~OPEN and unrelated: the `/pricing` FAQ hardcodes "Owner Plus is
  ₹2,499 per year and Owner Pro is ₹4,999 per year" while the test seeds ₹999 and asserts the page
  quotes the database. Product copy drift, owned by the pricing slice.~~ **Fixed 2026-09-22; the
  recorded cause was wrong twice over.** The FAQ is not hardcoded — `Plans.jsx` interpolates
  `plansFaq5A` from a resolver — and the test does not seed ₹999, it reads whatever `/pricing`
  returns. The real defect was that the two tables naming a price for the same plan disagreed:
  the `plans` catalogue (the row that is **charged**) said 2499 / 4999 where the `fees` schedule
  (the fallback the page renders until the catalogue lands) said 999 / 2499. Off by exactly one
  row, so the FAQ answered Owner **Pro** with Owner **Plus**'s real price — a wrong number that read
  as plausible copy because it was a real price of a real plan. Confirmed against the user: ₹999 and
  ₹2,499 are the true prices, so the catalogue seed was corrected, not the schedule and not the
  spec. Also removes a live hazard on the degraded path: `ListingPaywall.jsx:85` falls back to
  `fee('ownerPlanYearly')`, so a slow or unreachable catalogue quoted ₹999 for a plan that charged
  ₹2,499. New `PlanPriceMatchesFeeScheduleTest` fails if the two drift apart again.

### `seam-write.spec.js` never sees an uploaded photo — PRE-EXISTING

All six tests fail at `postAFlat` (`seam-write.spec.js:109`) waiting for `[data-err="photos"] img`;
the wizard walk through steps 1-2 succeeds, so this is the uncommitted photo-upload slice
(`PhotoUploader.jsx`, `useListingMedia.js`, `photoProvider.js`, backend `MePhotosController`), not
the coordinate slice. `custom-features.spec.js` — which walks the same two steps and stops before
the uploader — passes.

### Editing a listing with no coordinates crashes step 2 — PRE-EXISTING

`edit-policy.spec.js:140` ("a price edit is re-checked but the banner promises the listing stays
live") dies on the wizard's error boundary: `<gmp-advanced-marker>: Cannot set property "position"
… in property lat:`. `toEditForm` writes `propLat: vm.lat ?? ''`
(`services/providers/http/propertyMapper.js:247`), the API-seeded listing behind
`ownerWithLiveListing` carries no coordinates, and `LocationPicker` is handed `''` unconditionally
(`LocationPricingStep.jsx:66`). Attributed by shelving the three coordinate-persistence files: it
fails either way. The fix belongs with the map component — refuse to place a marker until both
coordinates are finite.

### `edit-prefill.spec.js` seeds a document category the wizard no longer offers — PRE-EXISTING

Six tests fail on `[data-err="Ownership Proof"] .doc-name` not existing. The uncommitted
document-picker slice renamed the rent badge documents to `Electricity Bill` / `Property Tax
Receipt` (`list-property/constants.js:79-81`); `Ownership Proof` is gone from `docsFor`, so the
slot the spec seeds into is never rendered. Same slice and same shape as the `types.spec.js:254`
row below. Nothing in the coordinate-persistence slice touches documents.

### `types.spec.js:254` expects a removed land-document label — PRE-EXISTING

`Land offers the 7/12 Extract as its ownership proof, not Index II` expects `Registered Sale Deed`,
which the rendered optional-documents panel does not contain. This slice did not change the document
picker. Restore the correct UI label or its assertion before counting the whole suite green.

### ~~`upload-policy.spec.js` signed-PDF refusal returns no error~~ — CLOSED 2026-09-22

~~`rejects signed, malformed and still-oversized PDFs with actionable errors` reads `.error` as
`undefined` for the `/Sig`-bearing fixture, so `prepareUpload` resolves where it should refuse.~~
Re-ran the whole file against HEAD: **17 passed, exit 0**, including
`preserves a small signed PDF but rejects malformed and oversized PDFs` at `:226`. Whatever the
failure was, it does not reproduce — consistent with its own attribution note, which recorded that
it was seen on a frontend-only lane (stashing the photo-compression slice reproduced it three times
there) and warned to confirm against a live run first. This was that live run.

### `improvements.spec.js:43` "Re-send" contains "Send" — PRE-EXISTING

`sign-up offers exactly one primary action at a time` asserts
`getByRole('button', {name: /Send OTP/i})).toHaveCount(0)` once the OTP step is up, and resolves to
**1** — the resend control, `auth.resendOtp` = "**Re**send OTP", matched as a substring by the
unanchored regex. "Send OTP" really is gone. The e2e profile sets `send-cooldown-seconds=0`, so the
button never reads "Resend in {{seconds}}s" and the collision is permanent on this lane, not
timing-dependent. Identical failure with the chunk-failure messaging slice stashed. Fix is to anchor
the name (`/^Send OTP$/`) or give the two buttons testids.

### `properties-console.spec.js:1279` Verification Queue only — PRE-EXISTING

`the Verification Queue queue is sized by the server` fails on `searchParams.get('archived')` being
`null`; the other three `QUEUES` rows pass. The wait matches the **first** request whose URL contains
`q.param`, which for this facet does not pin `archived`. Identical failure with the ownership-panel
redesign stashed, and the spec's own comment concedes the wait is delicate. Fix is to narrow the
matcher to the queue's own fetch rather than any URL containing the substring.

### `edit-prefill.spec.js` seeds a document category the wizard deleted — PRE-EXISTING

Six tests fail on `locator('[data-err="Ownership Proof"]') — element(s) not found`. `f1b49abd`
replaced the per-type ownership tiles with `badgeDocsFor(deal)` (Electricity Bill / Property Tax
Receipt / Index II) and did not update the spec, which still seeds and asserts `Ownership Proof`.
Confirmed unrelated to the listing-docs copy slice. Fix is to re-point `expectDocument` and its
seeds at a category `docsFor` still renders.

### `edit-prefill.spec.js:491` posts no commercial keys on a residential listing — NOT MINE

`create through the rental wizard persists exact answers and decimal areas for a fresh edit reload`
fails at `expect(body.formDetails).toEqual(details)` with nineteen keys missing — every commercial
one (`camCharges`, `clearHeight`, `commercialType`, `dockCount`, `escalationPct`, `fitOutMonths`,
`fixtures`, `floorLoad`, `frontage`, `gstOnRent`, `inPlaceRent`, `leaseExpiry`, `pantry`) the spec
expects present-and-empty on a **Flat**. Cause is the commercial slice's uncommitted
`formDetailsForPropertyType` in `list-property/submit.js`, which strips `COMMERCIAL_DETAIL_KEYS`
from a residential post — exactly and only the observed diff. Neither it nor `COMMERCIAL_DETAIL_KEYS`
exists at HEAD, and the land slice's sole line in that file (`landUse:`) sits nineteen lines away.
The spec should stop asserting empty commercial answers on a residential listing; that call belongs
to the commercial slice. The other two `edit-prefill` failures in the same run (`:231` sale reload,
`:307` legacy address) are **flaky, not real** — 15s `locator` timeouts on a wizard that had
rendered; all three re-runs pass in isolation.

### `npm run check:listing` is red on three backend checks — PRE-EXISTING

`ListingService.update` no longer reverts to pending on an off-search foundation change, no longer
queues a re-check unconditionally for stays-live fields, and `updateAsModerator` now does one or
both. The checker refuses to be relaxed (D76/Q14): the owner-facing edit banner and the server
disagree about what a re-review costs. Confirmed unrelated to the listing-docs copy slice, which
touches no backend file.

### `ListingSearchTest.emptyTenantsMatchesNoFilter` — RULED 2026-09-23, inclusive

The tenants facet keeps `anyJsonOrNoPreference`: a listing stating **no** tenant preference is shown
to every tenant type, because an empty preference is an answer ("I'll take anyone"), not silence.
`ListingSearchTest` argued the opposite and was updated to match, as were the two e2e reds below.
`petsAllowed` deliberately stays exclusive and the two facets do **not** disagree: a null `pets` is
an owner who never answered a yes/no, and matching it would advertise a permission nobody gave.
`PropertySpecs.anyJson` was deleted — the ruling settled which method survives.

The gendered-bachelor broadening in the same hunk is unrelated and looks sound.

`listing-attributes.spec.js` `:51` and `:98` were rewritten for the new rule but are **PENDING
VERIFICATION** — not yet run. `:51` no longer pins an exact slug set, since under the inclusive rule
the result grows with every silent rental added to the seed; it asserts the rule instead (a stated
family policy matches, a stated non-family one never does), which still defeats the old hash.

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

### The flatmates twin of the "near a place" radius bug is still live — NOT FIXED, out of scope

The listings fix (see Shipped) held the half-typed radius in component state so the filter can never
store `''`, and gave the 25 km ceiling one home that the number input, the slider and any radius
arriving from a shared URL all read. `frontend/src/pages/consumer/flatmates/NearPlaceField.jsx`
L96-97 still writes `''` through on change and clamps against a hardcoded `25` on blur, and
`useFlatmateDiscovery.jsx` L51 reads `?nearr` with no clamp at all — so one shared `?nearr=9999`
link is clamped on Listings and honoured on Flatmates, and a cleared field there still drops the
centre point while the chip keeps naming the place. Left alone deliberately: the brief was four
named listings-search bugs, and the flatmates radius has no spec covering it, so a blind port would
be an untested change to a second surface. **Port `clampNearRadius` / `nearMaxFor` from
`lib/nearParams.js` and add a spec mirroring `live-near-radius-repair`.**

### `post-property-sync.spec.js:79` approves its own on-behalf listing — NOT MINE

`PATCH /properties/{id}/status` answers 403 "You cannot approve or review your own listing". Cause is
the uncommitted `PropertyLifecycle.requireChecker`, which refuses a checker who is either the owner
**or** `postedByStaff`; the test posts through the desk as `ACTORS.admin` and approves as the same
admin. Not an authorization regression — a PATCH against a nonexistent id still returns 404, so the
refusal is the business rule. Fix is for the moderation slice to decide: approve as a second staff
actor, or exempt on-behalf listings from the `postedByStaff` clause — the desk filing a listing is
not the conflict of interest a staffer approving their own home is. **Do not re-point the spec while
that guard is in flight.**

### Person identity verification — PARTIAL, browser-tested with open defects

The DigiLocker seam, modal entry points and person-badge vocabulary are replaced across frontend
copy, i18n ×3, the service seam, admin/ops fields, e2e + COVERAGE.md and ~35 docs, and
`/verify-identity` / `/ops/kyc-review` are registered in `ROUTE_PATTERNS`. No backend regression
suite, build, lint, code review or deployment has been run against it, and the consumer capture
route and staff queue UI are not written. Read-only planner findings still to validate: production
`_headers` denies camera access, staff decisions require admin-only `users:write`, replacement
submission appears to delete prior images before all replacements succeed, review decisions appear
to lack locking, and approval notices target an unregistered `/profile` route.

- [ ] Preserve additional probes as durable specs; validate camera absence, interrupted/background
  capture, physical Android/iPhone, production headers, and secure phone QR reachability.
  A localhost QR opens the phone's localhost, not this desktop. **Real face/liveness inference is
  still unasserted against a real face** — a spec now proves the landmarker loads and recovers from
  a failed fetch, but nothing drives it with actual facial geometry, so the stage-advance logic
  (`readSelfieGuidance`) is exercised only by synthetic frames. This needs the physical webcam.
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
- [ ] Run backend regressions, synthetic-camera browser tests, real inference smoke checks,
  build/lint/i18n/OpenAPI checks and ordered code/security reviews in isolated lanes. Record actual
  results and update coverage; physical iPhone Safari remains a separate verification gate.
- [ ] Document approved WhatsApp template/configuration, model asset licensing/privacy, camera/CSP
  deployment settings, and any remaining release blockers. Do not commit or deploy.

### Split rooms are never promoted when the parent flat is approved later

`FlatSplitService` stamps `verificationTier` once at creation from the parent's status at that moment
(`identity` while pending, `owner` if already approved), and nothing re-derives it when Ops approves
the flat afterwards — `setVerificationTier` has five writers and every one is a host write. The class
javadoc claims the promotion happens, which is what keeps the gap invisible. **A product gap, not a
test gap:** `owner-split.spec.js` says so in its docblock rather than carrying a skipped test,
because there is no behaviour to assert. Fixing it means an event on listing approval that re-derives
tier for the split children.

## Needs attention

Open items with no ledger row. Anything covered by a decision is cited, not restated.

- **Seeker Plus has exactly the owner-plan price drift that was just fixed, and is still open.**
  Found by a review of the owner-plan fix, 2026-09-22. The catalogue seeds Seeker Plus at **299**
  (`R__DML_seed_reference_data.sql`, the `plans` INSERT); the fee schedule's `seekerPlusTopup` in
  the same file is **199**, matched by `PlatformSettings.DEFAULT_SEEKER_PLUS_TOPUP`. Both surfaces
  that quote it fall back to the schedule before the catalogue resolves — `Plans.jsx`
  `fee('seekerPlusTopup')` and `Checkout.jsx` `fees.seekerPlusTopup` — while the server charges
  `plan.getPrice()`. So a customer can be shown ₹199 and charged ₹299: the identical defect, on the
  same page, one card down. Invisible in mock mode because `frontend/src/data/plans.json` says 199,
  agreeing with the schedule — the same corroboration that decided the owner plans in the schedule's
  favour. **Needs a product ruling on which number is true before it can be fixed**; the seed is a
  one-line change either way. `PlanPriceMatchesFeeScheduleTest` deliberately omits the row until
  then, and says so, rather than pinning a guess. Separately, the two tables also disagree on the
  billing cycle (seed `monthly`, mock `one-time`) — settle both at once.
- **Correcting a plan price silently restates revenue that was already booked.** Also from the
  2026-09-22 review. `subscriptions` stores no amount (`V11__DDL_engagement_billing.sql`), so every
  finance figure joins the *current* `plans.price`: revenue, the 24-month series, MRR, the plan book
  and the transactions-ledger `amount` all come from `AdminMetricsRepository` doing `join plans p on
  p.id = s.plan_id`. The seed is a **repeatable** migration whose upsert ends `price =
  EXCLUDED.price`, so the next deploy rewrites the live row and every Owner Plus subscription ever
  sold at ₹2,499 reports as ₹999 — including on the ledger, the one screen where the number is a
  money question and must match what the gateway captured. Pre-existing schema weakness, but the
  price fix is the first thing to trigger it. The e2e finance spec cannot catch it: it asserts
  agreements between figures, never magnitudes. **Real repair is an `amount` column snapshotted at
  purchase**, which is a migration plus a write plus five query changes — too large to fold into the
  price fix, hence this entry.

- ~~**Two specs are red against HEAD and belong to no current lane.**~~ Both were proven pre-existing the
  only way that settles it — by shelving this lane's edits with `git stash push <paths>` and watching
  each fail identically without them, rather than by reasoning about whether the diff looked related.
  `platform/auth/signin-otp-session.spec.js:171` ("the refresh token is unreadable by scripts, and the
  session renews anyway") gets `"still the tampered token"` where it expects `"renewed"`, so the 401
  recovery never swaps the access token. `consumer/services/rent-agreement-submit.spec.js:105` times
  out waiting for `POST /service-requests` — the submit never fires, which is upstream of the wizard's
  mapper, not in it. A third failure in the same batch (`Sign In does not disclose whether a number is
  registered`) did **not** reproduce alone: contention, not a bug.
  Resolved 2026-09-22, and the two had nothing in common. **The rent-agreement one was a real fixture
  bug**: the spec signs in as a brand-new account and then opened the wizard on the first *seeded*
  listing, which that account does not own. `useRentAgreement` resolves `?listing=` against
  `myListings` alone, so `propertyId` stayed unset, and because the fixture uploads a document the
  submit handler's ownership guard took an early `return` — the click landed, no request left the
  browser, and the failure surfaced as a `waitForResponse` timeout with the button still `[active]`.
  Fixed by minting a listing the caller owns via `POST /me/listings` (the house pattern from
  `ops/verification-thread.spec.js`); 3/3 green. **The OTP one was never a bug at all** — it is an
  artefact of the `E2E_SKIP_RESET=1` workaround the struck item below describes. `OtpSendBudget`
  meters sign-in sends platform-wide over a rolling hour (`MAX_PURPOSE_SENDS_PER_WINDOW = 100`, of
  which `MAX_PURPOSE_RESERVE_SENDS_PER_WINDOW = 50` is held back from accounts the server has not
  seen before — and every spec signs in as a `uniqueMobile()`). `reset-e2e-db.sql` truncates
  `otp_codes` at run start, so a normal run begins with an empty ledger; skipping the reset let the
  rows of every earlier run accumulate until mid-file sends were refused, which reads as "the OTP
  boxes never appeared" and, upstream of that, as a session that never renewed. All three tests in
  that family pass when run alone (`3 passed (35.5s)`). Worth recording that the stash test could
  not have caught this: shelving *this lane's edits* controls for the diff, not for a shared hourly
  ledger the previous run already spent. Confirmed afterwards with a real reset — both files
  together, `23 passed (2.9m)`, exit 0.
- ~~**58 of 325 specs are cited by no `COVERAGE.md` row** (`cited: 267`). The gate is one-directional: it
  fails on a citation naming a spec that does not exist, and says nothing about a spec no row names. So
  a spec can be deleted *or* written without the matrix noticing, and the second is the quiet one —
  the coverage claim silently understates what the suite actually protects.~~ Resolved: the real figure
  was **17**, not 58 — the original count missed that the gate also matches a citation by its bare file
  name and by a `…/*` glob prefix, so most of the "uncited" were cited all along. `check-coverage-citations.mjs`
  now runs the reverse check too, against an explicit `UNDOCUMENTED` allowlist, and is **self-cleaning**:
  an entry that later earns a row turns the gate red until it is removed, so the allowlist cannot decay
  into permanent suppression. All three branches were mutation-proved to exit 1 and reverted. Two of the
  seventeen were then closed outright — a `(-registry)` shorthand expanded into two real citations, and
  five rent-agreement rows repointed to `consumer/services/rent-agreement-submit`, whose assertions they
  had always described while naming its sibling. Now `cited: 269 / on disk: 325 / undocumented (known): 15`.
  One further row was **retired** rather than repointed: "the rent-agreement submit raises no
  browser-only admin ticket" cited a spec that no longer asserts it, and `lib/mockApi` — the module
  the claim was about — no longer exists anywhere under `frontend/src`, so the write it guarded
  against cannot be reintroduced without reintroducing the module (the same reasoning as the
  `loans-team.spec.js` row above it). Two of its supporting details had gone stale and are now
  corrected in place rather than left standing: `toCreate` forwards `ticketId ?? ticketRef` since
  D45 instead of refusing a `TR…` ref by name, and the "eight seeded rental tickets" it narrowed
  against are gone (the seed ships none).
- ~~**The live suite cannot reset its database while `V36__DDL_help_article_feedback.sql` is
  uncommitted.**~~ Resolved: `help_article_feedback` is now waived in `check-seed-coverage.mjs`, naming
  the flow that fills it, which is the right answer rather than a seed row — the table is written only
  by readers casting verdicts, so a fixture row would assert a reader who never existed. A reset-enabled
  live run passes (`47/107 populated, 23 known gaps, 40 waived`); `E2E_SKIP_RESET=1` is no longer needed.

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
- **The anonymous feedback write is rate-limited only by IP, which mobile NAT makes loose.**
  `WriteRateLimitFilter` does apply (120/min, `ip:` bucket for signed-out callers), so this is a
  ceiling rather than an absence — but it is ~172k rows a day from one address, and the thing it
  would spoil is the helpful-rate the table exists to produce. Impact is metric pollution, not
  disclosure: there is no read path. The cheap repair is a per-IP-per-slug-per-day cap in
  `HelpFeedbackService`, keyed against the table the way `TicketService.joinWaitlist` does it so it
  survives a deploy. Deferred because the abuse is hypothetical and the cap has to be chosen against
  real traffic; do it before the admin screen makes the number load-bearing. Adding the route to
  `BotDefenceFilter.CHALLENGED` would also work but breaks the fire-and-forget widget, which sends
  no Turnstile header.
- **Nothing bounds the size of a JSON body on any unauthenticated write** — inherited, not new.
  `BotDefenceFilter` says so itself and caps only the Cashfree callback; Bean Validation's `@Size`
  runs after Jackson has already parsed the document. `/help/feedback` is simply the newest route to
  inherit it. A content-length ceiling across JSON writes, or a Jackson
  `StreamReadConstraints.maxStringLength`, is the platform-wide fix.
- **`AdminTopbarTools.jsx` hardcodes the runbook palette entries** that the staff help chunk now
  owns. The titles and paths are duplicated, so renaming a runbook silently breaks the ⌘K link.
  Deriving them from `virtual:help-content-staff` is the obvious repair and was left alone as
  unrelated to the split that prompted it.
- **Three `consumer/list-property` specs are red against HEAD and belong to no current lane.** All
  three are now resolved — **(a)** and **(c)** were stale assertions, **(b)** was a product call,
  settled below. Seen on
  a 164-test `my-listings` + `list-property` sweep (159 passed) and each reproduced when re-run alone,
  so none is contention. None is caused by the flatmate lane: its only edits to shared wizard modules
  are `next.homeTypeLabel` in `changePropertyType` and a `pinPlaced` check inside
  `validateFlatmateStep2`, neither of which the three specs reach. **(a)** ~~`p3.spec.js:109` waits for
  "All documents are optional for publishing."~~ — commit `46a24a32` (2026-09-19) deliberately rewrote
  that sentence to "These are optional for publishing." and moved the badge caveat into its own
  paragraph, but did not update the spec. Stale assertion, not a regression. **Fixed 2026-09-22**:
  the assertion now matches the optional-ness clause **alone** rather than the whole paragraph,
  because the sentence preceding it is chosen by `form.deal` ("For sale: Index II plus…" vs "For
  rent: a current electricity bill…") — pinning the pair would make this buy-only test fail on rent
  for a reason that has nothing to do with whether a document is required. 1 passed.
  **(b)** ~~`consumer-fixes.spec.js:75` expects `bhk` to clear when the type
  switches Open Plot → Flat, but `bhk` is not in `TYPE_SPECIFIC_KEYS` at HEAD either — the cascade
  reset never covered it, so the spec asserts an intent the code has never held. Decide which is
  right before touching either.~~ **Settled 2026-09-22 in favour of the code; the spec was rewritten.**
  Two facts decided it. First, nothing wrong can publish: `submit.js:109` gates `bhkLabel` on
  `isResidentialType`, and both `bhk` and `bhkNum` derive from it, so a plot cannot carry a bedroom
  count however stale the form is. The `age` precedent beside it in `TYPE_SPECIFIC_KEYS` does *not*
  transfer — its comment reads "a residential answer left behind would publish unseen", which is
  true only because `age: form.age || ''` is forwarded raw. Second, resetting has a real cost:
  `changePropertyType` fires on residential→residential moves too, so `bhk` in the list would
  silently wipe a still-valid answer on Flat → Villa, the common edit. (Gating alone is *not* the
  house rule — `furniture` and `floorsInHouse` are both gated at the wire and reset anyway — which
  is why this was a product call rather than a code reading.) The old test asserted the cascade
  through the one field the cascade excludes, so it covered neither thing: it is now split. The
  cascade test probes `floorsInHouse`, which no other type asks for and which therefore *would*
  publish unseen; a second test pins the `bhk` trade explicitly so it is not re-litigated from the
  code. Both green. **(c)** ~~`pricing-rera.spec.js:62` times out waiting for `.gm-style`
  on the address step of a Farm Land sale, i.e. the Maps overlay never renders; the sibling
  `land-minimum.spec.js` publishes Farm Land green, so it is the map, not the type.~~ **Fixed
  2026-09-22, and it was never the map.** The sibling was the evidence, read the other way round:
  `land-minimum.spec.js` fills three land-only answers (`naStatus`, `otherRights`, and
  `buyerEligibility` on a farm-land *sale*) that this file's `toPricing` helper never did, having
  been written for towered types. Step 1 will not advance without them — and a blocked "Next Step"
  is **silent**, so the failure surfaced one wait later as a map that never rendered, on a step the
  wizard had never left. Repaired by filling the three the same way the floors above them are
  handled: presence-guarded rather than branched on the type, since the helper is passed a type
  rather than told what shape it is. 4 passed. Worth carrying forward: **a `waitForSelector` that
  times out on step N+1 is evidence about step N** when the control between them fails quietly.
- **A half-declared agreement is accepted silently, and the host is told nothing.** `declaresAgreement`
  now requires the flag, the document, the registration number and both dates together. Miss any one
  and the create still returns **201** — it simply files at `identity` tier, which means pending, which
  means off the board — and the response names no field, so the host has no way to learn that the one
  thing they uploaded a document for did not take. The rule is right; only the silence is wrong. A 422
  naming the missing component is the obvious repair, but it is a product call, not a review finding:
  a post without an agreement is a *legal* post, so the question is whether *claiming* one and then
  not evidencing it should block the create or keep degrading quietly as it does now. Costed as small
  — the validation already computes exactly which components are absent. Found because 14 fixtures
  sent the bare flag and their failures surfaced three assertions later as an empty feed.

- **`initialForm.homeTypeLabel` defaults to `'Flat'`, so the null the column documents is unreachable
  through the wizard.** The schema and the mapper both treat a null home type as "the host did not
  say", and the CHECK permits it, but the form preselects Flat, so every wizard post asserts a
  building type even when the host never looked at the control. Left alone deliberately: the Flat pill
  renders visibly selected, so the host is not misled on screen, and `RoomCard.jsx:65` renders nothing
  for either `'Flat'` or null, so the two are indistinguishable to a seeker today. It becomes real the
  moment anything *filters* on home type — "Flat" would then include every host who never answered.
  Decide then whether the wizard should start blank or the null should be retired.

- **`PATCH /flatmates/rooms/{id}` accepts and re-moderates `homeTypeLabel`, and has no caller.** The
  endpoint takes a full `FlatmateRoomCreateRequest` and `FlatmateEditRules` already lists home type
  among the fields whose change sends an approved room back for re-check. The frontend has no room
  edit path at all — `submitFlatmate` short-circuits on `editId` and the dashboard offers only delete
  — so the seam is dormant rather than broken. Noted because the request is *not* sparse: whoever
  wires room editing must carry the field through, since omitting it reads as "cleared" and would
  silently drop a home type the host set at create.

- **The per-caller OTP quota bounds one account; the reserve bounds a crowd of them.** Closed.
  `MAX_CALLER_SENDS_PER_WINDOW = 5` meant twenty throwaway accounts reached exactly
  `MAX_PURPOSE_SENDS_PER_WINDOW`: they could never *exceed* the owner-consent family's hourly share
  but could *exhaust* it, and a first-come share once exhausted refuses everybody — including the
  tenant whose first code of the hour it would have been. Signup costs an attacker one mobile
  number, so the crowd is cheap.
  Neither obvious gate was available. ADR-019 settles that verification is "a badge, not a gate"
  and that it "blocks nothing, anywhere" (`docs/system/platform-architecture.md:1103`), so gating on
  `users.verified` is forbidden outright; an account-age rule would wall off precisely the person
  the flow exists for — a tenant who joined to post their room — and nothing in the backend gates on
  account age today. Both refuse honest callers to inconvenience an attacker who can wait.
  So the share stopped being first-come instead. Past it the flow narrows rather than closes:
  `MAX_PURPOSE_RESERVE_SENDS_PER_WINDOW = 50` stays open to an account that has spent nothing in
  the window and shut to one already spending. A burst of throwaways is spending by definition, so
  it buys nothing past the hundred, while a tenant's first code is never refused on somebody else's
  account. `OtpPurposeReserveTest` asserts both halves, because either alone is satisfied by
  something useless.
  The reserve also made the refusal's `Retry-After` the one place that arithmetic could be wrong:
  every other budget pages exactly to its cap, so the oldest row leaving is always the moment a slot
  reopens, but this one pages to the ceiling and can hold fifty rows more than the share. It now
  counts back from the end to the last row whose expiry still matters, so the header cannot promise
  a moment that would only earn a second refusal.

- `otp_codes.requested_by` is `ON DELETE RESTRICT` as of **V34**, and its index is
  `(requested_by, created_at) INCLUDE (purpose)`. Both correct V33, which is applied and so cannot
  be edited in place. `SET NULL` was the one action able to strand a row: null the requester on a
  third-party code and it matches *neither* erasure predicate — not the subject's mobile, which it
  never carried, and no longer any account. Unreachable while nothing hard-deletes a user (V11), and
  `RESTRICT` makes that an assumption the database enforces rather than one the code relies on.
  V33's index was also unusable by the query it was built for: the budget matches a purpose *family*
  (`purpose = ? OR purpose LIKE ? || ':%'`), which is not an equality, so `created_at` sitting behind
  it could serve neither the range nor the `ORDER BY`.

- `OtpService.sendCode(mobile, purpose)` is now `sendSelfServiceCode`. The two-argument overload
  passes a null requester, so it buys no per-caller quota and takes no caller lock — right for login
  and signup, where the recipient is the caller, and wrong for any flow where a caller names someone
  else's number. Named for what it assumes rather than for what it omits, so picking it is a claim a
  reviewer can check instead of an argument nobody supplied.

- Tenant badge: **done.** V30 keys `flatmate_owner_consents` on `(owner_mobile, granted_by,
  address_fingerprint)`, so an OTP taken for one flat no longer vouches for an unrelated post, and
  `PATCH /admin/rent-agreements/{id}` walks the L&L status ladder — the write
  `FlatmateTrustReconciler#reconcileDraazyAgreements` was sweeping for and nothing could produce.
  Both halves are covered in `AgreementsAndKycTest`, `FlatmateSupplyEndpointsTest` and
  `e2e/tests/consumer/flatmates/tenant-badge-consent-and-registration.spec.js`.
  **Re-verified 2026-09-22**: `-Dtest=Flatmate*Test,AgreementsAndKycTest` 262 green;
  `Spec*Test,ArchitectureBoundaryTest,ErasureCoverageTest,OtpPurposeSendCapTest` 15 green;
  the e2e spec 4/4 green on the live lane; `check-coverage-citations.mjs` exit 0. Uncommitted —
  the slice sits inside a 306-file tree shared with a second session, so it is not separable.

- Wizard draft key bumped to `dzDraft:list-property:v2`, **and the specs that seed it now share one
  constant**. The tenant-badge slice gave `useFormDraft` an `omit` list (consent mobile, agreement
  doc and registration fields), which is a field-shape change, and the hook's contract requires
  renaming the key on one: `omit` is applied on write, so it cannot reach a draft an older build
  already saved, and restore would hand a stale `ownerConsentMobile` back to a form that no longer
  persists it. The rename was right; missing the seven specs still seeding the old literal was not.
  A spec holding a stale key does not fail loudly — it silently seeds nothing and then reports
  whatever the unseeded step does, which is why this surfaced as "legacy drafts restore a view"
  and "the draft survives a reload" rather than as anything about a key. They now import
  `LIST_PROPERTY_DRAFT_KEY` from `e2e/helpers/listingForm.helper.js`, so the next bump is one edit.

- **The flatmates budget sort is ordered on a number the room card never shows.** Standing red:
  `interactions-board.spec.js` "the sort pill reorders the real feed, low to high". The server
  is doing exactly what it says — `FlatmateSearchQueries#perPersonPrice` divides a `price_basis =
  'room'` budget by the headroom the flat has left, so the seeded Balewadi rooms sort 10000/3 =
  ₹3,333 then 14000/3 = ₹4,667 then a per-person ₹7,500, which is ascending. `RoomCard` renders the
  raw `r.budget`, so the same three cards read ₹10,000, ₹14,000, ₹7,500 down the page. Both halves
  are committed (`RoomCard.jsx` @ `ba52efe1`, `perPersonPrice` @ `6df7dde9`) and neither is touched
  by the tenant-badge slice, so this predates it. It is also not obviously a defect: sorting and the
  budget *filter* agree, which is deliberate — the card's own comment says a seeker "must never have
  to work out why an ₹18,000 room appeared under a ₹10,000 budget", and the split price is stated
  underneath for that reason. What no one decided is what the headline number should be **while an
  explicit low-to-high sort is on**. Three ways out, needs a product call, not a patch:
  1. `GroupCard` already renders `inr(perHead(g))`; give `RoomCard` the same treatment via
     `bestPerPersonRent` so the headline is the sort key. Changes what every room card shows.
  2. Order by raw `r.budget` when the sort is budget-low. Cheap, but then sort and filter disagree,
     which is the confusion the filter was built to avoid.
  3. Keep both and have the test assert the *sort key* rather than the rendered text.
  Until that is settled the spec stays red and is not a regression to chase.

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

- Owner consent, review pass — **closed this round**, all pinned by `FlatmateOwnerConsentEndpointsTest`
  and `FlatmateSupplyEndpointsTest` (117 green):
  - `FlatmateGuardrails#fingerprint` now returns null when the locality is blank. Both `addr:`
    branches suffix it unconditionally and every post carries one (`@NotBlank`), so a consent taken
    with a society and no locality stored `addr:sai radha|` — an SMS sent, the owner's time spent,
    and a row that could never match anything. It is refused at the door instead.
  - A consent taken *after* the post exists now reaches it. `POST /flatmates/owner-consent` re-derives
    the flag on the caller's own live posts carrying that fingerprint and syncs their queued review.
    Previously only the group route did, so a host who posted and then rang the owner was stuck
    forever behind an Ops message promising a "Consent verified" that never arrived.
  - `record()` is idempotent under concurrency — a single `insert … on conflict do nothing`, then a
    read that adopts the group id onto a row taken group-less, so the table matches the audit trail.
    A first attempt caught the unique-index violation and re-read instead; **that cannot work on
    PostgreSQL.** The failed flush leaves the transaction aborted (`25P02`), so the recovery read
    fails too, and Hibernate has already called `markRollbackOnly()` — the commit would throw and
    discard the OTP the owner had just typed. Every other catch of `DataIntegrityViolationException`
    in this codebase rethrows; none continues to use the persistence context, which is the house
    precedent. The conflict target must be spelled exactly as V30 declares the index, `coalesce`
    included, or PostgreSQL cannot infer it.
  - `FlatmateReview#badgeable()` is now the single statement of what a tenant claim must carry. The
    moderator gate and the unsupervised sweep consulted separate copies; a third condition added to
    the human-facing one would have been skipped by the path with no human in it. It reads the
    null-guarding `getAgreement()` accessor, not the field: Hibernate hydrates an all-null
    embeddable as a null reference, so every pre-V28 row would have NPE'd — 500ing a moderator and
    killing the reconciler sweep on its first legacy row.
  - Both consent routes carry the `BUYER`/`OWNER` guard their sibling creates carry.
  - The address is now required on the **send** leg too, not just the record. An address the server
    cannot fingerprint is refused either way, so asking first is what stops the owner being texted
    for a consent that was never going to be storable (`sendMustNameTheFlatToo` asserts no
    `otp_codes` row is written). Propagated to `OwnerConsentModal`, to `openConsent`'s pre-flight
    toast, to en/hi/mr, and to the two live specs that posted a bare `{ownerMobile}`.
  - Frontend follow-ups from the same pass: the resend button passed React's click event as
    `ownerMobile` (`onClick={otp.resend}` — `resend` forwards its argument to the dispatch), so
    resend had never worked in this modal; `prefillGroupFromListing` rewrote the address while
    leaving `consentVerified` standing, showing a green chip for a flat the consent does not cover;
    and `locality` was excluded from the group draft while the free-text `title` that usually names
    it was persisted, so a restored draft described two different flats — which is exactly the pair
    the consent row is keyed on.

- `POST /flatmates/owner-consent` sends to an arbitrary third-party number, so rotating the
  recipient defeats every per-mobile budget — each fresh number starts with a fresh one.
  **Closed.** `OtpSendBudget.MAX_PURPOSE_SENDS_PER_WINDOW = 100` caps any one *non-login* purpose
  per hour, so the flow can exhaust itself without draining the shared
  `MAX_PLATFORM_SENDS_PER_WINDOW = 500` pool sign-in draws from (`OtpPurposeSendCapTest`). V33 adds
  `otp_codes.requested_by`, and `MAX_CALLER_SENDS_PER_WINDOW = 5` charges each send to the account
  that asked — the one ceiling a caller cannot rotate out of by naming a different number, so it is
  what stops a single account spending the flow's whole 100/hour (`OtpCallerSendCapTest`). Nullable
  permanently: login and signup are asked for by somebody with no session, and both are exempt from
  the quota anyway. The column is swept on erasure, because a consent code the subject requested is
  addressed to a stranger's number and so is unreachable from their own. The caller lock is *tried*,
  not waited for (`RateLimitLock#tryHoldUntilCommit`): unlike the per-mobile key it is the one two
  sends by one account reach at once, and the send holds its transaction across the SMS gateway, so
  waiting would park each racer on a pooled connection for a round-trip apiece — five in prod
  (`RateLimitRaceTest`). Every counter on the path is keyed on the family, including the
  **per-recipient** one, which review caught still counting the whole scoped purpose: that is the
  limit whose stated job is that "a victim's phone cannot be used as a doorbell", and while it
  counted the scope, re-typing the same number against a different flat re-armed both it and the
  60-second cooldown. `enforce` now derives the family once and passes it down, so a fourth counter
  cannot be added that quietly misses it.

- Auto-approval is gated on **locality agreement only**. `FlatmateTrustReconciler#propertyBehind`
  now refuses to skip the desk when the claimed `tenancyPropertyId` sits in a different locality
  from the post, because the id is a tenant's unverifiable claim. **Closed for rooms.** A room and
  a listing both carry `society_id`, so when the two agree the match is the building rather than
  the postcode; when either is missing it falls back to locality, because a host who skipped the
  society picker is not making a false claim and failing closed would retire a working sweep.
  **Still open for groups**, which carry a title and a locality and no society field at all, so
  every group post falls back — closing that is a data change (a society on the group), not a
  predicate.

**Two gates are red before this branch touches them.** Both confirmed pre-existing by re-running
against `HEAD`; neither is caused by the `live-` rename or the comment sweep.

- ~~`e2e/scripts/check-coverage-citations.mjs` reports 2 CITED BUT MISSING rows. `COVERAGE.md` cites
  `consumer/account/live-rent-payment-seam` and `mobile/live-wizard-sticky` (L424, L518), whose
  specs were deleted in `f1d549af` and `23aa4651`. The rows overstate coverage: either restore the
  specs or drop the rows — a product call, so left alone.~~ Resolved: both rows were since rewritten
  as **retirement notes** naming the spec in prose instead of citing it, which is the honest form —
  the claim is recorded as having had a subject that is gone, rather than as coverage that exists.
  The gate now reports `every cited spec path exists, and every spec is cited` (exit 0).
- ~~`frontend/scripts/check-listing-foundation.mjs` fails 6 of 78 with `missing: landUse`, identically
  at HEAD. Its `if \(in\.(\w+)\(\)[^{]*\{([^{}]*)\}` cannot parse a block holding a nested `if`, and
  `ListingEditRules.java` `clearLandUse` is exactly that shape. Fix the parser; do not relax it, or
  it stops seeing genuinely missing keys.~~ **Fixed 2026-09-22, and the parser was never the fault.**
  The scan does find `landUse` — via the flat `else if (in.landUse() …)` arm beside the nested one —
  so it was in the *server* set all along and missing from the two that mirror it. The drift was
  real and user-facing: the server takes a listing off search when `landUse` changes, but `landUse`
  is nobody's form field. It is derived by `landUseFor(propertyType, plotZone)`, and while
  `propertyType` was already a warned foundation key, **`plotZone` was in neither tier list**, so
  `classifyChanges` could not report a zone edit at all. An owner re-zoning a plot lost their search
  placement with no warning of any kind. Repaired by adding `plotZone` to `TIER_A_FIELDS` and
  `landUse: ['plotZone']` to `FOUNDATION_OFF_SEARCH_KEYS`, and by naming `landUse` in
  `ListingFoundationTest#OFF_SEARCH` (it carries no `@RequestParam`, so that test's facet loop can
  never derive it — it has to be stated).
  The other 3 failures were the checker itself having gone stale against `23aa4651`, which guarded
  both reverts by status. Each assertion was rewritten to test the invariant rather than the old
  code's shape, and each is now *stronger* than what it replaced: the re-moderation branch must name
  `APPROVED` specifically (the only status where "off search" means anything); `requestRecheck` must
  survive having every nested block stripped out, which is what "unconditional" actually means, where
  the old "before the first `if`" was only a proxy for it; and `updateAsModerator` may now re-pend —
  it does, to reset a lifecycle verification — but only behind a `PENDING` guard, and must still
  never file a re-check. **86 checks pass.** Worth keeping: the old check-1 comment promised that a
  brace-nesting block would "fail rather than drop a field", which was false — it drops it silently,
  and only a flat sibling naming the same field saved this one. That comment now says so.
  **Coverage note.** The checker's own step 5 asserts `classifyChanges` routes a `plotZone` edit to
  re-moderation and to neither `staysLive` nor `instant`, so the classification is pinned at build
  time. The last inch — that the owner actually *sees* the off-search warning when they change the
  zone on a live listing — is now covered too: `edit-policy.spec.js` grew
  `P1 — re-zoning a plot is warned about, even though nobody types the field it changes`, which
  asserts the copy is absent on load and present only after R1 → C-1, so it cannot pass on a prefill
  that already differs. 6 passed, and there is a `COVERAGE.md` row.

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
ISO-8859-1); `byte[]` would remove the question. The `*.run.app` URL stays directly invocable, so
the callback route is reachable without the Pages Function (`DEPLOY.md` §6). And
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
- `MobileCollapse`'s `headerClassName` prop is accepted and never read. Delete it with its call sites.

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

**The server cannot tell a hand-granted Verified badge from a review-granted one, so it cannot
refuse the withdrawal.** `users` carries one `verified` boolean and no record of who set it, so the
console's withdraw guard (`u.verified && u.identityVerified`) read a field the wire has never sent
and never fired. Guard removed rather than left as decoration and `admin/users.spec.js` parks the
claim with `test.fixme`. Real fix is server-side: record the grant's origin (a `verified_source`
column, or derive it from a decided `identity_verifications` row), answer 409, then unpark the spec.

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
- **`societies:write` is bypassable on the residents decision path.** `PATCH
  /societies/{slug}/residents/{id}` guards on role (`isStaff`) rather than the permission atom,
  because the other legitimate reviewer is a committee member with no staff permissions — so an
  account granted `societies:read` and deliberately not `societies:write` can still decide
  residencies. A policy call: add a second atom, or accept role-gating and say so in
  `cross-cutting.md`.
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

**Content and admin surfaces**

- The three editorial content endpoints shipped empty for three different reasons: `banners` cannot
  round-trip through the admin console, `announcements` and `services` have no admin write routes at
  all, and production answers `[]` for FAQs. Each needs its own decision.
- `FaqRepository.findByArchivedFalse()` takes no `Sort`, so the published FAQ list is heap order —
  it reads as arbitrary to every visitor and changes under them for no reason they can see.
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

**Decided elsewhere** — geo policy → ledger 35 · locality queue → 24 · own-listing dedup → 23 ·
saved-search count → 33 · society follows → 34 · internal notes → 29 · referral reward → 31b ·
society binding → 19 · pipeline stages → 27 · managed properties → 32 · `services` CMS type → 26 ·
admin enquiries → 25 · finance console → 20 · analytics tiles → 36 · "Posted by PuneNest" badge →
still undecided · `wa-pricing` → resolved.

### Deliberate deviations, open to being overruled

- **Approval no longer demands current ownership evidence.** The gate asks for a document of the
  right kind rather than a re-upload on every re-review; an approved listing whose evidence predates
  the latest edit still passes.
- **`images` has no minimum on create or update.** A listing may be published with none; the wizard
  asks for photos, the contract does not.
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

The ledger's damage order. Items 35, 24, 23, 33, 34, 29, 31b, 19, 27, 26, 32 and 25 are built; the
queue is now **20 (finance console) then 36 (analytics tabs)**.

---

## Shipped

Newest first. One line per slice; the commit is the record.

| Date | What shipped |
|---|---|
| 2026-09-22 | `open-questions.md` stopped lying about five of its own entries. The file's lifecycle rule says a question moves to CLOSED when it is answered, but nothing enforces it, so a question stays OPEN forever unless someone remembers — and **an answered question sitting under "blocking specific work" reads as a blocker, which is worse than no ledger**: it invites the work to be re-argued from scratch. Q2 (`hide_number` shipped in V31, then overtaken by `ContactGateService`'s global mask-everyone policy, so the preference is a deliberate no-op) and Q13 (per-account, narrowing-only, over `GET /admin/permission-catalogue`, shipped as D192) were closed outright; both name tech-debt rows that no longer exist in the register, which was the tell. Q14 already said CLOSED but sat in the open section and pointed its SLA residual at **D76, also deleted** — so that residual was tracked nowhere and now says so. Q19 was narrowed: `TenancyRevocationIsForwardOnlyTest` pins retraction as ruled out (option 2 shipped), leaving only the badge-drop and card copy. Q20 was the interesting one — decision 42 decided it on 2026-08-23, but `pendingApprovals()` still maps `this::masked` with no `createdBy`, so it is **decided, not built**, and D206 is correctly still open. Every verdict was checked against the shipped code, not against the prose that claimed it |
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
| 2026-08-23 | `consumer/account/notifications.spec.js` → `live-notifications.spec.js` (7 ✅), asserting the inbox at the wire through a second API client. It found `toUiType` carrying no entry for `match.saved-search`, the only spelling `SavedSearchService.alert()` emits. Commit `20ff3dd` |
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
