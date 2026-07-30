# PuneNest — Mobile-First Design Review

**Scope:** consumer React app (`frontend/`), reviewed as a mobile web experience.
**Reviewer lens:** senior mobile-first product designer + frontend architect.
**Target user:** Pune buyer / renter / owner, mid-range Android, one-handed, patchy 4G.
**Status:** review only — no code was changed.

---

## A. Executive summary

1. **The app is responsive, but not thumb-first.** Layout stacking is genuinely good (nearly every grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N`). The gap is *reach*, not *width*: navigation, search, account and most primary actions live in the top 64px of the viewport, which is the hardest area to reach one-handed.
2. **There is no persistent bottom navigation anywhere in the app.** All wayfinding runs through a fixed top bar (`Navbar.jsx:209`, `h-16 md:h-[72px]`) plus a right-anchored 300px hamburger drawer (`Navbar.jsx:363`). A user browsing flats one-handed must stretch to the top-right corner for *every* navigation act. WhatsApp/Telegram/Instagram — and NoBroker/Housing on mobile web — all solved this with a bottom tab bar.
3. **The bottom of the mobile viewport is already crowded, and uncoordinated.** Four independent things compete for it: the Nestor FAB (`AssistantWidget.jsx:219`, `z-[1300]`, `bottom-6` / `bottom-[5.75rem]`), the cookie bar (`CookieConsent.jsx:64`, `z-[1400]`, `bottom-0`), the CityChrome waitlist bar (`CityChrome.jsx:43`, `z-[1200]`, `bottom-[18px]`) and the property sticky CTA (`.pn-sticky-cta`, `index.css:3092`, `z-60`). The collision logic is hand-tuned per page (`AssistantWidget.jsx:194-201`). Adding a bottom nav without first making this a *system* will make it worse.
4. **Safe-area support is effectively dead code.** Three places correctly use `env(safe-area-inset-bottom)` (`index.css:3100`, `index.css:8153`, `Checkout.jsx:124`) — but `index.html:5` is `<meta name="viewport" content="width=device-width, initial-scale=1.0">` with **no `viewport-fit=cover`**. Without it the inset always resolves to `0`, so on notched/gesture-bar devices those bars sit under the home indicator. One-attribute fix, P0.
5. **It is not installable and does not feel app-like.** `frontend/public/` contains only `sitemap.xml`, `_redirects` and floorplan SVGs — no web app manifest, no icons, no service worker, no `theme-color`. For a "PWA-grade feel" goal this is the single biggest structural gap.
6. **Every modal is a centred desktop dialog.** `Modal.jsx:55` uses `flex items-center justify-center p-4` with `max-w-lg`. On a 640px-tall phone a centred dialog puts its action buttons mid-screen and its close button top-right — both poor for thumbs. The app already has a **better** pattern it isn't reusing: `dashboard/MobileNav.jsx:86-96` is a proper bottom sheet with a grab handle, `items-end`, `rounded-t-2xl`, `max-h-[85vh]` and focus trapping.
7. **Tap targets are systematically ~32–40px, not 44–48px.** `Button.jsx` defines `sm` as 32px and `md` as 40px, so the *default* button fails the touch minimum. Concrete offenders: navbar icon buttons `p-2` (`Navbar.jsx:290,298,303,308`), card heart/compare `w-9 h-9` (`listings/Card.jsx:103,107,162,166`), deal toggle `h-9` (`DealToggle.jsx:28`), photo delete `w-6 h-6` (`PhotoUploader.jsx:61`), deposit quick-picks `text-[11px] px-2.5 py-1` (`LocationPricingStep.jsx:241`).
8. **Primary CTAs are inconsistent about stickiness.** Property detail gets it right — `.pn-sticky-cta lg:hidden` with `min-h-[44px]` buttons (`Property.jsx:86-101`) — and Checkout gets it right (`Checkout.jsx:124`). But the list-property wizard does not: Back/Next sit at the end of a very long form (`PhotosDocumentsStep.jsx:142-144`, `WholePlaceFields.jsx:25`), so a phone user must scroll the whole step to continue. Listings has no sticky "Show N results" outside the filter drawer.
9. **Hover carries meaning in ~120 places across consumer pages.** Most are cosmetic (`hover:text-teal-300`), which is harmless, but some are affordance-bearing: the add-area "+" in `HeroSearch.jsx:352`, remove-chip states in `MapGate.jsx:53`, and `title=` tooltips used as the only explanation on `listings/Card.jsx:107,166`. On touch these either never fire or fire *after* the tap has already happened.
10. **Mobile is barely tested.** `e2e/playwright.config.js:46-52` defines a `mobile` project (Pixel 7 = 412×915) that only matches `mobile-*.spec.js` — and only **three** such specs exist out of ~150. Nothing is tested at 360×640, the most common low-end Android width in India.

**What is already good and must be preserved:** the `pointer: coarse` 16px input rule that kills iOS/Android focus-zoom (`index.css:8338-8344`); the <640px heading downscale (`index.css:8289`); gallery swipe with a 40px threshold (`property/Gallery.jsx:10-18`); OTP autofill wiring (`OtpBoxes.jsx:60-62`); `MobileField.jsx:51-54` (`type=tel` + `inputMode=numeric` + `autoComplete=tel-national`); numeric `inputMode` across the wizard pricing fields; `Table.jsx:58,82` mobile-card fallback; the dashboard bottom sheet; route-level `lazy()` splitting in `App.jsx:19+`.

---

## B. Screen-by-screen findings

Severity: **P0** = breaks or badly degrades one-handed mobile use · **P1** = reads as a shrunk desktop app · **P2** = polish.

### Global chrome

| Screen | File(s) | Issue | Why it hurts mobile users | Sev | Recommendation |
|---|---|---|---|---|---|
| All | `frontend/index.html:5` | Viewport lacks `viewport-fit=cover`; no `theme-color`; no manifest link | All `env(safe-area-inset-*)` resolve to 0, so the three bars that *do* handle insets still sit under the gesture bar. Android chrome stays generic grey. | P0 | Add `viewport-fit=cover`, `theme-color=#0f0d1a`, and a manifest link |
| All | `frontend/public/` | No `manifest.webmanifest`, no icons, no service worker | Cannot "Add to Home Screen" as an app; no offline shell; every visit is a cold 4G load | P0 | Add manifest + maskable icons + minimal SW (app-shell + image cache) |
| All | `components/layout/Navbar.jsx:209,213,66,363` | Only navigation surface is a fixed top bar + right hamburger drawer (`w-[300px] max-w-[85vw]`), 6 items: Buy, Rent, Share Flat, Reels, Services, Refer | Every navigation act requires a top-right stretch. Two taps (open drawer → pick) for what should be one thumb tap. | P0 | Add a persistent bottom tab bar `<lg`; demote the top bar to identity + contextual actions (spec in §C) |
| All | `Navbar.jsx:290,298,303,308` | Icon buttons at `p-2` (~32px); compare badge `min-w-5 h-5` | Mis-taps on Saved/Notifications/Compare, the exact actions we want repeated | P1 | 44px minimum via a shared `.tap-target` rule |
| All | `Navbar.jsx:108-127,298-308` | Saved / Notifications / Messages are `hidden sm:inline-flex` — on phones they're buried in the account drawer | The three highest-frequency return-visit actions are the hardest to reach | P1 | Saved + Account become bottom-bar tabs; notifications becomes a badge on Account |
| All | `AssistantWidget.jsx:194-219`, `CookieConsent.jsx:64`, `CityChrome.jsx:43`, `index.css:3092` | Four bottom-anchored widgets with hand-negotiated offsets and z-indexes (`z-40`/`z-60`/`z-1200`/`z-1300`/`z-1400`) | Fragile; already produces per-page special-casing. A bottom nav added naively becomes a fifth combatant. | P0 | Introduce a single `--pn-bottom-inset` CSS variable owned by the layout; all bottom widgets stack from it |
| All | `components/ui/Modal.jsx:55,71` | Centre-anchored (`items-center`), `max-w-lg`, `max-h-[calc(100dvh-12rem)]` | Actions land mid-screen; close is top-right; feels like a desktop dialog | P1 | Add a `sheet` variant (bottom-anchored) and default to it `<640px` |
| All | `components/ui/Button.jsx:16-20` | `sm`=32px, `md`=40px — the default button is under 44px | Systemic, because almost every screen uses it | P0 | Raise `md` to 44px and `lg` to 48px `<640px`; keep desktop sizes at `sm:` |
| All | `tailwind.config.js` | No tokens for tap targets, safe-area, sheet radii, or a mobile spacing scale | Nothing enforces the mobile rules; every fix is bespoke | P1 | Add the tokens in §D so rules are reusable |
| All | `styles/index.css` (172KB, single file) | Whole stylesheet is render-blocking on every route despite route-level JS splitting | Hurts first paint on 4G exactly where JS splitting was supposed to help | P2 | Split page-specific blocks; audit dead rules |

### 1. Home / landing

| Screen | File(s) | Issue | Why it hurts mobile users | Sev | Recommendation |
|---|---|---|---|---|---|
| Home | `pages/consumer/Home.jsx`, `home/HeroSearch.jsx` | The hero search — the single most important control — sits directly under the 64px navbar, i.e. in the hardest-to-reach top zone | On a 6.1" phone the search field is ~120px from the top; the thumb naturally rests ~500px down | P0 | Keep the hero search for scanning, but add a **Search** tab in the bottom bar that focuses/opens the same search sheet |
| Home | `home/HeroSearch.jsx:289` | Search-mode tabs use `py-2` (~34px) | Buy/Rent/PG mode switching is a first-class decision and is mis-tappable | P1 | 44px segmented control |
| Home | `home/HeroSearch.jsx:352` | The "add area" affordance in suggestions appears on hover | On touch there is no discoverable way to see it before committing a tap | P1 | Make it permanently visible on coarse pointers |
| Home | `home/HeroSearch.jsx:360-382` | Existing sticky "I'm done" bar — good, already reasoned about in-comment | — | — | **Preserve.** Use it as the precedent for the sticky-CTA rule in §D |
| Home | `home/Categories.jsx:66`, `home/SocietiesSection.jsx:105` | Horizontal-scroll arrows at `w-9 h-9` (36px) | Redundant on touch (native swipe works) *and* too small | P2 | Hide arrows on coarse pointers; rely on `HScroll` fade + swipe |
| Home | `home/Categories.jsx:84`, `home/Featured.jsx:117` | "View All" is `hidden sm:inline-flex` | Mobile loses the escape hatch in the header; `Featured.jsx:142` compensates, `Categories` does not | P2 | Mirror the `Featured` mobile full-width button in `Categories` |
| Home | Home page length | Home stacks hero + categories + featured + share-flat + societies + testimonials + why-us + CTA + FAQ + ticker | Very long single scroll on a phone with no way back to the top or to search | P1 | Bottom bar makes this survivable; consider hide-on-scroll-down/show-on-scroll-up |

### 2. Search results + filters

| Screen | File(s) | Issue | Why it hurts mobile users | Sev | Recommendation |
|---|---|---|---|---|---|
| Listings | `listings/MobileFilterDrawer.jsx` | Already a full-screen overlay with a sticky Clear / "Show N results" footer | — | — | **Preserve** — this is the strongest mobile pattern in the app |
| Listings | `listings/MobileFilterDrawer.jsx:14` | Drawer close button `w-8 h-8` (32px) | The escape hatch is the smallest target in the sheet | P1 | 44px |
| Listings | `listings/MobileFilterDrawer.jsx` | No swipe-down-to-dismiss; tap-outside/close-button only | Phone users expect to flick a sheet away (Instagram/Telegram) | P2 | Add drag-to-dismiss on the handle |
| Listings | `listings/ResultsArea.jsx:116` | Controls bar is `sticky top-[64px]` — filters/sort/view live at the **top** | Filters are the most-used control in the search journey and sit in the stretch zone | P1 | Keep the sticky top bar for context, but add a floating "Filters · N" pill in the bottom-right thumb arc, above the bottom bar |
| Listings | `listings/ResultsArea.jsx:49,61-63` | Filters button `h-10`, view-toggle `w-9 h-9` | Under 44px on the two most-tapped controls of the page | P0 | 44px |
| Listings | `listings/Card.jsx:103,107,162,166` | Heart / Compare are `w-9 h-9` inside an `<a>` card, with `title=` tooltips as the only label | 36px targets nested inside a full-card link ⇒ high mis-tap rate into navigation; tooltips never show on touch | P0 | 44px targets, increase separation from the card link area, replace `title=` with `aria-label` + a visible micro-label or toast |
| Listings | `listings/DealToggle.jsx:28` | Buy/Rent switch is `h-9` | The most consequential filter in Indian property search is a 36px control | P1 | 44px |
| Listings | `listings/Card.jsx` + `Featured.jsx` | `loading="lazy"` + width/height present (good) but no `srcset`/`sizes` | 360px phones download desktop-sized JPEGs on 4G | P1 | Add `srcset`/`sizes`; serve ≤480px wide variants to phones |
| Listings | `listings/MapGate.jsx:53,63,100` | Area chips `py-1.5`, buttons `py-2.5` | Map is the most touch-intensive surface; its controls are the smallest | P1 | 44px |
| Listings | `Listings.jsx:301-303` | Desktop sidebar `hidden lg:block sticky top-28` | Correct — no mobile impact | — | No change |
| Listings | Map view | No bottom-sheet result preview when a pin is tapped on mobile (`MapDetailPanel` is a drawer, `index.css:7709`) | Verify the mobile branch is a bottom sheet, not a side drawer | P1 | Confirm master–detail on phones is bottom-sheet based (NoBroker/Housing pattern) |

### 3. Property detail (incl. contact gate)

| Screen | File(s) | Issue | Why it hurts mobile users | Sev | Recommendation |
|---|---|---|---|---|---|
| Property | `Property.jsx:86-101` | Sticky mobile CTA bar with `min-h-[44px]` Contact / Schedule / WhatsApp | Best-in-app mobile pattern | — | **Preserve**, and make it the canonical sticky-CTA component |
| Property | `index.css:3092-3104` | `.pn-sticky-cta` uses `env(safe-area-inset-bottom)` but the viewport meta disables it | The bar overlaps the Android gesture bar / iPhone home indicator today | P0 | Fixed by the `viewport-fit=cover` change |
| Property | `Property.jsx:63` | Section tabs `sticky top-16 md:top-[72px] z-30` | Fine, but combined with the top navbar it costs ~110px of a 640px viewport | P1 | Collapse the top navbar on scroll-down so tabs dock to the top |
| Property | `property/Gallery.jsx:10-18` | Swipe implemented with a 40px threshold | — | — | **Preserve** |
| Property | `property/Gallery.jsx:51` | Thumbnail strip is `hidden sm:block` | Mobile users get no sense of how many photos exist — a key trust signal for "is this listing real?" | P1 | Replace thumbnails with a photo counter + dot indicators on mobile |
| Property | `property/Gallery.jsx:21` | Main image `h-[230px]` on mobile | Photos are the #1 trust/decision asset; 230px is a desktop-thinking crop | P1 | Full-bleed 4:3 hero image edge-to-edge on phones |
| Property | `property/ContactOwnerModal.jsx:70,88` | Centred modal, no explicit `max-h`/overflow on the outer panel | On a 640px viewport with the keyboard open (~300px usable) the message textarea and submit can be pushed off-screen | P0 | Convert to a bottom sheet with `max-h-[85dvh]`, internal scroll, sticky submit |
| Property | `property/ContactOwnerModal.jsx:143` | Message textarea has no `inputMode`/`autoComplete`; name/phone fields elsewhere similar | Slower lead capture, the exact step we're trying to convert | P1 | Add `autoComplete` on name/phone; `enterKeyHint="send"` |
| Property | `property/OwnerCard.jsx:41-46` | Chat + Contact buttons are `hidden lg:flex` | Mobile users only get these via the sticky bar — acceptable, but the owner card then looks inert | P2 | Show a single owner action inline on mobile, or make the card visually non-actionable |
| Property | `property/OwnerCard.jsx:42,46,49` | `py-2 px-3 text-xs` buttons | Under 44px | P1 | 44px |
| Property | `property/ScheduleVisitModal.jsx:36` | Centred modal `maxWidth: 600`, no `max-h`; uses custom `DateField`/`TimeField` dialogs | A dialog-inside-a-dialog on a 640px screen; date/time pickers are the classic mobile failure point | P0 | Bottom sheet; consider native `<input type="date">`/`time` on coarse pointers (trade-off in §H) |
| Property | `property/DocumentsSection.jsx:157,192` | `text-[11px]` on a clickable status; checkbox `w-4 h-4` | Legal-document consent is exactly where mis-taps are unacceptable | P0 | 44px hit area on the checkbox row; ≥13px text |
| Property | `property/PriceInsights.jsx:134-149` | EMI inputs `type="number"` in `w-12`, `py-0.5`, no `inputMode` | 48px-wide numeric field with 2px padding — near-unusable one-handed | P1 | Full-width numeric fields, `inputMode="numeric"`, 44px height |
| Property | `property/ReviewsSection.jsx:118` | Filter chips `px-3 py-1.5 text-xs` | Under 44px | P2 | 44px |
| Property | Overall | Page is header + gallery + tabs + specs + rent details + price insights + location + documents + reviews + similar + deal panel | Enormously long on a phone | P1 | Progressive disclosure: collapse Price Insights / Location Insights / Reviews into tap-to-expand sections on mobile (the `ProfileTab.jsx:28-31` accordion pattern already exists) |

### 4. Saved / shortlist

| Screen | File(s) | Issue | Why it hurts mobile users | Sev | Recommendation |
|---|---|---|---|---|---|
| Saved | `Saved.jsx:277,280` | Alert/Remove buttons are `w-11 h-11` (44px) | Correct | — | **Preserve** — use as the reference tap target |
| Saved | `Saved.jsx:273` | Contact button `py-2.5` (~40px) | Just under the minimum on the conversion action | P1 | 44px |
| Saved | `Saved.jsx:188,193` | Tab strip is `overflow-x-auto` with `text-[13px]` pills | Hidden tabs behind a horizontal scroll — the exact problem `dashboard/MobileNav.jsx:4-12` already diagnosed and solved elsewhere | P1 | Reuse the bottom-sheet section switcher, or show all tabs in a 2-row wrap |
| Saved | `Saved.jsx` | No swipe-to-remove on cards | Instagram/WhatsApp-trained users expect swipe on a list they curate | P2 | Swipe-left to remove with undo toast |
| Saved | Route | `/saved` is `ProtectedRoute` + `AppFlagRoute` | Fine, but it's the natural 4th bottom-bar tab — needs a signed-out state | P1 | Design a signed-out Saved tab that shows locally-saved items + a sign-in prompt |

### 5. Auth (login / OTP / signup)

| Screen | File(s) | Issue | Why it hurts mobile users | Sev | Recommendation |
|---|---|---|---|---|---|
| Auth | `auth/OtpBoxes.jsx:60-62` | `inputMode="numeric"` + `autoComplete="one-time-code"` + multi-digit paste handling | Correct and thoughtful | — | **Preserve** |
| Auth | `components/MobileField.jsx:51-54` | `type=tel` + `inputMode=numeric` + `autoComplete=tel-national` | Correct | — | **Preserve**, but raise `h-10` → 44px |
| Auth | `ConsumerLayout.jsx:59` | Footer + assistant already hidden on mobile auth routes | Correct, deliberate | — | **Preserve** |
| Auth | `auth/AuthShell.jsx:18` | `pt-16 lg:pt-0`; no safe-area handling | With the keyboard open on a 640px device the submit button can sit below the fold | P1 | Sticky submit within the auth card on mobile; `100dvh` already used, keep it |
| Auth | `Signin.jsx:227` | Submit has no explicit height (`text-sm`) | Primary conversion button under 44px | P0 | 48px full-width primary |
| Auth | `Signup.jsx:182` | Terms checkbox `w-4 h-4` | 16px legal-consent target | P0 | 44px tappable row wrapping the checkbox |
| Auth | `auth/AadhaarVerifyModal.jsx:81-87`, `OwnerConsentModal.jsx:47-54` | Centre-anchored modals | Verification is a high-drop-off step; a centred dialog on a phone is the worst place for it | P1 | Bottom sheets (`AadhaarVerifyModal` already has `flex-1 overflow-y-auto min-h-0`, so the conversion is cheap) |
| Auth | `Signin.jsx`/`Signup.jsx` | No `enterKeyHint` on any field | Keyboard shows generic "return" instead of "next"/"go" | P2 | Add `enterKeyHint` |

### 6. List-your-property wizard

| Screen | File(s) | Issue | Why it hurts mobile users | Sev | Recommendation |
|---|---|---|---|---|---|
| Wizard | `list-property/LocationPricingStep.jsx:112-287`, `PropertyDetailsWhole.jsx` | Numeric fields already use `inputMode="numeric"` / `"decimal"` | Correct | — | **Preserve** |
| Wizard | `PhotosDocumentsStep.jsx:142-144`, `step1/WholePlaceFields.jsx:25` | Back / Next / Submit sit at the **end** of each step, not sticky | Step 2 is a 30KB component with a map, an address grid and ~10 pricing fields. On a phone the user scrolls hundreds of pixels to find "Next", and again if validation fails. This is the single biggest owner-side conversion leak on mobile. | P0 | Sticky bottom action bar per step (reuse `.pn-sticky-cta`), showing step position + Next |
| Wizard | `StepNav.jsx`, `ProgressMeter.jsx` | Neither is sticky | On a long step the user loses all sense of progress — bad for a 3-step commitment | P1 | Compact sticky progress strip under the top bar on mobile |
| Wizard | `LocationPricingStep.jsx:96-111` | Errors render with `FieldError` above the field, but validation is on submit/step-change | On mobile the first error can be 600px above the (bottom) action — user taps Next and appears to get nothing | P0 | On invalid submit, scroll-to-and-focus the first `[data-err]` field; add an error count to the sticky bar |
| Wizard | `LocationPricingStep.jsx:103-111` | `flatNumber`, `tower`, `street`, `landmark` have no `autoComplete` (`address-line1/2`, `address-level2`, `postal-code`) | Owners retype their address on a phone keyboard | P1 | Add address `autoComplete` tokens |
| Wizard | `PropertyDetailsFlatmate.jsx:71` | `ownerConsentMobile` not `type="tel"` | Wrong keyboard on a phone-number field | P1 | Use `MobileField` |
| Wizard | `PhotoUploader.jsx:61` | Photo delete button `w-6 h-6` (24px) | Photo management is the most touch-heavy part of listing; 24px causes accidental deletions | P0 | 44px, and confirm-on-delete |
| Wizard | `PhotoUploader.jsx` | No `capture` hint on the file input | Android/iOS don't offer "take photo" directly — owners are the users most likely to shoot photos on the spot | P1 | `accept="image/*"` with a camera CTA |
| Wizard | `LocationPricingStep.jsx:241` | Deposit quick-picks `text-[11px] px-2.5 py-1` (~26px) | Under half the minimum | P1 | 44px chips |
| Wizard | `LocationPicker.jsx` / map step | Map pin placement on a phone with a fixed-height container | Pinch/drag inside a scrolling page is the classic mobile map trap | P1 | Full-screen map sheet for pin placement with a "Confirm location" sticky button |
| Wizard | `ListProperty.jsx` | Autosave/draft: `AutosaveBanner.jsx` exists | Verify it survives a mobile tab eviction (Android kills backgrounded tabs aggressively) | P1 | Confirm draft persistence + surface "Draft saved" in the sticky bar |

### 7. Profile / account / dashboard

| Screen | File(s) | Issue | Why it hurts mobile users | Sev | Recommendation |
|---|---|---|---|---|---|
| Dashboard | `dashboard/MobileNav.jsx:59-153` | Bottom-sheet section switcher with grab handle, focus trap, attention badges, `min-h-[44px]` logout | The best mobile component in the codebase | — | **Preserve and promote to a shared `<BottomSheet>` primitive** |
| Dashboard | `components/dashboard/ProfileTab.jsx:28-31` | Mobile accordion / desktop-always-open pattern | Exactly the right progressive-disclosure idea | — | **Preserve and generalise** (see §D) |
| Dashboard | `dashboard/FinancesTab.jsx:146` | `lg:hidden fixed bottom-6 right-4 z-40 w-14 h-14` FAB | Right instinct, but it's a one-off with a z-index that will sit *under* the assistant (`z-1300`) and cookie bar | P1 | Fold into the shared bottom-widget stack |
| Dashboard | `dashboard/OverviewPanel.jsx`, `EnquiriesPanel.jsx` (24.5KB) | Dense multi-metric panels ported from desktop | Heavy scroll, small numbers, many `text-xs` labels | P1 | Mobile: show 3 headline metrics + "See all" sheet |
| Dashboard | `Dashboard.jsx` | 9–11 sections | Bottom bar's Account tab should land on a mobile-first hub, not the desktop grid | P1 | Mobile Account tab = list of sections with badges (already close to `MobileNav`'s sheet content) |

### 8. Admin / ops back-office

**Mobile expectations legitimately differ here, and I'd say so explicitly.** Admin/ops are deliberate, desk-bound, multi-column, data-dense workflows (`AdminProperties.jsx` 27.5KB, `AdminReports.jsx` 21.7KB, `OpsServiceQueue.jsx` 25.7KB). Trying to make the full back-office thumb-friendly is a poor use of effort.

| Screen | File(s) | Issue | Why it hurts mobile users | Sev | Recommendation |
|---|---|---|---|---|---|
| Admin | `components/ui/Table.jsx:58,82` | Mobile-card fallback via a `mobileCard` prop, `sm:hidden` / `hidden sm:block` | Good escape hatch | — | **Preserve**; ensure every admin table actually passes `mobileCard` |
| Admin | `layout/AdminLayout.jsx:59,98` | `fixed inset-y-0 left-0 z-50` sidebar (mobile) + `sticky top-0 z-30` header | Correct desktop-console pattern | — | No bottom nav in admin — would confuse the two products |
| Ops | `OpsQueue.jsx`, `OpsServiceQueue.jsx` | Field-ops staff *do* work from phones (site visits, photo verification) | This is the one back-office flow with a real mobile use case | P1 | Scope a mobile "Ops on the go" subset: today's queue, mark-visited, upload photo — not the whole console |
| Admin | `layout/AdminTopbarTools.jsx` (28.7KB) | Very dense toolbar | Acceptable — desktop-only tool | P2 | Declare admin "desktop-first by design" in the design system and stop paying mobile tax on it |

---

## C. Proposed mobile navigation model

### C.1 The bottom tab bar (`< lg`, i.e. below 1024px)

Five slots — the maximum before labels become unreadable at 360px and the ceiling used by WhatsApp (4), Telegram (5), Instagram (5), NoBroker and Housing mobile web (4–5).

| # | Tab | Route | Icon (lucide) | Why this earns a slot |
|---|---|---|---|---|
| 1 | Home | `/` | `home` | Entry point, city/intent context, re-orientation |
| 2 | Search | `/listings` | `search` | The core funnel step. Tapping it while already on `/listings` should open the search/locality sheet — same "tap active tab to act" behaviour as Instagram's search tab |
| 3 | **Post** | `/list-property` | `plus` in a raised teal circle | PuneNest is **supply-first**. Making "Post property" a permanent, centre-of-thumb-arc action is the strategic bet — this is the Instagram/YouTube centre-FAB pattern applied to the thing the business actually needs |
| 4 | Saved | `/saved` | `heart` | Property search is a multi-session, comparison-driven journey. Shortlist is the retention hook and today it's hidden behind a hamburger |
| 5 | Account | `/dashboard` | `user` (avatar when signed in) | Consolidates Notifications, Messages, Profile, My Listings — all currently `hidden sm:inline-flex` in the navbar |

**Behaviour spec**

- **Visibility:** `lg:hidden`. Hidden on `/reels` (full-bleed), `/messages` on mobile (`route-messages` already goes full-screen), and the auth routes (`route-auth` already strips chrome) — reuse the existing route flags in `ConsumerLayout.jsx:50-59` rather than inventing new ones.
- **Height:** 56px content + `env(safe-area-inset-bottom)`.
- **Tab target:** each tab ≥ 56×48px, full-height tappable, `aria-current="page"` on active.
- **Active state:** teal icon + teal label + a 3px top indicator. Do **not** rely on colour alone — bump icon weight/fill too (contrast + colour-blind safety).
- **Labels:** always visible, 10–11px, `font-medium`. Icon-only bars test badly with first-time Indian mobile-web users; Telegram/WhatsApp both keep labels.
- **Badges:** Saved = count of new price drops/matches; Account = unread notifications + messages. Reuse the badge treatment from `dashboard/MobileNav.jsx:76-80`.
- **Scroll behaviour:** **stays pinned.** Do *not* hide-on-scroll. The bar is the user's anchor while scrolling long result lists, and hide-on-scroll bars are the #1 complaint on property apps. Apply hide-on-scroll to the **top** bar instead (see C.2).
- **Post tab:** raised 8px above the bar, 56px teal circle. When signed out, tapping it routes to `/signin?next=/list-property` rather than failing at the guard.
- **State preservation:** each tab should remember its scroll position and filter state (`/listings` filters already live in the URL — keep that).

### C.2 What changes in the top bar

- Keep it fixed but reduce it to: **back/city (left) · logo (centre-left) · one contextual action (right)**.
- Remove the hamburger `<lg` entirely once the bottom bar ships — its 6 items redistribute: Buy/Rent → Search tab intent switch; Share Flat, Reels, Services, Refer → an "Explore" section on the Home tab and inside Account.
- **Hide-on-scroll-down / show-on-scroll-up** for the top bar only. This reclaims 64px of a 640px viewport on long pages, and it's exactly what Housing.com and NoBroker mobile web do.
- The page-context sticky bars (`Property.jsx:86`, section tabs at `Property.jsx:63`, listings controls at `ResultsArea.jsx:116`) stay — but must dock against the new `--pn-bottom-inset` / top-bar offsets rather than hardcoded `top-16` / `bottom-0`.

### C.3 Where the primary action lives, per screen

| Screen | Primary action | Placement on mobile |
|---|---|---|
| Home | Search | Hero (scanning) + Search tab (thumb) |
| Listings | Filters + Show results | Floating "Filters · N" pill bottom-right, above the bottom bar; drawer keeps its sticky footer |
| Property | Contact owner | Existing `.pn-sticky-cta`, **stacked above** the bottom bar (or bottom bar hides on this route — decide in §H) |
| Saved | Contact | In-card, 44px |
| Wizard | Next / Submit | New sticky step bar (P0) |
| Dashboard | Section switch | Existing bottom sheet |

### C.4 Coexistence with desktop (`≥ lg`)

- Bottom bar is `lg:hidden`; the desktop navbar (`Navbar.jsx:275`) is untouched. Zero desktop regression by construction.
- **Risk of naive implementation:** the property sticky CTA (`.pn-sticky-cta`) is `lg:hidden` and `bottom: 0` — a bottom bar added at `bottom: 0` will sit *on top of* the Contact CTA on every property page. The `--pn-bottom-inset` variable must be introduced **in the same change** as the bar, not after.
- Second risk: `AssistantWidget.jsx:194-201` hardcodes `bottom-[5.75rem]` for pages with a sticky bar. That logic must be deleted and replaced by the variable, or the FAB will float 92px above a bar that no longer needs the clearance.
- Third risk: `ConsumerLayout.jsx:64` uses `pt-16 md:pt-[72px]` for the top bar. Pages will need an equivalent bottom padding token, otherwise the last card in every list is unreachable behind the bar.

---

## D. Mobile design-system deltas

Rules, not one-offs. All belong in `tailwind.config.js` + a `@layer components` block in `styles/index.css`.

**D.1 Tap targets**
- Minimum interactive size: **44×44px**; primary CTAs **48px**.
- `Button.jsx`: `sm` → 36px (non-primary only), `md` → 44px, `lg` → 48px below `sm:` breakpoint; desktop keeps today's 32/40/48.
- Any icon-only control gets a `.tap-target` utility: `min-height:44px; min-width:44px; display:inline-flex; align-items:center; justify-content:center;` — the visual glyph stays small, the hit area grows.
- Minimum 8px gap between adjacent targets. Never place two 44px targets inside a card that is itself a link (fixes `listings/Card.jsx`).

**D.2 Type scale (mobile)**
- Body minimum **14px**; secondary text minimum **13px**. Ban `text-[10px]` / `text-[11px]` on anything interactive.
- Keep the existing `<640px` heading downscale (`index.css:8289`) — it's well reasoned.
- Keep the `pointer: coarse` 16px form-field rule (`index.css:8338`). Non-negotiable; it prevents focus-zoom.

**D.3 Spacing / layout**
- Page gutter: **16px** on phones (currently varies 12–24px).
- Vertical rhythm: 8px base, sections separated by 24–32px.
- Bottom of every scrollable page: `padding-bottom: calc(var(--pn-bottom-inset) + 16px)`.

**D.4 Safe area — the single system rule**
```
:root { --pn-safe-b: env(safe-area-inset-bottom, 0px); }
```
- `index.html` must carry `viewport-fit=cover` or the above is permanently `0`.
- Layout owns `--pn-bottom-inset` = bottom-bar height + `--pn-safe-b` + any active sticky CTA. Every bottom-anchored widget (assistant FAB, cookie bar, city chrome, finances FAB, sticky CTAs) positions from that variable. **No component hardcodes a `bottom-` value again.**
- Z-index ladder, documented once: content `0–49` · sticky page CTA `60` · bottom nav `70` · sheets `1000` · assistant `1300` · consent `1400` · blocking modals `1500`.

**D.5 Bottom sheet — the default overlay on mobile**
Promote `dashboard/MobileNav.jsx:84-152` into `components/ui/BottomSheet.jsx`:
- `fixed inset-0 flex items-end`, panel `w-full rounded-t-2xl max-h-[85dvh] flex flex-col`.
- Grab handle (`w-9 h-1 rounded-full bg-white/15`), drag-down to dismiss, tap-backdrop to dismiss, Escape, focus trap, body-scroll lock.
- Scrollable body + **non-scrolling sticky footer** for actions, padded with `--pn-safe-b`.
- `Modal.jsx` gains `variant="sheet"` and auto-selects it below `640px`. Everything at `≥ sm` keeps today's centred dialog — zero desktop change.

**D.6 Sticky CTA pattern**
- One component, derived from `.pn-sticky-cta` (`index.css:3092`): full-width, blurred, top-bordered, `padding-bottom: calc(0.7rem + var(--pn-safe-b))`.
- Rule: **any screen whose primary action is more than one viewport from the top must have one** — property, wizard steps, checkout, contact sheet, auth.
- Max 2 actions; primary is ≥60% width.

**D.7 Touch interaction**
- Nothing may be *only* reachable via `:hover`. Hover states are decoration; every hover-revealed affordance gets `@media (hover: none) { opacity: 1 }` or is always visible.
- Replace `title=` tooltips with `aria-label` + visible label or a toast.
- Horizontal scrollers: native swipe + `scroll-snap` + fade edges (`HScroll.jsx` already does this); hide arrow buttons at `(pointer: coarse)`.
- Add swipe-to-dismiss on sheets and swipe-to-remove on Saved.
- `-webkit-tap-highlight-color: transparent` plus an explicit `:active` state on every interactive element, so taps feel acknowledged on slow devices.

**D.8 Motion**
- Sheets: 240ms `cubic-bezier(0.32, 0.72, 0, 1)` (iOS-like) up, 180ms down.
- Tab switches: no cross-fade — instant, like WhatsApp. Perceived speed beats polish on mid-range Android.
- Respect the existing `prefers-reduced-motion` blocks (7 of them already in `index.css`).

**D.9 Performance budget (mobile is a UX rule, not an ops rule)**
- Above-the-fold images: `srcset` with a ≤480px variant; `fetchpriority="high"` on the property hero; `loading="lazy"` everywhere else (already mostly done).
- Always set `width`/`height` or `aspect-ratio` — already good in `Card.jsx`/`Featured.jsx`, must not regress.
- Split `styles/index.css` (172KB) so page-specific blocks load with their route, matching the existing `lazy()` route splitting.
- Targets on a mid-range Android / 4G: LCP < 2.5s, INP < 200ms, CLS < 0.1.

**D.10 PWA baseline**
- `manifest.webmanifest`: `display: standalone`, `background_color`/`theme_color` `#0f0d1a`, 192/512 + maskable icons, `start_url: "/?source=pwa"`.
- Service worker: app-shell precache + stale-while-revalidate for listing images. This is what makes patchy-4G browsing feel native.
- `theme-color` meta so Android Chrome's bar matches the dark brand.

---

## E. Component inventory

**Fine as-is (mobile-ready — do not touch)**
`dashboard/MobileNav.jsx` · `listings/MobileFilterDrawer.jsx` · `components/MobileField.jsx` (bar height) · `auth/OtpBoxes.jsx` · `property/Gallery.jsx` swipe handler · `ui/HScroll.jsx` · `ui/Table.jsx` mobile-card fallback · `pmf/PreviewBanner.jsx` · the `pointer: coarse` and `<640px` heading blocks in `index.css`.

**Needs a mobile variant (additive, desktop untouched)**
| Component | Variant needed |
|---|---|
| `ui/Modal.jsx` | `variant="sheet"`, auto below 640px |
| `ui/Button.jsx` | Mobile size ramp (44/48px) |
| `ui/Select.jsx`, `ui/MultiSelect.jsx` | Bottom-sheet picker on coarse pointers instead of a portaled dropdown |
| `ui/DatePickerDialog.jsx`, `TimePickerDialog.jsx` | Sheet presentation; consider native inputs on coarse pointers |
| `ui/Menu.jsx` | Action sheet on mobile (items currently `px-2.5 py-2 text-[13px]`) |
| `ui/Tabs.jsx` | Wrap or sheet-switcher when items overflow, instead of horizontal scroll |
| `ui/DualRange.jsx` | Larger thumbs (≥28px) + numeric entry |
| `layout/Navbar.jsx` | Slimmed mobile top bar + hide-on-scroll |
| `layout/Footer.jsx` | Collapse to accordion on mobile (9.5KB of links below every page) |
| `property/PropertyHeader.jsx` | Mobile summary card; move Schedule Visit out of `hidden lg:block` |

**Needs full rework for mobile**
| Component | Why |
|---|---|
| `property/ContactOwnerModal.jsx` | Centred modal on the core conversion step; keyboard collisions |
| `property/ScheduleVisitModal.jsx` | Nested dialogs, no max-height |
| `list-property/*` step containers | No sticky action bar, no scroll-to-error, 30KB single step |
| `list-property/PhotoUploader.jsx` | 24px delete, no camera affordance |
| `list-property/LocationPicker.jsx` | Map-in-scroll-page trap |
| `dashboard/OverviewPanel.jsx`, `EnquiriesPanel.jsx` | Desktop metric density |
| `assistant/AssistantWidget.jsx` | Bespoke bottom-offset logic must move to the layout variable |
| `CookieConsent.jsx` / `CityChrome.jsx` | Must join the bottom-widget stack |

**New components to add**
`layout/BottomNav.jsx` · `ui/BottomSheet.jsx` · `ui/StickyActionBar.jsx` · `ui/FloatingFilterPill.jsx` · a `useBottomInset()` hook.

**Explicitly out of scope for mobile-first**
All `pages/admin/*` and `AdminTopbarTools.jsx` — desktop-first by design. Exception: a scoped mobile Ops queue (see F, P2).

---

## F. Prioritised roadmap

### P0 — breaks one-handed use

| # | Item | Effort | Expected impact |
|---|---|---|---|
| 1 | `viewport-fit=cover` + `theme-color` in `index.html` | **S** | Instantly activates the 3 existing safe-area rules; stops CTAs sitting under the gesture bar |
| 2 | `--pn-bottom-inset` system + z-index ladder; migrate assistant/cookie/city/finances FAB/sticky CTA onto it | **M** | Prerequisite for everything below; removes existing per-page hacks |
| 3 | `BottomNav.jsx` — 5 tabs with centre Post FAB, `lg:hidden` | **M** | The headline change: one-tap access to Search/Saved/Post/Account from the thumb arc |
| 4 | Tap-target pass: `Button.jsx` ramp + `.tap-target` on navbar icons, card heart/compare, filters/view toggles, photo delete, consent checkboxes | **M** | Cuts mis-taps on every high-frequency control |
| 5 | Sticky action bar on all 3 wizard steps + scroll-to-first-error | **M** | Directly addresses owner-side listing drop-off — the supply-first business goal |
| 6 | `BottomSheet.jsx` + convert `ContactOwnerModal` and `ScheduleVisitModal` | **M** | The lead-capture step stops fighting the on-screen keyboard |
| 7 | PWA manifest + icons + `theme-color` | **S** | Installability; "real app" perception |

### P1 — feels desktop-ish

| # | Item | Effort | Impact |
|---|---|---|---|
| 8 | Top navbar slim-down + hide-on-scroll; retire the mobile hamburger | **M** | Reclaims 64px of a 640px viewport |
| 9 | Floating "Filters · N" pill on `/listings` | **S** | Moves the most-used search control into the thumb arc |
| 10 | `Modal.jsx` `variant="sheet"` auto below 640px; `Select`/`MultiSelect`/date/time as sheets | **L** | Systemic app-native feel across ~40 overlays |
| 11 | Property page progressive disclosure (collapse insights/reviews) using the `ProfileTab` accordion pattern | **M** | Halves scroll depth on the highest-intent page |
| 12 | Gallery: full-bleed hero + counter/dots replacing `hidden sm:block` thumbnails | **S** | Photos are the #1 trust signal in Indian listings |
| 13 | Responsive images (`srcset`/`sizes`, ≤480px variants) | **M** | Real 4G speed win; lowers data cost, which matters to this user |
| 14 | Hover-affordance sweep (`hover: none` fallbacks; `title=` → `aria-label` + visible label) | **M** | Removes invisible functionality on touch |
| 15 | `autoComplete` tokens on address + name fields; `enterKeyHint` across forms | **S** | Faster form completion, fewer abandons |
| 16 | Saved: tab-strip rework + swipe-to-remove + signed-out state | **M** | Makes Saved a viable bottom-bar tab |
| 17 | Service worker (app shell + image SWR) | **M** | Patchy-4G resilience |
| 18 | Dashboard mobile hub (3 headline metrics + sheets) | **M** | Account tab lands somewhere designed for a phone |

### P2 — polish

| # | Item | Effort | Impact |
|---|---|---|---|
| 19 | Swipe-to-dismiss on all sheets | **S** | App-native muscle memory |
| 20 | Footer accordion on mobile | **S** | Removes ~600px of links from every page bottom |
| 21 | Hide horizontal-scroll arrows at `(pointer: coarse)` | **S** | Less clutter |
| 22 | Split `styles/index.css` per route | **L** | First-paint improvement |
| 23 | Scoped mobile Ops queue (today's visits, mark-visited, photo upload) | **M** | Real field-staff value without mobilising the whole console |
| 24 | Landscape + dynamic-type sweep | **M** | Accessibility coverage |

---

## G. Verification plan

### G.1 Manual device testing

Test on **two real devices**, not just DevTools — touch accuracy, keyboard behaviour and scroll inertia don't emulate faithfully.

- **360 × 640** (low-end Android, e.g. Redmi/Realme entry tier — the realistic PuneNest median device)
- **390 × 844** (iPhone 14/15 class — validates notch + home-indicator safe areas)

**One-handed protocol** (do every flow using only the right thumb, phone held at the bottom):
1. Home → search "Baner" → apply 2 filters → open a listing → contact the owner. Note every time you must shift grip.
2. Sign in with OTP — confirm SMS autofill works and the submit button is reachable with the keyboard open.
3. Post a property end-to-end — confirm you never scroll hunting for "Next", and that a validation error scrolls you to the field.
4. Save 3 listings → open Saved → remove one → contact one.
5. Rotate to landscape at each step; confirm nothing is trapped under the keyboard or gesture bar.

**Explicit checks**
- Every sticky/fixed bar clears the iOS home indicator and the Android gesture bar.
- No control smaller than 44px on any consumer screen (use DevTools "Show tap targets" / an axe scan).
- No input focus triggers a page zoom.
- At 200% browser font scale, no bottom-bar label truncates and no CTA is clipped.
- On simulated **Slow 4G + 4× CPU throttle**: Home LCP < 2.5s, first tap response < 200ms.
- Dark mode / low brightness in sunlight: bottom-bar active state distinguishable without relying on colour alone.

### G.2 Playwright

Current state: `e2e/playwright.config.js:46-52` defines a `mobile` project (`devices['Pixel 7']`, 412×915) matched by `testMatch: /mobile-.*\.spec\.js/`, and only **three** specs qualify (`mobile-space-optimization`, `mobile-navbar-context`, `mobile-inbox-saved`). 360×640 is never exercised.

**Config changes**
- Add a third project `mobile-small` using a 360×640 viewport with `hasTouch: true`, `isMobile: true` — the low-end Android baseline.
- Keep the `mobile-*` naming convention so the desktop project's `testIgnore` keeps working unchanged.

**New specs**
| Spec | Asserts |
|---|---|
| `mobile-bottom-nav.spec.js` | Bar visible `<lg`, absent `≥lg`; 5 tabs with correct routes; `aria-current` follows navigation; hidden on `/reels`, `/messages`, `/signin`; Post tab redirects signed-out users to `/signin?next=/list-property`; badges render |
| `mobile-bottom-inset.spec.js` | On `/property/:id`, the sticky CTA and the bottom bar do not overlap (bounding-box assertion); assistant FAB sits above both; cookie bar sits above everything |
| `mobile-tap-targets.spec.js` | Sweep `/`, `/listings`, `/property/:id`, `/saved`, `/list-property`, `/signin`; assert every visible `button, a, [role="button"], input[type="checkbox"]` has a bounding box ≥44×44 (with an explicit, reviewed allow-list) |
| `mobile-listings-filters.spec.js` | Floating filter pill visible and reachable; drawer opens as a sheet; sticky "Show N results" applies and closes |
| `mobile-property-contact.spec.js` | Sticky CTA always in viewport while scrolling; contact sheet is bottom-anchored, scrolls internally, submit stays visible with a focused textarea |
| `mobile-wizard-sticky.spec.js` | Sticky Next visible on every step without scrolling; invalid submit scrolls to and focuses the first `[data-err]` field; draft persists across reload |
| `mobile-auth-keyboard.spec.js` | Phone field `type=tel`/`inputMode=numeric`/`autoComplete=tel-national`; OTP `autoComplete=one-time-code`; submit inside the viewport at 360×640 |
| `mobile-safe-area.spec.js` | `<meta name="viewport">` contains `viewport-fit=cover`; manifest link + `theme-color` present |

**Extend existing**
- `mobile-navbar-context.spec.js` — add hide-on-scroll and hamburger-retirement assertions.
- `mobile-inbox-saved.spec.js` — add the Saved tab-strip rework and signed-out state.
- `mobile-space-optimization.spec.js` — re-baseline after the top-bar slim-down.

**Gate:** no P0 item is "done" until its spec passes on both `mobile` (412×915) and `mobile-small` (360×640) with zero console errors.

---

## H. Open questions / assumptions needing your confirmation

1. **Bottom-bar tab set.** I've proposed Home · Search · **Post** · Saved · Account, giving the centre FAB to *Post property* on the supply-first thesis. The alternative is giving it to Search (demand-first) and moving Post into Account. **Which side of that bet do you want?**
2. **Share Flat and Reels lose their top-level slots.** Both are differentiators (`/share-flat` has ~25 dedicated specs; `/reels` is a full-bleed experience). Under my proposal they move into Home/Explore. Is that acceptable, or is Share Flat strategically important enough to displace Saved?
3. **Property page: bar-on-bar.** On `/property/:id` you'd have the sticky Contact CTA *and* the bottom nav. Options: (a) stack them (CTA above nav, ~120px of chrome), (b) hide the nav on property detail (like Instagram hides it in a full-screen post), (c) merge — put Contact inside the nav strip. I lean (b). **Your call.**
4. **Hide-on-scroll.** I recommend hide-on-scroll for the *top* bar only and a permanently pinned bottom bar. Confirm you're happy with the bottom bar never yielding screen space.
5. **Native vs custom date/time pickers.** `DateField`/`TimeField` are custom dialogs. Native `<input type="date">` on coarse pointers gives users the OS picker they already know and is far cheaper to maintain — but loses your visual styling and the "available slots" logic. **Custom sheet, or native on mobile?**
6. **PWA scope.** Manifest + icons is small. A service worker is a real commitment (cache invalidation, update prompts, stale-listing risk in a marketplace where freshness is a trust signal). **Do we do full offline, or manifest-only for now?**
7. **Ops on mobile.** Is there an actual field-ops workflow (site visits, photo verification) that justifies a scoped mobile ops view, or is ops genuinely desk-only? This changes P2 #23 materially.
8. **Assumption to confirm:** I've treated `lg` (1024px) as the mobile/desktop boundary because the codebase already does (`Navbar.jsx`, `Property.jsx:86`, `DashboardSidebar.jsx:10`). That means tablets get the mobile bottom bar. Fine, or should the bar stop at `md` (768px)?
9. **Assumption to confirm:** brand/visual language stays exactly as-is (dark `#0f0d1a`, teal `#14b8a6`, Outfit, glass cards). Every recommendation above is structural/ergonomic, not a restyle. Say so if a visual refresh is also in scope.
10. **Design-token ownership.** The `--pn-bottom-inset` variable is the linchpin. It only works if *every* bottom-anchored component migrates in the same change. Confirm you're happy for that refactor to touch `AssistantWidget.jsx`, `CookieConsent.jsx`, `CityChrome.jsx`, `FinancesTab.jsx` and `index.css:3092` together rather than incrementally.
