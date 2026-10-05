-- A paper the customer filed is not a paper the desk accepted.
--
-- The checklist only knew whether a file sat under each category, so a blurred Aadhaar, the wrong
-- flat's Index II or an expired POA counted as "received" and the deed was drafted from it. One row
-- per reviewed document: the desk verifies it, or rejects it with the reason the customer re-uploads
-- from. A re-upload is a new document with no row, so it is unreviewed again by construction.

CREATE TABLE service_request_document_reviews (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid         NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    document_id        uuid         NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    verdict            varchar(10)  NOT NULL CHECK (verdict IN ('verified', 'rejected')),
    reason             varchar(300),
    reviewed_by        uuid         REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at        timestamptz  NOT NULL DEFAULT now(),
    created_at         timestamptz  NOT NULL DEFAULT now(),
    CHECK (verdict = 'verified' OR reason IS NOT NULL)
);

CREATE INDEX idx_service_request_document_reviews_request
    ON service_request_document_reviews (service_request_id);
