-- V112 — what an operator wrote down about a society: `admin_note`.
--
-- WHY THIS EXISTS
--
-- The back office has always had a society editor. `AdminSocieties.jsx` opens a five-field form --
-- registration, conveyance, maintenance per sq ft, claim status, and a free-text note -- and
-- `saveEdit` writes all five into `pnSocietyOverlay` in the operator's own localStorage. Four of
-- those five are real columns on `societies` that the form has never been able to reach, and the
-- fifth is this one, which had nowhere to be reached.
--
-- That is the same failure the candidates (V105), residents (V110) and merges (V111) queues each
-- had, and it lands harder here because the fields are the ones a buyer reads. An operator who
-- checks a conveyance deed, ticks the box and is told it saved has changed nothing a searcher will
-- ever see; the next operator opens the same society and finds it untouched. The other four columns
-- need no migration to fix that -- they exist -- so this file is only about the fifth.
--
-- WHY THE NOTE IS A COLUMN AND NOT A ROW IN `internal_notes`
--
-- V90 added `internal_notes`, and it is the right home for a thread: many notes, each with an
-- author and a time, about one subject. This is not that. The society editor offers one box whose
-- contents replace whatever was there -- "RERA lapsed, chasing the secretary" -- and it is read as
-- part of the record rather than as correspondence. Storing a single replaceable string as an
-- append-only thread would make "the current note" a query with an ordering and a limit, and would
-- leave the console either rendering a history nobody asked for or silently hiding all but the
-- newest row. If ops later wants a conversation about a society, that is `internal_notes` and this
-- column is untouched by it.
--
-- WHY NULLABLE, WITH NO DEFAULT AND NO BACKFILL
--
-- Almost every society will never have one, and null says exactly that. An empty string would be a
-- second way of saying the same thing, so the service normalises a cleared box back to null rather
-- than storing '' -- otherwise "no note" and "a note somebody deleted" would render differently on
-- a screen that means them identically.
--
-- WHY IT IS NOT ON THE PUBLIC SOCIETY RESPONSE
--
-- Same rule the `geo` blacklist reason follows: this is a moderator's free text about a named
-- building, written for colleagues and often about people. It goes out on `/admin/societies/{slug}`
-- and nowhere else. `GET /societies` and `GET /societies/{slug}` are anonymous reads and the column
-- is deliberately absent from `SocietyResponse`, which is what makes publishing it by accident a
-- compile error rather than a judgement call.

alter table public.societies add column admin_note text;

-- No index. It is never a search key: an operator reaches a note by opening the society, and there
-- is no screen that asks "which societies have notes". A trigram index over free text so it could
-- be searched some day is exactly the speculative cost V110 argues against in the other direction.

comment on column public.societies.admin_note is
    'Ops'' free-text note about this society -- why a claim is stuck, what the secretary said, what '
    'to check next. Internal: served only on /admin/societies/{slug} and deliberately absent from '
    'the public Society response, because it is moderator prose about a named building and often '
    'about the people in it. Null means no note; a cleared note is stored as null rather than '''', '
    'so "never had one" and "had one that was deleted" cannot render differently.';

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- updated_at column.
select install_updated_at_triggers();
