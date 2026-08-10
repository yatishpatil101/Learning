-- V45 — the unpaid-order cap on boosts, enforced by the database (D160).
--
-- The boost half of what V44 did for subscriptions: `POST /me/properties/{propId}/boost` opens a
-- real Cashfree order per priced pack and had no ceiling on how many a caller may hold open. See
-- V44's header for why the rate limit is not a substitute and why a count-then-insert cannot hold.
--
-- WHY THIS ONE NEEDS A COLUMN FIRST
-- --------------------------------
-- V23 chose to scope the boost idempotency key by `property_id` and wrote down its reasoning: "the
-- row has no buyer column, and the buyer is always the listing's owner". That is true and it was
-- the right call for a retry key -- but it cannot express the cap, which is per *person*. Scoping
-- the cap to the listing instead would let one owner hold as many live orders as they hold
-- listings, which is a bound but not the one the product asked for ("one outstanding unpaid order
-- per user per product family", matching the service-request cap).
--
-- So `buyer_id` is added: who actually bought this window, recorded at purchase rather than derived
-- from the listing on every read. Denormalised on purpose, and it is not merely convenient --
-- listing ownership can change hands, and "who paid for this promotion" must not change with it.
--
-- Backfilled from `properties.owner_id`, which is the value the derivation would have produced, and
-- is total: `boosts.property_id` is NOT NULL and a foreign key, and `properties.owner_id` is NOT
-- NULL (V3), so every existing row gets a buyer and the SET NOT NULL below cannot fail on data.
--
-- WHY THIS SHAPE
-- --------------
-- Partial, on (buyer_id) WHERE status = 'pending'. A boost that is paid for (`active`) or dead
-- (`expired`) leaves the index, so the cap is on outstanding orders and not on how many promotions
-- an owner may buy. Matches BoostService.MAX_OPEN_UNPAID_PER_BUYER = 1 exactly; raising that
-- constant means replacing this index.
--
-- Note what the cap deliberately does NOT say: it is not "one pending boost per listing". An owner
-- with three listings may promote all three -- just not hold three unpaid checkouts open at once.
-- The unpaid one clears itself within the abandoned-checkout TTL (D161) or the moment they cancel
-- by paying, so the restriction is measured in minutes rather than being a latch.
--
-- PRE-EXISTING VIOLATIONS
-- -----------------------
-- Handled exactly as V44 handles them, and for the same reason: `pending` has existed since V23
-- with nothing capping it, so a duplicate pair is the previous behaviour rather than a defect, and
-- failing the deploy over it would be wrong. Surplus rows are expired (the terminal value
-- `Boost.abandonUnopened` uses -- the contract's boost vocabulary has no third one), keeping the
-- row that can still take money: a row WITH a payment_ref outranks one without, then the newest,
-- then by id for determinism. The idempotency key is released with the status so the owner's next
-- attempt on that listing is not answered with the dead row.
--
-- Same caveat as V44: where a buyer holds two rows that both have a payment_ref, keeping the newest
-- can retire an older one whose payment is in flight. Every retired row is therefore logged with
-- its gateway order id, and those notices are the reconciliation list.
--
-- LOCKS
-- -----
-- Accepted, not overlooked. `SET NOT NULL` takes ACCESS EXCLUSIVE and scans the table, and both
-- indexes are built non-concurrently (CONCURRENTLY cannot run inside the transaction Flyway wraps
-- each migration in), so writes to `boosts` block for the duration. The table is small enough that
-- this is shorter than the deploy around it.
--
-- ONE THING A FUTURE FEATURE MUST NOT BREAK
-- -----------------------------------------
-- `buyer_id` is backfilled from the listing's current owner, which is exact today because a listing
-- has never changed hands. If transfer is ever built, it must reassign or refuse `pending` boosts
-- explicitly: silently moving a listing would otherwise re-attribute the previous owner's paid
-- history to the new one, and the column is `updatable = false` precisely so that cannot happen by
-- accident.

ALTER TABLE boosts ADD COLUMN buyer_id uuid REFERENCES users(id);

UPDATE boosts b
   SET buyer_id = p.owner_id
  FROM properties p
 WHERE p.id = b.property_id
   AND b.buyer_id IS NULL;

ALTER TABLE boosts ALTER COLUMN buyer_id SET NOT NULL;

DO $$
DECLARE
    offenders integer;
    surplus   integer;
BEGIN
    SELECT count(*), coalesce(sum(held) - count(*), 0)
      INTO offenders, surplus
      FROM (SELECT buyer_id, count(*) AS held
              FROM boosts
             WHERE status = 'pending'
             GROUP BY buyer_id
            HAVING count(*) > 1) duplicated;

    IF offenders = 0 THEN
        RAISE NOTICE 'V45 census: no buyer holds more than one pending boost; nothing to retire.';
    ELSE
        RAISE NOTICE 'V45 census: % buyer(s) hold more than one pending boost; % surplus row(s) will be expired.',
            offenders, surplus;
    END IF;
END $$;

-- Every retired row is named, with its gateway order id, for the reasons given in the header.
DO $$
DECLARE
    retired record;
BEGIN
    FOR retired IN
        WITH ranked AS (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY buyer_id
                       ORDER BY (payment_ref IS NOT NULL) DESC, created_at DESC, id DESC) AS keep_rank
              FROM boosts
             WHERE status = 'pending'
        ),
        expired AS (
            UPDATE boosts b
               SET status = 'expired',
                   idempotency_key = NULL
              FROM ranked r
             WHERE b.id = r.id
               AND r.keep_rank > 1
            RETURNING b.id, b.buyer_id, b.payment_ref
        )
        SELECT * FROM expired
    LOOP
        RAISE NOTICE 'V45 retired boost % (buyer %, gateway order %).',
            retired.id, retired.buyer_id, coalesce(retired.payment_ref, 'none');
    END LOOP;
END $$;

CREATE UNIQUE INDEX uq_boosts_open_unpaid
    ON boosts (buyer_id)
    WHERE status = 'pending';

-- The cap's count reads by buyer on every purchase, and the partial index above cannot serve it:
-- that one covers only `pending` rows, so a count over any other status falls back to a scan. Plain
-- and unconditional, so "every boost this person has bought" -- which is what an ops screen asks --
-- is indexed too.
CREATE INDEX idx_boosts_buyer ON boosts (buyer_id);
