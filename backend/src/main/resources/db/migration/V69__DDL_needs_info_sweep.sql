ALTER TABLE property_reviews
    ADD COLUMN needs_info_day2_reminded_at timestamptz,
    ADD COLUMN needs_info_day7_reminded_at timestamptz,
    ADD COLUMN needs_info_timeout_archived_at timestamptz;

CREATE INDEX idx_property_reviews_needs_info_sweep
    ON property_reviews (needs_info_at)
    WHERE status = 'needs_info' AND needs_info_at IS NOT NULL;
