ALTER TABLE flatmate_reviews
    ADD COLUMN tenancy_property_id uuid;

COMMENT ON COLUMN flatmate_reviews.tenancy_property_id IS
    'The property the tenant claims to occupy, retained on the review rather than the room/group. '
    'Used only to match a consented tenant claim to a Draazy-registered tenancy; it cannot grant '
    'owner tier and the sweep also requires the agreement tenant mobile to match the review host.';
