-- V04 DDL Catalog Listings: the property listing aggregate and everything keyed off it.
--
-- Scope: `properties` (the listing), `reels` (short video promos tied to a listing),
-- `property_photo_hashes` (perceptual photo hashes for the image duplicate signal),
-- `photo_requests` (the "request more photos" demand signal) and
-- `listing_duplicate_dismissals` (the ops desk's "not a duplicate" verdict).
--
-- The geographic reference tables `localities`, `societies` and `cities` that shipped alongside
-- `properties` in V3 live in the reference-data file; `properties` references them.
--
-- Folded from the old chain: V3 (properties + reels only), V10 (possession CHECK), V37 (terminal
-- statuses + deal_status), V38 (reels.locality_slug), V40 (boosted_until), V62 (recheck queue),
-- V63 (the two ownership_verified_* columns only), V79 (duplicate signals), V86 (last_confirmed_at),
-- V92 (pipeline split into two funnels), V94 (quality_score), V95 (six search facets), V98
-- (property_type_key), V99 (commercial_use_key), V100 (share_type), V113 (drop of
-- idx_properties_society_unit -- never created here), V114 (bathrooms/parking/balconies), V115
-- (electricity_meter_key + drop of idx_properties_meter -- never created here), V116, V117, V118
-- (photo_requests.decided_at + the three-value status CHECK), V122.
--
-- `properties` MUST be created before `reels`, `property_photo_hashes` and `photo_requests`, all of
-- which carry a foreign key to it.

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

    -- V10 Constrain properties.possession, and make it a first-class search facet.
    --
    -- The column existed since V3 as unconstrained, nullable free text, was never written by any code
    -- path, and was NULL in every row. Meanwhile the React client has always modelled possession as a
    -- three-value enum driving the "Ready to move / New launch / Under construction" filter chips. That
    -- divergence only surfaced when the catalogue was pointed at the real API: with no server-side
    -- vocabulary and no filter support, selecting "Ready to move" returned zero rows -- a filter that
    -- silently returns nothing is worse than a filter that isn't offered at all.
    --
    -- This closes the gap at the layer that can actually guarantee it. Bean Validation rejects a
    -- bad value on the API edge, but only a CHECK constraint stops one arriving through a backfill, an ops
    -- script, or a future import job. Same posture as properties_furnishing_check directly above it.
    --
    -- NULL remains legal and means "not stated", which is deliberately distinct from all three states: a
    -- listing whose possession nobody recorded must not match a "Ready to move" search. Land and plots sit
    -- here permanently -- an empty plot has no construction to be ready or otherwise.
    --
    -- The original chain then backfilled the seeded catalogue so the facet had something to filter.
    -- Rules, not randomness, so the result was reproducible and defensible on re-run:
    --   * Rentals are let as finished homes -- a tenant cannot move into a building site.
    --   * Plots/land keep NULL, per the "not stated is a real state" rule above.
    --   * Sale listings were spread across the three states by a deterministic hash of the id, so the
    --     distribution is stable across environments instead of shifting with insertion order.
    --
    -- No dedicated index. The public search is already served by the partial idx_properties_search
    -- (approved + non-archived); possession is a low-cardinality residual filter that Postgres applies
    -- cheaply against that much smaller candidate set. Adding a dedicated index would be speculative
    -- -- revisit when the catalogue is large enough for EXPLAIN to justify it.
    possession          text CONSTRAINT properties_possession_check
                          CHECK (possession IS NULL OR possession = ANY (ARRAY[
                              'ready-to-move'::text,
                              'new-launch'::text,
                              'under-construction'::text
                          ])),

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

    -- ============================================================================================
    -- V37__property_deal_status.sql — make a listing's deal outcome public (tech-debt D110).
    --
    -- THE GAP
    -- -------
    -- Closed-ness lived only in `deals.status`, and every read of it is owner-scoped (`GET /me/deals`
    -- 404s for anyone but the owner). `DealService.close` never touched the property, and
    -- `properties.status` was constrained to pending|approved|rejected|flagged|archived, so there was
    -- no terminal value to set either. A buyer therefore stood on a sold listing with the full offer
    -- UI live; the server refused the stale offer with a 409 the buyer could not have predicted.
    --
    -- THE FIX (two halves, per the D110 ruling)
    -- -----------------------------------------
    --   1. TERMINAL STATUS. `properties.status` carries `sold` and `rented`. On deal close, the service
    --      transitions the listing to the terminal value that matches its `deal` intent (buy → sold,
    --      rent → rented); reopen reverts it to `approved`. Because the public search path is floored
    --      to `status = 'approved'` (the partial index `idx_properties_search`), a sold/rented listing
    --      drops out of search automatically — it stays reachable only by direct link, badged.
    --
    --   2. PUBLIC DEAL FIELD. A denormalized `deal_status` column mirrors `deals.status`
    --      (active|reserved|closed) onto the property, so the catalogue read path can surface
    --      "under offer" (reserved) WITHOUT another owner-scoped join or an N+1 per search row. Deal
    --      status is authored in `deals.deal.DealStatuses`; this column is a read-side mirror that
    --      `DealService` keeps in sync in the same transaction as every deal-status transition. The
    --      CHECK below is the guard that the mirror can only hold a legal value.
    --
    -- WHY DENORMALIZE RATHER THAN JOIN
    -- --------------------------------
    -- `deals` already depends on `catalog` (DealService reads PropertyRepository); a catalogue read of
    -- the deals table would invert that and create a package cycle. Mirroring the value onto the
    -- property keeps the dependency arrow one-way and the read path a plain column select.
    --
    -- The original chain backfilled the mirror from any deal row that already existed, and backfilled
    -- the terminal moderation status for deals that were already closed. That second backfill only
    -- touched rows that were currently `approved`: a closed deal on a pending/flagged/archived listing
    -- keeps its moderation state, exactly as reopen would leave it.
    -- ============================================================================================
    status              text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','flagged','archived','sold','rented')),
    -- Public deal-status mirror. Defaults to 'active' — a listing with no deal row is on the market.
    deal_status         text NOT NULL DEFAULT 'active'
                          CHECK (deal_status IN ('active','reserved','closed')),

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

    -- V63 D190/Q15: the two dates behind an "Ownership Verified" badge that is earned, and that
    -- lapses. The evidence itself is one row per document in `property_ownership_evidence`; these
    -- two columns are the derived answer the catalogue read path needs. See the column comments
    -- below for why the badge is DERIVED from `ownership_verified_until` rather than swept.
    ownership_verified_at    timestamptz,
    ownership_verified_until timestamptz,

    -- Admin post-on-behalf onboarding pipeline; hot filter = pipeline_stage, rest in JSONB.
    posted_by_admin     boolean NOT NULL DEFAULT false,

    -- D27 — two funnels, one column.
    --
    -- V3 gave properties a single `pipeline_stage` holding six values:
    --   listed, docs_submitted, photos_uploaded, aadhaar_verified, claim_sent, claimed
    -- The admin console shipped a board holding six *different* values:
    --   contacted, info_collected, listed, docs_submitted, under_review, live
    -- They agree on two. That is not a naming disagreement, it is two different questions sharing one
    -- column. The first four console values answer "how far has this owner got towards us having a
    -- listing at all"; the server's last four answer "how far have we got towards giving the listing
    -- back". A row can be at a point on both axes at once — a listing whose documents are in and whose
    -- photographs are up is `docs_submitted` on one and `photos_uploaded` on the other — and one column
    -- cannot hold both, so whichever question got written last silently erased the other.
    --
    -- So they are split across two columns:
    --
    --   pipeline_stage      -> the acquisition funnel: contacted, info_collected, listed, docs_submitted
    --   handback_milestone  -> the hand-back axis:     photos_uploaded, aadhaar_verified, claim_sent, claimed
    --
    -- The console's remaining two columns, `under_review` and `live`, are deliberately NOT in
    -- either. They are `status` under different names, and a row that carried both would have two
    -- opinions about whether it is public — see PipelineStage's class javadoc, which has argued this
    -- since V3. The board keeps showing six columns; it derives the last two from `status`.
    --
    -- Backfill (in the original chain). Rows already holding one of the four hand-back values were
    -- moved to the new column and their acquisition stage set to `docs_submitted`, which is where the
    -- acquisition funnel ends and is the only stage from which a hand-back can have started. Nothing
    -- was lost: the ordering within each axis is preserved, and a row that had reached `claim_sent`
    -- still reports claimLinkSent.
    pipeline_stage      text CHECK (pipeline_stage IN ('contacted','info_collected','listed','docs_submitted')),
    handback_milestone  text CHECK (handback_milestone IN ('photos_uploaded','aadhaar_verified','claim_sent','claimed')),

    admin_pipeline      jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- ============================================================================================
    -- V40__property_boosted_until.sql — make a paid boost actually influence ranking (tech-debt D59).
    --
    -- THE GAP
    -- -------
    -- An owner could buy a boost pack, the money settled, `boosts` recorded an `active` row with a
    -- start and end — and nothing anywhere read it. `BoostService.listForListing` says so out loud:
    -- "a boost does not yet influence ranking". The public search ordered by `created_at DESC` and had
    -- no idea the boosts table existed. We were charging for a promotion that did not promote.
    --
    -- THE FIX
    -- -------
    -- A denormalized `boosted_until` column mirrors the end of the listing's newest active promotion
    -- window onto the property, so the catalogue read path can rank promoted listings first WITHOUT a
    -- join into billing and without an N+1 per search row. This is the same read-side-mirror shape as
    -- `deal_status` above (D110), for the same reason: `billing.boost` already depends on `catalog`
    -- (BoostService reads PropertyRepository), so a catalogue read of the boosts table would invert
    -- that dependency and close a package cycle. BoostService writes this column in the same
    -- transaction as every activation.
    --
    -- WHY IT IS NOT SWEPT BACK TO NULL
    -- --------------------------------
    -- A past value means "the window closed", and it is left in place rather than nulled by a job.
    -- The ranking predicate therefore compares `boosted_until > now()` instead of trusting a nullable
    -- flag to be current, which means correctness does not depend on a sweeper having run recently.
    -- It also keeps "when did this listing last run a promotion" answerable from the catalogue row.
    --
    -- WHY NULLABLE RATHER THAN NOT NULL DEFAULT
    -- -----------------------------------------
    -- Most listings have never been boosted, and NULL says exactly that. A sentinel epoch default
    -- would make "never promoted" and "promoted long ago" indistinguishable, and would bloat the
    -- partial index below from the small promoted set to every row in the table.
    -- ============================================================================================
    boosted_until       timestamptz,

    -- V62 Q14: split the owner-edit re-review into two outcomes.
    --
    -- Until V62 every foundation-field edit called Property.revertToPending(), so the listing left
    -- search until a moderator re-approved it. That is the right answer for an edit that changes what
    -- the listing fundamentally *is* — locality, propertyType, bhk, deal — because a stale index entry
    -- would then be actively wrong: a 2BHK appearing under 3BHK, or a rental under sale, is a wrong
    -- answer rather than a slightly late one.
    --
    -- It is the wrong answer for price, furnishing and possession. Those change an attribute of a
    -- listing that is still the same property, so the worst case is a briefly out-of-date number on a
    -- listing that is still genuinely what it claims to be. The fraud risk is handled by the re-check
    -- either way; the only difference is whether the listing earns while it waits — and a marketplace
    -- that takes a listing dark for a day every time its price moves has taught owners not to move it.
    --
    -- So those three edits raise a work item *without* touching `status`. The column pair is
    -- deliberately shaped like flag_reason/status: the timestamp is the queue entry (and its age is the
    -- SLA), the reason is what the moderator reads. Nullable with no default, so every row starts with
    -- no pending re-check — correct, since none has been raised yet.
    recheck_requested_at timestamptz,
    recheck_reason       text,

    -- V86 — record when an owner last confirmed a listing is genuinely still available.
    --
    -- Why a column and not a derivation. The freshness badge on every listing card is computed from
    -- "how long since the owner last confirmed", and until V86 the only thing standing in for that
    -- confirmation was a `freshenedAt` field written into the browser's mock store. The confirmation
    -- therefore lived in whichever browser happened to make it: an owner who tapped "still available"
    -- on their phone saw the badge reset there and nowhere else, and every buyer -- and the owner's own
    -- laptop -- carried on being told the listing was stale. A signal about the state of the world was
    -- being stored per-device, which is the one place it cannot mean anything.
    --
    -- Why nullable, with no backfill. Null means "nobody has ever confirmed this listing", which is the
    -- truth for every row on a fresh database, and the reader falls back to created_at exactly as the
    -- client's freshness model already did. Backfilling created_at into this column would have produced
    -- identical behaviour on day one and a permanent lie afterwards: the column would claim an owner
    -- confirmed availability on the day they posted, which they did not, and there would be no way left
    -- to tell a listing whose owner actually answers from one that has never been touched. The fallback
    -- belongs in the reader, where it is visibly a fallback.
    --
    -- No index. Freshness is read per-row on listings the query has already selected, never filtered or
    -- sorted on -- the "recently confirmed" search facet ranks in the client off the same derived state.
    -- An index here would be paid for on every listing write and read by nothing.
    last_confirmed_at   timestamptz,

    -- The two signals that let the server notice one unit listed twice by two different owners.
    --
    -- WHAT THIS IS FOR. Two owners listing the same flat is the oldest fraud on an Indian property
    -- marketplace: a broker who does not hold the mandate posts the unit anyway, takes the enquiries,
    -- and collects a visit fee for a home they cannot let. The consumer submit form has flagged this
    -- since it was written -- and, like the user review flag in V77, it flagged it into the browser's
    -- own copy of the database, so the warning existed only on the machine of the person who happened
    -- to trigger it and was gone on reload. Ops, who are the only people who can act on it, never saw
    -- one. These columns are that capability made real, and they are what a rule can actually match on.
    --
    -- WHY TWO SIGNALS AND NOT ONE. They fail in opposite directions, which is why keeping both is not
    -- redundancy.
    --
    --   * `electricity_meter_no` is the precise one. A meter serves exactly one unit, the number is on
    --     a bill every owner has to hand, and unlike an address it has one spelling. When it is present
    --     on both sides a match is close to certain. It is optional and always will be: an owner in a
    --     society with a single bulk meter has nothing to type, and refusing their listing over it
    --     would punish the honest for their building's wiring.
    --
    --   * `address_key` is the one that fires when the meter is absent, which is most of the time. Pune
    --     addresses are unstandardised to the point of comedy -- "Flat 402, B Wing, Rohan Nilay, Baner"
    --     and "B-402 Rohan Nilay, Baner, Pune 411045" are the same doorway -- so the raw `address`
    --     column matches nothing useful. This holds a normalised form: casefolded, punctuation dropped,
    --     whitespace collapsed, and the filler words ("flat", "no", "wing", "apt", ...) removed, so the
    --     two strings above collapse to the same key. Derived and written by the server on every listing
    --     write, never accepted from the client -- a client-supplied key is a client-chosen collision.
    --
    -- WHY THE KEY IS A STORED COLUMN AND NOT AN EXPRESSION INDEX. The normalisation is a word-level
    -- filter, not a regex: it strips a vocabulary of filler tokens. Expressing that in SQL would mean
    -- either a chain of nested `replace()` calls that nobody can read or maintain, or an IMMUTABLE
    -- PL/pgSQL function that becomes a second definition of the rule -- and the moment the Java and the
    -- SQL disagree about whether "bldg" is filler, the index silently stops matching the query. One
    -- definition, in Java, written to a column.
    --
    -- WHY NEITHER COLUMN IS UNIQUE. The whole point is that a collision is *suspicious*, not
    -- impossible. Two owners legitimately share an address key when a bungalow is split into two
    -- tenancies, when a society reuses flat numbers across wings the address does not name, and every
    -- time the normaliser is a little too eager. A UNIQUE constraint would turn every one of those into
    -- a listing the owner simply cannot create, with a database error for an explanation. The rule that
    -- reads these columns opens a verification case and tells ops; a human decides.
    --
    -- WHY THE INDEXES ARE PARTIAL. Both columns are null for a large share of rows -- meter especially,
    -- address for any listing that never filled it in -- and the duplicate probe only ever looks for a
    -- non-null value. `WHERE ... IS NOT NULL` indexes exactly the rows that can match.
    electricity_meter_no text,
    address_key          text,

    -- Meter numbers get a normalised comparison key, so the duplicate probe's precise arm stops
    -- missing the collisions it exists to catch.
    --
    -- WHAT WAS WRONG. V79 introduced `electricity_meter_no` on the reasoning that a meter number,
    -- "unlike an address, has one spelling". That is true of the meter and false of the number. It is
    -- copied off a bill that prints it in groups, by a human who groups it their own way, so the same
    -- MSEDCL consumer number arrives as '170012345678', '1700 1234 5678' and '170-0123-45678'. Both
    -- duplicate queries compare with `=`, so those were three different meters.
    --
    -- The cost landed on the arm that is supposed to be the certain one. An owner who typed their
    -- number with spaces in March and without in April was never shown "you already listed this", and
    -- two owners fighting over one flat were never flagged to ops -- while the address arm, the one V79
    -- calls the weaker signal, went on working. A signal that silently fails is worse than an absent
    -- one, because the platform reports no duplicates and everybody believes it.
    --
    -- WHY A SECOND COLUMN AND NOT A NORMALISED FIRST ONE. The raw column is shown back to the owner,
    -- who checks it against a bill with the grouping printed on it. A value that reformats itself
    -- between submit and re-read reads as data loss to the one person able to tell us it is wrong. So
    -- this follows what V79 already did for `address`: raw column for the human, derived key for the
    -- comparison. `MeterKey` is the one derivation, run by the server on every write, never accepted
    -- from a client -- a client that picks its own key picks which listings it collides with.
    --
    -- WHY THE BACKFILL COULD RESTATE THE RULE IN SQL, WHERE V79's COULD NOT. V79 argued at length that
    -- `address_key` must not be an expression index, because its normalisation is a word-level filler
    -- filter that SQL can only express as an unreadable `replace()` chain or a second definition of the
    -- rule. None of that applies here: "strip everything that is not a digit" is one regex, total, and
    -- has no vocabulary to drift out of step with. The floor of six digits the backfill applied is
    -- restated in MeterKey.MIN_DIGITS; it exists because an optional field collects placeholders ('0',
    -- 'NA', '1234') and under exact equality every owner who typed the same placeholder collides with
    -- every other -- a moderation queue full of manufactured suspicion against honest owners.
    electricity_meter_key text,

    -- ============================================================================================
    -- V94 — the listing quality score is a column.
    --
    -- WHY THIS IS SQL AND NOT JAVA (D26 decision A).
    -- The score is 0-100 over fifteen fields that all live on this same row, and its whole purpose is
    -- to order search results. An ordering that the browser computes after the fetch cannot be paged:
    -- page 2 is a separate query, and a rank the database never saw cannot decide which rows belong on
    -- it. So the score has to be reachable from ORDER BY, which leaves three shapes — a stored column
    -- maintained by the service on write, a Hibernate @Formula, or this. A generated column wins on the
    -- one property that matters over a five-year codebase: it *cannot* go stale. There are eight write
    -- paths that touch a scored field (owner create, owner update, admin update, photo upload, photo
    -- delete, ownership verification, Aadhaar verification, document count) and a maintained column is
    -- only ever one forgotten call away from serving a number that quietly disagrees with the listing
    -- under it. Postgres recomputes this on every write, including the ones written years from now by
    -- somebody who has never read this file.
    --
    -- The cost, stated plainly: retuning the weights needs a migration. That is the right trade for a
    -- number shown to owners as advice and used to order what buyers see — it should be versioned, and
    -- a diff should say when it changed.
    --
    -- IMMUTABILITY. Every function here is immutable, which Postgres requires: jsonb_array_length,
    -- length, and coalesce over plain column references. No now(), no lookups into other tables. That
    -- is also why freshness is NOT part of this score even though it ranks alongside it — freshness is
    -- a function of the clock, so it can never be a stored column and is derived on read instead.
    --
    -- THIS IS NOT A LITERAL PORT, AND CANNOT BE. The browser scored four inputs that have no column
    -- behind them, because the mock invented them. Each substitution below is deliberate:
    --
    --   gallery[] / image      -> images jsonb, falling back to cover_image as a single photo.
    --   aadhaarVerified (10)   -> DROPPED as a separate term. The server has one identity flag, not
    --                             two: properties.owner_verified IS the Aadhaar/DigiLocker result.
    --                             The browser was scoring the same fact twice and calling it 20
    --                             points. Those 10 points move to ownership_verified, which is a
    --                             genuinely distinct and higher-bar signal the server already holds.
    --   age (rent 5 / buy 4)   -> NO REFERENT ANYWHERE at the time. There was no age_years column when
    --                             this score was written. Rent recovers its 5 by scoring deposit and
    --                             possession separately instead of as one OR'd pair; buy recovers its 4
    --                             on total_floors, a real completeness field of the same character as
    --                             floor.
    --   availableFrom (rent)   -> possession. The server describes timing once.
    --   construction (buy)     -> possession. Same field; the browser had two names for it.
    --
    -- Both deals still total exactly 100.
    -- ============================================================================================
    quality_score smallint GENERATED ALWAYS AS (
        LEAST(100,
            -- Photos (25). The single strongest predictor of an enquiry, so it carries the most
            -- weight and rewards the third photo disproportionately. A listing with an empty
            -- images[] but a cover_image counts as one photo, which is what the browser did.
            (CASE
                WHEN jsonb_array_length(COALESCE(images, '[]'::jsonb)) >= 3 THEN 25
                WHEN jsonb_array_length(COALESCE(images, '[]'::jsonb)) = 2 THEN 16
                WHEN jsonb_array_length(COALESCE(images, '[]'::jsonb)) = 1 THEN 8
                WHEN cover_image IS NOT NULL THEN 8
                ELSE 0
            END)

            -- Description (15). Banded by length rather than scored linearly: the difference
            -- between nothing and a sentence is real, the difference between 400 and 500
            -- characters is not.
            + (CASE
                WHEN length(COALESCE(description, '')) >= 200 THEN 15
                WHEN length(COALESCE(description, '')) >= 100 THEN 12
                WHEN length(COALESCE(description, '')) >= 50 THEN 8
                WHEN length(COALESCE(description, '')) > 0 THEN 3
                ELSE 0
            END)

            -- Trust (20). The two deals ask for different evidence, which is the reason this
            -- score is not one formula: a rental is about who the owner is, a sale is about
            -- whether they can prove they own it. See the header for why rent scores
            -- ownership_verified here rather than a second, duplicated identity flag.
            + (CASE WHEN deal = 'rent' THEN
                (CASE WHEN owner_verified THEN 10 ELSE 0 END)
                + (CASE WHEN ownership_verified THEN 10 ELSE 0 END)
              ELSE
                (CASE WHEN ownership_verified THEN 10 ELSE 0 END)
                + (CASE WHEN docs_count >= 3 THEN 10 WHEN docs_count >= 1 THEN 5 ELSE 0 END)
              END)

            -- Completeness (25). The fields a buyer filters on. 'unfurnished' scores less than a
            -- furnished flat not as a judgement on the property but because it is the default a
            -- form leaves behind, so it is weaker evidence that anyone answered the question.
            + (CASE WHEN deal = 'rent' THEN
                (CASE WHEN furnishing IS NULL THEN 0 WHEN furnishing = 'unfurnished' THEN 3 ELSE 5 END)
                + (CASE WHEN facing IS NOT NULL THEN 5 ELSE 0 END)
                + (CASE WHEN floor IS NOT NULL THEN 5 ELSE 0 END)
                + (CASE WHEN possession IS NOT NULL THEN 5 ELSE 0 END)
                + (CASE WHEN deposit IS NOT NULL THEN 5 ELSE 0 END)
              ELSE
                (CASE WHEN furnishing IS NULL THEN 0 WHEN furnishing = 'unfurnished' THEN 2 ELSE 4 END)
                + (CASE WHEN facing IS NOT NULL THEN 4 ELSE 0 END)
                + (CASE WHEN floor IS NOT NULL THEN 4 ELSE 0 END)
                + (CASE WHEN total_floors IS NOT NULL THEN 4 ELSE 0 END)
                + (CASE WHEN area IS NOT NULL THEN 4 ELSE 0 END)
                + (CASE WHEN possession IS NOT NULL THEN 5 ELSE 0 END)
              END)

            -- Amenities (15).
            + (CASE
                WHEN jsonb_array_length(COALESCE(amenities, '[]'::jsonb)) >= 5 THEN 15
                WHEN jsonb_array_length(COALESCE(amenities, '[]'::jsonb)) >= 3 THEN 10
                WHEN jsonb_array_length(COALESCE(amenities, '[]'::jsonb)) >= 1 THEN 5
                ELSE 0
            END)
        )
    ) STORED,

    -- ============================================================================================
    -- V95 — the six listing facets the browser invented.
    --
    -- WHAT WAS WRONG. The listings page has filtered on landUse, ageYears, room, tenants, availableFrom
    -- and pets since it was written, and not one of them had a column. They worked because the mock
    -- store made them up. Against the live API the http mapper never produced these fields, so the
    -- filter compared a selected value against `undefined` and every listing fell out: picking "pets
    -- allowed", or a tenant type, or a land use, returned an empty page. Silently. The mock hid a
    -- live-mode dead end for the entire life of the feature.
    --
    -- WHY COLUMNS AND NOT DELETION (D26 decision B). These are not decorative. Land zoning decides
    -- whether a plot is even legal for the buyer's purpose; tenant preference is the single most
    -- common reason a rental enquiry is wasted on both sides; pets is a hard yes/no that a tenant
    -- should never have to ask about twice. They are worth having for real, which means the owner has
    -- to be able to declare them and the query has to be able to filter on them.
    --
    -- WHY THIS BLOCKED PAGINATION. Filtering cannot be split. If even one facet stays in the browser,
    -- the server hands back page N and the client thins it after arrival -- so the page is short, the
    -- total is wrong, and rows the reader should have seen were never requested. Correct paging needs
    -- every predicate in the same query, which is why these six had to land before the search moved.
    -- ============================================================================================

    -- Zoning for open plots and farm land, which are sold by permitted use rather than by
    -- bedrooms. Mirrors the "Post a property" plotZoneOptions so a plot is searchable by exactly
    -- the zoning its owner declared. NULL for everything that is a building.
    land_use text
        CHECK (land_use IN ('residential', 'commercial', 'industrial', 'agricultural', 'mixed')),

    -- Age of the construction in years. NULL means unstated, which is NOT the same as zero -- a
    -- new launch is 0, an owner who never answered is NULL, and a range filter must not treat the
    -- second as the first. There is deliberately no upper bound: Pune has Peth houses older than
    -- any ceiling worth hard-coding, and the filter's own 25 is a "25+" open top.
    age_years integer CHECK (age_years >= 0),

    -- Flatmate room shape: a private room in a shared flat, or a bed in a shared room. Only
    -- meaningful for flatmate listings; NULL everywhere else.
    room text CHECK (room IN ('single', 'shared')),

    -- Who the owner will rent to. A set, not a single value -- "family or company, no bachelors"
    -- is the common Pune position and cannot be expressed as one enum. jsonb array of the same
    -- four tokens the filter offers; an empty array means "no stated preference", which the query
    -- must read as "matches every tenant filter" rather than "matches none".
    tenants jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- How soon the tenant can move in, as a bucket rather than a date. The filter is cumulative:
    -- asking for "within 30 days" must also return 'now' and '15'. Buckets keep that honest
    -- without a date that goes stale the moment nobody edits the listing.
    available_from text CHECK (available_from IN ('now', '15', '30')),

    -- Hard yes/no. NOT NULL with a false default because "unstated" and "no" mean the same thing
    -- to a tenant with a dog -- they will not risk it either way -- so an extra NULL state would
    -- buy nothing and complicate every predicate.
    pets boolean NOT NULL DEFAULT false,

    -- PG / hostel occupancy: how many people to a room. A set, because one PG almost always offers
    -- several -- a single room, a double, a triple -- at different rents, and a listing that could
    -- only claim one occupancy would have to be posted three times.
    --
    -- Its own column rather than the amenity list it was being read out of. The client's
    -- `offersSharing()` inferred occupancy from amenity tokens, which meant the filter was matching
    -- on a field nobody fills in for that purpose: an honest PG that listed 'wifi' and 'meals' but
    -- not an occupancy-shaped amenity simply disappeared from the sharing filter. Occupancy is a
    -- property of the room, not a facility offered with it.
    sharing jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- ============================================================================================
    -- V98 — the property type filter gets a canonical key.
    --
    -- THE BUG THIS FIXES. `properties.property_type` is free text ("e.g. apartment", per
    -- PropertySummary's own javadoc), and the eight filter keys the listings page offers are not the
    -- strings it holds. The browser bridged the gap with substring matching over an alias table
    -- (`propertyTypes.js` SEARCH_TYPES[].matches), so the "Flat" chip has always meant
    -- `flat OR studio OR penthouse`. The server compared for equality. Moving the filter server-side
    -- without this column would therefore have silently gutted it — measured against the e2e catalogue:
    --
    --   chip                shows today                                   exact match would show
    --   Flat                32  (flat, studio, penthouse)                 10
    --   Independent House    4  (independent house, row house)             0
    --   Commercial          12  (six different labels)                     0
    --   Farm Land            1  (farm land)                                0
    --   Open Plot            6  (open plot, plot)                          5
    --   Villa                5                                             5
    --
    -- Only Villa survived. Every other chip would have returned a confident, wrong, mostly-empty page
    -- that looks like "no such stock in Pune" rather than a broken filter.
    --
    -- WHY A COLUMN AND NOT A QUERY. Three shapes were possible: expand the key into its token list in
    -- the browser and send `types=flat,studio,penthouse`; mirror the substring matching server-side with
    -- ILIKE; or name the concept once, here. The first two leave the taxonomy as an exact-match
    -- allow-list over free text, so the day anyone stores "Apartment" or "1 RK" the listing quietly
    -- stops being findable — the same class of defect this column exists to remove, relocated. This
    -- column makes "what kind of property is this" a fact of the row rather than a guess each reader
    -- re-derives, and it is indexable, which a substring scan is not.
    --
    -- WHY GENERATED AND NOT MAINTAINED ON WRITE. Same reasoning as quality_score above, and it applies
    -- harder here: the write paths that set property_type include owner create, owner update, admin
    -- update and the SQL seeds, and a maintained column is one forgotten call away from a listing whose
    -- key disagrees with its own label. Postgres recomputes this on every write, including the ones
    -- made years from now by somebody who has never read this file. Every function used is immutable
    -- (lower, LIKE against constant patterns), which is what a generated column requires.
    --
    -- ONE KEY PER ROW — A DELIBERATE NARROWING. The browser let a listing match several chips at once;
    -- a column holds one value, so the CASE below is ordered and first match wins. This is only
    -- observable for a label that spans two families, e.g. "Commercial Plot", which used to appear
    -- under both Commercial and Open Plot and now appears under Commercial alone. That is the more
    -- honest of the two answers and the ordering is stated rather than incidental.
    --
    -- UNRECOGNISED LABELS RESOLVE TO NULL, so they match no type filter — exactly what the browser's
    -- substring matching already did with them. NULL means "we do not know what this is", which is
    -- greppable (see the audit query at the foot of this file) rather than silently misfiled under a
    -- default. A type filter narrowing to nothing is the correct response to a label nobody taught us.
    --
    -- THE TOKENS ARE NOT A LITERAL COPY OF THE BROWSER'S. They are the union of SEARCH_TYPES[].matches
    -- and the ALIASES table beside it, which is strictly more than the browser matched on. "Apartment"
    -- is the case that matters: ALIASES has always declared it a flat, the substring list never learned
    -- it, and the backend's own test fixtures store it — so it matched no chip in either mode. Closing
    -- that is a deliberate widening, not an accident of transcription.
    --
    -- pg / flatmates: the browser matches these two chips on `shareType`, which had no column at all
    -- when this key was written. Mapping the stored label is still the truthful thing for this column
    -- to do, so "PG / Hostel" resolves to 'pg'. The listings page does not filter on it — those two
    -- chips deep-link into the dedicated flatmates finder instead — but the data does not lie about
    -- itself in the meantime.
    -- ============================================================================================
    property_type_key text GENERATED ALWAYS AS (
        CASE
            -- PG first: 'pg / hostel' and 'pg / co-living' are unambiguous, and anchoring the
            -- pattern keeps a bare two-letter token from matching inside an unrelated word.
            WHEN lower(coalesce(property_type, '')) LIKE 'pg%' THEN 'pg'

            -- Commercial before land: "Commercial Plot" is commercial stock first (see the
            -- narrowing note above). Tokens mirror SEARCH_TYPES.commercial.matches exactly.
            WHEN lower(coalesce(property_type, '')) LIKE '%office%'
              OR lower(coalesce(property_type, '')) LIKE '%shop%'
              OR lower(coalesce(property_type, '')) LIKE '%showroom%'
              OR lower(coalesce(property_type, '')) LIKE '%retail%'
              OR lower(coalesce(property_type, '')) LIKE '%commercial%'
              OR lower(coalesce(property_type, '')) LIKE '%warehouse%'
              OR lower(coalesce(property_type, '')) LIKE '%godown%'
              OR lower(coalesce(property_type, '')) LIKE '%industrial%'
              OR lower(coalesce(property_type, '')) LIKE '%co-working%'
              OR lower(coalesce(property_type, '')) LIKE '%coworking%' THEN 'commercial'

            -- House before flat and villa so the legacy combined label "Villa / House" lands where
            -- the app's own alias table puts it, rather than being captured by the bare '%villa%'
            -- test below. The house tokens are always full phrases, never a bare 'house' — that is
            -- what keeps "Penthouse" out of the Independent House chip.
            WHEN lower(coalesce(property_type, '')) LIKE '%independent house%'
              OR lower(coalesce(property_type, '')) LIKE '%row house%'
              OR lower(coalesce(property_type, '')) LIKE '%villa / house%' THEN 'house'

            -- Flat covers studio and penthouse: one bedroom count, one building, one buyer.
            -- 'apartment' is here on the authority of the app's ALIASES table, which has always
            -- declared it a flat. The browser's substring list never learned it, so a listing
            -- stored as "Apartment" — the very example PropertySummary's javadoc gives — matched no
            -- chip at all. Carrying the alias across is the point of deriving this key rather than
            -- comparing labels: the taxonomy is stated once and new labels join it.
            WHEN lower(coalesce(property_type, '')) LIKE '%flat%'
              OR lower(coalesce(property_type, '')) LIKE '%studio%'
              OR lower(coalesce(property_type, '')) LIKE '%penthouse%'
              OR lower(coalesce(property_type, '')) LIKE '%apartment%' THEN 'flat'

            WHEN lower(coalesce(property_type, '')) LIKE '%villa%' THEN 'villa'

            -- Farm land before plot so "Farm Land" cannot be captured by a future plot token.
            WHEN lower(coalesce(property_type, '')) LIKE '%farm land%'
              OR lower(coalesce(property_type, '')) LIKE '%farmland%' THEN 'farmland'

            WHEN lower(coalesce(property_type, '')) LIKE '%open plot%'
              OR lower(coalesce(property_type, '')) LIKE '%plot%' THEN 'plot'

            ELSE NULL
        END
    ) STORED,

    -- V99 — a canonical key for the commercial subtype, for the same reason V98 added one for the
    -- property type: the browser filters commercial listings by substring against the stored label,
    -- and the server had no column that answers the same question.
    --
    -- `property_type_key` (V98) collapses every commercial label to the single key `commercial`, which
    -- is right for the top-level chip and useless for the sub-filter beneath it. A buyer who narrows to
    -- Warehouse / Godown is asking a question the type key cannot represent, so without this column the
    -- Commercial Type control could not move server-side at all — it would have had to be declared
    -- unsupported and disclosed in the UI, which for the commercial vertical means the sub-filter that
    -- makes the vertical usable stops working.
    --
    -- The tokens mirror COMMERCIAL_SUBTYPES in frontend/src/data/propertyTypes.js, which in turn
    -- mirrors the COMMERCIAL_SUBTYPES the posting wizard authors with — so a listing is filterable by
    -- exactly the option it was posted under. As with V98 the mapping is one key per row: a label that
    -- names two subtypes resolves to the first branch that matches, and a label that names none is
    -- NULL rather than a guess.
    --
    -- Generated rather than maintained on write, following V94 and V98: the label is set on eight
    -- different write paths, and a trigger or an application-side mirror on all eight is eight chances
    -- for the key and the label to disagree. A generated column cannot drift from its input.
    commercial_use_key text GENERATED ALWAYS AS (
      CASE
        WHEN lower(coalesce(property_type, '')) LIKE '%office%' THEN 'office'
        -- co-working before shop/retail: "Co-working Space" contains neither, but keeping the more
        -- specific arrangements ahead of the general ones is what stops a future label like
        -- "Co-working Retail Hub" landing under retail.
        WHEN lower(coalesce(property_type, '')) LIKE '%co-working%'
          OR lower(coalesce(property_type, '')) LIKE '%coworking%' THEN 'coworking'
        WHEN lower(coalesce(property_type, '')) LIKE '%shop%'
          OR lower(coalesce(property_type, '')) LIKE '%showroom%' THEN 'shop'
        WHEN lower(coalesce(property_type, '')) LIKE '%retail%'
          OR lower(coalesce(property_type, '')) LIKE '%mall%' THEN 'retail'
        WHEN lower(coalesce(property_type, '')) LIKE '%warehouse%'
          OR lower(coalesce(property_type, '')) LIKE '%godown%' THEN 'warehouse'
        WHEN lower(coalesce(property_type, '')) LIKE '%industrial%'
          OR lower(coalesce(property_type, '')) LIKE '%factory%' THEN 'industrial'
        ELSE NULL
      END) STORED,

    -- V100 — canonical share-type key, so the type chips can exclude shares server-side.
    --
    -- WHAT WAS WRONG. `property_type_key` (V98) answers "what kind of building is this", which is not
    -- quite what the type chips ask. A PG posted with property_type "Flat" keys as `flat`, so once
    -- filtering moved to the database a Flat search started returning PG buildings and shared rooms.
    -- The browser never did that: `matchBuyType`/`matchRentType` bail out on a listing carrying a
    -- shareType, so a share only ever matched the PG or Flatmates chip. That rule had nowhere to live
    -- server-side, because PG-ness is not written down anywhere as a value — it is *implied* by two
    -- other columns, `sharing` (occupancy options, V95) and `room` (flatmate room shape, V95).
    --
    -- WHY A COLUMN AND NOT A PREDICATE. The implication could be spelled out in every query instead:
    -- `jsonb_array_length(sharing) = 0 AND room IS NULL`. That is the same rule copied into each place
    -- that filters by type, counts a facet, or ranks — and the last audit found exactly that class of
    -- copy drifting (the ownership-verification lapse honoured by the filter but not the ranking).
    -- Naming it once means the definition of "this is a share" has one home.
    --
    -- GENERATED, for the same reason V94/V98/V99 are: `sharing` and `room` are set on several write
    -- paths, and a trigger or an application-side mirror is one chance to drift per path. A generated
    -- column cannot disagree with its inputs.
    --
    -- NO INDEX. Unlike V98/V99 this column is NULL for the overwhelming majority of rows, and the
    -- dominant read is `share_type IS NULL` — the ordinary Flat/House/Villa search. An index whose
    -- entries are almost all one value, and whose selective case is the one nobody filters on, would
    -- cost every write and be ignored by the planner. The type-key index still carries these queries.
    share_type text GENERATED ALWAYS AS (
        CASE
            WHEN jsonb_array_length(sharing) > 0 THEN 'pg'
            WHEN room IS NOT NULL THEN 'flatmates'
            ELSE NULL
        END
    ) STORED,

    -- ============================================================================================
    -- V114 — the two detail tiles nobody could ever fill.
    --
    -- WHAT WAS WRONG. The property detail page has shown a Bathrooms tile and a Parking tile since it
    -- was written, and neither had a column. Parking simply rendered "—" for every live listing. The
    -- bathroom count was worse: `useProperty` fell back to `Math.max(1, bhkNum - 1)`, so a 3 BHK was
    -- reported as having 2 bathrooms — as a fact, in the same tile shape as the price and the carpet
    -- area — on the strength of arithmetic rather than anything the owner said. The same expression had
    -- been copied into four more components, so the invention was consistent enough to look sourced.
    --
    -- Inventing a number is worse than omitting one. A blank tile makes a reader ask; a confident wrong
    -- tile makes them stop asking, and bathrooms are a real decision input in shared and family rentals.
    -- So the fix is not a better guess, it is a column the owner fills in and a page that says nothing
    -- when they have not.
    --
    -- WHY BOTH ARE PLAIN COUNTS. Bathrooms is unambiguous. Parking is the debatable one: `amenities`
    -- already carries '2-Wheeler Parking' and '4-Wheeler Parking', so a count is a second source of
    -- truth about the same subject. They answer different questions and both get asked — the amenity
    -- says a bike can be kept, the count says whether the second car has anywhere to go, and a reader
    -- comparing two otherwise identical flats is asking the second. The amenity tokens stay; they are
    -- what a PG or an office declares, where a per-listing count is meaningless.
    --
    -- WHY NOT NULL IS WRONG HERE. Same rule as age_years: NULL means the owner never answered, and 0
    -- means they answered "none". A flat with no parking is a real and important answer, and a default
    -- of 0 would erase the difference between that and silence.
    --
    -- No index on any of the three. None is a search facet: nothing in the listings sidebar filters on
    -- a bathroom or slot count, so an index would be write cost with no reader. V95's rule applies —
    -- a facet earns an index, a detail does not.
    -- ============================================================================================

    -- Full and half bathrooms together, as one count, because that is the only number an Indian
    -- listing quotes and the only one a reader compares. The wizard offers 1..4 with 4 displayed as
    -- "4+", so the stored value is a floor rather than an exact count at the top of the range; the
    -- CHECK stays open-ended anyway because an on-behalf admin post and a villa can both exceed it.
    -- 0 is permitted: a shop, a godown and a plot legitimately have none.
    bathrooms integer CHECK (bathrooms >= 0),

    -- Dedicated parking spaces that come with the unit. Not "is there parking in the society" —
    -- that is an amenity — but how many slots this listing conveys, which is what decides a
    -- two-car household. 0 means the owner said none, NULL means they were not asked or skipped.
    parking integer CHECK (parking >= 0),

    -- Balconies, for the same reason and with the same history: the floor-plan panel derived it from
    -- `bhk - 1` and printed it in a spec row. The wizard has collected it since it was written.
    balconies integer CHECK (balconies >= 0),

    archived            boolean NOT NULL DEFAULT false,  -- soft-delete
    archived_at         timestamptz,
    archive_reason      text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    -- A hand-back cannot be under way on a listing that does not exist yet. The acquisition funnel must
    -- have reached `listed` at minimum before there is anything to give back, so the two axes are not
    -- fully independent and the database says so rather than leaving it to the service layer.
    CONSTRAINT properties_handback_needs_listing
        CHECK (handback_milestone IS NULL OR pipeline_stage IN ('listed','docs_submitted'))
);

-- Indexes match the documented search filters + owner/admin queues (data-model.md Indexing).
CREATE INDEX idx_properties_owner        ON properties (owner_id);
CREATE INDEX idx_properties_locality     ON properties (locality);
CREATE INDEX idx_properties_society      ON properties (society_id);
CREATE INDEX idx_properties_pipeline     ON properties (pipeline_stage) WHERE posted_by_admin = true;
-- Hot public-search path: only approved, non-archived rows, filtered by the common facets.
CREATE INDEX idx_properties_search ON properties (deal, property_type, city, price, bhk)
    WHERE archived = false AND status = 'approved';

-- Mirrors idx_properties_pipeline: the board filters on this column for staff-posted rows
-- only, and every other row has it null.
CREATE INDEX idx_properties_handback ON properties (handback_milestone) WHERE posted_by_admin = true;

-- Serves "which listings are currently promoted" (ops/reporting and the mirror's own maintenance).
-- Partial, because the promoted set is a small fraction of the catalogue and the NULL majority is
-- never the answer to that question.
create index idx_properties_boosted_until
    on properties (boosted_until desc)
    where boosted_until is not null;

-- Partial index: the re-check queue read is "the rows with one", which on a healthy platform is a
-- small minority of the table. Indexing only those keeps it that size regardless of how big
-- `properties` gets, and costs nothing on the writes that leave the column null.
CREATE INDEX idx_properties_recheck_pending
    ON properties (recheck_requested_at)
 WHERE recheck_requested_at IS NOT NULL;

-- Locality-scoped: the address key alone is not selective enough ("a 101" repeats across Pune), and
-- every query that uses it pairs the two.
CREATE INDEX idx_properties_address_key ON properties (locality_slug, address_key)
    WHERE address_key IS NOT NULL;

-- Partial for the same reason V79's were: most listings carry no meter, the probe only ever looks
-- for a non-null value, and this indexes exactly the rows that can match.
--
-- The raw `electricity_meter_no` gets no index of its own. Both duplicate queries read the key, and
-- nothing else filters on a meter -- it is returned to its own owner and to nobody else. V115
-- dropped the index V79 had put on the raw column, on V113's reasoning: an unreferenced index on
-- `properties` is write-time cost on every insert and update, paid forever, for a plan no query can
-- ask for.
--
-- There is likewise no (society_id, floor, bhk) index. V79 created one for a society-branch
-- duplicate probe and V113 dropped it: that branch no longer exists, the live duplicate queries are
-- the electricity meter and (locality_slug, address_key), and neither references society_id/floor/bhk.
CREATE INDEX idx_properties_meter_key ON properties (electricity_meter_key)
    WHERE electricity_meter_key IS NOT NULL;

-- Ordering index. The public search always pins status and archived, so the score is only ever
-- sorted within that slice; a partial index over exactly that slice is both smaller and the one
-- the planner can actually use for the relevance order.
CREATE INDEX idx_properties_quality_score
    ON properties (quality_score DESC, created_at DESC)
    WHERE archived = false AND status = 'approved';

-- Only the two jsonb facets earn an index. They are the ones queried by containment rather than
-- equality, and a btree cannot serve jsonb @>. The other five are low-cardinality booleans and
-- small enums over a table the public search has already narrowed to approved-and-not-archived; a
-- btree on a column with five distinct values is one the planner will decline to use, so adding
-- them would cost write throughput and buy nothing.
CREATE INDEX idx_properties_tenants ON properties USING gin (tenants jsonb_path_ops);
CREATE INDEX idx_properties_sharing ON properties USING gin (sharing jsonb_path_ops);

-- The listings type chip is one of the two or three predicates on nearly every buyer search, and it
-- is always combined with deal + status, so the index leads with those to stay useful for the
-- unfiltered page too. Partial on the public-search floor: moderation queues do not use this facet.
CREATE INDEX idx_properties_type_key
    ON properties (deal, property_type_key)
    WHERE status = 'approved' AND archived = false;

-- Narrower than the type-key index on purpose: this column is only ever read together with a
-- commercial type key, and only on the live catalogue.
CREATE INDEX idx_properties_commercial_use ON properties (commercial_use_key)
  WHERE status = 'approved' AND archived = false AND commercial_use_key IS NOT NULL;

-- AUDIT (V98). Any row the property_type_key CASE could not classify — expected to be empty, and a
-- non-empty result is a label the taxonomy has not been taught rather than a fault in the query:
--   SELECT DISTINCT property_type FROM properties WHERE property_type_key IS NULL;
--
-- AUDIT (V99). Commercial listings whose label named no subtype we recognise. Expected to be empty; a
-- row here is a label the wizard can produce and the commercial_use_key CASE cannot classify, which
-- means the sub-filter silently hides it.
--
--   SELECT DISTINCT property_type
--     FROM properties
--    WHERE property_type_key = 'commercial'
--      AND commercial_use_key IS NULL;
--
-- AUDIT (V100). Shares whose property_type would otherwise have put them under a whole-unit chip.
-- Expect these to be exactly the rows the browser was already hiding from those chips.
--
-- SELECT share_type, property_type_key, count(*)
--   FROM properties
--  WHERE share_type IS NOT NULL
--  GROUP BY 1, 2
--  ORDER BY 1, 2;

COMMENT ON COLUMN properties.pipeline_stage IS
    'D27 acquisition funnel: contacted -> info_collected -> listed -> docs_submitted. Null when the listing was never ours to onboard.';
COMMENT ON COLUMN properties.handback_milestone IS
    'D27 hand-back axis: photos_uploaded -> aadhaar_verified -> claim_sent -> claimed. Null until the hand-back starts.';

comment on column properties.boosted_until is
    'Read-side mirror (D59) of the end of this listing''s newest active boost window. Written by '
    'BoostService in the same transaction as activation. NULL = never boosted; a past value = the '
    'window has closed. Ranking compares against now(), so stale values are harmless.';

COMMENT ON COLUMN properties.recheck_requested_at IS
    'Set when an owner edits a stays-live foundation field (price/furnishing/possession) on a '
    'listing that is publicly visible. The listing remains approved and searchable; this is the '
    'moderation work item, and its age is the SLA. Cleared when a moderator sets a status on the '
    'listing, and by revertToPending() — a full re-moderation supersedes a re-check (Q14).';

COMMENT ON COLUMN properties.recheck_reason IS
    'Human-readable list of the fields that raised the pending re-check, e.g. "price, furnishing". '
    'Accumulates across edits until a moderator clears it, so a moderator who arrives after three '
    'edits sees all three rather than only the last (Q14).';

COMMENT ON COLUMN properties.ownership_verified_at IS
    'When ops last accepted a complete evidence set for this listing (D190). The instant handed to '
    'VerificationAnnouncer, so the referral credit and the listing agree on when it happened.';

COMMENT ON COLUMN properties.ownership_verified_until IS
    'The earliest expiry among the documents the badge was granted on, or NULL when every one of '
    'them is a never-expiring registry or identity document. The badge is DERIVED from this rather '
    'than swept: a nightly job leaves a window in which a lapsed listing still shows verified, and '
    'a comparison against now() has no such window and nothing to backfill (D190).';

comment on column properties.last_confirmed_at is
    'When the owner last confirmed this listing is still available. Null = never confirmed; readers fall back to created_at.';

COMMENT ON COLUMN properties.quality_score IS
    'Listing completeness, 0-100, generated. Weights: photos 25, description 15, trust 20, '
    'completeness 25, amenities 15. Rent scores owner identity; buy scores ownership evidence. '
    'Retuning requires a migration - see V94 for why that is deliberate.';

COMMENT ON COLUMN properties.land_use     IS 'Permitted zoning for plots/farm land. NULL for buildings.';
COMMENT ON COLUMN properties.age_years    IS 'Construction age in years. NULL = unstated, 0 = new. No upper bound.';
COMMENT ON COLUMN properties.room         IS 'Flatmate room shape: single (private) or shared (per bed).';
COMMENT ON COLUMN properties.tenants      IS 'Accepted tenant types. Empty array = no stated preference = matches any filter.';
COMMENT ON COLUMN properties.available_from IS 'Move-in bucket: now | 15 | 30. Cumulative when filtered.';
COMMENT ON COLUMN properties.pets         IS 'Pets allowed. false also covers unstated.';
COMMENT ON COLUMN properties.sharing      IS 'PG occupancy options: single|double|triple|four|five. Empty = not a PG.';

COMMENT ON COLUMN properties.property_type_key IS
    'Canonical filter key derived from the free-text property_type: pg|commercial|flat|house|villa|farmland|plot, or NULL when the label is unrecognised. Generated — never written directly. Mirrors SEARCH_TYPES in frontend/src/data/propertyTypes.js.';

COMMENT ON COLUMN properties.commercial_use_key IS 'Canonical commercial subtype: office|coworking|shop|retail|warehouse|industrial, or NULL for a listing that is not commercial or whose label names no known subtype. Generated from property_type. Mirrors COMMERCIAL_SUBTYPES in frontend/src/data/propertyTypes.js.';

COMMENT ON COLUMN properties.share_type IS 'Canonical share kind: pg (offers occupancy options) | flatmates (states a room shape) | NULL (a whole unit). Derived from sharing and room. Mirrors the shareType the API returns and the shareType the listings chips match on; a listing with a share_type matches ONLY the PG or Flatmates chip, never Flat/House/Villa.';

COMMENT ON COLUMN properties.bathrooms IS 'Bathroom count. NULL = unstated, 0 = none. 4 is the wizard ceiling and reads as 4+.';
COMMENT ON COLUMN properties.parking   IS 'Dedicated parking slots conveyed with the unit. NULL = unstated, 0 = none. Distinct from the parking amenity tokens.';
COMMENT ON COLUMN properties.balconies IS 'Balcony count. NULL = unstated, 0 = none.';


-- reels: short video promos tied to a listing.
--
-- V38 — reels get a locality slug, so the feed filter joins the same locality vocabulary as
-- everything else.
--
-- Why. reels.locality is a display caption ("Koregaon Park") and the feed filtered on it
-- case-insensitively. Every other locality reference in the system keys on a slug
-- ("koregaon-park") and resolves the display name for rendering — Property carries both
-- `locality` and `locality_slug` for exactly this reason. Once the frontend runs against the API
-- it will send the slug it already holds, and a slug would never match the stored display label.
-- So reels adopt the same dual shape: the caption stays a display label (the clip must keep saying
-- what it said when it was filmed), and the slug column carries the filter key.
--
-- The original backfill mapped each existing reel to its slug by joining the curated `localities`
-- table on name rather than hardcoding a mapping — the localities table is the authority for that
-- pairing, so a reel captioned with a name that table knows got the right slug, and one that did
-- not was left NULL (honest: it simply will not appear in a slug-filtered feed) rather than guessed.
CREATE TABLE reels (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id    uuid REFERENCES properties(id),
    title         text,
    locality      text,
    locality_slug text,
    price         bigint,
    deal          text CHECK (deal IN ('buy','rent')),
    poster        text,
    video         text,
    likes         integer NOT NULL DEFAULT 0,
    views         integer NOT NULL DEFAULT 0,
    tag           text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reels_listing ON reels (listing_id);
CREATE INDEX idx_reels_locality_slug ON reels (locality_slug);


-- Perceptual photo hashes, so the image duplicate signal exists on the server.
--
-- Brokers re-list a flat by reusing the photos under a differently typed address, which is exactly
-- the case the meter (V115) and address arms miss. The client has hashed photos since the wizard was
-- written -- an 8x8 average hash, 64 bits, 16 hex chars -- but the hash never left the browser: it
-- was compared against `localStorage`, which in production holds only the listings that same browser
-- posted. The one set of photos it could ever match was the caller's own, which is the case the rule
-- explicitly refuses to flag. So the signal has never fired for anybody.
--
-- One row per (property, hash) rather than a JSON array on `properties`, because this table is
-- queried BY hash, and the array columns next to it (`images`, `amenities`) are only ever read back
-- whole. `on delete cascade`: a hash outliving its listing is a duplicate finding against a row no
-- moderator can open.
--
-- The hash is a bigint, not the 16-char hex string. Hamming distance is a popcount over an XOR, and
-- that is an integer operation; storing the text would mean parsing it back on every comparison.
-- Values above 2^63 land negative, which is fine -- two's complement XOR is bit-exact regardless of
-- how the sign is read.
--
-- The four band columns are the index strategy. Two hashes within Hamming distance d must share at
-- least one of four 16-bit bands when d <= 3 (pigeonhole: four bands, at most three differing bits,
-- so one band is untouched). The product's match threshold is 10, so band equality is a high-recall
-- pre-filter rather than a proof: everything it returns is Hamming-verified in Java, and a pair that
-- differs in all four bands is missed. That is a deliberate trade and it is only acceptable because
-- of what this signal does -- it FLAGS for the ops desk and never blocks an owner. Full recall at
-- d <= 10 is not indexable; it would mean reading every hash on the platform on every listing write.
--
-- Generated rather than written by the application so the bands cannot drift from the hash they
-- describe: there is one definition of "band 2 of this hash" and Postgres owns it. The mask discards
-- the sign extension an arithmetic right shift introduces, so the top band is the true top 16 bits.
CREATE TABLE property_photo_hashes (
    property_id uuid   NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
    hash        bigint NOT NULL,
    band0       int    GENERATED ALWAYS AS ((hash >> 48) & 65535) STORED,
    band1       int    GENERATED ALWAYS AS ((hash >> 32) & 65535) STORED,
    band2       int    GENERATED ALWAYS AS ((hash >> 16) & 65535) STORED,
    band3       int    GENERATED ALWAYS AS (hash & 65535) STORED,
    PRIMARY KEY (property_id, hash)
);

CREATE INDEX idx_pph_band0 ON property_photo_hashes (band0);
CREATE INDEX idx_pph_band1 ON property_photo_hashes (band1);
CREATE INDEX idx_pph_band2 ON property_photo_hashes (band2);
CREATE INDEX idx_pph_band3 ON property_photo_hashes (band3);


-- "Request more photos" becomes a real demand signal, because until V117 it was not one at all.
--
-- The feature has shipped since the prototype and has never once reached an owner. `photoRequests.js`
-- wrote the request to `localStorage` under `draazyPhotoReq:<ownerMobile>` -- the owner's key, in
-- the BUYER's browser. The owner reads that same key from their own browser, which holds only the
-- requests they themselves made against someone else. So the write and the read have always been in
-- different storage, on different devices, and the only way an owner ever saw a photo request was an
-- e2e test that seeded one into the owner's browser by hand. Every real buyer who tapped "More
-- photos" got a toast saying "the owner will see it"; no owner ever did. That is the bug this table
-- closes, and it is why this is a new domain rather than a port -- there is no behaviour to preserve.
--
-- Separate from `contact_requests` (V4) despite the obvious family resemblance. Three things differ
-- and each of them would have to become a nullable column or a status value if these shared a table:
-- the gate is lighter (sign-in only, no L2 badge -- a photo request exposes no owner PII, which is
-- the whole reason the contact gate is heavy); nothing is ever revealed, so there is no masked/raw
-- mobile duality and no approve/decline decision; and the owner's action is to go add photos, not to
-- answer the requester. A shared table would mean a `status` CHECK that accepts six values of which
-- each row may legally hold three -- the classic "two entities in a trench coat".
--
-- `resolved` rather than a delete: an owner who adds photos should stop being nagged without losing
-- the evidence that demand existed, which is the signal the whole feature is for. The row is the
-- record that N buyers wanted more of this listing, and that stays true after it is acted on.
--
-- An owner can also say no, and the column that records the answer is named to admit that it holds
-- an answer rather than an outcome.
--
-- V117 argued the opposite, in `PhotoRequestStatuses`' own docblock: "there is nothing here for an
-- owner to decline -- the request asks for photos, not for permission, and an owner who does not
-- want to add any simply does not." That reasoning is sound about *permission* and wrong about
-- *feedback*. Doing nothing is indistinguishable from not having looked, so the buyer waits on a
-- listing that is never going to gain a photo, and the owner keeps a badge they cannot clear
-- honestly -- their only exits were to add photos they do not have, or to mark satisfied a request
-- they did not satisfy. `declined` is the missing terminal state, and it is terminal on purpose: it
-- closes the loop for the buyer without pretending the photos arrived.
--
-- `decided_at`, not `resolved_at`, because the moment the owner acts is one instant regardless of
-- which way they went, and a column named for one of two outcomes would either need a sibling
-- (`declined_at`, forever mutually exclusive with it) or would quietly hold decline timestamps
-- under a name that says otherwise. The latter is what a smaller diff would have bought, and it is
-- exactly the "two entities in a trench coat" V117 declined to build one table over.
--
-- The status CHECK is named explicitly: V117 let Postgres mint `photo_requests_status_check`, and
-- the next migration to widen this set should not have to look up what it was called.
--
-- `ON DELETE CASCADE` on property_id but not on requester_id, and the asymmetry is intentional: a
-- photo request against a deleted listing is a nag pointing at a page that 404s, whereas users are
-- soft-deleted platform-wide and never actually leave the table.
CREATE TABLE photo_requests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    requester_id uuid NOT NULL REFERENCES users(id),
    status       text NOT NULL DEFAULT 'pending'
                   CONSTRAINT photo_requests_status_check
                   CHECK (status IN ('pending', 'resolved', 'declined')),
    decided_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The de-dupe, and the only thing that actually enforces it. The service reads before it inserts and
-- returns the existing row, but two genuinely concurrent taps can both miss that read -- this is what
-- makes "a buyer cannot ask twice" true rather than merely likely. Same shape and same reasoning as
-- `uq_contact_requests_requester_property` (V9).
--
-- Deliberately NOT scoped by status: a resolved request must still block a re-ask, otherwise every
-- owner who adds photos immediately becomes re-nagg-able by the same buyer, and the count stops
-- meaning "distinct people who wanted this" -- which is the only thing it is good for. A declined
-- request also blocks a re-ask -- which is the point: a buyer who has been told no should not be
-- able to ask again by tapping twice, and the row remains the record that one distinct person wanted
-- this. Scoping the index to `pending` would have turned "no" into a rate limit.
CREATE UNIQUE INDEX uq_photo_requests_requester_property
    ON photo_requests (requester_id, property_id);

-- The owner inbox reads by property (`WHERE property_id IN (<the owner's listings>)`), so this is the
-- index that read rides. The unique index above already covers requester-side lookups.
CREATE INDEX idx_photo_requests_property ON photo_requests (property_id);


-- "Not a duplicate" — the ops desk's verdict that a cluster the platform derived is a coincidence.
--
-- D255. The Duplicates tab has existed since the prototype and has never had a server behind it:
-- `lib/data/properties-admin.js` ran a union-find over `localStorage` and wrote its verdicts to
-- `duplicateFlag` / `duplicateOf`, two fields no table on this platform has ever had. Against the
-- live API the tab was gated off entirely and said so, which was honest but left a real ops job
-- undone. This is the state that job needs.
--
-- WHY A DISMISSAL TABLE AT ALL, when the cluster itself is derived on demand.
--
-- Because the derivation cannot be told not to fire. `ListingDuplicateProbe` compares an
-- electricity meter, an address key and perceptual photo hashes, and every one of those collides
-- honestly: a bungalow split into two tenancies shares a doorway, a society reuses flat numbers
-- across wings, and the builder's own lobby photograph appears on every flat in the tower. The
-- probe's javadoc is emphatic that a collision is a suspicion rather than a finding, and the whole
-- design keeps a human in the loop. A human in the loop who cannot record their answer is asked
-- the same question every time they load the page, which is how a queue teaches its operators to
-- stop reading it.
--
-- WHY IT IS KEYED ON A SIGNATURE AND NOT ON A CLUSTER ID.
--
-- Clusters are computed, not stored, so they have no identity of their own — the same physical
-- pair is a different object on every request. Their one stable property is the set of listings
-- they contain, so that set IS the key: sort the member ids, join them, hash them.
--
-- This makes the resurfacing rule fall out of the key rather than needing to be coded, and the rule
-- it produces is the one we want. Dismiss {A,B}; A and B stop appearing. A third listing C then
-- collides with them: the cluster is now {A,B,C}, a different signature, and it surfaces again --
-- correctly, because "A and B are not each other's duplicate" was never a statement about C.
-- Archive B and the pair stops being a cluster at all. Nothing has to expire a dismissal, and no
-- verdict is silently applied to a set the operator never actually looked at.
--
-- The cost, stated plainly: dismissals accumulate for member-sets that can no longer occur, and
-- nothing prunes them. They are small and never read except by exact signature match, so this is a
-- housekeeping job rather than a correctness one.
--
-- WHY THE SIGNATURE IS HASHED RATHER THAN STORED AS THE JOINED IDS.
--
-- V119 records this trap from the other end: a btree entry over 2704 bytes is rejected at INSERT
-- with an internal error rather than a constraint violation. A joined list of 36-char uuids passes
-- that ceiling at about 73 members, and 73 members in one cluster is not hypothetical -- it is one
-- over-eager `AddressKey` normalisation in a large society. A sha-256 hex digest is 64 characters
-- whatever the cluster size, so the ceiling stops existing. `member_ids` below keeps the readable
-- form for humans, without an index over it.
CREATE TABLE listing_duplicate_dismissals (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- sha-256 hex of the sorted, comma-joined member uuids. Produced by
    -- `DuplicateClusterSignature.of`, which is the only thing allowed to write this format --
    -- a second implementation of "sort and hash" is how two callers stop agreeing on what a
    -- cluster is, and the symptom would be dismissals that silently never match.
    --
    -- `varchar`, not `char(64)`, though the value is always exactly 64 characters. `char` is
    -- blank-padded in Postgres and compares with trailing spaces ignored, so a lookup would
    -- succeed against a value that is not byte-identical to the one written -- forgiving in a
    -- place that must not forgive, since the whole point of the column is that two clusters are
    -- the same only if their member sets are. It also reads back padded, which invites a `trim()`
    -- on the Java side that then hides the padding from anyone reading the code.
    cluster_signature varchar(64) NOT NULL,

    -- The readable form of the same fact, for the person debugging "why is this cluster back".
    -- Deliberately not indexed and never queried: `cluster_signature` is the key, and a second
    -- lookup path over the same data is a second thing to keep in step. `jsonb` rather than
    -- `uuid[]` only because every other list column on this platform is jsonb, and one array column
    -- would be the sole reason a reader has to know how Hibernate maps Postgres arrays.
    member_ids        jsonb       NOT NULL,

    -- Always from the JWT, never from a request body.
    dismissed_by      uuid        NOT NULL REFERENCES users (id),

    -- `created_at` rather than a `dismissed_at` of its own. The row is created by the act of
    -- dismissing and is never updated -- a repeat dismissal of the same set is the same verdict, so
    -- the service no-ops rather than touching it. A second timestamp column would therefore be a
    -- synonym that can only ever drift from `created_at`, and `BaseEntity` already populates this
    -- one on every write path. There is deliberately no `updated_at`, which is why this extends
    -- `BaseEntity` and not `AuditedEntity`.
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- Unique because a dismissal is a verdict on a set, not an event log: two operators dismissing the
-- same cluster is the same verdict reached twice, and the read is an existence check. The service
-- upserts on this, so a double-click costs nothing.
--
-- `audit_log` is where the "who dismissed what, when, and how often" question is answered; this
-- table only has to answer "is this set settled".
CREATE UNIQUE INDEX ux_listing_duplicate_dismissals_signature
    ON listing_duplicate_dismissals (cluster_signature);

SELECT install_updated_at_triggers();
