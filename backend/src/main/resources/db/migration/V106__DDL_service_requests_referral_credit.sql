ALTER TABLE service_requests ADD COLUMN referral_credit boolean NOT NULL DEFAULT false;

CREATE INDEX idx_service_requests_referral_credit ON service_requests (requester_id) WHERE referral_credit;

COMMENT ON COLUMN service_requests.referral_credit IS
    'True once a referral-earned free rent agreement was spent on this request, which waives only '
    'Draazy''s own service fee and its GST. A credit is held while the request is anything but cancelled.';
