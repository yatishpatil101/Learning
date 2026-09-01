# Draazy — Mobile App Plan (Pre‑React‑Native)

> Goal: ship a real, store‑listed Android/iOS app for Draazy by **reusing the existing React
> codebase**, optimizing for **performance** and **usability**, without a native rewrite.
>
> Scope of this document: **everything up to (but not including) React Native.** That means two
> phases — **PWA hardening** and **Capacitor packaging** — plus the backend prerequisite that both
> depend on. React Native is deliberately deferred and only sketched at the end as a future Phase.

Audience: this is written for someone **new to mobile development**, so key concepts are explained
inline. Owner: frontend team. Status: proposed.

---

## 1. TL;DR — the strategy in one page

We will **not** rewrite the app. Our React app is a WebView‑ready SPA with a clean service/logic
separation, so we take the fast, low‑risk path first:

1. **Phase 0 — Backend prerequisite.** Native features (push, camera upload, per‑user data) need a
   real API. Our service layer (`src/services/`) is already built to flip from `mock` → `http` with
   one env var. This is the gating dependency for the mobile features that actually matter.
2. **Phase 1 — PWA hardening.** Turn the current web app into an installable, offline‑capable,
   fast‑loading Progressive Web App. Benefits mobile web *and* the Capacitor shell in Phase 2.
3. **Phase 2 — Capacitor packaging.** Wrap the exact same web build in a native Android/iOS shell to
   get App Store / Play Store apps with native push, geolocation, camera, and native storage —
   reusing **~95–100%** of existing code.
4. **Phase 3 (future, out of scope here) — React Native** for the consumer app *only if* native feel
   becomes the competitive differentiator. Admin/ops stays web forever.

**Why this order:** cheap validation now, native investment only where it pays off. We compete with
NoBroker / MagicBricks / 99acres, who have polished native apps — but trust, freshness, and genuine
owner‑direct leads win in Indian real estate, not raw native polish. Capacitor lets us match table
stakes (a store app + push alerts) in weeks, not months.

---

## 2. What "mobile app" options actually mean (concepts)

| Approach | What it is | Native feel / perf | Reuse from our app | Effort | Verdict |
|---|---|---|---|---|---|
| **PWA** | Our web app, installable from the browser, offline‑capable | Good (web) | ~100% | Very low | **Do now (Phase 1)** |
| **Capacitor** | Our *exact* web build wrapped in a native shell; real store app + native APIs | Good (web‑based) | **~95–100%** | Low | **Do next (Phase 2)** |
| **React Native (Expo)** | Rebuild the **UI** in native primitives; reuse logic only | **Best (truly native)** | Logic yes, **UI no** | High | Defer (Phase 3) |

**The one concept to internalize:** Capacitor runs our existing React/HTML/CSS **unchanged** inside a
native WebView and adds a bridge to native APIs. React Native does **not** — it replaces `<div>` /
Tailwind with `<View>` / `<Text>` / `StyleSheet`, so every screen is rebuilt. That is the whole
reason Capacitor comes first.

---

## 3. Codebase readiness — what reuses, what changes

Our current stack: **React 19 + Vite 6 + React Router 7 + Tailwind 3**, Leaflet maps, Chart.js,
jsPDF, with a **provider‑based service layer** and **platform‑agnostic logic** in `src/lib/`.

### Reuses as‑is (both PWA and Capacitor)
- **`src/services/**`** — data layer already abstracts mock vs. HTTP behind Promises (`config.js`,
  `propertyService.js`, `authService.js`, `dealService.js`, `contactService.js`, `financeService.js`).
- **`src/lib/**`** — all business/domain logic: `format`, `qualityScore`, `rentReceipt`,
  `serviceFlow`, `freshness`, `groupApplications`, `emi`/calculators, `constants`, `hash`.
- **`src/components/**` and `src/pages/**`** — every JSX screen, unchanged.
- **Styling** (Tailwind), **maps** (Leaflet), **charts** (Chart.js), **routing** (React Router).

### Needs adaptation for mobile (small, surgical)
- **Persistence (`src/lib/persist.js`)** — dev uses a Vite file‑persist middleware; production falls
  back to `localStorage`. Inside Capacitor, migrate to **`@capacitor/preferences`** (native storage)
  so data survives app updates and is not evicted like WebView localStorage can be.
- **Router mode** — confirm hash or memory‑safe routing works from a `file://`/`capacitor://` origin
  (BrowserRouter needs correct `base`; test deep links).
- **Absolute asset paths** — ensure Vite `base` produces relative asset URLs for the packaged shell.
- **Safe‑area / notch handling** — add CSS `env(safe-area-inset-*)` padding for iOS/Android.
- **Leaflet tiles & external CDNs** — verify they load over the app origin and behind offline caching.

### Must be rebuilt only for React Native (Phase 3 — not now)
- Every visual component (→ `View`/`Text`/`FlatList`), maps (→ `react-native-maps`), charts
  (→ `victory-native`), navigation (→ `react-navigation`). Logic/services port directly.

---

## 4. Recommended tech stack (pre‑React‑Native)

**Core (already in place):** React 19, Vite 6, React Router 7, Tailwind 3, Leaflet, Chart.js.

**Add for Phase 1 (PWA):**
- **`vite-plugin-pwa`** (Workbox under the hood) — service worker, offline caching, install manifest.
- **`@tanstack/react-query`** — caching, retries, stale‑while‑revalidate for the service layer. Big
  perf + offline UX win; drops in on top of the existing Promise‑based services.
- Route‑based **code splitting** (`React.lazy` + `Suspense`) and image lazy‑loading.

**Add for Phase 2 (Capacitor):**
- **`@capacitor/core`**, **`@capacitor/cli`**, **`@capacitor/android`**, **`@capacitor/ios`**.
- Plugins: **`@capacitor/push-notifications`** (listing alerts — a core acquisition lever),
  **`@capacitor/geolocation`** ("near me" search), **`@capacitor/camera`** (owner photo upload),
  **`@capacitor/preferences`** (native storage), **`@capacitor/app`** + **`@capacitor/browser`**
  (deep links / external links), **`@capacitor/status-bar`** + **`@capacitor/splash-screen`**.

**Backend prerequisite (Phase 0):** any REST service (the code comments target Spring Boot at
`http://localhost:8080/api`). Model entities from the existing mock providers. Set
`VITE_API_MODE=http` to switch the app over — **zero component changes**.

---

## 5. Phase 0 — Backend prerequisite (gating dependency)

Push notifications, camera upload, saved searches, and per‑user data are only meaningful with a real
backend and real auth. The service layer is already designed for this flip.

**Work:**
- Stand up REST endpoints mirroring the mock providers: listings, users, deals/enquiries, contacts,
  finance, auth. Keep the same **normalized listing model** (see `real-estate-expert`: `listingType`
  discriminator, lat/lng always present, gated contact, RERA validation).
- Implement **real auth** (server session / JWT) + role‑based guards to replace the mock
  `localStorage` guards (admin vs. staff vs. seeker). Enforce authorization **server‑side**.
- Provide `/http` provider files under `src/services/providers/http/` matching the mock provider
  method signatures.

**Acceptance criteria:**
- With `VITE_API_MODE=http`, the web app runs end‑to‑end against the API with **no component edits**.
- Contact details never leak before the auth/Aadhaar gate (enforced by the server, not the client).
- Roles enforced server‑side (a seeker cannot hit admin/ops endpoints).

**Primary metric:** % of core flows working against the live API. **Guardrail:** no PII/contact leak
before gate; auth error rate flat.

> This phase can overlap with Phase 1 (PWA hardening is backend‑agnostic), but must land **before**
> the native‑feature parts of Phase 2 (push/camera/geo) are useful.

---

## 6. Phase 1 — PWA hardening

Make the mobile web experience fast, installable, and resilient. Everything here also improves the
Capacitor shell in Phase 2 (same build).

> **Status:** installability is **shipped** — manifest + icons, `vite-plugin-pwa` service worker,
> safe-area/bottom-chrome system, and the in-app install promotion (§6.1). React Query, route
> splitting and the offline states below are still open.

### Tasks
1. **Add `vite-plugin-pwa`** with a web app manifest (name, icons, theme color, standalone display)
   and a Workbox service worker. ✅
2. **Caching strategy:**
   - App shell + static assets: precache (cache‑first). ✅
   - Listing images / map tiles: cache‑first with expiration. ✅
   - API GET reads (via React Query): stale‑while‑revalidate; queue nothing destructive offline.
     `/api/*` is `NetworkOnly` and asserted to be so — on a marketplace, a cached listing that still
     says "available" after it is rented is a product failure, not a performance win.
3. **Introduce React Query** over the service layer for property lists, detail, saved searches.
4. **Performance:**
   - Route‑based code splitting (`React.lazy`) for heavy pages (map, charts, admin).
   - Lazy‑load below‑the‑fold images; use deterministic placeholders (already a domain guardrail).
   - Audit bundle; ensure Leaflet/Chart.js/jsPDF are only loaded on pages that need them.
5. **Mobile UX polish:** verify all pages at 360–430px widths; tap targets ≥44px; sticky primary CTA
   (contact / schedule visit / save) above the fold on listing detail; safe‑area CSS. ✅
6. **Offline states:** graceful offline banner; saved/shortlisted listings readable offline.
7. **In-app install promotion** — see §6.1. ✅

### 6.1 Install promotion (shipped)

Installability alone converts almost nobody: every browser buries "Add to Home Screen" two or three
taps into a menu users never open. `InstallPrompt.jsx` surfaces it in-app — one tap plus the browser's
native confirm on Android Chromium, and a Share-menu instruction on iOS, which exposes no install API
in any browser. Behaviour, cooldowns and the StrictMode trap are specified in
[`system/design-system.md`](../system/design-system.md) → *Home-screen install nudge*.

Two things worth carrying into Phase 2, both of which only reproduced in **production**:

- **A `<meta>` CSP does not govern the service worker.** Netlify applies its `[[headers]]` block to
  `/sw.js` too, so the worker inherits the real policy. Listing photos are `img-src` when the browser
  loads an `<img>`, but the SW's `fetch()` for the same URL has no image element behind it and is
  checked against **`connect-src`** — so every photo failed with `ERR_FAILED` the moment the worker
  took control. `vite preview` sends no CSP header at all, which is exactly why local verification
  missed it. Any new origin the SW fetches needs both directives.
- **Chrome no longer requires a service worker to be installable.** The install criteria are HTTPS +
  a manifest with name, 192/512 icons, `start_url` and `display: standalone`. The SW buys the offline
  shell, not installability — worth remembering if the caching risk in §12 ever outweighs the benefit.

### Acceptance criteria
- Lighthouse **PWA installable = pass**; **Performance ≥ 90** on mobile emulation for the homepage
  and a listing detail page.
- App is installable to home screen and launches standalone (no browser chrome). ✅
- The install nudge is discoverable in-app, mobile-only, and self-silencing (1w → 2w → never). ✅
- Cold‑load listing page **Largest Contentful Paint < 2.5s** on a mid‑tier Android emulation.
- Saved listings viewable with network disabled.
- Playwright suite (`e2e/tests/*.spec.js`) passes with **zero unexpected console errors**. ✅

### Metrics
- **Primary:** mobile search‑to‑contact rate; median listing‑page load time.
- **Guardrail:** JS bundle size per route; spam‑report rate flat; no regression in contact‑gate
  completion.
- **Install funnel:** nudge-shown → accepted rate, and the share of dismissals that reach the
  terminal third strike — a high terminal rate means the ask is mistimed, not that the app is
  unwanted.

---

## 7. Phase 2 — Capacitor packaging (Android + iOS)

Wrap the Phase‑1 web build in a native shell to produce real store apps with native capabilities.

### Setup tasks
1. `npm i @capacitor/core && npm i -D @capacitor/cli`; `npx cap init` (appId e.g.
   `com.draazy.app`, appName "Draazy"). Set Capacitor `webDir` to Vite's `dist`.
2. `npm i @capacitor/android @capacitor/ios`; `npx cap add android` / `npx cap add ios`.
3. Build + sync flow: `npm run build` → `npx cap sync` → `npx cap open android|ios`.
   (iOS build/signing requires macOS + Xcode; Android needs Android Studio + JDK.)

### Adaptation tasks (surgical, from §3)
- Swap persistence to **`@capacitor/preferences`** inside the app shell (keep localStorage fallback
  for plain web).
- Verify routing/deep links from the app origin; set Vite `base` for relative assets.
- Add **safe‑area** insets, **status bar** + **splash screen** config, app icons, adaptive icons.

### Native feature tasks (depend on Phase 0 backend)
- **Push notifications** (`@capacitor/push-notifications` + FCM/APNs): new‑listing and saved‑search
  alerts. This is a core acquisition/retention lever — treat it as a first‑class feature.
- **Geolocation** (`@capacitor/geolocation`): "properties near me" and commute/locality search.
- **Camera** (`@capacitor/camera`): owner photo upload in the list‑property wizard (autosave draft
  must survive — already a wizard guardrail).

### Acceptance criteria
- Signed **debug APK** installs and runs the full seeker funnel (search → filter → detail → gated
  contact) on a physical Android device.
- **Push notification** received on device for a saved‑search match (against staging backend).
- **Geolocation** powers a "near me" result set; **camera** upload attaches to a draft listing and
  survives an app backgrounding/refresh.
- Native storage persists auth/session and saved listings across app restarts and app updates.
- No white‑screen on cold start; splash → app transition is clean; back button behaves (Android).

### Metrics
- **Primary:** install → first‑contact conversion; push opt‑in rate; D1/D7 retention.
- **Guardrail:** crash‑free sessions ≥ 99%; app cold‑start time; store review rating.

### Store readiness (do not skip)
- Privacy policy + data‑safety declarations (contact data, location, camera, notifications).
- Play Store listing assets (icon, feature graphic, screenshots) and iOS App Store equivalents.
- Account creation: Google Play Developer + Apple Developer program.

---

## 8. Cross‑cutting: verification & quality gates

Per project conventions, after non‑trivial changes:
1. **Review** — run `react-reviewer` (JSX), `code-reviewer` (general), and `security-reviewer` for
   any auth / user‑data / contact‑gate changes (mobile push tokens + location + camera = user data).
2. **Simplify** — strict no‑behavior‑change pass.
3. **Playwright** — run relevant `e2e/tests/*.spec.js`; keep web green throughout (Capacitor uses the same
   web build, so web tests remain the primary automated safety net pre‑RN).
4. **Manual device testing** — Capacitor‑specific behavior (push, camera, geo, safe‑area, back button)
   is verified on a real device; document steps where no automated coverage exists.

---

## 9. Risks & tradeoffs

- **WebView performance ceiling.** Capacitor is web‑in‑a‑shell; very heavy map/image scrolling may
  feel less fluid than native. *Mitigation:* Phase‑1 perf work; virtualize long lists; if this becomes
  the competitive gap, that is the trigger for Phase 3 (RN) — but only then.
- **localStorage eviction in WebViews.** *Mitigation:* move to `@capacitor/preferences`.
- **Backend is the real long pole.** Native features are hollow without it. *Mitigation:* start Phase 0
  early; it also unblocks the whole product, not just mobile.
- **Store review friction (esp. iOS).** Permissions (location, camera, push) need clear justification
  and privacy disclosures. *Mitigation:* request permissions in‑context, not upfront; ship the privacy
  policy first.
- **Scope creep into RN too early.** *Mitigation:* this doc explicitly fences RN to Phase 3 with a
  defined trigger (native feel = proven differentiator + backend live + validated demand).

---

## 10. Sequencing summary

```
Phase 0 (Backend + real auth)  ──┐  (gating for native features)
                                 │
Phase 1 (PWA hardening)  ────────┼──▶  fast, installable, offline web  (backend‑agnostic)
                                 │
Phase 2 (Capacitor)  ────────────┘──▶  Android/iOS store apps + push/geo/camera
                                        (reuses Phase‑1 build; needs Phase 0 for native features)

Phase 3 (React Native)  ──▶  FUTURE / OUT OF SCOPE — only if native feel becomes the differentiator.
                             Admin/ops stays web permanently. Reuses src/services + src/lib.
```

**Recommended start:** kick off **Phase 0** and **Phase 1** in parallel, then **Phase 2**. The service
layer (`VITE_API_MODE`) is the seam that makes this safe and reversible.

---

## 11. What can be reused — quick reference

| Asset | PWA (Ph1) | Capacitor (Ph2) | React Native (Ph3) |
|---|---|---|---|
| `src/services/**` (data layer) | ✅ as‑is | ✅ as‑is | ✅ as‑is |
| `src/lib/**` (business logic) | ✅ as‑is | ✅ as‑is | ✅ as‑is |
| `src/components/**`, `src/pages/**` (JSX) | ✅ as‑is | ✅ as‑is | ❌ rebuild UI |
| Tailwind styling | ✅ | ✅ | ➖ via NativeWind |
| Leaflet maps | ✅ | ✅ | ❌ react‑native‑maps |
| Chart.js | ✅ | ✅ | ❌ victory‑native |
| Routing (React Router) | ✅ | ✅ (verify origin) | ❌ react‑navigation |
| Persistence | localStorage / SW cache | ➖ move to Preferences | ➖ AsyncStorage/MMKV |

---

## 12. Architecture decision — one repo, not a separate mobile app

**Decision: Phase 1 and Phase 2 live in THIS `draazy-react` repo. Do not fork a separate mobile
application.** The web app *is* the mobile app; `/android` and `/ios` are generated build output.

### Why one codebase
- **Capacitor consumes the web build, not a separate app.** The flow is literally:
  `npm run build → dist/ → npx cap sync → Android/iOS shell`. The native projects (`/android`,
  `/ios`) are **output folders** that wrap `dist/`, not a parallel app you maintain.
- **Phase 1 (PWA)** = config + code *inside* this repo (`vite-plugin-pwa`, React Query, code
  splitting). Pure web changes.
- **Phase 2 (Capacitor)** = add `@capacitor/*` deps + `capacitor.config.ts` + generated
  `/android`,`/ios` folders — all in this same repo. Same components, same `src/services`, same
  `src/lib`, same tests. One source of truth.

### Why a fork would be a mistake (anti‑pattern)
A separate mobile React app means **two copies** of every screen, service, and business rule that
immediately drift apart. In real estate that is fatal: the listing model, contact‑gate logic, RERA
validation, and pricing rules would fork — and trust bugs (leaked contact, stale listings) would
appear in one app but not the other. You'd double the review/test surface for **zero** benefit,
because Capacitor already produces native apps from the web code.

### How to handle real web↔native differences: platform seams (not forks)
Don't fork the repo — fork **small seams** where behavior genuinely differs, using the **same
dependency‑inversion pattern already in `src/services/config.js`** (`mock` vs `http`):
- **Persistence** — `persist.js` chooses localStorage (web) vs `@capacitor/preferences` (native) at
  runtime via `Capacitor.isNativePlatform()`. One interface, two implementations.
- **Native features** (push/camera/geo) — thin wrapper modules that **no‑op or degrade gracefully on
  plain web**, so the web bundle never breaks.
- **Build** — one Vite config; Capacitor just points `webDir` at `dist`.

A separate codebase is only justified at **Phase 3 (React Native)**, and even then logic is **not**
forked — a `packages/mobile` (monorepo) would *import* the shared `src/services` + `src/lib` and only
re‑implement the **UI** natively.

| Question | Answer |
|---|---|
| Phase 1 + 2 in this repo? | **Yes — same repo, same build.** |
| Separate mobile app? | **No** — not until Phase 3, and even then only the UI layer. |
| Handle web/native differences? | **Runtime platform seams** inside shared code (like `mock`/`http`). |
| Structure? | Web app *is* the mobile app; `/android` + `/ios` are generated output. |

**Mental model:** you are not building a mobile app *alongside* the web app — you are **shipping the
web app as a mobile app.** One codebase, multiple targets.

---

## 13. Web‑safety contract — will this break the web app?

**No — done correctly, the web app's flows/UI/screens keep working exactly as today.** Both phases are
**additive**, not rewrites. This section is the guardrail that makes that true *by construction*.

### Risk by change
| Change | Breaks web? | Containment |
|---|---|---|
| `vite-plugin-pwa` (service worker) | ⚠️ **Only real risk** | SW caching can serve a **stale version** after deploy. Fix with Workbox auto‑update + `skipWaiting` + cache versioning. Well‑understood, config‑level. |
| React Query over services | No | Wraps existing Promise services; adopt page‑by‑page. |
| Route code splitting (`React.lazy`) | No | Same screens, lazy‑loaded; needs a `Suspense` fallback. |
| Image lazy‑load, safe‑area CSS | No | Purely additive. |
| **All Capacitor code** (`/android`,`/ios`,`capacitor.config.ts`, plugins) | No | Lives in folders the **web deploy never ships**; web bundle never loads it. |
| Platform seams (persistence, native wrappers) | No | **Web is the default path**; native is the `if (isNativePlatform)` exception. |

### The two rules that keep web safe
1. **Web is the default branch of every seam.** Native is the exception. If a platform check is
   wrong, web still falls through to today's behavior:
   ```js
   if (Capacitor.isNativePlatform()) {
     // native — only runs inside the app shell
   } else {
     // existing web path — behaves EXACTLY as today
   }
   ```
2. **Never modify a shared component's existing behavior — only add.** No touching flows, screens,
   routes, or listing/contact‑gate logic. If a change isn't inside a platform seam or a new file and
   it alters existing behavior, it doesn't belong in the mobile work.

### How we prove web didn't break
- **Playwright (`e2e/tests/*.spec.js`)** runs against the web build and must stay green through every
  change. Capacitor uses that same build, so green web tests = safe app shell.
- **Reviewers** — `react-reviewer` (JSX), `security-reviewer` for the contact‑gate/persistence seams
  (push tokens + location + camera = user data).

**Biggest actual risk:** service‑worker stale cache (Phase 1) — standard, contained, config‑level.
Everything else is additive or native‑only.

---

## 14. Timing & sequencing — when to start, tied to YOUR milestones

Your two anchors: **(1) mobile UI screens are still being reworked after review; (2) backend comes
after UI freeze.** That dictates the order. **Do not start Capacitor packaging yet.**

### Dependency logic
- **Phase 2's valuable part (push/camera/geo) depends on the backend** — it can't finish before the
  backend exists.
- **Phase 1 (PWA) is backend‑agnostic but sits on top of your UI** — doing it before UI freeze means
  re‑testing caching/splitting after every screen change (building on shifting sand).
- **You're actively changing mobile UI now** — layering mobile infrastructure onto soon‑to‑change
  screens is wasted rework.

**Conclusion: finish UI work first. Mobile packaging is a follow‑on, not a parallel track** — with one
cheap exception (mobile‑ready design during the rework you're already doing).

### Timeline against milestones
| Milestone | Mobile action | Why |
|---|---|---|
| **Now → UI review & screen rework** | **No packaging.** Just design mobile‑responsive: 360–430px widths, ≥44px tap targets, sticky primary CTA, safe‑area spacing. Keep data in service/lib seams, not hardcoded in components. | This *is* the mobile prep; getting responsive UI right now means Phase 1/2 add almost nothing later. |
| **UI freeze** ✅ | **Start Phase 1 (PWA hardening).** | Screens stable → caching/splitting/perf work won't be invalidated. |
| **Backend build (overlaps)** | Continue Phase 1; begin **Phase 0 `http` providers** + real auth. | Phase 1 needs no backend; wiring `VITE_API_MODE=http` overlaps naturally. |
| **Backend live** ✅ | **Start Phase 2 (Capacitor)** + native features (push/camera/geo). | These finally have a real API to talk to. |

### Visual sequence
```
Now ──────────────▶ UI FREEZE ──────────▶ BACKEND LIVE ──────────▶
   │                    │                       │
   ▼                    ▼                       ▼
Rework mobile UI    Phase 1 (PWA)          Phase 2 (Capacitor)
(responsive design) + start Phase 0 http    + push / camera / geo
                      providers
```

### Do during UI rework (cheap, high‑leverage — not "starting mobile work")
- [ ] Responsive at phone widths (360–430px); safe‑area‑friendly spacing.
- [ ] Thumb‑reachable, sticky primary CTA (contact / schedule visit / save) above the fold.
- [ ] Tap targets ≥44px.
- [ ] Keep new UI inside existing service/lib seams (no hardcoded data) so later `mock→http` and
      native swaps stay zero‑friction.

**Direct answer:** *Start Phase 1 the moment the UI is frozen. Start Phase 2 the moment the backend is
live.* Until then, the only mobile work is designing screens responsively — which you're doing anyway.

---

*Deferred / explicitly out of scope for this plan (record, don't silently build): React Native
consumer app, native‑only redesigns, and any admin/ops native packaging (admin stays web).*
