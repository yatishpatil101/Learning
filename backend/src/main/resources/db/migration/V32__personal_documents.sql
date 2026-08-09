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

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has
-- an updated_at column.
SELECT install_updated_at_triggers();
