ALTER TABLE help_article_feedback ADD COLUMN voter_key text;

UPDATE help_article_feedback SET voter_key = COALESCE(user_id::text, ip_hash);

DELETE FROM help_article_feedback f
USING (
    SELECT id, row_number() OVER (PARTITION BY slug, lang, voter_key ORDER BY created_at DESC, id DESC) AS rn
    FROM help_article_feedback
    WHERE voter_key IS NOT NULL
) d
WHERE f.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX help_article_feedback_one_vote_idx
    ON help_article_feedback (slug, lang, voter_key);

COMMENT ON TABLE help_article_feedback IS
    'One reader''s current verdict on one help article. A reader is the account when signed in, else '
    'the browser''s anonymous voter id, else the hashed caller IP; voting again replaces the verdict '
    '(and comment) instead of adding a row, so one reader counts once. Erasure removes the row outright.';

COMMENT ON COLUMN help_article_feedback.voter_key IS
    'Who cast the verdict: the user id, or ''b:'' plus the browser''s random voter id, or the ip_hash '
    'fallback. Null only on rows older than this column that had no user or ip_hash.';