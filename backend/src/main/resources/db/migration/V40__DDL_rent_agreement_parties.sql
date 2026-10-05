-- A leave-and-licence is executed by every licensor, every licensee and two witnesses, and the
-- Sub-Registrar checks each of them by Aadhaar biometrics. The identity channel gains the witness role
-- so the desk has their numbers, and a service-request document no longer needs a listing: the wizard
-- is routinely opened for a flat that was never listed, and its papers are required before checkout.

ALTER TABLE service_request_identities
    DROP CONSTRAINT service_request_identities_role_check,
    ADD CONSTRAINT service_request_identities_role_check
        CHECK (party_role IN ('owner', 'tenant', 'witness'));

ALTER TABLE documents
    ALTER COLUMN property_id DROP NOT NULL,
    ADD CONSTRAINT documents_subject_check
        CHECK (property_id IS NOT NULL OR service_request_id IS NOT NULL);
