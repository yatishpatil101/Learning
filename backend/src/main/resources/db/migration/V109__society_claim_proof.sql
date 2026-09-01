-- V109 — the two things a society claim was asking ops to check, and never carried.
--
-- WHY THIS EXISTS
--
-- `/admin/society-claims` is a proof-checking desk. An operator looking at it has to answer one
-- question -- is this person really on the committee of this building -- and until now the whole of
-- the evidence was the claimant's own free-text `note`. The consumer claim form has always asked
-- for a Maharashtra registration number and offered a certificate upload; neither existed on the
-- wire, so the number was concatenated into `note` as a sentence and the file was written to the
-- claimant's own browser, where the only person who needs to see it never can.
--
-- The ops console dropped its "Reg / Cert" column rather than render it permanently blank, and that
-- was right: a blank proof column on a proof-checking screen reads as "the claimant supplied
-- nothing" rather than "we never asked". This migration is the other half of that decision -- the
-- field has to be collected before it can be reviewed.
--
-- WHY BOTH ARE NULLABLE
--
-- A committee that cannot lay hands on its registration certificate this afternoon must still be
-- able to file a claim. Making either column NOT NULL would replace an empty column on one screen
-- with a blocked funnel on another, and the funnel is the expensive one: the claim is how a society
-- reaches us at all, and the operator can always ask for the paper afterwards. Proof raises
-- confidence in a claim; its absence is not a refusal.
--
-- WHY `registration_no` IS FREE TEXT WITH NO CHECK
--
-- Maharashtra co-operative housing society registration numbers are not a format. `PNA/1234/2015`,
-- `PNA/(PNA)/HSG/(TC)/1234/2015`, the same with a date appended, the same again from a district
-- registrar who spaces it differently -- all are real, all are what is printed on the certificate
-- the operator is holding. A pattern CHECK here would reject correct numbers on the strength of a
-- guess about the ones we had happened to see, and the claimant's only recourse would be to type
-- something false. The operator reading the certificate is the validator; the column just has to
-- carry what they will compare against.

ALTER TABLE society_claims ADD COLUMN registration_no text;

-- The certificate itself. Same storage model as every other uploaded paper on the platform: the
-- bytes live in the object store under a server-minted `storage_key` and the row here is only a
-- pointer at the vault row that holds it (V32 `personal_documents`). A society registration
-- certificate belongs to the person who filed the claim rather than to a listing, which is exactly
-- the distinction V32 exists for, so the personal vault is where it lands.
--
-- ON DELETE SET NULL, and nullable, for the reason V63 gives about ownership evidence: deleting a
-- file must not erase the record that a claim was filed with one, because that record is the audit
-- trail behind a decision an operator has already taken.
ALTER TABLE society_claims
    ADD COLUMN certificate_document_id uuid REFERENCES personal_documents (id) ON DELETE SET NULL;

COMMENT ON COLUMN society_claims.registration_no IS
    'The society''s Maharashtra registration number, as printed on the certificate. Free text on '
    'purpose: the format varies by registrar and a CHECK would reject correct numbers.';

COMMENT ON COLUMN society_claims.certificate_document_id IS
    'The claimant''s personal-vault row holding the scanned registration certificate, or NULL when '
    'they had none to hand. Nullable and ON DELETE SET NULL: a claim without proof is still a '
    'claim, and deleting the file must not erase the record that ops saw one.';

-- No index. Neither column is ever a search key -- the queue is read by status and age, and both of
-- these are read only once a row is already on the operator's screen.

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- updated_at column.
SELECT install_updated_at_triggers();
