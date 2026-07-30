-- V9 One contact request per (requester, listing).
--
-- The API has always promised idempotency -- re-requesting returns the existing status rather than
-- opening a second lead -- but until now that promise lived only in ContactService's check-then-insert,
-- which two concurrent double-taps can slip through. A duplicate row is not a cosmetic problem: it
-- would double an owner's inbox and break the single-row lookup the gate depends on.
--
-- Same posture as identity_verifications.identity_hash: the application fails gracefully, the database
-- is what actually guarantees it. The index also serves the (requester_id, property_id) lookup itself,
-- so idx_contact_requests_requester becomes its prefix and is left in place for the requester-only scan.
ALTER TABLE contact_requests
    ADD CONSTRAINT uq_contact_requests_requester_property UNIQUE (requester_id, property_id);
