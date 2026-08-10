-- V44 — the unpaid-order cap on subscriptions, enforced by the database (D160).
--
-- WHAT WAS WRONG
-- --------------
-- `POST /me/subscription` opens a real Cashfree order for every priced plan and had nothing
-- bounding how many a caller may hold open at once. The `Idempotency-Key` header is the only thing
-- that ever collapsed two attempts into one, and it is optional: omit it and the replay branch is
-- skipped entirely, so a loop over the endpoint opens unbounded live gateway orders against our
-- merchant account at no cost to the caller. `WriteRateLimitFilter` bounds the *rate* of those
-- requests; it does not bound the *total*, and an attacker who is content to be slow is unaffected.
--
-- Service requests already have this cap (D153, V43). Subscriptions and boosts were simply never
-- given one, on two paths that create exactly the same kind of order. This migration is the
-- subscription half; V45 is the boost half.
--
-- WHY THIS SHAPE
-- --------------
-- Partial, on (user_id) WHERE status = 'pending', because the invariant is exactly "one outstanding
-- unpaid order per person" and nothing wider. A subscription that is paid for (`active`), cancelled,
-- superseded or expired leaves the index entirely, so a customer may buy as many plans over their
-- lifetime as they like -- the cap is on *outstanding* orders, not on volume. This mirrors
-- `uq_service_requests_open_unpaid` (V43) and, like it, is what actually holds under concurrency:
-- the service's count-then-insert is an unlocked read over rows that do not exist yet, so N
-- concurrent callers all read zero. Only a uniqueness constraint can settle that argument, because
-- the database evaluates it at write time.
--
-- No `type` column in the key, unlike V43's (requester_id, type). A service request has five desks
-- and holding an unpaid conveyancing request should not block an unpaid rent agreement; a
-- subscription has one product family -- you are either buying a plan or you are not -- so the
-- family is the whole table and the user is the whole key.
--
-- The index matches SubscriptionService.MAX_OPEN_UNPAID_PER_USER = 1 exactly. Raising that constant
-- means replacing this index (a unique index cannot express "at most N"); its javadoc says so,
-- because the failure mode otherwise is the service waving a second order through and the database
-- refusing it with a message about the first.
--
-- PRE-EXISTING VIOLATIONS
-- -----------------------
-- Unlike V43, a backfill is required. `pending` has existed since V23 with nothing capping it, so a
-- user who opened two checkouts really can hold two rows, and CREATE INDEX would then fail the
-- deploy on data the application itself produced. Failing loudly is the right answer when the
-- offending row would be a defect (V43's case); it is the wrong answer when the offending row is
-- the documented previous behaviour.
--
-- The surplus rows are cancelled, keeping one per user, and the retention order is deliberate:
--
--   1. a row that HAS a payment_ref outranks one that does not. A row without a ref never reached
--      the gateway, so no money can ever arrive for it -- it is unreachable by construction and is
--      the safest thing to retire.
--   2. then the newest, because that is the checkout the customer most likely still has open.
--   3. then by id, purely so the statement is deterministic.
--
-- Cancelling releases the idempotency key with the status, for the same reason
-- `Subscription.abandonUnopened` does: the web client derives its key from the plan (`sub:<planId>`),
-- so a cancelled row that kept its key would be replayed on every later attempt and the customer
-- could never buy that plan again.
--
-- Residual risk, stated rather than hidden, in two parts.
--
-- The tiebreak prefers a row that HAS a payment_ref, but when a user holds two of those it keeps the
-- newest -- and the older one could be the one that was actually paid, with its webhook still
-- undelivered or lost. That row would be cancelled here, and the payment reconciled against a
-- cancelled subscription. It is a narrow case (it needs two live orders and an in-flight settlement
-- on the older one) and it cannot be resolved from inside a migration, which is why every retired
-- row is logged below with its gateway order id: the notices are the reconciliation list. Refusing
-- to deploy instead would trade a handful of reconcilable rows for an outage.
--
-- And if a retired row's order is paid after this runs, the webhook finds it `cancelled`,
-- `Subscription.activate` refuses the transition, and `SubscriptionService.reportRefusedSettlement`
-- logs it at ERROR with the order id -- deliberately louder than the routine redelivery it used to
-- be mistaken for. Money taken with no plan granted is a support case, not silent corruption.
--
-- LOCKS
-- -----
-- Accepted, not overlooked: the index is built non-concurrently, so writes to `subscriptions` block
-- for the duration. CONCURRENTLY cannot be used here -- it may not run inside a transaction, and
-- Flyway wraps each migration in one -- and the table is small enough that the pause is shorter than
-- the deploy that contains it. If `subscriptions` ever grows to where that stops being true, this
-- needs splitting into a manual concurrent build plus a validating migration.

DO $$
DECLARE
    offenders integer;
    surplus   integer;
BEGIN
    SELECT count(*), coalesce(sum(held) - count(*), 0)
      INTO offenders, surplus
      FROM (SELECT user_id, count(*) AS held
              FROM subscriptions
             WHERE status = 'pending'
             GROUP BY user_id
            HAVING count(*) > 1) duplicated;

    IF offenders = 0 THEN
        RAISE NOTICE 'V44 census: no subscriber holds more than one pending subscription; nothing to retire.';
    ELSE
        RAISE NOTICE 'V44 census: % subscriber(s) hold more than one pending subscription; % surplus row(s) will be cancelled.',
            offenders, surplus;
    END IF;
END $$;

-- Every retired row is named, with its gateway order id, because a migration that silently changes
-- payment rows leaves an operator nothing to reconcile against. `none` means the row never reached
-- the gateway and no money can exist for it.
DO $$
DECLARE
    retired record;
BEGIN
    FOR retired IN
        WITH ranked AS (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY user_id
                       ORDER BY (payment_ref IS NOT NULL) DESC, created_at DESC, id DESC) AS keep_rank
              FROM subscriptions
             WHERE status = 'pending'
        ),
        cancelled AS (
            UPDATE subscriptions s
               SET status = 'cancelled',
                   idempotency_key = NULL
              FROM ranked r
             WHERE s.id = r.id
               AND r.keep_rank > 1
            RETURNING s.id, s.user_id, s.payment_ref
        )
        SELECT * FROM cancelled
    LOOP
        RAISE NOTICE 'V44 retired subscription % (user %, gateway order %).',
            retired.id, retired.user_id, coalesce(retired.payment_ref, 'none');
    END LOOP;
END $$;

CREATE UNIQUE INDEX uq_subscriptions_open_unpaid
    ON subscriptions (user_id)
    WHERE status = 'pending';
