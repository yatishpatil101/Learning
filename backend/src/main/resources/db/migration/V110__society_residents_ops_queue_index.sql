-- The index the cross-society residency queue reads on.
--
-- society_residents already has idx_society_residents_society_status (society_id, status,
-- created_at desc), which is the right index for the committee's own inbox and useless for the
-- question the ops console asks: "who is waiting anywhere, oldest first". Its leading column is the
-- society, so a query that names no society cannot use it and Postgres falls back to a sequential
-- scan of the whole table followed by a sort — a plan that is invisible on a seeded database and
-- gets worse every month the platform is alive.
--
-- Same shape and same reason as idx_society_claims_status_created in V101: the ops queue reads
-- "every row in this status, oldest first" and nothing else. status leads because it is the
-- equality predicate, created_at follows because it is the order; ascending, because a work queue
-- is drained from the front and Postgres can walk either direction of a b-tree anyway.
--
-- Not partial on status = 'pending'. The console filters to decided rows too — "what did we do with
-- this person" is the second question an operator asks — and a partial index would leave that read
-- on the sequential scan this migration exists to remove.
create index idx_society_residents_status_created
    on society_residents (status, created_at);
