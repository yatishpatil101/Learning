-- The owner's explicit request for the Verified property badge, and the desk's answer when it is
-- not granted. A grant is already carried by ownership_verified.
ALTER TABLE properties
    ADD COLUMN ownership_requested_at timestamptz,
    ADD COLUMN ownership_declined_at timestamptz,
    ADD COLUMN ownership_declined_reason varchar(300);
