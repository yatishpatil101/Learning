-- V3 Catalog, Listings & Localities (Phase 2). The property catalog + geographic reference.
-- Schemas: Locality(+Detail), Society(+Detail), Property/PropertySummary, ListingCreate/Update,
--          Reel, City, CityWaitlistRequest.

-- localities: slug PK, market stats merged from Locality + LocalityDetail (reconciliation #8).
-- Variable-shape detail (connectivity, highlights, price trends) kept in JSONB.
CREATE TABLE localities (
    slug          text PRIMARY KEY,
    name          text NOT NULL,
    city          text NOT NULL DEFAULT 'Pune',
    listing_count integer NOT NULL DEFAULT 0,
    avg_rent_psf  numeric,
    avg_buy_psf   numeric,
    rate_per_sqft numeric,
    avg_rent      bigint,                      -- absolute monthly INR
    demand        integer CHECK (demand BETWEEN 0 AND 100),
    focus         text CHECK (focus IN ('Buy','Rent','Both')),
    lat           double precision,
    lng           double precision,
    active        boolean NOT NULL DEFAULT true,
    about         text,
    connectivity  jsonb NOT NULL DEFAULT '[]'::jsonb,
    highlights    jsonb NOT NULL DEFAULT '[]'::jsonb,
    price_trends  jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_localities_city ON localities (city) WHERE active = true;

-- societies: curated/rera/community reference data (schema: Society + SocietyDetail aggregate cols).
CREATE TABLE societies (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                  text NOT NULL UNIQUE,
    name                  text NOT NULL,
    builder               text,
    locality_slug         text REFERENCES localities(slug),
    lat                   double precision,
    lng                   double precision,
    year                  integer,
    towers                integer,
    units                 integer,
    occupancy             numeric,
    maintenance_per_sqft  numeric,
    parking_ratio         numeric,
    lifts                 integer,
    security              boolean,
    water                 text,
    power                 text,
    pet_policy            text,
    veg_policy            text,
    rera                  text,                -- MahaRERA id, nullable (reconciliation #2: string)
    registration          boolean NOT NULL DEFAULT false,
    conveyance            boolean NOT NULL DEFAULT false,
    amenities             jsonb NOT NULL DEFAULT '[]'::jsonb,
    source                text CHECK (source IN ('curated','rera','community')),
    claim_status          text NOT NULL DEFAULT 'unclaimed' CHECK (claim_status IN ('unclaimed','pending','claimed')),
    listing_count         integer NOT NULL DEFAULT 0,
    follower_count        integer NOT NULL DEFAULT 0,
    avg_rating            numeric,
    review_count          integer NOT NULL DEFAULT 0,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_societies_locality ON societies (locality_slug);

-- Society follow join (drives followerCount / followedByMe).
CREATE TABLE society_follows (
    user_id    uuid NOT NULL REFERENCES users(id),
    society_id uuid NOT NULL REFERENCES societies(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, society_id)
);

-- properties: the listing (schema: Property = PropertySummary + detail). rera_id text nullable
-- (reconciliation #2), description not desc (reconciliation #3). Arrays -> JSONB.
CREATE TABLE properties (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                text UNIQUE,
    owner_id            uuid NOT NULL REFERENCES users(id),
    title               text NOT NULL,
    deal                text NOT NULL CHECK (deal IN ('buy','rent')),
    property_type       text NOT NULL,
    bhk                 numeric,
    price               bigint NOT NULL,
    price_unit          text CHECK (price_unit IN ('total','per-month')),
    deposit             bigint,
    maintenance         bigint,
    negotiable          boolean,
    area                numeric,
    area_unit           text DEFAULT 'sqft',
    carpet_area         numeric,
    built_up_area       numeric,
    super_built_up_area numeric,
    furnishing          text CHECK (furnishing IN ('unfurnished','semi-furnished','furnished')),
    floor               integer,
    total_floors        integer,
    facing              text,
    possession          text,
    locality            text NOT NULL,          -- display; localitySlug link is soft (seed keys by name)
    locality_slug       text REFERENCES localities(slug),
    society_id          uuid REFERENCES societies(id),
    city                text NOT NULL DEFAULT 'Pune',
    lat                 double precision,
    lng                 double precision,
    address             text,
    pincode             text,
    rera_id             text,
    description         text,
    amenities           jsonb NOT NULL DEFAULT '[]'::jsonb,
    images              jsonb NOT NULL DEFAULT '[]'::jsonb,
    cover_image         text,
    floor_plan          text,
    video               text,
    posted_by_type      text CHECK (posted_by_type IN ('owner','agent','builder')),
    status              text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','flagged','archived')),
    featured            boolean NOT NULL DEFAULT false,
    flag_reason         text,
    verified            boolean NOT NULL DEFAULT false,
    owner_verified      boolean NOT NULL DEFAULT false,
    ownership_verified  boolean NOT NULL DEFAULT false,
    society_verified    boolean NOT NULL DEFAULT false,
    conveyance_done     boolean NOT NULL DEFAULT false,
    docs_count          integer NOT NULL DEFAULT 0,
    views               integer NOT NULL DEFAULT 0,      -- denormalized counter
    enquiries           integer NOT NULL DEFAULT 0,      -- denormalized counter
    -- Admin post-on-behalf onboarding pipeline; hot filter = pipeline_stage, rest in JSONB.
    posted_by_admin     boolean NOT NULL DEFAULT false,
    pipeline_stage      text CHECK (pipeline_stage IN
                          ('listed','docs_submitted','photos_uploaded','aadhaar_verified','claim_sent','claimed')),
    admin_pipeline      jsonb NOT NULL DEFAULT '{}'::jsonb,
    archived            boolean NOT NULL DEFAULT false,  -- soft-delete
    archived_at         timestamptz,
    archive_reason      text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Indexes match the documented search filters + owner/admin queues (data-model.md Indexing).
CREATE INDEX idx_properties_owner        ON properties (owner_id);
CREATE INDEX idx_properties_locality     ON properties (locality);
CREATE INDEX idx_properties_society      ON properties (society_id);
CREATE INDEX idx_properties_pipeline     ON properties (pipeline_stage) WHERE posted_by_admin = true;
-- Hot public-search path: only approved, non-archived rows, filtered by the common facets.
CREATE INDEX idx_properties_search ON properties (deal, property_type, city, price, bhk)
    WHERE archived = false AND status = 'approved';

-- reels: short video promos tied to a listing.
CREATE TABLE reels (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id  uuid REFERENCES properties(id),
    title       text,
    locality    text,
    price       bigint,
    deal        text CHECK (deal IN ('buy','rent')),
    poster      text,
    video       text,
    likes       integer NOT NULL DEFAULT 0,
    views       integer NOT NULL DEFAULT 0,
    tag         text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reels_listing ON reels (listing_id);

-- cities: live-city registry + growth waitlist (schemas: City, CityWaitlistRequest).
CREATE TABLE cities (
    slug          text PRIMARY KEY,
    name          text NOT NULL,
    live          boolean NOT NULL DEFAULT false,
    listing_count integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE city_waitlist (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile     text NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
    city       text NOT NULL,   -- free text: a not-yet-registered city
    email      text,
    created_at timestamptz NOT NULL DEFAULT now()
);

SELECT install_updated_at_triggers();
