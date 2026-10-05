-- A registered leave-and-licence is identified by what the Sub-Registrar gave it, not by a file.
--
-- Until now the desk's only proof of registration was the uploaded copy. Nothing structured said
-- which office registered it, under which number, on which day, or which GRAS challan paid the duty,
-- so the second operator had nothing to check the copy against and nobody could find a deed by its
-- number. One row per completed rent-agreement request, written with the final-document upload.
--
-- A document number is unique within one Sub-Registrar office and year, and a GRAS challan (GRN)
-- pays for one document: either repeating means a copy recorded twice or a challan reused.

CREATE TABLE service_request_registrations (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid        NOT NULL UNIQUE REFERENCES service_requests(id),
    document_no        varchar(40) NOT NULL,
    sro                varchar(60) NOT NULL,
    registered_on      date        NOT NULL,
    grn                varchar(25) NOT NULL,
    stamp_duty         bigint      NOT NULL CHECK (stamp_duty >= 0),
    registration_fee   bigint      NOT NULL CHECK (registration_fee >= 0),
    recorded_by        uuid        REFERENCES users(id) ON DELETE SET NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_service_request_registrations_document
    ON service_request_registrations (lower(sro), upper(document_no), (extract(year from registered_on)));

CREATE UNIQUE INDEX uq_service_request_registrations_grn
    ON service_request_registrations (upper(grn));
