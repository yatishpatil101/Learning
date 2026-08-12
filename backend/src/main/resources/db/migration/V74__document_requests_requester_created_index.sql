-- D123. The buyer's half of the document gate: GET /me/document-requests.
--
-- V49 indexed this table for the *owner's* inbox (property_id, created_at desc), which is the
-- query that starts from "listings you own". The requester's list starts from the other end --
-- "rows you wrote" -- and had no index at all, so it planned as a sequential scan of every
-- document request in the system followed by a sort, to return twenty rows. That is invisible on
-- a developer's seed data and is exactly the shape that degrades in production, because the table
-- grows with total demand across the whole catalogue while one buyer's slice of it stays small.
--
-- created_at descending in the index, not just requester_id: the sort column has to be in the
-- index for Postgres to stop after one page instead of collecting the caller's whole history and
-- throwing all but a page of it away. Same reasoning as V49, mirrored.
--
-- No unique constraint and no partial predicate: unlike uq_document_requests_pending this index
-- enforces nothing, it only makes an existing read cheap. Concurrently is deliberately not used --
-- Flyway runs migrations inside a transaction and this table is small enough that a brief lock at
-- deploy time is cheaper than the machinery to avoid it.
create index if not exists idx_document_requests_requester_created
    on document_requests (requester_id, created_at desc);
