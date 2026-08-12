-- V66 D202: the four schema repairs V63's evidence table needs, and the column that makes an
-- identity sighting falsifiable.
--
-- V63 is checksummed, so none of this can be an edit to it. Everything below is expressed as an
-- alteration of the table V63 created, and the reasoning that belongs beside each one is written
-- here rather than left to the register row that found them.
--
-- 1. THE PROPERTY FOREIGN KEY WAS `ON DELETE CASCADE`, AND THE TABLE'S OWN COMMENT CONTRADICTS IT.
--    V63 says the case file "still shows what the badge was granted on at the time it was granted",
--    and OwnershipVerificationService.revoke says in as many words that the evidence rows are left
--    in place because "deleting them would erase the case at the moment it started to matter". A
--    cascade makes both statements conditional on the listing row outliving the dispute. Nothing in
--    the application deletes a property today -- listings archive, they are not removed, and
--    ErasureRetention retains them outright -- so the cascade has never fired and is not load
--    bearing. That is exactly when it is cheap to close: the first `DELETE FROM properties` anybody
--    ever runs, in a console, against a listing under investigation, is the one that must not
--    silently take the evidence with it. RESTRICT turns that into an error the operator has to read.
--
-- 2. `recorded_by` DECLARED NO `ON DELETE` AT ALL, so it took PostgreSQL's default of NO ACTION.
--    That default happens to be nearly right, which is the reason to state it rather than leave it:
--    a reader cannot tell an intended NO ACTION from an omission, and the three plausible choices
--    here are not interchangeable. CASCADE would delete the evidence when the ops user who recorded
--    it leaves, which is the same case-file loss as (1). SET NULL is not even available -- the
--    column is NOT NULL -- and would be wrong if it were, because "somebody at this company sighted
--    a title deed" without a name is not accountability. RESTRICT is therefore the deliberate
--    choice, and it is safe: erasure here pseudonymises the users row rather than deleting it
--    (ErasureService replaces the mobile and blanks the rest), so no code path is being blocked.
--    RESTRICT over NO ACTION only because RESTRICT cannot be deferred to commit -- the failure
--    should surface on the statement that caused it.
--
-- 3. NOTHING STOPPED A DOCUMENT EXPIRING BEFORE IT WAS ISSUED. Expiry is derived in Java from
--    `issued_at` plus the window for the doc type, so today the pair is always consistent; the
--    CHECK exists because the derivation is one line of application code standing between a
--    mistyped backfill and a row that reads as a document which was never valid for a moment. The
--    NULL branch is the registry and identity documents that never go stale.
--
-- 4. `owner_identity` ROWS RECORDED *THAT* AN IDENTITY WAS SIGHTED, NOT *WHOSE*. This is the defect
--    with a product consequence rather than a hygiene one. The badge asserts that the person
--    listing the flat is the person who owns it, and the evidence behind that assertion was a row
--    saying "an Aadhaar was seen" with no name on it. In a dispute -- the only moment this table is
--    ever read in anger -- that row cannot be checked against anything, so it cannot be wrong, so it
--    proves nothing. `subject_name` is the name as it appears on the document, and the CHECK makes
--    it mandatory for exactly the two doc types whose whole purpose is to name a person.
--
--    The number itself is deliberately NOT stored, not even masked. The comparable columns that do
--    (`identity_verifications.masked_aadhaar`, `owner_kyc.aadhaar_masked`) exist because a
--    verification provider returns them; nothing here needs one. The name is the fact the dispute
--    turns on and is the least that can be held to establish it.

ALTER TABLE property_ownership_evidence
    DROP CONSTRAINT property_ownership_evidence_property_id_fkey;

ALTER TABLE property_ownership_evidence
    ADD CONSTRAINT property_ownership_evidence_property_id_fkey
        FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE RESTRICT;

ALTER TABLE property_ownership_evidence
    DROP CONSTRAINT property_ownership_evidence_recorded_by_fkey;

ALTER TABLE property_ownership_evidence
    ADD CONSTRAINT property_ownership_evidence_recorded_by_fkey
        FOREIGN KEY (recorded_by) REFERENCES users (id) ON DELETE RESTRICT;

ALTER TABLE property_ownership_evidence
    ADD CONSTRAINT property_ownership_evidence_expiry_after_issue
        CHECK (expires_at IS NULL OR expires_at > issued_at);

ALTER TABLE property_ownership_evidence
    ADD COLUMN subject_name text;

-- NOT VALID, and only here. Every row recorded from this migration onward is checked; rows already
-- on file are not, because the name they are missing cannot be reconstructed and a migration that
-- refuses to apply against real data is a migration that gets reverted rather than read. The
-- constraint still does its job -- it is the write path it has to bind.
ALTER TABLE property_ownership_evidence
    ADD CONSTRAINT property_ownership_evidence_identity_names_its_subject
        CHECK (doc_type NOT IN ('aadhaar', 'pan')
               OR (subject_name IS NOT NULL AND btrim(subject_name) <> ''))
        NOT VALID;

COMMENT ON COLUMN property_ownership_evidence.subject_name IS
    'Whose identity was sighted -- the name as it appears on the document (D202). Required for the '
    'identity doc types and optional for the rest, which is what the accompanying CHECK enforces. '
    'Without it an owner_identity row asserts that some identity document was seen without saying '
    'whose, which is unfalsifiable and therefore worthless in the dispute that is the only reason '
    'this table is read. The document number is deliberately not stored, masked or otherwise: the '
    'name is the fact a dispute turns on, and it is the least that establishes it.';

COMMENT ON CONSTRAINT property_ownership_evidence_property_id_fkey ON property_ownership_evidence IS
    'RESTRICT, not CASCADE (D202). The evidence is the record behind a trust claim a buyer relied '
    'on, and the revoke path is written on the promise that it survives. Deleting the listing must '
    'fail loudly rather than quietly take the case file with it.';

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- updated_at column.
SELECT install_updated_at_triggers();
