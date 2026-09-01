-- Referrer dimension for the page-view rollup.
--
-- WHY THIS IS A SEPARATE MIGRATION
--
-- V96 shipped two aggregates: page_view_daily (keyed by day) and page_view_daily_paths (keyed by
-- day and path). Neither carries a referrer, so the Traffic tab's "Traffic sources" chart had
-- nowhere to read from but the raw table -- and reading raw would have quietly broken the one thing
-- the rollup exists to guarantee. Raw views are kept ninety days; the range picker offers a hundred
-- and eighty. The chart would have rendered, the axis would have said 180 days, and the first three
-- months of sources would simply have been absent, with nothing anywhere reporting a fault.
--
-- Caught while designing the read endpoints, before anything queried it.
--
-- WHY A THIRD TABLE RATHER THAN A COLUMN ON page_view_daily
--
-- Same reason V96 split day-grain from page-grain. A referrer is a property of a session, and a day
-- has many of them; folding the dimension into the day row would mean either one row per
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
