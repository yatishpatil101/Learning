-- V24 Admin and analytics (slice 14).
--
-- Only one new table. The rest of the slice reads what is already there: the CMS lists came in with
-- V8, `settings` with V2, and every KPI is a count over a table that has existed for ten slices.
-- The B2B pipeline is the one thing the platform captures but has never stored.

-- ---------------------------------------------------------------------------
-- Society / builder leads
-- ---------------------------------------------------------------------------
-- A society secretary or a builder asks to put a whole building on the platform. That is not a
-- property enquiry and it does not belong in `contact_requests`: there is no listing, no owner and
-- no seeker, and the row's whole life is a sales pipeline rather than a contact unlock.
--
-- Submission is public and unauthenticated (contract: `security: []`) because the person filling it
-- in is not a user yet and demanding a login first is how B2B lead forms lose their leads. That
-- makes the table a spam target, so the write path rate-limits per mobile against this table --
-- see SocietyLeadService. No IP column: the app sits behind proxies whose header policy is not
-- settled, and a wrong client IP recorded as fact is worse than none (see D55 on referrals).
CREATE TABLE society_leads (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    society_name  text        NOT NULL,
    contact_name  text        NOT NULL,
    -- Not unique, and deliberately so: one builder legitimately enquires about several societies,
    -- and a unique index here would silently drop the second building. Duplicate suppression is a
    -- rate limit, which is reversible, not a constraint, which is not.
    mobile        text        NOT NULL,
    units         integer,
    interest      text,
    status        text        NOT NULL DEFAULT 'new',
    -- Ops working notes. The contract does not return this yet; it is written by the status update
    -- so the note attached to a decision is not lost the moment the audit row scrolls away.
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT society_leads_status_check
        CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost')),
    CONSTRAINT society_leads_interest_check
        CHECK (interest IS NULL OR interest IN ('bulk-listing', 'society-services', 'partnership')),
    -- A society with zero or negative units is a typo, and `units` drives the whole prioritisation
    -- of this pipeline. 20000 is roughly four times India's largest housing society.
    CONSTRAINT society_leads_units_check
        CHECK (units IS NULL OR (units > 0 AND units <= 20000))
);

-- `GET /society-leads` is "the pipeline, newest first", optionally one status column at a time.
-- The status-first ordering serves both the filtered and the unfiltered query because Postgres can
-- read a full index scan in `created_at DESC` order within each status group, and the unfiltered
-- list is small enough for the sort that remains.
CREATE INDEX idx_society_leads_status_created ON society_leads (status, created_at DESC);
CREATE INDEX idx_society_leads_created ON society_leads (created_at DESC);

-- Backs the per-mobile rate limit on the public submit path. Without it every public POST would
-- sequentially scan a table an attacker controls the size of.
CREATE INDEX idx_society_leads_mobile_created ON society_leads (mobile, created_at DESC);

COMMENT ON TABLE society_leads IS
    'B2B pipeline: society secretaries and builders asking to bring a whole building onto the '
    'platform. Submitted publicly, read only by staff and admin.';

-- Wire trg_set_updated_at onto the new table (V1 convention: every migration ends with this).
SELECT install_updated_at_triggers();
