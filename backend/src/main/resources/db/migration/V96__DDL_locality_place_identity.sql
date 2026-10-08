-- A locality now exists because someone picked it from Google Places, not because we curated it.
-- Every curated row is retired with its stats cleared; slugs stay so existing bindings keep working.
alter table localities
    add column if not exists place_id text,
    add column if not exists archived_at timestamptz;

create unique index if not exists uq_localities_place_id
    on localities (place_id) where place_id is not null;

update localities set
    archived_at = coalesce(archived_at, now()),
    active = false,
    rate_per_sqft = null,
    avg_rent_psf = null,
    avg_buy_psf = null,
    avg_rent = null,
    demand = null,
    focus = null,
    about = null,
    connectivity = '[]'::jsonb,
    highlights = '[]'::jsonb,
    price_trends = '[]'::jsonb
where place_id is null;
