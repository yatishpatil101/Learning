## Workflow Orchestration

### Always-On Skills (mandatory — before every answer)
- Before responding to ANY task in this repo (plan, build, review, debug, or answer), first consult these three skills and apply their guidance: `punenest-frontend` (implementation), `real-estate-expert` (domain model), `senior-product-manager-realestate` (scope/priority). Required even for questions and clearly scoped bug fixes — for a trivial mechanical change it is a fast internal check, not a reason to pause.
- For every implementation (writing, adding, refactoring, or fixing code), apply the `ponytail` skill (default `full`): climb the laziness ladder, prefer stdlib/native/existing code over new abstractions, and ship the shortest diff that fully solves the problem. It governs how code is built; the three skills above still govern scope, domain, and conventions.
- On conflict between them, prefer `punenest-frontend` for implementation, `real-estate-expert` for domain, `senior-product-manager-realestate` for scope. Note the conflict in your session summary.
- If any of these `SKILL.md` files cannot be read, stop and report the missing file to the user.

### Rule Precedence
Order when rules conflict: (1) safety/correctness, (2) task-type routing (bug vs. feature), (3) planning/check-in, (4) elegance/simplicity, (5) lessons capture.

**Check-in policy (single source of truth):**

| Situation | Action |
|-----------|--------|
| Bug fix / clearly scoped task | Proceed autonomously — no check-in, even across multiple files |
| New feature / architectural change | Plan first, verify with user before implementing |
| Ambiguous scope | Ask one clarifying question first |
| Spawning a subagent | Not a check-in — never pause, spawn silently as needed |

- If `tasks/lessons.md` or `tasks/todo.md` don't exist, create them with a header before writing.

### Planning
- For UI: run `ui-ux-pro-max` (design system) + `frontend-design`, follow `punenest-frontend`. For real-estate features: use `real-estate-expert` (domain) and `senior-product-manager-realestate` (scope/metrics) before building.
- Enter plan mode for features/architectural changes with real tradeoffs; write specs upfront.
- If something goes sideways, STOP and re-plan. If one full re-plan (rewrite the approach from scratch) fails, stop and report the specific obstacle to the user.

### Subagents
- Spawn one when a task meets a threshold (>~150 new lines, >3 files, or independent parallel workstreams) AND no single targeted fix cleanly solves it; otherwise prefer the targeted fix. Applies equally to bug fixes.
- Give each subagent one clear responsibility. If it fails or returns unusable output, stop and report to the user.

### Self-Improvement
- After any user correction, record the pattern in `tasks/lessons.md` and read it at session start. If a lesson conflicts with this file, this file wins (note it in your summary).

### Autonomous Bug Fixing
- Given a bug report or scoped task: just fix it. Point at logs/errors/failing tests and resolve them without hand-holding.

### Demand Elegance (balanced)
- For non-trivial changes, ask "is there a more elegant way?" and challenge your own work. Skip for simple, obvious fixes.

## Task Management
1. **Plan** to `tasks/todo.md` (checkable items).
2. **Track** progress; mark items complete as you go.
3. **Summarize** changes at each step.
4. **Document** results and **capture lessons** in `tasks/lessons.md`.

## Core Principles
- **Simplicity first** — simplest change that fully solves it.
- **No laziness** — fix root causes, no temporary hacks.
- **Minimal impact** — touch only what's necessary.

## Project Skills
Read a skill's `SKILL.md` before matching work:
- **ui-ux-pro-max** — design system before any UI code.
- **frontend-design** — distinctive visual direction.
- **punenest-frontend** — project conventions, file map, mock data, auth guards, Playwright harness.
- **punenest-backend** — Spring Boot 3 + PostgreSQL API conventions, system design, data model, Flyway, JWT/role guards, contact gate, provider seams, frontend `http` wiring.
- **react-best-practices** — render/data/bundle performance (apply during review too).
- **real-estate-expert** — listing model, search/filters, maps, wizards, contact gates, alerts, SEO.
- **senior-product-manager-realestate** — scope, prioritize, and define success metrics before code.
- **ponytail** — laziest-that-works discipline for every implementation; stdlib/native/existing over new code, shortest working diff.

Design-consistency rules for UI live in `.github/instructions/ui-design-consistency.instructions.md` (auto-applied to UI files).

All skills above are installed globally under `~/.copilot/skills/` (not in this repo), so a missing local `skills/` folder does not mean a skill is absent.

## Code Review
- **user-data changes** = code that reads/writes/transmits/displays PII, credentials, session tokens, contact-gate logic, or per-user data.
- After changes, run reviewers in order: `react-reviewer` (`.jsx`/React), `code-reviewer` (general), `security-reviewer` (auth or user-data changes).
- If a reviewer agent is unavailable, do a manual review, note it in `tasks/todo.md`, and mark the step PENDING AGENT REVIEW.

## Post-Change Verification (canonical checklist, in order)
1. **Review** — run the applicable agents above; apply the staff-engineer self-check ("would a staff engineer approve this?") and diff behavior vs. main when relevant.
2. **Simplify** — run `/simplify` (or `code-simplifier`) as a STRICT no-behavior-change pass; skip any change that isn't provably equivalent. If unavailable, skip it and note the skip in `tasks/todo.md`.
3. **Playwright** — run the relevant `e2e/*.spec.js` (full suite if cross-cutting). Don't mark complete until they pass; fix root causes, not tests. For a failure not documented in `tasks/todo.md`, flag it to the user as potentially pre-existing before proceeding; record confirmed pre-existing failures there and don't count them against the task.
4. **No coverage** — if no test covers the feature, document the gap in `tasks/todo.md`, add a stub spec or manual steps, and mark PENDING VERIFICATION.