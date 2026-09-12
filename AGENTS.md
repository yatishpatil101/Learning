## Workflow Orchestration

### Attachments (screenshots are primary input)
An attached image is the **source of truth** — if it contradicts the code, the code is wrong; say so. Inspect it before answering or editing (element, spacing, alignment, overflow, viewport width, console/terminal/DevTools output) and state what you see and what you're changing because of it. Never ask the user to re-describe it. Workspace image → `view_image`, not `read_file`; referenced but missing → say so and stop.

### Skill Routing (load on demand)
Default: **read no skill file** — answering, explaining, and mechanical edits need none. Otherwise match a trigger, **max two per turn** (more apply → take the one matching the artifact the user asked for; still tied → lower row), and note any conflict in your summary.

| Trigger | Read |
|---|---|
| Frontend code — conventions, file map, mock data, auth guards, Playwright harness | `draazy-frontend` |
| Backend code — Spring Boot 4.1 + PostgreSQL API conventions, system design, data model, Flyway, JWT/role guards, contact gate, provider seams, frontend `http` wiring | `draazy-backend` |
| Designing listing/search/filter/map/wizard/contact-gate/alert **behaviour** (not just editing markup); SEO for property pages | `real-estate-expert` |
| Scope, priority, tradeoffs, success metrics for a new feature | `senior-product-manager-realestate` |
| New UI surface or visual redesign — design system first, then visual direction; both carry the UI design-consistency rules | `ui-ux-pro-max`, then `frontend-design` |
| Render/data/bundle performance (incl. during review) | `react-performance` |
| A skill named by the user | that skill |

Conflicts: `draazy-*` wins on implementation, `real-estate-expert` on domain, `senior-product-manager-realestate` on scope. Not in `~/.copilot/skills/` → check `~/.copilot/skills-archive/<name>/SKILL.md` (other languages/frameworks, Office/PDF/image gen — usable by absolute path, or move the folder back to re-activate). In neither place → report it. A missing local `skills/` folder means nothing.

**Simplicity rule (inlined).** Prefer no change > existing code > stdlib/native > one-line addition > new dependency > new abstraction; ship the shortest diff that fully solves it. Read `ponytail` itself only when named or when asked for an over-engineering audit.

### Rule Precedence
On conflict: (1) safety/correctness, (2) task-type routing, (3) planning/check-in, (4) elegance, (5) lessons capture.

**Check-in policy (single source of truth):**

| Situation | Action |
|-----------|--------|
| Bug fix / clearly scoped task | Proceed autonomously — no check-in, even across multiple files |
| New feature / architectural change | Plan first, verify with user before implementing |
| Ambiguous scope | Ask one clarifying question first |
| Spawning a subagent | Not a check-in — never pause, spawn silently |

**Ask via `vscode_askQuestions`, never by halting** — options + a recommended default, never prose that ends the turn. Questions are non-blocking: ask, then keep executing anything the answer cannot invalidate. Stop outright only if *every* remaining path depends on the answer, and say so. Never end a turn with a prose question and no tool call.

### Execution
- **Planning** — plan mode for features/architectural changes with real tradeoffs; specs upfront. If it goes sideways, STOP and re-plan; if one full re-plan (approach rewritten from scratch) fails, report the specific obstacle. Bug fixes: just fix it from the logs/errors/failing tests.
- **Elegance** — any change touching more than one function or adding an abstraction: ask whether something simpler works. Skip for single-line and mechanical edits.
- **Subagents** — spawn only when >150 new lines, >3 files, or independent parallel workstreams AND no single targeted fix solves it. One responsibility each; on failure or unusable output, stop and report — never apply partial output, record it in `tasks/todo.md` as PARTIAL with what's done and what remains.
- **Lessons** — record every user correction in `tasks/lessons.md`; read it at session start. This file beats a conflicting lesson: quote both, then follow this file.
- **Tasks** — plan to `tasks/todo.md` as checkable items, tick them as you go, summarize each step. Create either file with a header if missing.
- **Principles** — simplest change that fully solves it · fix root causes, no temporary hacks · touch only what's necessary.

## File-Touch Hygiene — every file you edit

Before finishing, scan the **whole file** you touched (not just your diff) for the two rots below and fix them in the same change. Scope is the files already in your diff — never open new files to clean.

1. **Comments: 1–2 lines, say WHY — never what changed.** Delete changelog prose: dates, decision/ticket ids (`D219 added…`), "previously / now / was", before-after narration, comments restating the code, and multi-paragraph docblocks git history already holds. Applies to `.java`, `.js/.jsx`, `.css`, `.sql`, `.yaml`, `.properties` and config alike. **Do not touch:** an already-applied Flyway `V*.sql` (checksummed — a comment edit alone breaks the next boot); prose security rationale protected by `docs/migration/06-code-quality.md`; docblocks a script greps by path (e.g. `frontend/scripts/check-listing-foundation.mjs` over `ListingService.java`). Grep the file's bare name before deleting anything a tool may read.
2. **Redundancy scan (`ponytail`).** Apply the simplicity rule to code that is already there: reinvented stdlib/native behaviour, dead flexibility, predicates duplicated on both sides of the seam, unreachable branches, wrappers with one caller. Remove only what is **provably behaviour-preserving**; anything larger or uncertain goes to `tasks/todo.md` as a note, not into the diff.

Shrinking a Java service that holds a `ServiceSizeGuardTest` `BASELINE` entry to at-or-under the limit fails `baselineStaysHonest` — delete its entry in the same commit.

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

Stale if `git rev-parse HEAD` ≠ the commit in `graphify-out/GRAPH_REPORT.md` — `update` first, or it points at moved files. Never commit `graphify-out/` (git-ignored, multi-MB, regenerable). **Never `graphify extract`** — it loses relative paths and named communities and drops ~300 nodes. The `pre-#1504 node-ID` note is cosmetic.

### Reading files
Prefer `grep_search` over `semantic_search` when you know the identifier; over ~400 lines, grep the symbol then read a narrow range — never whole. Worst offenders: `frontend/src/data/societies-rera.js` (182 KB minified on 4 lines — grep only), `frontend/src/styles/index.css` (~3,570 lines — grep a class; its section map and tier rules live in the `draazy-frontend` skill), `e2e/COVERAGE.md` (272-row matrix — grep the feature's row), `e2e/helpers/app.js` (grep its 41 exports: `Select-String -Path e2e/helpers/*.js,e2e/fixtures/*.js -Pattern '^export (?:async )?function (\w+)|^export const (\w+)\s*='`). `e2e` is deliberately **not** in the graph — specs reach the app via `page.goto()` strings, so there are no edges; find one by filename (`Get-ChildItem e2e/tests -Recurse -Filter *bottom-nav*`) or a COVERAGE.md row.

## Post-Change Verification (in order)
**user-data change** = code that reads/writes/transmits/displays PII, credentials, session tokens, contact-gate logic, or per-user data.

1. **Review** — in order: `react-reviewer` (`.jsx`/React) → `code-reviewer` (general) → `security-reviewer` (auth or user-data only). Apply the staff-engineer self-check and diff behavior vs. main when relevant. Agent unavailable → review manually, note it in `tasks/todo.md`, mark PENDING AGENT REVIEW.
2. **Simplify** — confirm File-Touch Hygiene ran on every file in the diff, then `/simplify` (or `code-simplifier`), STRICT no-behavior-change. Unavailable → note the skip in `tasks/todo.md`.
3. **Playwright** — run the relevant `e2e/*.spec.js` (full suite if cross-cutting); not complete until green, and fix root causes, not tests. A failure not already in `tasks/todo.md` → flag as potentially pre-existing before proceeding; record confirmed ones there and don't count them against the task.
4. **Specs** — every completed feature or behaviour change ships a new or updated `e2e/*.spec.js` plus an `e2e/COVERAGE.md` entry. No coverage → document the gap in `tasks/todo.md`, add a stub spec or manual steps, mark PENDING VERIFICATION.
5. **Re-index the graph** — file added, renamed, or deleted under `backend/`, `frontend/src` or the migrations → `.\scripts\graphify.ps1 update`. Skip if only contents changed.