-- V102 — society Q&A and the notices board
--
-- The two community surfaces the hub has always drawn and never persisted. Until now a question
-- asked on a society page lived in `pnSocietyQA` and a maintenance-shutdown notice lived in
-- `pnSocietyBoard`, both in the asker's own browser: the committee posted an AGM notice that
-- literally nobody else could see, and every answer to a neighbour's question was written to an
-- audience of one.
--
-- WHY THREE TABLES AND NOT ONE "society_posts"
-- --------------------------------------------
-- They look alike — a body, an author, a society — and they are governed differently, which is the
-- part a shared table would erase. A question is open to any signed-in user and a board item is
-- restricted to people who actually live there, because a notice claims authority ("the water goes
-- off on Tuesday") in a way a question does not. Merging them would put that rule in a `WHERE
-- kind = 'notice'` branch of application code instead of at the endpoint, where it is enforceable
-- and readable.
--
-- Answers are their own table rather than a self-referencing parent on questions, for the same
-- reason: an answer cannot exist without a question, and a nullable `parent_id` would let one.
--
-- WHY THERE IS NO `resident` COLUMN
-- ---------------------------------
-- The hub badges an author as a verified resident. That badge is NOT stored here. It is a fact
-- about the author *today*, read from `society_residents` at render time — a stored copy would keep
-- saying "Verified resident" after the committee rejected them, which is precisely the claim the
-- badge exists to make trustworthy.

create table if not exists public.society_questions (
    id          uuid primary key default gen_random_uuid(),
    society_id  uuid not null references public.societies (id),
    author_id   uuid not null references public.users (id),
    body        text not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.society_questions is
    'A question asked on a society hub. Open to any signed-in user: somebody deciding whether to '
    'move in has the most to ask and lives nowhere yet.';

create index if not exists idx_society_questions_society_created
    on public.society_questions (society_id, created_at desc);

create table if not exists public.society_answers (
    id          uuid primary key default gen_random_uuid(),
    question_id uuid not null references public.society_questions (id) on delete cascade,
    author_id   uuid not null references public.users (id),
    body        text not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.society_answers is
    'An answer to a society question. ON DELETE CASCADE because an answer to a deleted question is '
    'not an orphan record, it is a fragment of a conversation nobody can read.';

create index if not exists idx_society_answers_question_created
    on public.society_answers (question_id, created_at);

create table if not exists public.society_board_items (
    id          uuid primary key default gen_random_uuid(),
    society_id  uuid not null references public.societies (id),
    author_id   uuid not null references public.users (id),
    kind        text not null check (kind in ('event', 'notice')),
    title       text not null,
    body        text,
    category    text,
    event_date  date,
    event_time  time,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    -- An event with no date is a notice wearing the wrong label: it would sort into the calendar
    -- and render with an empty date field. The database refuses it so the calendar cannot be
    -- corrupted by a caller the service forgot to validate.
    constraint ck_society_board_event_has_date check (kind <> 'event' or event_date is not null)
);

comment on table public.society_board_items is
    'The society noticeboard: dated events (AGMs, tanker days, maintenance shutdowns) and undated '
    'notices. Reading is public; posting is limited to verified residents and the committee, '
    'because a notice is an assertion about the building.';

-- Two orderings, two indexes. The board is read as "upcoming events" and "recent notices" and a
-- single index on `created_at` would leave the calendar sorting in memory.
create index if not exists idx_society_board_society_created
    on public.society_board_items (society_id, created_at desc);

create index if not exists idx_society_board_events
    on public.society_board_items (society_id, event_date)
    where kind = 'event';

select install_updated_at_triggers();
