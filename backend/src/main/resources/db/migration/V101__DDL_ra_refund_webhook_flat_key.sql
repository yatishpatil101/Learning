-- A refund the gateway reports as cancelled keeps its gateway id, so the "has an id" rule covers both
-- outcomes; only an approved one still counts against what can be refunded.
ALTER TABLE service_request_refunds
    DROP CONSTRAINT service_request_refunds_status_check,
    DROP CONSTRAINT service_request_refunds_check2;
ALTER TABLE service_request_refunds
    ADD CONSTRAINT service_request_refunds_status_check
        CHECK (status IN ('requested', 'approved', 'rejected', 'failed')),
    ADD CONSTRAINT service_request_refunds_gateway_ref_check
        CHECK ((status IN ('approved', 'failed')) = (gateway_refund_id IS NOT NULL));

-- Set when the gateway confirms the top-up's order was paid, whatever became of the amendment, so a
-- payment taken for withdrawn terms is still a refundable leg.
ALTER TABLE service_request_amendments ADD COLUMN paid_at timestamptz;

-- The one definition of "the same flat" for the overlap check; RentAgreementOverlaps#flatKey must agree.
CREATE FUNCTION rent_agreement_flat_key(details jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN k.flat = '' OR k.society = '' OR k.pincode = '' THEN NULL
                ELSE k.flat || '|' || k.society || '|' || k.pincode END
    FROM (SELECT
        regexp_replace(regexp_replace(regexp_replace(lower(coalesce(details #>> '{_state,prop,flatNo}', '')),
            '\m(flat|no|number|unit|apt|apartment)\M', '', 'g'), '[^a-z0-9]', '', 'g'), '^0+', '') AS flat,
        regexp_replace(lower(coalesce(details #>> '{_state,prop,society}', '')), '[^a-z0-9]', '', 'g') AS society,
        regexp_replace(lower(coalesce(details #>> '{_state,prop,pincode}', '')), '[^a-z0-9]', '', 'g') AS pincode) k
$$;

CREATE INDEX idx_service_requests_rent_agreement_flat
    ON service_requests (rent_agreement_flat_key(details))
    WHERE type = 'rent-agreement';