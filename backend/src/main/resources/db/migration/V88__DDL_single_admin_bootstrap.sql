DROP TABLE IF EXISTS staff_account_approvals;

CREATE TABLE admin_bootstrap_runs (
    nonce  text PRIMARY KEY,
    ran_at timestamptz NOT NULL DEFAULT now()
);
