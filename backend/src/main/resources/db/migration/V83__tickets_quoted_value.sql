-- V83: separate the price a customer accepted from the value ops book against a ticket (D3).
--
-- tickets.value is ops' estimate of what a job is worth, and TicketCreate deliberately refuses to
-- let a client set it, on the stated grounds that a client writing its own deal value is a client
-- writing the pipeline report. That reasoning is right and it is why the Move-in Pack booking had
-- nowhere to put its total: the pack has a published price the customer picked line by line and
-- accepted, and the lead was simply dropped rather than carrying it.
--
-- These are two different facts and collapsing them makes the pipeline unauditable in the direction
-- that matters. The quote is what the customer agreed to before anyone from ops saw the job; the
-- value is what the desk expects to bill after they have. When they disagree -- because the pack
-- was priced off a 2 BHK and the flat turned out to be a 4 BHK -- that disagreement is the useful
-- signal, and one column can only record it by destroying the number that made it visible.
--
-- Nullable, and no backfill from value. A backfill would be a guess that every existing ticket's
-- deal value was also quoted to the customer, which is exactly the conflation this column exists to
-- undo; the honest answer for a ticket raised before quotes existed is "nobody recorded one".
--
-- Whole rupees, which is what every other money column in this schema holds and what the contract
-- means by Money. The Ticket entity's Javadoc claimed tickets.value was paise; it is the only place
-- in the codebase that says so, nothing ever converted, and the ops board renders the column
-- straight through a rupee formatter -- so the claim was simply wrong, and survived only because no
-- ticket has ever carried a value. Corrected on the entity in this change.
--
-- The check is new rather than copied: tickets.value (V7) has no constraint at all, so a negative
-- deal value is storable today. That is defensible for value, which only ops write and which they
-- can correct on the board -- but quoted_value is written by a client, and an unconstrained numeric
-- a client controls is a number ops will eventually be asked to chase. Rejecting it here means the
-- refusal is the database's rather than a validation annotation somebody can forget to carry onto
-- the next DTO that writes this column. V7's omission is not retrofitted in this migration: adding
-- a constraint to an existing column can fail on data already in it, and that is a separate change
-- with its own backfill question.
alter table tickets
    add column quoted_value bigint;

alter table tickets
    add constraint tickets_quoted_value_check check (quoted_value is null or quoted_value >= 0);
