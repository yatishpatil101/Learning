-- ---------------------------------------------------------------------------
-- Owner consent is about one flat (V30)
-- ---------------------------------------------------------------------------
-- V13 keyed `flatmate_owner_consents` on (owner_mobile, granted_by) alone, which says "this owner
-- consented to this tenant" and nothing about WHAT they consented to. So one OTP, taken honestly
-- from a real landlord about a real flat, silently vouched for every later post the same tenant
-- made -- including a sub-let of a flat that landlord has never heard of. The Tenant-verified badge
-- reads that flag, and a badge certifying an unconsented sub-let is the most expensive thing this
-- platform can say: under the Maharashtra Rent Control Act parting with possession without the
-- owner's written consent is a ground for eviction.
--
-- `address_fingerprint` is the key the rest of the flatmate module already uses for "one physical
-- flat" (FlatmateGuardrails.fingerprint -- `prop:<uuid>` for a verified listing, else a normalised
-- society-or-title plus locality). Scoping the consent to it means the row answers the question the
-- badge actually asks: did this owner consent to THIS flat being sub-let by THIS tenant.
ALTER TABLE flatmate_owner_consents ADD COLUMN address_fingerprint text;

-- Backfill only where the address is knowable. A consent taken through the group route names its
-- group, and the group carries the fingerprint, so those rows can be scoped exactly. Consents taken
-- before the group existed (group_id null) name no flat at all, and there is nothing to infer one
-- from -- guessing would re-create the hole this migration closes. They keep a null fingerprint,
-- which the lookup treats as vouching for nothing: the tenant re-takes the OTP on their next post,
-- one SMS, and the audit row survives to show the consent was once given.
UPDATE flatmate_owner_consents c
   SET address_fingerprint = g.address_fingerprint
  FROM flatmate_groups g
 WHERE c.group_id = g.id
   AND g.address_fingerprint IS NOT NULL;

-- The uniqueness that made the row idempotent has to widen with the key, or a tenant could hold
-- only one consent ever and their second flat would collide with their first.
DROP INDEX uq_flatmate_owner_consents;

-- coalesce rather than a plain three-column index because PostgreSQL treats NULLs as distinct, so
-- the un-backfilled legacy rows above would be freely duplicable. NULLS NOT DISTINCT would say this
-- directly but arrived in PostgreSQL 15, and this schema still runs on 13.
CREATE UNIQUE INDEX uq_flatmate_owner_consents
    ON flatmate_owner_consents (owner_mobile, granted_by, coalesce(address_fingerprint, ''));

COMMENT ON COLUMN flatmate_owner_consents.address_fingerprint IS
    'The flat the consent is about, in FlatmateGuardrails fingerprint form. Null only on legacy '
    'rows taken before V30, which vouch for nothing.';
