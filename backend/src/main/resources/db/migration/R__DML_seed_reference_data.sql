-- Repeatable reference/config seed; keep statements idempotent and never add user data. A statutory
-- charge is seeded only where it is a flat published figure, so a percentage stays NULL.
INSERT INTO platform_fees (deal, brokerage, platform_fee, stamp_duty, registration, gst, notes) VALUES
    ('rent', 0, 500, NULL,  NULL,  90, 'Zero brokerage; flat rent-agreement platform fee + 18% GST. Maharashtra stamp duty (0.25% of rent for the term + non-refundable deposit + 10% of the refundable deposit per year, rounded up to the next Rs 100, minimum Rs 100), registration (Rs 1,000 municipal / Rs 500 rural) and the Rs 300 document handling charge are statutory, computed per agreement from your terms, and collected on top.'),
    ('buy',  0, 4999, NULL,  30000, 900, 'Zero brokerage; the platform fee and GST are ours, the rest is the state''s. Maharashtra stamp duty is a percentage (5-7% incl. cess) of the higher of agreement value and ready reckoner rate, so it is calculated on your property, not published here; registration is 1% capped at Rs 30,000.')
ON CONFLICT (deal) DO UPDATE SET
    brokerage    = EXCLUDED.brokerage,
    platform_fee = EXCLUDED.platform_fee,
    stamp_duty   = EXCLUDED.stamp_duty,
    registration = EXCLUDED.registration,
    gst          = EXCLUDED.gst,
    notes        = EXCLUDED.notes;

-- Admin settings seed: a re-run only adds missing keys (`||` keeps stored values), so repricing survives.
INSERT INTO settings (key, value) VALUES
    ('fees', '{
        "ownerPlanYearly": 999,
        "ownerProYearly": 2499,
        "rentAgreementPlatform": 500,
        "seekerPlusTopup": 199,
        "gstPercent": 18,
        "freeContactLimit": 15,
        "referralContactBonus": 15,
        "referralQualifyPerMonth": 10
    }'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value || settings.value;

INSERT INTO settings (key, value) VALUES
    ('site', '{ "brand": "Draazy", "supportEmail": "support@draazy.com", "city": "Pune" }'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Flags and the Move-in Pack are admin-owned, so no DO UPDATE: this file's checksum moves whenever
-- the catalogue is regenerated, and both default safely when a later key is absent.
INSERT INTO settings (key, value) VALUES
    ('flags', '{
        "kycBadgeEnabled": true,
        "maintenanceMode": false,
        "signupsEnabled": true,
        "staffLoginEnabled": true
    }'::jsonb),
    ('movePack', '{
        "enabled": false,
        "items": {
            "movers": 8000,
            "clean": 2500,
            "agreement": 1500,
            "paint": 6000,
            "verify": 999,
            "internet": 500
        }
    }'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- City launch state is admin-owned and set only on insert; names remain reference data.
INSERT INTO cities (slug, name, live, listing_count) VALUES
    ('pune', 'Pune', true, 0),
    ('mumbai', 'Mumbai', false, 0),
    ('bengaluru', 'Bengaluru', false, 0),
    ('delhi-ncr', 'Delhi NCR', false, 0),
    ('hyderabad', 'Hyderabad', false, 0)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

-- A locality is live only once someone picks it from Google Places.
INSERT INTO localities (slug, name, city, lat, lng, active, archived_at) VALUES
    ('baner', 'Baner', 'Pune', 18.559, 73.776, false, now()),
    ('wakad', 'Wakad', 'Pune', 18.598, 73.762, false, now()),
    ('hinjawadi', 'Hinjawadi', 'Pune', 18.591, 73.738, false, now()),
    ('kharadi', 'Kharadi', 'Pune', 18.551, 73.941, false, now()),
    ('viman-nagar', 'Viman Nagar', 'Pune', 18.567, 73.915, false, now()),
    ('koregaon-park', 'Koregaon Park', 'Pune', 18.536, 73.893, false, now()),
    ('kothrud', 'Kothrud', 'Pune', 18.507, 73.807, false, now()),
    ('hadapsar', 'Hadapsar', 'Pune', 18.5, 73.926, false, now()),
    ('aundh', 'Aundh', 'Pune', 18.558, 73.807, false, now()),
    ('magarpatta', 'Magarpatta', 'Pune', 18.516, 73.928, false, now()),
    ('pimple-saudagar', 'Pimple Saudagar', 'Pune', 18.598, 73.805, false, now()),
    ('bavdhan', 'Bavdhan', 'Pune', 18.514, 73.772, false, now()),
    ('balewadi', 'Balewadi', 'Pune', 18.575, 73.772, false, now()),
    ('undri', 'Undri', 'Pune', 18.464, 73.917, false, now()),
    ('nibm-road', 'NIBM Road', 'Pune', 18.47, 73.901, false, now()),
    ('kalyani-nagar', 'Kalyani Nagar', 'Pune', 18.548, 73.902, false, now()),
    ('shivaji-nagar', 'Shivaji Nagar', 'Pune', 18.53, 73.852, false, now()),
    ('deccan', 'Deccan', 'Pune', 18.516, 73.841, false, now()),
    ('boat-club-road', 'Boat Club Road', 'Pune', 18.531, 73.879, false, now()),
    ('wagholi', 'Wagholi', 'Pune', 18.58, 73.978, false, now()),
    ('pashan', 'Pashan', 'Pune', 18.538, 73.789, false, now()),
    ('sus', 'Sus', 'Pune', 18.552, 73.755, false, now()),
    ('tathawade', 'Tathawade', 'Pune', 18.622, 73.751, false, now()),
    ('punawale', 'Punawale', 'Pune', 18.636, 73.751, false, now()),
    ('marunji', 'Marunji', 'Pune', 18.604, 73.712, false, now()),
    ('maan', 'Maan', 'Pune', 18.594, 73.7, false, now()),
    ('pimple-nilakh', 'Pimple Nilakh', 'Pune', 18.586, 73.797, false, now()),
    ('karve-nagar', 'Karve Nagar', 'Pune', 18.492, 73.822, false, now()),
    ('erandwane', 'Erandwane', 'Pune', 18.505, 73.828, false, now()),
    ('warje', 'Warje', 'Pune', 18.478, 73.803, false, now()),
    ('mundhwa', 'Mundhwa', 'Pune', 18.535, 73.925, false, now()),
    ('yerawada', 'Yerawada', 'Pune', 18.556, 73.884, false, now()),
    ('lohegaon', 'Lohegaon', 'Pune', 18.596, 73.918, false, now()),
    ('amanora', 'Amanora', 'Pune', 18.517, 73.933, false, now()),
    ('wadgaon-sheri', 'Wadgaon Sheri', 'Pune', 18.553, 73.923, false, now()),
    ('manjari', 'Manjari', 'Pune', 18.514, 73.965, false, now()),
    ('chandan-nagar', 'Chandan Nagar', 'Pune', 18.56, 73.936, false, now()),
    ('chinchwad', 'Chinchwad', 'Pune', 18.636, 73.795, false, now()),
    ('pimpri', 'Pimpri', 'Pune', 18.627, 73.805, false, now()),
    ('bhosari', 'Bhosari', 'Pune', 18.639, 73.848, false, now()),
    ('nigdi', 'Nigdi', 'Pune', 18.651, 73.768, false, now()),
    ('akurdi', 'Akurdi', 'Pune', 18.648, 73.766, false, now()),
    ('chikhali', 'Chikhali', 'Pune', 18.674, 73.827, false, now()),
    ('moshi', 'Moshi', 'Pune', 18.665, 73.855, false, now()),
    ('dighi', 'Dighi', 'Pune', 18.615, 73.868, false, now()),
    ('sangvi', 'Sangvi', 'Pune', 18.574, 73.813, false, now()),
    ('kalewadi', 'Kalewadi', 'Pune', 18.616, 73.803, false, now()),
    ('rahatani', 'Rahatani', 'Pune', 18.606, 73.797, false, now()),
    ('thergaon', 'Thergaon', 'Pune', 18.61, 73.78, false, now()),
    ('ravet', 'Ravet', 'Pune', 18.65, 73.746, false, now()),
    ('dapodi', 'Dapodi', 'Pune', 18.585, 73.838, false, now()),
    ('kasarwadi', 'Kasarwadi', 'Pune', 18.601, 73.828, false, now()),
    ('phugewadi', 'Phugewadi', 'Pune', 18.594, 73.831, false, now()),
    ('khadki', 'Khadki', 'Pune', 18.562, 73.848, false, now()),
    ('talawade', 'Talawade', 'Pune', 18.681, 73.782, false, now()),
    ('kudalwadi', 'Kudalwadi', 'Pune', 18.671, 73.818, false, now()),
    ('charholi-budruk', 'Charholi Budruk', 'Pune', 18.64, 73.895, false, now()),
    ('dudulgaon', 'Dudulgaon', 'Pune', 18.655, 73.882, false, now()),
    ('alandi', 'Alandi', 'Pune', 18.677, 73.897, false, now()),
    ('kiwale', 'Kiwale', 'Pune', 18.657, 73.735, false, now()),
    ('mamurdi', 'Mamurdi', 'Pune', 18.655, 73.728, false, now()),
    ('nigdi-pradhikaran', 'Nigdi Pradhikaran', 'Pune', 18.651, 73.762, false, now()),
    ('pimple-gurav', 'Pimple Gurav', 'Pune', 18.585, 73.822, false, now()),
    ('indrayani-nagar', 'Indrayani Nagar', 'Pune', 18.626, 73.845, false, now()),
    ('yamuna-nagar', 'Yamuna Nagar', 'Pune', 18.645, 73.772, false, now()),
    ('sambhaji-nagar', 'Sambhaji Nagar', 'Pune', 18.637, 73.799, false, now()),
    ('masulkar-colony', 'Masulkar Colony', 'Pune', 18.628, 73.803, false, now()),
    ('shahunagar', 'Shahunagar', 'Pune', 18.632, 73.802, false, now()),
    ('morewadi', 'Morewadi', 'Pune', 18.622, 73.812, false, now()),
    ('sant-tukaram-nagar', 'Sant Tukaram Nagar', 'Pune', 18.625, 73.818, false, now()),
    ('nevale-vasti', 'Nevale Vasti', 'Pune', 18.648, 73.746, false, now()),
    ('mohan-nagar', 'Mohan Nagar', 'Pune', 18.629, 73.812, false, now()),
    ('kalbhor-nagar', 'Kalbhor Nagar', 'Pune', 18.64, 73.808, false, now()),
    ('ram-nagar', 'Ram Nagar', 'Pune', 18.641, 73.796, false, now()),
    ('anand-nagar-chinchwad', 'Anand Nagar (Chinchwad)', 'Pune', 18.628, 73.797, false, now()),
    ('rupee-nagar', 'Rupee Nagar', 'Pune', 18.668, 73.79, false, now()),
    ('walhekar-wadi', 'Walhekar Wadi', 'Pune', 18.642, 73.755, false, now()),
    ('shinde-vasti-ravet', 'Shinde Vasti (Ravet)', 'Pune', 18.653, 73.748, false, now()),
    ('borhadewadi-moshi', 'Borhadewadi (Moshi)', 'Pune', 18.668, 73.845, false, now()),
    ('jadhavwadi', 'Jadhavwadi', 'Pune', 18.678, 73.822, false, now()),
    ('bankar-vasti-moshi', 'Bankar Vasti (Moshi)', 'Pune', 18.672, 73.85, false, now()),
    ('dhavde-vasti-bhosari', 'Dhavde Vasti (Bhosari)', 'Pune', 18.643, 73.852, false, now()),
    ('landewadi-bhosari', 'Landewadi (Bhosari)', 'Pune', 18.638, 73.842, false, now()),
    ('bhagat-vasti', 'Bhagat Vasti', 'Pune', 18.66, 73.84, false, now()),
    ('gulve-vasti', 'Gulve Vasti', 'Pune', 18.635, 73.865, false, now()),
    ('khande-vasti', 'Khande Vasti', 'Pune', 18.63, 73.858, false, now()),
    ('gavali-matha', 'Gavali Matha', 'Pune', 18.632, 73.852, false, now()),
    ('tuljai-vasti', 'Tuljai Vasti', 'Pune', 18.67, 73.83, false, now()),
    ('gavhanevasti', 'Gavhanevasti', 'Pune', 18.66, 73.86, false, now()),
    ('chakrapani-vasahat', 'Chakrapani Vasahat', 'Pune', 18.65, 73.76, false, now()),
    ('alhatwadi', 'Alhatwadi', 'Pune', 18.665, 73.882, false, now()),
    ('hinjawadi-phase-1', 'Hinjawadi Phase 1', 'Pune', 18.595, 73.735, false, now()),
    ('hinjawadi-phase-2', 'Hinjawadi Phase 2', 'Pune', 18.585, 73.72, false, now()),
    ('hinjawadi-phase-3', 'Hinjawadi Phase 3', 'Pune', 18.598, 73.69, false, now()),
    ('model-colony', 'Model Colony', 'Pune', 18.531, 73.836, false, now()),
    ('senapati-bapat-road', 'Senapati Bapat Road', 'Pune', 18.532, 73.833, false, now()),
    ('camp', 'Camp', 'Pune', 18.514, 73.878, false, now()),
    ('wanowrie', 'Wanowrie', 'Pune', 18.484, 73.899, false, now()),
    ('shaniwar-peth', 'Shaniwar Peth', 'Pune', 18.516, 73.853, false, now()),
    ('narayan-peth', 'Narayan Peth', 'Pune', 18.512, 73.853, false, now()),
    ('sadashiv-peth', 'Sadashiv Peth', 'Pune', 18.509, 73.851, false, now()),
    ('budhwar-peth', 'Budhwar Peth', 'Pune', 18.517, 73.858, false, now()),
    ('raviwar-peth', 'Raviwar Peth', 'Pune', 18.517, 73.861, false, now()),
    ('somwar-peth', 'Somwar Peth', 'Pune', 18.522, 73.868, false, now()),
    ('mangalwar-peth', 'Mangalwar Peth', 'Pune', 18.525, 73.872, false, now()),
    ('guruwar-peth', 'Guruwar Peth', 'Pune', 18.51, 73.857, false, now()),
    ('shukrawar-peth', 'Shukrawar Peth', 'Pune', 18.508, 73.855, false, now()),
    ('ganesh-peth', 'Ganesh Peth', 'Pune', 18.518, 73.865, false, now()),
    ('nana-peth', 'Nana Peth', 'Pune', 18.516, 73.869, false, now()),
    ('bhavani-peth', 'Bhavani Peth', 'Pune', 18.51, 73.867, false, now()),
    ('kasba-peth', 'Kasba Peth', 'Pune', 18.52, 73.858, false, now()),
    ('rasta-peth', 'Rasta Peth', 'Pune', 18.516, 73.867, false, now()),
    ('saras-baug', 'Saras Baug', 'Pune', 18.503, 73.855, false, now()),
    ('parvati', 'Parvati', 'Pune', 18.494, 73.851, false, now()),
    ('katraj', 'Katraj', 'Pune', 18.448, 73.858, false, now()),
    ('dhankawadi', 'Dhankawadi', 'Pune', 18.462, 73.853, false, now()),
    ('bibwewadi', 'Bibwewadi', 'Pune', 18.475, 73.865, false, now()),
    ('dhayari', 'Dhayari', 'Pune', 18.456, 73.808, false, now()),
    ('sinhagad-road', 'Sinhagad Road', 'Pune', 18.47, 73.826, false, now()),
    ('ambegaon-budruk', 'Ambegaon Budruk', 'Pune', 18.463, 73.837, false, now()),
    ('ambegaon-khurd', 'Ambegaon Khurd', 'Pune', 18.455, 73.828, false, now()),
    ('kondhwa', 'Kondhwa', 'Pune', 18.464, 73.888, false, now()),
    ('pisoli', 'Pisoli', 'Pune', 18.448, 73.905, false, now()),
    ('mahammadwadi', 'Mahammadwadi', 'Pune', 18.47, 73.918, false, now()),
    ('lulla-nagar', 'Lulla Nagar', 'Pune', 18.491, 73.892, false, now()),
    ('salunkhe-vihar', 'Salunkhe Vihar', 'Pune', 18.485, 73.905, false, now()),
    ('ghorpadi', 'Ghorpadi', 'Pune', 18.512, 73.902, false, now()),
    ('ganga-dham', 'Ganga Dham', 'Pune', 18.487, 73.883, false, now()),
    ('narhe', 'Narhe', 'Pune', 18.457, 73.797, false, now()),
    ('nanded-city', 'Nanded City', 'Pune', 18.451, 73.792, false, now()),
    ('kirkatwadi', 'Kirkatwadi', 'Pune', 18.443, 73.783, false, now()),
    ('khadakwasla', 'Khadakwasla', 'Pune', 18.442, 73.768, false, now()),
    ('yewalewadi', 'Yewalewadi', 'Pune', 18.44, 73.888, false, now()),
    ('kolewadi', 'Kolewadi', 'Pune', 18.445, 73.868, false, now()),
    ('handewadi', 'Handewadi', 'Pune', 18.462, 73.925, false, now()),
    ('autadwadi', 'Autadwadi', 'Pune', 18.463, 73.938, false, now()),
    ('wadachi-wadi', 'Wadachi Wadi', 'Pune', 18.452, 73.925, false, now()),
    ('khadi-machine-chowk', 'Khadi Machine Chowk', 'Pune', 18.457, 73.895, false, now()),
    ('dhanori', 'Dhanori', 'Pune', 18.586, 73.892, false, now()),
    ('kalas', 'Kalas', 'Pune', 18.596, 73.887, false, now()),
    ('uruli-devachi', 'Uruli Devachi', 'Pune', 18.435, 73.955, false, now()),
    ('fursungi', 'Fursungi', 'Pune', 18.47, 73.96, false, now()),
    ('shewalewadi', 'Shewalewadi', 'Pune', 18.48, 73.972, false, now()),
    ('keshav-nagar', 'Keshav Nagar', 'Pune', 18.542, 73.93, false, now()),
    ('sutarwadi', 'Sutarwadi', 'Pune', 18.548, 73.78, false, now()),
    ('mhalunge', 'Mhalunge', 'Pune', 18.577, 73.755, false, now()),
    ('nande', 'Nande', 'Pune', 18.567, 73.723, false, now()),
    ('chande', 'Chande', 'Pune', 18.575, 73.71, false, now()),
    ('pirangut', 'Pirangut', 'Pune', 18.52, 73.673, false, now()),
    ('bhugaon', 'Bhugaon', 'Pune', 18.5, 73.752, false, now()),
    ('bhukum', 'Bhukum', 'Pune', 18.535, 73.718, false, now()),
    ('chakan', 'Chakan', 'Pune', 18.76, 73.862, false, now()),
    ('talegaon-dabhade', 'Talegaon Dabhade', 'Pune', 18.735, 73.675, false, now()),
    ('dehu-road', 'Dehu Road', 'Pune', 18.712, 73.748, false, now()),
    ('lonikand', 'Lonikand', 'Pune', 18.616, 73.998, false, now())
ON CONFLICT (slug) DO NOTHING;

-- Reels retain NULL listing IDs until a verified property mapping exists; fixed IDs make reruns idempotent.
INSERT INTO reels (id, listing_id, title, locality, locality_slug, price, deal, poster, video, likes, views, tag) VALUES
    ('a7ee1000-0000-4000-8000-000000000001', NULL, '4 BHK Villa in Magarpatta', 'Magarpatta', 'magarpatta', 64000, 'rent', 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70', NULL, 263, 4355, 'Owner tour'),
    ('a7ee1000-0000-4000-8000-000000000002', NULL, '4 BHK Penthouse in Hinjawadi', 'Hinjawadi', 'hinjawadi', 33000, 'rent', 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70', NULL, 69, 7712, 'Owner tour'),
    ('a7ee1000-0000-4000-8000-000000000003', NULL, '2 BHK Studio in Balewadi', 'Balewadi', 'balewadi', 59000, 'rent', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, 917, 216, 'Walkthrough'),
    ('a7ee1000-0000-4000-8000-000000000004', NULL, '2 BHK Penthouse in Baner', 'Baner', 'baner', 7624400, 'buy', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70', NULL, 827, 6930, 'Drone view'),
    ('a7ee1000-0000-4000-8000-000000000005', NULL, '3 BHK Villa in Undri', 'Undri', 'undri', 4501200, 'buy', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70', NULL, 664, 5754, 'Owner tour'),
    ('a7ee1000-0000-4000-8000-000000000006', NULL, '1 BHK Flat in Baner', 'Baner', 'baner', 15415400, 'buy', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', NULL, 293, 6890, 'Walkthrough'),
    ('a7ee1000-0000-4000-8000-000000000007', NULL, '2 BHK Penthouse in Balewadi', 'Balewadi', 'balewadi', 21000, 'rent', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70', NULL, 567, 3133, 'Owner tour'),
    ('a7ee1000-0000-4000-8000-000000000008', NULL, '4 BHK Row House in Wakad', 'Wakad', 'wakad', 38000, 'rent', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', NULL, 955, 5205, 'Walkthrough'),
    ('a7ee1000-0000-4000-8000-000000000009', NULL, '4 BHK Row House in Magarpatta', 'Magarpatta', 'magarpatta', 61000, 'rent', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, 1071, 4962, 'Society tour'),
    ('a7ee1000-0000-4000-8000-000000000010', NULL, '1 RK Villa in Koregaon Park', 'Koregaon Park', 'koregaon-park', 8874000, 'buy', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, 1172, 5324, 'Walkthrough')
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, locality = EXCLUDED.locality, locality_slug = EXCLUDED.locality_slug,
    price = EXCLUDED.price,
    deal = EXCLUDED.deal, poster = EXCLUDED.poster, video = EXCLUDED.video,
    likes = EXCLUDED.likes, views = EXCLUDED.views, tag = EXCLUDED.tag;

-- `price` is a fallback only: paid plans are priced from `settings('fees')` by `PlanMapper`.
INSERT INTO plans (id, name, audience, price, billing_cycle, listing_limit, contact_limit, unlimited_contacts, features) VALUES
    ('b1000000-0000-4000-8000-000000000001', 'Owner Free',  'owner',     0, 'yearly',    1, NULL, false,
     '["1 live listing", "Verified owner badge", "Unlimited enquiries"]'::jsonb),
    ('b1000000-0000-4000-8000-000000000002', 'Owner Plus',  'owner',   999, 'yearly',    2, NULL, true,
     '["2 live listings", "Featured placement on every listing", "Priority support"]'::jsonb),
    ('b1000000-0000-4000-8000-000000000003', 'Owner Pro',   'owner',  2499, 'yearly',    5, NULL, true,
     '["5 live listings", "Featured placement on every listing", "Rent agreement included", "Dedicated manager"]'::jsonb),
    ('b1000000-0000-4000-8000-000000000004', 'Seeker Plus', 'tenant',  199, 'monthly', NULL, NULL, true,
     '["Unlimited owner contacts", "Instant alerts", "Saved-search priority"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
    name               = EXCLUDED.name,
    audience           = EXCLUDED.audience,
    price              = EXCLUDED.price,
    billing_cycle      = EXCLUDED.billing_cycle,
    listing_limit      = EXCLUDED.listing_limit,
    contact_limit      = EXCLUDED.contact_limit,
    unlimited_contacts = EXCLUDED.unlimited_contacts,
    features           = EXCLUDED.features;

-- Service categories route orders to their corresponding desks.
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

-- Message templates are repeatably seeded because local resets replay reference data.
-- The retired wa-aadhaar slug survives only where an outbound_message row still points at it.
delete from message_template t where t.id = 'wa-aadhaar'
   and not exists (select 1 from outbound_message o where o.template_id = t.id);
insert into message_template (id, channel, category, name, body) values
('wa-onboard', 'whatsapp', 'onboarding', 'Onboarding welcome',
 E'Hi {owner_name}, welcome to Draazy! \U0001F3E0\n\nYour property "{title}" in {locality} has been listed by our team. To make it live, please:\n\n1\uFE0F\u20E3 Open your claim link: {claim_link}\n2\uFE0F\u20E3 Upload property photos\n3\uFE0F\u20E3 Complete identity verification\n\nNeed help? Reply here or call us.\n\u2014 {staff_name}, Draazy Team'),
('wa-photos', 'whatsapp', 'reminder', 'Photo upload reminder',
 E'Hi {owner_name},\n\nYour listing "{title}" is almost ready! We just need property photos to publish it.\n\n\U0001F4F8 Upload 4-6 clear photos showing:\n\u2022 Living room/bedrooms\n\u2022 Kitchen & bathrooms\n\u2022 Balcony/exterior\n\nListings with photos get 3x more enquiries!\n\nUpload here: {claim_link}\n\u2014 Draazy Team'),
('wa-identity', 'whatsapp', 'reminder', 'Identity verification',
 E'Hi {owner_name},\n\nOne last step! Please verify your identity for "{title}" to go live.\n\n\U0001F512 A quick photo of your ID and a selfie — a one-time check to build trust with buyers.\n\nVerify here: {claim_link}\n\u2014 Draazy Team'),
('wa-gentle', 'whatsapp', 'reminder', 'Gentle follow-up',
 E'Hi {owner_name},\n\nJust checking in on "{title}" in {locality}. We have interested buyers waiting!\n\nIs there anything blocking you from completing the listing? Happy to help over call.\n\n\u2014 {staff_name}, Draazy'),
('wa-live', 'whatsapp', 'notification', 'Listing live notification',
 E'Great news, {owner_name}! \U0001F389\n\nYour property "{title}" is now LIVE on Draazy!\n\n\U0001F517 View: {listing_link}\n\nBuyers can now see your listing and send enquiries. We\'ll notify you when someone is interested.\n\n\u2014 Draazy Team'),
('wa-enquiry', 'whatsapp', 'notification', 'New enquiry alert',
 E'Hi {owner_name},\n\nYou have a new enquiry for "{title}"! \U0001F4E9\n\nA buyer is interested in your property. Please check your Draazy dashboard to approve or decline the contact request.\n\n\u2014 Draazy Team'),
('wa-pricing', 'whatsapp', 'advice', 'Pricing suggestion',
 E'Hi {owner_name},\n\nQuick market update for {locality}:\n\n\U0001F4CA Avg rate: \u20B9{market_rate}/sqft\n\U0001F3F7\uFE0F Your listing: \u20B9{price}\n\nProperties priced within 10% of market rate get 2x more views. Would you like to adjust?\n\n\u2014 {staff_name}, Draazy'),
('wa-docs', 'whatsapp', 'verification', 'Document request',
 E'Hi {owner_name},\n\nTo complete verification of "{title}", we need:\n\n\U0001F4C4 Property ownership proof (sale deed / society NOC)\n\U0001F4C4 Recent electricity bill\n\nPlease upload via your dashboard or share photos here.\n\n\u2014 {staff_name}, Draazy Team'),
('reason_photos_not_real', 'whatsapp', 'verification', 'Actual property photos needed',
 E'Hi {owner_name},\n\nFor "{title}", please add clear photos of the actual property so buyers know what they will visit.\n\nUpload them here: {claim_link}\n\n\u2014 Draazy Team'),
('reason_duplicate', 'whatsapp', 'verification', 'Duplicate listing check',
 E'Hi {owner_name},\n\nWe found another similar listing for "{title}". Please keep only the correct one live, or reply here if this is a separate property.\n\n\u2014 Draazy Team'),
('reason_broker', 'whatsapp', 'verification', 'Owner confirmation needed',
 E'Hi {owner_name},\n\nPlease confirm "{title}" is being listed by the owner or family member, not a broker. Reply here and we will continue the review.\n\n\u2014 Draazy Team'),
('reason_wrong_details', 'whatsapp', 'verification', 'Listing details need a quick fix',
 E'Hi {owner_name},\n\nSome details on "{title}" look different from the property. Please check the price, address, photos and room details, then resubmit.\n\n\u2014 Draazy Team'),
('reason_locality_unclear', 'whatsapp', 'verification', 'Locality needs confirmation',
 E'Hi {owner_name},\n\nWe could not place "{title}" in the right locality. Please update the locality or share the nearest landmark here.\n\n\u2014 Draazy Team'),
('reason_document_unreadable', 'whatsapp', 'verification', 'Readable document needed',
 E'Hi {owner_name},\n\nThe document/photo for "{title}" is not clear enough to read. Please upload a brighter, full-page photo and we will check again.\n\n\u2014 Draazy Team'),
('reason_name_mismatch', 'whatsapp', 'verification', 'Name confirmation needed',
 E'Hi {owner_name},\n\nThe name on the document for "{title}" does not match the listing owner. Please share the correct document or tell us the family connection.\n\n\u2014 Draazy Team'),
('wa-stale', 'whatsapp', 'reminder', 'Confirm still available (stale)',
 E'Hi {owner_name}, \U0001F44B\n\nQuick check on your listing "{title}" in {locality} \u2014 buyers are still finding it, but you haven\'t confirmed availability in a while.\n\nIs it still available?\n\u2705 Reply "YES" to confirm and keep it live & trusted\n\U0001F3E0 Reply "DONE" if it\'s already rented/sold and we\'ll close it\n\nConfirming takes one tap: \U0001F517 {listing_link}\n\n\u2014 Draazy Team'),
('wa-dormant', 'whatsapp', 'reminder', 'Dormant listing reactivation',
 E'Hi {owner_name}, \u23F0\n\nYour listing "{title}" in {locality} has been *paused* because it hasn\'t been confirmed as available in a while \u2014 so buyers can no longer see it.\n\nIf it is still available, reactivate it in one tap:\n\U0001F517 {listing_link}\n\nJust reply "YES" and we\'ll make it live again instantly. If it\'s already rented/sold, reply "DONE" and we\'ll close it for you.\n\n\u2014 Draazy Team')
ON CONFLICT (id) DO UPDATE SET
    channel  = EXCLUDED.channel,
    category = EXCLUDED.category,
    name     = EXCLUDED.name,
    body     = EXCLUDED.body;
