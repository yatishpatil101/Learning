-- V46 Optimistic locking on the three payment rows the abandoned-checkout sweep writes (D161).
--
-- WHAT WAS WRONG
--
-- D161 gave `subscriptions`, `boosts` and `rent_payments` a second concurrent writer. Until now
-- each of these rows had exactly one path out of its unpaid state -- the Cashfree webhook -- so the
-- "single owner" argument V26 used to keep versioning off most tables held here too. The sweep
-- breaks that: it selects unpaid rows past the TTL and retires them, on a timer, from a different
-- thread than the webhook fan-out.
--
-- Under READ COMMITTED those two writers lose data in one specific interleaving, and it is the
-- expensive one. The sweep's SELECT takes its snapshot and sees the row as unpaid; the webhook then
-- commits `active`; the sweep's UPDATE (matched by primary key alone) blocks, then overwrites the
-- settled row with `cancelled`. A customer who paid is cancelled, no exception is raised anywhere,
-- and the only trace is a log line saying the sweep did its job. The per-row status re-check in
-- Subscription.abandonCheckout() cannot catch this, because it reads the same stale snapshot.
--
-- `service_requests` was never exposed to it: V26 versioned that table for D48, which is exactly why
-- D152's sweep -- the one D161 generalised -- has always been safe. This migration brings the other
-- three up to the shape the one that already worked has.
--
-- WHY THIS SHAPE
--
-- VersionedEntity's Javadoc names this situation as its own extension point: "the next entity that
-- genuinely gains a second concurrent writer changes one word". This is that entity, three times
-- over. The alternative -- a guarded bulk UPDATE per family, re-evaluating the status at write time
-- -- would work, but it would make the three new families structurally different from the one they
-- were generalised with, and it would move the transition out of the entity that owns it. Adding
-- the column that the working family already has is both smaller and truer.
--
-- The loser of the race now matches zero rows and raises OptimisticLockingFailureException. In the
-- sweep that aborts the family's batch for this tick and it retries in ten minutes, by which time
-- the row is settled and out of the query. In the webhook it surfaces as a 409 to Cashfree, which
-- redelivers. Both outcomes are correct and neither loses the payment.
--
-- `default 0` matters for the rows that already exist: @Version maps to a primitive long, so a null
-- would be read as a detached-entity marker and turn the next update into an insert attempt.
-- `not null` is what makes the lock unskippable -- a nullable version column is an optional lock.
--
-- Lock note: `add column ... default` is metadata-only on PostgreSQL 11+, so this does not rewrite
-- the three tables.

alter table subscriptions add column version bigint not null default 0;
alter table boosts        add column version bigint not null default 0;
alter table rent_payments add column version bigint not null default 0;

comment on column subscriptions.version is
    'Optimistic-locking counter (D161). Maintained by Hibernate; raw SQL updates bypass it.';
comment on column boosts.version is
    'Optimistic-locking counter (D161). Maintained by Hibernate; raw SQL updates bypass it.';
comment on column rent_payments.version is
    'Optimistic-locking counter (D161). Maintained by Hibernate; raw SQL updates bypass it.';
