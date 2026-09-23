---
name: draazy-frontend
description: >-
    Project skill for the Draazy (formerly PuneNest) FRONTEND — a React + Vite + Tailwind app
    (Pune-first
    real-estate marketplace competing in India with NoBroker / MagicBricks). Use whenever working on the
    frontend: the consumer site, the admin & ops back-office, the shared UI system (dropdowns, trust UI,
    Tailwind theme), the services data seam (mock ↔ http providers), auth/role guards, styling
    (`styles/index.css` tiers), or the Playwright e2e harness. Encodes the project's conventions, file
    map, and known gotchas so changes stay consistent and verified. Backend counterpart: draazy-backend.
user-invocable: true
---

# PuneNest / Draazy frontend

PuneNest (rebrand in progress → **Draazy**) is a Pune-first real-estate marketplace. The frontend is a
**React + Vite + Tailwind** single-page app (Tailwind compiled at build time, not CDN). It reaches data
through a **service seam** (`src/services/*Service.js`) that resolves either to a `localStorage` **mock**
provider or to a **live REST API** (Spring Boot backend in `backend/`), chosen **per domain**. The goal
is to compete in India against NoBroker/MagicBricks with a supply-first, "dominate Pune then clone"
strategy. See `BUSINESS_PLAN.md` in the project root for the strategy.

This skill is versioned in this repo at `.agents/skills/draazy-frontend/`; all paths below are
relative to the repo root (Windows, PowerShell). Frontend lives in `frontend/`; the backend is in `backend/` (see the
`draazy-backend` skill); Playwright e2e is in `e2e/`.

## When to use this skill

Use it for any PuneNest frontend work, including:
- Editing consumer pages (`pages/consumer/*` — listings, property, owner, services, calculators,
  flatmates, reels, dashboard, saved, messages, notifications, auth).
- Editing the **admin / ops back-office** (`pages/admin/*`, `pages/ops/*`).
- Touching shared systems: the `services/` data seam, `context/AuthContext.jsx`, the `components/ui/*`
  primitives (dropdown, dual-range, date/time fields), the brand mark (`components/brand/LogoMark.jsx`).
- UI/design changes (theme, dropdowns, trust badges) and styling via the tiered `styles/index.css`.
- Verifying changes with the Playwright e2e harness in `e2e/`.

## Golden rules

1. **Respect the data seam — never reach past it from a page.** Pages, components and hooks import from
   `src/services/<domain>Service.js` only. They must **never** import `src/lib/store*` or
   `src/lib/properties-admin.js` for anything that has a backend endpoint. `services/config.js` resolves
   each domain to its `providers/http/<domain>Provider.js`; there is one data source, the live API.
   See `docs/system/frontend-data-seam.md`.
2. **Match the existing theme.** Don't introduce a new design language — reuse the Tailwind theme and the
   patterns already in the codebase (`docs/system/design-system.md`). New UI must not look out of place.
3. **Use the shared UI primitives, don't reinvent.** Selects, dual-range sliders, date/time fields and the
   themeable dropdown live in `components/ui/*` and are styled via Tier 0 `styles/components/*.css`. Reuse
   them instead of building new widgets.
4. **Preserve auth/role guards.** `context/AuthContext.jsx` owns auth state and role gating (roles
   `buyer` / `owner` / `admin` / `staff`); routes are guarded per area (consumer / admin / ops). These are
   **client-side UX gates** — real enforcement is server-side in the backend. Don't weaken or bypass them.
5. **Style through the `index.css` tier system.** New CSS goes in the lowest correct tier (route file,
   shared component file, or `index.css`) — see the `index.css` section below. A misfiled global silently
   unstyles other routes and no test catches it.
6. **Always verify with Playwright.** After non-trivial UI/JS changes, run the relevant `e2e/*.spec.js`,
   assert **zero console errors**, and add/update a spec + an `e2e/COVERAGE.md` row. A change isn't done
   until it's green.
7. **PowerShell only** (Windows): no `&&`/`||`; chain with `;` and gate with `if ($?) { ... }`. Use
   Windows backslash paths. Never use `Set-Content` / `>` / `-replace` on source files (writes BOM /
   mojibake) — use the editor's replace tool.

## File map (high level)

Under `frontend/src/`:

- **Entry**: `main.jsx` (imports `styles/index.css` then Tier 0 `styles/components/*.css`), `App.jsx`
  (router + layout shells).
- **`pages/`**: `consumer/` (public + account pages), `admin/` (admin back-office), `ops/` (ops
  back-office), `Stub.jsx`.
- **`components/`**: `ui/` (shared primitives — dropdown, dual-range, date/time fields, inputs),
  `dashboard/`, `brand/` (`LogoMark.jsx` — the Draazy mark), plus layout shells and feature components.
- **`context/`**: `AuthContext.jsx` (auth + role guards).
- **`services/`**: the seam — `<domain>Service.js` (stable public API: auth, property, contact,
  conversation, deal, flatmate, notification, plan, rent, report, review, savedSearch, saved,
  serviceRequest, support, verification, visit), `config.js` (per-domain mock/http switch), `http.js`
  (attaches the bearer token), `providers/mock/` and `providers/http/`.
- **`lib/`**: `mockApi*` (the localStorage mock backend) and data helpers — behind the seam only.
- **`data/`**: seed/reference data. `societies-rera.js` is 182 KB minified on 4 lines — **grep only**,
  never read whole.
- **`i18n/`**: locale JSON. **`content/`**: static content. **`styles/`**: `index.css` (tiered — see
  below), `components/*.css` (Tier 0 shared), `routes/*.css` (Tier 1 per-route).
- **Verification (outside `frontend/`)**: `e2e/` — Playwright specs, `e2e/COVERAGE.md` (feature matrix),
  `e2e/helpers/app.js` (grep its exports, don't read whole).

## Working procedure

1. Read the relevant file(s) before editing; reuse existing patterns, primitives and class names.
2. For data changes, go through `services/<domain>Service.js` — never reach past the seam.
3. Make surgical edits. Don't touch unrelated code or restyle pages that already match.
4. Style via the correct `index.css` tier (below); run `npm run build` after CSS extraction.
5. Verify with the relevant `e2e/*.spec.js` (zero console errors) and update `e2e/COVERAGE.md`.

## References (read when relevant)

- `docs/system/frontend-data-seam.md` — the seam rule, provider layout and wire contracts (authoritative).
- `docs/system/design-system.md` — the visual system / theme tokens.
- `docs/system/data-model.md`, `docs/system/api-standards.md` — the shapes the `http` providers target.
- The `index.css` section below — styling tiers, section map, and extraction gotchas.
- [references/architecture.md](./references/architecture.md), [references/react-conversion.md](./references/react-conversion.md) — **historical**: these describe the
  original static-HTML prototype and the plan for converting it to React. That conversion is **complete**;
  treat them as archive, not current guidance.

## `frontend/src/styles/index.css` — map, tier rules, extraction gotchas

Read this section only when touching `frontend/src/styles/index.css` (~3,570 lines). Never read the file
top-to-bottom — jump to a range, or grep a class across `src/` first.

### Section map

Regenerate rather than trust these numbers — they drift on every extraction:

```powershell
Select-String -Path frontend/src/styles/index.css -Pattern '^\s*/\*\s*====' -Context 0,1 |
  ForEach-Object { "{0,6}  {1}" -f $_.LineNumber, $_.Context.PostContext[0].Trim() }
```

| Line | Section | Line | Section |
|---|---|---|---|
| 7 | Design tokens (from `theme.css`) | 2728 | Service landing pages (grab-bag — see below) |
| 636 | Base | 3258 | Reduced motion |
| 652 | Global polish layer (mislabeled "Devanagari") | 3368 | View Transitions |
| 1457 | Listings page (grab-bag — see below) | 3443 | Mobile space optimization (`<640px`) |
| 2037 | Property page | 3492 | Mobile bottom chrome |
| 2635 | Owner page |  |  |

**Headings are provenance labels, not ownership boundaries** — they record which prototype HTML file the block came from, so a section's name does not mean its rules are scoped to that route. Two traps this has already set:
- "Devanagari typography" (652) is ~805 lines of which ~100 are Devanagari. The rest is the global polish layer: radius hierarchy, tabular figures, tinted shadows, press feedback, scrollbar policy, hero/scroll-reveal/card-zoom animations.
- Global surfaces still sit under route headings — `.icon-btn` under "Property page", `.prop-row` under "Owner page". Grep the class across `src/` before assuming a section owns it.
- "Service landing pages" (2728) is a **grab-bag**: after extractions it still mixes `.svc` (landing pages) with unrelated page groups (`.soc-page`) *and* genuinely global rules. The `.emi-page`/`.num-field` block was extracted to Tier 1 `routes/emi.css` (lazy `EmiCalculator.jsx` => own chunk). `.svc`/`.faq-*`/`.svc-quote` stay global — used across 7 service files with no single shared import module, so moving them risks unstyling routes for little gain. `.ba*` (before/after slider) stays global — shared across Interior/Valuation/RentAgreement routes — `.gm-style` (Google Maps InfoWindow chrome, used by every map), `.map-pin`, and `.pn-input`/`.pn-card`/`.pn-modal-panel` (shared surfaces). These globals must **stay** in `index.css`. `.sf-modal` also stays global — it is used from `dashboard/MyListingsPanel` and `list-property/PostSuccessSplitNudge`, not just flatmates.
- "Listings page" (1457) is **also a grab-bag**, not single-route `.listings-*` — barely any `.listings-` prefix exists. The genuinely listings-only sub-blocks have now been extracted to Tier 1 `routes/listings.css` (`.card-hover:hover*`/`.heart-btn`, `.rng*` via `DualRange`, `.custom-cb`/`.custom-radio`, `.toggle-ui`/`.toggle-cb`, `.view-btn`, `.fg-*`, `.filter-fab*`, `.page-btn`, `.badge-*`). **Two classes in that block turned out to be shared and were kept global** (grep caught them only on a full-`src/` re-check, not the first dir-scoped grep): `.filter-overlay`/`.filter-panel` (+`.open`) are used by both listings `ResultsArea.jsx` and flatmates `FilterBar.jsx`; the base `.card-img { transition }` rule is used by property `SimilarProperties.jsx` (only the `.card-hover:hover .card-img` *hover* rule is listings-only). What else **stays** in `index.css` under this heading and must NOT move: the app-wide `.pn-dropdown` (already Tier 0 `components/dropdown.css`), the auth route (already Tier 1 `routes/auth.css`) wrapping the global `.otp-*` island, map globals (`.price-marker`, `#listingsMap`), the immovable `@layer components` native-`select` theming block (~323 lines), global `select option`, the global `.fade-up` scroll-reveal, the shared `.list-card` (admin `AdminPropertyCard.jsx` + consumer `Card.jsx`), multi-route `.skeleton`/`.list-reveal`, and the global `.t-all` utility (`transition: all` — 33 usages across FilterBar/Card/MapGate/etc; NOT dead, do not remove). Dead code deleted: `.bhk-pill`, `.deal-tab`, `.sort-dropdown`, `.near-select` (standalone rules removed) and `.badge-premium`/`.badge-new`/`.badge-furnished` (trimmed from the grouped `.badge-*` radius rule, leaving used `.badge-verified`/`.badge-rera`); `.bhk-pill` also trimmed from the `.search-tab`/`.loc-chip` pill-radius group.

**Formatting is compacted**: every single-declaration rule is a one-liner (`#listingsMap { z-index: 1; }`) — 222 rules were collapsed via a PostCSS AST pass (`root.walkRules`, collapse only `nodes.length === 1 && type === 'decl'`), which is why the file is ~3,566 not ~4,010. Multi-declaration rules stay expanded. **Gotcha if you re-run that pass**: PostCSS's stringifier escapes `<` inside comments to `\3c ` (it turned the `ported from x.html <style>` provenance comments into `\3c style>`); restore with `(...).Replace('\3c style>','<style>')` after writing. It preserves CRLF and adds no BOM, but write with `New-Object System.Text.UTF8Encoding($false)` to be safe.

### Shrinking `index.css`

Three tiers. Put a block in the lowest tier that is actually true of it — misfiling a global as route-scoped deletes it from every other route:

| Tier | Lives in | Loaded by | For |
|---|---|---|---|
| 0 | `styles/components/<name>.css` | JS import in [frontend/src/main.jsx](frontend/src/main.jsx#L20), **after** `index.css` | shared across routes (`buttons.css`, `surfaces.css`, `date-time-fields.css`, `dropdown.css`) |
| 1 | `styles/routes/<route>.css` | JS import in the route component (e.g. [frontend/src/pages/consumer/Reels.jsx](frontend/src/pages/consumer/Reels.jsx#L5)) | genuinely one route |
| 2 | `index.css` | [frontend/src/main.jsx](frontend/src/main.jsx#L20) | tokens, Base, cascade-order-sensitive |

Leave a `/* → moved to styles/<tier>/<name>.css */` breadcrumb. Done: 15 route files (`auth` incl. both `.auth-page` fragments wrapping the global `.otp-*` island, `compare`, `emi` (lazy `EmiCalculator.jsx`, `.emi-page`/`.num-field`), `flatmates` incl. `.sf-page`, `list-property`, `listings`, `locality`, `messages`, `property-map`, `property-map-detail`, `reels`, `rent-agreement`, `saved`, `services-hub`, `view-documents`) + Tier 0 `buttons` / `surfaces` / `date-time-fields` / `dropdown` (`.pn-dropdown`, ~468 lines, hoisted out of the "Listings" heading — used by six shared `components/ui/*` selects). Note: `auth.css` is imported eagerly from `AuthShell.jsx`, so its rules still land in the main `index-*.css` bundle — the win is the ~293-line reduction in the index.css **source** (the token-cost goal), not a separate chunk. `listings.css` (extracted from interleaved fragments, ~470 net lines out of index.css source) is imported from the **lazy** `pages/consumer/Listings.jsx`, so it *does* get its own `Listings-*.css` chunk — grep confirmed the moved selectors land there while the stay-behind globals (`.price-marker`, `#listingsMap`, `.skeleton`, `.list-card`, `.fade-up`, `.otp-box`, plus the shared `.filter-overlay`/`.filter-panel` and base `.card-img`) remain in `index-*.css`. Remaining candidates: Property (~620, 47% of its classes are shared — lowest value, highest risk; per-class only). The `.svc` / `.soc-page` / `.faq`-`.tile`-`.ba`-`.notif` groups under "Service landing pages" are small and interleaved with globals and mostly shared across routes — leave global (`.emi-page` already extracted; `.svc`/`.faq`/`.ba` checked and confirmed cross-route, kept global).

**Never move** design tokens, Base, `@tailwind` directives, the `@layer components` block, Reduced motion, View Transitions, or the global mobile media queries — cascade-order sensitive. Never use CSS `@import` ([frontend/postcss.config.js](frontend/postcss.config.js) has no `postcss-import`; the JS import is what makes this safe).

**Before extracting, prove the block is not shared** — no test catches a missing style, so a broken extraction ships green:
```powershell
Select-String -Path frontend/src/styles/index.css -Pattern '^\s*\.([a-z][\w-]+)' |   # classes in the block
  ForEach-Object { $_.Matches.Groups[1].Value } | Sort-Object -Unique                 # then grep each across src/
```
A class used outside the owning route's folder is Tier 0, not Tier 1. After each extraction run `npm run build` plus that route's `e2e/*.spec.js`.
