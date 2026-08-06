## Workflow Orchestration

### Attachments (screenshots are primary input)
An attached image is the **source of truth** — if it contradicts the code, the code is wrong; say so. Inspect it before answering or editing; never ask the user to re-describe it or infer it from the message text. Read the whole frame (element, spacing, alignment, overflow, viewport width, console/terminal/DevTools output) and state what you see and what you're changing because of it, so a misread surfaces immediately. Workspace image → `view_image`, not `read_file`; referenced but missing → say so and stop.

### Skill Routing (load on demand)
Default: **read no skill file** — answering, explaining, and mechanical edits need none. Otherwise: match a trigger → **max two per turn** (if more apply, take the one matching the user's explicit ask, i.e. the artifact they want produced; still tied → lower row) → note any conflict in your summary → if a skill isn't in `~/.copilot/skills/`, check the archive below before reporting it missing.

| Trigger | Read |
|---|---|
| Frontend code — conventions, file map, mock data, auth guards, Playwright harness | `punenest-frontend` |
| Backend code — Spring Boot 4.1 + PostgreSQL API conventions, system design, data model, Flyway, JWT/role guards, contact gate, provider seams, frontend `http` wiring | `punenest-backend` |
| Designing listing/search/filter/map/wizard/contact-gate/alert **behaviour** (not just editing markup); SEO for property pages | `real-estate-expert` |
| Scope, priority, tradeoffs, success metrics for a new feature | `senior-product-manager-realestate` |
| New UI surface or visual redesign — design system first, then visual direction; both carry the UI design-consistency rules | `ui-ux-pro-max`, then `frontend-design` |
| Render/data/bundle performance (incl. during review) | `react-performance` |
| A skill named by the user | that skill |

Conflicts: `punenest-*` wins on implementation, `real-estate-expert` on domain, `senior-product-manager-realestate` on scope. A missing local `skills/` folder means nothing. **Archived skills** (other languages/frameworks, Office/PDF/image gen) live in `~/.copilot/skills-archive/<name>/SKILL.md` so they don't load every turn — still usable by absolute path when named, or move the folder back to re-activate. In neither place → report it.

**Simplicity rule (inlined — don't read `ponytail` for this).** Prefer no change > existing code > stdlib/native > one-line addition > new dependency > new abstraction; ship the shortest diff that fully solves it. Read `ponytail` only when named or asked for an over-engineering audit.

### Rule Precedence
On conflict: (1) safety/correctness, (2) task-type routing, (3) planning/check-in, (4) elegance, (5) lessons capture.

**Check-in policy (single source of truth):**

| Situation | Action |
|-----------|--------|
| Bug fix / clearly scoped task | Proceed autonomously — no check-in, even across multiple files |
| New feature / architectural change | Plan first, verify with user before implementing |
| Ambiguous scope | Ask one clarifying question first |
| Spawning a subagent | Not a check-in — never pause, spawn silently |

### Execution
- **Planning** — plan mode for features/architectural changes with real tradeoffs; specs upfront. If it goes sideways, STOP and re-plan; if one full re-plan (approach rewritten from scratch) fails, report the specific obstacle. Bug fixes: just fix it from the logs/errors/failing tests, no hand-holding.
- **Elegance** — any change touching more than one function or adding an abstraction: ask whether something simpler works. Skip for single-line fixes and mechanical edits (renaming a variable, updating a constant).
- **Subagents** — spawn only when >150 new lines, >3 files, or independent parallel workstreams AND no single targeted fix solves it; otherwise prefer the targeted fix (bug fixes included). One responsibility each; on failure or unusable output, stop and report — never commit or apply partial output, record it in `tasks/todo.md` as PARTIAL with exactly what's done and what remains.
- **Lessons** — record every user correction in `tasks/lessons.md`; read it at session start. This file beats a conflicting lesson: quote both, then follow this file.
- **Tasks** — plan to `tasks/todo.md` as checkable items, tick them as you go, summarize each step. Create either file with a header if missing.
- **Principles** — simplest change that fully solves it · fix root causes, no temporary hacks · touch only what's necessary.

## Context Cost Rules

### Query the graph before searching
`graphify-out/` graphs `backend`, `frontend`, `e2e` and the Flyway migrations. To locate code from a symptom, screenshot, or concept rather than a known filename, **query it first** — right files with line numbers for ~600 tokens vs ~40k for semantic search plus reads. Fall back to `grep_search`/`semantic_search` only if a query returns nothing useful. Run from the repo root (the CLI isn't on PATH):

```powershell
.\scripts\graphify.ps1 query "mobile bottom navigation bar" --budget 700
.\scripts\graphify.ps1 path "BottomNav" "AuthContext"
.\scripts\graphify.ps1 explain "ConsumerLayout"
.\scripts\graphify.ps1 update      # adds/renames/deletes — incremental, free, idempotent
.\scripts\graphify.ps1 rebuild     # large refactors/deletions; the only full re-index
```

Stale if `git rev-parse HEAD` ≠ the commit in `graphify-out/GRAPH_REPORT.md` — `update` first, or it points at moved files. Never commit `graphify-out/` (git-ignored at any depth, multi-MB, regenerable); `graph.json` paths are repo-root-relative so it survives a repo move. **Never `graphify extract`** — it loses relative paths and named communities and drops ~300 nodes. `frontend/src/.graphifyignore` excludes 132 node-less `.json` files and the minified `societies-rera.js`. The `pre-#1504 node-ID` note is cosmetic.

### Reading files
Prefer `grep_search` over `semantic_search` when you know the identifier; over ~400 lines, grep the symbol then read a narrow range — never whole. Worst offenders: `frontend/src/data/societies-rera.js` (182 KB minified on 4 lines — grep only), `frontend/src/styles/index.css` (~3,570 lines — map below), `e2e/COVERAGE.md` (272-row matrix — grep the feature's row), `e2e/helpers/app.js` (grep its 41 exports instead of reading: `Select-String -Path e2e/helpers/*.js,e2e/fixtures/*.js -Pattern '^export (?:async )?function (\w+)|^export const (\w+)\s*='`). `e2e` is deliberately **not** in the graph — specs reach the app via `page.goto()` strings, not imports, so there are no edges; find one by filename (`Get-ChildItem e2e/tests -Recurse -Filter *bottom-nav*`) or a COVERAGE.md row.

### `index.css` section map
Jump to a range; never read top-to-bottom. Regenerate rather than trust these numbers — they drift on every extraction:

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

## Post-Change Verification (in order)
**user-data change** = code that reads/writes/transmits/displays PII, credentials, session tokens, contact-gate logic, or per-user data.

1. **Review** — in order: `react-reviewer` (`.jsx`/React) → `code-reviewer` (general) → `security-reviewer` (auth or user-data only). Apply the staff-engineer self-check and diff behavior vs. main when relevant. Agent unavailable → review manually, note it in `tasks/todo.md`, mark PENDING AGENT REVIEW.
2. **Simplify** — `/simplify` (or `code-simplifier`), STRICT no-behavior-change; skip anything not provably equivalent. Unavailable → note the skip in `tasks/todo.md`.
3. **Playwright** — run the relevant `e2e/*.spec.js` (full suite if cross-cutting); not complete until green, and fix root causes, not tests. A failure not already in `tasks/todo.md` → flag as potentially pre-existing before proceeding; record confirmed ones there and don't count them against the task.
4. **Specs** — every completed feature or behaviour change ships a new or updated `e2e/*.spec.js` plus an `e2e/COVERAGE.md` entry. No coverage → document the gap in `tasks/todo.md`, add a stub spec or manual steps, mark PENDING VERIFICATION.
5. **Re-index the graph** — file added, renamed, or deleted under `backend/`, `frontend/src` or the migrations → `.\scripts\graphify.ps1 update`. Skip if only contents changed.