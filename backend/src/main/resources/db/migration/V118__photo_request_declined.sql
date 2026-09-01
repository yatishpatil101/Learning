-- An owner can now say no to a photo request, and the column that records the answer is renamed to
-- admit that it holds an answer rather than an outcome.
--
-- V117 argued the opposite, in `PhotoRequestStatuses`' own docblock: "there is nothing here for an
-- owner to decline -- the request asks for photos, not for permission, and an owner who does not
-- want to add any simply does not." That reasoning is sound about *permission* and wrong about
-- *feedback*. Doing nothing is indistinguishable from not having looked, so the buyer waits on a
-- listing that is never going to gain a photo, and the owner keeps a badge they cannot clear
-- honestly -- their only exits were to add photos they do not have, or to mark satisfied a request
-- they did not satisfy. `declined` is the missing terminal state, and it is terminal on purpose: it
-- closes the loop for the buyer without pretending the photos arrived.
--
-- `resolved_at` -> `decided_at`, because the moment the owner acts is one instant regardless of
-- which way they went, and a column named for one of two outcomes would either need a sibling
-- (`declined_at`, forever mutually exclusive with it) or would quietly hold decline timestamps
-- under a name that says otherwise. The latter is what a smaller diff would have bought, and it is
-- exactly the "two entities in a trench coat" V117 declined to build one table over.
--
-- Safe to rename rather than add-and-backfill: every existing row's timestamp already means "when
-- the owner acted", which is what the new name says. No value changes.
ALTER TABLE photo_requests RENAME COLUMN resolved_at TO decided_at;

-- Postgres has no ALTER CONSTRAINT for a CHECK expression, so this is a drop and re-add. Named
-- explicitly on the way back in: V117 let Postgres mint `photo_requests_status_check`, and the next
-- migration to widen this set should not have to look up what it was called.
--
-- No IF EXISTS, deliberately, and the reasoning is the reverse of the usual. The name being dropped
-- is one Postgres minted rather than one we chose -- V117 declares the check inline on the column,
-- which Postgres names `<table>_<column>_check` -- so the statement rests on a naming default rather
-- than on anything in this repository. That is an argument for making a wrong guess loud, not quiet.
-- With IF EXISTS, a name that did not match would drop nothing, the ADD below would then succeed
-- under our name, and the old two-value constraint would survive alongside it: a migration that
-- reports success and leaves every `declined` write failing as a 409 that reads like contention.
-- Without it, the same mistake aborts the deploy and names itself.
ALTER TABLE photo_requests DROP CONSTRAINT photo_requests_status_check;
ALTER TABLE photo_requests ADD CONSTRAINT photo_requests_status_check
    CHECK (status IN ('pending', 'resolved', 'declined'));

-- `uq_photo_requests_requester_property` is deliberately left alone. It is still not scoped by
-- status, so a declined request also blocks a re-ask -- which is the point: a buyer who has been
-- told no should not be able to ask again by tapping twice, and the row remains the record that
-- one distinct person wanted this. Scoping the index to `pending` here would have turned "no" into
-- a rate limit.

-- V117 created `photo_requests` without this, which V1 asks every table-creating migration to end
-- with. The omission is invisible today because every write goes through Hibernate, which stamps
-- `updated_at` itself -- and wrong the first time anyone runs a corrective UPDATE by hand, which is
-- exactly the situation the trigger exists for. The installer is idempotent and scans every table,
-- so retro-fitting it here costs nothing.
SELECT install_updated_at_triggers();
