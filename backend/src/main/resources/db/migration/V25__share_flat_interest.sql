-- V25 Share-flat interest (slice 15) -- the last migration of the contract build-out.
--
-- `share_flat_posts` itself has existed since V7. The only thing missing was the other half of the
-- feature: a post nobody can answer is a classified ad nailed to a wall in an empty room.

-- ---------------------------------------------------------------------------
-- Interest in a share-flat post
-- ---------------------------------------------------------------------------
-- Someone reads a flatmate ad and says "this is me". The row exists rather than the message going
-- straight out as a notification because a notification is a delivery, not a record: it can be
-- marked read and scrolled past, and the poster would then have no way to tell whether four people
-- had written or forty.
--
-- Why this is not `contact_requests`: that table is (seeker, owner, property) and every one of its
-- three columns is wrong here. There is no property, the poster is not an owner in the catalogue
-- sense, and the direction of the contact release is reversed -- there the owner approves and their
-- number is revealed, here the sender volunteers their own. Reusing it would have meant a nullable
-- property_id and an approval workflow that never runs.
CREATE TABLE share_flat_interests (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id    uuid        NOT NULL REFERENCES share_flat_posts (id) ON DELETE CASCADE,
    -- No ON DELETE: users are archived, never deleted (V2), so a cascade here would be dead code
    -- that quietly became destructive the day someone added a hard delete.
    user_id    uuid        NOT NULL REFERENCES users (id),
    message    text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- One interest per person per post, enforced here rather than in the service. This is what makes
-- the endpoint idempotent: a second send is an UPDATE of the message, so a client that retries --
-- or a person who rewrites their pitch -- cannot flood one poster's inbox. The service relies on
-- this being unrepresentable rather than on checking first, because two concurrent sends would
-- otherwise both pass the check.
CREATE UNIQUE INDEX uq_share_flat_interests_post_user
    ON share_flat_interests (post_id, user_id);

-- Backs the per-sender rate limit. Without it, the cap on how many strangers one account may
-- message per hour would cost a sequential scan of a table that same account is filling.
CREATE INDEX idx_share_flat_interests_user_created
    ON share_flat_interests (user_id, created_at DESC);

-- The poster's side: "who answered my ad", newest first.
CREATE INDEX idx_share_flat_interests_post_created
    ON share_flat_interests (post_id, created_at DESC);

COMMENT ON TABLE share_flat_interests IS
    'A reply to a flatmate ad. The sender volunteers their own contact details to the poster; '
    'nothing flows the other way. One row per (post, sender) -- resending edits the message.';

-- ---------------------------------------------------------------------------
-- The unfiltered board
-- ---------------------------------------------------------------------------
-- V7 indexed `locality` only, which serves the filtered list. The default view of the page is the
-- unfiltered one -- every live post, newest first -- and that had nothing behind it. Partial on
-- `archived = false` to match V7's existing index and because no endpoint can ask for the others.
CREATE INDEX idx_share_flat_created ON share_flat_posts (created_at DESC) WHERE archived = false;

-- V7 created share_flat_posts before this convention was universal; it has updated_at but the
-- trigger is installed by whichever migration runs this last. Idempotent, so re-running is safe.
SELECT install_updated_at_triggers();
