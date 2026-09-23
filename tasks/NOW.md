# Now

> **Read this file first and nothing else.** It is the whole orientation a new session needs. Hard
> cap: 60 lines. It holds *state*, never narrative — every line is either a standing rule, a pointer,
> or a number with the date it was taken. Rewrite it at the end of a session; do not append to it.
> Last written: **2026-09-22** against `e714d3d7`.

## Lane

| | |
|---|---|
| Branch | `feature/backend-integration` — the mock-retirement lane |
| Commit policy | Commit at each green milestone. **Never push. The user pushes manually.** |
| Working tree | Dirty by design on this lane; 348 entries at last write, shared with a second session |

## The queue

Ledger item **20 (finance console)**, then **36 (analytics tabs)**. Item 36 has a trap: `AdminAnalytics.jsx:35`
calls `getAnalytics()` from `mockApi.js` and `:59` gates the whole page on it, so deleting the mock
hangs the page including its one working tab. Full damage order in [tasks/todo.md](todo.md) `## Next up`.

## Open work — pointers, not restatements

| What | Where | Size |
|---|---|---|
| 18 open checkboxes across 5 slices | [tasks/todo.md](todo.md) `## In flight` | 650 lines total |
| 14 red gates, each diagnosed pre-existing or not-mine | [tasks/todo.md](todo.md) `## In flight` | — |
| Unnumbered open items | [tasks/todo.md](todo.md) `## Needs attention` | — |
| Numbered decisions and the damage-ordered queue | [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md) | 245 lines |
| Durable rules and house style | [tasks/lessons.md](lessons.md) | 873 lines — grep, do not read whole |
| Backend tech debt | [docs/system/tech-debt.md](../docs/system/tech-debt.md) | 136 lines |

## Standing constraints

- **A second Copilot session shares this repo and its databases.** Never `mvnw clean`, never `DROP DATABASE`.
- **Never edit `frontend/src/**` while an e2e run is in flight** — Vite HMR poisons the run.
- **Restart a lane JVM before blaming a spec** — it serves the code it was built from, and a stale one fails as assertion errors that read as product defects. `backend/run-lane-flatmates.ps1`.
- **Playwright spec filters are regexes matched against Windows paths**: pass bare fragments (`my-listings`), never `a/b/c`, and never comma-joined — both match nothing and report "No tests found".
- `PUNENEST_DEV_MACHINE` must be set for the `dev` profile to start.
- `tasks/HANDOFF.md` was deleted 2026-08-20 and **must not be recreated**.
- Cashfree sandbox-verify has no possible e2e coverage — do not chase it.

## Verified facts, with the date taken

| Fact | Value | Taken |
|---|---|---|
| Next free Flyway slot | **V36** (max `V35`; the home-type CHECK took V35, the concurrent OTP session V32–V34) | 2026-09-22 |
| Tech-debt register | 36 live `D` ids, highest **D218** | 2026-09-19 |
| e2e spec files | 325 under `e2e/tests`, 269 cited in COVERAGE.md, citations gate green | 2026-09-22 |
| Flatmate + agreement backend tests | 269 green (`-Dtest=Flatmate*Test,AgreementsAndKycTest,SpecSchemaParityTest`) | 2026-09-22 |
| `wizard-actions.spec.js` (mobile + mobile-small) | 18 green after the draft key moved to `:v2` | 2026-09-22 |
| Standing e2e red | 1: `interactions-board.spec.js` budget-low sort — pre-existing, needs a product call, see `todo.md` § Needs attention | 2026-09-22 |
| Backend suite (full) | 1,483 green | **2026-08-13 — stale, re-derive** |
| Full e2e sweep | 1,708 tests / 1,694 passed / 9 flaky / 38.6 min | **2026-08-13 — stale, re-derive** |
| `npm run check:size` | 437.6 KB of 497 KB | **2026-08-13 — stale, re-derive** |

## Before you start work

Read [AGENTS.md](../AGENTS.md) for routing, comment policy and the post-change verification order.
Query the knowledge graph before searching: `.\scripts\graphify.ps1 query "<symptom>" --budget 700`.
