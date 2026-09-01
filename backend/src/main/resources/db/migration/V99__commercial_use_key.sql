-- V99 — a canonical key for the commercial subtype, for the same reason V98 added one for the
-- property type: the browser filters commercial listings by substring against the stored label,
-- and the server has no column that answers the same question.
--
-- `property_type_key` (V98) collapses every commercial label to the single key `commercial`, which
-- is right for the top-level chip and useless for the sub-filter beneath it. A buyer who narrows to
-- Warehouse / Godown is asking a question the type key cannot represent, so without this column the
-- Commercial Type control could not move server-side at all — it would have had to be declared
-- unsupported and disclosed in the UI, which for the commercial vertical means the sub-filter that
-- makes the vertical usable stops working.
--
-- The tokens mirror COMMERCIAL_SUBTYPES in frontend/src/data/propertyTypes.js, which in turn
-- mirrors the COMMERCIAL_SUBTYPES the posting wizard authors with — so a listing is filterable by
-- exactly the option it was posted under. As with V98 the mapping is one key per row: a label that
-- names two subtypes resolves to the first branch that matches, and a label that names none is
-- NULL rather than a guess.
--
-- Generated rather than maintained on write, following V94 and V98: the label is set on eight
-- different write paths, and a trigger or an application-side mirror on all eight is eight chances
-- for the key and the label to disagree. A generated column cannot drift from its input.

ALTER TABLE properties ADD COLUMN commercial_use_key text GENERATED ALWAYS AS (
  CASE
    WHEN lower(coalesce(property_type, '')) LIKE '%office%' THEN 'office'
    -- co-working before shop/retail: "Co-working Space" contains neither, but keeping the more
    -- specific arrangements ahead of the general ones is what stops a future label like
    -- "Co-working Retail Hub" landing under retail.
    WHEN lower(coalesce(property_type, '')) LIKE '%co-working%'
      OR lower(coalesce(property_type, '')) LIKE '%coworking%' THEN 'coworking'
    WHEN lower(coalesce(property_type, '')) LIKE '%shop%'
      OR lower(coalesce(property_type, '')) LIKE '%showroom%' THEN 'shop'
    WHEN lower(coalesce(property_type, '')) LIKE '%retail%'
      OR lower(coalesce(property_type, '')) LIKE '%mall%' THEN 'retail'
    WHEN lower(coalesce(property_type, '')) LIKE '%warehouse%'
      OR lower(coalesce(property_type, '')) LIKE '%godown%' THEN 'warehouse'
    WHEN lower(coalesce(property_type, '')) LIKE '%industrial%'
      OR lower(coalesce(property_type, '')) LIKE '%factory%' THEN 'industrial'
    ELSE NULL
  END) STORED;

COMMENT ON COLUMN properties.commercial_use_key IS 'Canonical commercial subtype: office|coworking|shop|retail|warehouse|industrial, or NULL for a listing that is not commercial or whose label names no known subtype. Generated from property_type. Mirrors COMMERCIAL_SUBTYPES in frontend/src/data/propertyTypes.js.';

-- Narrower than the type-key index on purpose: this column is only ever read together with a
-- commercial type key, and only on the live catalogue.
CREATE INDEX idx_properties_commercial_use ON properties (commercial_use_key)
  WHERE status = 'approved' AND archived = false AND commercial_use_key IS NOT NULL;

-- Audit: commercial listings whose label named no subtype we recognise. Expected to be empty; a
-- row here is a label the wizard can produce and this CASE cannot classify, which means the
-- sub-filter silently hides it.
--
--   SELECT DISTINCT property_type
--     FROM properties
--    WHERE property_type_key = 'commercial'
--      AND commercial_use_key IS NULL;
