-- "Request more photos" becomes a real demand signal, because until now it was not one at all.
--
-- The feature has shipped since the prototype and has never once reached an owner. `photoRequests.js`
-- wrote the request to `localStorage` under `puneNestPhotoReq:<ownerMobile>` -- the owner's key, in
-- the BUYER's browser. The owner reads that same key from their own browser, which holds only the
-- requests they themselves made against someone else. So the write and the read have always been in
-- different storage, on different devices, and the only way an owner ever saw a photo request was an
-- e2e test that seeded one into the owner's browser by hand. Every real buyer who tapped "More
-- photos" got a toast saying "the owner will see it"; no owner ever did. That is the bug this table
-- closes, and it is why this is a new domain rather than a port -- there is no behaviour to preserve.
--
-- Separate from `contact_requests` (V4) despite the obvious family resemblance. Three things differ
-- and each of them would have to become a nullable column or a status value if these shared a table:
-- the gate is lighter (sign-in only, no L2 badge -- a photo request exposes no owner PII, which is
-- the whole reason the contact gate is heavy); nothing is ever revealed, so there is no masked/raw
-- mobile duality and no approve/decline decision; and the owner's action is to go add photos, not to
-- answer the requester. A shared table would mean a `status` CHECK that accepts six values of which
-- each row may legally hold three -- the classic "two entities in a trench coat".
--
-- `resolved` rather than a delete: an owner who adds photos should stop being nagged without losing
-- the evidence that demand existed, which is the signal the whole feature is for. The row is the
-- record that N buyers wanted more of this listing, and that stays true after it is acted on.
CREATE TABLE photo_requests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    requester_id uuid NOT NULL REFERENCES users(id),
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
    resolved_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The de-dupe, and the only thing that actually enforces it. The service reads before it inserts and
-- returns the existing row, but two genuinely concurrent taps can both miss that read -- this is what
-- makes "a buyer cannot ask twice" true rather than merely likely. Same shape and same reasoning as
-- `uq_contact_requests_requester_property` (V9).
--
-- Deliberately NOT scoped by status: a resolved request must still block a re-ask, otherwise every
-- owner who adds photos immediately becomes re-nagg-able by the same buyer, and the count stops
-- meaning "distinct people who wanted this" -- which is the only thing it is good for.
CREATE UNIQUE INDEX uq_photo_requests_requester_property
    ON photo_requests (requester_id, property_id);

-- The owner inbox reads by property (`WHERE property_id IN (<the owner's listings>)`), so this is the
-- index that read rides. The unique index above already covers requester-side lookups.
CREATE INDEX idx_photo_requests_property ON photo_requests (property_id);

-- `ON DELETE CASCADE` on property_id but not on requester_id, and the asymmetry is intentional: a
-- photo request against a deleted listing is a nag pointing at a page that 404s, whereas users are
-- soft-deleted platform-wide and never actually leave the table.
