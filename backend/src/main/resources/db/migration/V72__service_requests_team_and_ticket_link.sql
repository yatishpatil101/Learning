-- V72: give a service request a desk, and let it name the ticket it mirrors (D44, D45).
--
-- ---------------------------------------------------------------------------------------------
-- D44 -- service requests were not team-scoped
-- ---------------------------------------------------------------------------------------------
-- `tickets` has carried a `team` since V7 and TicketService scopes the board by it: a staff member
-- sees their own desk, an admin sees everything, and a staffer with no desk sees nothing. Service
-- requests had no such column, so every ops user saw every request -- the legal desk read the
-- rental desk's rent agreements and the valuation desk's inspections.
--
-- The obvious shortcut is to infer the desk from `type` at read time. TicketService's own Javadoc
-- says why that is worse than the gap: the day somebody adds a service type and forgets the
-- inference, every request of it belongs to nobody and vanishes from every queue. Work that is
-- shown to too many people is a bad product; work that is silently shown to nobody is a lost
-- matter.
--
-- So the desk is a stored column with a CHECK that pairs it to the type, and the pairing is TOTAL
-- over the vocabulary V42 closed. Adding a sixth service type is now impossible without naming its
-- desk here -- the INSERT is refused by the database, which is the loud failure the alternative
-- could not give us. ServiceRequestTypes.teamFor is the same map in Java and throws on an unmapped
-- type for the same reason; this constraint is what holds when a future caller bypasses it.
--
-- Note which desk each type lands on. They are not a rename of each other: the priced
-- 'rent-agreement' desk is worked by the *rental* team (frontend /ops/rent-agreement is
-- TeamRoute team="rental"), and the other four happen to share their name with their team. The
-- 'loans' team has no service-request desk at all and will read an empty queue -- that is honest,
-- not a gap: nothing on the platform files a loan as a service request.
--
-- ---------------------------------------------------------------------------------------------
-- D45 -- a ticket and a service request did not mirror each other
-- ---------------------------------------------------------------------------------------------
-- The board (`tickets`) and the customer's workflow (`service_requests`) were two tables with no
-- link, so an operator working a request had to find the ticket it came from by hand -- by name, by
-- phone number, by memory.
--
-- The FK goes on `service_requests`, pointing UP at the ticket, because that is the order the two
-- are created in: Ticket's own Javadoc says "the board is where things arrive; the workflow is
-- where the ones that need paperwork go". A ticket exists first and most tickets never become a
-- request; a request that came off the board knows its ticket at INSERT time and never has to
-- update it afterwards. The reverse column would have to be written into an existing ticket row
-- after the fact -- a second write, on the older row, that can fail on its own.
--
-- The unique index is what makes it a *mirror* rather than a grouping: one ticket, at most one
-- request. Partial, so the overwhelming majority of rows (no ticket) are not in it at all.

-- 1. Pre-flight census, into the deploy log, so the effect on a real database is visible in the
--    output rather than inferred from the schema afterwards. Same shape as V42's (D156).
DO $$
DECLARE
    r RECORD;
    total bigint := 0;
BEGIN
    FOR r IN
        SELECT type AS t, count(*) AS n
        FROM service_requests
        GROUP BY type
        ORDER BY type
    LOOP
        total := total + r.n;
        RAISE NOTICE 'V72 pre-flight: service_requests.type = % -> % row(s), backfilling team = %',
            r.t, r.n,
            CASE r.t
                WHEN 'rent-agreement' THEN 'rental'
                WHEN 'legal'          THEN 'legal'
                WHEN 'interior'       THEN 'interior'
                WHEN 'packers'        THEN 'packers'
                WHEN 'valuation'      THEN 'valuation'
                ELSE '(NONE -- V42 CHECK should have made this impossible)'
            END;
    END LOOP;
    RAISE NOTICE 'V72 pre-flight: % service_requests row(s) in total', total;
END $$;

-- 2. The columns.
ALTER TABLE service_requests ADD COLUMN team      text;
ALTER TABLE service_requests ADD COLUMN ticket_id uuid REFERENCES tickets(id);

-- 3. Backfill the desk, one explicit statement per type.
--
-- Spelled out rather than written as a single CASE or a DEFAULT, so a reviewer reads five decisions
-- about real work rather than one expression. There is deliberately no catch-all branch: V42 closed
-- `type` to exactly these five, so a row that matches none of them is a schema defect, and the
-- NOT NULL in step 4 is what refuses to let it pass silently.
UPDATE service_requests SET team = 'rental'    WHERE type = 'rent-agreement';
UPDATE service_requests SET team = 'legal'     WHERE type = 'legal';
UPDATE service_requests SET team = 'interior'  WHERE type = 'interior';
UPDATE service_requests SET team = 'packers'   WHERE type = 'packers';
UPDATE service_requests SET team = 'valuation' WHERE type = 'valuation';

-- 4. Every request now has a desk, and only ever the desk its type belongs to.
--
-- If step 3 missed a row this ALTER fails and the deployment stops with the row still visible in
-- the table -- which is the point. A DEFAULT would have papered over it by routing an unknown type
-- to whichever desk was named in the default, and that is exactly the silent mis-routing the
-- register warned about.
ALTER TABLE service_requests ALTER COLUMN team SET NOT NULL;

ALTER TABLE service_requests
    ADD CONSTRAINT service_requests_type_team_check
    CHECK ((type, team) IN (
        ('rent-agreement', 'rental'),
        ('legal',          'legal'),
        ('interior',       'interior'),
        ('packers',        'packers'),
        ('valuation',      'valuation')
    ));

-- 5. Indexes.
--
-- (team, status) mirrors idx_tickets_team_status (V7): the ops queue is now filtered by desk first
-- and status second, and it is the only unbounded read on this table.
CREATE INDEX idx_service_requests_team_status ON service_requests (team, status);

-- Partial + unique: one ticket mirrors at most one request, and rows with no ticket -- almost all
-- of them -- stay out of the index entirely.
CREATE UNIQUE INDEX uq_service_requests_ticket
    ON service_requests (ticket_id) WHERE ticket_id IS NOT NULL;

COMMENT ON COLUMN service_requests.team IS
    'The ops desk that works this request (D44). Derived from `type` by a total map -- see the '
    'service_requests_type_team_check pair constraint and ServiceRequestTypes.teamFor. Never '
    'inferred at read time: an unmapped type must fail at INSERT, not disappear from every queue.';

COMMENT ON COLUMN service_requests.ticket_id IS
    'The ops board item this request came off, if any (D45). Nullable: a request raised straight '
    'from the customer wizard has no ticket. Unique where present -- one ticket, one request.';
