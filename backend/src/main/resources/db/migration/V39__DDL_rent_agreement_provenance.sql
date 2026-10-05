-- A rent agreement record is born from the paid service request that produced it.
--
-- `rent_agreements` is the evidence the flatmate trust sweep reads to grant the Tenant-verified
-- badge with no human looking. Until now nothing in the product wrote a row: the paid drafting flow
-- ended at the registered copy, and the only writers were a self-filing endpoint with no caller and
-- a staff PATCH that needed no evidence. The row is now created by the final-document upload, one
-- per tenant mobile, and becomes `registered` only when a second staff member checks it.
--
-- final_document_id replaces the free-text document_url as evidence: the vault mints a short-lived
-- signed URL on read, so a stored URL would expire while the row still claimed it as proof.

ALTER TABLE rent_agreements
    ADD COLUMN service_request_id uuid REFERENCES service_requests(id),
    ADD COLUMN final_document_id  uuid REFERENCES documents(id),
    ADD COLUMN prepared_by        uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN verified_by        uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX uq_rent_agreements_request_tenant
    ON rent_agreements (service_request_id, tenant_mobile)
    WHERE service_request_id IS NOT NULL;

COMMENT ON COLUMN rent_agreements.prepared_by IS
    'The staff member whose final-document upload created the row. Never the verifier: '
    'RentAgreementService refuses registered from the same account (four eyes).';
COMMENT ON COLUMN rent_agreements.verified_by IS
    'The second staff member who checked the registered copy and moved the row to registered.';
