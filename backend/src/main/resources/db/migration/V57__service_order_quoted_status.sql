-- V57 `service_orders.status` learns 'quoted', the state the order lifecycle turns on (D58).
--
-- WHAT WAS WRONG
--
-- `ServiceOrder.status` and `ServiceOrder.amount` could only be changed by hand-written SQL. The
-- API let a customer place an order and let ops read it, and then stopped: there was no operation
-- that quoted a job, booked it, worked it or closed it. Every order that ever completed did so
-- because somebody typed an UPDATE against production -- unaudited, unvalidated, and with no
-- notion of which moves are legal, so `completed` was one typo away from an order nobody had
-- surveyed.
--
-- WHY A NEW STATUS RATHER THAN A NEW COLUMN
--
-- The missing piece is not storage. `amount` has existed since V8 and has always been nullable,
-- precisely because an offering's price is a "from" and the real number is agreed after a survey.
-- What was missing is the *moment* that number is set. Without it, "priced" and "not yet priced"
-- were the same state as far as the column was concerned, and the only way to tell them apart was
-- to look at whether `amount` happened to be null -- a fact about a nullable column, not a
-- decision anybody recorded.
--
-- `quoted` makes that moment a state, and the application makes it the only transition that may
-- write `amount`. An order that has been priced and an order that has not are now different rows,
-- and a price change after the customer accepted is unreachable rather than merely discouraged.
--
-- WHY THE OTHER FIVE NAMES DO NOT CHANGE
--
-- The register describes the machine as pending -> quoted -> accepted -> in_progress -> completed.
-- Three of those names are not what this platform stores: `pending` is `placed`, `accepted` is
-- `scheduled`, `in_progress` is `in-progress`. Renaming them would mean rewriting live rows,
-- changing the published `ServiceOrder` enum in the contract, and breaking every client generated
-- from it -- for no behaviour a user could observe. The shape of the machine is what was
-- specified; the spellings are what was already shipped, and only the genuinely absent state is
-- added here.
--
-- WHAT THIS DOES NOT DO
--
-- No existing row moves. `placed` remains the default and remains what `createServiceOrder`
-- writes; the constraint is widened, never narrowed, so nothing that was valid before this
-- migration is invalid after it. The legal transitions between the six states are enforced in
-- `ServiceOrderStatuses`, not here: a CHECK can say which values exist, but it cannot see the row's
-- previous value and so cannot say which moves are allowed.

ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS service_orders_status_check;

ALTER TABLE service_orders ADD CONSTRAINT service_orders_status_check
    CHECK (status IN ('placed','quoted','scheduled','in-progress','completed','cancelled'));
