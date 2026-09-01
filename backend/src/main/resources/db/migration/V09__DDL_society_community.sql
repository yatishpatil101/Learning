-- V09 DDL Society Community: everything a society page holds that a person typed in -- the B2B
-- pipeline that brings a building onto the platform, the two permission tables that say who runs a
-- society page and who lives there, and the four community surfaces (Q&A, noticeboard,
-- contributions, proposals) that used to live in the reader's own browser.
--
-- Scope: `society_leads` (the B2B pipeline), `society_claims` (a committee asking for control of
-- its own page), `society_residents` (one person's verified tenure of one flat),
-- `society_questions` / `society_answers` (the hub Q&A), `society_board_items` (the noticeboard),
-- `society_contributions` / `society_contribution_helpful` / `society_contribution_replies` (the
-- community tab) and `society_proposals` (community-proposed facts about a society, held pending).
--
-- Folded from the old chain: V24 (society_leads only -- the rest of that slice reads tables that
-- already existed), V101, V102, V103, V104 (the `society_proposals` table, its two indexes and its
-- comment only -- V104's `societies.place_id` column lives in the catalog-geo file), V106 (item 2
-- only, the removal columns on five tables; item 1's `reports` vocabulary lives in the
-- service-requests file), V109, V110.
--
-- `societies` and `users` are created before this file (catalog-geo and identity-access
-- respectively), as is `personal_documents` (documents-vault), which `society_claims` points at.
-- Within this file `society_questions` MUST precede `society_answers`, and `society_contributions`
-- MUST precede its helpful votes and its replies.

-- ---------------------------------------------------------------------------
-- Society / builder leads
-- ---------------------------------------------------------------------------
-- The B2B pipeline is the one thing the platform captures but has never stored.
--
-- A society secretary or a builder asks to put a whole building on the platform. That is not a
-- property enquiry and it does not belong in `contact_requests`: there is no listing, no owner and
-- no seeker, and the row's whole life is a sales pipeline rather than a contact unlock.
--
-- Submission is public and unauthenticated (contract: `security: []`) because the person filling it
-- in is not a user yet and demanding a login first is how B2B lead forms lose their leads. That
-- makes the table a spam target, so the write path rate-limits per mobile against this table --
-- see SocietyLeadService. No IP column: the app sits behind proxies whose header policy is not
-- settled, and a wrong client IP recorded as fact is worse than none (see D55 on referrals).
--
-- This is V24's definition, which is the considered one: it carries the `note` column the ops
-- status-update writes, drops the mobile regex on purpose (one builder legitimately enquires about
-- several societies), bounds `units`, and adds the three indexes the pipeline query and the public
-- rate limit actually need. V7 once declared a thinner sketch of the same table, and two CREATE
-- TABLEs for one relation made the old chain un-replayable -- every environment built from scratch
-- died there with 'relation "society_leads" already exists', which is why only incrementally-grown
-- databases worked. Keeping the later definition rather than the earlier sketch keeps the schema
-- that the SocietyLead entity and SocietyLeadService are written against.
CREATE TABLE society_leads (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    society_name  text        NOT NULL,
    contact_name  text        NOT NULL,
    -- Not unique, and deliberately so: one builder legitimately enquires about several societies,
    -- and a unique index here would silently drop the second building. Duplicate suppression is a
    -- rate limit, which is reversible, not a constraint, which is not.
    mobile        text        NOT NULL,
    units         integer,
    interest      text,
    status        text        NOT NULL DEFAULT 'new',
    -- Ops working notes. The contract does not return this yet; it is written by the status update
    -- so the note attached to a decision is not lost the moment the audit row scrolls away.
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT society_leads_status_check
        CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost')),
    CONSTRAINT society_leads_interest_check
        CHECK (interest IS NULL OR interest IN ('bulk-listing', 'society-services', 'partnership')),
    -- A society with zero or negative units is a typo, and `units` drives the whole prioritisation
    -- of this pipeline. 20000 is roughly four times India's largest housing society.
    CONSTRAINT society_leads_units_check
        CHECK (units IS NULL OR (units > 0 AND units <= 20000))
);

-- `GET /society-leads` is "the pipeline, newest first", optionally one status column at a time.
-- The status-first ordering serves both the filtered and the unfiltered query because Postgres can
-- read a full index scan in `created_at DESC` order within each status group, and the unfiltered
-- list is small enough for the sort that remains.
CREATE INDEX idx_society_leads_status_created ON society_leads (status, created_at DESC);
CREATE INDEX idx_society_leads_created ON society_leads (created_at DESC);

-- Backs the per-mobile rate limit on the public submit path. Without it every public POST would
-- sequentially scan a table an attacker controls the size of.
CREATE INDEX idx_society_leads_mobile_created ON society_leads (mobile, created_at DESC);

COMMENT ON TABLE society_leads IS
    'B2B pipeline: society secretaries and builders asking to bring a whole building onto the '
    'platform. Submitted publicly, read only by staff and admin.';


-- ---------------------------------------------------------------------------------------------
-- Society residency and society claims.
--
-- Everything a resident has ever typed into the society hub lived in their own browser. Both of the
-- tables below back a permission, not a preference, which is why they were the first slice of the
-- society work: the notice board is gated on "is this person a verified resident or the committee",
-- and that question cannot be answered by a localStorage array that the person answering it owns.
--
-- Why two tables and not one "membership" row. A claim is a society saying "we run this listing"
-- and is decided by ops; a residency is a person saying "I live in flat B/704" and is decided by
-- the committee once a claim exists, or by ops until then. They have different subjects, different
-- deciders and different lifetimes — a society stays claimed while residents come and go.
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- society_claims — a committee asking for control of its own society page.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE society_claims (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id  uuid NOT NULL REFERENCES societies (id),
    claimed_by  uuid NOT NULL REFERENCES users (id),
    name        text NOT NULL,
    role        text,
    email       text,
    note        text,
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    -- The two things a society claim was asking ops to check, and never carried.
    --
    -- WHY THIS EXISTS
    --
    -- `/admin/society-claims` is a proof-checking desk. An operator looking at it has to answer one
    -- question -- is this person really on the committee of this building -- and until these two
    -- columns existed the whole of the evidence was the claimant's own free-text `note`. The
    -- consumer claim form has always asked for a Maharashtra registration number and offered a
    -- certificate upload; neither existed on the wire, so the number was concatenated into `note`
    -- as a sentence and the file was written to the claimant's own browser, where the only person
    -- who needs to see it never can.
    --
    -- The ops console dropped its "Reg / Cert" column rather than render it permanently blank, and
    -- that was right: a blank proof column on a proof-checking screen reads as "the claimant
    -- supplied nothing" rather than "we never asked". These columns are the other half of that
    -- decision -- the field has to be collected before it can be reviewed.
    --
    -- WHY BOTH ARE NULLABLE
    --
    -- A committee that cannot lay hands on its registration certificate this afternoon must still
    -- be able to file a claim. Making either column NOT NULL would replace an empty column on one
    -- screen with a blocked funnel on another, and the funnel is the expensive one: the claim is
    -- how a society reaches us at all, and the operator can always ask for the paper afterwards.
    -- Proof raises confidence in a claim; its absence is not a refusal.
    --
    -- WHY `registration_no` IS FREE TEXT WITH NO CHECK
    --
    -- Maharashtra co-operative housing society registration numbers are not a format.
    -- `PNA/1234/2015`, `PNA/(PNA)/HSG/(TC)/1234/2015`, the same with a date appended, the same
    -- again from a district registrar who spaces it differently -- all are real, all are what is
    -- printed on the certificate the operator is holding. A pattern CHECK here would reject correct
    -- numbers on the strength of a guess about the ones we had happened to see, and the claimant's
    -- only recourse would be to type something false. The operator reading the certificate is the
    -- validator; the column just has to carry what they will compare against.
    registration_no text,
    -- The certificate itself. Same storage model as every other uploaded paper on the platform: the
    -- bytes live in the object store under a server-minted `storage_key` and the row here is only a
    -- pointer at the vault row that holds it (`personal_documents`, in the documents-vault file). A
    -- society registration certificate belongs to the person who filed the claim rather than to a
    -- listing, which is exactly the distinction the personal vault exists for, so that is where it
    -- lands.
    --
    -- ON DELETE SET NULL, and nullable, for the reason `property_ownership_evidence` gives about
    -- ownership evidence: deleting a file must not erase the record that a claim was filed with
    -- one, because that record is the audit trail behind a decision an operator has already taken.
    certificate_document_id uuid REFERENCES personal_documents (id) ON DELETE SET NULL,
    decided_at  timestamptz,
    decided_by  uuid REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One live claim per society, enforced by the database rather than by a read-then-write check.
-- A rejected claim is deliberately outside the index: a committee whose paperwork was wrong must be
-- able to apply again, and a society whose secretary changed must be able to be claimed by the next
-- one. Only 'pending' and 'approved' are exclusive, and they are exclusive against each other too —
-- a second committee cannot queue up behind the one that already holds the page.
CREATE UNIQUE INDEX ux_society_claims_live
    ON society_claims (society_id)
    WHERE status IN ('pending', 'approved');

-- The ops queue reads "every pending claim, oldest first" and nothing else.
CREATE INDEX idx_society_claims_status_created
    ON society_claims (status, created_at);

-- The hub asks "who administers this society" on every load for a signed-in reader.
CREATE INDEX idx_society_claims_claimed_by
    ON society_claims (claimed_by, status);

-- No index on `registration_no` or `certificate_document_id`. Neither column is ever a search key --
-- the queue is read by status and age, and both of these are read only once a row is already on the
-- operator's screen.

COMMENT ON TABLE society_claims IS
    'A committee asking to administer its own society page. Approved => societies.claim_status = claimed and the claimant becomes the society admin.';

COMMENT ON COLUMN society_claims.registration_no IS
    'The society''s Maharashtra registration number, as printed on the certificate. Free text on '
    'purpose: the format varies by registrar and a CHECK would reject correct numbers.';

COMMENT ON COLUMN society_claims.certificate_document_id IS
    'The claimant''s personal-vault row holding the scanned registration certificate, or NULL when '
    'they had none to hand. Nullable and ON DELETE SET NULL: a claim without proof is still a '
    'claim, and deleting the file must not erase the record that ops saw one.';


-- ---------------------------------------------------------------------------------------------
-- society_residents — one person's verified tenure of one flat.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE society_residents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id   uuid NOT NULL REFERENCES societies (id),
    user_id      uuid NOT NULL REFERENCES users (id),
    wing         text,
    flat         text,
    -- Wing and flat normalised into one comparable token ('B','704' -> 'B704'). Stored rather than
    -- computed because it is what the uniqueness index below is built on, and an index over an
    -- expression that has to agree with application code in two languages is a trap.
    unit_key     text NOT NULL,
    relation     text NOT NULL DEFAULT 'resident'
                 CHECK (relation IN ('owner', 'tenant', 'family', 'resident')),
    status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'verified', 'rejected')),
    -- Who owes this request a decision. A claimed society reviews its own residents; an unclaimed
    -- one has nobody to, so ops do. Stamped at request time rather than derived on read, because
    -- the answer must not change under a queue somebody is already working.
    assigned_to  text NOT NULL DEFAULT 'ops' CHECK (assigned_to IN ('ops', 'committee')),
    -- 'conflict' when a different person is already verified in this unit. Advisory: the request is
    -- still accepted and still reviewable, because a flat genuinely does change hands and the
    -- reviewer is the one who can tell a handover from an impostor.
    flagged      text,
    note         text,
    decided_at   timestamptz,
    decided_by   uuid REFERENCES users (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    -- One standing request per person per society. Re-applying replaces rather than accumulates.
    CONSTRAINT ux_society_residents_person UNIQUE (society_id, user_id)
);

-- One verified holder per flat. This is the rule the whole feature rests on — a notice board where
-- two people can both be B/704 is a notice board nobody can trust — and it is enforced here rather
-- than in the service so that two reviewers approving two claimants at the same moment cannot both
-- win. Partial, so rejected and pending rows for the same unit are free to exist.
CREATE UNIQUE INDEX ux_society_residents_unit_verified
    ON society_residents (society_id, unit_key)
    WHERE status = 'verified';

-- The committee/ops review queue: every request for one society, newest first.
CREATE INDEX idx_society_residents_society_status
    ON society_residents (society_id, status, created_at DESC);

-- "Which societies am I a verified resident of" — asked by every gated write in the hub.
CREATE INDEX idx_society_residents_user_status
    ON society_residents (user_id, status);

-- The index the cross-society residency queue reads on.
--
-- idx_society_residents_society_status above is the right index for the committee's own inbox and
-- useless for the question the ops console asks: "who is waiting anywhere, oldest first". Its
-- leading column is the society, so a query that names no society cannot use it and Postgres falls
-- back to a sequential scan of the whole table followed by a sort — a plan that is invisible on a
-- seeded database and gets worse every month the platform is alive.
--
-- Same shape and same reason as idx_society_claims_status_created above: the ops queue reads
-- "every row in this status, oldest first" and nothing else. status leads because it is the
-- equality predicate, created_at follows because it is the order; ascending, because a work queue
-- is drained from the front and Postgres can walk either direction of a b-tree anyway.
--
-- Not partial on status = 'pending'. The console filters to decided rows too — "what did we do with
-- this person" is the second question an operator asks — and a partial index would leave that read
-- on the sequential scan this index exists to remove.
CREATE INDEX idx_society_residents_status_created
    ON society_residents (status, created_at);

COMMENT ON TABLE society_residents IS
    'One person''s claimed tenure of one flat. Verified residents may post to the society board and Q&A.';


-- ---------------------------------------------------------------------------------------------
-- HOW SOCIETY HUB CONTENT IS TAKEN DOWN (`removed_at` / `removed_by`, on five tables below)
-- ---------------------------------------------------------------------------------------------
-- The society hub carries six kinds of user-written content -- recommendations,
-- replies, questions, answers, noticeboard items and reviews -- and offers a
-- "Report" control on every one of them. That control wrote to `pnSocietyReports`
-- in the reporting member's own browser, and the ops queue that was supposed to
-- read it read the *moderator's* browser. So a defamatory recommendation naming a
-- real tradesman with his real phone number could be reported by fifty neighbours
-- and no moderator would ever see one of those reports. The platform-wide
-- `reports` table has worked properly since the trust-and-safety slice -- it
-- simply did not admit that society content existed: `reports_target_type_check`
-- allowed exactly 'property', 'user', 'review' and 'post'.
--
-- Two changes, and they have to arrive together.
--
-- 1. The CHECK constraint learns the five society kinds. Five, not one
--    'society_content', because `target_id` means nothing without knowing which
--    table it indexes -- a moderator who upholds a complaint has to be able to
--    remove *that row*, and five tables means five lookups otherwise, with the
--    id ambiguity that implies. `review` is deliberately NOT duplicated there:
--    a society review is already reportable as 'review' and already has its own
--    takedown at PATCH /reviews/{id}/status. A second vocabulary word for the
--    same thing would split the queue in half. That vocabulary lives on `reports`,
--    in the service-requests file.
--
-- 2. The five content tables learn how to be taken down -- that is the
--    `removed_at` / `removed_by` pair on every content table in this file.
--    Without it there is no way: the author's own DELETE hard-deletes the row,
--    which is right for an author changing their mind and wrong for moderation --
--    it destroys the evidence the complaint was about, so an appeal, a
--    repeat-offender check and a police request all have nothing to read.
--    `removed_at` / `removed_by` keep the row and take it off the public site.
--
-- The pair moves together, enforced by a CHECK on each table, for the same reason
-- a society's verification is paired with the operator who granted it: a removal
-- with nobody's name on it cannot answer the only question it will ever be asked.
--
-- No index on the pair. Removals are a handful of rows against a table read one
-- society at a time, and the predicate rides along on the society_id lookup that
-- is already indexed; a second index here would cost every post to earn nothing.
-- ---------------------------------------------------------------------------------------------


-- ---------------------------------------------------------------------------------------------
-- Society Q&A and the notices board
--
-- The two community surfaces the hub has always drawn and never persisted. Until these tables a
-- question asked on a society page lived in `pnSocietyQA` and a maintenance-shutdown notice lived in
-- `pnSocietyBoard`, both in the asker's own browser: the committee posted an AGM notice that
-- literally nobody else could see, and every answer to a neighbour's question was written to an
-- audience of one.
--
-- WHY THREE TABLES AND NOT ONE "society_posts"
-- --------------------------------------------
-- They look alike — a body, an author, a society — and they are governed differently, which is the
-- part a shared table would erase. A question is open to any signed-in user and a board item is
-- restricted to people who actually live there, because a notice claims authority ("the water goes
-- off on Tuesday") in a way a question does not. Merging them would put that rule in a `WHERE
-- kind = 'notice'` branch of application code instead of at the endpoint, where it is enforceable
-- and readable.
--
-- Answers are their own table rather than a self-referencing parent on questions, for the same
-- reason: an answer cannot exist without a question, and a nullable `parent_id` would let one.
--
-- WHY THERE IS NO `resident` COLUMN
-- ---------------------------------
-- The hub badges an author as a verified resident. That badge is NOT stored here. It is a fact
-- about the author *today*, read from `society_residents` at render time — a stored copy would keep
-- saying "Verified resident" after the committee rejected them, which is precisely the claim the
-- badge exists to make trustworthy.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE society_questions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id  uuid NOT NULL REFERENCES societies (id),
    author_id   uuid NOT NULL REFERENCES users (id),
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    removed_at  timestamptz,
    removed_by  uuid REFERENCES users (id),
    CONSTRAINT ck_society_question_removal_pair
        CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

COMMENT ON TABLE society_questions IS
    'A question asked on a society hub. Open to any signed-in user: somebody deciding whether to '
    'move in has the most to ask and lives nowhere yet.';

CREATE INDEX idx_society_questions_society_created
    ON society_questions (society_id, created_at DESC);

CREATE TABLE society_answers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid NOT NULL REFERENCES society_questions (id) ON DELETE CASCADE,
    author_id   uuid NOT NULL REFERENCES users (id),
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    removed_at  timestamptz,
    removed_by  uuid REFERENCES users (id),
    CONSTRAINT ck_society_answer_removal_pair
        CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

COMMENT ON TABLE society_answers IS
    'An answer to a society question. ON DELETE CASCADE because an answer to a deleted question is '
    'not an orphan record, it is a fragment of a conversation nobody can read.';

CREATE INDEX idx_society_answers_question_created
    ON society_answers (question_id, created_at);

CREATE TABLE society_board_items (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id  uuid NOT NULL REFERENCES societies (id),
    author_id   uuid NOT NULL REFERENCES users (id),
    kind        text NOT NULL CHECK (kind IN ('event', 'notice')),
    title       text NOT NULL,
    body        text,
    category    text,
    event_date  date,
    event_time  time,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    removed_at  timestamptz,
    removed_by  uuid REFERENCES users (id),
    -- An event with no date is a notice wearing the wrong label: it would sort into the calendar
    -- and render with an empty date field. The database refuses it so the calendar cannot be
    -- corrupted by a caller the service forgot to validate.
    CONSTRAINT ck_society_board_event_has_date CHECK (kind <> 'event' OR event_date IS NOT NULL),
    CONSTRAINT ck_society_board_removal_pair
        CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

COMMENT ON TABLE society_board_items IS
    'The society noticeboard: dated events (AGMs, tanker days, maintenance shutdowns) and undated '
    'notices. Reading is public; posting is limited to verified residents and the committee, '
    'because a notice is an assertion about the building.';

-- Two orderings, two indexes. The board is read as "upcoming events" and "recent notices" and a
-- single index on `created_at` would leave the calendar sorting in memory.
CREATE INDEX idx_society_board_society_created
    ON society_board_items (society_id, created_at DESC);

CREATE INDEX idx_society_board_events
    ON society_board_items (society_id, event_date)
    WHERE kind = 'event';


-- =====================================================================================
-- Society contributions, their helpful votes and their replies
-- =====================================================================================
-- The third and last thing the society hub kept in `localStorage`: the community tab.
-- Tips ("the 6am water pressure is fine on the lower floors"), trusted picks (a plumber
-- the building actually uses, with a number) and photos of the place as it really looks.
-- Every one of them was written into `pnSocietyContributions` in the author's own browser,
-- so the "community" tab showed each visitor a community of one — and the most useful
-- thing on the page, a neighbour's phone number for a reliable electrician, was known only
-- to the person who already had it.
--
-- THREE TABLES, and specifically not one with a `helpful integer` column:
--
--  * `society_contributions` — the post.
--  * `society_contribution_helpful` — one ROW per (post, voter), primary-keyed on the pair.
--    A counter column cannot answer "have I already found this helpful?", which is what the
--    button renders, and it cannot stop a double tap or a retried request counting twice.
--    Un-voting is a delete; the count is `count(*)`, which cannot drift.
--  * `society_contribution_replies` — the thread under a post, cascading on delete, because
--    replies to a removed tip are answers to a question nobody can see.
--
-- ONE `body` COLUMN, not three. A tip's text, a pick's note and a photo's caption are the
-- same thing wearing three names: the prose the author wrote. What genuinely differs is the
-- STRUCTURED part — a pick has a name and a number, a photo has a URL — and those get their
-- own columns and their own check constraints.
--
-- The checks are deliberately two-sided. `ck_society_contrib_kind_shape` insists a tip has
-- prose, a pick has a name and a photo has a URL — the "not empty" half. It also insists a
-- non-pick carries NO referral name or number and a non-photo carries NO photo URL. That
-- second half is a privacy rule, not tidiness: a contact detail stored on a row whose UI
-- neither renders it nor offers to remove it is a phone number nobody can get back.
--
-- `photo_url` is a URL, never a data URI. Images go through `POST /me/photos` to the public
-- bucket first; the browser build stored base64 in localStorage, which is why a photo
-- contribution was invisible on any other device and why the composer had a "too large"
-- warning at all.

CREATE TABLE society_contributions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id        uuid NOT NULL REFERENCES societies (id),
    author_id         uuid NOT NULL REFERENCES users (id),
    kind              text NOT NULL,
    category          text,
    body              text,
    referral_name     text,
    referral_contact  text,
    photo_url         text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    removed_at        timestamptz,
    removed_by        uuid REFERENCES users (id),
    CONSTRAINT ck_society_contrib_kind CHECK (kind IN ('tip', 'pick', 'photo')),
    CONSTRAINT ck_society_contrib_kind_shape CHECK (
        CASE kind
            WHEN 'tip'   THEN body IS NOT NULL
                          AND referral_name IS NULL AND referral_contact IS NULL
                          AND photo_url IS NULL
            WHEN 'pick'  THEN referral_name IS NOT NULL
                          AND photo_url IS NULL
            WHEN 'photo' THEN photo_url IS NOT NULL
                          AND referral_name IS NULL AND referral_contact IS NULL
            ELSE false
        END
    ),
    CONSTRAINT ck_society_contribution_removal_pair
        CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

CREATE INDEX idx_society_contrib_society_created
    ON society_contributions (society_id, created_at DESC);

COMMENT ON TABLE society_contributions IS
    'Community tab posts on a society hub: tips, trusted picks and photos. One `body` column '
    'because a tip''s text, a pick''s note and a photo''s caption are all the author''s prose; '
    'the structured per-kind fields are separate and check-constrained both ways, so a photo '
    'cannot quietly carry a stranger''s phone number that no screen will ever show or delete.';

COMMENT ON COLUMN society_contributions.removed_at IS
    'Taken off the public site by a moderator. The row survives: the complaint was about its '
    'contents, so destroying them destroys the appeal, the repeat-offender check and any later '
    'lawful request. Null for everything the public can read.';

COMMENT ON COLUMN society_contributions.removed_by IS
    'The moderator who removed it. Paired with removed_at by ck_society_contribution_removal_pair.';

CREATE TABLE society_contribution_helpful (
    contribution_id   uuid NOT NULL REFERENCES society_contributions (id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES users (id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (contribution_id, user_id)
);

COMMENT ON TABLE society_contribution_helpful IS
    'One row per person per contribution. The composite primary key is the whole point: it '
    'makes a second vote from the same person impossible rather than merely unlikely, so a '
    'double tap or a retried request on a bad connection cannot inflate the count.';

CREATE TABLE society_contribution_replies (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contribution_id   uuid NOT NULL REFERENCES society_contributions (id) ON DELETE CASCADE,
    author_id         uuid NOT NULL REFERENCES users (id),
    body              text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    removed_at        timestamptz,
    removed_by        uuid REFERENCES users (id),
    CONSTRAINT ck_society_reply_removal_pair
        CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

CREATE INDEX idx_society_contrib_replies_parent
    ON society_contribution_replies (contribution_id, created_at);

COMMENT ON TABLE society_contribution_replies IS
    'Threaded replies under a contribution, oldest first, cascading on delete — a reply to a '
    'removed tip is an answer to a question the reader cannot see.';


-- =====================================================================================
-- Community proposals about a society: details, the WhatsApp group, the map pin
-- =====================================================================================
-- Three features, one table, on purpose.
--
-- A detail suggestion, a resident WhatsApp invite and a corrected map pin are the same
-- lifecycle wearing three names: somebody who knows the building proposes a fact, ops
-- screen it, and on approval it is written onto the society itself. They share the same
-- queue, the same "already decided, do not double-write" rule, and the same question of
-- who is allowed to propose. Three parallel tables would be three places for that rule to
-- drift, and the drift would be invisible until the day one of them silently reverted an
-- operator's decision.
--
-- What differs between them is the payload, so the payload gets columns rather than a jsonb
-- blob: `invite_url` has a format the database can refuse, `lat`/`lng` have a range, and a
-- suggestion of "towers: 4" is a number nobody should have to cast out of JSON at read time.
--
-- `ck_society_proposal_shape` is two-sided, exactly like the contributions check above. It
-- insists a proposal of each kind carries what that kind means, AND that it carries nothing
-- belonging to another kind. The second half is not tidiness: a WhatsApp invite riding along
-- on a detail suggestion would be approved by an operator reviewing a builder's name, which
-- is precisely the review the invite is supposed to get.
--
-- The two facts an approved proposal writes that the societies table had nowhere to put are
-- `place_id` and `loc_source`, declared on `societies` in the catalog-geo file. `place_id` is
-- the only Google Place field persisted besides the coordinates; nothing else (ratings, photos,
-- reviews, opening hours) may be stored, per the Places terms.

CREATE TABLE society_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id uuid NOT NULL REFERENCES societies (id),
    author_id uuid NOT NULL REFERENCES users (id),
    kind text NOT NULL,
    status text NOT NULL DEFAULT 'pending',

    -- details
    builder text,
    build_year integer,
    towers integer,
    units integer,
    maintenance_per_sqft numeric,
    amenities jsonb,

    -- whatsapp
    invite_url text,

    -- location
    lat double precision,
    lng double precision,
    place_id text,
    label text,

    decided_by uuid REFERENCES users (id),
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_society_proposal_kind
        CHECK (kind IN ('details', 'whatsapp', 'location')),
    CONSTRAINT ck_society_proposal_status
        CHECK (status IN ('pending', 'approved', 'rejected')),
    -- A decision has a decider and a moment; a pending proposal has neither. Without this a
    -- rejected row can carry no record of who rejected it, which is the one thing the author
    -- will ask about.
    CONSTRAINT ck_society_proposal_decision
        CHECK ((status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
            OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
    CONSTRAINT ck_society_proposal_shape CHECK (
        CASE kind
            -- At least one detail, or the proposal says nothing and still occupies a queue.
            WHEN 'details' THEN
                (builder IS NOT NULL OR build_year IS NOT NULL OR towers IS NOT NULL
                 OR units IS NOT NULL OR maintenance_per_sqft IS NOT NULL
                 OR amenities IS NOT NULL)
                AND invite_url IS NULL
                AND lat IS NULL AND lng IS NULL AND place_id IS NULL AND label IS NULL
            WHEN 'whatsapp' THEN
                invite_url IS NOT NULL
                AND builder IS NULL AND build_year IS NULL AND towers IS NULL
                AND units IS NULL AND maintenance_per_sqft IS NULL AND amenities IS NULL
                AND lat IS NULL AND lng IS NULL AND place_id IS NULL AND label IS NULL
            -- Half a point is not a point: a latitude with no longitude lands the map in the
            -- sea, which is worse than the wrong pin it was meant to correct.
            WHEN 'location' THEN
                lat IS NOT NULL AND lng IS NOT NULL
                AND builder IS NULL AND build_year IS NULL AND towers IS NULL
                AND units IS NULL AND maintenance_per_sqft IS NULL AND amenities IS NULL
                AND invite_url IS NULL
            ELSE false
        END)
);

-- One pending proposal per society per kind. A resident who re-proposes is correcting their
-- own submission, not queueing a second one for an operator to reconcile; the service upserts
-- onto this index. Decided rows are deliberately outside it, so the history of what was
-- approved and rejected survives.
CREATE UNIQUE INDEX uq_society_proposal_pending
    ON society_proposals (society_id, kind)
    WHERE status = 'pending';

-- The ops queue reads by status, oldest first: a proposal that has waited longest is the one
-- somebody is still waiting on.
CREATE INDEX idx_society_proposal_queue
    ON society_proposals (status, created_at);

COMMENT ON TABLE society_proposals IS
    'Community-proposed facts about a society (details, WhatsApp group invite, map pin), held '
    'pending until ops decide. On approval the value is written onto societies itself — these '
    'rows are the audit trail, not the source the hub reads.';


-- Wire trg_set_updated_at onto every new table (convention: every migration ends with this).
SELECT install_updated_at_triggers();
