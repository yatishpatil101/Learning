## Workflow Orchestration

### Attachments (screenshots are primary input)
When an image is attached:
- **Inspect it before answering or editing.** Never ask the user to re-describe it; never infer its content from the message text.
- It is the **source of truth** for current state — if it contradicts the code, the code is wrong. Say so.
- Read the whole frame: the broken element plus surrounding spacing, alignment, overflow, and any visible viewport width, console error, terminal output, or DevTools panel.
- State what you see and what you're changing because of it, so a misread surfaces immediately.
- Workspace image file → `view_image`, not `read_file`. Referenced but missing → say so and stop.

### Skill Routing (load on demand)
Default: **read no skill file** — answering, explaining, and mechanical edits need none. Max **two** per turn; if two apply, pick the primary deliverable's.

| Trigger | Read |
|---|---|
| Frontend code, project conventions, file map, mock data, auth guards, Playwright harness | `punenest-frontend` |
| Backend code, API contracts, data model, Flyway, JWT/roles | `punenest-backend` |
| Designing listing/search/filter/map/wizard/contact-gate/alert **behaviour** (not just editing markup) | `real-estate-expert` |
| Scope, priority, tradeoffs, success metrics for a new feature | `senior-product-manager-realestate` |
| New UI surface or visual redesign | `ui-ux-pro-max`, then `frontend-design` |
| Render/data/bundle performance (incl. during review) | `react-performance` |
| A skill named by the user | that skill |

**Simplicity rule (inlined — don't read `ponytail` for this).** Prefer no change > existing code > stdlib/native > one-line addition > new dependency > new abstraction. Ship the shortest diff that fully solves it. Read `ponytail` only when invoked by name or asked for an over-engineering audit.

Conflicts: `punenest-*` wins on implementation, `real-estate-expert` on domain, `senior-product-manager-realestate` on scope — note it in your summary. Skills live in `~/.copilot/skills/`; a missing local `skills/` folder means nothing. UI design-consistency rules auto-apply from `.github/instructions/ui-design-consistency.instructions.md`.

**Archived skills** (other languages/frameworks, Office/PDF/image gen) sit in `~/.copilot/skills-archive/` so they don't load every turn. Still usable — read `~/.copilot/skills-archive/<name>/SKILL.md` by absolute path when named, or move the folder back to re-activate. In neither place → report it.

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
- **Planning** — plan mode for features/architectural changes with real tradeoffs; specs upfront. If it goes sideways, STOP and re-plan; if one full re-plan (approach rewritten from scratch) fails, report the specific obstacle.
- **Bug fixing** — just fix it. Point at logs/errors/failing tests and resolve without hand-holding.
- **Elegance** — for non-trivial changes ask "is there a more elegant way?" and challenge your own work. Skip for obvious fixes.
- **Subagents** — spawn when >~150 new lines, >3 files, or independent parallel workstreams AND no single targeted fix solves it; otherwise prefer the targeted fix (bug fixes included). One responsibility each; if one fails or returns unusable output, stop and report.
- **Self-improvement** — after any user correction, record the pattern in `tasks/lessons.md` and read it at session start. If a lesson conflicts with this file, this file wins (note it).

## Task Management
Plan to `tasks/todo.md` as checkable items → mark complete as you go → summarize each step → capture lessons in `tasks/lessons.md`. Create either file with a header if missing.

## Core Principles
**Simplicity first** (simplest change that fully solves it) · **No laziness** (fix root causes, no temporary hacks) · **Minimal impact** (touch only what's necessary).

## Context Cost Rules

### Query the graph before searching
`frontend/src/graphify-out/` holds a knowledge graph of `frontend/src` (3,697 nodes, graphify 0.9.32). To locate code from a symptom, screenshot, or concept rather than a known filename, **query it first** — right files with line numbers for ~600 tokens vs ~40k for semantic search plus file reads. Fall back to `grep_search`/`semantic_search` only if a query returns nothing useful.

Run from repo root; the CLI isn't on PATH, and every read command needs `--graph` (the graph lives under `frontend/src`):
```powershell
python -m graphify query "mobile bottom navigation bar" --graph frontend/src/graphify-out/graph.json --budget 700python -m graphify path "BottomNav" "AuthContext" --graph frontend/src/graphify-out/graph.json
python -m graphify explain "ConsumerLayout" --graph frontend/src/graphify-out/graph.json
```

**Keep it current** — a stale graph points at moved files. Re-indexing costs no LLM tokens and is idempotent. Run the watcher in a background terminal, or `update` after a change (Post-Change Verification step 5):
```powershell
python -m graphify watch frontend/src
python -m graphify update frontend/src --force
```

`graphify-out/` is git-ignored at any depth (generated, ~11 MB); a from-scratch rebuild is ~40s and free, so never commit it. `graph.json` paths are repo-root-relative, so it survives moving the repo. **Never use `graphify extract`** — it loses the relative paths and named communities and drops ~300 nodes; `update --force` is the only rebuild. `frontend/src/.graphifyignore` excludes 132 node-less `.json` files and the minified `societies-rera.js`. The `pre-#1504 node-ID` note on every query is cosmetic.

### Reading files
- Never read whole — `grep_search` for a symbol, then read a narrow line range:
  - `frontend/src/data/societies-rera.js` — 182 KB of minified data on 4 lines. Grep only.
  - `frontend/src/styles/index.css` — 7,309 lines. Use the section map below.
  - `e2e/COVERAGE.md` — 272-line matrix. Grep the feature's row; never read whole.
- `e2e` is deliberately **not** in the graph: specs reach the app via `page.goto()` strings, not imports, so there'd be no edges to traverse. Find a spec by filename (`Get-ChildItem e2e/tests -Recurse -Filter *bottom-nav*`) or a COVERAGE.md row.
- Don't read `e2e/helpers/app.js` (14.9 KB) for its API — grep all 41 helper exports instead:
  ```powershell
  Select-String -Path e2e/helpers/*.js,e2e/fixtures/*.js -Pattern '^export (?:async )?function (\w+)|^export const (\w+)\s*='
  ```
- Prefer `grep_search` over `semantic_search` when you know the identifier.
- Read a line range, not a whole file, for anything over ~400 lines.

### `index.css` section map
Jump to a range; never read top-to-bottom. Line numbers drift — re-grep the section comment (`/* ===`) if a range looks wrong.

| Line | Section | Line | Section |
|---|---|---|---|
| 7 | Design tokens (from `theme.css`) | 5595 | Service landing pages |
| 668 | Base | 6439 | Reduced motion |
| 684 | Devanagari typography (Hindi, Marathi) | 6577 | View Transitions |
| 1645 | Listings page | 6624 | `.pn-mdp` map detail drawer |
| 3526 | Property page | 7222 | Mobile space optimization (`<640px`) |
| 4250 | Owner page | 7287 | Mobile bottom chrome |
| 4378 | List Property wizard | | |

### Shrinking `index.css`
Route CSS goes to `frontend/src/styles/routes/<route>.css`, pulled in by **JS import from the route component** (e.g. [frontend/src/pages/consumer/Reels.jsx](frontend/src/pages/consumer/Reels.jsx#L5)) so Vite bundles it into that chunk. Seven routes do this; leave a `/* → moved to styles/routes/<name>.css */` breadcrumb.
- Only move blocks scoped to one route (Listings / Property / Owner / List-Property / Services remain).
- **Never move** design tokens, Base, `@tailwind` directives, the `@layer components` block, Devanagari typography, Reduced motion, View Transitions, or the global mobile media queries — cascade-order sensitive.
- Never use CSS `@import`. [frontend/postcss.config.js](frontend/postcss.config.js) has no `postcss-import`; the JS import is what makes this safe.
- After each extraction run `npm run build` plus that route's `e2e/*.spec.js`.

## Code Review
**user-data changes** = code that reads/writes/transmits/displays PII, credentials, session tokens, contact-gate logic, or per-user data.

After changes run reviewers in order: `react-reviewer` (`.jsx`/React) → `code-reviewer` (general) → `security-reviewer` (auth or user-data changes). If an agent is unavailable, review manually, note it in `tasks/todo.md`, and mark the step PENDING AGENT REVIEW.

## Post-Change Verification (in order)
1. **Review** — run the agents above; apply the staff-engineer self-check and diff behavior vs. main when relevant.
2. **Simplify** — `/simplify` (or `code-simplifier`) as a STRICT no-behavior-change pass; skip anything not provably equivalent. If unavailable, note the skip in `tasks/todo.md`.
3. **Playwright** — run the relevant `e2e/*.spec.js` (full suite if cross-cutting). Not complete until they pass; fix root causes, not tests. Flag any failure not already in `tasks/todo.md` as potentially pre-existing before proceeding; record confirmed ones there and don't count them against the task.
4. **Update specs** — every completed feature or behaviour change ships with a new or updated `e2e/*.spec.js` plus an `e2e/COVERAGE.md` entry.
5. **Re-index the graph** — if a file under `frontend/src` was added, renamed, or deleted, run `python -m graphify update frontend/src --force`. Skip if the watcher is running or only contents changed.
6. **No coverage** — document the gap in `tasks/todo.md`, add a stub spec or manual steps, and mark PENDING VERIFICATION.