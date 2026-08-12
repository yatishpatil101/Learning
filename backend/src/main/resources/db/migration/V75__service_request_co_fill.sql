-- V75 — the two-sided rent agreement: a named counterparty, a real change-request state, and a
-- read receipt (D121).
--
-- Three defects with one cause: the service-request aggregate was modelled as one customer's
-- paperwork, and a Leave & License agreement is two people's. The frontend mock had worked around
-- all three in localStorage (serviceFlow.createCoFill / listForParty / markRead), so the shapes
-- existed in the product and nowhere in the database.

-- ---------------------------------------------------------------------------------------------
-- 1. The counterparty.
--
-- A rent agreement is co-filled: the owner supplies their half, the tenant supplies theirs, and
-- both halves have to land on one request or the draft cannot be produced. Until now every request
-- was scoped to `requester_id` alone, so the second party had no row anywhere and therefore no way
-- to fetch, let alone contribute to, the matter they are a party to.
--
-- **Keyed on `user_id`, not on a mobile number.** The mock addressed its invite to the other
-- party's mobile and let anyone holding the generated invite id open it — a bearer token in a
-- WhatsApp link, sent over a channel we do not control, granting sight of a rent, a deposit and two
-- sets of identity documents. Storing the mobile here would have reproduced that: the row would be
-- a claim about a person nobody had authenticated, and matching it later would mean trusting
-- whoever ends up registering that number. The invite therefore resolves the mobile to an existing
-- account at the moment it is written and stores the account. The number itself is never persisted,
-- which is also why this table needs no entry in the erasure classification — it holds no personal
-- data, only two foreign keys to the table that does.
--
-- The cost of that choice is real and deliberate: you cannot invite somebody who has not signed up.
-- That is the correct trade. The counterparty has to sign in to fill their half and to upload their
-- Aadhaar regardless, so the account is required a moment later in every case; requiring it a
-- moment earlier is what removes the unauthenticated window.
CREATE TABLE service_request_parties (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  uuid NOT NULL REFERENCES service_requests(id),
    user_id     uuid NOT NULL REFERENCES users(id),
    -- Which side of the agreement they are. Paired to the request, not to the user: the same
    -- person is an owner on one matter and a tenant on another.
    role        text NOT NULL CHECK (role IN ('owner', 'tenant')),
    -- `invited` sees nothing but the invitation itself; only `accepted` widens the request's read
    -- scope. See CoFillParties for why the pending state deliberately reveals no request content:
    -- a mistyped mobile that resolves to a real stranger must not hand them the paperwork while
    -- the requester is still working out that they got the number wrong.
    status      text NOT NULL DEFAULT 'invited'
                CHECK (status IN ('invited', 'accepted', 'declined')),
    invited_by  uuid NOT NULL REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One party per side. The constraint that makes the aggregate two-sided rather than n-sided, and
-- the reason a second invite to the same role is a 409 rather than a silent second row that would
-- leave two people each believing they were the tenant.
CREATE UNIQUE INDEX uq_service_request_parties_role
    ON service_request_parties (request_id, role);

-- And one row per person per request, so inviting the same account as both sides — or twice as the
-- same side after a decline — cannot produce a duplicate.
CREATE UNIQUE INDEX uq_service_request_parties_user
    ON service_request_parties (request_id, user_id);

-- "What am I invited to", and the participant test that every read of a request now runs.
CREATE INDEX idx_service_request_parties_user
    ON service_request_parties (user_id, status);

-- ---------------------------------------------------------------------------------------------
-- 2. `changes-requested`.
--
-- V7's maker-checker offered approve and reject, and reject moved the request back to
-- `in-progress`. That reads as "ops is working on it", which is indistinguishable from the state
-- the request was in before the draft was ever shared — so from the read shape alone a customer
-- who had rejected a draft could not tell that they had, and neither could the operator picking
-- the request up. The rejection was recorded in the audit log and nowhere a person looks.
--
-- V39 did this same dance for `awaiting-payment` and its comment applies unchanged: the inline
-- CHECK from V7 is auto-named service_requests_status_check.
ALTER TABLE service_requests DROP CONSTRAINT service_requests_status_check;
ALTER TABLE service_requests ADD CONSTRAINT service_requests_status_check
    CHECK (status IN ('awaiting-payment', 'new', 'assigned', 'in-progress', 'draft-shared',
                      'changes-requested', 'approved', 'completed', 'cancelled'));

-- ---------------------------------------------------------------------------------------------
-- 3. The read receipt.
--
-- `markServiceRequestRead` was a client-side no-op: the frontend computed an unread count from a
-- browser bucket, so the badge cleared on the device that opened the thread and stayed lit on every
-- other one. A nullable timestamp rather than a boolean because "when" is free here and answers the
-- support question the flag cannot ("they saw it on Tuesday and still have not replied").
--
-- On the message rather than in a per-reader table: this thread has exactly two sides, a customer
-- and whichever operator is on the desk, and a receipt per reader would model an audience that does
-- not exist. `read_at` means "seen by the side that did not write it", which is the only reading
-- either side asks for.
ALTER TABLE service_request_messages ADD COLUMN read_at timestamptz;

-- Partial: the sweep only ever touches unread rows on one request, and the index that serves it
-- should not carry the read ones it will never look at again.
CREATE INDEX idx_service_request_messages_unread
    ON service_request_messages (request_id)
    WHERE read_at IS NULL;

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- updated_at column.
SELECT install_updated_at_triggers();
