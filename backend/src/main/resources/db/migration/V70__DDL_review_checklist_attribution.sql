ALTER TABLE property_review_checklist
    ADD COLUMN checked_by uuid,
    ADD COLUMN checked_at timestamptz;
