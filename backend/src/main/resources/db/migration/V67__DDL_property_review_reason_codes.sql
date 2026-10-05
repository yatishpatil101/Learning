ALTER TABLE property_reviews
    ADD COLUMN reason_code text,
    ADD COLUMN needs_info_at timestamptz;

ALTER TABLE property_reviews
    DROP CONSTRAINT IF EXISTS property_reviews_status_check,
    ADD CONSTRAINT property_reviews_status_check
    CHECK (status IN ('pending','needs_info','approved','rejected','flagged','archived'));

ALTER TABLE property_reviews
    ADD CONSTRAINT ck_property_reviews_reason_code
    CHECK (reason_code IS NULL OR reason_code IN (
        'photos_not_real',
        'duplicate',
        'broker',
        'wrong_details',
        'locality_unclear',
        'document_unreadable',
        'name_mismatch',
        'other'
    ));
