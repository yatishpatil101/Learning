-- ---------------------------------------------------------------------------------------------
-- What a subscription was actually charged, recorded on the subscription.
--
-- Until now `subscriptions` stored no amount, so every finance figure answered "how much money did
-- this earn?" by joining the plan and reading `plans.price` — its price *today*. That is a
-- different question, and the two only agreed for as long as nobody repriced anything. `plans` is
-- seeded by a repeatable migration whose upsert ends `price = EXCLUDED.price`, so a one-line edit
-- to the catalogue silently rewrote history: correcting Owner Plus from 2499 to 999 restated every
-- Owner Plus subscription ever sold as having earned 999. Revenue, the 24-month series, MRR and
-- the plan book all moved, and so did the transactions ledger — the one screen where the figure is
-- a settlement record and must equal what the gateway captured. Nothing failed; the numbers were
-- simply wrong, and wrong in a way no test could see, because the finance spec asserts that the
-- figures agree with each other rather than what any of them is.
--
-- A price is therefore a fact about a *purchase*, not a property of a catalogue row that the
-- purchase happens to point at. This column is that fact.
--
-- Backfilled from the plan, because for rows written before this migration the current catalogue
-- price is the only evidence that exists. That is exactly the guess the column removes going
-- forward; it cannot be undone retroactively, and pretending otherwise with a NULL would only move
-- the problem into every consumer.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS amount bigint;

UPDATE subscriptions s
   SET amount = p.price
  FROM plans p
 WHERE p.id = s.plan_id
   AND s.amount IS NULL;

-- NOT NULL rather than a default: a default would let a caller that forgot to pass the price write
-- a plausible zero, and a zero here is indistinguishable from a free plan — a silently unbilled
-- subscription that reports as revenue-free rather than as a bug. Free plans pass 0 explicitly.
ALTER TABLE subscriptions ALTER COLUMN amount SET NOT NULL;

ALTER TABLE subscriptions ADD CONSTRAINT ck_subscriptions_amount_non_negative
    CHECK (amount >= 0);
