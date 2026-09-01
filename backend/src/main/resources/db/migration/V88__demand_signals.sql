-- V88 Demand signals: the questions people asked that the inventory could not answer.
--
-- Why this table exists.
-- The Supply-Gap tab compares listings per locality against demand per locality, and until now the
-- demand half was assembled in the browser. Three call sites -- a search on /listings, a "notify me"
-- submission, and a property view -- each appended a row to a localStorage array, and the admin
-- report read those arrays back out. That meant the report only ever described the searches
-- performed by the administrator reading it, in that browser, since the last time storage was
-- cleared. The one column with real breadth in it was the 82 fixture enquiry rows, which are
-- invented. Nobody's demand but your own was ever in the picture.
--
-- The signal is only worth collecting if it aggregates across everybody, which means it has to land
-- on the server. Hence a table.
--
-- Why one table with a `kind` rather than three.
-- Every row answers the same question -- "somebody wanted a home in this locality at this moment"
-- -- and every read groups by locality over a time window. Three tables would be three identical
-- shapes joined back together on every read, and adding a fourth signal later would mean a fourth
-- table and a fourth arm in the aggregate. The kinds differ in weight, not in structure, and weight
-- is the reader's business.
--
-- Why no mobile number, though the client was passing one.
-- `addDemandAlert` captured the visitor's mobile deliberately, including for signed-out visitors.
-- Not carried over. The only reader is an aggregate count per locality, which cannot use a phone
-- number, so storing it would mean holding contact details for people who never opened an account,
-- indefinitely, for a report that never displays them. Where there IS a relationship the contact
-- already exists on `saved_searches` (a row the same submit creates once the visitor signs in) and
-- on `city_waitlist`. This table is the anonymous half of that pair and should stay anonymous.
-- `user_id` is nullable and set only when a session happens to be signed in, so the aggregate can
-- distinguish repeat visitors from distinct ones without being able to name either.
--
-- Why no foreign keys.
-- An event records that something happened, and it stays true after its subject is gone. A view of
-- a property that is later hard-deleted is still evidence of demand for that locality on that day,
-- and a cascade would quietly rewrite history to say the interest never existed. `property_id` is
-- kept as a plain uuid for the rare "which listing drew this" follow-up, and the aggregate does not
-- join on it.
--
-- Why no archived triplet.
-- Nothing moderates a demand signal. There is no state a row can be in other than recorded, and no
-- action an operator would take on one. Retention is a sweep's job, not a flag's -- see the index.

CREATE TABLE demand_signals (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          text NOT NULL,
    locality_slug text,
    deal          text,
    bhk           text,
    property_id   uuid,
    user_id       uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT demand_signals_kind_check CHECK (kind IN ('search', 'alert', 'view'))
);

-- The only read is "group by locality over the last N days", so the index leads on the column the
-- aggregate groups by and carries the one it filters on. Created descending because every window is
-- anchored at now and reaches backwards; a retention sweep walks the same index from the other end.
CREATE INDEX demand_signals_locality_created_idx
    ON demand_signals (locality_slug, created_at DESC);

COMMENT ON TABLE demand_signals IS
    'Append-only record of demand: searches, alert requests and property views, by locality. '
    'Aggregate-only -- no contact details, and no foreign keys, so an event outlives its subject.';

COMMENT ON COLUMN demand_signals.kind IS
    'search | alert | view. Weighted by the reader, not here -- an alert request is a stronger '
    'signal than a view, but how much stronger is a reporting decision that may change.';

COMMENT ON COLUMN demand_signals.user_id IS
    'Null for signed-out visitors, which is the majority and is expected. Present only to tell '
    'repeat interest from distinct interest; never used to contact anybody.';
