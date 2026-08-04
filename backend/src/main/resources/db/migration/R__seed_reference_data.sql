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
        "rentPayPercent": 2,
        "referralReward": 500
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

-- ---------------------------------------------------------------------------
-- Localities (slice 7). Ported from the frontend db.json, which is the UI ground truth.
--
-- These were missing from this file entirely: it seeded cities, fees and settings only, so a
-- database built from an empty schema had zero localities -- and localities are the FK target of
-- properties.locality_slug and societies.locality_slug. The dev database had 15 rows that came
-- from a manual import and were not reproducible from the repository.
-- ---------------------------------------------------------------------------
INSERT INTO localities (slug, name, city, rate_per_sqft, avg_rent, demand, focus, lat, lng, active) VALUES
    ('aundh', 'Aundh', 'Pune', 11800, 30680, 74, 'Buy', 18.558, 73.807, true),
    ('balewadi', 'Balewadi', 'Pune', 9000, 23400, 85, 'Both', 18.575, 73.772, true),
    ('baner', 'Baner', 'Pune', 9800, 25480, 88, 'Buy', 18.559, 73.776, true),
    ('bavdhan', 'Bavdhan', 'Pune', 8800, 22880, 72, 'Buy', 18.514, 73.772, true),
    ('hadapsar', 'Hadapsar', 'Pune', 7300, 18980, 80, 'Rent', 18.5, 73.926, true),
    ('hinjawadi', 'Hinjawadi', 'Pune', 7600, 19760, 94, 'Rent', 18.591, 73.738, true),
    ('kharadi', 'Kharadi', 'Pune', 9100, 23660, 86, 'Both', 18.551, 73.941, true),
    ('koregaon-park', 'Koregaon Park', 'Pune', 14500, 37700, 70, 'Buy', 18.536, 73.893, true),
    ('kothrud', 'Kothrud', 'Pune', 11200, 29120, 78, 'Buy', 18.507, 73.807, true),
    ('magarpatta', 'Magarpatta', 'Pune', 9600, 24960, 84, 'Rent', 18.516, 73.928, true),
    ('nibm-road', 'NIBM Road', 'Pune', 8100, 21060, 71, 'Buy', 18.47, 73.901, true),
    ('pimple-saudagar', 'Pimple Saudagar', 'Pune', 8400, 21840, 81, 'Both', 18.598, 73.805, true),
    ('undri', 'Undri', 'Pune', 6600, 17160, 68, 'Buy', 18.464, 73.917, true),
    ('viman-nagar', 'Viman Nagar', 'Pune', 10400, 27040, 82, 'Both', 18.567, 73.915, true),
    ('wakad', 'Wakad', 'Pune', 8200, 21320, 90, 'Both', 18.598, 73.762, true),
    ('wagholi', 'Wagholi', 'Pune', NULL, NULL, NULL, NULL, NULL, NULL, true)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name, city = EXCLUDED.city, rate_per_sqft = EXCLUDED.rate_per_sqft,
    avg_rent = EXCLUDED.avg_rent, demand = EXCLUDED.demand, focus = EXCLUDED.focus,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, active = EXCLUDED.active;

-- Referenced by a society above but absent from the frontend locality dataset: wagholi

-- ---------------------------------------------------------------------------
-- Societies (slice 7). The 28 curated records from frontend/src/data/societies.js.
--
-- Only source='curated' is seeded. That file also computes ~320 MahaRERA bulk records, which
-- are thin stubs: a name, a builder and a registration id, with no amenities, occupancy or
-- coordinates. Loading them would make the first page of /societies mostly empty rows. Bulk
-- RERA import is a data pipeline, not a seed file. Owner: whoever takes the society-claim slice.
--
-- ids are fixed literals rather than gen_random_uuid() so re-running this file updates the same
-- rows instead of inserting 28 more; slug is UNIQUE and is what ON CONFLICT keys on.
-- ---------------------------------------------------------------------------
INSERT INTO societies (slug, name, builder, locality_slug, lat, lng, year, towers, units,
                       occupancy, maintenance_per_sqft, parking_ratio, lifts, security, water,
                       power, pet_policy, veg_policy, rera, registration, conveyance, amenities,
                       source, claim_status) VALUES
    ('skyline-heights-baner', 'Skyline Heights', 'Kolte-Patil', 'baner', 18.5602, 73.7861, 2018, 5, 420, 92, 3.2, 1.4, 12, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100012345', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging"]'::jsonb, 'curated', 'unclaimed'),
    ('green-meadows-baner', 'Green Meadows', 'Gera Developments', 'baner', 18.5571, 73.7902, 2016, 3, 260, 95, 2.9, 1.2, 6, '2-tier + CCTV', 'Corporation', 'Lifts + common areas', 'Allowed', 'Mixed', 'P52100011876', true, true, '["gym", "clubhouse", "garden", "kids", "security", "jogging"]'::jsonb, 'curated', 'unclaimed'),
    ('silver-oak-residency-aundh', 'Silver Oak Residency', 'Rohan Builders', 'aundh', 18.5605, 73.8071, 2014, 4, 300, 97, 3, 1.3, 8, '3-tier + CCTV', 'Corporation', 'Full DG backup', 'Allowed', 'Mixed', NULL, true, true, '["pool", "gym", "clubhouse", "garden", "security", "indoor"]'::jsonb, 'curated', 'unclaimed'),
    ('marvel-fria-wagholi', 'Marvel Fria', 'Marvel Realtors', 'wagholi', 18.5793, 73.9871, 2019, 7, 640, 84, 2.6, 1.5, 14, '3-tier + CCTV', 'Tanker + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100019234', true, false, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging", "sports"]'::jsonb, 'curated', 'unclaimed'),
    ('kumar-palaash-hinjawadi', 'Kumar Palaash', 'Kumar Properties', 'hinjawadi', 18.5921, 73.7402, 2017, 6, 520, 90, 2.8, 1.3, 12, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100014521', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev"]'::jsonb, 'curated', 'unclaimed'),
    ('nyati-elysia-kharadi', 'Nyati Elysia', 'Nyati Group', 'kharadi', 18.5518, 73.9441, 2020, 8, 720, 88, 3.1, 1.5, 16, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100021009', true, false, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging", "sports", "indoor"]'::jsonb, 'curated', 'unclaimed'),
    ('amanora-park-hadapsar', 'Amanora Park Town', 'City Corporation Ltd', 'hadapsar', 18.5162, 73.9291, 2013, 12, 1400, 96, 3.4, 1.4, 30, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100010023', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging", "sports", "indoor", "mall"]'::jsonb, 'curated', 'unclaimed'),
    ('blue-ridge-towers-hinjawadi', 'Blue Ridge Towers', 'Paranjape Schemes', 'hinjawadi', 18.5889, 73.7351, 2015, 9, 900, 91, 2.7, 1.3, 18, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100013340', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "jogging", "sports"]'::jsonb, 'curated', 'unclaimed'),
    ('lunkad-sky-station-viman-nagar', 'Lunkad Sky Station', 'Lunkad Group', 'viman-nagar', 18.5661, 73.9142, 2016, 4, 340, 93, 3.3, 1.3, 10, '3-tier + CCTV', 'Corporation', 'Full DG backup', 'Allowed', 'Mixed', NULL, true, true, '["pool", "gym", "clubhouse", "garden", "security", "ev"]'::jsonb, 'curated', 'unclaimed'),
    ('gera-world-of-joy-kharadi', 'Gera World of Joy', 'Gera Developments', 'kharadi', 18.5495, 73.9478, 2019, 6, 560, 86, 3, 1.4, 12, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100020115', true, false, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging"]'::jsonb, 'curated', 'unclaimed'),
    ('mont-vert-tropez-wakad', 'Mont Vert Tropez', 'Mont Vert Homes', 'wakad', 18.6081, 73.7628, 2015, 5, 400, 94, 2.8, 1.3, 10, '3-tier + CCTV', 'Corporation', 'Full DG backup', 'Allowed', 'Mixed', 'P52100012788', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security"]'::jsonb, 'curated', 'unclaimed'),
    ('rohan-abhilasha-pimple-saudagar', 'Rohan Abhilasha', 'Rohan Builders', 'pimple-saudagar', 18.5981, 73.8021, 2017, 6, 480, 92, 2.9, 1.3, 12, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100015567', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "jogging"]'::jsonb, 'curated', 'unclaimed'),
    ('kolte-patil-24k-baner', 'Kolte-Patil 24K Glamore', 'Kolte-Patil', 'baner', 18.5544, 73.7831, 2021, 3, 180, 78, 4.2, 1.8, 8, '3-tier + CCTV + app', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100022341', true, false, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging", "sports", "indoor", "concierge"]'::jsonb, 'curated', 'unclaimed'),
    ('godrej-infinity-mundhwa', 'Godrej Infinity', 'Godrej Properties', 'magarpatta', 18.5211, 73.9251, 2018, 7, 680, 89, 3.2, 1.4, 14, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100018890', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging"]'::jsonb, 'curated', 'unclaimed'),
    ('majestique-towers-kharadi', 'Majestique Towers', 'Majestique Landmarks', 'kharadi', 18.5533, 73.9412, 2016, 5, 440, 90, 2.9, 1.3, 10, '3-tier + CCTV', 'Corporation', 'Full DG backup', 'Allowed', 'Mixed', 'P52100013912', true, true, '["pool", "gym", "clubhouse", "garden", "security", "ev"]'::jsonb, 'curated', 'unclaimed'),
    ('vtp-urban-nest-undri', 'VTP Urban Nest', 'VTP Realty', 'undri', 18.4631, 73.9051, 2020, 8, 760, 82, 2.5, 1.4, 16, '3-tier + CCTV', 'Tanker + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100020778', true, false, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging", "sports"]'::jsonb, 'curated', 'unclaimed'),
    ('paranjape-blue-ridge-hinjawadi', 'Forest Trails', 'Paranjape Schemes', 'hinjawadi', 18.5951, 73.7301, 2014, 10, 1100, 93, 2.7, 1.3, 22, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100011234', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "jogging", "sports", "indoor"]'::jsonb, 'curated', 'unclaimed'),
    ('nyati-esteban-undri', 'Nyati Esteban', 'Nyati Group', 'undri', 18.4602, 73.9012, 2018, 6, 540, 85, 2.6, 1.3, 12, '3-tier + CCTV', 'Tanker + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100017654', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev"]'::jsonb, 'curated', 'unclaimed'),
    ('the-address-balewadi', 'The Address by GS', 'Goel Ganga', 'balewadi', 18.5751, 73.7671, 2019, 5, 420, 87, 3.1, 1.4, 12, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100019012', true, false, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging"]'::jsonb, 'curated', 'unclaimed'),
    ('pristine-prolife-bavdhan', 'Pristine Prolife', 'Pristine Properties', 'bavdhan', 18.5221, 73.7821, 2016, 4, 320, 91, 2.8, 1.3, 8, '2-tier + CCTV', 'Corporation', 'Full DG backup', 'Allowed', 'Mixed', 'P52100013001', true, true, '["gym", "clubhouse", "garden", "kids", "security", "jogging"]'::jsonb, 'curated', 'unclaimed'),
    ('kohinoor-tinseltown-hinjawadi', 'Kohinoor Tinsel Town', 'Kohinoor Group', 'hinjawadi', 18.5901, 73.7451, 2020, 7, 620, 83, 2.9, 1.4, 14, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100021456', true, false, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging", "sports"]'::jsonb, 'curated', 'unclaimed'),
    ('ganga-legend-bavdhan', 'Ganga Legend', 'Goel Ganga', 'bavdhan', 18.5241, 73.7791, 2017, 6, 500, 90, 2.9, 1.3, 12, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100015123', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "jogging"]'::jsonb, 'curated', 'unclaimed'),
    ('life-republic-hinjawadi', 'Life Republic', 'Kolte-Patil', 'hinjawadi', 18.5871, 73.7281, 2015, 14, 1600, 92, 2.6, 1.3, 28, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100010912', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging", "sports", "indoor", "mall"]'::jsonb, 'curated', 'unclaimed'),
    ('saarrthi-skybay-wakad', 'Saarrthi Skybay', 'Saarrthi Group', 'wakad', 18.6051, 73.7601, 2018, 4, 360, 88, 2.9, 1.3, 10, '3-tier + CCTV', 'Corporation', 'Full DG backup', 'Allowed', 'Mixed', 'P52100017321', true, true, '["pool", "gym", "clubhouse", "garden", "security", "ev"]'::jsonb, 'curated', 'unclaimed'),
    ('panchshil-towers-kharadi', 'Panchshil Towers', 'Panchshil Realty', 'kharadi', 18.5471, 73.9501, 2019, 5, 300, 80, 4.5, 2, 12, '3-tier + CCTV + app', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100022890', true, false, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging", "sports", "indoor", "concierge", "spa"]'::jsonb, 'curated', 'unclaimed'),
    ('mahindra-antheia-pimpri', 'Mahindra Antheia', 'Mahindra Lifespaces', 'pimple-saudagar', 18.5951, 73.8051, 2016, 8, 700, 93, 3, 1.3, 16, '3-tier + CCTV', '24x7 Corp + Borewell', 'Full DG backup', 'Allowed', 'Mixed', 'P52100014098', true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "ev", "jogging", "sports"]'::jsonb, 'curated', 'unclaimed'),
    ('oxford-village-wanowrie', 'Oxford Village', 'Vilas Javdekar', 'magarpatta', 18.5181, 73.9291, 2014, 6, 520, 94, 2.8, 1.2, 12, '3-tier + CCTV', 'Corporation', 'Full DG backup', 'Allowed', 'Mixed', NULL, true, true, '["pool", "gym", "clubhouse", "garden", "kids", "security", "jogging"]'::jsonb, 'curated', 'unclaimed'),
    ('aditya-shagun-kothrud', 'Aditya Shagun', 'Aditya Builders', 'kothrud', 18.5081, 73.8211, 2013, 3, 210, 98, 3.1, 1.2, 6, '2-tier + CCTV', 'Corporation', 'Full DG backup', 'Allowed', 'Mixed', NULL, true, true, '["gym", "clubhouse", "garden", "security", "indoor"]'::jsonb, 'curated', 'unclaimed')
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name, builder = EXCLUDED.builder, locality_slug = EXCLUDED.locality_slug,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, year = EXCLUDED.year, towers = EXCLUDED.towers,
    units = EXCLUDED.units, occupancy = EXCLUDED.occupancy,
    maintenance_per_sqft = EXCLUDED.maintenance_per_sqft, parking_ratio = EXCLUDED.parking_ratio,
    lifts = EXCLUDED.lifts, security = EXCLUDED.security, water = EXCLUDED.water,
    power = EXCLUDED.power, pet_policy = EXCLUDED.pet_policy, veg_policy = EXCLUDED.veg_policy,
    rera = EXCLUDED.rera, registration = EXCLUDED.registration,
    conveyance = EXCLUDED.conveyance, amenities = EXCLUDED.amenities, source = EXCLUDED.source;

-- ---------------------------------------------------------------------------
-- Reels (slice 7). The 10 records from frontend/src/data/reels.json.
--
-- listing_id stays NULL. The mock's listingId values are its own ids ("P5000"); the real
-- properties table keys on uuid, and inventing a link to whichever property happens to be seeded
-- would put a wrong home behind a video. A reel with no listing link is honest; a reel pointing
-- at the wrong flat is a bug that looks like data. Owner: whoever produces real reel content.
--
-- Fixed uuids so re-running updates rather than duplicating (reels has no natural unique key).
-- ---------------------------------------------------------------------------
INSERT INTO reels (id, listing_id, title, locality, price, deal, poster, video, likes, views, tag) VALUES
    ('a7ee1000-0000-4000-8000-000000000001', NULL, '4 BHK Villa in Magarpatta', 'Magarpatta', 64000, 'rent', 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70', NULL, 263, 4355, 'Owner tour'),
    ('a7ee1000-0000-4000-8000-000000000002', NULL, '4 BHK Penthouse in Hinjawadi', 'Hinjawadi', 33000, 'rent', 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70', NULL, 69, 7712, 'Owner tour'),
    ('a7ee1000-0000-4000-8000-000000000003', NULL, '2 BHK Studio in Balewadi', 'Balewadi', 59000, 'rent', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, 917, 216, 'Walkthrough'),
    ('a7ee1000-0000-4000-8000-000000000004', NULL, '2 BHK Penthouse in Baner', 'Baner', 7624400, 'buy', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70', NULL, 827, 6930, 'Drone view'),
    ('a7ee1000-0000-4000-8000-000000000005', NULL, '3 BHK Villa in Undri', 'Undri', 4501200, 'buy', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70', NULL, 664, 5754, 'Owner tour'),
    ('a7ee1000-0000-4000-8000-000000000006', NULL, '1 BHK Flat in Baner', 'Baner', 15415400, 'buy', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', NULL, 293, 6890, 'Walkthrough'),
    ('a7ee1000-0000-4000-8000-000000000007', NULL, '2 BHK Penthouse in Balewadi', 'Balewadi', 21000, 'rent', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70', NULL, 567, 3133, 'Owner tour'),
    ('a7ee1000-0000-4000-8000-000000000008', NULL, '4 BHK Row House in Wakad', 'Wakad', 38000, 'rent', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', NULL, 955, 5205, 'Walkthrough'),
    ('a7ee1000-0000-4000-8000-000000000009', NULL, '4 BHK Row House in Magarpatta', 'Magarpatta', 61000, 'rent', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, 1071, 4962, 'Society tour'),
    ('a7ee1000-0000-4000-8000-000000000010', NULL, '1 RK Villa in Koregaon Park', 'Koregaon Park', 8874000, 'buy', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, 1172, 5324, 'Walkthrough')
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, locality = EXCLUDED.locality, price = EXCLUDED.price,
    deal = EXCLUDED.deal, poster = EXCLUDED.poster, video = EXCLUDED.video,
    likes = EXCLUDED.likes, views = EXCLUDED.views, tag = EXCLUDED.tag;

-- ---------------------------------------------------------------------------
-- Billing & Growth catalogues (slice 13).
--
-- GET /plans, GET /boost-packs and GET /service-catalog are the platform's three public price
-- lists and all three tables were empty, so every one of them answered `[]` -- a pricing page with
-- no prices. Reference data, so it belongs here rather than in a versioned migration.
--
-- The ids are literal rather than generated. These rows are referenced by SubscribeRequest.planId
-- and the boost body's packId, so a client that hard-codes one must get the same id in every
-- environment; ON CONFLICT (id) also needs a stable key to re-apply against.
--
-- Prices are illustrative and track settings->fees (ownerProYearly, featuredListing,
-- rentAgreementPlatform). Confirm real figures with the business before launch.
-- ---------------------------------------------------------------------------
INSERT INTO plans (id, name, audience, price, billing_cycle, features) VALUES
    ('b1000000-0000-4000-8000-000000000001', 'Owner Free',  'owner',     0, 'yearly',
     '["1 live listing", "Verified owner badge", "Unlimited enquiries"]'::jsonb),
    ('b1000000-0000-4000-8000-000000000002', 'Owner Plus',  'owner',  2499, 'yearly',
     '["2 live listings", "Self-serve boosts", "Priority support"]'::jsonb),
    ('b1000000-0000-4000-8000-000000000003', 'Owner Pro',   'owner',  4999, 'yearly',
     '["5 live listings", "Self-serve boosts", "Rent agreement included", "Dedicated manager"]'::jsonb),
    ('b1000000-0000-4000-8000-000000000004', 'Seeker Plus', 'tenant',  299, 'monthly',
     '["Unlimited owner contacts", "Instant alerts", "Saved-search priority"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
    name          = EXCLUDED.name,
    audience      = EXCLUDED.audience,
    price         = EXCLUDED.price,
    billing_cycle = EXCLUDED.billing_cycle,
    features      = EXCLUDED.features;

INSERT INTO boost_packs (id, name, price, duration_days, placement) VALUES
    ('b2000000-0000-4000-8000-000000000001', '7-day Spotlight',   999,  7, 'top'),
    ('b2000000-0000-4000-8000-000000000002', '15-day Featured',  1799, 15, 'featured'),
    ('b2000000-0000-4000-8000-000000000003', '30-day Homepage',  3499, 30, 'homepage')
ON CONFLICT (id) DO UPDATE SET
    name          = EXCLUDED.name,
    price         = EXCLUDED.price,
    duration_days = EXCLUDED.duration_days,
    placement     = EXCLUDED.placement;

-- Categories mirror the assisted-service desks in `Teams` (packers, interior, rental, legal,
-- loans, valuation) so an order can be routed to the team that already exists to work it.
INSERT INTO service_offerings (id, name, category, starting_price, description) VALUES
    ('b3000000-0000-4000-8000-000000000001', 'Packers & Movers',        'packers',   4999,
     'Doorstep packing, transport and unloading anywhere in Pune.'),
    ('b3000000-0000-4000-8000-000000000002', 'Home Painting',           'interior',  8999,
     'Interior repainting, per 1 BHK, materials included.'),
    ('b3000000-0000-4000-8000-000000000003', 'Deep Cleaning',           'rental',    2499,
     'Pre-move-in deep clean including kitchen and bathrooms.'),
    ('b3000000-0000-4000-8000-000000000004', 'Rent Agreement Drafting', 'legal',     1999,
     'Drafting, biometric e-registration and a stamped copy in your vault.'),
    ('b3000000-0000-4000-8000-000000000005', 'Home Loan Assistance',    'loans',        0,
     'Eligibility check and lender paperwork. Free; the lender pays us.'),
    ('b3000000-0000-4000-8000-000000000006', 'Property Valuation',      'valuation', 2999,
     'Bank-grade valuation report by an empanelled valuer.')
ON CONFLICT (id) DO UPDATE SET
    name           = EXCLUDED.name,
    category       = EXCLUDED.category,
    starting_price = EXCLUDED.starting_price,
    description    = EXCLUDED.description;
