-- V79 originally indexed (society_id, floor, bhk) for a society-branch duplicate probe.
--
-- That branch no longer exists. The live duplicate queries are:
--   * electricity_meter_no, or
--   * (locality_slug, address_key)
-- and neither references society_id/floor/bhk.
--
-- Keeping an unreferenced write-time index on properties is pure overhead on every insert/update.
-- Drop it rather than carrying dead maintenance cost.
DROP INDEX IF EXISTS idx_properties_society_unit;
