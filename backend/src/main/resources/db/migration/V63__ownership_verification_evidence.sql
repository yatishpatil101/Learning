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

CREATE TABLE property_ownership_evidence (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid        NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
    doc_type    text        NOT NULL CHECK (doc_type IN (
                                'index_ii', 'sale_deed', 'tax_receipt', 'electricity_bill',
                                'aadhaar', 'pan', 'site_photos')),
    document_id uuid        REFERENCES documents (id) ON DELETE SET NULL,
    issued_at   timestamptz NOT NULL,
    expires_at  timestamptz,
    recorded_by uuid        NOT NULL REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Every read of this table is "the evidence for one listing" — the ops case file, and the gate
-- check that runs on every verify. There is no query that wants evidence across listings.
CREATE INDEX idx_ownership_evidence_property
    ON property_ownership_evidence (property_id);

ALTER TABLE properties ADD COLUMN ownership_verified_at timestamptz;
ALTER TABLE properties ADD COLUMN ownership_verified_until timestamptz;

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

COMMENT ON COLUMN properties.ownership_verified_at IS
    'When ops last accepted a complete evidence set for this listing (D190). The instant handed to '
    'VerificationAnnouncer, so the referral credit and the listing agree on when it happened.';

COMMENT ON COLUMN properties.ownership_verified_until IS
    'The earliest expiry among the documents the badge was granted on, or NULL when every one of '
    'them is a never-expiring registry or identity document. The badge is DERIVED from this rather '
    'than swept: a nightly job leaves a window in which a lapsed listing still shows verified, and '
    'a comparison against now() has no such window and nothing to backfill (D190).';

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has
-- an updated_at column.
SELECT install_updated_at_triggers();
