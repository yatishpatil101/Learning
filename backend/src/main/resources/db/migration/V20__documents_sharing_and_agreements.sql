-- V20 Documents, sharing and agreements (slice 10). Makes the V6 paperwork tables serviceable:
-- the buyer's request carries a note, a grant carries an expiry, and the share token is a real
-- lookup key rather than an unindexed text column.

-- Every document in the contract is reached through /me/documents/{propId}, so a row with no
-- property is unreachable by any endpoint -- a leak of storage, not a feature. V6 left the column
-- nullable for a "personal vault" idea that never entered the contract.
ALTER TABLE documents ALTER COLUMN property_id SET NOT NULL;

-- The vault list is "this property's documents, newest first" and nothing else.
DROP INDEX IF EXISTS idx_documents_property;
CREATE INDEX idx_documents_property_uploaded ON documents (property_id, uploaded_at DESC);

-- The buyer's covering note ("I have a home loan sanctioned, may I see the title chain?").
-- DocumentRequestCreate.message had nowhere to land.
ALTER TABLE document_requests ADD COLUMN message text;

-- A grant is time-boxed. Without this the share token is a permanent bearer credential to
-- someone's title deeds, and the 'expired' status in the CHECK could never be reached.
ALTER TABLE document_requests ADD COLUMN expires_at timestamptz;

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

-- GET /me/rent-agreements is owner-scoped and newest-first; V6 indexed only property_id.
CREATE INDEX idx_rent_agreements_owner ON rent_agreements (owner_id, created_at DESC);
