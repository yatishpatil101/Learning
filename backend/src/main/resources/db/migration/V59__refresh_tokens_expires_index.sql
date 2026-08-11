-- V59 Add an expiry index for refresh-token pruning (D10 follow-up).
--
-- RefreshTokenPruningSweep deletes rows by expires_at. Without an index this is a periodic
-- full-table predicate scan as refresh_tokens grows. The index keeps the prune path bounded.

create index if not exists idx_refresh_tokens_expires_at on refresh_tokens(expires_at);
