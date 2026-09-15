ALTER TABLE properties ADD COLUMN form_details jsonb;
ALTER TABLE properties ADD CONSTRAINT properties_form_details_object
    CHECK (form_details IS NULL OR
        (jsonb_typeof(form_details) = 'object' AND octet_length(form_details::text) <= 65536));
COMMENT ON COLUMN properties.form_details IS
    'Private owner/staff edit answers not represented by canonical listing columns. No media, identity credentials or verification status. Legacy combined addresses are not split heuristically.';