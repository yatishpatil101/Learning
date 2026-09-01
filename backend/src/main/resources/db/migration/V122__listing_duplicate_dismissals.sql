-- "Not a duplicate" — the ops desk's verdict that a cluster the platform derived is a coincidence.
--
-- D255. The Duplicates tab has existed since the prototype and has never had a server behind it:
-- `lib/data/properties-admin.js` ran a union-find over `localStorage` and wrote its verdicts to
-- `duplicateFlag` / `duplicateOf`, two fields no table on this platform has ever had. Against the
-- live API the tab was gated off entirely and said so, which was honest but left a real ops job
-- undone. This is the state that job needs.
--
-- WHY A DISMISSAL TABLE AT ALL, when the cluster itself is derived on demand.
--
-- Because the derivation cannot be told not to fire. `ListingDuplicateProbe` compares an
-- electricity meter, an address key and perceptual photo hashes, and every one of those collides
-- honestly: a bungalow split into two tenancies shares a doorway, a society reuses flat numbers
-- across wings, and the builder's own lobby photograph appears on every flat in the tower. The
-- probe's javadoc is emphatic that a collision is a suspicion rather than a finding, and the whole
-- design keeps a human in the loop. A human in the loop who cannot record their answer is asked
-- the same question every time they load the page, which is how a queue teaches its operators to
-- stop reading it.
--
-- WHY IT IS KEYED ON A SIGNATURE AND NOT ON A CLUSTER ID.
--
-- Clusters are computed, not stored, so they have no identity of their own — the same physical
-- pair is a different object on every request. Their one stable property is the set of listings
-- they contain, so that set IS the key: sort the member ids, join them, hash them.
--
-- This makes the resurfacing rule fall out of the key rather than needing to be coded, and the rule
-- it produces is the one we want. Dismiss {A,B}; A and B stop appearing. A third listing C then
-- collides with them: the cluster is now {A,B,C}, a different signature, and it surfaces again --
-- correctly, because "A and B are not each other's duplicate" was never a statement about C.
-- Archive B and the pair stops being a cluster at all. Nothing has to expire a dismissal, and no
-- verdict is silently applied to a set the operator never actually looked at.
--
-- The cost, stated plainly: dismissals accumulate for member-sets that can no longer occur, and
-- nothing prunes them. They are small and never read except by exact signature match, so this is a
-- housekeeping job rather than a correctness one.
--
-- WHY THE SIGNATURE IS HASHED RATHER THAN STORED AS THE JOINED IDS.
--
-- V119 records this trap from the other end: a btree entry over 2704 bytes is rejected at INSERT
-- with an internal error rather than a constraint violation. A joined list of 36-char uuids passes
-- that ceiling at about 73 members, and 73 members in one cluster is not hypothetical -- it is one
-- over-eager `AddressKey` normalisation in a large society. A sha-256 hex digest is 64 characters
-- whatever the cluster size, so the ceiling stops existing. `member_ids` below keeps the readable
-- form for humans, without an index over it.
CREATE TABLE listing_duplicate_dismissals (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- sha-256 hex of the sorted, comma-joined member uuids. Produced by
    -- `DuplicateClusterSignature.of`, which is the only thing allowed to write this format --
    -- a second implementation of "sort and hash" is how two callers stop agreeing on what a
    -- cluster is, and the symptom would be dismissals that silently never match.
    --
    -- `varchar`, not `char(64)`, though the value is always exactly 64 characters. `char` is
    -- blank-padded in Postgres and compares with trailing spaces ignored, so a lookup would
    -- succeed against a value that is not byte-identical to the one written -- forgiving in a
    -- place that must not forgive, since the whole point of the column is that two clusters are
    -- the same only if their member sets are. It also reads back padded, which invites a `trim()`
    -- on the Java side that then hides the padding from anyone reading the code.
    cluster_signature varchar(64) NOT NULL,

    -- The readable form of the same fact, for the person debugging "why is this cluster back".
    -- Deliberately not indexed and never queried: `cluster_signature` is the key, and a second
    -- lookup path over the same data is a second thing to keep in step. `jsonb` rather than
    -- `uuid[]` only because every other list column on this platform is jsonb, and one array column
    -- would be the sole reason a reader has to know how Hibernate maps Postgres arrays.
    member_ids        jsonb       NOT NULL,

    -- Always from the JWT, never from a request body.
    dismissed_by      uuid        NOT NULL REFERENCES users (id),

    -- `created_at` rather than a `dismissed_at` of its own. The row is created by the act of
    -- dismissing and is never updated -- a repeat dismissal of the same set is the same verdict, so
    -- the service no-ops rather than touching it. A second timestamp column would therefore be a
    -- synonym that can only ever drift from `created_at`, and `BaseEntity` already populates this
    -- one on every write path. There is deliberately no `updated_at`, which is why this extends
    -- `BaseEntity` and not `AuditedEntity`.
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- Unique because a dismissal is a verdict on a set, not an event log: two operators dismissing the
-- same cluster is the same verdict reached twice, and the read is an existence check. The service
-- upserts on this, so a double-click costs nothing.
--
-- `audit_log` is where the "who dismissed what, when, and how often" question is answered; this
-- table only has to answer "is this set settled".
CREATE UNIQUE INDEX ux_listing_duplicate_dismissals_signature
    ON listing_duplicate_dismissals (cluster_signature);
