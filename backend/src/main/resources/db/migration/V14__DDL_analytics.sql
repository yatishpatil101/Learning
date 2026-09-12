-- V14 DDL Analytics: the measurement tables -- what people asked the inventory for, and what the
-- platform actually rendered.
--
-- Scope: `demand_signals` (the questions people asked that the inventory could not answer) and the
-- page-view telemetry set -- `page_views` (the raw grain) plus its three identity-free rollups
-- `page_view_daily` (day grain), `page_view_daily_paths` (day-and-page grain) and
-- `page_view_daily_referrers` (day-and-source grain).
--
-- Folded from the old chain: V88, V96, V97.
--
-- These are the platform's high-write tables and none of them carries a foreign key, deliberately
-- and for the same reason in every case: an event records that something happened, and it stays
-- true after its subject is gone. A cascade from `users` or `properties` would silently rewrite
-- settled history. Ordering here is therefore free of FK pressure; the tables are listed raw grain
-- first, then the rollups that read it, with `page_view_daily` ahead of the two tables that share
-- its day grain.


-- ---------------------------------------------------------------------------------------------
-- demand_signals
-- ---------------------------------------------------------------------------------------------

-- Demand signals: the questions people asked that the inventory could not answer.
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


-- ---------------------------------------------------------------------------------------------
-- Page-view telemetry: page_views, page_view_daily, page_view_daily_paths
-- ---------------------------------------------------------------------------------------------

-- Page-view telemetry: the measurement behind the Traffic, Engagement and Anonymous-surfers tabs.
--
-- WHY THIS EXISTS
--
-- Five tabs of the admin analytics console render a `Sample` chip, and three of them are illustrative
-- end to end: every number in Traffic, Engagement and Anonymous surfers comes from a seeded random
-- number generator in `lib/data/analytics/`. They are not stale figures, they are drawings. The
-- platform has never recorded that a page was rendered.
--
-- WHY NOTHING EXISTING ANSWERS IT
--
-- `demand_signals` looks like the natural home and cannot be one, for two reasons that are structural
-- rather than a matter of adding columns. It has no session identity, so two signals cannot be shown
-- to belong to one browsing session -- which makes session duration, bounce rate and distinct-visitor
-- counts underivable from it in principle, not merely absent today. And it has no page dimension: it
-- fires on searches and listing views, so every other surface on the platform emits nothing at all,
-- and a top-pages chart built from it would report that the platform has two pages.
--
-- `properties.views` looks like a page counter and is not one. It was declared with the original
-- properties table, it has no writer anywhere in the codebase, and it has read zero on every row
-- since.
--
-- WHY "PAGE VIEW" AND NEVER "VISIT"
--
-- A visit on this platform is a person going to look at a property in the physical world -- see the
-- `visits` table, `POST /visits`, visit requests and the completed-visit review gate. These are pages
-- rendered in a browser. Naming this table `visit_events` would have put two unrelated concepts one
-- underscore apart in the same schema, and the confusion would have been permanent.
--
-- WHY THREE TABLES AND NOT ONE
--
-- `page_views` is the raw grain and expires after ninety days. `page_view_daily` and
-- `page_view_daily_paths` are identity-free aggregates and are kept forever. The console reads only
-- the aggregates: the range picker offers 30, 90 and 180 days, so a report served from raw data would
-- silently return half a window at the widest setting -- the chart would render, the axis would look
-- right, and the first three months would simply be missing. Reading exclusively from the rollup
-- means the retention sweep can never change an answer.
--
-- WHY THE ROLLUP IS SPLIT BY GRAIN
--
-- Session measures -- how many sessions, how many bounced, how long they lasted -- are additive per
-- day but not per page. A visitor who reads six pages is one session, and totalling a per-page table
-- would count them six times. Page measures need the page. One table cannot hold both without either
-- repeating session totals on every page row (inviting exactly that error) or leaving them null on
-- all but one arbitrary row. So the day-grain facts live in `page_view_daily`, keyed by day alone,
-- and the page-grain facts live in `page_view_daily_paths`.
--
-- PRIVACY POSTURE
--
-- The raw table is erasable and the aggregates are not, which is the whole point of separating them:
-- an erasure request nulls `user_id` on the raw rows -- keeping the page view, dropping the person --
-- and the aggregates never held an identity to erase. Retention is ninety days, swept on a schedule;
-- see `PageViewRetention`.

CREATE TABLE page_views (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    text NOT NULL,
    user_id       uuid,
    path          text NOT NULL,
    referrer_host text,
    device        text NOT NULL,
    occurred_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT page_views_device_check CHECK (device IN ('mobile', 'tablet', 'desktop'))
);

COMMENT ON TABLE page_views IS
    'Raw page views, ninety-day retention. Read only by the rollup -- every report goes through '
    'page_view_daily and page_view_daily_paths.';

COMMENT ON COLUMN page_views.session_id IS
    'Opaque tab-scoped token minted in the browser and held in sessionStorage. It dies with the tab, '
    'so it is never correlated across visits and cannot accumulate into a profile. Deliberately not '
    'derived from the address, the User-Agent or the user id -- a token derived from those survives '
    'sign-out, which is exactly what a session-scoped token must not do.';

COMMENT ON COLUMN page_views.user_id IS
    'Null for signed-out viewers, which is the majority and is the measurement the Anonymous-surfers '
    'report is made of. Nulled rather than deleted on erasure: the view happened and is already '
    'counted in an aggregate naming nobody, so removing the row would falsify settled history to '
    'erase an identity that nulling removes just as completely. No foreign key -- a cascade would '
    'delete traffic history when an account closes.';

COMMENT ON COLUMN page_views.path IS
    'The matched route pattern (/property/:id), never the address bar. A query string carries search '
    'terms and referral identifiers and a fragment hides the same things, so a raw URL would put '
    'free-text personal data into the one table justified by holding none. Stripped server-side as '
    'well as client-side, because a convention the server does not enforce is one a forgotten call '
    'site quietly breaks.';

COMMENT ON COLUMN page_views.referrer_host IS
    'Host only (google.com), never the full referring URL -- on a search engine that URL contains the '
    'query the visitor typed. Null means a direct arrival or a browser that withheld the header; the '
    'two are not distinguishable and no report pretends otherwise. Internal referrers are dropped at '
    'the client, so an in-app hop does not appear as an inbound source.';

COMMENT ON COLUMN page_views.device IS
    'Viewport bucket: mobile, tablet or desktop. Deliberately not the User-Agent, which carries '
    'enough entropy to help fingerprint a viewer across sessions. Three buckets cannot single anybody '
    'out, and three buckets is all the device-split chart has ever shown.';

COMMENT ON COLUMN page_views.occurred_at IS
    'When the view happened, on the server clock. Distinct from insert time because the client '
    'batches: a whole session can arrive in one flush, and stamping every row with the insert time '
    'would compute that session duration as zero -- silently, for exactly the short sessions bounce '
    'rate is about. The client sends a relative offset and the server anchors it, so a wrong browser '
    'clock cannot file traffic under the wrong day.';

CREATE INDEX page_views_occurred_idx ON page_views (occurred_at DESC);
CREATE INDEX page_views_session_idx ON page_views (session_id, occurred_at);
CREATE INDEX page_views_user_idx ON page_views (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE page_view_daily (
    day                    date PRIMARY KEY,
    sessions               bigint NOT NULL DEFAULT 0,
    anon_sessions          bigint NOT NULL DEFAULT 0,
    signed_in_sessions     bigint NOT NULL DEFAULT 0,
    pageviews              bigint NOT NULL DEFAULT 0,
    bounced_sessions       bigint NOT NULL DEFAULT 0,
    duration_seconds_total bigint NOT NULL DEFAULT 0,
    mobile_sessions        bigint NOT NULL DEFAULT 0,
    tablet_sessions        bigint NOT NULL DEFAULT 0,
    desktop_sessions       bigint NOT NULL DEFAULT 0,
    rolled_up_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE page_view_daily IS
    'Day-grain traffic, cut on IST. Holds no identity, so it is exempt from the ninety-day sweep and '
    'from erasure, and is kept indefinitely -- year-on-year comparison is the point.';

COMMENT ON COLUMN page_view_daily.day IS
    'IST calendar day. The platform reports in the timezone it operates in; bucketing on UTC would '
    'move five and a half hours of every evening into the following day.';

COMMENT ON COLUMN page_view_daily.bounced_sessions IS
    'Sessions with exactly one page view. Stored as a count rather than a rate so the reader divides '
    'it -- a stored rate cannot be re-aggregated across days without weighting, and the version that '
    'forgets to weight looks perfectly plausible.';

COMMENT ON COLUMN page_view_daily.duration_seconds_total IS
    'Sum, not average, for the same reason: averages do not add. A weekly mean is this total over the '
    'weeks sessions, which is unrecoverable from seven daily averages.';

COMMENT ON COLUMN page_view_daily.rolled_up_at IS
    'When this row was last recomputed. The rollup revisits recent days as late events arrive, so '
    'this is how a reader tells a settled day from one still moving.';

CREATE TABLE page_view_daily_paths (
    day            date NOT NULL,
    path           text NOT NULL,
    pageviews      bigint NOT NULL DEFAULT 0,
    anon_pageviews bigint NOT NULL DEFAULT 0,
    exits          bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (day, path)
);

COMMENT ON TABLE page_view_daily_paths IS
    'Page-grain traffic per IST day. Separate from page_view_daily because session measures are '
    'additive per day but not per page -- a six-page session is one session and six page views.';

COMMENT ON COLUMN page_view_daily_paths.exits IS
    'Sessions whose last page view of the day was this path. The drop-off funnel is built from this: '
    'it names where people stop, which is the one thing a pageview count cannot say.';

CREATE INDEX page_view_daily_paths_day_idx ON page_view_daily_paths (day DESC);


-- ---------------------------------------------------------------------------------------------
-- page_view_daily_referrers
-- ---------------------------------------------------------------------------------------------

-- Referrer dimension for the page-view rollup.
--
-- WHY THIS IS A THIRD AGGREGATE AND NOT PART OF THE OTHER TWO
--
-- The page-view rollup above ships two aggregates: page_view_daily (keyed by day) and
-- page_view_daily_paths (keyed by day and path). Neither carries a referrer, so the Traffic tab's
-- "Traffic sources" chart would have had nowhere to read from but the raw table -- and reading raw
-- would have quietly broken the one thing the rollup exists to guarantee. Raw views are kept ninety
-- days; the range picker offers a hundred and eighty. The chart would have rendered, the axis would
-- have said 180 days, and the first three months of sources would simply have been absent, with
-- nothing anywhere reporting a fault.
--
-- Caught while designing the read endpoints, before anything queried it.
--
-- WHY A THIRD TABLE RATHER THAN A COLUMN ON page_view_daily
--
-- Same reason the rollup splits day-grain from page-grain. A referrer is a property of a session,
-- and a day has many of them; folding the dimension into the day row would mean either one row per
-- day-and-referrer (repeating every session total on each, inviting exactly the double-count the
-- split was designed to prevent) or a column per known source, which stops working the first time a
-- new referrer appears.
--
-- WHY SESSIONS AND NOT PAGE VIEWS
--
-- The question the chart answers is "where did visitors come from", and a visitor came from one
-- place per session. Counting page views would weight one arrival by how many pages it went on to
-- read, so a source sending a few deeply engaged visitors would outrank one sending many -- and the
-- chart, being a share-of-total doughnut, would present that as if it were reach.
--
-- PRIVACY POSTURE
--
-- Host only, never the full referring URL: on a search engine that URL contains the visitor's query.
-- Identity-free like the other two aggregates, so it is exempt from the ninety-day sweep and from
-- erasure, and is kept indefinitely.

CREATE TABLE page_view_daily_referrers (
    day            date NOT NULL,
    referrer_host  text NOT NULL,
    sessions       bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (day, referrer_host)
);

COMMENT ON TABLE page_view_daily_referrers IS
    'Sessions per referring host per IST day. Identity-free, kept indefinitely, and the only source '
    'the traffic-sources report reads -- see V96 for why no report may read page_views directly.';

COMMENT ON COLUMN page_view_daily_referrers.referrer_host IS
    'Host of the page the session arrived from, or the empty string for a direct arrival. Stored as '
    'a sentinel rather than NULL because it is half of the primary key, and because "direct" is a '
    'real answer the chart shows rather than an absence: it is the bucket for a typed address, a '
    'bookmark, and a browser that withheld the header, which are not distinguishable and which no '
    'report claims to distinguish.';

COMMENT ON COLUMN page_view_daily_referrers.sessions IS
    'Sessions, not page views. A visitor arrived from one place, so counting views would weight an '
    'arrival by how much it went on to read -- and in a share-of-total chart that would look like '
    'reach.';

CREATE INDEX page_view_daily_referrers_day_idx ON page_view_daily_referrers (day DESC);

SELECT install_updated_at_triggers();
