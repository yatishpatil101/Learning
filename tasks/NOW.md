# Now

> **Read this file first and nothing else.** It is the whole orientation a new session needs. Hard
> cap: 60 lines. It holds *state*, never narrative — every line is either a standing rule, a pointer,
> or a number with the date it was taken. Rewrite it at the end of a session; do not append to it.
> Last written: **2026-10-10** against `73347c07` (API slimming + backlog-zero handoff).

## Lane

| | |
|---|---|
| Branch | `feature/backend-integration` — the mock-retirement lane |
| Commit policy | **Never commit or push — the user commits and pushes manually.** |
| Working tree | Dirty by design; 1,131 entries on 2026-10-10, shared with the session "Admin granting flatmate access" |

## The queue

API slimming S00–S25, dead-endpoint removal and the 279-item backlog triage are done and UNCOMMITTED.
`tasks/todo.md` `## Open` holds only the other session's items (A01/C01 agent review, C03 back-office
gaps) — leave them to it. Owner-only work (VAPID pair, prod CMS FAQs, real phones) is in
[OWNER-CHECKLIST.md](OWNER-CHECKLIST.md). Next: user reviews and commits; then a clean `-Full` while
no other session is editing `frontend/src`.
Dev/e2e staff creds live in `db/seed-staff` (local + e2e only): admin `9000000000`, manager `9000000001`.

## Open work — pointers, not restatements

| What | Where | Size |
|---|---|---|
| Open items, waiting-by-design, shipped index | [tasks/todo.md](todo.md) | 333 lines on 2026-10-10 — grep |
| Numbered decisions (all closed) | [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md) | 135 lines on 2026-10-10 |
| Durable rules and house style | [tasks/lessons.md](lessons.md) | 199 lines on 2026-10-10 — grep |
| Owner-only actions | [tasks/OWNER-CHECKLIST.md](OWNER-CHECKLIST.md) | 34 lines on 2026-10-10 |
| SEO lane (other session) | [tasks/seo-aio-geo-plan.md](seo-aio-geo-plan.md) | 350 lines on 2026-10-10 |
| Backend tech debt | [docs/system/tech-debt.md](../docs/system/tech-debt.md) | highest **D264** on 2026-10-10 |

## Standing constraints

- **A second Copilot session shares this repo and its databases.** Never `mvnw clean`, never `DROP DATABASE`.
- **It also keeps files staged in the shared index** — commit through a private `GIT_INDEX_FILE` (recipe in lessons.md, last entry).
- **Never edit `frontend/src/**` while an e2e run is in flight** — Vite HMR poisons the run.
- **Restart a lane JVM before blaming a spec** — it serves the code it was built from, and a stale one fails as assertion errors that read as product defects. Search lane: `backend/run-lane-search.ps1` (:8097) + `e2e/run-live-search.ps1` (:5192, resets `draazy_e2e_sr2`).
- **Playwright spec filters are regexes matched against Windows paths**: pass bare fragments (`my-listings`), never `a/b/c`, and never comma-joined — both match nothing and report "No tests found".
- `DRAAZY_DEV_MACHINE` must be set for the `dev` profile to start.
- **e2e: `e2e\run-fast.ps1` after each fix** (related specs only; `-Failed` reruns last reds), **`e2e\run-fast.ps1 -Full` before a commit** (4 isolated shards, fails on any red or missing test). See e2e/README.md "Fast runs".
- **A new table needs seed rows or a WAIVED entry** in `e2e/scripts/check-seed-coverage.mjs`, and any new seed file must also be listed in `e2e/global-setup.live.js` `SEEDS` — else every shard dies in global setup and all tests report MISSING.
- `tasks/HANDOFF.md` was deleted 2026-08-20 and **must not be recreated**.
- Cashfree sandbox-verify has no possible e2e coverage — do not chase it.

## Verified facts, with the date taken

| Fact | Value | Taken |
|---|---|---|
| Next free Flyway slot | **V105** (V104 = back-office holders; V95 is a gap, leave it) | 2026-10-10 |
| e2e spec files | 387 under `e2e` | 2026-10-10 |
| Backend suite (full) | 2,766 run, 0 failed (361 classes, ~4 min) | 2026-10-10 |
| Full e2e sweep | ~40 red in `-Full` (Vite reloads from concurrent edits); all 115 green on targeted rerun | 2026-10-10 |
