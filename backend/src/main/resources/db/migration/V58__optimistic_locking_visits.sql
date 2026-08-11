-- V58 Optimistic locking on visits (tech debt D146).
--
-- WHAT THIS CLOSES
--
-- `VisitService.updateStatus` and `VisitService.reschedule` are two legitimate writers of the same
-- `visits` row. Without a version counter, two callers editing a stale copy can both succeed and
-- the later commit silently wins. That can leave a row in a state that reflects only one side of
-- the interaction rather than the latest agreed state.
--
-- WHY THIS SHAPE
--
-- The platform already standardises this on `@Version` via `VersionedEntity` (V26, V46). Visits now
-- join that same mechanism: Hibernate includes `version` in the UPDATE predicate and increments it.
-- The stale writer then matches zero rows and Spring raises OptimisticLockingFailureException,
-- which the global handler maps to 409 with a reload-and-retry message.
--
-- `default 0` is required for existing rows and `not null` makes the lock unskippable.

alter table visits add column version bigint not null default 0;

comment on column visits.version is
    'Optimistic-locking counter (D146). Maintained by Hibernate; raw SQL updates bypass it.';
