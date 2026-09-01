-- V86 — record when an owner last confirmed a listing is genuinely still available.
--
-- Why a column and not a derivation. The freshness badge on every listing card is computed from
-- "how long since the owner last confirmed", and until now the only thing standing in for that
-- confirmation was a `freshenedAt` field written into the browser's mock store. The confirmation
-- therefore lived in whichever browser happened to make it: an owner who tapped "still available"
-- on their phone saw the badge reset there and nowhere else, and every buyer -- and the owner's own
-- laptop -- carried on being told the listing was stale. A signal about the state of the world was
-- being stored per-device, which is the one place it cannot mean anything.
--
-- Why nullable, with no backfill. Null means "nobody has ever confirmed this listing", which is the
-- truth for every row that exists today, and the reader falls back to created_at exactly as the
-- client's freshness model already did. Backfilling created_at into this column would have produced
-- identical behaviour on day one and a permanent lie afterwards: the column would claim an owner
-- confirmed availability on the day they posted, which they did not, and there would be no way left
-- to tell a listing whose owner actually answers from one that has never been touched. The fallback
-- belongs in the reader, where it is visibly a fallback.
--
-- No index. Freshness is read per-row on listings the query has already selected, never filtered or
-- sorted on -- the "recently confirmed" search facet ranks in the client off the same derived state.
-- An index here would be paid for on every listing write and read by nothing.
alter table public.properties
    add column if not exists last_confirmed_at timestamptz;

comment on column public.properties.last_confirmed_at is
    'When the owner last confirmed this listing is still available. Null = never confirmed; readers fall back to created_at.';
