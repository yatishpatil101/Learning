-- V30 — the index the paged admin group-application board needs.
--
-- V29 created two indexes on flatmate_group_applications: (listing_id, created_at DESC) for the
-- owner's per-listing view, and (mod_status, created_at DESC) for a filtered moderation queue.
-- Neither serves `GET /admin/group-applications`, which is unfiltered and ordered by created_at
-- alone, so that read has always done a full-table sort.
--
-- It went unnoticed because the endpoint returned every row anyway: sorting the whole table is not
-- obviously wasteful when the whole table is the answer. Paging the endpoint is what makes the
-- absence expensive rather than merely untidy -- without this index the database would still sort
-- every application on every page request and then discard all but twenty rows, which is the same
-- work as before plus the discarding.
--
-- DESC to match the query's own ordering. A plain ASC index can be read backwards by Postgres, so
-- this is not strictly required, but matching the query means the plan needs no reverse scan and
-- the intent is legible to whoever reads the schema next.
CREATE INDEX IF NOT EXISTS idx_flatmate_group_applications_created
    ON flatmate_group_applications (created_at DESC);
