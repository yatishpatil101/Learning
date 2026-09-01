-- D29. Internal notes: what the team knows about a case, kept where the team can read it.
--
-- Replaces `db.internalNotes` in the browser's localStorage. Four moderation actions wrote a note
-- there in the same handler that made a real API call, so the decision landed on the server and the
-- reasoning stayed on one laptop. Nothing was lost visibly -- the note simply was not there for the
-- next person, which reads exactly like "nobody wrote one".
--
-- Polymorphic target, following `reports`: (entity_type, entity_id) rather than four nullable FKs.
-- The four kinds live in four tables and one of them (report) is itself polymorphic, so entity_id is
-- text and is NOT a foreign key. That is deliberate and not laziness -- a note about a listing that
-- is archived an hour later is precisely the note worth keeping, and a cascade would delete the
-- explanation along with the thing it explains.
--
-- MUTABLE, unlike ticket_notes and audit_log beside it. A note is retained customer information,
-- not an audit record: information that cannot be corrected is worse than information that can,
-- because the wrong version is the one that stays on the screen. Who changed what is already
-- audited, in a different table; `note.edit` carries the previous wording.
--
-- author_id is a real user id and not a display name (which is what ticket_notes.by stores). It is
-- not a foreign key either: a staff account can be archived and its notes stay readable, and the
-- read falls back to the raw id when no account matches.
CREATE TABLE internal_notes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type text        NOT NULL CHECK (entity_type IN ('property', 'user', 'review', 'report')),
    entity_id   text        NOT NULL,
    author_id   uuid        NOT NULL,
    action      text,
    text        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The only read shape a screen asks for: one entity's notes, newest first.
CREATE INDEX idx_internal_notes_entity
    ON internal_notes (entity_type, entity_id, created_at DESC);
