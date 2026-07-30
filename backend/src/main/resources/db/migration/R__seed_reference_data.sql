-- Repeatable seed for reference/config data (localities, plans, fees). Runs after the versioned
-- migrations and re-applies whenever this file's checksum changes, so keep every statement
-- idempotent (ON CONFLICT). Reference/master data only -- never user data.

-- Platform fee breakdown backing GET /fees (illustrative INR; confirm real figures before launch).
INSERT INTO platform_fees (deal, brokerage, platform_fee, stamp_duty, registration, gst, notes) VALUES
    ('rent', 0, 1999, 0,     0,     360, 'Zero brokerage; flat rent-agreement platform fee + 18% GST.'),
    ('buy',  0, 4999, 0,     30000, 900, 'Zero brokerage; stamp duty/registration are indicative, state-specific.')
ON CONFLICT (deal) DO UPDATE SET
    brokerage    = EXCLUDED.brokerage,
    platform_fee = EXCLUDED.platform_fee,
    stamp_duty   = EXCLUDED.stamp_duty,
    registration = EXCLUDED.registration,
    gst          = EXCLUDED.gst,
    notes        = EXCLUDED.notes;

-- AdminSettings SSOT document (fees/flags/feature toggles). One key per config block.
INSERT INTO settings (key, value) VALUES
    ('fees', '{
        "ownerPlanYearly": 0,
        "ownerProYearly": 4999,
        "rentAgreementPlatform": 1999,
        "seekerPlusTopup": 299,
        "featuredListing": 999,
        "gstPercent": 18,
        "rentPayPercent": 2
    }'::jsonb),
    ('flags', '{
        "kycBadgeEnabled": true,
        "boostEnabled": true,
        "maintenanceMode": false
    }'::jsonb),
    ('site', '{ "brand": "PuneNest", "supportEmail": "support@punenest.example.com", "city": "Pune" }'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Launch city.
INSERT INTO cities (slug, name, live, listing_count) VALUES
    ('pune', 'Pune', true, 0)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, live = EXCLUDED.live;
