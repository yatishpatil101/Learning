-- V39 — the paid gate in front of the rent-agreement service request.
--
-- A rent agreement (Leave & License) is the one service desk that charges before ops touches it:
-- the platform fee plus statutory stamp duty and registration are collected up front, and only a
-- settled payment lets the request enter the staff queue. Everything the workflow needs already
-- exists (V7's maker-checker state machine, V21's messages, the Cashfree payment webhook); this
-- migration adds the one state that machine was missing — the request that has been filed but not
-- yet paid for — and the two columns that tie it to a gateway order.
--
-- Why a new status rather than reusing `new`. `new` means "in the queue, waiting for a staffer".
-- A request nobody has paid for is not that: it must be invisible to ops until the money lands, or
-- staff would start drafting agreements that were never bought. `awaiting-payment` is that pre-queue
-- state, and it is reachable only at creation and left only by the payment webhook.

-- The inline CHECK from V7 is auto-named service_requests_status_check (see V23 for the same dance
-- on subscriptions/boosts). Drop and re-add with the new value at the front, where the lifecycle
-- now begins for a priced request.
ALTER TABLE service_requests DROP CONSTRAINT service_requests_status_check;
ALTER TABLE service_requests ADD CONSTRAINT service_requests_status_check
    CHECK (status IN ('awaiting-payment','new','assigned','in-progress','draft-shared','approved','completed','cancelled'));

-- What the customer was charged, in whole rupees (Money is int64). Null for a free service desk
-- (a legal opinion is not priced); set once, at creation, from the published rent fee breakdown.
ALTER TABLE service_requests ADD COLUMN amount bigint;

-- The Cashfree order id, and how the payment webhook finds this row again. Unique, partial: many
-- requests carry no order (the free desks, and every request created before this migration), and a
-- null must never collide with another null — the same shape subscriptions and boosts use (V23).
ALTER TABLE service_requests ADD COLUMN payment_ref text;
CREATE UNIQUE INDEX uq_service_requests_payment_ref
    ON service_requests (payment_ref) WHERE payment_ref IS NOT NULL;
