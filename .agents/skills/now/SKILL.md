---
name: now
description: Rewrite tasks/NOW.md so the next session can start cold. Use when ending a session, handing off, running low on context, or when the user asks to save/checkpoint session state. Repo-scoped alternative to ECC's /save-session, which writes to a global ~/.claude/session-data file this project cannot version or share.
---

# /now — hand this session off

Rewrite [tasks/NOW.md](../../../tasks/NOW.md) so a session that has read nothing else can start work.
Run this **before** the context window fills, not after — once compaction hits, the detail you are
here to capture is already gone.

## Why this exists rather than `/save-session`

ECC's `/save-session` writes `~/.claude/session-data/YYYY-MM-DD-<id>-session.tmp`. Three reasons that
is wrong for this repo: a second Copilot session shares this working tree and cannot see a file in
your home directory; the handoff must be reviewable in the same diff as the code it describes; and a
dated `.tmp` per session accumulates forever, which is how `tasks/todo.md` reached 2,893 lines.

## Rules

1. **Rewrite the file. Never append.** `NOW.md` is state, not a log. If a line describes something
   that is now finished, it is deleted, not moved to a "done" section.
2. **Hard cap 60 lines.** If you cannot fit, you are writing narrative. Narrative belongs in
   `tasks/todo.md` as one index line, or in the commit message.
3. **Every number carries the date it was taken.** A count with no date is a lie with a shelf life.
   If you did not re-derive it this session, keep the old date and mark it `stale, re-derive`.
4. **Pointers, not restatements.** Open work lives in `tasks/todo.md`; decisions live in
   `tasks/DECISIONS-NEEDED.md`; rules live in `tasks/lessons.md`. Link to them and say how big they
   are so the next session knows the cost of opening one. Never copy their content in.
5. **Preserve the standing constraints section verbatim** unless this session proved one wrong. Those
   lines exist because breaking them cost someone a day.

## Process

1. Re-derive what is cheap and update the dates: branch, HEAD, dirty file count, next free Flyway
   slot (`Get-ChildItem backend/src/main/resources/db/migration -Filter 'V*.sql'`), tech-debt max id,
   e2e spec count. Do not run the test suites just to refresh a number — mark them stale instead.
2. Update the queue line from `tasks/todo.md` `## Next up`.
3. Update the open-work table's sizes if `tasks/todo.md` changed length this session.
4. If this session hit a constraint worth remembering, add it to Standing constraints — and to
   [tasks/lessons.md](../../../tasks/lessons.md) if it is a durable rule rather than a passing fact.
5. Set `Last written` to today's date and the current short SHA.
6. Report the new line count. If over 60, cut and report again.

## Do not

- Do not create `tasks/HANDOFF.md`. It was deleted 2026-08-20 and must not come back.
- Do not commit or push. The user pushes manually.
- Do not touch `tasks/todo.md` in the same run — compacting the worklog is separate work.
