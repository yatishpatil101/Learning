-- V06 DDL Deals & Offers: the transaction core, plus the listing verification case file.
--
-- Scope: `offers` + `offer_history` (the price negotiation and its trail), `deals` +
-- `deal_parties` (the single per-listing deal aggregate and the off-platform people attached to
-- it), `finalization_requests` (the two-sided close), and the verification cluster
-- `property_reviews` + `property_review_checklist` + `review_messages` (the ops case file on a
-- listing and the owner<->ops thread inside it).
--
-- Folded from the old chain: V5 (all eight tables in their original shape), V11 (deal_parties,
-- deals.counterparty_mobile + note, and the live-row unique indexes -- the `visits` one from the
-- same change lives with `visits`), V19 (review_messages.read_at), V34 (offers.move_in), V48
-- (the deal-cluster composite paging indexes -- again, the two `visits` ones live with `visits`),
-- V80 (review_messages.internal), V81 + V82 (property_reviews.last_message_at and the ordering
-- index over it; V82 supersedes V81, so only the final state appears here).
--
-- `properties` (V04) and `users` (V02) must exist first; every table here keys off one or both.
-- `properties.deal_status` is a read-side mirror of `deals.status` and is owned by V04 -- there is
-- deliberately no foreign key in either direction, because `deals` already depends on the
-- catalogue and a catalogue read of the deals table would invert that.
--
-- Within this file: `deals` MUST be created before `deal_parties`, and `property_reviews` before
-- `property_review_checklist` and `review_messages`.

-- V5 Deals, Offers, Finalization & Property Verification (Phase 4). The transaction core.
-- Schemas: Offer(Create/Response), Deal(CloseRequest), FinalizationRequest(Create/Accept),
--          PropertyReview. All maker-checker; side-effects applied transactionally in services.

-- offers: buyer proposes; owner accepts/counters/declines. Negotiation trail -> offer_history.
CREATE TABLE offers (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id),
    from_user_id uuid NOT NULL REFERENCES users(id),   -- Party.from
    amount       bigint NOT NULL,
    status       text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','countered','accepted','declined','withdrawn')),
    message      text,
    -- `offers.move_in`: the buyer's preferred possession date on an offer (tech-debt D112, closed).
    --
    -- WHAT IT MEANS
    -- -------------
    -- The offer modal has always asked for a date — "Preferred move-in" on a rental, "Target possession"
    -- on a purchase — but `OfferCreate` carried only `propertyId`, `amount` and `message`, so the date
    -- had nowhere structured to go. The http provider folded it into the `message` prose to keep it from
    -- being dropped outright, which meant a date the buyer picked could not be filtered, sorted, or shown
    -- as its own field: the owner read it in a sentence or not at all.
    --
    -- This column gives it a home. It mirrors `tenant_profiles.move_in` — a plain nullable `date`,
    -- whole-day granularity, no time zone: a possession date is a calendar day, not an instant.
    --
    -- NULLABLE ON PURPOSE
    -- -------------------
    -- The date is optional on the wire and optional here. A buyer may open a negotiation on price alone
    -- and settle possession later, so an offer with no `move_in` is a valid offer, not an incomplete one.
    move_in      date,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_offers_property ON offers (property_id);
CREATE INDEX idx_offers_from     ON offers (from_user_id);

CREATE TABLE offer_history (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id uuid NOT NULL REFERENCES offers(id),
    amount   bigint NOT NULL,
    by       text NOT NULL CHECK (by IN ('buyer','owner')),  -- counter direction
    at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_offer_history_offer ON offer_history (offer_id, at);

-- deals: single aggregate (reconciliation #4). status {active,reserved,closed}; the analytics
-- closed/in_progress+value view is derived, not a second table. counterparty is one Party -> FK.
CREATE TABLE deals (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id    uuid NOT NULL REFERENCES properties(id),
    deal           text NOT NULL CHECK (deal IN ('buy','rent')),
    -- Closing with an off-platform buyer.
    --
    -- DealCloseRequest is { agreedPrice, counterpartyMobile, note? } but deals originally had only
    -- counterparty_id, a users FK. For a Pune owner the buyer is very often found off-platform --
    -- a broker's client, a neighbour's cousin -- and has no account. As it stood, closing such a
    -- deal was impossible, which would have made the single most important endpoint in this slice
    -- unusable for the majority case.
    --
    -- So the mobile is stored as given, and counterparty_id is populated only when that mobile
    -- resolves to a registered user. counterparty_id was already nullable; it now means "the
    -- counterparty is on the platform" rather than "unknown".
    --
    -- Note that finalization_requests.counterparty_id stays NOT NULL and is *not* given the same
    -- treatment. That is the opposite case on purpose: finalization is a two-sided maker/checker
    -- flow where the counterparty has to sign in and accept, so an off-platform counterparty is
    -- genuinely invalid there and should be a 422.
    counterparty_id uuid REFERENCES users(id),
    counterparty_mobile text,
    note           text,
    agreed_price   bigint,
    status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reserved','closed')),
    closed_at      timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deals_property ON deals (property_id);
CREATE INDEX idx_deals_status   ON deals (status);

-- One deal row per property. The whole aggregate assumes "the deal on this listing" is singular --
-- getDeal returns one Deal, reserve/close/reopen all address it positionally by {propId}. Without
-- this, a race in the lazy create-on-first-write would silently fork a listing into two deals.
CREATE UNIQUE INDEX uq_deals_property ON deals (property_id);

-- ---------------------------------------------------------------------------------------
-- deal_parties
--
-- V5 deferred this with "no multi-party deal in the contract -- add a V* migration if needed".
-- It is needed: the contract ships listParties / addParty / removeParty and the UI (the
-- "Under offer" panel) writes to it. It is deliberately NOT a users FK. An under-offer party
-- is an off-platform person the owner jotted down while showing the flat -- a name, a raw
-- mobile and a private note, with no account to reference. That is a different thing from
-- deals.counterparty_id, which is the party the deal actually closes with.
--
-- It is also deliberately not a jsonb column on deals: DELETE .../parties/{partyId} needs a
-- stable per-row identity (jsonb gives none), and the previous positional {idx} was racy.
CREATE TABLE deal_parties (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id    uuid NOT NULL REFERENCES deals(id),
    name       text NOT NULL,
    mobile     text,
    note       text,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Partial index: the list read only ever wants the live rows, and soft-deleted parties are
-- dead weight in it.
CREATE INDEX idx_deal_parties_deal ON deal_parties (deal_id, created_at)
    WHERE deleted_at IS NULL;

-- finalization_requests: buyer requests finalize -> owner accepts (closes deal, auto-declines
-- the property's other pending requests -- enforced in the service, transactionally).
CREATE TABLE finalization_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id     uuid NOT NULL REFERENCES properties(id),
    initiator_id    uuid NOT NULL REFERENCES users(id),
    counterparty_id uuid NOT NULL REFERENCES users(id),
    agreed_price    bigint NOT NULL,
    status          text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','cancelled')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_finalization_property ON finalization_requests (property_id);

-- ---------------------------------------------------------------------------------------
-- One live row per (user, property) for offers and finalization requests
--
-- The V9 lesson, applied ahead of the bug rather than after it: a check-then-insert in the
-- service is not a uniqueness guarantee, because two concurrent double-taps interleave
-- between the check and the insert. Duplicate rows here are not cosmetic -- they double the
-- owner's pending counts, and they make "the buyer's live offer on this listing" a query that
-- can return two answers.
--
-- Partial unique indexes rather than plain UNIQUE constraints, because the restriction is only
-- on *live* rows. A buyer whose offer was declined must be able to offer again, and someone
-- who cancelled a visit must be able to rebook -- so the terminal states are excluded and any
-- number of historical rows may accumulate. (The matching `visits` index, from the same change,
-- lives with `visits`.)
CREATE UNIQUE INDEX uq_offers_live_per_user_property
    ON offers (from_user_id, property_id)
    WHERE status IN ('pending', 'countered');

CREATE UNIQUE INDEX uq_finalization_live_per_user_property
    ON finalization_requests (initiator_id, property_id)
    WHERE status = 'pending';

-- ---------------------------------------------------------------------------------------
-- Composite indexes for the deal-cluster reads that D77 paged.
--
-- WHY AN INDEX SHIPS WITH THE PAGING CHANGE, NOT AFTER IT
-- -------------------------------------------------------
-- api-standards.md §5: "every sort/filter field must be backed by a DB index; don't expose a filter
-- the schema can't serve efficiently." Paging without the index is not a half-measure, it is a
-- regression: the unpaged read did one scan and returned everything, while a paged read over the
-- same single-column index does the scan, sorts the whole matched set, and then throws all but
-- twenty rows away -- plus a second pass for the `count(*)` the envelope carries. The owner with
-- four hundred offers pays more per request than they did before, for less data.
--
-- WHAT THEY DO
-- ------------
-- Each of these predicates is `<scope column> = ? / in (?)` followed by `order by created_at desc
-- limit ?`. A composite `(scope, created_at desc)` serves both halves: Postgres walks the index
-- from the newest entry for that scope and stops after `size` rows, so page one costs the same
-- whether the owner has twenty offers or twenty thousand. The single-column originals stay --
-- `idx_offers_property` also backs the closed-deal probe and the uniqueness checks, and dropping a
-- prefix index in the same change that adds its superset is how a plan regresses on the one query
-- nobody re-measured.
--
-- `created_at desc` is written into the index rather than left to a backwards scan. Postgres can
-- read a btree in either direction, so `(scope, created_at)` would serve this too -- but only while
-- the sort stays single-column. Spelling the direction out means the index and the `order by` in
-- the repository are literally the same text, which is the property that survives someone adding a
-- tie-breaker column later.
--
-- THE ONE THAT WAS NOT AN OPTIMISATION
-- ------------------------------------
-- `finalization_requests` had `idx_finalization_property` and nothing else. `findPendingByCounterparty`
-- -- the query behind every owner's "waiting on you" finalization panel -- filters on
-- `counterparty_id`, which was not indexed at all, so it had been sequentially scanning the table
-- since V5. Paging made that visible (the count query scans it a second time) but did not cause it;
-- this index is a bug fix that happens to arrive with a performance change.
--
-- `deals` needs no counterpart: `uq_deals_property` makes it one row per property, so
-- `property_id in (...)` already returns at most one row per listing the owner holds. The composite
-- below still earns its place because that set is the owner's whole portfolio and the sort would
-- otherwise be a fresh quicksort of it on every dashboard load.
--
-- (The two `visits` composites from the same change live with `visits`.)

CREATE INDEX idx_offers_property_created ON offers (property_id, created_at DESC);
CREATE INDEX idx_offers_from_created     ON offers (from_user_id, created_at DESC);

CREATE INDEX idx_deals_property_created  ON deals (property_id, created_at DESC);

-- Partial: `findPendingByCounterparty` only ever reads pending rows, and accepted/declined/cancelled
-- rows accumulate forever without ever being selected. Indexing them would grow the structure with
-- exactly the rows the query excludes.
CREATE INDEX idx_finalization_counterparty_created
    ON finalization_requests (counterparty_id, created_at DESC)
    WHERE status = 'pending';

-- property_reviews: verification record, 1:1 with a property (schema: PropertyReview).
CREATE TABLE property_reviews (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL UNIQUE REFERENCES properties(id),
    status      text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','flagged','archived')),
    reviewer    text,
    notes       text,
    decided_at  timestamptz,
    -- last_message_at: make the ops queue resurface a case when anything is said in it (D218).
    --
    -- property_reviews.updated_at is maintained by @UpdateTimestamp and by set_updated_at, and both
    -- only fire when a row in *this* table is updated. review_messages.review_id is the owning side of
    -- the association, so posting a message inserts a child row and leaves the parent untouched: the
    -- queue, which sorted by updated_at desc, did not move the case. An owner replying to a moderator,
    -- and a duplicate flag landing on a case file that already existed, both sank to wherever the case
    -- happened to sit -- which for an old case is the bottom.
    --
    -- last_message_at is the fix and is also the honest column to sort a conversation queue on. Writing
    -- it dirties the parent, so updated_at tracks message activity as a side effect; but the
    -- desk should read this one, because updated_at also moves for a checklist tick.
    --
    -- NOT NULL, AND WHY IT IS NOT NULLABLE
    -- ------------------------------------
    -- V81 shipped this column nullable, indexed partially on `last_message_at is not null`, with both
    -- queue queries sorting on `coalesce(last_message_at, updated_at)`. Three things were wrong with
    -- that shape:
    --
    -- 1. Postgres matches ORDER BY to an index by expression identity. The index key was
    --    `last_message_at`; the sort key was `coalesce(last_message_at, updated_at)`. Different
    --    expressions, so no index scan -- and the index being partial on a predicate neither query
    --    carries meant it was not even eligible. Both desks seq-scanned and top-N sorted every page,
    --    and the index earned nothing but write cost.
    -- 2. The coalesce made the sort key mean two different things depending on the row: "when someone
    --    last spoke" for a case with messages, "when the row was last touched by anything at all" for
    --    one without. A queue whose ordering rule changes per row is a queue nobody can reason about.
    -- 3. No unique tiebreak. Ties are not exotic here -- V81's own backfill gave many rows the same
    --    value, and so does a batch of notes written in one transaction. Postgres is free to order ties
    --    differently per execution, so paging the ops queue could show one case twice and skip another.
    --
    -- The fix is that the column is total: every case has a last-activity instant, a case with no
    -- messages uses the moment it was opened, and the queries sort on the bare column plus id. One
    -- meaning, one expression, one index that serves it.
    --
    -- A case nobody has spoken in takes its created_at: opened is the last thing that happened to it,
    -- which is exactly what the desk should sort it by. created_at rather than updated_at because a
    -- decision or a checklist tick is not conversation, and letting those set the initial value would
    -- put a case that has been worked but never replied to above one that is genuinely waiting.
    --
    -- A note on V81, because the mistake is a general one and this is where it is written down: its
    -- backfill UPDATE fired trg_set_updated_at (installed on every table carrying updated_at, see the
    -- `install_updated_at_triggers()` call at the foot of this file), so it collapsed updated_at to the
    -- migration timestamp on every case file that had ever had a message. Nothing sorts on that column
    -- any more, but it is still rendered to moderators, and the value is not recoverable. Any backfill
    -- of a table with that trigger has to disable it for the duration.
    last_message_at timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Matches `order by last_message_at desc, id desc` term for term, which is what makes it usable as
-- an ordering index rather than decoration.
CREATE INDEX idx_property_reviews_activity
    ON property_reviews (last_message_at DESC, id DESC);

-- Per-document verification checklist (PropertyReview.checklist[]).
CREATE TABLE property_review_checklist (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id uuid NOT NULL REFERENCES property_reviews(id),
    item      text NOT NULL,
    pass      boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_review_checklist_review ON property_review_checklist (review_id);

-- owner<->admin clarification thread on a verification review.
CREATE TABLE review_messages (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id  uuid NOT NULL REFERENCES property_reviews(id),
    sender_id  uuid REFERENCES users(id),
    body       text NOT NULL,
    -- The owner<->ops clarification thread needs somewhere to record "seen".
    --
    -- `POST /properties/{id}/verification/read` has been in the contract since the first draft and had
    -- nothing to write to: `review_messages` carried id, review_id, sender_id, body, created_at and
    -- no read state whatsoever. The endpoint could only ever have been a 204 that did nothing, which is
    -- worse than a missing endpoint because the UI would show an unread badge that never cleared.
    --
    -- Per-message rather than a per-thread high-water mark: the frontend mock
    -- (lib/data/properties-admin.js#markReviewRead) tracks `read` on each message, and the admin queue
    -- counts unread messages rather than testing a timestamp. A high-water mark would be smaller but
    -- could not answer "which messages are new", which is the only question the UI asks.
    --
    -- Nullable, not `NOT NULL DEFAULT false`: null means "not yet read" and carries no false precision,
    -- and when it is set it records *when*, which a boolean throws away.
    read_at    timestamptz,
    -- internal: staff-only notes in the owner<->ops verification thread (D218).
    --
    -- WHY THIS EXISTS. V79 gave the platform a duplicate-listing probe, and the finding has to go
    -- somewhere a moderator will actually read: the case file. But `review_messages` had exactly two
    -- readers -- the owner and ops -- and no way to address one without the other. Posting the finding
    -- into that thread would have handed the submitter the answer to the question the probe asks.
    --
    -- Concretely, and this is a real attack rather than a tidiness argument: submit a throwaway listing
    -- carrying a guessed electricity meter number, then read your own verification thread. A note back
    -- means the meter is already on the platform; silence means it is not. The note names the other
    -- listing, so the probe also confirms the existence of PENDING listings, which no public route will
    -- admit to. That is an oracle for `properties.electricity_meter_no` -- the column V79 deliberately
    -- withholds from the public response -- reachable by any account that can post a listing.
    --
    -- WHY A COLUMN AND NOT A SEPARATE TABLE. An internal note is the same shape as every other message
    -- (author, body, timestamp, ordering) and belongs in the same chronology; a moderator needs to read
    -- "flagged as a possible duplicate" in sequence with the owner's reply to it. A parallel table would
    -- have to be merged back into one ordered list at read time by every caller, and the first caller to
    -- forget is a moderator deciding on half the record.
    --
    -- DEFAULT FALSE IS THE SAFE DIRECTION. A message is written to be read by the owner unless it says
    -- otherwise. The flag is set only where the code explicitly asks for a staff-only note, so a
    -- future message that forgets the flag is over-shared to the owner rather than silently hidden from
    -- them -- an embarrassment rather than a moderator deciding on evidence they never saw.
    --
    -- NOT NULL is what makes the read filter total: a three-valued `internal` would leave
    -- `internal = false` quietly dropping the NULL rows out of the owner's thread.
    --
    -- No index on it. The filter is always applied to the handful of messages of one already-loaded
    -- case file, never as a standalone predicate across the table, so an index here would be write cost
    -- with no reader.
    internal   boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_review_messages_review ON review_messages (review_id, created_at);

-- Reading the thread is the common query and it is always scoped to one review, ordered oldest-first
-- (a conversation reads forwards). Without this the thread page is a scan of every message on the
-- platform filtered down to one review.
CREATE INDEX idx_review_messages_review_at ON review_messages (review_id, created_at);

-- The unread count the ops queue renders. Partial, because a read message can never contribute to it
-- and there is no reason to carry the whole history in the index.
CREATE INDEX idx_review_messages_unread ON review_messages (review_id) WHERE read_at IS NULL;

COMMENT ON COLUMN review_messages.read_at IS
  'When the *other* participant read this message; null = unread. Set by POST /properties/{id}/verification/read.';

COMMENT ON COLUMN review_messages.internal IS
    'True for staff-only notes, hidden from the listing owner. See V80.';

SELECT install_updated_at_triggers();
