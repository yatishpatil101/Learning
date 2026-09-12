-- V07 DDL Service Requests, Ops Queues & Moderation: the internal ops surface and the customer
-- workflow that mirrors it.
--
-- Scope: `tickets` (the ops board) and `ticket_notes`; `service_requests` (the staff-driven
-- draft/decision workflow) with its `service_request_messages` conversation,
-- `service_request_timeline` audit strip, `service_request_identities` (the PAN/Aadhaar channel)
-- and `service_request_parties` (the co-fill counterparty); `reports` (trust & safety);
-- `internal_notes` (what the team knows about a case); and `lead_notes` (an owner's private
-- annotation on one lead).
--
-- Folded from the old chain: V7 (tickets, ticket_notes, service_requests, service_request_timeline
-- and reports only -- V7's referrals/reviews/share_flat_posts/documents statements belong to other
-- files), V18 (the `reports` parts only; its users/audit_log indexes belong to the identity file),
-- V21, V26 (the tickets/service_requests version columns only), V36, V39, V42, V43, V47, V72, V75,
-- V83, V85, V90, V106 (the `reports` vocabulary only; the five society content tables belong to the
-- society file), V107, V119, V123.
--
-- ORDERING: `tickets` and `ticket_notes` are created BEFORE `service_requests`, even though the
-- workflow reads more naturally the other way round, because `service_requests.ticket_id` carries a
-- foreign key to `tickets` (V72/D45) and the reference must resolve at CREATE time. The alternative
-- -- create `service_requests` first and add the column by ALTER -- is exactly the incremental
-- shape this consolidation exists to remove.
--
-- `properties` and `users` are created by earlier files; `documents.service_request_id` is declared
-- by the documents file, which therefore runs after this one.

-- ---------------------------------------------------------------------------------------------
-- Optimistic locking on the two ops work queues (tech debt D48).
--
-- The problem this closes: `tickets`, `service_requests` and `support_tickets` are the only tables
-- on the platform that two people legitimately edit at the same time. Every other write surface has
-- a single owner (their own listing, their own profile) or is append-only (transactions, events).
-- On these three, two staff members opening the same row and both saving meant the later save
-- silently discarded the earlier one -- a reassignment, a priority bump or a note, gone, with
-- nothing in the audit log to say it had ever been written.
--
-- The state machines already refuse illegal transitions, so the damage was bounded to losing a
-- field rather than corrupting the workflow. That is why this was recorded as Low and deferred, not
-- why it was acceptable: "you lose the edit you just made and are told it succeeded" is the worst
-- kind of small bug, because the person who lost the work is the last to find out.
--
-- Hibernate now includes `version` in the WHERE clause of every UPDATE against these tables and
-- increments it. The loser of a race matches zero rows, raises OptimisticLockingFailureException,
-- and gets a 409 telling them to reload -- see GlobalExceptionHandler.
--
-- Deliberately three tables and not all 37 audited ones. See VersionedEntity's Javadoc: versioning
-- `users` and `properties` would add a failure mode to every write path on the platform in exchange
-- for a concurrency problem those tables do not have.
--
-- `default 0` matters for the rows that already exist: @Version maps to a primitive long, so a null
-- would be read as a detached-entity marker and turn the next update into an insert attempt.
-- `not null` is what makes the lock unskippable -- a nullable version column is an optional lock.
-- (`support_tickets.version` carries the same column for the same reason; it is declared in
-- V11__DDL_engagement_billing.sql.)
-- ---------------------------------------------------------------------------------------------

-- tickets: team-scoped ops work item. requester/assignee resolve to users (nullable: ops may
-- create on behalf of a guest lead, so customer/mobile are also denormalized).
CREATE TABLE tickets (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject      text NOT NULL,
    team         text CHECK (team IN ('rental','legal','loans','interior','packers','valuation')),
    priority     text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
    status       text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','in-progress','waiting','resolved','closed')),
    property_id  uuid REFERENCES properties(id),
    requester_id uuid REFERENCES users(id),
    assignee_id  uuid REFERENCES users(id),
    service      text,
    customer     text,
    mobile       text CHECK (mobile ~ '^[6-9][0-9]{9}$'),
    value        bigint,
    detail       text,

    -- Optimistic-locking counter (D48). See the block above this table for why these two queues are
    -- versioned and nothing else is.
    version      bigint NOT NULL DEFAULT 0,

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
    -- ticket has ever carried a value. Corrected on the entity in that change.
    --
    -- The check is specific to this column: tickets.value has no constraint at all, so a negative
    -- deal value is storable. That is defensible for value, which only ops write and which they
    -- can correct on the board -- but quoted_value is written by a client, and an unconstrained numeric
    -- a client controls is a number ops will eventually be asked to chase. Rejecting it here means the
    -- refusal is the database's rather than a validation annotation somebody can forget to carry onto
    -- the next DTO that writes this column. The omission on `value` is deliberately not retrofitted:
    -- adding a constraint to an existing column can fail on data already in it, and that is a separate
    -- change with its own backfill question.
    quoted_value bigint,
    CONSTRAINT tickets_quoted_value_check CHECK (quoted_value is null or quoted_value >= 0),

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_team_status ON tickets (team, status);
CREATE INDEX idx_tickets_assignee    ON tickets (assignee_id);

-- GET /tickets is ordered newest-first in every variant. (team, status) serves the filter and
-- nothing else serves the sort, so every page would otherwise have been a filesort over the whole
-- queue.
CREATE INDEX idx_tickets_created ON tickets (created_at DESC);

-- V85 — index tickets by the number that raised them, newest first.
--
-- Why: D4 opens POST /service-waitlist to callers with no account, and the only thing standing
-- between the ops board and a script is a per-mobile budget — "at most N tickets from this number
-- in the last hour" — which TicketService.joinWaitlist answers with a count over exactly these two
-- columns. Without an index that count is a sequential scan of tickets, on an unauthenticated path,
-- once per request: the rate limiter would be the cheapest denial of service on the platform, and
-- it would get slower the more successfully it was attacked. The same index also serves the
-- duplicate check on (mobile, subject, status), which leads with mobile.
--
-- Why DESC on created_at: the budget query is "created_at > now() - 1 hour", a range on the second
-- column after an equality on the first, and the matching rows are the newest ones. Postgres can
-- read either direction, so this is a small ordering convenience rather than a correctness matter —
-- it matches idx_society_leads_mobile_created (V24), which exists for the identical query on the
-- identical shape of problem, and two indexes serving the same purpose should not look different.
--
-- Not unique, and not partial. Unique is plainly wrong — a number raising several tickets is the
-- normal case. Partial (WHERE mobile is not null) was tempted: most tickets today come from
-- authenticated flows and carry a mobile anyway, and the column is nullable only because ops are
-- allowed to raise a ticket for a guest. The saving would be near nothing on a table this shape, and a
-- partial index is a footgun for the next person writing a query that does not repeat the predicate.
CREATE INDEX idx_tickets_mobile_created ON tickets (mobile, created_at DESC);

COMMENT ON COLUMN tickets.version IS
    'Optimistic-locking counter (D48). Maintained by Hibernate; raw SQL updates bypass it.';

-- Internal staff notes on a ticket (Ticket.notes[]). Never deleted -- audit trail.
CREATE TABLE ticket_notes (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES tickets(id),
    by        text,
    text      text NOT NULL,
    at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_notes_ticket ON ticket_notes (ticket_id, at);

-- service_requests: staff-driven draft/decision workflow (rent agreement, valuation, ...).
CREATE TABLE service_requests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id uuid REFERENCES users(id),

    -- V42: close the service_requests.type vocabulary.
    --
    -- `type` was free text (`@NotBlank @Size(64)` and nothing else), and the price of a request is
    -- decided by matching that string exactly: only 'rent-agreement' is charged the platform fee plus
    -- stamp duty plus registration plus GST, and every other value falls through to the free desk that
    -- goes straight into the ops queue. So 'Rent-Agreement', 'rent_agreement', or the frontend's own
    -- 'rental' did not fail -- they created an *unpaid* rent agreement and put ops to work drafting a
    -- statutory document nobody had been billed for. A payment gate you opt into by spelling a string
    -- correctly is not a gate.
    --
    -- ServiceRequestTypes.isKnown is the 400; this CHECK is the enforcement, in the same relationship
    -- the status column has always had. Both exist because a service can be bypassed by a future
    -- caller and a constraint cannot.
    --
    -- EXISTING ROWS (D156)
    -- --------------------
    -- (History, for databases built by the old chain. A fresh database has no rows to convert.)
    --
    -- The first draft of that migration swept *everything* outside the vocabulary into 'legal' and said
    -- nothing about it. That was wrong twice over. 'rental' is the value the frontend's mock seam had
    -- been writing all along -- it is the alias serviceRequestMapper.js put on the rent-agreement desk
    -- -- so the rows most likely to exist on a real database were exactly the ones being relabelled,
    -- and relabelled to the wrong desk: a rent agreement is the one *priced* service, and calling it
    -- 'legal' turns a paid job into a free one. And because the original string was overwritten in
    -- place, nobody could tell afterwards whether a 'legal' row had always been legal.
    --
    -- So the migration did three things before it constrained anything:
    --
    --   1. counted the rows per distinct `type` into the deploy log, so the effect on a real database
    --      was visible in the output rather than inferred from the schema afterwards;
    --   2. copied the pre-migration value into `details._migratedFromType` on every row it was about
    --      to rewrite, so the evidence survived the rewrite and a row could be put back by hand;
    --   3. mapped 'rental' explicitly onto 'rent-agreement' -- the desk it always meant -- and only
    --      then landed the genuinely unrecognisable remainder on 'legal'.
    --
    -- 'legal' was the landing spot for that remainder, for the reason it always was: it is free, so
    -- that could not invent a charge, and it is a real desk, so the row stayed workable. A request is
    -- somebody's open matter, and a migration is the wrong place to decide it never happened.
    --
    -- Note what was *not* changed. A 'rental' row moved to 'rent-agreement' kept whatever `amount`,
    -- `status` and `payment_ref` it already had; that migration did not retro-bill anyone and did not
    -- push anything back behind the paid gate. It only made the desk name honest so the vocabulary
    -- could be closed behind it.
    type         text NOT NULL
                   CONSTRAINT service_requests_type_check
                   CHECK (type IN ('rent-agreement', 'legal', 'interior', 'packers', 'valuation')),

    -- The status vocabulary, in one piece.
    --
    -- V39 — the paid gate in front of the rent-agreement service request.
    --
    -- A rent agreement (Leave & License) is the one service desk that charges before ops touches it:
    -- the platform fee plus statutory stamp duty and registration are collected up front, and only a
    -- settled payment lets the request enter the staff queue. Everything the workflow needs already
    -- existed (the maker-checker state machine, the messages thread, the Cashfree payment webhook);
    -- what was missing was the one state that machine did not have — the request that has been filed
    -- but not yet paid for — and the two columns that tie it to a gateway order.
    --
    -- Why a new status rather than reusing `new`. `new` means "in the queue, waiting for a staffer".
    -- A request nobody has paid for is not that: it must be invisible to ops until the money lands, or
    -- staff would start drafting agreements that were never bought. `awaiting-payment` is that pre-queue
    -- state, and it is reachable only at creation and left only by the payment webhook. It sits at the
    -- front of the list, where the lifecycle now begins for a priced request.
    --
    -- V75 — `changes-requested`.
    --
    -- The original maker-checker offered approve and reject, and reject moved the request back to
    -- `in-progress`. That reads as "ops is working on it", which is indistinguishable from the state
    -- the request was in before the draft was ever shared — so from the read shape alone a customer
    -- who had rejected a draft could not tell that they had, and neither could the operator picking
    -- the request up. The rejection was recorded in the audit log and nowhere a person looks.
    --
    -- The constraint is auto-named service_requests_status_check. The old chain dropped and re-added
    -- it twice to reach this list (V39, then V75); see V23 for the same dance on subscriptions/boosts.
    status       text NOT NULL DEFAULT 'new'
                   CHECK (status IN ('awaiting-payment', 'new', 'assigned', 'in-progress', 'draft-shared',
                                     'changes-requested', 'approved', 'completed', 'cancelled')),

    property_id  uuid REFERENCES properties(id),
    assignee_id  uuid REFERENCES users(id),

    -- V36 — `details` is jsonb: the request's fields as a structured object, readable back
    -- (tech-debt D119, closed).
    --
    -- WHAT IT MEANS
    -- -------------
    -- A customer fills a service form — property, rent, deposit, scope — and that is the request. The
    -- column stored it as a flat `text` blob: `ServiceRequestCreate.details` was a string, the seam
    -- flattened the object to `Label: value` lines on the way out, and `ServiceRequestDto` carried no
    -- `details` field at all. So the fields the user typed landed (ops could read them) but could not be
    -- read back through the API — the tracker's detail line was mock-only. Widening the column to
    -- `jsonb` lets the object round-trip: the mapper projects it onto `ServiceRequestDto.details` and
    -- the client reads the same shape it sent.
    --
    -- CONVERTING EXISTING ROWS
    -- ------------------------
    -- (History, for databases built by the old chain. A fresh database starts as jsonb.)
    -- The old values were plain `Label: value` text, not JSON, so a bare `::jsonb` cast would fail. Each
    -- non-empty row was wrapped under a single `note` key — a valid object that preserves what was
    -- written without pretending to re-parse the label lines back into fields. Empty/blank rows became
    -- SQL NULL (a request with no structured detail), matching the nullable column.
    details      jsonb,

    -- Optimistic-locking counter (D48). See the block above CREATE TABLE tickets for why these two
    -- queues are versioned and nothing else is.
    version      bigint NOT NULL DEFAULT 0,

    -- What the customer was charged, in whole rupees (Money is int64). Null for a free service desk
    -- (a legal opinion is not priced); set once, at creation, from the published rent fee breakdown.
    amount       bigint,

    -- The Cashfree order id, and how the payment webhook finds this row again. Unique, partial: many
    -- requests carry no order (the free desks, and every request created before the gate existed), and a
    -- null must never collide with another null — the same shape subscriptions and boosts use (V23).
    payment_ref  text,

    -- V72/D44 -- service requests are team-scoped.
    --
    -- `tickets` has carried a `team` from the start and TicketService scopes the board by it: a staff
    -- member sees their own desk, an admin sees everything, and a staffer with no desk sees nothing.
    -- Service requests had no such column, so every ops user saw every request -- the legal desk read
    -- the rental desk's rent agreements and the valuation desk's inspections.
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
    -- NOT NULL and no DEFAULT: every request has a desk, and only ever the desk its type belongs to. A
    -- DEFAULT would paper over a missing value by routing an unknown type to whichever desk was named
    -- in the default, and that is exactly the silent mis-routing the register warned about.
    team         text NOT NULL,

    -- V72/D45 -- a ticket and a service request mirror each other.
    --
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
    -- The unique index below is what makes it a *mirror* rather than a grouping: one ticket, at most one
    -- request. Partial, so the overwhelming majority of rows (no ticket) are not in it at all.
    ticket_id    uuid REFERENCES tickets(id),

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT service_requests_type_team_check
        CHECK ((type, team) IN (
            ('rent-agreement', 'rental'),
            ('legal',          'legal'),
            ('interior',       'interior'),
            ('packers',        'packers'),
            ('valuation',      'valuation')
        ))
);

-- The staff queue's filter.
CREATE INDEX idx_service_requests_status ON service_requests (status);

-- GET /service-requests for a customer is "my requests, newest first"; `status` alone is the staff
-- queue's filter and no use at all to the owner of the row.
CREATE INDEX idx_service_requests_requester
    ON service_requests (requester_id, created_at DESC);

-- The staff queue filters on type (the service desk a request belongs to) and orders newest-first.
CREATE INDEX idx_service_requests_type_created
    ON service_requests (type, created_at DESC);

-- (team, status) mirrors idx_tickets_team_status: the ops queue is filtered by desk first and status
-- second, and it is the only unbounded read on this table.
CREATE INDEX idx_service_requests_team_status ON service_requests (team, status);

CREATE UNIQUE INDEX uq_service_requests_payment_ref
    ON service_requests (payment_ref) WHERE payment_ref IS NOT NULL;

-- Partial + unique: one ticket mirrors at most one request, and rows with no ticket -- almost all
-- of them -- stay out of the index entirely.
CREATE UNIQUE INDEX uq_service_requests_ticket
    ON service_requests (ticket_id) WHERE ticket_id IS NOT NULL;

-- V43 — the unpaid-order cap, enforced by the database (D153).
--
-- WHAT WAS WRONG
-- --------------
-- `ServiceRequestService.create` counts the caller's open `awaiting-payment` rows for a desk and
-- then inserts one. Between the count and the insert there is nothing: the transaction runs at
-- READ COMMITTED, the count takes no lock, and the endpoint has no throttle in front of it (D2).
-- N concurrent POSTs therefore all read zero, all insert, and all open a real Cashfree order --
-- which is precisely the unbounded-orders outcome the cap was added to prevent. The check held
-- against the accident it was written for (a double click, a page reload) and failed against the
-- attack, and only one of those two is why the cap exists.
--
-- A count-then-insert cannot be fixed by moving the count: any read-then-write over rows that do
-- not exist yet has this hole, because there is no row to lock. What closes it is a uniqueness
-- constraint, which the database evaluates at write time and which two concurrent writers cannot
-- both satisfy -- the second blocks on the first's index entry and is refused when it commits.
--
-- WHY THIS SHAPE
-- --------------
-- Partial, on (requester_id, type) WHERE status = 'awaiting-payment', because the invariant is
-- exactly "one unpaid order per person per desk" and nothing wider. Once a request is paid for
-- (`new`), cancelled, or completed it leaves the index entirely, so a customer may raise as many
-- rent agreements over time as they like -- the cap is on *outstanding* orders, not on volume, and
-- not a rate limit. It mirrors `uq_service_requests_payment_ref` above, which is partial for the
-- same reason: the rows outside the predicate are not in conflict with anything.
--
-- The unique index is a backstop, not the user-facing rule. The count in `create` stays as the fast
-- path because it produces the better message on the ordinary double click, and the service
-- translates this constraint's violation into the same 409 with the same text, so the API contract
-- does not change -- a caller cannot tell which of the two refused them, and should not need to.
--
-- The index matches MAX_OPEN_UNPAID_PER_TYPE = 1 exactly. If that constant is ever raised, this
-- index must be replaced (a unique index cannot express "at most N"); the constant's javadoc says
-- so, because the failure mode otherwise is the service allowing a second order that the database
-- then refuses with a message about the first.
--
-- BACKFILL
-- --------
-- None is written. `awaiting-payment` is left by the payment webhook within the life of a checkout,
-- and the count-based cap has been in front of the endpoint since; a pre-existing duplicate pair
-- would be a row that was already a defect. Should one exist, this CREATE INDEX fails loudly at
-- deploy time with the offending pair named -- which is the right outcome, because silently
-- choosing which of two live gateway orders to disown is not a decision a migration may make.
CREATE UNIQUE INDEX uq_service_requests_open_unpaid
    ON service_requests (requester_id, type)
    WHERE status = 'awaiting-payment';

COMMENT ON COLUMN service_requests.version IS
    'Optimistic-locking counter (D48). Maintained by Hibernate; raw SQL updates bypass it.';

COMMENT ON COLUMN service_requests.team IS
    'The ops desk that works this request (D44). Derived from `type` by a total map -- see the '
    'service_requests_type_team_check pair constraint and ServiceRequestTypes.teamFor. Never '
    'inferred at read time: an unmapped type must fail at INSERT, not disappear from every queue.';

COMMENT ON COLUMN service_requests.ticket_id IS
    'The ops board item this request came off, if any (D45). Nullable: a request raised straight '
    'from the customer wizard has no ticket. Unique where present -- one ticket, one request.';

-- V21 Service requests & the staff ticket queue (slice 11). The original aggregate left the
-- conversation out of it and indexed neither list the contract actually asks for.

-- ServiceRequest.messages[] had nowhere to live. The aggregate had a timeline (system events,
-- `event`/`by`) but no chat, and the two are not the same thing: a timeline entry is written by the
-- server to say what happened, a message is written by a person to say something. Folding messages
-- into the timeline would have made "staff said the deed is missing" indistinguishable from
-- "status changed to in-progress", and would have put customer free text in an audit trail.
-- Shaped after support_ticket_messages (V8) so the two conversation surfaces read the same.
-- No `attachments` column, though MessageCreate documents the field: the Message response schema
-- has nowhere to render one, and this aggregate already has a real upload surface in
-- POST /service-requests/{id}/docs. A column nothing can write and nothing can read back is not
-- storage, it is a promise. The field is accepted and dropped, exactly as the verification thread
-- does, and that is written down at the controller rather than implied by a dead column.
CREATE TABLE service_request_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  uuid NOT NULL REFERENCES service_requests(id),
    author_id   uuid REFERENCES users(id),
    author_role text CHECK (author_role IN ('buyer','owner','staff','admin')),
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    -- V75 — the read receipt.
    --
    -- `markServiceRequestRead` was a client-side no-op: the frontend computed an unread count from a
    -- browser bucket, so the badge cleared on the device that opened the thread and stayed lit on every
    -- other one. A nullable timestamp rather than a boolean because "when" is free here and answers the
    -- support question the flag cannot ("they saw it on Tuesday and still have not replied").
    --
    -- On the message rather than in a per-reader table: this thread has exactly two sides, a customer
    -- and whichever operator is on the desk, and a receipt per reader would model an audience that does
    -- not exist. `read_at` means "seen by the side that did not write it", which is the only reading
    -- either side asks for.
    read_at     timestamptz
);
CREATE INDEX idx_service_request_messages_request
    ON service_request_messages (request_id, created_at);

-- Partial: the sweep only ever touches unread rows on one request, and the index that serves it
-- should not carry the read ones it will never look at again.
CREATE INDEX idx_service_request_messages_unread
    ON service_request_messages (request_id)
    WHERE read_at IS NULL;

CREATE TABLE service_request_timeline (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES service_requests(id),
    at         timestamptz NOT NULL DEFAULT now(),
    event      text NOT NULL,
    by         text
);
CREATE INDEX idx_service_timeline_request ON service_request_timeline (request_id, at);

-- V47 service_request_identities — the narrow channel that carries PAN and Aadhaar to the one
-- operator drafting the agreement, and to nobody else (D151).
--
-- WHY THIS TABLE EXISTS AT ALL
-- ---------------------------
-- A Leave & License agreement names each party by PAN and Aadhaar; the drafting desk cannot produce
-- one without them. They used to arrive inside `service_requests.details`, which is plaintext jsonb
-- echoed verbatim by ServiceRequestMapper on *every* staff read including the paged ops queue -- so
-- the first page of that queue was a bulk identity dump. The wizard now redacts them client-side and
-- `ServiceRequestService.rejectIdentityNumbers` refuses them server-side, and both of those stay.
-- This is the deliberate replacement channel: same numbers, one reader, every read recorded.
--
-- WHY NOT THE DOCUMENT VAULT, WHICH IS WHAT THE REGISTER FIRST PROPOSED
-- --------------------------------------------------------------------
-- The vault's read model is `FileStorage.signedDownloadUrl(key)` -- a URL that carries its own
-- authority. It cannot be pointed at one operator, it cannot refuse anybody, and following it never
-- reaches our server, so no read of it can be recorded. "Only the assigned operator sees them" and
-- "every access is audited" are both unexpressible there, and they are the whole requirement.
-- Two further facts settled it: `DocumentUploads.validate` accepts PDF/JPEG/PNG/HEIC/WEBP proved by
-- magic bytes, so a set of numbers is not a thing the vault can hold without weakening the allowlist
-- that keeps non-documents out of it; and `DocumentService.delete` deliberately leaves the stored
-- object behind, which is a defensible trade for a sale deed and an indefensible one for an Aadhaar
-- number (Aadhaar Act s.29 wants retention deliberate, minimal and reversible). A vault artefact
-- would have been a permanent, un-revocable, un-auditable bearer copy of the most sensitive field
-- the platform touches. A row we can authorise, log and blank is strictly better on all three.
--
-- ONE ROW PER PARTY, NOT ONE JSON BLOB PER REQUEST
-- ------------------------------------------------
-- The agreement names an owner and one-to-many tenants, and the desk works party by party. Rows also
-- make the purge below a plain UPDATE over columns rather than a rewrite of a document, and make
-- "how many parties were recorded" answerable without reading the numbers themselves -- which is
-- what the audit metadata records.
--
-- BOTH NUMBERS ARE NULLABLE
-- -------------------------
-- A tenant may genuinely have no PAN. The service refuses a party carrying neither, so a row always
-- says something; it does not require it to say both.
--
-- RETENTION
-- ---------
-- `purged_at` is the point of the table as much as the numbers are. When a request reaches a
-- terminal status -- completed, because the registered document now carries the numbers, or
-- cancelled, because nothing will be drafted -- the service blanks `pan` and `aadhaar` and stamps
-- this column. The row survives so that "recorded, and since purged" stays distinguishable from
-- "never recorded"; `party_name` survives with it because a name is not the thing being minimised
-- and a purged row with no name at all reads like corruption. There is no other retention window,
-- deliberately: the numbers exist for exactly as long as somebody is drafting from them.
--
-- ON DELETE CASCADE, unlike most foreign keys here: a service request is never hard-deleted today,
-- but if one ever is, an orphaned Aadhaar number outliving the matter it was collected for is the
-- one outcome this table must not permit.
CREATE TABLE service_request_identities (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    party_role         text NOT NULL,                     -- 'owner' | 'tenant'
    party_index        integer NOT NULL DEFAULT 0,        -- 0 for the owner; 0..n across tenants
    party_name         text,                              -- survives the purge; the numbers do not
    pan                text,                              -- ABCDE1234F, or NULL
    aadhaar            text,                              -- 12 digits, or NULL
    created_at         timestamptz NOT NULL DEFAULT now(),
    purged_at          timestamptz,                       -- set when the numbers were blanked
    CONSTRAINT service_request_identities_role_check
        CHECK (party_role IN ('owner', 'tenant')),
    CONSTRAINT service_request_identities_index_check
        CHECK (party_index >= 0),
    -- The wizard resubmits the whole set when the customer corrects a typo, so the service replaces
    -- rather than appends. This is what makes "replace" mean one row per party rather than a growing
    -- pile of half-corrected duplicates the desk would have to choose between.
    CONSTRAINT uq_service_request_identity_party
        UNIQUE (service_request_id, party_role, party_index)
);

-- The only read is "the parties on this request, in drafting order". There is no cross-request
-- query and there must never be one: a query that can return identity numbers for more than one
-- matter at a time is the ops-queue leak this table was built to replace.
CREATE INDEX idx_service_request_identities_request
    ON service_request_identities (service_request_id, party_role, party_index);

COMMENT ON TABLE service_request_identities IS
    'PAN/Aadhaar for the parties named in a service request (D151). Written by the requester, '
    'readable only by the staff member the request is assigned to, audited on every read, and '
    'blanked when the request reaches a terminal status. Never projected onto ServiceRequestDto '
    'and never included in any list response.';

COMMENT ON COLUMN service_request_identities.purged_at IS
    'When pan/aadhaar were blanked because the request completed or was cancelled. NULL means the '
    'numbers are still held.';

-- ---------------------------------------------------------------------------------------------
-- V75 — the two-sided rent agreement: a named counterparty (D121).
--
-- The service-request aggregate was modelled as one customer's paperwork, and a Leave & License
-- agreement is two people's. The frontend mock had worked around that in localStorage
-- (serviceFlow.createCoFill / listForParty / markRead), so the shapes existed in the product and
-- nowhere in the database. (The other two halves of that defect are `changes-requested` on
-- service_requests.status and `service_request_messages.read_at`, both above.)
--
-- A rent agreement is co-filled: the owner supplies their half, the tenant supplies theirs, and
-- both halves have to land on one request or the draft cannot be produced. Until this table every
-- request was scoped to `requester_id` alone, so the second party had no row anywhere and therefore
-- no way to fetch, let alone contribute to, the matter they are a party to.
--
-- **Keyed on `user_id`, not on a mobile number.** The mock addressed its invite to the other
-- party's mobile and let anyone holding the generated invite id open it — a bearer token in a
-- WhatsApp link, sent over a channel we do not control, granting sight of a rent, a deposit and two
-- sets of identity documents. Storing the mobile here would have reproduced that: the row would be
-- a claim about a person nobody had authenticated, and matching it later would mean trusting
-- whoever ends up registering that number. The invite therefore resolves the mobile to an existing
-- account at the moment it is written and stores the account. The number itself is never persisted,
-- which is also why this table needs no entry in the erasure classification — it holds no personal
-- data, only two foreign keys to the table that does.
--
-- The cost of that choice is real and deliberate: you cannot invite somebody who has not signed up.
-- That is the correct trade. The counterparty has to sign in to fill their half and to upload their
-- Aadhaar regardless, so the account is required a moment later in every case; requiring it a
-- moment earlier is what removes the unauthenticated window.
--
-- ---------------------------------------------------------------------------------------------
-- V107 — inviting the other side before they have an account: the pending co-fill party (D121).
--
-- V75 built this table around the deliberate refusal stated immediately above, in as many words:
-- "you cannot invite somebody who has not signed up. That is the correct trade." Six weeks of the
-- flow existing says it is not. The owner raising a Leave & License agreement is, overwhelmingly,
-- the party who has heard of Draazy; the tenant is somebody they met last week. Requiring the
-- tenant to have registered *before* the owner can even name them puts a third party's sign-up in
-- the middle of the owner's checkout, and the owner is the one who abandons.
--
-- So the invitation may be addressed to a mobile number that resolves to nobody yet. What that does
-- not do is give back the hole V75 closed, and the difference is worth being precise about, because
-- the two designs look similar and are not.
--
-- V75's objections, and what answers them here
-- --------------------------------------------
-- (1) "The row would be a claim about a person nobody had authenticated, and matching it later
--     would mean trusting whoever ends up registering that number."
--
--     It does mean exactly that, and that is the same trust the whole product already rests on:
--     registration is OTP-verified against the number, and every subsequent sign-in proves control
--     of it again. Whoever passes that check *is* the account for that number as far as any part of
--     this system can tell — an invite that resolved the mobile eagerly (V75) and one that resolves
--     it lazily (here) are trusting the identical proof, one of them earlier. What V75 was really
--     protecting against was the mock's *bearer token*: a random invite id in a WhatsApp link that
--     granted sight of the matter to anyone holding the message, authenticated or not. That is
--     still gone and stays gone. There is no token here; there is a number, and the only way to
--     turn it into sight of the agreement is to hold an account for it and then accept.
--
--     The residual risk V75 did not have is number *recycling* — TRAI releases a disconnected
--     mobile back into the pool after 90 days, so a year-old unclaimed invite could be claimed by a
--     genuine stranger. That is what `invite_expires_at` is for, below.
--
-- (2) "This table needs no entry in the erasure classification — it holds no personal data, only
--     two foreign keys to the table that does."
--
--     True until the pending invite existed and false after it: `mobile` is personal data about
--     someone who, by construction, has no account and therefore no way to ask us for anything. Two
--     mechanisms answer that and they are both required.
--
--       * The column is *transient by design*. It exists only while the row is pending. The moment
--         the invitee registers and the row is claimed, `user_id` is filled and `mobile` is set
--         back to NULL — enforced by the `addressee` CHECK below, which permits exactly one of the
--         two to be present. A claimed row is byte-for-byte the V75 row, so the steady state of
--         this table still holds no personal data. Only the waiting room does.
--       * While it is pending it is reachable by erasure and bounded by retention.
--         `ErasureService` deletes pending rows keyed on the subject's old mobile, the same idiom
--         it already uses for `otp_codes` — which is the case that matters, because somebody
--         invited-then-registered-then-erased is precisely the person whose number is sitting here.
--         `CoFillInviteRetentionSweep` deletes the rest on expiry.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE service_request_parties (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  uuid NOT NULL REFERENCES service_requests(id),

    -- The addressee: an account, or a number waiting to become one. Nullable since V107 --
    -- see the `addressee` CHECK below.
    user_id     uuid REFERENCES users(id),
    mobile      text CHECK (mobile IS NULL OR mobile ~ '^[6-9][0-9]{9}$'),

    -- Which side of the agreement they are. Paired to the request, not to the user: the same
    -- person is an owner on one matter and a tenant on another.
    role        text NOT NULL CHECK (role IN ('owner', 'tenant')),
    -- `invited` sees nothing but the invitation itself; only `accepted` widens the request's read
    -- scope. See CoFillParties for why the pending state deliberately reveals no request content:
    -- a mistyped mobile that resolves to a real stranger must not hand them the paperwork while
    -- the requester is still working out that they got the number wrong.
    status      text NOT NULL DEFAULT 'invited'
                CHECK (status IN ('invited', 'accepted', 'declined')),
    invited_by  uuid NOT NULL REFERENCES users(id),

    -- The expiry, which only pending rows have.
    --
    -- A claimed invitation is a party to a matter and lives as long as the matter does. An unclaimed
    -- one is a phone number we are holding on the strength of somebody else's typing, and it gets a
    -- clock. Ninety days is the retention window used for the other "personal data we were not given
    -- directly" case (V64's referral signals) and it comfortably outlasts the days-to-weeks in which a
    -- real agreement is actually filled.
    --
    -- Not merely tidiness: it is the second half of the recycling answer above. An invite that has been
    -- sitting unclaimed long enough for the number to have changed hands is deleted before it can be
    -- claimed by whoever holds it next.
    invite_expires_at timestamptz,

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    -- Exactly one of the two, never both and never neither. This is the constraint that makes the
    -- claim a *move* rather than a copy: filling `user_id` without clearing `mobile` is rejected by the
    -- database, so no code path can leave the number behind once it has served its purpose. It is also
    -- what keeps the erasure story short — there is no such thing as a claimed row that still holds a
    -- number, so erasure never has to reason about one.
    CONSTRAINT service_request_parties_addressee_check
        CHECK ((user_id IS NULL) <> (mobile IS NULL)),

    -- A pending row is always `invited` and always has a clock; a claimed row has neither concern.
    -- Stated as a constraint rather than left to the service because the sweep's correctness depends on
    -- it: a pending row with a NULL expiry would be invisible to `... WHERE invite_expires_at < now()`
    -- and would sit here forever, which is the one outcome this whole section exists to prevent.
    CONSTRAINT service_request_parties_pending_check
        CHECK (user_id IS NOT NULL
               OR (status = 'invited' AND invite_expires_at IS NOT NULL))
);

-- One party per side. The constraint that makes the aggregate two-sided rather than n-sided, and
-- the reason a second invite to the same role is a 409 rather than a silent second row that would
-- leave two people each believing they were the tenant.
CREATE UNIQUE INDEX uq_service_request_parties_role
    ON service_request_parties (request_id, role);

-- And one row per person per request, so inviting the same account as both sides — or twice as the
-- same side after a decline — cannot produce a duplicate.
--
-- V107's re-examination under NULLs. `uq_service_request_parties_role (request_id, role)` is
-- unaffected by a nullable user_id and still does the load-bearing work: two rows per request
-- maximum, one per side, whether or not either is claimed. It is why no extra guard is needed to
-- stop a request accumulating pending invitations.
--
-- This index, however, now admits NULLs, and PostgreSQL treats distinct NULLs as distinct — so it
-- no longer constrains pending rows. That is harmless here only because the role index already caps
-- the table at two rows per request; it is called out because the guarantee this index appears to
-- give ("one row per person per request") is, for pending rows, now given by something else. The
-- claim path re-checks it explicitly before filling `user_id`, since that is the moment a NULL
-- becomes a value and the index starts applying again.
CREATE UNIQUE INDEX uq_service_request_parties_user
    ON service_request_parties (request_id, user_id);

-- "What am I invited to", and the participant test that every read of a request now runs.
CREATE INDEX idx_service_request_parties_user
    ON service_request_parties (user_id, status);

-- Partial, and on the pending rows only. The claim runs on every customer read of the service-request
-- list, so it has to be cheap on the overwhelmingly common answer, which is "nothing pending for
-- this number". Once claimed, a row leaves this index for good — the index is the waiting room, and
-- it is meant to stay small.
CREATE INDEX idx_service_request_parties_pending
    ON service_request_parties (mobile)
    WHERE mobile IS NOT NULL;

-- The sweep's access path, likewise partial: expired rows are pending rows by definition.
CREATE INDEX idx_service_request_parties_expiry
    ON service_request_parties (invite_expires_at)
    WHERE invite_expires_at IS NOT NULL;

COMMENT ON COLUMN service_request_parties.mobile IS
    'PERSONAL DATA, transient. The invited counterparty''s number, held only until they register and '
    'the row is claimed, at which point user_id is filled and this is set back to NULL. Erased by '
    'ErasureService keyed on the old mobile; expired by CoFillInviteRetentionSweep after 90 days.';

COMMENT ON COLUMN service_request_parties.invite_expires_at IS
    'When an unclaimed invitation is deleted. NULL once claimed. Bounds how long a mobile belonging '
    'to a non-user is retained, and stops a recycled number being claimed by its next holder.';

COMMENT ON COLUMN service_request_parties.user_id IS
    'The party, once they hold an account. NULL while the invitation is still addressed to a mobile.';

-- ---------------------------------------------------------------------------------------------
-- reports: trust & safety (schema: Report). reason kept free-text; see the COMMENT ON below for why
-- a canonical reason enum (reconciliation #7) was considered and refused.
--
-- V106: society hub content becomes reportable, and reportable content becomes removable.
--
-- The society hub carries six kinds of user-written content -- recommendations,
-- replies, questions, answers, noticeboard items and reviews -- and offers a
-- "Report" control on every one of them. That control wrote to `dzSocietyReports`
-- in the reporting member's own browser, and the ops queue that was supposed to
-- read it read the *moderator's* browser. So a defamatory recommendation naming a
-- real tradesman with his real phone number could be reported by fifty neighbours
-- and no moderator would ever see one of those reports. The platform-wide
-- `reports` table has worked properly since V18 -- it simply did not admit that
-- society content existed: `reports_target_type_check` allowed exactly
-- 'property', 'user', 'review' and 'post'.
--
-- Two changes, and they have to arrive together.
--
-- 1. The CHECK constraint learns the five society kinds -- that is the vocabulary
--    below. Five, not one 'society_content', because `target_id` means nothing
--    without knowing which table it indexes -- a moderator who upholds a complaint
--    has to be able to remove *that row*, and five tables means five lookups
--    otherwise, with the id ambiguity that implies. `review` is deliberately NOT
--    duplicated here: a society review is already reportable as 'review' and
--    already has its own takedown at PATCH /reviews/{id}/status. A second
--    vocabulary word for the same thing would split the queue in half.
--
-- 2. The five content tables learn how to be taken down, via `removed_at` /
--    `removed_by` -- declared in the society file, since those tables live there.
--    Before that there was no way: the author's own DELETE hard-deletes the row,
--    which is right for an author changing their mind and wrong for moderation --
--    it destroys the evidence the complaint was about, so an appeal, a
--    repeat-offender check and a police request all have nothing to read.
--    `removed_at` / `removed_by` keep the row and take it off the public site.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type text NOT NULL
                  CONSTRAINT reports_target_type_check
                  CHECK (target_type IN ('property', 'user', 'review', 'post',
                                         'society_contribution', 'society_reply',
                                         'society_question', 'society_answer', 'society_board')),
    target_id   text NOT NULL,
    reporter_id uuid REFERENCES users(id),
    reason      text NOT NULL,
    details     text,
    status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','actioned','dismissed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_target ON reports (target_type, target_id);

-- ---------------------------------------------------------------------------
-- The abuse queue (V18)
-- ---------------------------------------------------------------------------
--
-- api-standards.md §5 requires every sort be index-backed, and the back-office reads are exactly the
-- ones that get slow first: they are unfiltered by user, so they scan the whole table.
--
-- A bare idx_reports_status (status) and idx_reports_target (target_type, target_id) each answer a
-- filter and neither answers the ordering, so `GET /reports` -- "the open ones, newest first" --
-- would find the matching rows by index and then sort every one of them, on every page.
--
-- The composite below makes a bare (status) index redundant (it is a strict prefix of this key), so
-- no such index is created rather than one being left to be maintained on every write for nothing.
-- (The old chain shipped idx_reports_status in V7 and dropped it in V18; the end state is this one.)
CREATE INDEX idx_reports_status_created ON reports (status, created_at DESC);

-- The unfiltered queue read ("everything, newest first") has no status predicate to lead with, so
-- the composite above cannot serve it.
CREATE INDEX idx_reports_created ON reports (created_at DESC);

-- One open report per person per target. Without this, a tap that double-fires -- or anyone who
-- wants to bury a listing -- files the same report N times and the queue is unworkable. Partial on
-- status so a person may legitimately report the same target again after an earlier report was
-- actioned or dismissed, and on reporter_id because it is nullable (anonymous reports do not
-- collide). This is the slice-3 / V9 lesson: a service-level check alone is racy, because two
-- concurrent submissions both pass it before either commits.
CREATE UNIQUE INDEX idx_reports_one_open_per_reporter
    ON reports (reporter_id, target_type, target_id)
    WHERE reporter_id IS NOT NULL AND status IN ('open', 'reviewing');

-- ---------------------------------------------------------------------------
-- Report reasons: validated in the service, not by a CHECK
-- ---------------------------------------------------------------------------
--
-- V7 left reports.reason free-text with a note to "add a CHECK in a later V* once the vocabulary
-- is frozen". V18 was that later V*, and the answer is no.
--
-- The vocabulary is frozen, but it is three vocabularies, not one: the frontend's ReportModal
-- ships a different reason set per target type (listing / post / user), and they only partly
-- overlap -- 'pricing' is meaningful for a listing and meaningless for a person, 'impersonation'
-- the reverse. A single flat CHECK over the union would accept every nonsensical pairing while
-- looking like it validated something. The rule is genuinely "reason must be valid *for this
-- target type*", which is a two-column rule the service enforces against the same constants the
-- contract declares (ReportReasons). Unlike a uniqueness rule, a vocabulary check has no race for
-- the database to arbitrate, so there is nothing the CHECK would add beyond false assurance.
COMMENT ON COLUMN reports.reason IS
    'Per-target-type vocabulary, validated in ReportService against ReportReasons (V18). '
    'Deliberately no CHECK: the legal set depends on target_type, which one flat constraint cannot express.';

-- D29. Internal notes: what the team knows about a case, kept where the team can read it.
--
-- Replaces `db.internalNotes` in the browser's localStorage. Four moderation actions wrote a note
-- there in the same handler that made a real API call, so the decision landed on the server and the
-- reasoning stayed on one laptop. Nothing was lost visibly -- the note simply was not there for the
-- next person, which reads exactly like "nobody wrote one".
--
-- Polymorphic target, following `reports`: (entity_type, entity_id) rather than four nullable FKs.
-- The four kinds live in four tables and one of them (report) is itself polymorphic, so entity_id is
-- text and is NOT a foreign key. That is deliberate and not laziness -- a note about a listing that
-- is archived an hour later is precisely the note worth keeping, and a cascade would delete the
-- explanation along with the thing it explains.
--
-- MUTABLE, unlike ticket_notes and audit_log beside it. A note is retained customer information,
-- not an audit record: information that cannot be corrected is worse than information that can,
-- because the wrong version is the one that stays on the screen. Who changed what is already
-- audited, in a different table; `note.edit` carries the previous wording.
--
-- author_id is a real user id and not a display name (which is what ticket_notes.by stores). It is
-- not a foreign key either: a staff account can be archived and its notes stay readable, and the
-- read falls back to the raw id when no account matches.
--
-- D30 -- the two case files a listing's notes were split across.
--
-- Because `entity_id` is text and was stored exactly as the caller sent it, and because a listing
-- answers to two public identifiers -- its slug and its uuid -- and the contract accepts either on
-- every `/properties/{id}` route, both were arriving. The moderation console sends the slug; the
-- enquiries board sends the uuid. One listing, two note histories, and no error anywhere: each
-- writer read back precisely what it had written, so both screens looked right and neither could
-- see the other's rows. A note about responding to an enquiry was filed where the review modal's
-- timeline never looks -- which reads exactly like nobody wrote one, the failure this table was
-- created to end.
--
-- `NoteEntityKey` resolves a slug to its uuid before any read or write, so notes cannot split.
-- V123 backfilled the rows written before it existed, so the history a slug-keyed note belongs to
-- is the one it shows up in. The join was the whole predicate: a row moved only when its entity_id
-- IS some property's slug. A uuid never equals a slug, so uuid-keyed rows were untouched, and so
-- was any id that resolves to nothing -- a note whose target has since been deleted outright keeps
-- its raw key rather than being dropped, which is the same bargain this table struck for archived
-- listings. `updated_at` was deliberately left alone by that backfill: merging two buckets is not
-- someone editing the note (`note.edit` carries a previous wording and a merge has none), and
-- bumping it would have put a false "edited just now" on rows nobody touched.
CREATE TABLE internal_notes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type text        NOT NULL CHECK (entity_type IN ('property', 'user', 'review', 'report')),
    entity_id   text        NOT NULL,
    author_id   uuid        NOT NULL,
    action      text,
    text        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The only read shape a screen asks for: one entity's notes, newest first.
CREATE INDEX idx_internal_notes_entity
    ON internal_notes (entity_type, entity_id, created_at DESC);

-- Owner-private lead annotations: the note and follow-up date an owner keeps against one request.
--
-- `leadNotes.js` has held these in `localStorage` under `draazyLeadNotes:<ownerDigits>` since the
-- prototype, and its own header called that a placeholder ("there is no backend yet ... the shapes
-- are intentionally minimal so a future backend can adopt them 1:1"). This is that adoption. The
-- practical failure it fixes is mundane and total: an owner who works leads on their phone and then
-- opens the dashboard on a laptop sees an empty note column, and clearing site data wipes the only
-- copy. Notes are the one thing in the Requests inbox the owner authored themselves.
--
-- `lead_key` is TEXT and deliberately NOT a foreign key.
--
-- The Requests inbox is a union of four unrelated tables -- `contact_requests` (V4),
-- `photo_requests` (V117), document requests, and `flatmate_requests` -- and the client mints a
-- stable composite id per row: 'number:<uuid>', 'photo:<uuid>', 'flatmate:<uuid>',
-- 'documents:<requesterId>|<propertyId>'. That last one is not a row id at all; it is a grouping key
-- over several document rows, so there is no table it could point at even in principle.
--
-- The two alternatives were both worse. A polymorphic FK is not a thing Postgres will enforce, so
-- it would be an FK in name only. Four nullable columns with a CHECK that exactly one is set would
-- be honest about the first three and still leave the document group homeless, and it would make
-- every read a four-way LEFT JOIN to reconstruct a key the client already has in hand. So the server
-- treats `lead_key` as opaque: it stores and returns it, and never parses it.
--
-- The cost of that choice, stated plainly: nothing cascades. If a contact request is ever hard
-- deleted its note is orphaned rather than removed. That is tolerable here because these rows are
-- answered rather than deleted (see V117's note on the same decision), and because an orphaned note
-- is invisible -- the inbox only ever looks up keys for leads it is already rendering.
CREATE TABLE lead_notes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Always taken from the JWT, never from a request body. This column plus the unique index below
    -- is what makes these private: there is no endpoint that reads a note by id alone, so a note is
    -- reachable only through the owner who wrote it.
    owner_id     uuid NOT NULL REFERENCES users(id),

    lead_key     text NOT NULL,

    -- Bounded even though the server never parses it. `uq_lead_notes_owner_lead` is a btree, and a
    -- btree entry over 2704 bytes is rejected at INSERT with an internal error rather than a
    -- constraint failure -- so without this, an authenticated caller sending a 3000-character key
    -- gets a 500 from a code path nobody wrote. 200 is a little over three times the longest key the
    -- client mints today ('documents:<buyerMobile>|<propertyId>', 57 characters with a UUID property
    -- id), which leaves room for a fifth lead source without leaving room for abuse. The controller
    -- carries the same bound so the ordinary answer is a 422.
    --
    -- That document key is built from the buyer's mobile number, unmasked, so this column holds
    -- personal data despite looking like a handle. It is only ever read back by the owner who wrote
    -- it -- who already has the number, which is why they were shown it -- but do not log it, expose
    -- it to search, or treat it as anonymous on the strength of the other three shapes.
    CONSTRAINT lead_notes_key_length CHECK (length(lead_key) <= 200),

    -- Both nullable, and a row with both null is meaningless -- so the CHECK forbids it and the
    -- service deletes rather than storing one. Without this, clearing a note would leave a blank row
    -- behind and "does this lead have a note" would stop being answerable by existence.
    note         text,
    follow_up_at timestamptz,

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT lead_notes_not_empty
        CHECK (note IS NOT NULL OR follow_up_at IS NOT NULL),

    -- Same argument as `lead_notes_key_length`, and it deserves to be made twice rather than left
    -- implied. The controller bounds `note` at 2000, but a bound that lives only in a DTO holds only
    -- for writers that pass through the controller -- a corrective UPDATE, an import, a later
    -- endpoint that forgets the annotation. The note is read back unpaged, all of an owner's rows at
    -- once, so an unbounded column is the one field here where a single oversized row is felt by
    -- every subsequent read. Matching numbers on purpose: if the product ever wants longer notes,
    -- both bounds should move together and this constraint is what makes that impossible to forget.
    CONSTRAINT lead_notes_note_length CHECK (note IS NULL OR length(note) <= 2000)
);

-- One annotation per lead per owner, which is what makes the write an upsert rather than an append.
-- This is also the read path: the inbox fetches every note the owner has and indexes them by key
-- client-side, exactly as the localStorage version did, so `owner_id` leads the index.
CREATE UNIQUE INDEX uq_lead_notes_owner_lead ON lead_notes (owner_id, lead_key);

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- updated_at column. Here that is tickets, service_requests, service_request_parties, reports,
-- internal_notes and lead_notes.
--
-- `service_request_identities` has no updated_at -- an identity row is written once and blanked
-- once, and both moments have their own column -- but the call is idempotent and the convention is
-- the point. The same is true of ticket_notes, service_request_messages and
-- service_request_timeline, all of which are append-only.
--
-- It matters more than usual for lead_notes: the response echoes `updated_at` back so the panel can
-- show when a note was last touched, so a stale value is not an internal detail but something the
-- owner reads. It keeps the column honest for writers that are not Hibernate.
SELECT install_updated_at_triggers();
