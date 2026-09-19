## Workflow Orchestration

### Attachments
An attached image is the **source of truth** — if it contradicts the code, the code is wrong; say so. Inspect it before answering or editing and state what you see and what you're changing because of it; never ask the user to re-describe it. Workspace image → `view_image`, not `read_file`; referenced but missing → say so and stop.

### Skill Routing (load on demand)
Default: **read no skill file** — answering, explaining, and mechanical edits need none. Otherwise match a trigger, **max two per turn** (tie → the one matching the artifact asked for, else the lower row).

| Trigger | Read |
|---|---|
| Frontend code — conventions, file map, auth guards, Playwright harness | `draazy-frontend` |
| Backend code — Spring Boot + PostgreSQL conventions, data model, Flyway, JWT/role guards, contact gate, provider seams, frontend `http` wiring | `draazy-backend` |
| Listing/search/filter/map/wizard/contact-gate/alert **behaviour**; SEO for property pages | `real-estate-expert` |
| Scope, priority, tradeoffs, success metrics for a new feature | `senior-product-manager-realestate` |
| New UI surface or visual redesign | `ui-ux-pro-max`, then `frontend-design` |
| Render/data/bundle performance | `react-performance` |
| A skill named by the user | that skill |

Conflicts: `draazy-*` wins on implementation, `real-estate-expert` on domain, `senior-product-manager-realestate` on scope. Missing from `~/.copilot/skills/` → try `~/.copilot/skills-archive/<name>/SKILL.md`; in neither place, report it.

**Simplicity rule.** Prefer no change > existing code > stdlib/native > one-line addition > new dependency > new abstraction; ship the shortest diff that fully solves it. Read `ponytail` only when named or asked for an over-engineering audit.

### Check-ins
On conflict, rules rank: safety/correctness > task-type routing > planning/check-in > elegance > lessons capture.

| Situation | Action |
|-----------|--------|
| Bug fix / clearly scoped task | Proceed autonomously, even across multiple files |
| New feature / architectural change | Plan first, verify with user before implementing |
| Ambiguous scope | Ask one clarifying question first |
| Spawning a subagent | Not a check-in — never pause, spawn silently |

**Ask via `vscode_askQuestions`, never by halting** — options + a recommended default. Questions are non-blocking: ask, then keep executing anything the answer cannot invalidate. Stop only if *every* remaining path depends on the answer, and say so. Never end a turn with a prose question and no tool call.

### Execution
- **Planning** — plan mode for features/architectural changes with real tradeoffs. If it goes sideways, STOP and re-plan; if a full re-plan also fails, report the specific obstacle. Bug fixes: just fix it from the logs/errors/failing tests.
- **Elegance** — any change touching more than one function or adding an abstraction: ask whether something simpler works. Skip for mechanical edits.
- **Subagents** — only when >150 new lines, >3 files, or independent parallel workstreams AND no single targeted fix solves it. One responsibility each; on failure, stop and report — never apply partial output, record it in `tasks/todo.md` as PARTIAL.
- **Lessons** — record every user correction in `tasks/lessons.md`; read it at session start. This file beats a conflicting lesson: quote both, then follow this file.
- **Tasks** — plan to `tasks/todo.md` as checkable items, tick them as you go. Create either file with a header if missing.
- **Principles** — simplest change that fully solves it · fix root causes, no temporary hacks · touch only what's necessary.

## Comments You Write — the default is NONE

**Write zero comments unless the code genuinely cannot carry the meaning.** Names, small functions, and types are the explanation; a comment is what you reach for *after* those fail, not alongside them. Every comment is a claim you commit to keeping true, so adding one must be defensible, never a reflex. Applies to every language, and to config, SQL, and YAML alike.

Write one ONLY for:
- a **non-obvious WHY** — a workaround, an ordering constraint, a library/spec quirk, a deliberate deviation a reader would otherwise "fix"
- a **coupling invisible from here** — this value must match X; this must run before Y
- a **required marker** — `TODO`, `eslint-disable`/`@ts-expect-error` (with the reason), and docblocks a script greps

Never write:
- a restatement of the code below it (`// increment counter`, `// fetch the user`)
- section banners (`// ---- helpers ----`, `// State`, `// Handlers`)
- narration of your own edit — "now uses", "previously", "added for", dates, ticket ids. That belongs in the commit message.
- a docblock on a self-evident function, or `@param`/`@returns` repeating the signature
- commented-out code — delete it

**Budget: 1–2 lines, above the code.** If a block seems to need a paragraph, it needs a better name or a split instead. Unsure → leave it out: an absent comment costs nothing, a stale one misleads for years.

## File-Touch Hygiene — every file you edit

Scan the **whole file** you touched, not just your diff, and fix both rots below in the same change. Scope is the files already in your diff — never open new files to clean.

1. **Comments — hold existing ones to the rule above**, and delete changelog prose (dates, ticket ids, "previously / now / was", before-after narration, docblocks git history already holds). **Do not touch:** an already-applied Flyway `V*.sql` (checksummed — a comment edit alone breaks the next boot); security rationale protected by `docs/migration/06-code-quality.md`; docblocks a script greps by path. Grep the file's bare name before deleting anything a tool may read.
2. **Redundancy scan.** Apply the simplicity rule to code already there: reinvented stdlib/native behaviour, dead flexibility, predicates duplicated across a seam, unreachable branches, wrappers with one caller. Remove only what is **provably behaviour-preserving**; anything larger goes to `tasks/todo.md` as a note, not into the diff.

Shrinking a Java service that holds a `ServiceSizeGuardTest` `BASELINE` entry to at-or-under the limit fails `baselineStaysHonest` — delete its entry in the same commit.

## Context Cost Rules

### Query the graph before searching
`graphify-out/` graphs `backend`, `frontend` and the Flyway migrations. To locate code from a symptom, screenshot, or concept rather than a known filename, **query it first** — right files with line numbers for ~600 tokens vs ~40k for semantic search plus reads. Fall back to `grep_search`/`semantic_search` only if a query returns nothing useful. Run from the repo root (the CLI isn't on PATH):

```powershell
.\scripts\graphify.ps1 query "mobile bottom navigation bar" --budget 700
.\scripts\graphify.ps1 path "BottomNav" "AuthContext"
.\scripts\graphify.ps1 explain "ConsumerLayout"
.\scripts\graphify.ps1 update      # adds/renames/deletes — incremental, idempotent
.\scripts\graphify.ps1 rebuild     # large refactors; the only full re-index
```

Stale if `git rev-parse HEAD` ≠ the commit in `graphify-out/GRAPH_REPORT.md` — `update` first, or it points at moved files. Never commit `graphify-out/` (git-ignored, regenerable). **Never `graphify extract`** — it loses relative paths and named communities and drops ~300 nodes.

### Reading files
Prefer `grep_search` over `semantic_search` when you know the identifier; over ~400 lines, grep the symbol then read a narrow range — never whole. Worst offenders: `frontend/src/data/societies-rera.js` (182 KB minified on 4 lines — grep only), `frontend/src/styles/index.css` (~3,570 lines — grep a class; its section map and tier rules live in the `draazy-frontend` skill), `e2e/COVERAGE.md` (grep the feature's row), `e2e/helpers/app.js` (grep its exports). `e2e` is deliberately **not** in the graph — specs reach the app via `page.goto()` strings, so there are no edges; find one by filename (`Get-ChildItem e2e/tests -Recurse -Filter *bottom-nav*`) or a COVERAGE.md row.

## Post-Change Verification (in order)
**user-data change** = code that reads/writes/transmits/displays PII, credentials, session tokens, contact-gate logic, or per-user data.

1. **Review** — `react-reviewer` (`.jsx`) → `code-reviewer` (general) → `security-reviewer` (auth or user-data only). Agent unavailable → review manually and mark PENDING AGENT REVIEW in `tasks/todo.md`.
2. **Simplify** — confirm File-Touch Hygiene ran on every file in the diff, then `code-simplifier`, STRICT no-behavior-change. Unavailable → note the skip.
3. **Playwright** — run the relevant `e2e/*.spec.js` (full suite if cross-cutting); not complete until green, and fix root causes, not tests. A failure not already in `tasks/todo.md` → flag as potentially pre-existing before proceeding; record confirmed ones there and don't count them against the task.
4. **Specs** — every completed feature or behaviour change ships a new or updated `e2e/*.spec.js` plus an `e2e/COVERAGE.md` entry. No coverage → document the gap in `tasks/todo.md` and mark PENDING VERIFICATION.
5. **Re-index the graph** — file added, renamed, or deleted under `backend/`, `frontend/src` or the migrations → `.\scripts\graphify.ps1 update`. Skip if only contents changed.