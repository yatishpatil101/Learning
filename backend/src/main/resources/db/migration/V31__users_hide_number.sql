-- V31 — `users.hide_number`: the owner's blanket privacy control (tech-debt D5, closed).
--
-- WHAT IT MEANS
-- -------------
-- Approving a contact request unlocks the relationship: the buyer may chat, and the owner sees the
-- buyer's real number. `hide_number` decides whether that approval *also* hands over the owner's raw
-- phone digits, or whether the owner would rather be reached in-app.
--
-- It is deliberately NOT a second gate. An owner who hides their number still approves requests, and
-- an approved buyer still gets a conversation; the only thing withheld is the ten digits. Modelling
-- it as another approval state would have made "approved" mean two different things depending on a
-- flag, which is how a trust model stops being explicable.
--
-- WHY IT LIVES ON `users` RATHER THAN ON `properties`
-- ---------------------------------------------------
-- The phone number is the owner's, not the listing's. A person who does not want their number handed
-- out does not want it handed out on their third listing either, and requiring them to re-set the
-- preference per listing would be a privacy control that fails open by default. Contact *approval*
-- is per-listing (each listing is a separate decision the owner makes); this is per-person, because
-- the thing it protects is per-person.
--
-- DEFAULT false, AND THAT IS THE SAFE DIRECTION HERE
-- --------------------------------------------------
-- Normally a privacy flag should default to the private value. Not this one: it defaults to the
-- behaviour every existing row already has, so this migration changes nothing for anybody. Defaulting
-- to `true` would silently withdraw numbers from buyers whose requests owners had already approved --
-- a change of meaning applied retroactively to a consent that was already given. Owners opt in.
--
-- Pairs with `verified_contact_only` above it, which is the same shape (owner preference, boolean,
-- NOT NULL, default false) and is the reason this column has no `CHECK`: there is nothing to check.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS hide_number boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.hide_number IS
    'Owner preference: keep my mobile masked even after I approve a contact request; reach me in-app instead.';
