-- When a request entered its current status, so the rental desk's turnaround is measured from the
-- moment the matter became its move rather than from when it was opened. Existing rows start the
-- clock at their last write; that is the closest record the table holds.

ALTER TABLE service_requests ADD COLUMN status_changed_at timestamptz;
UPDATE service_requests SET status_changed_at = updated_at;
ALTER TABLE service_requests ALTER COLUMN status_changed_at SET NOT NULL;
ALTER TABLE service_requests ALTER COLUMN status_changed_at SET DEFAULT now();

CREATE INDEX idx_service_requests_rent_agreement_sla
    ON service_requests (status, status_changed_at)
    WHERE type = 'rent-agreement';
