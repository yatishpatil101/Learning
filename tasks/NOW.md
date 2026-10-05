# Now

> **Read this file first and nothing else.** It is the whole orientation a new session needs. Hard
> cap: 60 lines. It holds *state*, never narrative — every line is either a standing rule, a pointer,
> or a number with the date it was taken. Rewrite it at the end of a session; do not append to it.
> Last written: **2026-10-05** against `c89da3a5` (e2e sweep handoff).

## Lane

| | |
|---|---|
| Branch | `feature/backend-integration` — the mock-retirement lane |
| Commit policy | Commit at each green milestone. **Never push. The user pushes manually.** |
| Working tree | Dirty by design; 1,917 entries on 2026-10-05, shared with other sessions/agent slices |

## The queue

`tasks/todo.md` `## Next up`: ledger queue empty; next listed slice is **Flatmate room edit** (existing
room has backend PATCH but no UI edit; My Listings hard-codes flatmate group/post status as approved).
**Back-office functions Parts A–F (2026-10-05): implemented + security/React review fixes, UNCOMMITTED.**
Staff hold functions (V90 converts stored atoms, never widens; no doc = dashboard only); admin never
narrowed; shared `/admin` shell filtered by atom; manager Team Performance page. Backend targeted
green, full 3105/0 before review fixes; build/lint/route checks green; e2e not run (user runs it,
incl. `e2e/tests/admin/back-office-functions.spec.js`). Follow-ups: `tasks/todo.md` `## In flight`.
Dev/e2e staff creds live in `db/seed-staff` (local + e2e only): `<mobile>@staff.draazy.test` /
`Draazy-dev-pass1`, authenticator secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`; admin is `9000000000`,
manager is `9000000001`. Several other slices in `## In flight` are also green and UNCOMMITTED, incl. the
**e2e redundancy sweep** (2026-10-05: executions 2,541 → 1,436; its pre-existing-failure list is there).

## Open work — pointers, not restatements

| What | Where | Size |
|---|---|---|
| Open slices, red gates diagnosed not-mine | [tasks/todo.md](todo.md) `## In flight`; loose items `## Needs attention` | 848 lines on 2026-10-05 — grep |
| Numbered decisions (all closed) | [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md) | 94 lines on 2026-10-04 |
| Durable rules and house style | [tasks/lessons.md](lessons.md) | 863 lines on 2026-10-04 — grep, do not read whole |
| Backend tech debt | [docs/system/tech-debt.md](../docs/system/tech-debt.md) | 112 lines on 2026-10-04 |

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
| Next free Flyway slot | **V91** (V90 used by back-office functions) | 2026-10-05 |
| Tech-debt register | 56 `D` references in `docs/system/tech-debt.md`, highest **D264** | 2026-10-04 |
| e2e spec files | 356 under `e2e` (1,391 live + 45 no-backend tests) | 2026-10-05 |
| Backend suite (full) | 3,087 run, 0 real failures (DB "too many clients" errors, green on rerun) | 2026-10-03 — stale, re-run before commit |
| Full e2e sweep | 1,435 tests / 49 failed → 42 on `-Failed` rerun, all pre-existing (dirty shared tree) | 2026-10-05 |
