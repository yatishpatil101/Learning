-- V33 managed_properties — the owner's private "single-player" property record (slice B).
--
-- WHAT THIS IS
-- ------------
-- A managed property is one an owner registers for their OWN benefit — valuation, a document
-- passport, rent tracking — BEFORE, or entirely WITHOUT, advertising it publicly. It is private by
-- default and never appears in buyer search. The front end has always kept these in a per-user
-- localStorage store (`puneNestManagedProps:<mobile>`); slice B gives that store a server so the
-- Owner Hub, Property Passport and rent tracker can run against real data.
--
-- WHY A SEPARATE TABLE, NOT A ROW IN `properties`
-- ----------------------------------------------
-- A marketplace listing (`properties`, V3) is a heavily-governed aggregate: it is moderated
-- (pending -> approved), it is searched, its foundation fields revert it to re-moderation when
-- edited, and it is soft-deleted so an approved row is never truly gone. A managed property is the
-- opposite on every axis — private by default, never moderated, never searched, freely edited, hard
-- deleted. Forcing it into `properties` would either loosen those invariants for everyone or need a
-- pile of "but not for managed rows" exceptions in the search/moderation paths. Keeping it in its
-- own table mirrors the front end's separate store and leaves the catalogue's invariants untouched.
--
-- "RECONCILE WITH LISTINGS" = LINK, NOT MERGE
-- -------------------------------------------
-- Publishing a managed property does not move it into `properties`; it CREATES a normal pending
-- listing (through the ordinary owner-create path, so every trust invariant still applies) and
-- records that listing's id here in `published_listing_id`. The private record and its public
-- listing then coexist, linked, exactly as the front end models it. Deleting the managed record
-- never touches the listing it spawned.
CREATE TABLE managed_properties (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id              uuid NOT NULL REFERENCES users(id),  -- the person who registered it
    -- Core property facts. `deal` follows the `properties` convention (buy|rent), NOT the front
    -- end's managed-only "sale" label, so publish is a straight pass-through; the seam translates.
    title                 text   NOT NULL,
    deal                  text   NOT NULL,                     -- buy|rent (validated in the service)
    property_type         text   NOT NULL,
    bhk                   numeric,
    price                 bigint NOT NULL,                     -- whole INR (contract Money)
    locality              text   NOT NULL,
    locality_slug         text,
    society               text,
    area                  numeric,
    area_unit             text   NOT NULL DEFAULT 'sqft',
    furnishing            text,
    -- Lifecycle. Server-controlled, never client-supplied: a managed row is born private/managed and
    -- only publish moves it to public/published.
    visibility            text   NOT NULL DEFAULT 'private',   -- private|public
    status                text   NOT NULL DEFAULT 'managed',   -- managed|published
    -- Owner-only rent tracker state (the Rent Panel), meaningful only to the owner.
    rented                boolean NOT NULL DEFAULT false,
    tenant_name           text,
    monthly_rent          bigint,
    due_day               integer,
    -- The Rent-o-meter valuation snapshot: an opaque owner-only blob, never shown to buyers.
    valuation             jsonb,
    -- The listing this record was published into, if any. Nullable: an unpublished record has none.
    published_listing_id  uuid REFERENCES properties(id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- The only read is "this owner's records, newest first"; there is no cross-user query, by design.
CREATE INDEX idx_managed_properties_owner_created ON managed_properties (owner_id, created_at DESC);

COMMENT ON TABLE managed_properties IS
    'An owner''s private property record (valuation, document passport, rent tracking) kept apart '
    'from the moderated `properties` catalogue. Private by default; publishing spawns a normal '
    'pending listing and links to it via published_listing_id rather than merging into it.';

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has
-- an updated_at column.
SELECT install_updated_at_triggers();
