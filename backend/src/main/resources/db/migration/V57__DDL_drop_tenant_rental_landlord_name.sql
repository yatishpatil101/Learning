-- A third party's name, held on the tenant's say-so with no reader that needed it and no erasure
-- path for the person named. Dropping the column also drops tenant_rentals_landlord_length.
ALTER TABLE tenant_rentals DROP COLUMN landlord_name;
