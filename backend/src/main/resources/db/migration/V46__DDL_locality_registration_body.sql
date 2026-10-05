-- The body a Leave & License registers with sets its fee: Rs 1,000 in a municipal area (PMC, PCMC,
-- a municipal council or cantonment), Rs 500 under a Gram Panchayat. The wizard used to ask the
-- customer, so anyone could pick the cheaper fee. The server now reads it from here (D-h).
-- Rows are flagged in R__DML_seed_reference_data.sql, which runs after this on a fresh database.
ALTER TABLE localities
    ADD COLUMN registration_body text NOT NULL DEFAULT 'municipal'
        CHECK (registration_body IN ('municipal', 'gram-panchayat'));
