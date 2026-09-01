-- V03 DDL Catalog Geography: the geographic reference data the catalogue is built on.
--
-- Scope: `cities`, `city_waitlist`, `localities`, `societies`, `society_follows`. The registry of
-- where we operate, the waitlist of where people are asking us to, the localities and buildings a
-- listing is attached to, and the follow join that drives a society's follower count.
--
-- Folded from the old chain: V3 (the localities / societies / society_follows / cities /
-- city_waitlist parts only -- `properties` and `reels` live in the listings file), V15 (the
-- societies.security retype, the city_waitlist unique index and length checks, and the
-- unmaintained-counter comments), V89 (the society_follows follow-list index), V104 (the
-- `societies.place_id` / `loc_source` columns only -- the society_* community tables live in the
-- community file), V105 (society minting provenance + the candidates queue index), V108
-- (`mint_origin`), V111 (society merges), V112 (`admin_note`).

-- ---------------------------------------------------------------------------
-- cities: live-city registry (schema: City).
-- ---------------------------------------------------------------------------
CREATE TABLE cities (
    slug          text PRIMARY KEY,
    name          text NOT NULL,
    live          boolean NOT NULL DEFAULT false,
    listing_count integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- city_waitlist: growth waitlist (schema: CityWaitlistRequest).
-- ---------------------------------------------------------------------------
--
-- Length ceilings, mirroring the bean validation on CityWaitlistCreateRequest.
--
-- The Java layer already caps these, so this is not the first line of defence -- it is the one that
-- survives somebody removing an annotation. `city_waitlist` is written by the only unauthenticated
-- write in the catalogue, where "unbounded text from the internet" is exactly the input to distrust,
-- and this is the same lesson as the unique index below: a rule that lives only in the application
-- is a rule that holds only while every writer remembers it.
CREATE TABLE city_waitlist (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile     text NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
    city       text NOT NULL,   -- free text: a not-yet-registered city
    email      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT city_waitlist_city_len_check CHECK (length(city) <= 120),          -- mirrors @Size(max = 120)
    CONSTRAINT city_waitlist_email_len_check CHECK (email IS NULL OR length(email) <= 254)  -- mirrors @Size(max = 254)
);

-- city_waitlist: dedup by constraint
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

-- ---------------------------------------------------------------------------
-- localities: slug PK, market stats merged from Locality + LocalityDetail (reconciliation #8).
-- Variable-shape detail (connectivity, highlights, price trends) kept in JSONB.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- societies: curated/rera/community reference data (schema: Society + SocietyDetail aggregate cols).
-- ---------------------------------------------------------------------------
--
-- societies.security is text, not boolean  (spec fix S25)
--
-- It was originally modelled as a boolean, which asks "is there security?" -- a question with no
-- useful answer, because every gated society in Pune says yes. The frontend has always carried the
-- real value: "3-tier + CCTV", "Gated + CCTV", "Guard at gate only". Those are materially different
-- to somebody deciding where to live, and a boolean discards the difference while appearing to
-- answer.
--
-- WHAT `place_id` AND `loc_source` ARE FOR
--
-- The two facts an approved society proposal writes that the societies table had nowhere to put.
-- `place_id` is the only Google Place field persisted besides the coordinates; nothing else
-- (ratings, photos, reviews, opening hours) may be stored, per the Places terms.
--
-- `loc_source` is 'community' when a resident's corrected pin was approved. The hub renders the
-- provenance next to the map: a coordinate a neighbour walked to and a coordinate bulk-imported
-- from a RERA filing are both coordinates, and only one of them has been to the building.
--
-- COMMUNITY SOCIETY MINTING: PROVENANCE, AND THE OPS QUEUE THAT PROMOTES IT  (V105)
--
-- WHY THIS EXISTS
--
-- A lister or a searcher who cannot find their society is offered "Add it". Until V105 that mint
-- wrote a record to `pnCommunitySocieties` in that one browser's localStorage and registered the
-- slug into an in-memory lookup map. Three things followed from that, in ascending order of cost:
--
--   1. The society existed for exactly one person. Nobody else could find it, follow it, or list a
--      flat in it -- which is the entire reason somebody adds a society.
--   2. Following it 404'd against the server, because the server had never heard of the slug. The
--      follow context had to special-case such follows and hold them locally, hoping ops would one
--      day promote the slug. Ops could not: see (3).
--   3. The "Candidates" queue an operator opens to verify a community society read the *operator's*
--      browser. It was permanently empty. No community society had ever been promoted, because
--      there was no reachable path from minting one to anybody else seeing it.
--
-- So V105 did not add a feature. It gave an existing, shipped, four-surface funnel somewhere real
-- to write to.
--
-- WHAT IT ADDS
--
-- `source = 'community'` was already an allowed value on `societies_source_check` and is already
-- documented on the entity as one of the three provenances -- it just had no writer. Nothing about
-- the enum changed. What was missing is who minted a row and whether anybody has since checked
-- it, which are exactly the two questions the ops queue is asking.
--
-- Verification is deliberately NOT a boolean. `verified_at` plus `verified_by` answers "has anybody
-- looked at this, and who do I ask about it" -- a flag answers only the first, and the day two
-- operators disagree about a society the flag cannot say which of them set it. The pair is
-- constrained to move together, because a verification with no verifier is a decision nobody signed.
--
-- `registration` and `conveyance` stay untouched by promotion. They are claims about the building's
-- legal state, not about our confidence in the record; conflating "we checked this society is real"
-- with "its conveyance deed is done" is how a community-minted row would start telling a buyer
-- something nobody ever established.
--
-- WHAT HUMAN ACTION MINTED A SOCIETY: `mint_origin`  (V108)
--
-- WHY THIS EXISTS
--
-- The searcher-facing Society Finder is a tool for one question: "I want a flat in this building
-- and there isn't one listed — tell me when there is." When the building is not in the catalogue,
-- the finder mints it. The listing wizard mints too, from the other end: "I am posting a flat here
-- and you don't have my society."
--
-- Those are the same row and two completely different facts about the market. A society minted from
-- the finder is demand nobody is serving; a society minted from the wizard is supply arriving. The
-- ops candidates queue used to show that distinction as a chip -- "Searcher demand" against "From a
-- listing" -- and an operator reading the queue used it to decide which buildings to go and source
-- inventory in. That was the whole point of having a finder at all.
--
-- When minting moved to `POST /societies` (V105) the distinction was dropped: the request carries a
-- name, a locality and a pin, and nothing about who asked. The queue went binary-blind, and the
-- product question the finder exists to answer -- which societies are searchers asking for that
-- nobody has listed in? -- stopped being answerable from the database at all.
--
-- WHY THIS IS NOT `source`, AND WHY THE NAME IS DELIBERATELY UNLIKE IT
--
-- `societies.source` already exists and holds `curated` / `rera` / `community`. It is tempting to
-- add a fourth value there and be done. That would be wrong, and quietly so: the two columns
-- answer different questions and a row needs both answered.
--
--   source      -- where this row came from AS A DATA RECORD. We typed it in; a MahaRERA filing
--                  gave it to us; a member added it. It is the honesty field a reader weighs when
--                  deciding how much to believe the record.
--   mint_origin -- WHAT HUMAN ACTION produced it. A searcher asking for a building, or a lister
--                  posting a flat in one. It is an ops and demand-signal field. It says nothing
--                  about how trustworthy the record is.
--
-- Every `mint_origin` row is `source = 'community'` and always will be, which is exactly why they
-- must stay separate: folding a second axis into `source` would make `community` mean "member-added"
-- on Tuesday and "member-added, from a listing" on Wednesday, and every existing CHECK, index and
-- comparison against `'community'` would have to learn about a distinction none of them care about.
-- The candidates queue's partial index (V105) filters on `source = 'community'` and must keep
-- working unchanged whichever end the mint came from.
--
-- The column is named `mint_origin` rather than anything containing "source" so that nobody reading
-- a query six months from now has to work out which of two similarly-named columns they are looking
-- at. If a third mint surface ever appears it gets a third value here, not a fourth `source`.
--
-- WHY THE BACKFILL IS NULL AND NOT A VALUE
--
-- Nullable, with no default, and every pre-V108 row left null. Three groups of rows, and null is
-- the honest answer for all three:
--
--   * curated and rera rows were never minted by a person at all. There is no human action to
--     record. `'listing'` would claim a lister typed in 348 MahaRERA imports.
--   * community rows minted before V108 came through `POST /societies` from both surfaces,
--     indistinguishably. We did not record which, so we do not know which. Backfilling them to
--     `'listing'` because it is the commoner case invents a fact; backfilling them to `'demand'`
--     would be worse, because `'demand'` is the value ops act on -- it would send an operator to go
--     source inventory in a building nobody ever asked about.
--
-- So null means "not recorded", which is true, rather than a guess that reads as data. The reader
-- consuming this must treat null as unknown and not as the absence of demand. Note for whoever
-- repoints the ops UI: a two-branch chip of the form `origin === 'demand' ? "Searcher demand" :
-- "From a listing"` turns every null into a confident lie about a pre-V108 row. It needs three
-- branches, or the null row needs no chip at all.
--
-- New rows do get a value: `SocietyMintService` defaults an omitted origin to `'listing'`, which is
-- safe in the one direction that matters. Every shipped mint surface except the finder is on the
-- listing side, and the finder sends `'demand'` explicitly -- so a default can under-report demand
-- but can never fabricate it, and under-reported demand is a queue that is quieter than reality
-- rather than one that sends an operator somewhere pointless.
--
-- ONE SOCIETY ABSORBING ITS DUPLICATE: `merged_into`  (V111)
--
-- WHY THIS EXISTS
--
-- Auto-minting a society (V105) from four surfaces guarantees duplicates: "Kumar Pinnacle", "Kumar
-- Pinnacle Phase 1" and "kumar pinacle" are three rows and one building. V105's own comments say so
-- and say what fixes it -- "an operator finds them and merges them by hand" -- and the mint guard's
-- comments say the same in three more places. There had never been a server-side merge for that
-- operator to use.
--
-- What shipped instead was `mergeSocieties()` in the browser, writing a `from -> to` map to
-- `pnSocietyMerges` in localStorage. That has the same shape of failure as every other society
-- queue before it, and one worse consequence:
--
--   1. The merge was recorded in exactly one operator's browser. A second operator opening the
--      candidates queue saw the same duplicate pair untouched.
--   2. So they merged it again -- and nothing said which direction the first one chose. Two
--      operators can and will pick opposite survivors, and neither can see the other's decision.
--   3. Nobody outside that browser ever saw the result. The duplicate stayed in the public
--      directory, kept collecting listings, follows, reviews and residency claims, and split the
--      building's page in two for every reader.
--
-- So V111 did not add a feature either. It gave an existing, shipped ops action somewhere real to
-- write to, and made the answer the same for everybody who asks.
--
-- WHY A POINTER AND NOT A DELETE
--
-- Nine tables reference `societies (id)`: `properties`, `society_follows`, `society_claims`,
-- `society_residents`, `society_questions`, `society_board_items`, `society_contributions`,
-- `society_proposals`, and the flatmate rooms of V27. Deleting the losing row is therefore not
-- "tidying up" -- it is either a foreign-key violation or, if somebody cascades it, the silent
-- destruction of a resident's verified residency and of every review written about the building
-- under the other name. Moving those rows onto the survivor instead is not destructive but is
-- irreversible: once `properties.society_id` has been rewritten, nothing records which listings
-- moved, so a merge made in error can never be taken back.
--
-- A pointer moves nothing. `merged_into` records the operator's judgement and leaves every other
-- row exactly where it was; the reads follow the pointer and union the two societies' activity, so
-- one hub shows the whole building. Undoing a merge is then one statement that restores a state we
-- never left, which matters because merging the wrong pair is a realistic mistake -- the operator is
-- looking at two rows that differ by a typo -- and before V111 it had no undo at all.
--
-- WHY THE THREE COLUMNS MOVE TOGETHER
--
-- `ck_society_merged_trio` mirrors `ck_society_verified_pair`, for the same reason. A merge
-- with no operator and no timestamp is a decision nobody signed, and on the day two operators
-- disagree about which of two societies is the real one, the signature is the only thing that can
-- say who to ask. `num_nonnulls` rather than three pairwise checks: the constraint is "all or
-- none", and writing it as the thing it is keeps a future fourth column from being added to two of
-- the three checks.
--
-- WHY SELF-MERGE IS A SCHEMA CONSTRAINT AND CHAINS ARE NOT
--
-- `ck_society_merge_not_self` is expressible in SQL, costs nothing, and closes the one case that
-- would deadlock every reader: a row pointing at itself is an infinite resolution loop, and no
-- amount of service-layer care survives a hand-run UPDATE. So it is enforced where a hand-run
-- UPDATE cannot get past it.
--
-- Chains -- A merged into B while B is merged into C -- cannot be a CHECK, because a CHECK cannot
-- see another row. They are refused in `SocietyMergeService` instead, in both directions: a society
-- that is already merged away cannot be a merge target, and a society that has absorbed others
-- cannot itself be merged away until those are undone. The result is that resolution depth is
-- exactly one hop, forever, which is what lets every read follow the pointer with a single lookup
-- and lets an undo restore precisely the state that preceded it. That guarantee is worth the two
-- 409s it costs an operator, who is told in each case exactly which merge to undo first.
--
-- WHAT AN OPERATOR WROTE DOWN ABOUT A SOCIETY: `admin_note`  (V112)
--
-- WHY THIS EXISTS
--
-- The back office has always had a society editor. `AdminSocieties.jsx` opens a five-field form --
-- registration, conveyance, maintenance per sq ft, claim status, and a free-text note -- and
-- `saveEdit` writes all five into `pnSocietyOverlay` in the operator's own localStorage. Four of
-- those five are real columns on `societies` that the form has never been able to reach, and the
-- fifth is this one, which had nowhere to be reached.
--
-- That is the same failure the candidates (V105), residents (V110) and merges (V111) queues each
-- had, and it lands harder here because the fields are the ones a buyer reads. An operator who
-- checks a conveyance deed, ticks the box and is told it saved has changed nothing a searcher will
-- ever see; the next operator opens the same society and finds it untouched. The other four columns
-- needed no migration to fix that -- they were already here -- so V112 was only about the fifth.
--
-- WHY THE NOTE IS A COLUMN AND NOT A ROW IN `internal_notes`
--
-- V90 added `internal_notes`, and it is the right home for a thread: many notes, each with an
-- author and a time, about one subject. This is not that. The society editor offers one box whose
-- contents replace whatever was there -- "RERA lapsed, chasing the secretary" -- and it is read as
-- part of the record rather than as correspondence. Storing a single replaceable string as an
-- append-only thread would make "the current note" a query with an ordering and a limit, and would
-- leave the console either rendering a history nobody asked for or silently hiding all but the
-- newest row. If ops later wants a conversation about a society, that is `internal_notes` and this
-- column is untouched by it.
--
-- WHY NULLABLE, WITH NO DEFAULT AND NO BACKFILL
--
-- Almost every society will never have one, and null says exactly that. An empty string would be a
-- second way of saying the same thing, so the service normalises a cleared box back to null rather
-- than storing '' -- otherwise "no note" and "a note somebody deleted" would render differently on
-- a screen that means them identically.
--
-- WHY IT IS NOT ON THE PUBLIC SOCIETY RESPONSE
--
-- Same rule the `geo` blacklist reason follows: this is a moderator's free text about a named
-- building, written for colleagues and often about people. It goes out on `/admin/societies/{slug}`
-- and nowhere else. `GET /societies` and `GET /societies/{slug}` are anonymous reads and the column
-- is deliberately absent from `SocietyResponse`, which is what makes publishing it by accident a
-- compile error rather than a judgement call.
CREATE TABLE societies (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                  text NOT NULL UNIQUE,
    name                  text NOT NULL,
    builder               text,
    locality_slug         text REFERENCES localities(slug),
    lat                   double precision,
    lng                   double precision,
    place_id              text,
    loc_source            text,
    year                  integer,
    towers                integer,
    units                 integer,
    occupancy             numeric,
    maintenance_per_sqft  numeric,
    parking_ratio         numeric,
    lifts                 integer,
    security              text,                -- free text since V15/spec fix S25; was boolean in V3
    water                 text,
    power                 text,
    pet_policy            text,
    veg_policy            text,
    rera                  text,                -- MahaRERA id, nullable (reconciliation #2: string)
    registration          boolean NOT NULL DEFAULT false,
    conveyance            boolean NOT NULL DEFAULT false,
    amenities             jsonb NOT NULL DEFAULT '[]'::jsonb,
    source                text CHECK (source IN ('curated','rera','community')),
    mint_origin           text,
    claim_status          text NOT NULL DEFAULT 'unclaimed' CHECK (claim_status IN ('unclaimed','pending','claimed')),
    created_by            uuid REFERENCES users(id),
    verified_at           timestamptz,
    verified_by           uuid REFERENCES users(id),
    merged_into           uuid REFERENCES societies(id),
    merged_at             timestamptz,
    merged_by             uuid REFERENCES users(id),
    admin_note            text,
    listing_count         integer NOT NULL DEFAULT 0,
    follower_count        integer NOT NULL DEFAULT 0,
    avg_rating            numeric,
    review_count          integer NOT NULL DEFAULT 0,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_society_verified_pair CHECK ((verified_at is null) = (verified_by is null)),
    -- Enumerated in the database rather than only in the application, for the same reason
    -- `societies_source_check` is: this column steers an operator's day, and a typo'd `'demmand'`
    -- written by a future caller would not error anywhere -- it would simply never match, and the
    -- building would sit in the queue looking like supply forever.
    CONSTRAINT ck_society_mint_origin CHECK (mint_origin is null or mint_origin in ('demand', 'listing')),
    CONSTRAINT ck_society_merge_not_self CHECK (merged_into is distinct from id),
    CONSTRAINT ck_society_merged_trio CHECK (num_nonnulls(merged_into, merged_at, merged_by) in (0, 3))
);
CREATE INDEX idx_societies_locality ON societies (locality_slug);

-- The candidates queue, oldest first: the society that has waited longest is the one somebody is
-- still waiting on. Partial, because the queue is a handful of rows against a catalogue of hundreds
-- and a full index would be almost entirely dead weight.
create index idx_society_candidates
    on public.societies (created_at)
    where source = 'community' and verified_at is null;

-- Every society we already hold came from a curated list or a RERA filing, both of which are
-- verified by construction -- they are not candidates and must not appear in the ops queue. Stamping
-- them would have to use the row's own creation time rather than now(), so the audit trail does not
-- claim somebody reviewed 348 societies the moment a migration ran. verified_by would stay null,
-- which would violate the pair constraint, so no such backfill is applied to existing rows: the
-- queue is filtered on `source = 'community'` instead, and no curated or RERA row has that source.
--
-- (Left as a comment rather than as code on purpose. The filter is the correct mechanism; a
-- backfill that has to fabricate a verifier to satisfy its own constraint is a sign the constraint
-- is right and the backfill is wrong.)

-- One partial index, serving both readers of `merged_into`: the read-side union ("which societies
-- were merged into this one?", an equality lookup on merged_into) and the ops merge list ("what is
-- merged right now?", the whole partial index). Partial because merges are a handful of rows
-- against a catalogue of hundreds and a full index would be almost entirely dead weight.
--
-- Deliberately NOT a second index on (merged_at desc) for the ops list's ordering. That list sorts
-- the same handful of rows this index already narrows to, so the sort is over tens of rows and an
-- index to avoid it would be maintained on every merge to save nothing measurable.
create index idx_society_merged_into
    on public.societies (merged_into)
    where merged_into is not null;

-- No index on `admin_note`. It is never a search key: an operator reaches a note by opening the
-- society, and there is no screen that asks "which societies have notes". A trigram index over free
-- text so it could be searched some day is exactly the speculative cost V110 argues against in the
-- other direction.

-- ---------------------------------------------------------------------------
-- Society follow join (drives followerCount / followedByMe).
-- ---------------------------------------------------------------------------
CREATE TABLE society_follows (
    user_id    uuid NOT NULL REFERENCES users(id),
    society_id uuid NOT NULL REFERENCES societies(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, society_id)
);

-- D227 — GET /me/societies/following.
--
-- society_follows has a composite primary key (user_id, society_id), which serves the two reads
-- that existed before that route: both are scoped to a page of society ids, so the leading
-- user_id column plus an id list is all the planner needs.
--
-- The follow list asks the other question — every row for one user, ordered by when it was made —
-- and the primary key can locate those rows but not return them in order. Without this the page
-- costs a sort of the user's whole follow set on every read, on a route the dashboard calls on
-- load. Same reasoning, same shape and the same user_id-then-timestamp column order as the saved
-- properties index in the engagement file.
--
-- created_at is included rather than left to a sort so the index alone satisfies the ORDER BY;
-- DESC to match the query, since a backwards scan is cheap but a re-sort is not.
create index if not exists idx_society_follows_user_created
    on society_follows (user_id, created_at desc);

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

COMMENT ON COLUMN societies.security IS
    'Security arrangement, free text (e.g. "3-tier + CCTV"). Was boolean until V15/spec fix S25.';

comment on column public.societies.place_id is
    'Google Place id for the society, when a resident''s approved location fix supplied one. '
    'The only Place field persisted besides lat/lng.';
comment on column public.societies.loc_source is
    'Provenance of lat/lng: ''community'' once an approved resident correction wrote them.';

comment on column public.societies.created_by is
    'The member who minted this society, for community-sourced rows. Null for curated and RERA '
    'imports, which nobody in particular typed in. Kept so an operator reviewing a candidate can '
    'ask the person who added it, and so a single account minting fifty societies is visible.';

comment on column public.societies.verified_at is
    'When ops confirmed this society is real. Null means it is still a candidate. Paired with '
    'verified_by by ck_society_verified_pair: a verification with no verifier is a decision nobody '
    'signed, and the day two operators disagree it is the only way to know who to ask.';

comment on column public.societies.verified_by is
    'The operator who confirmed it. See verified_at.';

comment on column public.societies.mint_origin is
    'What human action minted this society: ''demand'' (a searcher looked for the building and it '
    'was not in the catalogue) or ''listing'' (somebody posting a flat could not find their '
    'society). NOT the same axis as `source`, and deliberately named so they cannot be confused: '
    '`source` says where the row came from as a data record (curated / rera / community) and is '
    'what a reader weighs for trustworthiness; `mint_origin` says which human action produced it '
    'and is what ops reads to find unserved demand. Every row with a mint_origin has '
    'source = ''community''. Null means not recorded -- true of all curated and RERA rows, which '
    'nobody minted, and of every community row created before V108, whose surface was not captured. '
    'Treat null as unknown, never as "not demand".';

comment on column public.societies.merged_into is
    'The surviving society this duplicate was merged into, or null. A pointer, not a move: every '
    'row in the nine tables that reference societies(id) stays where it is, and the reads union the '
    'two societies together. That is what makes a merge undoable -- rewriting properties.society_id '
    'would not be, because nothing would record which listings had moved.';

comment on column public.societies.merged_at is
    'When the merge was recorded. Moves with merged_into and merged_by via ck_society_merged_trio.';

comment on column public.societies.merged_by is
    'The operator who merged it. A merge with no signature is a decision nobody made, and the day '
    'two operators disagree about which of two rows is the real society it is the only way to know '
    'who to ask. See merged_at.';

comment on column public.societies.admin_note is
    'Ops'' free-text note about this society -- why a claim is stuck, what the secretary said, what '
    'to check next. Internal: served only on /admin/societies/{slug} and deliberately absent from '
    'the public Society response, because it is moderator prose about a named building and often '
    'about the people in it. Null means no note; a cleared note is stored as null rather than '''', '
    'so "never had one" and "had one that was deleted" cannot render differently.';

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- updated_at column.
SELECT install_updated_at_triggers();
