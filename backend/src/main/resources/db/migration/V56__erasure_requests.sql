-- V56 erasure_requests — the DPDP right-to-erasure spine (D177).
--
-- WHAT THE LAW ACTUALLY ASKS FOR
-- ------------------------------
-- Digital Personal Data Protection Act 2023 s.12(3) gives a Data Principal the right to have their
-- personal data erased. s.8(7) is the boundary and the more interesting half: the Data Fiduciary
-- must erase on withdrawal of consent or when the purpose is served, "unless retention is necessary
-- for compliance with any law for the time being in force". So the obligation is not "delete the
-- person's rows"; it is "stop being able to identify them, except where another statute requires
-- you to keep identifying them, and be able to say which is which".
--
-- That last clause is why this is a table and not a DELETE statement. A platform that erases and
-- keeps no record of having erased cannot answer a Data Principal who asks whether it complied, and
-- cannot show a regulator what it kept or why. A platform that keeps a record naming the person has
-- built a directory of everybody who asked to be forgotten, which is worse than the original problem.
--
-- HOW THE AUDIT RECORD AVOIDS BEING A RE-IDENTIFICATION SURFACE
-- ------------------------------------------------------------
-- `subject_id` is a live FK to users(id) while the request is pending -- it has to be; nothing could
-- be executed otherwise -- and is set to NULL at execution. What survives is `subject_digest`:
-- SHA-256 over a deployment-held pepper and the subject's UUID. It is a *verifier*, not an index.
-- Given a UUID you can confirm "yes, this request concerned that account"; given the table you
-- cannot enumerate who was erased, because the pre-images are 128-bit random UUIDs and the pepper is
-- not in the database. That asymmetry is the whole design: the record can answer the one question
-- accountability needs answered and none of the questions that would make it a leak.
--
-- The digest deliberately does NOT key off the mobile number. A mobile is a ten-digit value from a
-- space small enough to enumerate exhaustively in seconds, so a digest of one is a reversible
-- pointer to the person wearing a hash's clothing. The UUID is the only identifier here whose
-- pre-image space is large enough for a digest to mean anything.
--
-- WHY A REQUEST ROW AND NOT AN IMMEDIATE DELETE ON THE ENDPOINT
-- ------------------------------------------------------------
-- Erasure is the one destructive act on this platform that cannot be undone by the person it was
-- done to -- afterwards there is no account left to appeal from. Three things need to happen between
-- the ask and the act, and none of them fits inside a request handler: a cooling-off window (a
-- tapped button, a coerced tenant, a compromised session), a check for live obligations (an open
-- tenancy, an unsettled payment), and a human decision recorded against a named admin. The row is
-- where those live.
--
-- `erased` and `retained` are written at execution and are the substance of the record: what was
-- removed, table by table with row counts, and what was kept, category by category with the statute
-- that required keeping it. Counts and category names only -- never a value, never a column's
-- contents. "We kept 3 rent agreements under the Limitation Act" is accountability; the addresses on
-- them would be the leak this table exists to avoid.
--
-- ON DELETE: nothing here cascades from users. That is the point -- the audit record must outlive
-- the account, and a cascade would delete the proof of erasure along with the thing erased.
CREATE TABLE erasure_requests (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The subject, while the request is live. NULLed at execution; `subject_digest` takes over.
    -- Nullable from the start rather than NOT NULL + a sentinel, because "this request no longer
    -- names anybody" is exactly what NULL means and a sentinel UUID would need its own explanation.
    subject_id     uuid REFERENCES users(id),

    -- SHA-256(pepper || subject_id), lowercase hex. Survives execution. See the header.
    subject_digest text        NOT NULL,

    status         text        NOT NULL DEFAULT 'pending',
    reason         text,                              -- the subject's own words, optional

    requested_at   timestamptz NOT NULL DEFAULT now(),

    -- The deciding admin. Kept in the clear, unlike the subject: this half of the row is ops
    -- accountability, and an anonymous erasure decision is a power nobody can be held to. Staff
    -- acting in role are not the Data Principal this table is protecting.
    decided_by     uuid REFERENCES users(id),
    decided_at     timestamptz,
    decision_note  text,

    -- What was removed / kept. Counts and category names, never values.
    erased         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    retained       jsonb       NOT NULL DEFAULT '{}'::jsonb,

    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT erasure_requests_status_check
        CHECK (status IN ('pending', 'completed', 'rejected')),

    -- A completed request must not still name its subject. This is the invariant the whole design
    -- rests on, so it is enforced by the database rather than by remembering to call the right
    -- method: a future writer that forgets to NULL `subject_id` gets a constraint violation instead
    -- of quietly leaving a directory of erased people behind.
    CONSTRAINT erasure_requests_completed_is_anonymous
        CHECK (status <> 'completed' OR subject_id IS NULL),

    -- A decided request records who decided it and when. Half a decision is not a decision.
    CONSTRAINT erasure_requests_decided_is_attributed
        CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

-- One live request per subject. Without it, a subject tapping twice files two requests and the
-- second executes against an account the first already emptied -- recording a second erasure that
-- erased nothing, which is a false entry in the one table that exists to be true.
-- Partial, because completed requests keep subject_id NULL and NULLs are not equal to each other
-- anyway; being explicit says which state the rule is about.
CREATE UNIQUE INDEX uq_erasure_requests_live_subject
    ON erasure_requests (subject_id)
    WHERE status = 'pending' AND subject_id IS NOT NULL;

-- The admin queue reads pending-first, newest-first.
CREATE INDEX idx_erasure_requests_status_requested
    ON erasure_requests (status, requested_at DESC);

-- "Did you erase me?" answered from a UUID the asker already holds.
CREATE INDEX idx_erasure_requests_digest
    ON erasure_requests (subject_digest);

COMMENT ON TABLE erasure_requests IS
    'DPDP s.12(3) erasure requests. subject_id is live only while pending; a completed row is '
    'identified solely by subject_digest = SHA-256(pepper || subject uuid), which verifies a '
    'known id but cannot enumerate erased subjects. erased/retained hold counts and category '
    'names only.';

COMMENT ON COLUMN erasure_requests.retained IS
    'Category -> statutory basis for keeping it. Written at execution so the reason travels with '
    'the decision rather than living only in code that may later change.';

-- NOTE ON users.mobile, WHICH IS THE ONE COLUMN ERASURE CANNOT SIMPLY BLANK
-- ------------------------------------------------------------------------
-- It is NOT NULL, UNIQUE, and CHECKed against '^[6-9][0-9]{9}$' (V2). All three must keep holding
-- after erasure, so the number cannot be NULLed and two erased users cannot collapse onto one
-- shared placeholder. The service therefore writes a deterministic pseudonym derived from the row's
-- own id -- see ErasureService.pseudonymMobile, where the derivation and its limits are set out.
--
-- The pseudonym is computed in Java rather than by a SQL function on purpose: it is a rule about
-- what a value means, it needs a unit test that can go red, and a function here would be a second
-- place for that rule to live and drift.
--
-- No schema change is made to relax the CHECK. Relaxing a constraint that holds for every real row
-- on the platform, in order to accommodate a handful of erased ones, would weaken the column's
-- guarantee everywhere to make one code path tidier.
