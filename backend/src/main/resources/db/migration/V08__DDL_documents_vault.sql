-- V08 DDL Documents Vault: the paperwork tables — what a listing's file cabinet holds, who may
-- open it, and what ops accepted as proof of ownership.
--
-- Scope: `documents` (the per-property vault), `document_requests` (a buyer's ask and the owner's
-- time-boxed grant), `ownership_basis` (what the owner paid and still owes on the flat),
-- `owner_kyc` (the owner's masked identity record), `personal_documents` (the person's own KYC
-- papers, kept apart from any listing) and `property_ownership_evidence` (the case file behind the
-- Ownership Verified badge).
--
-- Folded from the old chain: V6 (documents, document_requests, ownership_basis, owner_kyc only),
-- V7 (documents.service_request_id only), V20 (the documents/document_requests half only), V32,
-- V49 (idx_document_requests_property_created only), V63 (property_ownership_evidence only -- the
-- two `properties.ownership_verified_*` columns live in the catalog-listings file), V66, V74.
--
-- `documents` MUST be created before `property_ownership_evidence`, which carries a foreign key to
-- it. `documents.service_request_id` references `service_requests`, created in the file before this
-- one.

-- documents: property-scoped files, served via short-lived signed URLs (url minted at read time).
--
-- Every document in the contract is reached through /me/documents/{propId}, so a row with no
-- property is unreachable by any endpoint -- a leak of storage, not a feature. V6 left the column
-- nullable for a "personal vault" idea that never entered the contract; V20 closed it and
-- property_id is NOT NULL here. The personal vault returned as its own table, `personal_documents`
-- below, keyed on the user instead.
--
-- ServiceRequest.documents[] : a document may belong to a service request instead of a property.
CREATE TABLE documents (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id        uuid NOT NULL REFERENCES properties(id),
    category           text,
    file_name          text,
    storage_key        text,                    -- object-store key; signed URL derived at read time
    size_bytes         bigint,
    mime_type          text,
    service_request_id uuid REFERENCES service_requests(id),
    uploaded_at        timestamptz NOT NULL DEFAULT now(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The vault list is "this property's documents, newest first" and nothing else. V6 shipped a
-- single-column `idx_documents_property`, which V20 dropped once this composite superseded it; the
-- composite is the only index on property_id.
CREATE INDEX idx_documents_property_uploaded ON documents (property_id, uploaded_at DESC);

CREATE INDEX idx_documents_service_request ON documents (service_request_id) WHERE service_request_id IS NOT NULL;

-- document_requests: buyer requests categories -> owner grants (share_token, time-boxed).
--
-- V20 made the V6 paperwork tables serviceable: the buyer's request carries a note, a grant carries
-- an expiry, and the share token is a real lookup key rather than an unindexed text column.
--
-- `message` is the buyer's covering note ("I have a home loan sanctioned, may I see the title
-- chain?"). DocumentRequestCreate.message had nowhere to land.
--
-- `expires_at`: a grant is time-boxed. Without it the share token is a permanent bearer credential
-- to someone's title deeds, and the 'expired' status in the CHECK could never be reached.
CREATE TABLE document_requests (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id            uuid NOT NULL REFERENCES properties(id),
    requester_id           uuid NOT NULL REFERENCES users(id),
    categories             jsonb NOT NULL DEFAULT '[]'::jsonb,
    status                 text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','granted','declined','expired')),
    share_token            text,
    message                text,
    expires_at             timestamptz,
    acknowledged_disclaimer boolean NOT NULL DEFAULT false,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_document_requests_property  ON document_requests (property_id);
CREATE INDEX idx_document_requests_requester ON document_requests (requester_id);

-- share_token is the lookup key for GET /documents/shared. UNIQUE both indexes the lookup and
-- makes a token collision a failed insert rather than a silent cross-account document leak.
CREATE UNIQUE INDEX uq_document_requests_share_token
    ON document_requests (share_token) WHERE share_token IS NOT NULL;

-- One open ask per buyer per property: the owner's inbox groups by buyer|property (one
-- due-diligence request = one lead), so a double-tap must not become two rows. Partial rather than
-- total on purpose -- once a request is answered, a later ask for different categories is a new
-- and legitimate request, and a total UNIQUE would make "no" permanent.
CREATE UNIQUE INDEX uq_document_requests_pending
    ON document_requests (requester_id, property_id) WHERE status = 'pending';

-- V49 composite index for the document-request inbox (`GET /me/documents/requests`), one of the
-- two remaining inboxes D77 paged.
--
-- Same reasoning as V48, which shipped the deal cluster's indexes alongside its paging change:
-- api-standards.md §5 requires every read the API sorts on to be index-served, and paging a read
-- whose sort is not indexed makes it *slower*, not faster -- the scan still happens, the whole
-- matched set is still sorted, all but twenty rows are then discarded, and the envelope's count(*)
-- adds a second pass. The index is what turns a page into a saving.
--
-- The predicate below is `<scope> = ? / in (?)` followed by `order by <timestamp> desc limit ?`.
-- A composite index with the timestamp in it lets Postgres walk from the newest row in scope and
-- stop after `size`, so page one costs the same at ten rows and at ten thousand.
--
-- `idx_document_requests_property` (V6) is single-column, so the owner's whole portfolio of
-- requests had to be gathered and quicksorted on every read. With `created_at` in the index the
-- planner can MergeAppend the per-property scans -- already in the right order -- and stop at the
-- page boundary. That matters most for the `property_id in (...)` shape used here: the wider the
-- portfolio, the more rows the old plan had to sort to return the same twenty.
--
-- V6's single-column index stays. It backs the property-detail reads and the cascade checks, and
-- dropping a prefix index in the same change that adds its superset is how the one query nobody
-- re-measured regresses.
CREATE INDEX idx_document_requests_property_created
    ON document_requests (property_id, created_at DESC);

-- D123. The buyer's half of the document gate: GET /me/document-requests.
--
-- V49 indexed this table for the *owner's* inbox (property_id, created_at desc), which is the
-- query that starts from "listings you own". The requester's list starts from the other end --
-- "rows you wrote" -- and had no index at all, so it planned as a sequential scan of every
-- document request in the system followed by a sort, to return twenty rows. That is invisible on
-- a developer's seed data and is exactly the shape that degrades in production, because the table
-- grows with total demand across the whole catalogue while one buyer's slice of it stays small.
--
-- created_at descending in the index, not just requester_id: the sort column has to be in the
-- index for Postgres to stop after one page instead of collecting the caller's whole history and
-- throwing all but a page of it away. Same reasoning as V49, mirrored.
--
-- No unique constraint and no partial predicate: unlike uq_document_requests_pending this index
-- enforces nothing, it only makes an existing read cheap. Concurrently is deliberately not used --
-- Flyway runs migrations inside a transaction and this table is small enough that a brief lock at
-- deploy time is cheaper than the machinery to avoid it.
create index if not exists idx_document_requests_requester_created
    on document_requests (requester_id, created_at desc);

-- ownership_basis: 1:1 per property (schema: OwnershipBasis).
CREATE TABLE ownership_basis (
    property_id      uuid PRIMARY KEY REFERENCES properties(id),
    owner_id         uuid NOT NULL REFERENCES users(id),
    purchase_price   bigint,
    purchase_date    date,
    loan_outstanding bigint,
    emi              bigint,
    current_value    bigint,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- owner_kyc: 1:1 per user (schema: OwnerKyc). Masked PAN/Aadhaar only.
CREATE TABLE owner_kyc (
    user_id        uuid PRIMARY KEY REFERENCES users(id),
    pan_masked     text,
    aadhaar_masked text,
    bank_verified  boolean NOT NULL DEFAULT false,
    status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- V32 personal_documents — the owner's own KYC papers, kept apart from any listing (slice A).
--
-- WHAT THIS IS, AND WHY IT IS A SEPARATE TABLE
-- --------------------------------------------
-- The dashboard's Documents tab has always had a "personal" bucket alongside the per-property
-- vaults: Aadhaar, PAN, a passport photo, an ownership proof. These belong to the *person*, not to
-- a flat -- they outlive any single listing, they are reused across every listing that person ever
-- posts, and they are never shared through a property's document-request/grant flow. The front end
-- already reads them as `getDocsForProp(mobile, 'personal')`; slice A gives that bucket a server.
--
-- V20 DELIBERATELY CLOSED THE OTHER DOOR -- SO WE OPEN A NEW ONE, WE DO NOT REVERSE IT
-- -----------------------------------------------------------------------------------
-- V6 left `documents.property_id` nullable "for a personal-vault idea", and V20 tightened it to
-- NOT NULL with the reasoning: "a row with no property is unreachable by any endpoint -- a leak of
-- storage, not a feature". That reasoning was correct for the `documents` table and it still is:
-- every row there is reached through /me/documents/{propId} and belongs to a property's vault and
-- its shares. Rather than re-nullable that column and re-introduce a property-XOR-owner ambiguity
-- into a table whose sharing logic assumes "every row has a property", the personal bucket gets its
-- own table keyed on the *user*. V20's invariant stands untouched; the personal-vault idea returns
-- as a first-class resource with its own endpoint, which is exactly the "unreachable" objection
-- V20 raised, now answered.
--
-- SHAPE MIRRORS `documents` MINUS THE PROPERTY WORLD
-- -------------------------------------------------
-- Same storage model: bytes live in the object store under a server-minted `storage_key`, the URL
-- is signed and short-lived at read time, so there is no `url` column (a persisted URL is a
-- permanent bearer credential to someone's Aadhaar). No `service_request_id`, no share token: a KYC
-- document is never handed to a buyer or a lawyer through this table. `uploaded_at` is a distinct
-- column from `created_at`, following the `documents` convention.
CREATE TABLE personal_documents (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES users(id),  -- the person, not a listing
    category    text,                                -- "Aadhaar Card", "PAN Card", ... (UI's vocabulary)
    file_name   text,                                -- uploader's filename, sanitised; never the key
    storage_key text NOT NULL,                        -- object-store key; signed URL derived at read time
    size_bytes  bigint,
    mime_type   text,                                -- the type the bytes prove, not the one declared
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The only read is "this person's papers, newest first"; there is no cross-user query, by design.
CREATE INDEX idx_personal_documents_owner_uploaded ON personal_documents (owner_id, uploaded_at DESC);

COMMENT ON TABLE personal_documents IS
    'A user''s own KYC/identity documents (Aadhaar, PAN, passport photo, ownership proof), owned by '
    'the person rather than any listing. Kept apart from `documents` so the property vault''s '
    'sharing and request logic can assume every row it holds belongs to a property.';

-- V63 D190/Q15: make "Ownership Verified" a badge that is earned, and that lapses.
--
-- `properties.ownership_verified` has existed since the first schema and no code has ever written
-- it. It is set by the demo seed and by nothing else, which means the single strongest trust signal
-- on the platform — the one the home page sells the product on — has been decorative. A badge that
-- cannot be earned is not a weak feature, it is a false statement made to a buyer about a title
-- deed, and it is the exact claim a fraudulent listing most wants to wear.
--
-- Two things were missing, and they are the same thing twice: evidence, and its date.
--
-- Evidence is recorded per document rather than as a second boolean because the gate (Q15) is three
-- independent facts — someone owns it, that someone is the person listing it, and the place
-- physically exists — and "which one is missing?" is the question ops actually has. A boolean can
-- answer "verified?" and nothing else; a row per document answers "verified, and on the strength of
-- what, recorded by whom, and until when".
--
-- The date is `issued_at`: when the document was issued, or when the photos were taken — never when
-- ops looked at it. A 2019 property-tax receipt reviewed this morning proves that the person owned
-- the flat in 2019. Deriving expiry from the review date would let a stale document mint a fresh
-- badge, which is precisely the failure this table exists to make impossible. So expiry is
-- issued_at + the window for that document type: 90 days for the recurring proofs (tax receipt,
-- electricity bill), 180 for site photos, never for the registry and identity documents, which do
-- not go stale because the fact they record does not change.
--
-- `expires_at` is stored rather than computed on read so that the window a document was accepted
-- under survives a later change to the window. Shortening the tax-receipt window from 90 days to 60
-- must apply to documents recorded after the change, not silently un-verify every listing on the
-- platform overnight.
--
-- V66 D202: the four schema repairs V63's evidence table needs, and the column that makes an
-- identity sighting falsifiable. V66 could not edit V63, which was already checksummed, so each of
-- the four was expressed as an alteration of the table V63 created; consolidated here they are
-- declared inline (except the NOT VALID constraint, which has no inline form -- see below). The
-- reasoning that belongs beside each one is written here rather than left to the register row that
-- found them.
--
-- 1. THE PROPERTY FOREIGN KEY WAS `ON DELETE CASCADE`, AND THE TABLE'S OWN COMMENT CONTRADICTS IT.
--    V63 says the case file "still shows what the badge was granted on at the time it was granted",
--    and OwnershipVerificationService.revoke says in as many words that the evidence rows are left
--    in place because "deleting them would erase the case at the moment it started to matter". A
--    cascade makes both statements conditional on the listing row outliving the dispute. Nothing in
--    the application deletes a property today -- listings archive, they are not removed, and
--    ErasureRetention retains them outright -- so the cascade has never fired and is not load
--    bearing. That is exactly when it is cheap to close: the first `DELETE FROM properties` anybody
--    ever runs, in a console, against a listing under investigation, is the one that must not
--    silently take the evidence with it. RESTRICT turns that into an error the operator has to read.
--
-- 2. `recorded_by` DECLARED NO `ON DELETE` AT ALL, so it took PostgreSQL's default of NO ACTION.
--    That default happens to be nearly right, which is the reason to state it rather than leave it:
--    a reader cannot tell an intended NO ACTION from an omission, and the three plausible choices
--    here are not interchangeable. CASCADE would delete the evidence when the ops user who recorded
--    it leaves, which is the same case-file loss as (1). SET NULL is not even available -- the
--    column is NOT NULL -- and would be wrong if it were, because "somebody at this company sighted
--    a title deed" without a name is not accountability. RESTRICT is therefore the deliberate
--    choice, and it is safe: erasure here pseudonymises the users row rather than deleting it
--    (ErasureService replaces the mobile and blanks the rest), so no code path is being blocked.
--    RESTRICT over NO ACTION only because RESTRICT cannot be deferred to commit -- the failure
--    should surface on the statement that caused it.
--
-- 3. NOTHING STOPPED A DOCUMENT EXPIRING BEFORE IT WAS ISSUED. Expiry is derived in Java from
--    `issued_at` plus the window for the doc type, so today the pair is always consistent; the
--    CHECK exists because the derivation is one line of application code standing between a
--    mistyped backfill and a row that reads as a document which was never valid for a moment. The
--    NULL branch is the registry and identity documents that never go stale.
--
-- 4. `owner_identity` ROWS RECORDED *THAT* AN IDENTITY WAS SIGHTED, NOT *WHOSE*. This is the defect
--    with a product consequence rather than a hygiene one. The badge asserts that the person
--    listing the flat is the person who owns it, and the evidence behind that assertion was a row
--    saying "an Aadhaar was seen" with no name on it. In a dispute -- the only moment this table is
--    ever read in anger -- that row cannot be checked against anything, so it cannot be wrong, so it
--    proves nothing. `subject_name` is the name as it appears on the document, and the CHECK makes
--    it mandatory for exactly the two doc types whose whole purpose is to name a person.
--
--    The number itself is deliberately NOT stored, not even masked. The comparable columns that do
--    (`identity_verifications.masked_aadhaar`, `owner_kyc.aadhaar_masked`) exist because a
--    verification provider returns them; nothing here needs one. The name is the fact the dispute
--    turns on and is the least that can be held to establish it.
CREATE TABLE property_ownership_evidence (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid        NOT NULL REFERENCES properties (id) ON DELETE RESTRICT,
    doc_type     text        NOT NULL CHECK (doc_type IN (
                                 'index_ii', 'sale_deed', 'tax_receipt', 'electricity_bill',
                                 'aadhaar', 'pan', 'site_photos')),
    document_id  uuid        REFERENCES documents (id) ON DELETE SET NULL,
    subject_name text,
    issued_at    timestamptz NOT NULL,
    expires_at   timestamptz,
    recorded_by  uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT property_ownership_evidence_expiry_after_issue
        CHECK (expires_at IS NULL OR expires_at > issued_at)
);

-- NOT VALID, and only here. Every row recorded from V66 onward is checked; rows already on file
-- were not, because the name they are missing cannot be reconstructed and a migration that refuses
-- to apply against real data is a migration that gets reverted rather than read. The constraint
-- still does its job -- it is the write path it has to bind. It stays an ALTER rather than an
-- inline CHECK because NOT VALID has no inline form, and a validated constraint here would not
-- match the shape the rest of the chain produced.
ALTER TABLE property_ownership_evidence
    ADD CONSTRAINT property_ownership_evidence_identity_names_its_subject
        CHECK (doc_type NOT IN ('aadhaar', 'pan')
               OR (subject_name IS NOT NULL AND btrim(subject_name) <> ''))
        NOT VALID;

-- Every read of this table is "the evidence for one listing" — the ops case file, and the gate
-- check that runs on every verify. There is no query that wants evidence across listings.
CREATE INDEX idx_ownership_evidence_property
    ON property_ownership_evidence (property_id);

COMMENT ON TABLE property_ownership_evidence IS
    'One document (or photo set) offered as proof for the Ownership Verified badge (D190/Q15). '
    'Rows are append-only in practice: a lapsed tax receipt is superseded by recording a newer '
    'one, not by editing the old row, so the case file still shows what the badge was granted on '
    'at the time it was granted.';

COMMENT ON COLUMN property_ownership_evidence.issued_at IS
    'When the document was issued, or the photographs taken — NOT when ops reviewed it. The whole '
    'point of the gate is that a stale document cannot mint a fresh badge, so every expiry is '
    'derived from this rather than from the review.';

COMMENT ON COLUMN property_ownership_evidence.expires_at IS
    'issued_at + the validity window for this doc_type, or NULL for the registry and identity '
    'documents that never go stale. Stored rather than derived on read so that changing a window '
    'applies to future evidence instead of retroactively un-verifying live listings.';

COMMENT ON COLUMN property_ownership_evidence.document_id IS
    'The documents-vault row this evidence points at, when the proof was uploaded rather than '
    'sighted. Nullable and ON DELETE SET NULL: deleting a file must not erase the record that ops '
    'saw one, because that record is the audit trail for a decision already taken.';

COMMENT ON COLUMN property_ownership_evidence.subject_name IS
    'Whose identity was sighted -- the name as it appears on the document (D202). Required for the '
    'identity doc types and optional for the rest, which is what the accompanying CHECK enforces. '
    'Without it an owner_identity row asserts that some identity document was seen without saying '
    'whose, which is unfalsifiable and therefore worthless in the dispute that is the only reason '
    'this table is read. The document number is deliberately not stored, masked or otherwise: the '
    'name is the fact a dispute turns on, and it is the least that establishes it.';

COMMENT ON CONSTRAINT property_ownership_evidence_property_id_fkey ON property_ownership_evidence IS
    'RESTRICT, not CASCADE (D202). The evidence is the record behind a trust claim a buyer relied '
    'on, and the revoke path is written on the promise that it survives. Deleting the listing must '
    'fail loudly rather than quietly take the case file with it.';

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- updated_at column.
SELECT install_updated_at_triggers();
