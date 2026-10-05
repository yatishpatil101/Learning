ALTER TABLE service_request_parties
    ADD COLUMN party_index integer NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS uq_service_request_parties_role;

CREATE UNIQUE INDEX uq_service_request_parties_role_index
    ON service_request_parties (request_id, role, party_index);
