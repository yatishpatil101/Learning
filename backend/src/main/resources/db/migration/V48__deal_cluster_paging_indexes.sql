-- V48 composite indexes for the six deal-cluster reads that D77 paged.
--
-- WHY AN INDEX MIGRATION SHIPS WITH THE PAGING CHANGE, NOT AFTER IT
-- -----------------------------------------------------------------
-- api-standards.md §5: "every sort/filter field must be backed by a DB index; don't expose a filter
-- the schema can't serve efficiently." Paging without the index is not a half-measure, it is a
-- regression: the unpaged read did one scan and returned everything, while a paged read over the
-- same single-column index does the scan, sorts the whole matched set, and then throws all but
-- twenty rows away -- plus a second pass for the `count(*)` the envelope carries. The owner with
-- four hundred offers pays more per request than they did before, for less data.
--
-- WHAT CHANGES
-- ------------
-- Each of these predicates is `<scope column> = ? / in (?)` followed by `order by created_at desc
-- limit ?`. A composite `(scope, created_at desc)` serves both halves: Postgres walks the index
-- from the newest entry for that scope and stops after `size` rows, so page one costs the same
-- whether the owner has twenty offers or twenty thousand. The single-column originals stay --
-- `idx_offers_property` also backs the closed-deal probe and the uniqueness checks, and dropping a
-- prefix index in the same change that adds its superset is how a plan regresses on the one query
-- nobody re-measured.
--
-- `created_at desc` is written into the index rather than left to a backwards scan. Postgres can
-- read a btree in either direction, so `(scope, created_at)` would serve this too -- but only while
-- the sort stays single-column. Spelling the direction out means the index and the `order by` in
-- the repository are literally the same text, which is the property that survives someone adding a
-- tie-breaker column later.
--
-- THE ONE THAT WAS NOT AN OPTIMISATION
-- ------------------------------------
-- `finalization_requests` had `idx_finalization_property` and nothing else. `findPendingByCounterparty`
-- -- the query behind every owner's "waiting on you" finalization panel -- filters on
-- `counterparty_id`, which was not indexed at all, so it has been sequentially scanning the table
-- since V5. Paging made that visible (the count query scans it a second time) but did not cause it;
-- this index is a bug fix that happens to arrive with a performance change.
--
-- `deals` needs no counterpart: `uq_deals_property` (V11) makes it one row per property, so
-- `property_id in (...)` already returns at most one row per listing the owner holds. The composite
-- below still earns its place because that set is the owner's whole portfolio and the sort would
-- otherwise be a fresh quicksort of it on every dashboard load.

CREATE INDEX idx_offers_property_created ON offers (property_id, created_at DESC);
CREATE INDEX idx_offers_from_created     ON offers (from_user_id, created_at DESC);

CREATE INDEX idx_visits_property_created ON visits (property_id, created_at DESC);
CREATE INDEX idx_visits_visitor_created  ON visits (visitor_id, created_at DESC);

CREATE INDEX idx_deals_property_created  ON deals (property_id, created_at DESC);

-- Partial: `findPendingByCounterparty` only ever reads pending rows, and accepted/declined/cancelled
-- rows accumulate forever without ever being selected. Indexing them would grow the structure with
-- exactly the rows the query excludes.
CREATE INDEX idx_finalization_counterparty_created
    ON finalization_requests (counterparty_id, created_at DESC)
    WHERE status = 'pending';
