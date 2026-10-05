-- Maharashtra land records (7/12, 8A, Property Card are Mahabhumi extracts) and a registered
-- power of attorney. A POA must name its principal, the owner the agent acts for.
ALTER TABLE property_ownership_evidence DROP CONSTRAINT property_ownership_evidence_doc_type_check;
ALTER TABLE property_ownership_evidence ADD CONSTRAINT property_ownership_evidence_doc_type_check
    CHECK (doc_type IN ('index_ii','sale_deed','tax_receipt','electricity_bill','aadhaar','pan',
                        'site_photos','satbara_7_12','eight_a_extract','property_card',
                        'power_of_attorney'));

ALTER TABLE property_ownership_evidence ADD CONSTRAINT property_ownership_evidence_poa_names_principal
    CHECK (doc_type <> 'power_of_attorney'
           OR (subject_name IS NOT NULL AND btrim(subject_name) <> ''));
