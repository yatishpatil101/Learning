-- V21 Service requests & the staff ticket queue (slice 11). V7 built the aggregate but left the
-- conversation out of it and indexed neither list the contract actually asks for.

-- ServiceRequest.messages[] had nowhere to live. V7 gave the aggregate a timeline (system events,
-- `event`/`by`) but no chat, and the two are not the same thing: a timeline entry is written by the
-- server to say what happened, a message is written by a person to say something. Folding messages
-- into the timeline would have made "staff said the deed is missing" indistinguishable from
-- "status changed to in-progress", and would have put customer free text in an audit trail.
-- Shaped after support_ticket_messages (V8) so the two conversation surfaces read the same.
-- No `attachments` column, though MessageCreate documents the field: the Message response schema
-- has nowhere to render one, and this aggregate already has a real upload surface in
-- POST /service-requests/{id}/docs. A column nothing can write and nothing can read back is not
-- storage, it is a promise. The field is accepted and dropped, exactly as the verification thread
-- does, and that is written down at the controller rather than implied by a dead column.
CREATE TABLE service_request_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  uuid NOT NULL REFERENCES service_requests(id),
    author_id   uuid REFERENCES users(id),
    author_role text CHECK (author_role IN ('buyer','owner','staff','admin')),
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_request_messages_request
    ON service_request_messages (request_id, created_at);

-- GET /service-requests for a customer is "my requests, newest first"; V7 indexed only `status`,
-- which is the staff queue's filter and no use at all to the owner of the row.
CREATE INDEX idx_service_requests_requester
    ON service_requests (requester_id, created_at DESC);

-- The staff queue filters on type (the service desk a request belongs to) and orders newest-first.
CREATE INDEX idx_service_requests_type_created
    ON service_requests (type, created_at DESC);

-- GET /tickets is ordered newest-first in every variant. V7's (team, status) serves the filter and
-- nothing serves the sort, so every page would have been a filesort over the whole queue.
CREATE INDEX idx_tickets_created ON tickets (created_at DESC);
