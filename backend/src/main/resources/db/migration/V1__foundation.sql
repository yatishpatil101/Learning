-- V1 Foundation (Phase 0): extensions, shared conventions, cross-cutting tables.
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
CREATE TABLE platform_fees (
    deal          text PRIMARY KEY CHECK (deal IN ('buy','rent')),
    brokerage     bigint NOT NULL DEFAULT 0,
    platform_fee  bigint NOT NULL DEFAULT 0,
    stamp_duty    bigint NOT NULL DEFAULT 0,
    registration  bigint NOT NULL DEFAULT 0,
    gst           bigint NOT NULL DEFAULT 0,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

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
CREATE INDEX idx_audit_log_entity ON audit_log (entity, entity_id);
CREATE INDEX idx_audit_log_at     ON audit_log (at DESC);

SELECT install_updated_at_triggers();
