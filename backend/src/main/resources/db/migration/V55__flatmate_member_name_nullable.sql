-- V55 A flatmate member's name becomes nullable: "we have not been told" is a real answer (D118).
--
-- WHAT WAS WRONG
--
-- `flatmate_group_members.name` was declared NOT NULL (V27) and is fed from `users.name`, which is
-- nullable: an OTP sign-in creates an account with a verified mobile and nothing else, and the name
-- only appears if and when the person fills in their profile. Joining an open-policy group
-- therefore flushed a null into a NOT NULL column and 500'd -- for exactly the people who had just
-- signed up, the ones least equipped to read a server error.
--
-- That was patched at the write site in `FlatmateSupplyService.join` by substituting the literal
-- string "Member". It stopped the 500 and replaced it with something worse: a value that is stored
-- permanently, is indistinguishable from a person genuinely called Member, and is rendered to other
-- people as *that person's name*. The schema was insisting on a fact the application does not have,
-- so the application invented one. A constraint that can only be satisfied by inventing data is not
-- protecting the data.
--
-- WHY NULLABLE RATHER THAN A NAME AT SIGN-UP
--
-- Requiring a name at sign-up is the other way to make the constraint honest, and it is a product
-- decision with real cost: it adds a field to the one flow -- OTP -- whose whole point is that it
-- asks for nothing but a number. That call is deliberately left open. This migration only stops the
-- database asserting something the application cannot know.
--
-- NULL here reads as "this member has not told us their name yet", which is the literal truth and,
-- unlike "Member", is reversible: the moment the person fills in their profile there is nothing
-- wrong stored that has to be found and undone. The fallback moves to the display layer, where it
-- is a rendering choice rather than a claim -- the card draws a neutral avatar, and no one is shown
-- a name the platform made up.
--
-- EXISTING "Member" ROWS BECOME NULL
--
-- The only writer that could produce that literal is the join fallback above, and it always wrote
-- alongside a `user_id` (a join is by definition an account acting), so the update is narrowed to
-- rows that carry one. The other writer -- group creation -- takes the name from the request body,
-- where `FlatmateGroupCreate.name` is required, so it cannot have produced a null-substitute.
--
-- The residual false positive is a creator who typed "Member" as their own display name. Converting
-- their row costs them nothing observable: the display fallback renders the same neutral avatar
-- either way, so what they see does not change, while every genuinely fabricated row stops claiming
-- to be a name. Leaving the rows instead would preserve a lie the display layer has no way to
-- detect -- there is no column that says "this string was invented" -- which is the whole defect.
--
-- `initials` is cleared with it. It was derived from the fabricated name ("M"), so keeping it would
-- move the invention from the name column into the avatar and leave the card still showing it.

ALTER TABLE flatmate_group_members
    ALTER COLUMN name DROP NOT NULL;

UPDATE flatmate_group_members
   SET name     = NULL,
       initials = NULL
 WHERE name = 'Member'
   AND user_id IS NOT NULL;

COMMENT ON COLUMN flatmate_group_members.name IS
    'Display name, or NULL when the person has not given one -- an OTP account has no name until '
    'its profile is filled in (D118). NULL is not a missing value to be defaulted: the fallback is '
    'rendered at display time so nothing invented is ever stored.';
