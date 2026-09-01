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
-- `properties.views` looks like a page counter and is not one. It was declared in V3, it has no
-- writer anywhere in the codebase, and it has read zero on every row since.
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
