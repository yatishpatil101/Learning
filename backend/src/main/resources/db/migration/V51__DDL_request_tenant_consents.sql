ALTER TABLE rent_agreement_tenant_consents
    ADD COLUMN request_id uuid REFERENCES service_requests(id) ON DELETE CASCADE,
    ADD COLUMN tenant_name text;

ALTER TABLE rent_agreement_tenant_consents
    DROP CONSTRAINT IF EXISTS rent_agreement_tenant_consents_granted_to_tenant_mobile_key;

CREATE UNIQUE INDEX uq_rent_agreement_tenant_consents_request_tenant
    ON rent_agreement_tenant_consents (request_id, tenant_mobile, tenant_name)
    WHERE request_id IS NOT NULL;

CREATE INDEX idx_rent_agreement_tenant_consents_request
    ON rent_agreement_tenant_consents (request_id, consented_at);
