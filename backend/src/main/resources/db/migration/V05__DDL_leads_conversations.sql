-- V05 DDL Leads & Conversations: how a seeker reaches an owner, and everything the resulting
-- exchange is written into.
--
-- Scope: `contact_requests` (the maker/checker contact reveal), `visits` (site-visit scheduling),
-- `conversations` + `messages` (the 1:1 chat thread), `message_attachments` (the storage ledger
-- shared by chat and support threads), `message_template` (the outreach copy library) and
-- `outbound_message` (the owner-outreach ledger).
--
-- Folded from the old chain: V4 (contact_requests, visits, conversations, messages -- and
-- `enquiries`, which V22 retired and which is therefore never created here), V9 (contact-request
-- uniqueness), V11 (the live-visit-per-user-property unique index only -- its deal_parties, deals
-- and offers/finalization siblings live in the deals file), V22 (the conversations pair ordering,
-- the pair-unique indexes, the recency indexes and the unread-message index -- its support_tickets
-- part lives in the engagement file), V48 (the two composite paging indexes on `visits` -- its
-- offers/deals/finalization indexes live in the deals file), V58 (visits optimistic locking),
-- V76 (message_attachments), V78 (message_template + outbound_message; the ten template rows it
-- seeded are DML and are owned by `R__seed_reference_data.sql`).
--
-- `conversations` MUST be created before `messages`, and `message_template` before
-- `outbound_message`, which carry foreign keys to them.
--
-- From V4: Seekers connect to listings behind the badge-not-gate model (ADR-019). Schemas:
-- ContactRequest(Create), ContactStatus, Visit(Create), Conversation(Create), Message(Create).
-- Party embeds resolve to user_id FKs (reconciliation #10). Contact masking is applied at the
-- API/mapper layer, not stored here -- the raw owner mobile lives on users, revealed only on grant.

-- ---------------------------------------------------------------------------------------------
-- contact_requests: maker(requester) -> checker(owner) approval for contact reveal.
-- ---------------------------------------------------------------------------------------------
-- WHY THERE IS NO `enquiries` TABLE (from V22)
--
-- `enquiries` was the pre-ADR-019 name for a contact request. `GET /enquiries` was declared,
-- marked DEPRECATED and never implemented; the contact-request surface replaced it before either
-- shipped, and no code path in the platform ever inserted a row there. Spec fix S45 removed the
-- operation, so the table became unreachable by any endpoint and unwritten by any service, and
-- V22 dropped it. Its thread always lived in the generic `messages` table below (linked by
-- conversation), so it never had a child table of its own.
--
-- V22 dropped it under a guard rather than outright: if some environment did hold rows, the
-- migration failed loudly instead of deleting leads -- a failed deploy is recoverable, a dropped
-- table of customer enquiries is not. Nothing could write the table, so the guard never fired.
--
-- ONE CONTACT REQUEST PER (REQUESTER, LISTING) (from V9)
--
-- The API has always promised idempotency -- re-requesting returns the existing status rather than
-- opening a second lead -- but that promise originally lived only in ContactService's
-- check-then-insert, which two concurrent double-taps can slip through. A duplicate row is not a
-- cosmetic problem: it would double an owner's inbox and break the single-row lookup the gate
-- depends on.
--
-- Same posture as identity_verifications.identity_hash: the application fails gracefully, the
-- database is what actually guarantees it. The unique constraint also serves the
-- (requester_id, property_id) lookup itself, so idx_contact_requests_requester is its prefix and
-- is kept for the requester-only scan.
CREATE TABLE contact_requests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id),
    requester_id uuid NOT NULL REFERENCES users(id),
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
    message      text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_contact_requests_requester_property UNIQUE (requester_id, property_id)
);
CREATE INDEX idx_contact_requests_property  ON contact_requests (property_id);
CREATE INDEX idx_contact_requests_requester ON contact_requests (requester_id);

-- ---------------------------------------------------------------------------------------------
-- visits: maker(visitor) requests a slot -> checker(owner) confirms.
-- ---------------------------------------------------------------------------------------------
-- OPTIMISTIC LOCKING (from V58, tech debt D146)
--
-- WHAT THIS CLOSES
--
-- `VisitService.updateStatus` and `VisitService.reschedule` are two legitimate writers of the same
-- `visits` row. Without a version counter, two callers editing a stale copy can both succeed and
-- the later commit silently wins. That can leave a row in a state that reflects only one side of
-- the interaction rather than the latest agreed state.
--
-- WHY THIS SHAPE
--
-- The platform already standardises this on `@Version` via `VersionedEntity` (V26, V46). Visits
-- join that same mechanism: Hibernate includes `version` in the UPDATE predicate and increments it.
-- The stale writer then matches zero rows and Spring raises OptimisticLockingFailureException,
-- which the global handler maps to 409 with a reload-and-retry message.
--
-- `default 0` is required for existing rows and `not null` makes the lock unskippable.
CREATE TABLE visits (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id),
    visitor_id  uuid NOT NULL REFERENCES users(id),
    slot        timestamptz NOT NULL,
    mode        text NOT NULL DEFAULT 'in-person' CHECK (mode IN ('in-person','video')),
    status      text NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','confirmed','completed','cancelled','no-show')),
    note        text,
    version     bigint NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

comment on column visits.version is
    'Optimistic-locking counter (D146). Maintained by Hibernate; raw SQL updates bypass it.';

CREATE INDEX idx_visits_property ON visits (property_id);
CREATE INDEX idx_visits_visitor  ON visits (visitor_id);

-- COMPOSITE PAGING INDEXES (from V48, for the deal-cluster reads that D77 paged)
--
-- WHY AN INDEX MIGRATION SHIPS WITH THE PAGING CHANGE, NOT AFTER IT
-- -----------------------------------------------------------------
-- api-standards.md §5: "every sort/filter field must be backed by a DB index; don't expose a filter
-- the schema can't serve efficiently." Paging without the index is not a half-measure, it is a
-- regression: the unpaged read did one scan and returned everything, while a paged read over the
-- same single-column index does the scan, sorts the whole matched set, and then throws all but
-- twenty rows away -- plus a second pass for the `count(*)` the envelope carries. The owner with
-- four hundred offers pays more per request than they did before, for less data.
--
-- WHAT CHANGES
-- ------------
-- Each of these predicates is `<scope column> = ? / in (?)` followed by `order by created_at desc
-- limit ?`. A composite `(scope, created_at desc)` serves both halves: Postgres walks the index
-- from the newest entry for that scope and stops after `size` rows, so page one costs the same
-- whether the owner has twenty offers or twenty thousand. The single-column originals stay --
-- `idx_offers_property` also backs the closed-deal probe and the uniqueness checks, and dropping a
-- prefix index in the same change that adds its superset is how a plan regresses on the one query
-- nobody re-measured.
--
-- `created_at desc` is written into the index rather than left to a backwards scan. Postgres can
-- read a btree in either direction, so `(scope, created_at)` would serve this too -- but only while
-- the sort stays single-column. Spelling the direction out means the index and the `order by` in
-- the repository are literally the same text, which is the property that survives someone adding a
-- tie-breaker column later.
--
-- The offers, deals and finalization_requests members of the same V48 batch live in the deals file.
CREATE INDEX idx_visits_property_created ON visits (property_id, created_at DESC);
CREATE INDEX idx_visits_visitor_created  ON visits (visitor_id, created_at DESC);

-- ONE LIVE ROW PER (USER, PROPERTY) (from V11)
--
-- The V9 lesson, applied ahead of the bug rather than after it: a check-then-insert in the
-- service is not a uniqueness guarantee, because two concurrent double-taps interleave
-- between the check and the insert. Duplicate rows here are not cosmetic -- they double the
-- owner's pending counts, and they make "the buyer's live offer on this listing" a query that
-- can return two answers.
--
-- Partial unique indexes rather than plain UNIQUE constraints, because the restriction is only
-- on *live* rows. A buyer whose offer was declined must be able to offer again, and someone
-- who cancelled a visit must be able to rebook -- so the terminal states are excluded and any
-- number of historical rows may accumulate.
--
-- The offers and finalization_requests members of the same V11 batch live in the deals file.
CREATE UNIQUE INDEX uq_visits_live_per_user_property
    ON visits (visitor_id, property_id)
    WHERE status IN ('scheduled', 'confirmed');

-- ---------------------------------------------------------------------------------------------
-- conversations: 1:1 chat thread between two users, optionally about a listing. counterparty /
-- unread are computed per-viewer at the API layer; here we store the symmetric participant pair.
-- ---------------------------------------------------------------------------------------------
-- A CONVERSATION BETWEEN TWO PEOPLE IS ONE ROW, WHICHEVER OF THEM STARTED IT (from V22)
--
-- V4 stored an unordered pair, so (A,B) and (B,A) are the same conversation but two different
-- rows, and nothing stopped both existing. Two threads for one relationship is the worst possible
-- failure here: each party replies into their own copy and neither sees the other's messages.
--
-- Fixed by canonicalising the pair -- user_a is always the lower uuid -- which turns "is there
-- already a conversation between these two about this listing?" into an index lookup instead of an
-- OR across both columns. The CHECK is what makes the unique indexes below actually mean it;
-- without it the application could insert the flipped pair and the index would allow it.
--
-- The constraint is named explicitly. V4's original was an anonymous `CHECK (user_a_id <>
-- user_b_id)`, so its name was Postgres's own derivation (`conversations_check`) and V22 had to
-- drop it with IF EXISTS rather than a bare DROP: if that derived name ever differed the weaker
-- constraint simply stayed, which is harmless next to the strict one -- whereas a failed DROP
-- would have blocked the deploy over a naming detail. Consolidated, only the strict named form is
-- ever created.
CREATE TABLE conversations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id    uuid NOT NULL REFERENCES users(id),
    user_b_id    uuid NOT NULL REFERENCES users(id),
    property_id  uuid REFERENCES properties(id),
    last_message text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT conversations_pair_ordered CHECK (user_a_id < user_b_id)
);

-- Two indexes, not one, because Postgres treats NULLs as distinct in a unique index: a single
-- index over (user_a, user_b, property_id) would happily accept any number of general
-- (property-less) conversations between the same pair. `NULLS NOT DISTINCT` would do it in one,
-- but it is PG15+ and this schema does not otherwise require it.
CREATE UNIQUE INDEX uq_conversations_pair_property
    ON conversations (user_a_id, user_b_id, property_id) WHERE property_id IS NOT NULL;
CREATE UNIQUE INDEX uq_conversations_pair_general
    ON conversations (user_a_id, user_b_id) WHERE property_id IS NULL;

-- The inbox is "my conversations, most recent first", and the caller may be on either side of the
-- pair. V4's single-column indexes (`idx_conversations_user_a` / `_user_b`) served the membership
-- test but left the sort to a heap sort of everything the user has ever talked about, so V22
-- replaced them with these composites; they are not created here at all.
CREATE INDEX idx_conversations_a_recent ON conversations (user_a_id, updated_at DESC);
CREATE INDEX idx_conversations_b_recent ON conversations (user_b_id, updated_at DESC);

-- ---------------------------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------------------------
CREATE TABLE messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    author_id       uuid NOT NULL REFERENCES users(id),
    author_role     text CHECK (author_role IN ('buyer','owner','staff','admin')),
    body            text NOT NULL,
    attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,
    read            boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);

-- The unread badge counts messages the caller did not write and has not read. Partial, because
-- read messages are the overwhelming majority within days and none of them can ever match. (V22)
CREATE INDEX idx_messages_unread ON messages (conversation_id, author_id) WHERE read = false;

-- ---------------------------------------------------------------------------------------------
-- message_attachments: attachments, and the link from an attachment to the message it belongs to
-- (from V76, D49).
-- ---------------------------------------------------------------------------------------------
--
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

-- ---------------------------------------------------------------------------------------------
-- message_template + outbound_message: the owner-outreach ledger, and the template library it
-- draws from (from V78, D216).
-- ---------------------------------------------------------------------------------------------
--
-- What was here before
-- ---------------------------------------------------------------------------------------------
-- Nothing. The admin console has had a Follow-up tab and a WhatsApp template panel since the mock
-- era, and neither had a server behind it. `sendOwnerReminder` incremented a number in the
-- browser's own copy of the database and produced no message. `sendWhatsappTemplate` interpolated
-- a template and opened wa.me -- which is a real send, but left no record anywhere the next
-- colleague could see. Two staff members chasing the same owner had no way to discover each other.
--
-- ---------------------------------------------------------------------------------------------
-- `prepared` is a status, not a euphemism
-- ---------------------------------------------------------------------------------------------
-- The send this platform performs today is WhatsApp click-to-chat: the server renders the text and
-- the staff member's own WhatsApp opens with it typed out, and they press send. That is a genuine
-- and fully working mechanism -- no Business API, no vendor, no Meta template approval, which is
-- why the console has been able to use it all along -- but it is one the server cannot witness.
-- The staff member may send it, edit it first, or close the tab, and nothing reports back.
--
-- So the ledger records what actually happened: a message was composed and handed to a human.
-- `status` starts at `prepared` and stays there. It does not start at `sent`, because that would
-- be the platform asserting something it has no evidence for, in a table whose whole purpose is to
-- be the evidence. When a Business Solution Provider is eventually wired in it will move rows to
-- `sent` or `failed` on a delivery callback, and the vocabulary is already here to receive it --
-- but until then the Follow-up tab should say "prepared", and the count beside a listing should be
-- read as "chasers written", not "chasers delivered".
--
-- This is also why there is no `simulated` flag. A flag would imply the row is a stand-in for a
-- real send that will happen elsewhere. It is not; the send is real and the row is an accurate
-- record of the part of it the server participated in.
--
-- ---------------------------------------------------------------------------------------------
-- Why templates are a table
-- ---------------------------------------------------------------------------------------------
-- The ten templates existed as a frozen array in the browser bundle, which meant changing the
-- wording of a reminder was a frontend deploy. They are operational copy: the people who know
-- whether "Is it still available?" is working are the desk staff reading the replies, and they
-- should not need a release to act on that. A table also gives every environment the same library
-- -- the live e2e run can assert on a template that is actually there rather than one the bundle
-- happened to ship.
--
-- `id` is the template's slug rather than a uuid, because these are referenced by name in code,
-- in audit rows and in conversation ("send them wa-aadhaar"), and a uuid would make every one of
-- those an indirection. The slugs are the ones the console already used, so existing muscle memory
-- and any prior audit trail keep meaning the same thing.
--
-- `active` rather than deletion: a retired template must still resolve, because `outbound_message`
-- rows point at it and the Follow-up tab renders their names. Deleting one would either break the
-- foreign key or blank out history that was true when it was written.
--
-- The ten templates themselves -- the ones the console already shipped, copied verbatim, emoji
-- included -- are rows, not schema, and are owned by `R__seed_reference_data.sql`. They are not
-- decoration: these are WhatsApp messages to consumers in Pune, and the register they are written
-- in is the one that gets replies. Rewriting them into house style would be changing the product
-- under cover of a schema change. Their `{var}` placeholders are interpolated at send time; an
-- unknown key is left standing rather than blanked, so a typo shows up as a literal `{owner_nme}`
-- in the preview the staff member reads before sending, instead of silently deleting half a
-- sentence.

create table message_template (
    id          text primary key,
    channel     text        not null check (channel in ('whatsapp', 'sms', 'email')),
    category    text        not null check (category in ('onboarding', 'reminder', 'notification', 'advice', 'verification')),
    name        text        not null,
    body        text        not null,
    active      boolean     not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- The desk lists by channel and hides retired copy; nothing ever scans the whole table.
create index idx_message_template_channel on message_template (channel) where active;

-- ---------------------------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------------------------
-- `body` is the rendered text, stored in full rather than reconstructed from the template plus
-- variables at read time. Templates are editable now, so re-rendering would show a colleague the
-- message as it reads *today* rather than the one the owner was actually sent -- which is the
-- opposite of what a record is for. It also means a row survives its template being retired.
--
-- `recipient_mobile` is stored beside `recipient_user_id` for the same reason: an owner who later
-- changes their number should not retroactively make the log claim the chaser went somewhere it
-- did not. The user reference answers "who", the mobile answers "where it went".
--
-- `subject_type`/`subject_id` rather than a `property_id` column: the first caller is the listing
-- funnel, but the mechanism is not about listings -- a visit no-show or a document chase are the
-- obvious next two, and neither hangs off a property. Same discriminator shape message_attachments
-- used, and for the same reason: the id cannot carry a foreign key when it points at more than one
-- table, so the CHECK on `subject_type` is what stops a row pointing at nothing.

create table outbound_message (
    id               uuid        primary key default gen_random_uuid(),
    channel          text        not null check (channel in ('whatsapp', 'sms', 'email')),
    template_id      text        references message_template (id),
    subject_type     text        not null check (subject_type in ('property')),
    subject_id       uuid        not null,
    recipient_id     uuid        not null references users (id),
    recipient_mobile text        not null,
    body             text        not null,
    status           text        not null default 'prepared' check (status in ('prepared', 'sent', 'failed')),
    prepared_by      uuid        not null references users (id),
    -- clock_timestamp(), not now(). now() returns the transaction's start time, so two chasers
    -- prepared inside one transaction would share a timestamp to the microsecond and the log would
    -- come back in an arbitrary order — the one place where order is the whole point, since the
    -- reader is a colleague asking "what was this owner told last?". clock_timestamp() reads the
    -- wall clock at insert, which is what an event ledger means by when.
    prepared_at      timestamptz not null default clock_timestamp(),
    sent_at          timestamptz,
    failure_reason   text
);

-- Every read is "the outreach for this listing, newest first" -- the Follow-up tab's timeline and
-- the reminder count on a pipeline card are the same query with a different projection.
create index idx_outbound_message_subject on outbound_message (subject_type, subject_id, prepared_at desc);

SELECT install_updated_at_triggers();
