-- V76: message attachments, and the link from an attachment to the message it belongs to (D49).
--
-- ---------------------------------------------------------------------------------------------
-- What was here before
-- ---------------------------------------------------------------------------------------------
-- The contract's `MessageCreate` has carried an `attachments` array since the first draft, and both
-- surfaces that accept it -- POST /messages/{id}/reply and POST /support/tickets/{id}/messages --
-- parsed it and threw it away. `ConversationMessage`'s Javadoc said so out loud: "there is no
-- upload surface that produces a URL for a chat message, so the field is accepted and dropped".
-- That is the honest behaviour for a field with nowhere to go, and it is still a field the wire
-- advertises and the platform does not honour. D49 closes it by building the missing half.
--
-- ---------------------------------------------------------------------------------------------
-- Why a table and not the V4 `attachments` column
-- ---------------------------------------------------------------------------------------------
-- `messages` has carried an unused `attachments` column since V4. It is not what this needs, for
-- two reasons. It is on `messages` only, so support tickets -- the second surface D49 names --
-- would have needed a second column and a second shape anyway; and a column holding an array of
-- strings cannot hold what an attachment actually is here. An attachment is a storage key, a size,
-- a proven content type and an uploader, and every one of those has to be persisted: the key
-- because the object store is addressed by it, the size and type because they are what the reader's
-- client renders, and the uploader because a pending attachment must only be claimable by the
-- person who uploaded it. Squeezing that into a text[] means parsing it back out, and the day the
-- shape changes there is no constraint to lean on.
--
-- The V4 column is left exactly as it is. It is unmapped, it is empty, and dropping it is a
-- separate change with its own blast radius.
--
-- ---------------------------------------------------------------------------------------------
-- Why one table for both surfaces, discriminated by `surface`
-- ---------------------------------------------------------------------------------------------
-- The alternative is `conversation_message_attachments` and `support_ticket_message_attachments`,
-- two tables identical in every column. That is the shape the codebase would normally prefer --
-- three separate MessageDto records exist precisely because "they render alike today" is not a
-- reason to couple them -- but the argument does not carry here. Those records are *wire shapes*
-- that diverge when a product decision diverges. This is a *storage ledger*, and the thing it
-- stores is the same object in both cases: bytes in a bucket with a proven type. There is no
-- product decision that could make a support attachment a different kind of row from a chat
-- attachment; there is only the question of which thread it hangs off, which is what `surface` and
-- `thread_id` answer.
--
-- The cost of one table is that `thread_id` cannot carry a foreign key, because it points at two
-- different tables. That is real and is why `surface` has a CHECK rather than being free text: an
-- unconstrained discriminator plus an unconstrained id is a row that can point at nothing, and no
-- reader would notice. With the CHECK, the vocabulary is closed in the database as well as in
-- MessageSurfaces, so a third surface cannot arrive by typo.
--
-- ---------------------------------------------------------------------------------------------
-- Why `message_id` is nullable
-- ---------------------------------------------------------------------------------------------
-- Bytes have to be uploaded before the message that carries them can be written -- the reply
-- endpoint takes JSON, and the client cannot name an attachment it has not uploaded yet. So an
-- attachment exists for a short while belonging to a thread and an uploader but to no message:
-- that is `message_id is null`, and it is the only state in which an attachment may be claimed.
-- Once bound, it is bound: the reply handler sets `message_id` and nothing ever clears it, so a
-- second reply cannot re-use the same upload and no message can steal another's attachment.
--
-- A pending row is therefore also the only thing here that can accumulate. That is bounded by the
-- per-message cap (MessageAttachments.MAX_PER_MESSAGE) applied at bind time and by the per-thread
-- pending cap applied at upload time -- see MessageAttachments -- so an uploader cannot fill the
-- bucket by uploading and never replying.
--
-- ---------------------------------------------------------------------------------------------
-- On erasure
-- ---------------------------------------------------------------------------------------------
-- `file_name` is user-supplied content and is classified RETAINED in ErasureCoverageTest, for the
-- same reason `messages.body` is not swept at all: a conversation is a two-party record, and
-- blanking one party's contributions corrupts the other party's copy of an exchange they took part
-- in. `uploaded_by` cascades with the user because the row is meaningless without an uploader and
-- the counterparty's copy of the *message* survives regardless.

create table message_attachments (
    id            uuid primary key default gen_random_uuid(),
    surface       text not null check (surface in ('conversation', 'support_ticket')),
    thread_id     uuid not null,
    message_id    uuid,
    uploaded_by   uuid not null references users (id) on delete cascade,
    storage_key   text not null unique,
    content_type  text not null,
    size_bytes    bigint not null check (size_bytes > 0),
    file_name     text not null,
    created_at    timestamptz not null default now()
);

-- The read path: every message read asks "what hangs off these message ids", in one batch.
create index idx_message_attachments_message on message_attachments (message_id)
    where message_id is not null;

-- The claim path: "which of my uploads on this thread are still unbound", which is both the
-- lookup the reply handler does and the count the per-thread pending cap is measured against.
create index idx_message_attachments_pending on message_attachments (thread_id, uploaded_by)
    where message_id is null;
