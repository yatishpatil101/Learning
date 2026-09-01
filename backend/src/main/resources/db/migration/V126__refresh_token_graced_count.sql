-- V126 Bound how many times one refresh-token family may be forgiven (ADR-008 follow-up).
--
-- The grace window in RefreshTokenService.rotate forgives a replay that lands within seconds of
-- the rotation it lost to, so two tabs racing do not sign the user out. That forgiveness was
-- unbounded per family, and unbounded is exploitable: an attacker holding a stolen token who keeps
-- rotating keeps the family's head permanently "fresh", so every replay the victim makes lands
-- inside a window the attacker is holding open. Attacker and victim then ping-pong indefinitely,
-- each forgiven, and the tripwire never fires for the full 30-day TTL.
--
-- graced_count carries the number of *consecutive* graces along a rotation chain: a clean
-- (uncontested) rotation resets it to 0, a forgiven one increments it, and the service burns the
-- family once it would exceed its limit. Consecutive rather than lifetime is what keeps a legitimately
-- flaky client from accumulating its way to a forced sign-out over thirty days, while still bounding
-- the ping-pong, which is contested at every single step and so never resets.
--
-- Backfill is 0 for existing rows -- the column counts consecutive graces ending at that row, and no
-- row written before this migration was minted by a graced rotation that we recorded. Starting them
-- at 0 is therefore accurate, not merely convenient.
alter table refresh_tokens
    add column if not exists graced_count integer not null default 0;

-- The grace walk resolves a chain by rotated_from (up to MAX_GRACE_HOPS lookups per replay), and
-- until now that column carried no index at all -- every hop was a sequential scan of the whole
-- table. Bounding the grace makes that path hotter, not colder, since it is now walked on exactly
-- the requests that matter most. Not declared unique: one successor per predecessor is an invariant
-- the service upholds under a row lock, but promoting it to a constraint here would turn any
-- historical violation into a failed migration on a table we cannot inspect ahead of time.
create index if not exists idx_refresh_tokens_rotated_from on refresh_tokens(rotated_from);
