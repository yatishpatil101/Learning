-- V01 DDL Foundation: extensions, shared conventions, cross-cutting tables.
--
-- Scope: the prerequisites every later file in this chain depends on (pgcrypto, set_updated_at(),
-- install_updated_at_triggers()) plus the three cross-cutting tables `settings`, `platform_fees`
-- and `audit_log`.
--
-- Folded from the old chain: V1 (all of it), V18 (the audit_log indexes only), V52 (the
-- platform_fees statutory-charge nullability and its column comments).
--
-- Conventions (from docs/system/data-model.md + backend skill data-model.md):
--   * UUID PKs via gen_random_uuid()            (reconciliation #1: opaque UUID ids)
--   * snake_case columns
--   * created_at/updated_at timestamptz         (updated_at auto-maintained by trigger below)
--   * soft-delete triplet archived/archived_at/archive_reason on business entities
--   * money = bigint whole INR (no paise)
--   * enum-like columns = text + CHECK           (cheapest to evolve; add values via one ALTER)
-- Every later migration ends with `SELECT install_updated_at_triggers();` so the trigger is
-- wired onto any new table carrying an updated_at column -- no per-table boilerplate.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared updated_at maintenance. One function, wired everywhere by the installer below.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Idempotently (re)wire the set_updated_at trigger onto every public BASE TABLE that has an
-- updated_at column. Called at the end of each migration -- keeps timestamp handling DRY and
-- guarantees correctness even for raw-SQL updates, not just Hibernate @UpdateTimestamp.
CREATE OR REPLACE FUNCTION install_updated_at_triggers() RETURNS void AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema
         AND t.table_name  = c.table_name
         AND t.table_type  = 'BASE TABLE'
        WHERE c.table_schema = 'public'
          AND c.column_name  = 'updated_at'
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;
             CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            r.table_name, r.table_name);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Platform key/value config (AdminSettings SSOT: fees, feature flags, RBAC map, branding).
-- Stored as a document store so config can evolve without a migration per key.
CREATE TABLE settings (
    key        text PRIMARY KEY,
    value      jsonb        NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz  NOT NULL DEFAULT now(),
    updated_at timestamptz  NOT NULL DEFAULT now()
);

-- Read-only fee breakdown backing GET /fees (schema: Fees). One row per deal intent.
--
-- THE RENT ROW'S STATUTORY CHARGES ARE NULLABLE: "not a flat number" is a real answer (D163).
--
-- WHAT WAS WRONG
--
-- `platform_fees` publishes one flat figure per column per deal intent, and the `rent` row seeded
-- `stamp_duty = 0` and `registration = 0`. D150 then made the rent-agreement sidebar render the
-- server's breakdown instead of computing its own, so the displayed price became the charged price
-- by construction -- and both became wrong together. The platform billed `1999 + 0 + 0 + GST` for a
-- Leave & License that legally attracts stamp duty under Article 36A of the Maharashtra Stamp Act
-- and a registration fee under the Registration Act. Every rupee of that gap is money the platform
-- would have had to remit out of its own margin, per agreement.
--
-- WHY NULLABLE RATHER THAN A BETTER NUMBER
--
-- There is no better number. Art. 36A duty is 0.25% of a consideration built from the rent, the
-- term and the deposit, so it is ~918 rupees for a 32k/11-month tenancy and several times that for
-- a longer or larger one. Any single figure seeded here is correct for exactly one agreement and
-- wrong for all the others, and a confident wrong figure on a public page is worse than the honest
-- zero it replaced. Registration is genuinely flat, but it is flat *per registering body* -- Rs 1000
-- municipal, Rs 500 rural -- which one column also cannot say.
--
-- So the column does not claim to know. NULL here means "this line is computed per agreement, not
-- published", which is the truth; the arithmetic lives in `catalog.fee.LeaveAndLicenceCharges` and
-- is applied per request beside `ServiceRequestService.priceFor`. The contract permits it already:
-- `Fees` declares no required properties and `FeeResponse` carries boxed `Long`s, so no response
-- shape changes -- the two fields simply do not carry a figure for `rent`.
--
-- THE WIZARD NEEDS ONE LINE TO MATCH -- DO NOT SHIP THIS ALONE
--
-- The rent-agreement wizard has always had the correct Art. 36A fallback behind
-- `if (stampDuty == null)` and has always labelled the result an estimate via `computed`; that
-- branch was dead only while these columns could not be null. It stayed dead while
-- `frontend/src/services/providers/http/feesProvider.js` coerced the wire value with
-- `Number(row?.stampDuty) || 0`, on the stated ground that "the server's columns are NOT NULL, so
-- absence here is a contract break rather than 'not published'". This nullability is exactly what
-- retires that premise, so that provider must pass null through:
--
--     stampDuty:    row?.stampDuty    == null ? null : Number(row.stampDuty) || 0,
--     registration: row?.registration == null ? null : Number(row.registration) || 0,
--
-- Until it does, the sidebar renders 0 for both lines while the server charges the real figure, and
-- the customer is quoted less than they are asked to pay. The backend half is correct on its own;
-- it is not *releasable* on its own.
--
-- The `buy` row is untouched. Its `stamp_duty = 0` is its own untruth -- Maharashtra charges 6-7% of
-- agreement value on a sale -- but that is a separate figure with a separate rule and is not D163.
--
-- SAFETY
--
-- Dropping the NOT NULL and the DEFAULT was metadata-only on PostgreSQL: no table rewrite, no lock
-- beyond the brief ACCESS EXCLUSIVE the catalogue update needed, and every existing row kept its
-- value. Nothing writes this table from application code (PlatformFee has no setters), so the only
-- writer is the repeatable seed, which sets both columns explicitly.
CREATE TABLE platform_fees (
    deal          text PRIMARY KEY CHECK (deal IN ('buy','rent')),
    brokerage     bigint NOT NULL DEFAULT 0,
    platform_fee  bigint NOT NULL DEFAULT 0,
    stamp_duty    bigint,
    registration  bigint,
    gst           bigint NOT NULL DEFAULT 0,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN platform_fees.stamp_duty IS
    'Published stamp duty, whole rupees. NULL = not a flat figure, computed per agreement (D163); see catalog.fee.LeaveAndLicenceCharges.';
COMMENT ON COLUMN platform_fees.registration IS
    'Published registration fee, whole rupees. NULL = depends on the registering body, computed per agreement (D163): Rs 1000 municipal / Rs 500 rural.';

-- Append-only audit trail (schema: AuditEntry). Written server-side on every maker-checker /
-- money / privileged mutation. actor/checker are text handles (resolved server-side), never
-- client-supplied. No updated_at: rows are immutable.
CREATE TABLE audit_log (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor      text,
    actor_role text CHECK (actor_role IN ('buyer','owner','staff','admin')),
    action     text NOT NULL,
    entity     text,
    entity_id  text,
    checker    text,
    metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
    at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The audit log: indexes
-- ---------------------------------------------------------------------------
--
-- The question the back-office endpoints actually ask is always some filter *plus* a newest-first
-- ordering. api-standards.md §5 requires every sort be index-backed, and the back-office reads are
-- exactly the ones that get slow first: they are unfiltered by user, so they scan the whole table.
--
-- idx_audit_log_at (at DESC) serves the unfiltered newest-first read, and idx_audit_log_entity
-- (entity, entity_id) serves "everything that happened to this row". The slice-9 read also filters
-- by actor and by entity type with the same ordering, so those two combinations get keys of their
-- own. idx_audit_log_entity stays: it answers a different question (one specific row's history) and
-- is not a prefix of the other keys.
CREATE INDEX idx_audit_log_entity   ON audit_log (entity, entity_id);
CREATE INDEX idx_audit_log_at       ON audit_log (at DESC);
CREATE INDEX idx_audit_log_actor_at ON audit_log (actor, at DESC);
CREATE INDEX idx_audit_log_entity_at ON audit_log (entity, at DESC);

SELECT install_updated_at_triggers();
