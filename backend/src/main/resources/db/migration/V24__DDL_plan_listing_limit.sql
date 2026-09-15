-- A NULL `plans.listing_limit` is the free-tier floor, never "no cap": every reader resolves an
-- absent limit through the same one-listing default, so a plan that omits the number sells the free
-- allowance while reading as unlimited. V11's column comment claimed the opposite and is corrected
-- here rather than edited in place, because Flyway checksums an applied migration.
COMMENT ON COLUMN plans.listing_limit IS
    'Live listings this plan grants. NULL is NOT unlimited: the plan grants no listing allowance of its own and the free-tier floor of one applies. An effectively uncapped plan must state a large number. Required on owner plans (plans_owner_states_listing_limit).';

-- The audience the ceiling is written for may not leave it unstated, so the ambiguity cannot be
-- created by the operator who most expects it to mean "unlimited".
ALTER TABLE plans ADD CONSTRAINT plans_owner_states_listing_limit
    CHECK (audience IS DISTINCT FROM 'owner' OR listing_limit IS NOT NULL);
