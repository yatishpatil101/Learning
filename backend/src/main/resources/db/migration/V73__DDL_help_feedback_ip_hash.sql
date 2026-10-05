ALTER TABLE help_article_feedback
    ADD COLUMN ip_hash text;

COMMENT ON COLUMN help_article_feedback.ip_hash IS
    'SHA-256 hash of the caller IP, salted by purpose, used only to enforce the per-article daily feedback cap without storing the address itself.';

CREATE INDEX help_article_feedback_slug_ip_day_idx
    ON help_article_feedback (slug, ip_hash, created_at DESC)
    WHERE ip_hash IS NOT NULL;
