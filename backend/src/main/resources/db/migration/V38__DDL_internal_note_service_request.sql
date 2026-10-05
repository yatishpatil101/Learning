-- A service request takes internal notes, like every other queue ops works.
--
-- `internal_notes` has held four kinds since V7 -- property, user, review, report -- and the
-- property verification flow leans on them: the reviewer's private reasoning beside the decision,
-- with a history, so the next person to open the case knows what the last one already ruled out.
-- The assisted-service desk (rent agreements, valuations, legal opinions) had no such surface. Its
-- only durable text was `service_request_messages`, which the customer reads, and `audit_log`,
-- which nobody reads. An operator with something to say about a matter -- "the owner's PAN on the
-- ownership proof is not the owner's", "third attempt at the sub-registrar, office shut" -- had
-- nowhere to put it that a colleague would find, so it went into a chat window or nowhere.
--
-- The word is `service_request` and not `request` or `service-request`: it is the table's name, and
-- it is what `audit_log.entity_type` already calls the same thing. `NoteEntityKey` needs no change
-- -- a request is addressed by uuid alone, so it passes through the slug resolution untouched, as
-- user, review and report do.

ALTER TABLE internal_notes
    DROP CONSTRAINT internal_notes_entity_type_check;

ALTER TABLE internal_notes
    ADD CONSTRAINT internal_notes_entity_type_check
        CHECK (entity_type IN ('property', 'user', 'review', 'report', 'service_request'));

COMMENT ON COLUMN internal_notes.entity_type IS
    'What the note is about, mirrored in NoteEntityTypes. Widened by V38 to admit service_request. '
    'The list is written twice on purpose: this CHECK refuses a bad row even if a future caller '
    'reaches the table another way, and the API refuses it with a 422 rather than a constraint '
    'violation.';
