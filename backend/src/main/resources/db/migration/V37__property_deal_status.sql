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
--   1. TERMINAL STATUS. `properties.status` gains `sold` and `rented`. On deal close, the service
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
-- ============================================================================================

-- 1. Terminal moderation states.
ALTER TABLE properties DROP CONSTRAINT properties_status_check;
ALTER TABLE properties ADD CONSTRAINT properties_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'flagged', 'archived', 'sold', 'rented'));

-- 2. Public deal-status mirror. Defaults to 'active' — a listing with no deal row is on the market.
ALTER TABLE properties ADD COLUMN deal_status text NOT NULL DEFAULT 'active'
    CHECK (deal_status IN ('active', 'reserved', 'closed'));

-- Backfill the mirror from any deal row that already exists.
UPDATE properties p
    SET deal_status = d.status
    FROM deals d
    WHERE d.property_id = p.id;

-- Backfill the terminal moderation status for deals that are already closed. Only touch rows that
-- are currently `approved`: a closed deal on a pending/flagged/archived listing keeps its
-- moderation state, exactly as reopen would leave it.
UPDATE properties p
    SET status = CASE WHEN p.deal = 'rent' THEN 'rented' ELSE 'sold' END
    FROM deals d
    WHERE d.property_id = p.id
      AND d.status = 'closed'
      AND p.status = 'approved';
