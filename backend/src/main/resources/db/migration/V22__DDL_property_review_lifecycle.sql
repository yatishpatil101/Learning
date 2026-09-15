ALTER TABLE properties
    ADD COLUMN lifecycle_track text NOT NULL DEFAULT 'owner',
    ADD COLUMN lifecycle_stage text DEFAULT 'submitted',
    ADD COLUMN lifecycle_verified_at timestamptz,
    ADD COLUMN version bigint NOT NULL DEFAULT 0;

-- Never infer a send or open from a prepared chaser or a manually advanced pipeline.
UPDATE properties SET lifecycle_track = CASE WHEN posted_by_admin THEN 'staff' ELSE 'owner' END,
    lifecycle_stage = CASE
        WHEN status = 'approved' AND NOT archived THEN 'live'
        WHEN status <> 'pending' OR archived THEN NULL
        WHEN NOT posted_by_admin THEN 'submitted'
        WHEN jsonb_array_length(coalesce(images, '[]'::jsonb)) > 0
             OR EXISTS (SELECT 1 FROM documents d WHERE d.property_id = properties.id
                        AND d.service_request_id IS NULL) THEN 'photos_docs'
        ELSE NULL END;

ALTER TABLE properties ADD CONSTRAINT properties_lifecycle_track_check
    CHECK (lifecycle_track IN ('owner', 'staff'));
ALTER TABLE properties ADD CONSTRAINT properties_lifecycle_stage_check CHECK (
    lifecycle_stage IS NULL OR
    (lifecycle_track = 'owner' AND lifecycle_stage IN ('submitted','in_review','clarification','verified','live')) OR
    (lifecycle_track = 'staff' AND lifecycle_stage IN ('link_sent','opened','photos_docs','live')));

ALTER TABLE review_messages ADD COLUMN clarification_requested boolean NOT NULL DEFAULT false;
CREATE INDEX idx_review_messages_owner_unread ON review_messages(review_id)
    WHERE NOT internal AND read_at IS NULL;