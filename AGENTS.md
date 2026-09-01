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

**Asking questions — always via the question tool, never by halting.** Put every question to the
user through `vscode_askQuestions` (options + a recommended default), not as prose that ends the
turn. Questions are non-blocking by default: ask, then **keep executing** whatever part of the work
the answer cannot invalidate — unblocked slices, research, backend groundwork. Only stop outright if
*every* remaining path depends on the answer, and say so explicitly. Never end a turn with a
prose question mark and no tool call; never idle waiting for a reply.

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
Prefer `grep_search` over `semantic_search` when you know the identifier; over ~400 lines, grep the symbol then read a narrow range — never whole. Worst offenders: `frontend/src/data/societies-rera.js` (182 KB minified on 4 lines — grep only), `frontend/src/styles/index.css` (~3,570 lines — grep a class, never read whole; its section map, tier rules, and extraction gotchas live in the `punenest-frontend` skill), `e2e/COVERAGE.md` (272-row matrix — grep the feature's row), `e2e/helpers/app.js` (grep its 41 exports instead of reading: `Select-String -Path e2e/helpers/*.js,e2e/fixtures/*.js -Pattern '^export (?:async )?function (\w+)|^export const (\w+)\s*='`). `e2e` is deliberately **not** in the graph — specs reach the app via `page.goto()` strings, not imports, so there are no edges; find one by filename (`Get-ChildItem e2e/tests -Recurse -Filter *bottom-nav*`) or a COVERAGE.md row.

## Post-Change Verification (in order)
**user-data change** = code that reads/writes/transmits/displays PII, credentials, session tokens, contact-gate logic, or per-user data.

1. **Review** — in order: `react-reviewer` (`.jsx`/React) → `code-reviewer` (general) → `security-reviewer` (auth or user-data only). Apply the staff-engineer self-check and diff behavior vs. main when relevant. Agent unavailable → review manually, note it in `tasks/todo.md`, mark PENDING AGENT REVIEW.
2. **Simplify** — `/simplify` (or `code-simplifier`), STRICT no-behavior-change; skip anything not provably equivalent. Unavailable → note the skip in `tasks/todo.md`.
3. **Playwright** — run the relevant `e2e/*.spec.js` (full suite if cross-cutting); not complete until green, and fix root causes, not tests. A failure not already in `tasks/todo.md` → flag as potentially pre-existing before proceeding; record confirmed ones there and don't count them against the task.
4. **Specs** — every completed feature or behaviour change ships a new or updated `e2e/*.spec.js` plus an `e2e/COVERAGE.md` entry. No coverage → document the gap in `tasks/todo.md`, add a stub spec or manual steps, mark PENDING VERIFICATION.
5. **Re-index the graph** — file added, renamed, or deleted under `backend/`, `frontend/src` or the migrations → `.\scripts\graphify.ps1 update`. Skip if only contents changed.