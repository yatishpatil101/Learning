-- V93 the managed-property document vault, and a guard on the listing bridge (D32).
--
-- TWO CHANGES, ONE DECISION EACH
-- ------------------------------
-- Both come out of D32 -- moving managed properties off localStorage and onto this server. They
-- ship together because they are the two things the port cannot do without, and neither is worth a
-- migration of its own.
--
--
-- 1. A PARTIAL UNIQUE INDEX ON THE LISTING BRIDGE
-- -----------------------------------------------
-- `ensureManagedForListing` gives every listing you own a companion managed record, so the Owner
-- Hub tools (passport, vault, rent tracking) have something to hang off. In the browser that was
-- safe by accident: the dedup was a scan of a local array, and there was only ever one array.
--
-- Over HTTP the same dedup is a read followed by a write, and two tabs -- or one tab and a slow
-- retry -- can both read "no bridge row" before either writes. V33 gave `published_listing_id` no
-- constraint at all, so the second write would have succeeded and the owner would quietly own two
-- managed records for one flat: two passports, two vaults, two rent schedules, and no way to tell
-- which is the real one.
--
-- The index makes the loser of that race fail loudly instead. It is PARTIAL because the column is
-- null for every unpublished record -- the common case, and the one where duplicates are meaningful
-- (you may well own two flats in the same society that you have not listed). Only the *bridge* is
-- unique, and only once a bridge exists.
--
-- The client still dedups against the list it already loads; this is the backstop for the race that
-- dedup cannot see, not a replacement for it.
CREATE UNIQUE INDEX idx_managed_properties_published_listing
    ON managed_properties (published_listing_id)
    WHERE published_listing_id IS NOT NULL;

COMMENT ON INDEX idx_managed_properties_published_listing IS
    'One managed record per published listing. Partial: unpublished records have a null bridge and '
    'an owner may legitimately hold many. Backstop for the read-then-write race in the client-side '
    'bridge dedup (D32).';


-- 2. A THIRD DOCUMENT TABLE, FOR THE SAME REASON V32 CREATED THE SECOND
-- ---------------------------------------------------------------------
-- The Property Passport shows a DocVault keyed on the *managed* record's id, and it is the one part
-- of the document flip that never shipped. The reason is on the record at
-- docs/system/frontend-data-seam.md: DocVault and PropertyPassport stayed on `lib/` because
-- "passport ids are mock-only". D32 makes those ids real, which retires the excuse and leaves the
-- question the excuse was standing in for: where does a document about a flat you own but have not
-- listed actually live?
--
-- Not in `documents`. V6 left `documents.property_id` nullable for exactly this kind of idea and
-- V20 tightened it to NOT NULL, reasoning that a row with no property is unreachable -- a leak of
-- storage, not a feature. V32 met that same question for KYC papers and answered it by adding a
-- table rather than reversing V20, precisely so the property vault's sharing and grant logic can go
-- on assuming every row it holds has a listing. That answer has not aged; this is the third sibling
-- under the same rule.
--
-- WHY NOT JUST WAIT FOR THE LISTING
-- ---------------------------------
-- A managed record is what an owner keeps *before* they are ready to advertise -- often long before.
-- The sale deed, the index-II, the society NOC are the papers you gather while deciding, and
-- gathering them is most of what the Passport is for. Telling the owner "publish first, then you may
-- upload" inverts the workflow the feature exists to serve. And when they do publish, the property
-- vault at /me/documents/{propId} is a different bucket with a different audience: those files are
-- shareable with buyers through the request/grant flow. These are not.
--
-- SHAPE MIRRORS personal_documents, WHICH MIRRORS documents
-- ---------------------------------------------------------
-- Same storage model: bytes in the object store under a server-minted `storage_key`, URL signed and
-- short-lived at read time, so no `url` column (a persisted URL is a permanent bearer credential to
-- someone's title deed). No `service_request_id` and no share token: a managed-record document is
-- never handed to a buyer or a lawyer through this table -- if the owner wants that, they publish,
-- and upload to the listing's vault. `uploaded_at` is a distinct column from `created_at`,
-- following the `documents` convention.
--
-- ON DELETE CASCADE, unlike its two siblings, which reference `users` and `properties` -- rows that
-- are archived rather than deleted. A managed record has a real DELETE endpoint (V33, slice 9), and
-- an owner who removes a flat from their hub means it; leaving its papers behind as unreachable
-- rows would recreate the exact "leak of storage" V20 objected to.
CREATE TABLE managed_property_documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    managed_property_id uuid NOT NULL REFERENCES managed_properties(id) ON DELETE CASCADE,
    category            text,                         -- "Sale Deed", "Index II", ... (UI's vocabulary)
    file_name           text,                         -- uploader's filename, sanitised; never the key
    storage_key         text NOT NULL,                -- object-store key; signed URL derived at read time
    size_bytes          bigint,
    mime_type           text,                         -- the type the bytes prove, not the one declared
    uploaded_at         timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- The only read is "this record's papers, newest first". Ownership is resolved through
-- managed_properties.owner_id before this table is touched at all, so there is no owner column here
-- to index -- and no query that would use one.
CREATE INDEX idx_managed_property_documents_prop_uploaded
    ON managed_property_documents (managed_property_id, uploaded_at DESC);

COMMENT ON TABLE managed_property_documents IS
    'Papers attached to a property an owner tracks privately in the Owner Hub, which may never have '
    'been listed. Kept apart from `documents` so the property vault''s sharing and request logic can '
    'assume every row it holds belongs to a listing (V20, V32). Never shared with a buyer.';

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has
-- an updated_at column.
SELECT install_updated_at_triggers();
