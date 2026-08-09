-- V36 — `service_requests.details` from `text` to `jsonb`: the request's fields as a structured
-- object, readable back (tech-debt D119, closed).
--
-- WHAT IT MEANS
-- -------------
-- A customer fills a service form — property, rent, deposit, scope — and that is the request. The
-- column stored it as a flat `text` blob: `ServiceRequestCreate.details` was a string, the seam
-- flattened the object to `Label: value` lines on the way out, and `ServiceRequestDto` carried no
-- `details` field at all. So the fields the user typed landed (ops could read them) but could not be
-- read back through the API — the tracker's detail line was mock-only. Widening the column to
-- `jsonb` lets the object round-trip: the mapper projects it onto `ServiceRequestDto.details` and
-- the client reads the same shape it sent.
--
-- CONVERTING EXISTING ROWS
-- ------------------------
-- The old values are plain `Label: value` text, not JSON, so a bare `::jsonb` cast would fail. Each
-- non-empty row is wrapped under a single `note` key — a valid object that preserves what was
-- written without pretending to re-parse the label lines back into fields. Empty/blank rows become
-- SQL NULL (a request with no structured detail), matching the nullable column.
ALTER TABLE service_requests
    ALTER COLUMN details TYPE jsonb
    USING CASE
        WHEN details IS NULL OR btrim(details) = '' THEN NULL
        ELSE jsonb_build_object('note', details)
    END;
