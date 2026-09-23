# PuneNest architecture & conventions

Detailed reference for the PuneNest prototype. Read the section relevant to your task.

## 1. Auth model & role guards (`auth.js`)

- Current user is stored in `localStorage` key `puneNestUser`:
  `{ name, mobile, role, team?, loginAt }`.
- Roles:
  - Consumer: `buyer`, `owner`.
  - Internal: `admin`, and `staff` (with a `team`: `rental | legal | interior | packers | valuation`).
- Helpers added to `auth.js`: `isAdmin()`, `isStaff()`, `team()`, `staffLogin(...)`, `requireRole(...)`.
- Page guard lists: `ADMIN_PAGES` (require `admin`) and `OPS_PAGES` (require `staff` or `admin`).
- **Guards run synchronously inside `<head>`** so unauthorized users are redirected to
  `staff-login.html?next=<page>` before render. Never move guard logic below async code or `DOMContentLoaded`.

## 2. Dropdown system (`dropdowns.css`, `dropdowns.js`)

Why it exists: the homepage uses custom button menus, but other pages used raw OS-styled native
`<select>`s, which looked dated. The system fixes both.

- **Native select restyle (CSS):** `dropdowns.css` restyles every native `<select>` (plus `.pn-select`)
  to match the theme. It uses **targeted `!important`** on `appearance`, the chevron `background-image`,
  `padding-right`, and the focus ring to beat Tailwind utility specificity. Colors/borders are graceful
  fallbacks. The homepage has no `<select>`, so it is unaffected.
- **`dropdowns.css` must be linked before `</head>`** on every page that has selects (already done on the
  consumer + back-office pages).
- **Custom component:** `.pn-dropdown` is a fully custom, themeable dropdown built/managed by `dropdowns.js`.
- **In-place enhancer (high-value selects):** add `data-pn-enhance` to a native `<select>` to upgrade it
  while keeping the native element as the source of truth:
  - Hides the native select, builds a `.pn-dropdown` mirroring its options (supports `<optgroup>`).
  - Syncs selection back to the native select and dispatches a native `change` event, so existing JS
    listeners keep working unchanged.
  - Auto-searchable when the select has `data-search` or ≥ 8 options.
  - A `MutationObserver` rebuilds the menu when options are populated by JS.
  - Width is `auto` unless the select has the `w-full` class.
  - Currently enhanced: listings sort, list-property locality (searchable), property-valuation `#vLocality`
    (searchable). **`#nearPoint` on `listings.html` is deliberately NOT enhanced** — it is cloned into the
    mobile filter panel and referenced by several JS sites.
- **Stacking-context / portal fix (important):** an ancestor with a CSS animation (e.g. `.fade-up`) creates
  a stacking context that traps an absolutely-positioned menu under cards/nav. Fix: when opening, the
  `.pn-dropdown` **portals its `.pn-dropdown__menu` to `document.body`** with `position: fixed`, re-anchors
  on scroll/resize, and flips up near the viewport edge. The outside-click handler checks **both** the root
  and the portaled menu. Classes: `.pn-dropdown__menu--portal`, `.is-portal-open`.
  - When testing a portaled menu, option selectors must be **global**
    (`.pn-dropdown__menu .pn-dropdown__option`), not scoped under `.pn-dropdown` (the menu is no longer a
    descendant once portaled).

## 3. Back-office data layer (`admin-data.js`)

- Single `localStorage` blob under key **`puneNestAdminDB_v4`**. Bump the version suffix to force a reseed
  after changing seed data.
- `load()` auto-seeds on first use (deterministic RNG, seed `20260618`, for stable charts) and calls
  `mergeRealListings()` which scans `puneNestListings:*` keys and adds real consumer listings to the
  pending verification queue (tagged `real: true`).
- Exposes `load()`, `save()`, `reset()` so pages can manipulate the db directly (e.g. `admin-content.html`
  edits FAQs/banners this way).
- Analytics generators: `trafficSeries`, `revenueSeries`, `kpis`, `funnel`, `listingsByLocality`,
  `dealStatus`, `serviceVolumes`.
- CRUD: `setListingStatus`, `toggleFeatured`, `updateUser`, `addStaff`, `updateTicket`, `updateSettings`,
  `setFlag`, etc. `TEAMS` and `TEAM_LABEL` are exported.
- **All persisted back-office state must go through `AdminData.*`** — never invent ad-hoc localStorage keys.

## 4. Back-office UI (`admin-components.js`, `admin.css`)

- `injectAdmin({ active, title, subtitle })` builds the role-aware **sidebar** (`ADMIN_NAV` vs `OPS_NAV`)
  and **topbar**, then highlights the `active` item.
- `AdminUI` helpers: `esc`, `fmtINR`, `fmtNum`, `badge`, `toast`, `modal`, `confirm`, `wireTabs`,
  chart wrappers `line` / `bar` / `doughnut`, `applyDefaults`, `palette`. There is a STATUS → badge map.
- `admin.css` shell classes: `.admin-sidebar`, `.admin-main`, `.admin-topbar`, `.admin-content`.
  Components: `.a-card`, `.a-stat`, `.a-table`, `.a-badge`, `.a-btn`, `.a-tabs`, `.a-switch`, `.a-modal`,
  `.a-toast`. Mobile sidebar toggles via `body.nav-open`.

### Back-office page skeleton (follow this exactly)

```html
<!-- <head>: guard runs synchronously via auth.js; link admin.css (+ dropdowns.css) -->
<body>
  <aside id="aSidebar"></aside>
  <div id="aBackdrop"></div>
  <div class="admin-main">
    <header id="aTopbar"></header>
    <main class="admin-content"><!-- page content --></main>
  </div>

  <!-- script order matters -->
  <script src="auth.js"></script>
  <script src="admin-data.js"></script>
  <script src="admin-components.js"></script>
  <!-- chart.js CDN and/or dropdowns.js as needed -->
  <script>
    injectAdmin({ active: 'dashboard', title: '...', subtitle: '...' });
    // page logic using AdminData.* and AdminUI.*
  </script>
</body>
```

### Chart.js usage & gotcha

- Chart.js `4.4.1` via CDN, wrapped by `AdminUI.line/bar/doughnut`.
- Gotcha (fixed, don't reintroduce): passing `ticks.callback: undefined` **overrides** Chart's default
  category-label formatter and makes horizontal bar charts show indices instead of labels. Only set
  `ticks.callback` when you actually have a formatter.

## 5. Verification harness (Playwright)

- Approach: start a Node static HTTP server for the project dir, then drive Playwright Chromium headless:
  `chromium.launch({ channel: 'chrome', headless: true })`.
- Seed a logged-in user with `page.addInitScript(...)` that sets `localStorage` key `puneNestUser` before
  navigation (needed to pass guards on admin/ops pages).
- Collect `console` + `pageerror`; **assert zero errors** after filtering an IGNORE regex for favicon,
  CDN (tailwind/chart.js), leaflet, and generic network noise.
- `playwright-core` lives in the project `node_modules`; if needed set
  `$env:NODE_PATH = "<project>\node_modules"`.
- For screenshot scripts use `waitUntil: 'domcontentloaded'` to avoid CDN `load` timeouts.
- PowerShell has no `&&`/`||`; chain with `;`.
- Put temp test scripts/screenshots in the **session files dir**, not the repo, and delete them when done.

## 6. UI / trust conventions

- "PuneNest Assured" / owner-verified trust UI is a deliberate acquisition lever: hero trust strip and
  "No Spam Calls" pillar on the homepage, per-card verified badges on listings, an assured panel + owner
  verified meta on property pages, bold verified chips on the owner page.
- Note: the listings-page full-width "Every listing is owner-verified" banner was intentionally **removed**
  (per-card badges are kept). Don't add it back.
- `components.js` footer includes a "Staff & Admin" link to `staff-login.html`.
