-- A rent agreement is priced once, at filing, on the rent, deposit and term the customer typed, and
-- the stamp duty in that price is what the platform remits on GRAS. A change asked for after payment
-- moves the duty, so the desk proposes the new terms here, the requester accepts them, and a higher
-- price is paid before the draft is shared again. A lower price is recorded, not refunded: refunds
-- wait on the refund policy.

CREATE TABLE service_request_amendments (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid         NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    terms              jsonb        NOT NULL,
    reason             varchar(300) NOT NULL,
    amount_before      bigint       NOT NULL CHECK (amount_before >= 0),
    amount_after       bigint       NOT NULL CHECK (amount_after >= 0),
    status             varchar(10)  NOT NULL CHECK (status IN ('proposed', 'applied', 'withdrawn')),
    payment_ref        text         UNIQUE,
    proposed_by        uuid         REFERENCES users(id) ON DELETE SET NULL,
    decided_by         uuid         REFERENCES users(id) ON DELETE SET NULL,
    decided_at         timestamptz,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    CHECK ((status = 'proposed') = (decided_at IS NULL))
);

CREATE UNIQUE INDEX uq_service_request_amendments_open
    ON service_request_amendments (service_request_id) WHERE status = 'proposed';
