-- V14: constraints and columns the rent money rail needs (slice 6).
--
-- V6 created rent_payments, rent_mandates and payout_accounts as plain tables with no uniqueness
-- at all. That is fine for a schema nobody writes to; it is not fine the moment money moves. Every
-- constraint below exists because the alternative is a duplicate charge, a double-let mandate, or a
-- webhook replay that marks a failed payment paid.
--
-- The slice-3 lesson, restated: a service-level check is not a constraint. Two concurrent requests
-- both pass "does a row already exist?" before either commits. Only the database can answer that
-- question honestly, so every rule that would cost a tenant money is expressed as an index.

-- ---------------------------------------------------------------------------
-- rent_payments
-- ---------------------------------------------------------------------------

-- Cashfree order id. V6 already described `reference` as "the payment-gateway idempotency handle",
-- so this reuses that column rather than adding a second one -- but the description was doing no
-- work without a constraint behind it. The payment webhook dedupes on this value: a provider that
-- gets no 200 retries, and Cashfree explicitly may deliver the same event more than once.
ALTER TABLE rent_payments ALTER COLUMN reference TYPE text;
CREATE UNIQUE INDEX uq_rent_payments_reference
    ON rent_payments (reference) WHERE reference IS NOT NULL;

-- The client's Idempotency-Key. A tenant on a flaky train connection taps Pay, sees nothing, and
-- taps again; without this they are charged twice and we refund by hand.
--
-- Scoped to the tenancy, not global. A globally-unique key is both a leak and a nuisance: the
-- lookup that replays it would match a row belonging to somebody else, handing one tenant another
-- tenant's payment record simply for guessing their key -- and two unrelated tenants whose clients
-- happened to generate the same key would collide for no reason. Scoping makes the replay lookup
-- inherently caller-bound, so the guard is the index rather than a filter somebody can forget.
ALTER TABLE rent_payments ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX uq_rent_payments_idempotency
    ON rent_payments (tenancy_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Why a payment failed, straight from the provider's error_details. Without it the tenant sees
-- "failed" and has no idea whether to retry, top up, or ring their bank.
ALTER TABLE rent_payments ADD COLUMN failure_reason text;

-- The rent month this settles. Made NOT NULL so the partial unique below can rely on it: a payment
-- that settles no particular month cannot be checked for duplication, and rent always has a due
-- date -- that is what makes it rent rather than a transfer.
--
-- Backfilled from created_at rather than current_date. The table is empty today, but a backfill
-- that stamps every legacy row with *today's* date would put historic payments in the future
-- relative to their own creation, which quietly corrupts any overdue calculation and any
-- month-by-month report the moment somebody runs one. created_at preserves the real order.
UPDATE rent_payments
   SET due_date = date_trunc('month', COALESCE(created_at, now()))::date
 WHERE due_date IS NULL;
ALTER TABLE rent_payments ALTER COLUMN due_date SET NOT NULL;

-- One live payment per tenancy per due date. `due` and `paid` are the states that occupy the slot;
-- a `failed` row must not block a retry, which is exactly why this is partial rather than a plain
-- UNIQUE. Without it a tenant can pay March twice -- and the second charge is real money.
CREATE UNIQUE INDEX uq_rent_payments_live_per_due_date
    ON rent_payments (tenancy_id, due_date) WHERE status IN ('due', 'paid');

-- Backs the owner's ledger read (/me/rent-ledger), which orders by recency across many tenancies.
CREATE INDEX idx_rent_payments_status_due ON rent_payments (status, due_date DESC);

-- ---------------------------------------------------------------------------
-- rent_mandates
-- ---------------------------------------------------------------------------

-- At most one *live* autopay mandate per tenancy -- active or paused, not just active. Two would
-- mean two standing instructions against the same rent, i.e. the tenant pays twice every month
-- until somebody notices.
--
-- The predicate is `status <> 'revoked'` rather than `status = 'active'` because pausing is
-- reversible: a paused mandate is still a real instruction the tenant can resume, so it must
-- still occupy the one slot. An active-only predicate would let a paused one and a fresh active
-- one coexist, and the moment the tenant resumed the paused one they would be debited twice.
-- Revoked rows are excluded so the history survives and a new mandate can still be created.
CREATE UNIQUE INDEX uq_rent_mandates_active_per_tenancy
    ON rent_mandates (tenancy_id) WHERE status <> 'revoked';

-- ---------------------------------------------------------------------------
-- payout_accounts
-- ---------------------------------------------------------------------------

-- One payout destination per owner. The contract's /me/payout-account is singular (GET returns an
-- object, PUT replaces it), so a second row is unreachable by design -- and an unreachable row
-- holding bank details is worse than no row, because it is where settlements silently do not go.
DELETE FROM payout_accounts a USING payout_accounts b
    WHERE a.owner_id = b.owner_id AND a.created_at < b.created_at;
DROP INDEX IF EXISTS idx_payout_accounts_owner;
CREATE UNIQUE INDEX uq_payout_accounts_owner ON payout_accounts (owner_id);
