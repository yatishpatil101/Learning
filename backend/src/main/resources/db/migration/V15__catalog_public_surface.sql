-- V15: the two schema corrections the public catalogue surface needs (slice 7).
--
-- Both come from reading the contract and the UI against the schema rather than from new
-- requirements: one column was given a type that cannot hold the value the product needs, and one
-- table was given a uniqueness rule in the frontend but never in the database.

-- ---------------------------------------------------------------------------
-- societies.security: boolean -> text  (spec fix S25)
-- ---------------------------------------------------------------------------
--
-- V3 modelled this as a boolean, which asks "is there security?" -- a question with no useful
-- answer, because every gated society in Pune says yes. The frontend has always carried the real
-- value: "3-tier + CCTV", "Gated + CCTV", "Guard at gate only". Those are materially different to
-- somebody deciding where to live, and a boolean discards the difference while appearing to answer.
--
-- The USING clause is written out even though the table is empty. A migration that only works on an
-- empty table is a trap for whichever environment turns out not to be empty, and this one is one
-- clause long.
ALTER TABLE societies
    ALTER COLUMN security TYPE text
    USING CASE WHEN security IS NULL THEN NULL
               WHEN security THEN 'Gated'
               ELSE NULL
          END;

COMMENT ON COLUMN societies.security IS
    'Security arrangement, free text (e.g. "3-tier + CCTV"). Was boolean until V15/spec fix S25.';

-- ---------------------------------------------------------------------------
-- city_waitlist: dedup by constraint
-- ---------------------------------------------------------------------------
--
-- The frontend already dedupes a waitlist signup on (contact, city). The database never did, so the
-- rule held only for as long as one browser tab was the only writer -- which is to say, it did not
-- hold. This is the slice-3 lesson again: two concurrent submissions both pass a service-level
-- "does a row exist?" check before either commits, and only the database can answer honestly.
--
-- Keyed on lower(city) because `city` is free text typed by a person: "Mumbai", "mumbai" and
-- "MUMBAI" are one city and must collide. A case-sensitive index here would satisfy the letter of
-- "no duplicates" while permitting every duplicate that actually occurs.
--
-- Note the endpoint stays idempotent rather than erroring on a repeat: "you are already on the
-- list" and "you are now on the list" are the same outcome to the person asking.
--
-- This must stay an INDEX and not become a table CONSTRAINT: a UNIQUE constraint cannot be declared
-- over an expression, and lower(city) is one. CityWaitlistRepository#insertIfAbsent relies on it by
-- inference (`ON CONFLICT (mobile, lower(city))`), so changing these columns or dropping the
-- lower() will break that insert loudly at runtime — which is the intended failure mode.
CREATE UNIQUE INDEX uq_city_waitlist_mobile_city
    ON city_waitlist (mobile, lower(city));

-- Length ceilings, mirroring the bean validation on CityWaitlistCreateRequest.
--
-- The Java layer already caps these, so this is not the first line of defence -- it is the one that
-- survives somebody removing an annotation. `city_waitlist` is written by the only unauthenticated
-- write in the catalogue, where "unbounded text from the internet" is exactly the input to distrust,
-- and this is the same lesson as the unique index above: a rule that lives only in the application
-- is a rule that holds only while every writer remembers it.
ALTER TABLE city_waitlist
    ADD CONSTRAINT city_waitlist_city_len_check CHECK (length(city) <= 120),          -- mirrors @Size(max = 120)
    ADD CONSTRAINT city_waitlist_email_len_check CHECK (email IS NULL OR length(email) <= 254);  -- mirrors @Size(max = 254)

-- ---------------------------------------------------------------------------
-- Denormalised counters: documented as unmaintained  (decision D7.2)
-- ---------------------------------------------------------------------------
--
-- These columns are not dropped, because something seeded them and a DROP is not reversible by a
-- reader who does not know that. They are not maintained either -- no application code has ever
-- written to them, and at planning time three of fifteen localities already disagreed with reality.
--
-- The deeper problem is not staleness: the stored number counts every property, while every surface
-- that displays it counts approved and unarchived ones. A stale counter can be refreshed; a counter
-- measuring the wrong thing was wrong the day it was written. Slice 7 computes all of these on read
-- and ignores the columns.
COMMENT ON COLUMN localities.listing_count IS
    'UNMAINTAINED -- no writer. Counts are computed on read (decision D7.2). Do not trust this value.';
COMMENT ON COLUMN societies.listing_count IS
    'UNMAINTAINED -- no writer. Counts are computed on read (decision D7.2). Do not trust this value.';
COMMENT ON COLUMN societies.follower_count IS
    'UNMAINTAINED -- no writer. Counts are computed on read (decision D7.2). Do not trust this value.';
COMMENT ON COLUMN societies.avg_rating IS
    'UNMAINTAINED -- reviews are Engagement-slice territory. Computed on read, reads 0 until then.';
COMMENT ON COLUMN societies.review_count IS
    'UNMAINTAINED -- reviews are Engagement-slice territory. Computed on read, reads 0 until then.';
COMMENT ON COLUMN cities.listing_count IS
    'UNMAINTAINED -- no writer. Counts are computed on read (decision D7.2). Do not trust this value.';
