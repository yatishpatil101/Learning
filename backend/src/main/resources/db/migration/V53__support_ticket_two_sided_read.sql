-- V53 gives the support thread an honest two-sided read model, and indexes the platform-wide read
-- that becomes possible once it has one. Closes debt D50 and D51 together, because they are the
-- same defect seen from two ends: ops cannot triage a queue it has no unread signal for, and it has
-- no queue to triage.
--
-- D50. `support_tickets.unread` (V8) is one boolean, so it could only ever mean one thing, and what
-- it means is "a support reply the raiser has not read". That is the customer's signal: staff
-- answering sets it, the raiser's own reply leaves it alone, POST /support/tickets/{id}/read clears
-- it. A staff member consequently had no way to see which tickets have a *customer* message waiting
-- -- the direction that actually decides what the desk works on next.
--
-- The fix is a second column, not a reinterpretation of the first. Overloading `unread` to mean
-- "somebody has something to read" would break the customer UI silently: the badge would light up on
-- the raiser's own message, and marking read from either side would clear the other's. Two booleans
-- is also deliberately the smaller change than a per-side read table -- there are exactly two sides
-- here, forever, and a table would buy generality for a third party that does not exist while adding
-- a join to every read.
--
-- Not timestamps either, for the same reason. `last_message_at` + two `last_read_at` columns is the
-- shape you want when "unread" has to be a *count*, and this thread has no count on the wire: the
-- contract's `unread` is a boolean and the whole thread ships inline. Three nullable timestamps to
-- derive a boolean the code already stores directly is more state, not less.
alter table support_tickets
    add column staff_unread boolean not null default false;

comment on column support_tickets.staff_unread is
    'D50: a customer message the desk has not read. The mirror of `unread`, which is the raiser''s '
    'side. The raiser replying sets this; a staff or admin read clears it; a staff reply does not '
    'touch it. Neither column is ever cleared by the other side reading.';

comment on column support_tickets.unread is
    'A support reply the raiser has not read. Set by a staff or admin reply, cleared by '
    'POST /support/tickets/{id}/read called by the raiser. Untouched by the raiser''s own replies, '
    'and since V53 untouched by a staff read as well -- that clears `staff_unread` instead.';

-- Backfill, because a queue that starts empty is a queue that misses every ticket already open on
-- the day it ships. A ticket is awaiting the desk exactly when the newest message on it was written
-- by the person who raised it -- the same rule the application now applies going forward, applied
-- once to history.
--
-- Tickets with no messages at all cannot match, correctly: the create path always writes the opening
-- message in the same transaction, so a message-less row is data that predates the API and has
-- nothing for the desk to read.
update support_tickets t
   set staff_unread = true
 where exists (select 1
                 from support_ticket_messages m
                where m.ticket_id = t.id
                  and m.author_id = t.user_id
                  and m.created_at = (select max(m2.created_at)
                                        from support_ticket_messages m2
                                       where m2.ticket_id = t.id));

-- D51. The platform-wide read at GET /admin/support-tickets is `order by created_at desc limit ?`
-- over the whole table -- the one shape V8 and V22 never indexed, because until now every read of
-- this table was scoped to one user (`idx_support_tickets_user_created`, V22).
--
-- Same reasoning as V48 and V49: paging a sort that is not indexed makes the read slower, not
-- faster. Without this the planner gathers every support ticket on the platform, quicksorts it, and
-- discards all but twenty. With it, page one costs the same at ten rows and at ten thousand.
create index idx_support_tickets_created
    on support_tickets (created_at desc);

-- The filtered read (`?awaitingReply=true`) is the one the desk actually lives in, and it is the
-- case where a plain composite index would be worst: `staff_unread` is true for a small and
-- shrinking minority of rows, so walking the index above newest-first and discarding non-matches
-- reads most of the table to fill one page.
--
-- Partial rather than composite, following V48's finalization index: `staff_unread = false` is
-- never queried -- "tickets nobody is waiting on" is not a view anyone asks for -- so half the
-- keyspace would be dead weight, and the index only carries rows while they are open work. It
-- shrinks as the desk clears the queue, which is the right direction for the hot index to move.
create index idx_support_tickets_awaiting_reply
    on support_tickets (created_at desc)
 where staff_unread;
