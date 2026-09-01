-- D227 — GET /me/societies/following.
--
-- society_follows has had a composite primary key (user_id, society_id) since V3, which serves the
-- two reads that existed until now: both are scoped to a page of society ids, so the leading
-- user_id column plus an id list is all the planner needs.
--
-- The follow list asks the other question — every row for one user, ordered by when it was made —
-- and the primary key can locate those rows but not return them in order. Without this the page
-- costs a sort of the user's whole follow set on every read, on a route the dashboard calls on
-- load. Same reasoning, same shape and the same user_id-then-timestamp column order as the saved
-- properties index in V17__engagement_list_indexes.sql:36.
--
-- created_at is included rather than left to a sort so the index alone satisfies the ORDER BY;
-- DESC to match the query, since a backwards scan is cheap but a re-sort is not.
create index if not exists idx_society_follows_user_created
    on society_follows (user_id, created_at desc);
