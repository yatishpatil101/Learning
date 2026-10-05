-- A refund leaves the platform only on two operators' word (D-b): one asks, a different one approves,
-- and only then is the gateway called. Each refund draws on a single gateway order, because the
-- gateway refunds per order and a refund split across two orders could half-succeed.

CREATE TABLE service_request_refunds (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid         NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    order_id           text         NOT NULL,
    amount             bigint       NOT NULL CHECK (amount > 0),
    duty_paid          boolean      NOT NULL,
    grn                varchar(25),
    reason             varchar(300) NOT NULL,
    status             varchar(10)  NOT NULL CHECK (status IN ('requested', 'approved', 'rejected')),
    requested_by       uuid         REFERENCES users(id) ON DELETE SET NULL,
    decided_by         uuid         REFERENCES users(id) ON DELETE SET NULL,
    decided_at         timestamptz,
    decision_note      varchar(300),
    gateway_refund_id  text         UNIQUE,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    CHECK ((status = 'requested') = (decided_at IS NULL)),
    CHECK (NOT duty_paid OR grn IS NOT NULL),
    CHECK ((status = 'approved') = (gateway_refund_id IS NOT NULL))
);

CREATE UNIQUE INDEX uq_service_request_refunds_open
    ON service_request_refunds (service_request_id) WHERE status = 'requested';
