-- The posting wizard asks whether pets are allowed and never transmitted the answer, so every
-- listing carried the column default and the detail page printed "Not allowed" for owners who
-- said nothing — and said it beside the answers they did give, in the same weight.
-- V95 argued a tenant with a dog reads "unstated" and "no" the same way. That is true of the
-- tenant's decision and false of the listing: the renter can ask, and an owner who would have
-- said yes loses the enquiry to a claim the site invented on their behalf.
ALTER TABLE properties ALTER COLUMN pets DROP NOT NULL;
ALTER TABLE properties ALTER COLUMN pets DROP DEFAULT;

COMMENT ON COLUMN properties.pets IS
    'Owner-declared pet policy. NULL is unstated and must render as "ask the owner", never as "not allowed"; the pet-friendly filter matches TRUE only, so an unstated listing is neither promised nor advertised.';

-- Existing FALSE rows are left alone. Most are the old default rather than an answer, but a seed
-- or an admin-entered listing may mean it, and rewriting them to NULL would erase the real ones to
-- correct the invented ones.
