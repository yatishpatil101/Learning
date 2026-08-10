-- V47 service_request_identities — the narrow channel that carries PAN and Aadhaar to the one
-- operator drafting the agreement, and to nobody else (D151).
--
-- WHY THIS TABLE EXISTS AT ALL
-- ---------------------------
-- A Leave & License agreement names each party by PAN and Aadhaar; the drafting desk cannot produce
-- one without them. They used to arrive inside `service_requests.details`, which is plaintext jsonb
-- echoed verbatim by ServiceRequestMapper on *every* staff read including the paged ops queue -- so
-- the first page of that queue was a bulk identity dump. The wizard now redacts them client-side and
-- `ServiceRequestService.rejectIdentityNumbers` refuses them server-side, and both of those stay.
-- This is the deliberate replacement channel: same numbers, one reader, every read recorded.
--
-- WHY NOT THE DOCUMENT VAULT, WHICH IS WHAT THE REGISTER FIRST PROPOSED
-- --------------------------------------------------------------------
-- The vault's read model is `FileStorage.signedDownloadUrl(key)` -- a URL that carries its own
-- authority. It cannot be pointed at one operator, it cannot refuse anybody, and following it never
-- reaches our server, so no read of it can be recorded. "Only the assigned operator sees them" and
-- "every access is audited" are both unexpressible there, and they are the whole requirement.
-- Two further facts settled it: `DocumentUploads.validate` accepts PDF/JPEG/PNG/HEIC/WEBP proved by
-- magic bytes, so a set of numbers is not a thing the vault can hold without weakening the allowlist
-- that keeps non-documents out of it; and `DocumentService.delete` deliberately leaves the stored
-- object behind, which is a defensible trade for a sale deed and an indefensible one for an Aadhaar
-- number (Aadhaar Act s.29 wants retention deliberate, minimal and reversible). A vault artefact
-- would have been a permanent, un-revocable, un-auditable bearer copy of the most sensitive field
-- the platform touches. A row we can authorise, log and blank is strictly better on all three.
--
-- ONE ROW PER PARTY, NOT ONE JSON BLOB PER REQUEST
-- ------------------------------------------------
-- The agreement names an owner and one-to-many tenants, and the desk works party by party. Rows also
-- make the purge below a plain UPDATE over columns rather than a rewrite of a document, and make
-- "how many parties were recorded" answerable without reading the numbers themselves -- which is
-- what the audit metadata records.
--
-- BOTH NUMBERS ARE NULLABLE
-- -------------------------
-- A tenant may genuinely have no PAN. The service refuses a party carrying neither, so a row always
-- says something; it does not require it to say both.
--
-- RETENTION
-- ---------
-- `purged_at` is the point of the table as much as the numbers are. When a request reaches a
-- terminal status -- completed, because the registered document now carries the numbers, or
-- cancelled, because nothing will be drafted -- the service blanks `pan` and `aadhaar` and stamps
-- this column. The row survives so that "recorded, and since purged" stays distinguishable from
-- "never recorded"; `party_name` survives with it because a name is not the thing being minimised
-- and a purged row with no name at all reads like corruption. There is no other retention window,
-- deliberately: the numbers exist for exactly as long as somebody is drafting from them.
--
-- ON DELETE CASCADE, unlike most foreign keys here: a service request is never hard-deleted today,
-- but if one ever is, an orphaned Aadhaar number outliving the matter it was collected for is the
-- one outcome this table must not permit.
CREATE TABLE service_request_identities (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    party_role         text NOT NULL,                     -- 'owner' | 'tenant'
    party_index        integer NOT NULL DEFAULT 0,        -- 0 for the owner; 0..n across tenants
    party_name         text,                              -- survives the purge; the numbers do not
    pan                text,                              -- ABCDE1234F, or NULL
    aadhaar            text,                              -- 12 digits, or NULL
    created_at         timestamptz NOT NULL DEFAULT now(),
    purged_at          timestamptz,                       -- set when the numbers were blanked
    CONSTRAINT service_request_identities_role_check
        CHECK (party_role IN ('owner', 'tenant')),
    CONSTRAINT service_request_identities_index_check
        CHECK (party_index >= 0),
    -- The wizard resubmits the whole set when the customer corrects a typo, so the service replaces
    -- rather than appends. This is what makes "replace" mean one row per party rather than a growing
    -- pile of half-corrected duplicates the desk would have to choose between.
    CONSTRAINT uq_service_request_identity_party
        UNIQUE (service_request_id, party_role, party_index)
);

-- The only read is "the parties on this request, in drafting order". There is no cross-request
-- query and there must never be one: a query that can return identity numbers for more than one
-- matter at a time is the ops-queue leak this table was built to replace.
CREATE INDEX idx_service_request_identities_request
    ON service_request_identities (service_request_id, party_role, party_index);

COMMENT ON TABLE service_request_identities IS
    'PAN/Aadhaar for the parties named in a service request (D151). Written by the requester, '
    'readable only by the staff member the request is assigned to, audited on every read, and '
    'blanked when the request reaches a terminal status. Never projected onto ServiceRequestDto '
    'and never included in any list response.';

COMMENT ON COLUMN service_request_identities.purged_at IS
    'When pan/aadhaar were blanked because the request completed or was cancelled. NULL means the '
    'numbers are still held.';

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- updated_at column. This table has none -- an identity row is written once and blanked once, and
-- both moments have their own column -- but the call is idempotent and the convention is the point.
SELECT install_updated_at_triggers();
