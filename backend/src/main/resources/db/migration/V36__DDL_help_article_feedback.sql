-- "Was this helpful?" at the foot of every help article.
--
-- The widget has existed for a while and has been writing to localStorage, which means the answer
-- was only ever visible to the person who gave it. That is not a measurement, it is a thank-you
-- note the reader writes to themselves: the one question the help centre cannot answer about itself
-- -- which articles are failing -- stayed unanswerable no matter how many people answered it.
--
-- The rows cannot be backfilled, so the table lands before the reader for it exists. There is no
-- admin read yet and no chart; that is a screen someone can build in an afternoon, against data
-- that only accumulates if the writing starts now.

CREATE TABLE help_article_feedback (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       text NOT NULL,
    lang       text NOT NULL,
    helpful    boolean NOT NULL,
    comment    text,
    user_id    uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT help_article_feedback_lang_check CHECK (lang IN ('en', 'hi', 'mr')),
    CONSTRAINT help_article_feedback_slug_check CHECK (slug ~ '^[a-z0-9-]{1,120}$'),
    CONSTRAINT help_article_feedback_comment_len CHECK (comment IS NULL OR length(comment) <= 500)
);

COMMENT ON TABLE help_article_feedback IS
    'One reader''s verdict on one help article. Append-only: no edit path, no moderation, and no '
    'application delete path -- erasure is the sole exception and removes the row outright. '
    'A reader who changes their mind votes again and both rows stand, because "this article stopped '
    'working for me" is itself the finding.';

COMMENT ON COLUMN help_article_feedback.slug IS
    'The article, by the slug its Markdown file declares. No foreign key is possible -- help content '
    'is compiled into the frontend bundle at build time and has no table here -- so the database '
    'cannot tell a real slug from a typo, and the writer does not pretend to either. Renaming an '
    'article orphans its old rows on purpose: the votes were cast on the article under that name, '
    'and silently carrying them across a rename would attribute one article''s reputation to another. '
    'Shape-constrained even so: this is the key a back-office screen will group and link on, and a '
    'slug that may contain a slash or a quote is one that arrives somewhere as a path or a fragment '
    'of markup later.';

COMMENT ON COLUMN help_article_feedback.lang IS
    'Which translation was on screen. Recorded because an article can be clear in English and '
    'confusing in Marathi, and a single helpful-rate would average those two into a number that '
    'describes neither -- pointing a writer at the English prose when the English prose is fine.';

COMMENT ON COLUMN help_article_feedback.comment IS
    'Optional free text, and the only free text on this table. Null is the common case: the widget '
    'asks for a reason only after a no, and most people who click no do not give one. Never rendered '
    'to another reader -- it is a note to the person who maintains the article, not a public review, '
    'and nothing on the platform reads it back to the public. Stored verbatim, minus the control '
    'characters that break a consumer whatever it is (C0, C1 and the Unicode line separators), '
    'characters: sanitising a reader''s words at write time destroys the evidence, so WHOEVER BUILDS '
    'THE ADMIN SCREEN owns the escaping -- and in particular a CSV or XLSX export must neutralise a '
    'leading =, +, - or @, which is formula injection and is not something React escaping covers. '
    'The reason this row is deleted outright on erasure rather than merely unlinked: these are the '
    'reader''s own words, and the question collects phone numbers from people who could not sign in.';

COMMENT ON COLUMN help_article_feedback.user_id IS
    'Null for signed-out readers, which is most of them -- the help centre is the surface people '
    'reach before they have an account. No foreign key, deliberately: a cascade would tie the row''s '
    'fate to account closure, which is not the same event as an erasure request. ErasureService '
    'deletes these rows outright, unlike page_views, which it only unlinks -- a view is one of '
    'millions and already inside an aggregate naming nobody, whereas a verdict carries the reader''s '
    'own sentence and nothing has been computed from it yet.';

COMMENT ON COLUMN help_article_feedback.created_at IS
    'When the verdict was cast, and load-bearing rather than decorative: an article rewritten in '
    'March is a different article, so a helpful-rate that ignores time describes prose nobody has '
    'read for a year. No retention sweep, unlike page_views -- and that is a decision, not an '
    'oversight. A view is one of millions and worth nothing individually after 90 days; a verdict is '
    'one of a few hundred and is the entire dataset, so expiring it would leave the table empty and '
    'the question unanswerable again. The part that genuinely ages out is the free text, and erasure '
    'already clears that for anyone who asks.';

CREATE INDEX help_article_feedback_slug_idx ON help_article_feedback (slug, created_at DESC);
