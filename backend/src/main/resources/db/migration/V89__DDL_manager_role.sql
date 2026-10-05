ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_role_check;
ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_actor_role_check
    CHECK (actor_role IN ('buyer','owner','staff','manager','admin'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('buyer','owner','staff','manager','admin'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_author_role_check;
ALTER TABLE messages
    ADD CONSTRAINT messages_author_role_check
    CHECK (author_role IN ('buyer','owner','staff','manager','admin'));

ALTER TABLE service_request_messages DROP CONSTRAINT IF EXISTS service_request_messages_author_role_check;
ALTER TABLE service_request_messages
    ADD CONSTRAINT service_request_messages_author_role_check
    CHECK (author_role IN ('buyer','owner','staff','manager','admin'));

ALTER TABLE support_ticket_messages DROP CONSTRAINT IF EXISTS support_ticket_messages_author_role_check;
ALTER TABLE support_ticket_messages
    ADD CONSTRAINT support_ticket_messages_author_role_check
    CHECK (author_role IN ('buyer','owner','staff','manager','admin'));
