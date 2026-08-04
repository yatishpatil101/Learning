# Mobile-First Review & Improvement Plan

> **Scope:** the PuneNest React consumer app, admin console and ops console, reviewed at real phone
> viewports on the assumption that **~80% of traffic is mobile**.
> **Method:** every finding below was measured, not guessed — an instrumented Chromium run walked 34
> consumer routes and 8 back-office routes at **390×844** (modern Android/iPhone) and **360×640**
> (the median low-end Android in India), recording horizontal overflow, painted tap-target sizes,
> computed font sizes, the fixed/sticky chrome inventory with pixel bands, console errors and paint
> timings, plus a production `vite build`. Screenshots and the raw JSON were reviewed per route.
> **Status:** proposed. Owner: frontend. Companion docs:
> [`docs/system/design-system.md`](../system/design-system.md) (the mobile system this builds on) and
> [`docs/roadmap/mobile-app-plan.md`](./mobile-app-plan.md) (PWA → Capacitor packaging).

---

## 0. Verdict in one page

**The mobile *foundation* is genuinely strong and above the standard of most Indian property sites.**
The audit found **zero horizontal page scroll on any route at either width, zero console errors, zero
desktop-tables-leaking-onto-phones, and zero layout crashes.** `viewport-fit=cover`, `dvh`
everywhere, a `--pn-bottom-inset` token, bottom sheets below 640px, a 16px `pointer: coarse` input
floor, landscape height budgeting, reduced-motion handling and a 20-spec `mobile-*` Playwright suite
already exist. That is a real mobile system, not a responsive afterthought.

**The problem is no longer the layout system — it is three things the layout system cannot see:**

| # | Theme | One-line statement | Severity |
|---|---|---|---|
| **A** | **First-load weight** | 1.89 MB / **450 KB gzip** entry chunk + 209 KB CSS + render-blocking web fonts land *before* first paint. On a median Indian 4G phone this is the single biggest cause of bounce, and no amount of layout polish compensates for it. | **P0** |
| **B** | **Chrome congestion on the 640px screen** | Up to **five** simultaneous floating layers (top bar, coach-mark, assistant FAB, sticky CTA, bottom nav, toast) collide with each other and with page content. On `/list-property` at 360×640 **not one form field is visible**; on `/property/:id` **the price is not on the first screen**. | **P0** |
| **C** | **Native-app affordances absent** | No offline state, no pull-to-refresh, no haptics, almost no skeletons, no `Notification`/push readiness, no back-gesture polish. These are what make a web app *feel* like an app rather than a website in a WebView — and they are what NoBroker's app has. | **P1** |

Everything else in this document is smaller, cheap, and mostly mechanical.

---

## 1. What was measured (so findings are auditable)

Harness: headless Chromium, `isMobile: true`, `hasTouch: true`, DPR 2, signed-in owner session for
consumer routes and a full-admin session for back-office routes, cookie consent pre-accepted.

| Signal | How | Result |
|---|---|---|
| Horizontal page scroll | `scrollWidth − clientWidth` per route | **0 px on 42/42 routes, both widths** ✅ |
| Elements straddling the viewport edge | bounding boxes vs `innerWidth`, ignoring clipped ancestors and off-canvas drawers | 2 routes (`/societies`, `/admin`) |
| Painted tap targets < 40 px | all interactive roles, excluding `.tap-extend` (whose transparent 44px `::before` is the intended mechanism) and `.sr-only` | ~15 distinct real offenders |
| Text < 12 px | computed `font-size` on elements with own text nodes | present on **every** route |
| Fixed/sticky chrome | position, z-index, top/bottom band | up to 6 layers per route |
| Console errors | `console`/`pageerror` | **0** ✅ |
| Production payload | `npm run build` | see §2 |

Screenshots and `report.json` are written to `e2e/test-results/mobile-audit/`. The harness itself
(`e2e/tmp-mobile-audit.mjs`) is temporary; §9 proposes folding the useful assertions into the
permanent `mobile-*` suite instead of keeping the script.

---

## 2. Theme A — first-load weight (P0)

### 2.1 What the production build actually ships

```
dist/assets/index-CsIndGHG.js      1,893.06 kB │ gzip: 449.82 kB   ← entry, blocks first paint
dist/assets/index-D0_2YxRZ.css       208.80 kB
dist/assets/vendor-react-*.js        234.74 kB │ gzip:  75.25 kB   ← modulepreloaded
+ render-blocking <link> to Google Fonts (Outfit 7 weights + Noto Sans Devanagari 4 weights)
```

**≈525 KB gzip of JS + CSS must arrive and execute before anything renders**, plus a third-party
font round-trip on the critical path. Vite already warns about the 500 KB chunk.

### 2.2 Why the entry chunk is 1.9 MB

The chunking config is careful about *vendors* (`jspdf`, `pdfjs`, `charts`, `html2canvas` are all
correctly split, and there is a good comment explaining a past `manualChunks` bug). But **application
data was never considered**, and it dominates:

| Eagerly bundled into the entry chunk | Size (raw) | Why it is there |
|---|---:|---|
| [`src/data/db.json`](../../frontend/src/lib/mockApi/core.js) | **236 KB** | `import seedDb from '../../data/db.json'` — a static import in `mockApi/core.js` |
| `src/data/societies-rera.js` | **182 KB** | imported by `src/data/societies.js` |
| `src/i18n/locales/en/*` (eager by design) | **247 KB** | `import.meta.glob(..., { eager: true })` |
| `src/data/properties.json`, `services.json`, … | ~150 KB | static imports in the mock layer |

`src/data/` totals **648 KB** and `src/i18n/` **1.16 MB** on disk. Non-English locales are already
correctly lazy — that part is well done. English is not, and neither is any of the data.

> **Nuance that matters for prioritisation:** `db.json` and most of `src/data/` disappear when the
> real backend lands (`VITE_API_MODE=http`). `societies-rera.js`, the English locale, and the 209 KB
> CSS **do not**. So fix the durable ones first and treat the mock data as a build-time concern.

### 2.3 Recommendations

| ID | Recommendation | Effort | Payoff |
|---|---|---|---|
| **A1** | **Make the mock seed a dynamic import.** Change `import seedDb from '../../data/db.json'` to `await import(...)` inside the seed path, which only runs on first visit. Alternatively gate the whole mock provider behind `import.meta.env.VITE_API_MODE === 'mock'` so a production http build tree-shakes it out entirely. **Re-rated after tracing the import graph: `rawLoad()` is synchronous and called from dozens of sites, so a dynamic import means making the whole mock layer async. Not an S. The right move is the `VITE_API_MODE` gate — or simply waiting, since this code is deleted when the backend lands.** | ~~S~~ **L (or free, later)** | **−236 KB** raw off the entry chunk |
| **A2** | **Lazy-load `societies-rera.js`.** It is a static registry consumed by society/locality surfaces, not by the home route. Move it behind the route chunks that need it. **Re-rated: the premise was wrong — `data/societies.js` is imported by `home/SocietiesSection.jsx`, and Home is a synchronous route, so the registry *is* on the critical path. Deferring it means changing what the Home rail renders from, which is a data-shape change, not a config tweak.** | ~~S~~ **M** | **−182 KB** raw |
| **A3** | **Split the English locale by namespace, not all-at-once.** Keep only the namespaces the shell needs (`nav`, `chrome`, `home`) eager; make `property`, `list-property`, `flatmates`, `society`, `services`, admin namespaces lazy — exactly the mechanism already built for `hi`/`mr`. The lazy backend in `i18n/index.js` already supports this; it just is not applied to `en`. | M | **−150 KB+** raw, and it reuses existing machinery |
| **A4** | **Self-host the two fonts and subset them.** **DONE.** `scripts/fetch-fonts.mjs` downloads the woff2 files Google would have served and generates `src/styles/fonts.css`; a script rather than pasted URLs because the filenames are content-hashed and rotate. The `<link>` to fonts.googleapis.com is gone, so the render-blocking third-party round trip (DNS + TLS + CSS, *before* the font itself) is gone with it. Google's own unicode-range split is preserved verbatim — an English visitor still downloads 31.5 KB of latin Outfit per weight and none of the 627 KB of Devanagari. Only the 600 weight is preloaded (40 declarations, present in first paint); preloading all five would put ~157 KB on the critical path. Two follow-ons the change forced: the service worker's `**/*.woff2` precache glob was removed (it would have installed all 857 KB up front — the exact bug documented above it for vendor-charts) in favour of a runtime CacheFirst rule, and the now-dead `fonts.googleapis.com`/`fonts.gstatic.com` allowances were dropped from **both** CSPs (the `<meta>` one and the real Netlify header). **The weight audit still stands:** 300 and 900 are unused; 500 (16 uses) and 700 (39 uses) are not. | M | ~200–400 ms off FCP on 4G; removes a third-party SPOF |
| **A5** | **Split the 209 KB CSS.** `index.css` is a single monolith. The route-scoped stylesheet pattern already exists (`styles/routes/*.css`) and is documented — extend it to admin/ops (which no consumer visitor ever needs) and to the heavier consumer surfaces. **DONE — with one part of the recommendation retired.** "Extend it to admin/ops" had nothing to extract: `index.css` contains **no admin/ops section at all** (0 selectors matching `.pn-admin`/`.admin-`/`.ops-`) — the back-office is styled entirely by Tailwind utilities. What *was* extractable is the **List Property wizard**: 1,216 lines an owner-only route needs and a home-hunter never does. Checked for cascade safety before moving (69 selectors, **0** re-declared later in `index.css`), so arriving later in the cascade cannot change which rule wins. Measured: main CSS **38.6 → 35.7 KB gzip**, with 3.8 KB now loading only with the `/list-property` chunk; critical-path total 551.5 → **548.7 KB**. Verified the 5 wizard-spec failures are **pre-existing** — identical test IDs with and without the split. | M | ~10–20 KB off first paint |
| **A6** | **PARTLY DONE — the gate exists, the CI half is blocked.** `frontend/scripts/check-bundle-size.mjs` + `npm run check:size` measure the real critical path (parses `dist/index.html` for the entry script, modulepreloads and stylesheet rather than globbing filenames — a first attempt using `index-*.js` caught an unrelated chunk) and fail over budget. Currently 548.7 KB against a 560 KB budget. **⚠️ It cannot run "in CI" because the repo has no `.github/workflows` at all** — wiring it up means creating CI from scratch, which is a larger decision than this row implies. **Add a real budget gate to CI.** Set `build.chunkSizeWarningLimit` low and fail the build if the entry chunk exceeds an agreed gzip budget (suggest **180 KB gzip** for entry + vendor-react). Without a gate this regresses within a quarter. | S | Prevents recurrence |
| **A7** | **Add `<link rel="preload">` for the LCP image on `/` and `/property/:id`.** **MEASURED — do not do this; the recommendation was wrong on both routes.** LCP was recorded with a `PerformanceObserver` on a Pixel 7. On **`/property/:id` and `/listings` the LCP element is text, not an image**, so an image preload cannot move LCP there at all. On **`/`** it *is* an image — and it already carries `loading="eager"` + `fetchPriority="high"` (`Featured.jsx`, `priority={i === 0}`). The delay is **discovery, not priority**: the first image request does not fire until **1440 ms**, because the URL lives in data the browser cannot see until React has booted. A `<link rel=preload>` needs a build-time-known URL; this one is data-driven and city-dependent, so hardcoding it would silently rot the moment the seed data or the city changes — an unused preload is wasted bandwidth on exactly the 4G phones this is meant to help. The safe half of A7 (`preconnect` + `dns-prefetch` to images.unsplash.com) is already in place. **Real fix is A1/A2 (bundle + data-layer weight), not a preload tag.** ⚠️ First probe wrongly showed text LCP on every route because it did not seed cookie consent — the banner itself was the LCP element. Re-measured with consent seeded. | S | ~~Meaningful LCP win~~ **None available at this layer** |

**Target:** entry + vendor-react under **180 KB gzip**, FCP under **1.8 s** and LCP under **2.5 s** on
a throttled "Slow 4G" profile with 4× CPU slowdown. A1–A3 alone remove roughly 570 KB raw.

> **Also worth measuring:** the audit could not record a `largest-contentful-paint` entry on any
> route (`lcp=0` everywhere). That means no LCP candidate is being reported — worth confirming with
> real Lighthouse/CrUX, because if LCP is genuinely unmeasurable, Core Web Vitals reporting for SEO
> is blind. Treat this as a **diagnostic to run**, not a proven defect.

---

## 3. Theme B — chrome congestion on a 640px screen (P0)

### 3.1 The measured chrome inventory

At **360×640** the harness recorded these simultaneous fixed/sticky layers with their pixel bands:

```
/property/:id      top bar  z=50   [  0.. 59]
                   tab rail z=30   sticky
                   Nestor   z=1300 [370..480]   ← coach-mark
                   assistant FAB   (below it)
                   sticky CTA z=60 [505..572]   "Contact Owner · Visit"
                   bottom nav z=70 [572..628]
/list-property     top bar  z=50   [  0.. 59]
                   progress z=30   [284..363]  sticky
                   Nestor   z=1300 [438..548]   ← overlaps the form heading
                   step CTA z=60   [510..575]  sticky "Next Step"
                   bottom nav z=70 [572..628]
                   toast    z=2000 [590..624]   ← "Draft saved", sits ON the bottom nav
```

On a 640px-tall viewport, **~180 px (28%) is permanently claimed by chrome** before content, and the
coach-mark adds another 110 px on top of content.

### 3.2 The three concrete failures (verified in screenshots)

**B1 — The Nestor coach-mark covers primary content. (P0)**
`AssistantWidget` shows a "New here? Ask Nestor…" bubble anchored at
`bottom: calc(var(--pn-bottom-inset) + 5.75rem)` on detail routes. At 360×640 that lands it at
`[438..548]`:
- on `/property/:id` it **covers the gallery and sits directly over the price/EMI band**;
- on `/list-property` it **covers the "Property details" heading and the first field**;
- it appears on **every** consumer route (all 24 audited), on **every fresh page load**, because
  the auto-hide after 6 s is deliberately not persisted (only an explicit close is).

An unsolicited overlay on top of the price, on the page where the user decides whether to contact an
owner, is the highest-cost interruption in the app.
*Recommendation:* on `< lg`, (a) do not show the nudge on `/property/:id`, `/list-property`,
`/checkout` or any conversion surface at all; (b) persist the auto-hide to `localStorage` so it is
shown at most once or twice ever, not once per page load; (c) if kept elsewhere, render it as a
compact non-overlapping pill beside the FAB rather than a 110 px card over content.

**B2 — `/list-property` shows no form field above the fold. (P0)**
At 360×640 the wizard's first screen is: 190 px of marketing hero ("List with PuneNest" badge +
"List your property" + a two-line subtitle), then the progress meter, then the step tabs, then the
coach-mark, then the sticky "Next Step" — and the first input is below all of it. This is the
**supply-first funnel**, the most commercially important flow in the product.
*Recommendation:* collapse the hero to a single line below `sm` (the badge and subtitle are
motivation for a visitor who has *already clicked Post* — they have converted). Move the progress
meter into the sticky sub-header rather than the flow. Target: **first input visible without
scrolling at 360×640.**

**B3 — Toasts render on top of the bottom nav. (P1)**
The "Draft saved" toast sits at `z=2000`, band `[590..624]`, directly over the bottom nav at
`[572..628]`. The z-index ladder documented in the design system tops out at 1500 (blocking modals);
`2000` is undocumented and above everything. Toasts should dock **above** `--pn-bottom-inset`, not
over it, and should sit below modals in the ladder.

### 3.3 Structural recommendations

| ID | Recommendation | Effort |
|---|---|---|
| **B4** | **DONE — now machine-enforced (see F5).** The rule is no longer a convention someone has to remember: `mobile-safe-area.spec.js` walks every visible `position:fixed` layer on the five money routes and fails if any two share pixels. Adjacency stays legal (a sticky CTA sitting directly above the tab bar is intended); only overlap fails, since that is what makes a layer unreachable. **Adopt a "one floating layer at a time" rule** and enforce it. Where a route has a sticky CTA (`/property`, `/society`, `/list-property`), the assistant FAB should hide below `lg`, not stack above it. The user already has the action they need. | S |
| **B5** | **DONE.** Ladder in `design-system.md` and `index.css` now both end `… blocking modals 1500 · toasts 1600`, with the autosave flash (90) added — it was missing from the CSS copy. The toast had already moved to 1600; the audit found a *second* ad-hoc `z=2000`, the `/services/interior` lightbox, which outranked the toast layer and is now on the 1500 modal rung. A sweep of every rung in use also surfaced a higher band the ladder never described (`.pn-action-sheet`/`.pn-dropdown__menu--sheet` at 9999, `.pn-cal` at 2000, skip link 9999, maintenance overlay 99999); that band is now documented, including the known inconsistency that an action sheet outranks toasts. | S |
| **B6** | **DONE — shipped as `mobile-content-budget.spec.js` (see F4).** **Add a "content budget" assertion to the mobile suite:** at 360×640, on the five money routes (`/`, `/listings`, `/property/:id`, `/list-property`, `/flatmates`), assert that a named primary element (price, first input, first result card) is inside the initial viewport. This turns "does it feel cramped" into a test. | M |
| **B7** | **BLOCKED — the premise is wrong, needs a product call.** The density is real and measured: at 360px signed-in the bar carries 7 targets totalling 265px of painted control in a 360px row, gaps down to 8px, and the account pill runs to x=360 exactly. But the stated escape hatch does not exist. The bottom nav is Reels / Search / Post / Flatmates / Services — it has never held Saved, Notifications or Messages — and `acctItems()` in `Navbar.jsx` carries a comment recording that those three were *deliberately removed* from the account drawer when they went inline, to avoid duplicate destinations and a double `a[href="/messages"]` match. So the top bar is currently the **only** route to all three: dropping them as suggested would strand them, not relocate them. Any fix has to add the destination back somewhere first. Options are in the note directly below this table. | M |

### Note on B7 — what a real fix would have to do

The measurement (360×640, signed in, `/listings`):

| x | w | h | target |
| --- | --- | --- | --- |
| 16 | 44 | 44 | PuneNest / home |
| 68 | 32 | 32 | Go back |
| 123 | 32 | 32 | Compare properties |
| 167 | 32 | 32 | Saved properties |
| 211 | 32 | 32 | Notifications |
| 255 | 32 | 32 | Messages |
| 299 | 61 | 40 | Account menu |

265px of painted control in a 360px row, minimum gap 8px, right edge at exactly 360. The crowding
the item describes is real and reproducible.

What is *not* true is that the three badge icons have a second home. They do not: the bottom nav has
five fixed slots (Reels, Search, Post, Flatmates, Services) and the account drawer had these three
removed on purpose. Removing them from the bar would make Saved, Notifications and Messages
unreachable for a phone user — a functional regression dressed as a density win.

So this needs a product decision, not a CSS change. The three plausible routes:

1. **Move them into the account drawer and leave one badge in the bar.** Keeps a single unread
   indicator visible, costs one extra tap to reach any of the three. This is the state the code was
   in before, and the comment in `acctItems()` explains why it was changed — reverting it should be
   a decision, not an accident.
2. **Collapse the three into one "Activity" destination** with tabs for saved / alerts / messages,
   and put a single badge in the bar. Frees two slots and gives one aggregate unread count, but adds
   a new route and a new information architecture question.
3. **Accept the density.** All seven targets already clear 44px of *hit area* via `.tap-extend`, so
   this is not an accessibility defect — it is a visual-crowding judgement. Doing nothing is a
   legitimate answer.

Deciding between these is a call about what a returning user checks most, which the audit cannot
settle from geometry alone.

---

## 4. Touch targets and legibility (P1)

The app has a well-designed dual mechanism (`.tap-target` grows the box, `.tap-extend` keeps the
drawn size and extends the hit area with a transparent `::before`) and a sweep spec that respects it.
The audit excluded `.tap-extend` correctly, so everything below is a **genuine** sub-40 px painted
control with no hit-area extension.

### 4.1 Real offenders, by impact

| Route | Control | Painted | Note |
|---|---|---:|---|
| `/listings` | budget & area **range slider thumbs** and their `₹0` / `₹5 Cr+` value buttons | 15×16, 8×16, 270×**28** | Filtering is *the* core mobile task. A 16 px-tall drag handle on a touch screen is a precision task. `.rng` already grows the thumb to 28 px on touch — the *value buttons* and the input rail did not get the same treatment. |
| `/plans` | plan carousel dots | 24×**8**, 8×**8** | 8 px. Effectively untappable; the carousel is the only way to see Plus/Pro on a phone. |
| `/plans` | FAQ `<summary>` rows | 316×**20** | Full-width but 20 px tall. |
| `/property/:id` | gallery thumbnail strip "Go to photo N" | **22**×44 | 22 px wide, adjacent — high mis-tap rate on the primary media control. |
| `/property/:id` | "Back to results" | 138×**38** | Just under floor. |
| `/emi-calculator` | numeric inputs + sliders | 112×**20**, 316×**6** | A **6 px** slider rail. |
| `/flatmates` | "Smart search", "Close filters" | 32×32 | |
| `/flatmates`, `/locality` | BHK / segment pills | 51×**32** | Design system says filter pills are `--control-h` = 44 px below 640px; these bypass it with `py-2`. |
| `/societies` | "Follow" / "View hub" | 182×**36**, 126×36 | |
| `/help` | article links in rails | 186×**15**, 123×15 | |
| **Admin/ops (all routes)** | topbar icon buttons, row actions | 28×28, 36×36, 36×28 | The admin console has had **no** touch pass at all (see §6). |

### 4.2 Text below 12 px — found on **every single route**

The most common offenders are `text-[11px]` and `text-[10px]` metadata: `₹9,786/sq.ft`,
`Verified listings`, `Total interest`, timestamps (`10 min ago`), badges (`FEATURED`, `VERIFIED` at
**9 px**), the rent-agreement stepper labels (10 px), and the bottom-nav tab labels (11 px).

Two important qualifications, so this is not read as a blanket "make everything bigger":
- **The bottom-nav labels at 11 px are a defensible, deliberate trade-off** — five tabs in 360 px.
  Leave them.
- **9–10 px badges (`VERIFIED`, `FEATURED`, `SALE`, `MOST BOOKED`) are not defensible.** These are
  *trust signals* in a market where trust is the entire value proposition, rendered at a size that
  is hard to read for anyone over 40 — a large share of Indian property buyers.

| ID | Recommendation | Effort |
|---|---|---|
| **C1** | **Set a hard floor of 12 px for any text below `sm`, and 13 px for trust/verification badges.** Add it to the design system's control table and enforce with a lint rule or a Playwright sweep (the harness already computes this). **🟡 Partially shipped, and one claim in this row was wrong.** The 9px `VERIFIED` badge is `.badge-seeker` on **/flatmates**, raised to 11px and regression-tested. The `.badge-verified` / `.badge-rera` badges that also carry `text-[9px]` in source turned out to render **zero times on a phone** — they belong to the desktop-only list-row card variant, so they were never a mobile defect. A blanket 12px floor is still open, but it is a large diff across ~40 files and should be done with the sweep in F3, not by hand. | M | 🟡 |
| **C2** | **Fix the range-slider ergonomics on `/listings` and `/emi-calculator`** — thumb ≥ 28 px, rail ≥ 24 px hit area (paint it thin, extend the hit area), value buttons `.tap-extend`. Highest-traffic control in the app. **✅ Shipped.** Correction: the `/listings` `.rng` thumbs *already* grew to 28px on touch — that was correct and documented, and only the value labels were under the floor. `/emi-calculator` had neither. | S | ✅ |
| **C3** | **Replace the `/plans` dot carousel with a swipeable card rail + labelled segment control.** 8 px dots cannot be fixed by growing them; the pattern is wrong for touch. **✅ Shipped, smaller than proposed:** the rail is already swipeable, so the dots became 24x44 targets around 8px drawn indicators rather than being replaced. 44x44 was rejected — three of them would overlap or stop reading as one control. | M | ✅ |
| **C4** | **Apply `.tap-extend` to the property gallery thumb strip**, or replace it with a swipe-only gallery + `1/6` counter (already present) and drop the thumbs below `sm`. **DONE — and this row misread the DOM.** The thumb strip is already `hidden sm:block`; the recommended fix had shipped before the audit ran. What the 22px measurement actually hit was the **mobile dot rail**, which is 2px under the 24px WCAG 2.5.8 floor *its own comment claims* (`px-2` = 8px a side around a `w-1.5` 6px dot = 22). Fixed with `min-w-[24px]`, not more padding — the active dot is `w-5`, so padding cannot pin both states. Measured 22 → 24; regression test added and confirmed red without the fix. | S |
| **C5** | **DONE — audited, no offenders left.** Measured painted heights of every pill-shaped `button`/`[role=tab]`/`label` at 360×640 across `/`, `/listings`, `/flatmates`, `/societies`, `/plans`, `/compare`, `/locality` and `/locality/:slug`. `--control-h` resolves to 44px at that width and **zero** controls land under 40px except two that are `.tap-extend` by design (the 32px top-bar Back tile and the 20px assistant Dismiss), both of which carry a transparent 44px hit area. The 30–32px pills the audit saw were fixed by the earlier control-token work. The sweep did catch one genuine regression on the way: the **Save-property heart on the `/` Featured cards** was painting at 36×36 with no hit extension, failing `tap-targets.spec.js` on both mobile projects. It now carries `.tap-extend`, which keeps the 36px tile the card art is designed around and puts a transparent 44px `::before` under the finger. Sweep went 2 flaky → 24/24. | S |

---

## 5. Route-by-route notes (consumer)

Only where there is something specific to say beyond §2–§4.

| Route | Mobile assessment | Suggested change |
|---|---|---|
| `/` Home | **Good.** The mobile-specific decisions are genuinely thoughtful: the hero search panel is desktop-only (`hidden lg:block`) because it cost 286 px of the first screen, and CSS `order` puts real inventory before category tiles. | **But there is now no search input anywhere on the mobile home fold** — the user must know to use the bottom-nav Search tab. Consider a single compact tap-to-search *pill* (not the full panel) in the hero that routes to `/listings` with focus. Cheap, restores the expected entry point, costs ~50 px not 286 px. |
| `/listings` | No overflow; sticky sort rail + filter FAB are well done. `docH=4420`. | Slider ergonomics (C2). Consider making the sort rail and the filter FAB one control at 360 px. |
| `/listings?view=map` | Renders correctly, no overflow. | Map + list on a phone needs a bottom-sheet result peek; verify the map fills `dvh` minus chrome. |
| `/property/:id` | **DONE � the price is now laid over the hero photo** (measured y=551 -> 360 at 360x640), so it clears the fold without shrinking the gallery. Rendered in one slot or the other, never both, so `data-testid="property-price"` stays a single match and a screen reader reads the figure once. Desktop is untouched. **B1 blocked the price.** Sticky "Contact Owner · Visit" CTA is exactly right. `docH=5447` — long. | B1, C4. Consider collapsing the 5-stat band (Price/sq.ft, EMI, Views, Shortlisted, Quality) into a 2-row grid; all five labels are 11 px. |
| `/list-property` | **B2 — no field above the fold.** Sticky step actions are good. | B2. This is the highest-value single fix in the document. |
| `/flatmates` | Dual list/map, save/report at 34×44. **DESKTOP FOLD BUG, now fixed:** the advanced-filter grid (`hidden lg:grid`, 308px + `mt-4`) sat permanently open, putting the first result card at **y=881 on a 1440×820 laptop** — a search page showing no stock without scrolling. Mobile was never affected (drawer; measured y=669 of 915). Shipped with the flatmates redesign (`5c075a9`), caught by `flatmates-prefreeze.spec.js:87`. The grid is now collapsible and starts collapsed — the same idea as the mobile drawer, with the room a wide viewport allows — while search, tabs, list/map, sort and reset stay on screen. **Measured 881 → 521.** Opens automatically when any filter is already set, so a deep link like `?loc=Baner` never hides the reason a list is narrowed. Rejected trimming the hero: it carries the badge, H1, trust pills and two CTAs, ~60px was the most it could give, and 19px of margin would let a longer Hindi/Marathi string silently reintroduce the bug. | C5; grow save/report to 44 px wide. |
| `/reels` | **Best mobile surface in the app.** Full-bleed, keeps the tab bar, native share wired up, 844 px doc height (exactly one screen). | Nothing. Use this as the reference for "native feel". |
| `/services`, service landings | Clean, no overflow, good imagery (1.26 MB of images on `/services` though). | Compress/resize service hero images; they are the heaviest image payload measured. |
| `/emi-calculator`, `/home-loans` | Sticky result summary docked under the nav is a nice touch. | C2 — the 6 px slider rail. |
| `/societies` | ~~A "Verified" filter button escapes the viewport~~ **✅ Fixed.** Measured at x=364..481 on a 412px screen — 69px off the edge, clipped by an ancestor so there was no page scroll to reach it and no visual cue that anything was wrong. Root cause was the same one as D3: two `flex-1` selects with the default `min-width: auto` refused to shrink. `min-w-0` + `flex-wrap`. | ✅ |
| `/society/:slug` | Sticky Follow/Review CTA + tab rail; good. | Breadcrumb links 55×20 and 50×20. |
| `/messages` | Correctly full-screen, no bottom nav, composer pinned. `docH=844`. | Tabs at 172×**32**. |
| `/saved`, `/compare`, `/notifications` | Clean. | — |
| `/dashboard` | `docH=3111`, hub navigation works. | "View all" links at 48×20. |
| `/plans`, `/checkout` | Carousel problem (C3). | C3 |
| `/help` | Good structure. | Article links 15 px tall. |
| `/signin`, `/signup` | Sticky submit above the keyboard is correctly implemented. | Consent checkboxes at **16×16** and **14×20** — legally-significant controls below the touch floor. Fix. |

---

## 6. Admin & ops consoles on a phone (P1 — but read the framing)

**Framing first:** the 80/20 mobile split is a *consumer* number. Admin and ops are staff tools, and
the mobile-app plan explicitly says "Admin/ops stays web forever". So the goal is **not** to make the
admin console a great phone experience. The goal is that **field ops staff can complete their few
genuinely mobile tasks** — approving a listing, updating a service request, checking an enquiry —
without pinching.

**What the audit found:**
- ✅ No horizontal page scroll, no wide `<table>` overflow on any admin route (the dual-render
  mobile-card pattern is working).
- ✅ Content is readable; `AdminDashboard` alerts stack cleanly at 360 px.
- ⚠️ **Two dashboard cards straddle the viewport edge** on `/admin` (`[16..404]` at 390 px wide, and
  `[37..383]` at 360 px) — clipped, so no page scroll, but content is cut off.
- ⚠️ **The admin topbar has had no touch pass**: icon buttons at 28×28 and 36×36, row `View`
  actions at 51×**28**, tab buttons at 98×**36** — none carry `.tap-extend`.
- ⚠️ `/ops/requests` renders **1,859 DOM nodes** and `/admin/properties` **1,571 nodes / 8,478 px**
  of document — heavy for a low-end field phone.
- ⚠️ The admin shell has **no bottom nav and no safe-area handling**; only a sticky header.

| ID | Recommendation | Effort |
|---|---|---|
| **D1** | **DONE.** `design-system.md` now opens the mobile-first section with *Which routes are mobile-supported*: all consumer routes, plus field ops (`/ops` and all eight queues under it, enumerated from the router, plus `/admin/properties`). The other fifteen `/admin/*` routes are named explicitly as desk-only, with the standard they still must meet (usable and unclipped) separated from the one they need not (mobile polish), and a rule that a route moves onto the supported list *before* it gets fixed. | S |
| **D2** | **Apply `.tap-extend` across the admin topbar and row actions** on the field-ops routes. Mechanical, reuses the existing class. **✅ Shipped** for the shell's three icon buttons, which also gained real `aria-label`s (they were named by `title` only — invisible on touch). | S | ✅ |
| **D3** | **Fix the two clipped `/admin` dashboard cards.** **✅ Shipped** — one `min-w-0`; the cards' own truncation was already correct but could never fire against a grid item's default `min-width: auto`. | S | ✅ |
| **D4** | **Paginate or virtualise `/ops/requests`.** 1,859 nodes on a field phone is a scroll-jank generator. **DONE — and it was a one-prop oversight, not missing machinery.** `Table` already implements the pager; `OpsQueue` was the only table in the app that never passed `pageSize`, while `AdminSupport` renders the *same* `listTickets` data with `pageSize={10}`. Measured **1,857 → 693 DOM nodes**, 34 → 10 rows, and the pager states the window honestly ("Showing 1–10 of 34 tickets") so a short page is never mistaken for a short backlog. | M |
| **D5** | **Add safe-area bottom padding to the admin shell** so the last row of a queue is not under the home indicator. **DONE** — `<main>` had bare `p-4 sm:p-6`; now routed through `--pn-safe-b` (verified declared on `:root`, so the admin tree inherits it). `env()` is 0px off-device, so it is inert except in an installed app on a notched phone. | S |

---

## 7. Theme C — making it feel like an app, not a website (P1)

This is the gap between "responsive site" and "mobile-native". The PWA groundwork is already strong —
manifest, service worker with a deliberate `NetworkOnly` policy for `/api/*` (excellent and correctly
reasoned), an engagement-gated install prompt with escalating silence, precache scoped to the initial
load graph. What is missing is the **runtime feel**.

| ID | Gap | Evidence | Recommendation | Effort |
|---|---|---|---|---|
| **E1** | **No offline/failure state.** | No `navigator.onLine` usage anywhere in `src/`. | The SW serves a cached shell offline, then every data call fails silently. Add a global connectivity banner and per-surface "you're offline — showing saved results" empty states. On Indian mobile networks this is a weekly experience, not an edge case. | M |
| **E2** | **Almost no skeletons.** | `skeleton` class used on only **2** surfaces (`Featured`, listings results). Every other route shows a full-screen spinner from the lazy-route fallback. | **PARTLY DONE — and the audit missed the more serious half.** `/property/:id` now renders `PropertySkeleton` instead of a centred spinner, built from the real components' measurements rather than guessed: hero `aspect-[4/3]` full-bleed / `sm:h-[320px]`, then price → title → locality in the page's own reading order. Verified it reserves **412×309 at y=122**, byte-identical to the real hero box, so nothing jumps when data lands — a skeleton whose box differs from the real one is *worse* than a spinner, because it promises a layout and then breaks it. **The bug found along the way:** the shimmer is an `infinite` animation and was never gated by reduced motion — the reduced-motion section is an explicit allowlist ~3,500 lines from the animation, and `.skeleton` was never added to it. Both opt-outs (the OS media query and the app's own Settings ▸ Appearance toggle) now stop the sweep; the surface stays visible so it still reads as "content pending". Confirmed red without the fix. Adding more skeletons before fixing this would have multiplied an a11y defect. `/dashboard`, `/flatmates`, `/society` still on the spinner. | M |
| **E3** | **No pull-to-refresh.** | Not present. | Add to `/listings`, `/saved`, `/notifications`, `/messages`, `/ops/requests`. Strongest single "this is an app" signal, and users will try it. | M |
| **E4** | **No haptics.** | No `navigator.vibrate`. | 10 ms tick on: save/unsave, filter apply, wizard step advance, contact reveal. Cheap; disproportionate perceived quality. Gate on `prefers-reduced-motion` and a user setting. **✅ Shipped** as `lib/haptics.js`, wired to save-a-listing and wizard-step-advance. Two corrections: no new user setting was added (the OS media query and the existing `reduceMotion` toggle are the setting — a third switch would be one more thing to find and could disagree with them); and **iOS gets nothing**, because no WebKit browser implements `navigator.vibrate`. India is ~95% Android so this still reaches nearly everyone, but iOS haptics need the Capacitor plugin, not a web fix. | S | ✅ |
| **E5** | **Native share is partial.** **DONE.** Extracted `lib/share.js` first — three copies already existed (Refer, Reels, the property compare bar) and they *disagreed*: only two treated a cancelled share sheet as a non-event, so the third reported "Couldn't copy link" for the commonest outcome of tapping Share on a phone. Share now exists on society pages and flatmate rooms too. One constraint worth recording: `/flatmates` is a single route with no per-room URL, so rather than invent a deep-link contract the room link narrows to the tab + locality the page already honours (`?view=` / `?loc=`) and names the room in the share text. | Wired on `/reels`, `/refer` and the property compare bar — good — but not on society pages, flatmate posts, or search results. | Extend `navigator.share` to every shareable entity. Sharing a listing on WhatsApp *is* the Indian distribution channel. **⚠️ Partially done — and the audit buried the lede:** extending share was the small half. The property page's existing implementation had a **real bug** — dismissing the OS share sheet rejects with `AbortError`, which fell into the clipboard `catch` and raised a "Couldn't copy link" error. So the most common outcome of tapping Share on a phone (open, reconsider, swipe away) reported a failure. **Fixed and regression-tested.** Extending to society/flatmate surfaces is still open. | S | 🟡 |
| **E6** | **Push not started.** | No `Notification` / `PushManager` usage. | Depends on the backend (Phase 0 in the mobile-app plan). But "new listing matching your search" push is the retention mechanic NoBroker uses. Sequence it right after the first backend slice. | L |
| **E7** | ~~**No scroll restoration on back within lists.**~~ **MEASURED — NOT A DEFECT.** | `ScrollToTop` correctly exempts `POP`. | **Verified, not assumed:** scrolled `/listings` to y=1400, opened a property, pressed Back — restored to exactly 1400 (max scroll 3739, so the position was genuine, not a clamp). The existing `navType !== 'POP'` guard in `App.jsx` does its job. **No work needed.** This row is kept rather than deleted because "we checked and it's fine" is worth more to the next reader than silence. | — | ✅ |
| **E8** | **`theme-color` is static.** | One `#0f0d1a` meta. | Fine today (single dark theme). Revisit if a light theme lands. |

---

## 8. Quick wins (ship first)

Ordered by payoff ÷ effort. Everything here is small and independently shippable.

1. **B1** — suppress the Nestor coach-mark on conversion routes below `lg` and persist its dismissal. *(Unblocks the property price and the wizard's first field.)*
2. **A1 + A2** — dynamic-import `db.json` and `societies-rera.js`. *(−418 KB raw off first paint, config-level change.)*
3. **B2** — collapse the `/list-property` hero below `sm` so the first input is above the fold.
4. **C2** — range-slider touch ergonomics on `/listings`.
5. **Sign-in/sign-up consent checkboxes to 44 px** — legally-significant, currently 16×16.
6. **B3** — move the toast below the bottom nav and into the documented z-ladder.
7. **D2 + D3** — admin topbar `.tap-extend` + the two clipped dashboard cards.
8. **A7** — preload the LCP image on `/` and `/property/:id`.
9. **C4** — property gallery dot rail (the thumb strip was already mobile-hidden; see the C4 row).
10. **E4** — haptics on the five key interactions.

---

## 9. How to keep this from regressing

The `mobile-*` Playwright suite (20 specs, three viewport projects including a 360×640 `mobile-small`
project) is already the right structure — the gaps are in *what* it asserts, not in whether it exists.

| ID | Addition | Rationale |
|---|---|---|
| **F1** | **Bundle-size budget in CI** (A6). | The only defect class in this document that silently returns. |
| **F2** | **Extend `mobile-tap-targets.spec.js` to `/plans`, `/emi-calculator`, `/societies`, `/help`, and the field-ops admin routes.** **DONE (consumer routes).** Added those four plus `/flatmates`, `/property/:id` and `/compare` — the surfaces this session changed, since a gallery dot rail and two new share buttons are new tap targets and a sweep that does not walk them is not protecting them. **All 24 runs green**, and the coverage was verified rather than assumed: each new route lands on itself and measures real controls (23–98 each, **374 additional interactive elements**), so the pass is not the vacuous kind a broken probe produces. Confirms the C2/C3/C4 fixes hold. Admin routes still open — they need an authenticated fixture the mobile projects do not currently carry. The current sweep misses every route where offenders were found. |
| **F3** | **New `mobile-text-legibility.spec.js`** — assert no rendered text below 12 px (with an explicit, commented allow-list for the bottom-nav labels). | Turns C1 into a gate. |
| **F4** | **DONE.** **New `mobile-content-budget.spec.js`** (B6) — assert the primary element of each money route is within the initial 360×640 viewport. | Catches chrome creep, which is how B1/B2 happened. |
| **F5** | **Extend `mobile-safe-area.spec.js` to assert no two fixed layers overlap** below `lg`. **DONE.** Walks every visible `position:fixed` layer on the five money routes and fails if any two share pixels. Encodes the defect class that produced the autosave toast painting over the tab bar and the coach-mark sitting on the listing price — both invisible in review, both obvious on a phone. Adjacency is allowed (a sticky CTA sits directly above the tab bar by design); only shared pixels fail, since that makes one layer unreachable. Overlays are skipped structurally (`[role=dialog]`, `[aria-modal]`, open sheets) rather than allow-listed by name. Two guards against a false green: an assertion that each route *has* fixed chrome to measure, and a proof run injecting a toast over the bottom nav — clean state reported `[]`, injected state correctly reported `pn-bottom-nav / pn-injected-toast`. | Directly encodes the "one floating layer at a time" rule. |
| **F6** | **Add a Lighthouse mobile run to CI** with thresholds on FCP/LCP/TBT. | §2 is invisible to the current suite. |

---

## 10. Suggested sequencing

| Phase | Contents | Why this order |
|---|---|---|
| **1 — Unblock content** (days) | B1, B2, B3, quick wins 5–7 | Zero-dependency, fixes the two places where chrome hides the money content. |
| **2 — Weight** (1–2 weeks) | A1, A2, A3, A4, A6, A7 | Biggest measurable user-facing win; A6 locks it in. Do before any new feature work. |
| **3 — Touch & legibility** (1–2 weeks) | C1–C5, D1–D5, F2, F3 | Mechanical, parallelisable, low risk. |
| **4 — App feel** (2–4 weeks) | E1, E2, E3, E4, E5, E7, F4, F5 | Needs design input; best done as one coherent pass so the app feels consistently native. |
| **5 — Post-backend** | E6 (push), A5, then the Capacitor packaging in [`mobile-app-plan.md`](./mobile-app-plan.md) | Gated on Phase 0 of the mobile app plan. |

Phases 1–3 are almost entirely CSS/config and carry little regression risk given the existing e2e
coverage. Phase 4 is where a designer should be involved.

---

## Appendix — evidence locations

- Screenshots: `e2e/test-results/mobile-audit/{p390,p360}/*.png` (per-route, plus `-full.png`
  full-page captures for home / listings / property / list-property / dashboard / admin-properties).
- Raw measurements: `e2e/test-results/mobile-audit/report.json`.
- Production build output: `frontend/dist/` (`npm run build`).
- These are throwaway artifacts of this review, not committed fixtures; the durable version of these
  checks is §9.
