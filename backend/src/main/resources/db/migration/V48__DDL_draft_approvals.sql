create table service_request_draft_approvals (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references service_requests(id),
    draft_version integer not null check (draft_version > 0),
    party_key text not null,
    party_label text not null,
    user_id uuid references users(id),
    mobile_hash text,
    mobile_masked text,
    method text not null check (method in ('in_app', 'otp')),
    opened_at timestamptz,
    approved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint service_request_draft_approvals_target_check
        check ((method = 'in_app' and user_id is not null) or (method = 'otp' and mobile_hash is not null)),
    constraint uq_service_request_draft_approvals_party unique (request_id, draft_version, party_key)
);

create index idx_service_request_draft_approvals_request
    on service_request_draft_approvals(request_id, draft_version);

create table service_request_draft_checks (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references service_requests(id),
    draft_version integer not null check (draft_version > 0),
    status text not null check (status in ('pending', 'released', 'sent-back')),
    reasons text not null,
    note text,
    shared_by uuid not null references users(id),
    checked_by uuid references users(id),
    checked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_service_request_draft_checks_version unique (request_id, draft_version)
);

create index idx_service_request_draft_checks_request
    on service_request_draft_checks(request_id, draft_version desc);
