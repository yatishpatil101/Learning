-- V6 Documents, Rent, Finance & Tenancies (Phase 5). Post-deal money and paperwork.
-- Schemas: Document, DocumentRequest(Create), Transaction(Create), OwnershipBasis, Tenancy,
--          RentPayment(Create), RentMandate, PayoutAccount, TenantProfile, RentAgreement, OwnerKyc.

-- documents: property-scoped files, served via short-lived signed URLs (url minted at read time).
-- service_request_id (rent-agreement drafts etc.) is added by V7 once service_requests exists.
CREATE TABLE documents (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid REFERENCES properties(id),
    category    text,
    file_name   text,
    storage_key text,                          -- object-store key; signed URL derived at read time
    size_bytes  bigint,
    mime_type   text,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_property ON documents (property_id);

-- document_requests: buyer requests categories -> owner grants (share_token, time-boxed).
CREATE TABLE document_requests (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id            uuid NOT NULL REFERENCES properties(id),
    requester_id           uuid NOT NULL REFERENCES users(id),
    categories             jsonb NOT NULL DEFAULT '[]'::jsonb,
    status                 text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','granted','declined','expired')),
    share_token            text,
    acknowledged_disclaimer boolean NOT NULL DEFAULT false,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_document_requests_property  ON document_requests (property_id);
CREATE INDEX idx_document_requests_requester ON document_requests (requester_id);

-- transactions: owner finance ledger (reconciliation #5: note + recurring, not repeat).
CREATE TABLE transactions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id),
    owner_id    uuid NOT NULL REFERENCES users(id),
    type        text NOT NULL CHECK (type IN ('income','expense')),
    category    text,
    amount      bigint NOT NULL,
    date        date NOT NULL,
    note        text,
    recurring   text NOT NULL DEFAULT 'none' CHECK (recurring IN ('none','monthly','quarterly','yearly')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_transactions_owner    ON transactions (owner_id, date);
CREATE INDEX idx_transactions_property ON transactions (property_id, date);

-- ownership_basis: 1:1 per property (schema: OwnershipBasis).
CREATE TABLE ownership_basis (
    property_id      uuid PRIMARY KEY REFERENCES properties(id),
    owner_id         uuid NOT NULL REFERENCES users(id),
    purchase_price   bigint,
    purchase_date    date,
    loan_outstanding bigint,
    emi              bigint,
    current_value    bigint,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- tenancies: created on rent-deal finalization; parent of rent_payments/mandate.
CREATE TABLE tenancies (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id),
    tenant_id   uuid NOT NULL REFERENCES users(id),
    owner_id    uuid NOT NULL REFERENCES users(id),
    rent        bigint,
    deposit     bigint,
    start_date  date,
    end_date    date,
    status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','terminated')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenancies_owner  ON tenancies (owner_id);
CREATE INDEX idx_tenancies_tenant ON tenancies (tenant_id);

-- rent_payments: platform_fee + gst are server-computed from platform_fees/settings, never trusted
-- from the client. reference is the payment-gateway idempotency handle.
CREATE TABLE rent_payments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenancy_id   uuid NOT NULL REFERENCES tenancies(id),
    amount       bigint NOT NULL,
    platform_fee bigint NOT NULL DEFAULT 0,
    gst          bigint NOT NULL DEFAULT 0,
    due_date     date,
    paid_date    date,
    status       text NOT NULL DEFAULT 'due' CHECK (status IN ('due','paid','overdue','failed')),
    method       text CHECK (method IN ('upi','netbanking','card','autopay','cash')),
    reference    text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rent_payments_tenancy ON rent_payments (tenancy_id, due_date);

CREATE TABLE rent_mandates (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenancy_id   uuid NOT NULL REFERENCES tenancies(id),
    max_amount   bigint,
    day_of_month integer CHECK (day_of_month BETWEEN 1 AND 28),
    status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
    provider     text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rent_mandates_tenancy ON rent_mandates (tenancy_id);

-- payout_accounts: owner payout destination (schema: PayoutAccount). Only masked digits stored.
CREATE TABLE payout_accounts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       uuid NOT NULL REFERENCES users(id),
    account_holder text,
    masked_account text,
    ifsc           text,
    upi_id         text,
    verified       boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payout_accounts_owner ON payout_accounts (owner_id);

-- tenant_profiles: 1:1 per user (schema: TenantProfile).
CREATE TABLE tenant_profiles (
    user_id              uuid PRIMARY KEY REFERENCES users(id),
    name                 text,
    occupation           text,
    employer             text,
    family_size          integer,
    preferred_localities jsonb NOT NULL DEFAULT '[]'::jsonb,
    budget               bigint,
    score                integer CHECK (score BETWEEN 0 AND 100),
    verified             boolean NOT NULL DEFAULT false,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- rent_agreements: owner-KYC-gated agreement records (schema: RentAgreement). tenant may be an
-- unregistered mobile at draft time, so tenant_mobile is text (resolves to a user on activation).
CREATE TABLE rent_agreements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id     uuid NOT NULL REFERENCES properties(id),
    owner_id        uuid NOT NULL REFERENCES users(id),
    tenant_mobile   text CHECK (tenant_mobile ~ '^[6-9][0-9]{9}$'),
    rent            bigint,
    deposit         bigint,
    start_date      date,
    duration_months integer,
    status          text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','e-sign-pending','registered','active','expired')),
    document_url    text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rent_agreements_property ON rent_agreements (property_id);

-- owner_kyc: 1:1 per user (schema: OwnerKyc). Masked PAN/Aadhaar only.
CREATE TABLE owner_kyc (
    user_id        uuid PRIMARY KEY REFERENCES users(id),
    pan_masked     text,
    aadhaar_masked text,
    bank_verified  boolean NOT NULL DEFAULT false,
    status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

SELECT install_updated_at_triggers();
