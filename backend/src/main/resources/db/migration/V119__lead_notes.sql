-- Owner-private lead annotations: the note and follow-up date an owner keeps against one request.
--
-- `leadNotes.js` has held these in `localStorage` under `puneNestLeadNotes:<ownerDigits>` since the
-- prototype, and its own header called that a placeholder ("there is no backend yet ... the shapes
-- are intentionally minimal so a future backend can adopt them 1:1"). This is that adoption. The
-- practical failure it fixes is mundane and total: an owner who works leads on their phone and then
-- opens the dashboard on a laptop sees an empty note column, and clearing site data wipes the only
-- copy. Notes are the one thing in the Requests inbox the owner authored themselves.
--
-- `lead_key` is TEXT and deliberately NOT a foreign key.
--
-- The Requests inbox is a union of four unrelated tables -- `contact_requests` (V4),
-- `photo_requests` (V117), document requests, and `flatmate_requests` -- and the client mints a
-- stable composite id per row: 'number:<uuid>', 'photo:<uuid>', 'flatmate:<uuid>',
-- 'documents:<requesterId>|<propertyId>'. That last one is not a row id at all; it is a grouping key
-- over several document rows, so there is no table it could point at even in principle.
--
-- The two alternatives were both worse. A polymorphic FK is not a thing Postgres will enforce, so
-- it would be an FK in name only. Four nullable columns with a CHECK that exactly one is set would
-- be honest about the first three and still leave the document group homeless, and it would make
-- every read a four-way LEFT JOIN to reconstruct a key the client already has in hand. So the server
-- treats `lead_key` as opaque: it stores and returns it, and never parses it.
--
-- The cost of that choice, stated plainly: nothing cascades. If a contact request is ever hard
-- deleted its note is orphaned rather than removed. That is tolerable here because these rows are
-- answered rather than deleted (see V117's note on the same decision), and because an orphaned note
-- is invisible -- the inbox only ever looks up keys for leads it is already rendering.
CREATE TABLE lead_notes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Always taken from the JWT, never from a request body. This column plus the unique index below
    -- is what makes these private: there is no endpoint that reads a note by id alone, so a note is
    -- reachable only through the owner who wrote it.
    owner_id     uuid NOT NULL REFERENCES users(id),

    lead_key     text NOT NULL,

    -- Bounded even though the server never parses it. `uq_lead_notes_owner_lead` is a btree, and a
    -- btree entry over 2704 bytes is rejected at INSERT with an internal error rather than a
    -- constraint failure -- so without this, an authenticated caller sending a 3000-character key
    -- gets a 500 from a code path nobody wrote. 200 is a little over three times the longest key the
    -- client mints today ('documents:<buyerMobile>|<propertyId>', 57 characters with a UUID property
    -- id), which leaves room for a fifth lead source without leaving room for abuse. The controller
    -- carries the same bound so the ordinary answer is a 422.
    --
    -- That document key is built from the buyer's mobile number, unmasked, so this column holds
    -- personal data despite looking like a handle. It is only ever read back by the owner who wrote
    -- it -- who already has the number, which is why they were shown it -- but do not log it, expose
    -- it to search, or treat it as anonymous on the strength of the other three shapes.
    CONSTRAINT lead_notes_key_length CHECK (length(lead_key) <= 200),

    -- Both nullable, and a row with both null is meaningless -- so the CHECK forbids it and the
    -- service deletes rather than storing one. Without this, clearing a note would leave a blank row
    -- behind and "does this lead have a note" would stop being answerable by existence.
    note         text,
    follow_up_at timestamptz,

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT lead_notes_not_empty
        CHECK (note IS NOT NULL OR follow_up_at IS NOT NULL),

    -- Same argument as `lead_notes_key_length`, and it deserves to be made twice rather than left
    -- implied. The controller bounds `note` at 2000, but a bound that lives only in a DTO holds only
    -- for writers that pass through the controller -- a corrective UPDATE, an import, a later
    -- endpoint that forgets the annotation. The note is read back unpaged, all of an owner's rows at
    -- once, so an unbounded column is the one field here where a single oversized row is felt by
    -- every subsequent read. Matching numbers on purpose: if the product ever wants longer notes,
    -- both bounds should move together and this constraint is what makes that impossible to forget.
    CONSTRAINT lead_notes_note_length CHECK (note IS NULL OR length(note) <= 2000)
);

-- One annotation per lead per owner, which is what makes the write an upsert rather than an append.
-- This is also the read path: the inbox fetches every note the owner has and indexes them by key
-- client-side, exactly as the localStorage version did, so `owner_id` leads the index.
CREATE UNIQUE INDEX uq_lead_notes_owner_lead ON lead_notes (owner_id, lead_key);

-- Keeps `updated_at` honest for writers that are not Hibernate (V1). It matters more here than
-- usual: the response echoes this column back so the panel can show when a note was last touched,
-- so a stale value is not an internal detail but something the owner reads.
SELECT install_updated_at_triggers();
