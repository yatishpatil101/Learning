-- V26 Optimistic locking on the two ops work queues (tech debt D48).
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

-- `default 0` matters for the rows that already exist: @Version maps to a primitive long, so a null
-- would be read as a detached-entity marker and turn the next update into an insert attempt.
-- `not null` is what makes the lock unskippable -- a nullable version column is an optional lock.

alter table tickets          add column version bigint not null default 0;
alter table service_requests add column version bigint not null default 0;
alter table support_tickets  add column version bigint not null default 0;

comment on column tickets.version is
    'Optimistic-locking counter (D48). Maintained by Hibernate; raw SQL updates bypass it.';
comment on column service_requests.version is
    'Optimistic-locking counter (D48). Maintained by Hibernate; raw SQL updates bypass it.';
comment on column support_tickets.version is
    'Optimistic-locking counter (D48). Maintained by Hibernate; raw SQL updates bypass it.';
