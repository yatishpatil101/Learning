-- V49 composite indexes for the two remaining inboxes D77 paged.
--
-- Same reasoning as V48, which shipped the deal cluster's indexes alongside its paging change:
-- api-standards.md §5 requires every read the API sorts on to be index-served, and paging a read
-- whose sort is not indexed makes it *slower*, not faster -- the scan still happens, the whole
-- matched set is still sorted, all but twenty rows are then discarded, and the envelope's count(*)
-- adds a second pass. The index is what turns a page into a saving.
--
-- Both predicates below are `<scope> = ? / in (?)` followed by `order by <timestamp> desc limit ?`.
-- A composite index with the timestamp in it lets Postgres walk from the newest row in scope and
-- stop after `size`, so page one costs the same at ten rows and at ten thousand.

-- The document-request inbox (`GET /me/documents/requests`).
--
-- `idx_document_requests_property` (V6) is single-column, so the owner's whole portfolio of
-- requests had to be gathered and quicksorted on every read. With `created_at` in the index the
-- planner can MergeAppend the per-property scans -- already in the right order -- and stop at the
-- page boundary. That matters most for the `property_id in (...)` shape used here: the wider the
-- portfolio, the more rows the old plan had to sort to return the same twenty.
--
-- V6's single-column index stays. It backs the property-detail reads and the cascade checks, and
-- dropping a prefix index in the same change that adds its superset is how the one query nobody
-- re-measured regresses.
CREATE INDEX idx_document_requests_property_created
    ON document_requests (property_id, created_at DESC);

-- The flatmate host inbox (`GET /me/flatmate-requests`), status-filtered.
--
-- V27's `idx_flatmate_requests_host (host_id, requested_at DESC)` already serves the unfiltered
-- inbox exactly, and is left to do so. What it does not serve is `?status=accepted`: Postgres walks
-- the host's rows newest-first and discards everything that does not match, which is fine while
-- most rows match and pathological when few do -- a host with two thousand pending requests and
-- three accepted ones reads almost the entire index to fill one page of three. Since a host filters
-- precisely because the unfiltered list has become unmanageable, the bad case is the one people
-- actually hit.
--
-- Not partial: unlike V48's finalization index, no status here is write-only. `pending` is the
-- default view, `accepted` is the one a host revisits to find who is moving in, and `declined` is
-- read when somebody asks why they never heard back.
CREATE INDEX idx_flatmate_requests_host_status_requested
    ON flatmate_requests (host_id, status, requested_at DESC);
