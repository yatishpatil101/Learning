-- V51 a covering index for the two owner finance aggregates (tech debt D132).
--
-- What D132 was really about. The register row says `/me/finances/{propId}/summary` and
-- `/cashflow` "aggregate per call with no rollup table" and proposes building one. Reading the
-- code first: the arithmetic already happens in Postgres -- `sumByTypeSince` returns one row and
-- `monthlyTotalsBetween` returns one row per month, neither pulls the ledger into the JVM. So the
-- expensive half of the item was already gone and a rollup table would have been a second copy of
-- numbers an owner reconciles against a bank statement, kept in step by a trigger or a job, to
-- save a cost nobody has measured. That trade is bad at this size: a stale rollup is a wrong
-- ledger, and a wrong ledger is worse than a slow one.
--
-- What was actually left is the *heap*. Both aggregates read `type` and `amount`, and neither
-- column is in any index, so `idx_transactions_property` could find the rows but Postgres still
-- had to visit the table once per row to add them up. A year of monthly rent, maintenance, tax and
-- utility rows is a few hundred random heap fetches to return three integers, and it grows one row
-- at a time forever -- which is exactly the shape D132 was worried about, just in the layer below
-- the one the register named.
--
-- Carrying the two columns in the index removes the heap visit entirely: the aggregate can be
-- answered from the index alone. The response bytes do not change -- this is a plan change, not a
-- contract change.

-- The predicate this serves, exactly as the two queries write it:
--
--   /summary   property_id = ?  AND archived = false  [AND date >= ?]
--   /cashflow  property_id = ?  AND archived = false   AND date >= ?  AND date < ?
--
-- `property_id` leads because it is the equality; `date` follows because it is the range and both
-- windows are expressed on it; `archived = false` is the partial predicate rather than a key
-- column because no read on this table ever wants an archived row (V12 established that, and
-- every query in TransactionRepository still filters it). `period=all` passes no lower bound and
-- degenerates to the leading-column prefix, which the same index serves.
--
-- `type` and `amount` ride in INCLUDE rather than in the key. They are never filtered or ordered
-- on -- they are only summed -- and adding them to the key would enlarge every internal page for
-- no navigational benefit.
CREATE INDEX idx_transactions_property_agg
    ON transactions (property_id, date) INCLUDE (type, amount)
    WHERE archived = false;

-- V12's index is dropped rather than kept alongside, which is the opposite of the call V49 made,
-- so the difference is worth stating. V49 kept its prefix index because the new one had a
-- *different key* -- `(property_id)` versus `(property_id, created_at DESC)` -- and the narrower
-- one still served lookups the wider one served less cheaply. Here the keys are byte-identical;
-- the new index differs only by a payload the planner ignores when navigating. Any plan that chose
-- the old one can choose this one at the same cost, so keeping both would buy nothing and charge
-- for it twice on every insert, update and soft-delete.
--
-- The trade being accepted: entries are wider (a text `type` plus an 8-byte `amount` on top of a
-- uuid and a date), so a range scan reads roughly twice the index pages. That is paid by the
-- paged ledger list, which reads twenty rows and therefore a handful of pages either way, and it
-- buys the aggregates their whole heap-visit cost back. The scan that got wider is the one bounded
-- by a page size; the scan that got cheaper is the one bounded by how long the owner has held the
-- flat.
DROP INDEX idx_transactions_property;

-- Honest caveat, recorded here so the next person measuring does not conclude the index failed:
-- an index-only scan still visits the heap for rows whose page is not marked all-visible, so a
-- ledger written to seconds ago will show some fetches until autovacuum catches up. The steady
-- state is what this is for.
--
-- `idx_transactions_owner (owner_id, date)` and `idx_transactions_recurring` are untouched. No
-- aggregate here reads by owner -- the controller resolves ownership through `properties` and then
-- scopes on `property_id` alone -- and /dues has its own narrower index already.
