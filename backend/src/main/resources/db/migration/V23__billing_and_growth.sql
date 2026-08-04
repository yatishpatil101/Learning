-- V23 Billing and growth (slice 13). Every table here has existed since V7/V8; what was missing is
-- everything that connects them to money: a payment handle, a retry key, a referral code, and a
-- reward amount.

-- ---------------------------------------------------------------------------
-- 1. Subscriptions: a payment handle, a retry key, and a `pending` state.
-- ---------------------------------------------------------------------------
-- V8's status vocabulary began at `active`, which left no way to record a subscription whose
-- checkout has been opened but not completed. The only two things a server can do with that gap
-- are both wrong: activate on `POST` (and hand out the plan to anyone who abandons the payment
-- page) or persist nothing until the webhook (and have `201` return a row that does not exist).
-- Spec fix S50 added `pending`; this is the column change behind it.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('pending', 'active', 'past-due', 'cancelled', 'expired'));
ALTER TABLE subscriptions ALTER COLUMN status SET DEFAULT 'pending';

-- The gateway order id. Unique, because it is what the payment webhook matches on: two rows
-- claiming the same order would make "which subscription did this money buy?" ambiguous at
-- exactly the moment it matters. Partial, because a free plan never creates an order.
ALTER TABLE subscriptions ADD COLUMN payment_ref text;
CREATE UNIQUE INDEX uq_subscriptions_payment_ref
    ON subscriptions (payment_ref) WHERE payment_ref IS NOT NULL;

-- The client's `Idempotency-Key`, scoped per user exactly as V14 scoped rent's per tenancy. A
-- double-tapped Subscribe button must not produce two charges, and the header is the only thing
-- that can tell a retry apart from a deliberate second purchase.
ALTER TABLE subscriptions ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX uq_subscriptions_idempotency
    ON subscriptions (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- `GET /me/subscription` is "my current one", newest first. V8 indexed user_id alone.
DROP INDEX IF EXISTS idx_subscriptions_user;
CREATE INDEX idx_subscriptions_user_started ON subscriptions (user_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Boosts: the same three problems, the same three answers (spec fix S51).
-- ---------------------------------------------------------------------------
ALTER TABLE boosts DROP CONSTRAINT boosts_status_check;
ALTER TABLE boosts ADD CONSTRAINT boosts_status_check
    CHECK (status IN ('pending', 'active', 'expired'));
ALTER TABLE boosts ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE boosts ADD COLUMN payment_ref text;
CREATE UNIQUE INDEX uq_boosts_payment_ref ON boosts (payment_ref) WHERE payment_ref IS NOT NULL;

-- Scoped by property rather than by user: the endpoint is /me/properties/{propId}/boost, the row
-- has no buyer column, and the buyer is always the listing's owner. Scoping to the thing the URL
-- names is both narrower and impossible to get wrong.
ALTER TABLE boosts ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX uq_boosts_idempotency
    ON boosts (property_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- "Is this listing boosted right now?" -- the question search ranking will ask of every result.
CREATE INDEX idx_boosts_live ON boosts (property_id, ends_at DESC) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 3. Service orders: a retry key and the list index.
-- ---------------------------------------------------------------------------
-- No payment columns: `createServiceOrder` declares neither a 402 nor a payment callback, and the
-- ServiceOffering carries a *starting* price, so the amount is quoted after a survey rather than
-- charged at order time. Adding a gateway handle here would be inventing a flow the contract does
-- not describe.
ALTER TABLE service_orders ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX uq_service_orders_idempotency
    ON service_orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

DROP INDEX IF EXISTS idx_service_orders_user;
CREATE INDEX idx_service_orders_user_created ON service_orders (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Referral codes.
-- ---------------------------------------------------------------------------
-- `ReferralSummary.code` and the body of `redeemReferral` are the same string, and it existed
-- nowhere in the schema -- two operations depended on a value the database could not store.
--
-- Its own table rather than a column on `users`: the code is a growth-context concern with no
-- meaning to identity, and billing writing into identity's aggregate is the kind of cross-context
-- write the layering test exists to discourage. A one-column-per-user table costs one join on a
-- screen nobody opens in a loop.
--
-- user_id is the primary key: one code per user, forever. Rotating it would break every card and
-- WhatsApp message already carrying the old one.
CREATE TABLE referral_codes (
    user_id    uuid PRIMARY KEY REFERENCES users(id),
    code       text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. Referrals: an amount, a reversal state, and the reviewer's reason.
-- ---------------------------------------------------------------------------
-- `reward` is prose ("+15 owner contacts") while ReferralSummary.rewardsEarned is Money, so the
-- summary had nothing to add up and a checker approving a payout was never shown its size. Spec
-- fix S54 put the number on the wire; this is where it lives.
ALTER TABLE referrals ADD COLUMN reward_amount bigint NOT NULL DEFAULT 0;

-- Spec fix S52. Clawback reverses a reward that was already released; folding it into `rejected`
-- would lose the one distinction the fraud desk needs -- never paid versus paid and recovered.
ALTER TABLE referrals DROP CONSTRAINT referrals_status_check;
ALTER TABLE referrals ADD CONSTRAINT referrals_status_check
    CHECK (status IN ('pending', 'qualified', 'rewarded', 'rejected', 'clawed-back'));

-- Reject and clawback both take a ReasonRequest. V7 recorded who decided and when but not why,
-- which is the only part of the three a later reviewer actually needs.
ALTER TABLE referrals ADD COLUMN handled_reason text;

-- One person can be referred once. Without this the whole scheme is a faucet: redeem a code,
-- redeem another, collect both rewards. Partial because the column is nullable and a referral
-- recorded without a mobile is not a duplicate of anything.
CREATE UNIQUE INDEX uq_referrals_referred_mobile
    ON referrals (referred_mobile) WHERE referred_mobile IS NOT NULL;

-- The ops queue filters on status and risk and sorts newest-first. V7 indexed status alone, so
-- every "high risk, pending" search still sorted the whole pending set by hand.
DROP INDEX IF EXISTS idx_referrals_status;
CREATE INDEX idx_referrals_queue ON referrals (status, risk, at DESC);
CREATE INDEX idx_referrals_referrer_status ON referrals (referrer_id, status);
