-- V12 Slice 5 (finance ledger + tenancy lifecycle) schema completion.
--
-- Three groups of change, each closing a gap between the V6 tables and the contract the finance
-- and tenancy surfaces have to serve.

-- ---------------------------------------------------------------------------------------
-- 1. transactions: soft-delete
--
-- DELETE /me/finances/{propId}/transactions/{txnId} answers 204, but the table had no way to
-- record a deletion other than losing the row -- and "no hard delete" is a platform guardrail
-- (SoftDeleteEntity), not a preference.
--
-- It matters more here than anywhere else in the schema. This is the owner's financial ledger:
-- the same rows feed /summary, /cashflow and /dues, and an owner reconciles those numbers
-- against a bank statement and, at year end, against a tax return. A ledger whose rows can
-- vanish cannot be reconciled with its own totals -- last month's net silently changes and
-- there is nothing left to explain why. Soft-delete keeps the deleted row available to answer
-- "where did that Rs 40,000 go", which is the question an owner actually asks.
--
-- Same triplet as properties (V3) so the rows map onto the shared SoftDeleteEntity base rather
-- than earning a bespoke lifecycle.
ALTER TABLE transactions ADD COLUMN archived       boolean NOT NULL DEFAULT false;
ALTER TABLE transactions ADD COLUMN archived_at    timestamptz;
ALTER TABLE transactions ADD COLUMN archive_reason text;

-- The V6 indexes cover every row, but every read on this table is a live read: the ledger list,
-- the summary aggregate, the cashflow series and the dues projection all filter archived = false.
-- Replacing them with partial indexes keeps deleted rows out of the scans that never want them,
-- and keeps the index small as the archive grows.
DROP INDEX idx_transactions_owner;
DROP INDEX idx_transactions_property;
CREATE INDEX idx_transactions_owner    ON transactions (owner_id, date)    WHERE archived = false;
CREATE INDEX idx_transactions_property ON transactions (property_id, date) WHERE archived = false;

-- /dues reads only the recurring rows, which are a small minority of a busy ledger. Without this
-- the dues projection scans the whole property history to find them.
CREATE INDEX idx_transactions_recurring ON transactions (property_id, recurring)
    WHERE archived = false AND recurring <> 'none';

-- ---------------------------------------------------------------------------------------
-- 2. tenancies: one active tenancy per property
--
-- Nothing prevented two rows with status 'active' on the same flat. That is not a duplicate
-- record, it is a double-let: two tenants each believing they hold the property, two rent
-- schedules, and rent_payments rows that cannot be attributed. It also makes "the current
-- tenancy" -- which the owner dashboard, the tenant's My Rental panel and the rent ledger all
-- assume is singular -- a query with two answers.
--
-- Partial, so a property can accumulate any number of ended/terminated tenancies over the years
-- while only ever having one live at a time. This is the V9/V11 lesson applied ahead of the bug:
-- a service-level check cannot survive two concurrent closes interleaving.
CREATE UNIQUE INDEX uq_tenancies_active_per_property
    ON tenancies (property_id)
    WHERE status = 'active';

-- The owner's tenancy list and the tenant's own list are both live-first reads.
CREATE INDEX idx_tenancies_owner_status  ON tenancies (owner_id, status);
CREATE INDEX idx_tenancies_tenant_status ON tenancies (tenant_id, status);

-- ---------------------------------------------------------------------------------------
-- 3. ownership_basis: no change
--
-- Recorded deliberately, because the absence looks like an oversight. The frontend mock also
-- persists a loan block (rate, tenure) and per-category budgets, neither of which appears in the
-- contract. They are not given columns here: the EMI figure the contract does carry is already in
-- ownership_basis.emi, and rate/tenure exist in the mock only to feed a client-side EMI
-- calculator that recomputes from user input on every render. Adding columns for values nothing
-- reads back is how a schema fills with fields whose meaning nobody can reconstruct later.
-- See slice 5 D5 for the full ruling on the orphan mock surfaces.

SELECT install_updated_at_triggers();
