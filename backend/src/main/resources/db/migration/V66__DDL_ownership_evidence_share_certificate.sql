ALTER TABLE property_ownership_evidence DROP CONSTRAINT property_ownership_evidence_doc_type_check;
ALTER TABLE property_ownership_evidence ADD CONSTRAINT property_ownership_evidence_doc_type_check
    CHECK (doc_type IN ('index_ii','sale_deed','tax_receipt','electricity_bill','aadhaar','pan',
                        'site_photos','satbara_7_12','eight_a_extract','property_card',
                        'share_certificate','power_of_attorney'));
