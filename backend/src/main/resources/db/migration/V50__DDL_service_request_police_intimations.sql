CREATE TABLE service_request_police_intimations (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid        NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE,
    confirmed_by       uuid        REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at       timestamptz NOT NULL DEFAULT now(),
    reference          varchar(80),
    submitted_on       date,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_request_police_intimations_request
    ON service_request_police_intimations (service_request_id);
