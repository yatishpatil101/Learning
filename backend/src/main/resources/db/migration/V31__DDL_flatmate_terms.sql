-- Two gaps, both of which pushed real terms into free text or into a column nothing guarded.
--
-- Gap 1: `flatmate_rooms.owner_consent_mobile` had no format check.
--
-- V13 gave `flatmate_groups.owner_consent_mobile` a ten-digit CHECK. V28 added the same column to
-- `flatmate_rooms` bare, so the two tables disagreed about what a consent lookup key even is. The
-- DTO has since grown @IndianMobile and the mapper normalises at the persist edge, which closes the
-- door for new writes -- but a constraint enforced only by the writer is a convention, and rows
-- written between V28 and that annotation are still sitting behind it. A number that cannot key the
-- consent table reads as a WITHHELD consent rather than as the typo it is, which is the expensive
-- direction to be wrong in.
--
-- Gap 2: the terms a flatmate actually signs up to had nowhere to live.
--
-- Notice period, lock-in and who pays maintenance and electricity are the questions that decide
-- whether a room is affordable, and none of them had a column. Hosts therefore wrote them into
-- `note`, and the Ops desk was told to read 600 characters of prose looking for terms that bite --
-- a rent quoted without a 2-month lock-in is a different offer, and the platform could not tell the
-- two apart, filter on either, or show a seeker the difference. Rooms and groups both get them
-- because both are a real flat with real terms; `flatmate_seeker_posts` does not, because a person
-- with no address has no terms to state.

-- ---------------------------------------------------------------------------
-- Consent lookup keys — rooms catch up with groups
-- ---------------------------------------------------------------------------
-- Recover what is recoverable first. These are numbers a human typed, so spacing, a +91 and a
-- leading 0 are the common shapes and all three survive normalising to the last ten digits.
UPDATE flatmate_rooms
   SET owner_consent_mobile = NULLIF(right(regexp_replace(owner_consent_mobile, '\D', '', 'g'), 10), '')
 WHERE owner_consent_mobile IS NOT NULL
   AND owner_consent_mobile !~ '^[6-9][0-9]{9}$';

-- Whatever is left cannot key the consent table, so it is not a lookup key -- it is a string. The
-- flag goes with it: `owner_consent` is only ever true because some number was found in
-- `flatmate_owner_consents`, and a standing true with no number left to re-derive it from is the
-- drift V28 added the column to stop.
UPDATE flatmate_rooms
   SET owner_consent_mobile = NULL,
       owner_consent        = false
 WHERE owner_consent_mobile IS NOT NULL
   AND owner_consent_mobile !~ '^[6-9][0-9]{9}$';

ALTER TABLE flatmate_rooms
    ADD CONSTRAINT ck_flatmate_rooms_owner_consent_mobile
        CHECK (owner_consent_mobile IS NULL OR owner_consent_mobile ~ '^[6-9][0-9]{9}$');

-- ---------------------------------------------------------------------------
-- Terms
-- ---------------------------------------------------------------------------
-- Groups took rent and no deposit while rooms took both, so the same flat quoted two different
-- up-front costs depending on which tab it was posted under.
ALTER TABLE flatmate_groups
    ADD COLUMN deposit bigint CHECK (deposit IS NULL OR deposit >= 0);

-- Nullable with no default, on both tables. Null means "not stated", which is what every existing
-- row honestly is -- defaulting to 30 days or to `included` would put words in the mouth of every
-- host who posted before the field existed, and a seeker reading a default as a promise is exactly
-- the invented fact this migration's first half exists to prevent.
--
-- Bounds rather than an open integer: a notice period is capped at six months and a lock-in at two
-- years by what the market actually writes into a Leave & License agreement. Zero is meaningful and
-- allowed on both -- "leave when you like" is a real term, and the commonest one between flatmates.
ALTER TABLE flatmate_rooms
    ADD COLUMN notice_period_days integer CHECK (notice_period_days IS NULL OR notice_period_days BETWEEN 0 AND 180),
    ADD COLUMN lock_in_months     integer CHECK (lock_in_months IS NULL OR lock_in_months BETWEEN 0 AND 24),
    ADD COLUMN maintenance_billing text   CHECK (maintenance_billing IS NULL OR maintenance_billing IN ('included','shared','separate')),
    ADD COLUMN electricity_billing text   CHECK (electricity_billing IS NULL OR electricity_billing IN ('included','shared','separate'));

ALTER TABLE flatmate_groups
    ADD COLUMN notice_period_days integer CHECK (notice_period_days IS NULL OR notice_period_days BETWEEN 0 AND 180),
    ADD COLUMN lock_in_months     integer CHECK (lock_in_months IS NULL OR lock_in_months BETWEEN 0 AND 24),
    ADD COLUMN maintenance_billing text   CHECK (maintenance_billing IS NULL OR maintenance_billing IN ('included','shared','separate')),
    ADD COLUMN electricity_billing text   CHECK (electricity_billing IS NULL OR electricity_billing IN ('included','shared','separate'));

-- ---------------------------------------------------------------------------
-- A seeker's budget is a range, because the board filters on one
-- ---------------------------------------------------------------------------
-- `budget` has always been a single number while the feed asks minBudget/maxBudget, so a seeker
-- willing to pay 15-20k had to pick one end and be invisible to half the rooms they could afford.
-- Added beside `budget` rather than replacing it: `budget` is a published wire field every reader
-- already understands, and re-reading it as the floor of a range is true of every row ever written.
ALTER TABLE flatmate_seeker_posts
    ADD COLUMN budget_max bigint
        CHECK (budget_max IS NULL OR budget_max > 0);

-- Written as a table constraint because it spans two columns. Null is the legacy shape and means
-- "one number, not a range" rather than "no ceiling" -- readers take budget as both ends.
ALTER TABLE flatmate_seeker_posts
    ADD CONSTRAINT ck_flatmate_seeker_posts_budget_range
        CHECK (budget_max IS NULL OR budget_max >= budget);

COMMENT ON COLUMN flatmate_rooms.owner_consent_mobile IS
    'The number the consent above was looked up by, normalised to ten digits. Stored so an edit can '
    're-derive the flag against the same owner rather than trusting the standing boolean -- without '
    'it, pointing the field at a different number would silently keep a consent granted for someone '
    'else''s flat. V31 gave it the format CHECK flatmate_groups has carried since V13: a number that '
    'cannot key flatmate_owner_consents misses the lookup and reads as a withheld consent.';

COMMENT ON COLUMN flatmate_seeker_posts.budget_max IS
    'The top of what this seeker will pay, or null when they quoted a single number. `budget` is the '
    'floor in both cases, so a null here means the range is a point rather than that it is open.';
