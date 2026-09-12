-- V11 DDL Engagement, Billing & Growth: everything a signed-in consumer accumulates on top of the
-- catalogue -- what they saved, what they searched, what they pay for, what they ordered, what they
-- were told, and who they brought with them.
--
-- Scope: `saved_properties`, `saved_searches` and `recent_searches` (engagement); `plans` and
-- `subscriptions`, `boost_packs` and `boosts`, `service_offerings` and `service_orders` (billing);
-- `support_tickets` and `support_ticket_messages` (consumer support, deliberately distinct from the
-- ops `tickets` board in the service-requests file); `notifications` (the in-app inbox); and
-- `referrals` with `referral_codes` (growth).
--
-- Folded from the old chain: V7 (the `referrals` statements only -- V7's tickets, service requests
-- and reports belong to the service-requests file, its reviews to the CMS file, and its documents
-- column to the vault file), V8 (everything except the CMS tables, which belong to the CMS file),
-- V16 (the `notifications` index only; its review-trust and length-bound statements belong
-- elsewhere), V17, V22 (the support-ticket index only -- V22's conversations and messages work
-- belongs to the leads file, and the `enquiries` table V22 created is dropped later in the chain
-- and is therefore never created anywhere), V23, V26 (the `support_tickets.version` column only),
-- V27 (the `saved_searches` statements only -- V27's flatmate tables belong to the flatmates file),
-- V35, V44, V45, V46 (the `subscriptions`/`boosts` version columns only; `rent_payments` belongs to
-- the tenancy/finance file), V53, V57, V60, V64, V73 (the `notifications.deliver_after` column only
-- -- V73's `notification_preferences` table belongs to the identity file), V87, V91, V121.
--
-- ORDERING: `plans` before `subscriptions`, `boost_packs` before `boosts`, `service_offerings`
-- before `service_orders`, and `support_tickets` before `support_ticket_messages`, because in each
-- pair the second carries a foreign key to the first and the reference must resolve at CREATE time.
-- `users` and `properties` are created by earlier files.
--
-- No DML: every INSERT/UPDATE in the folded migrations was a backfill over rows that only exist in
-- an already-populated database. Where such a backfill carried reasoning that still describes how
-- the running system behaves, that reasoning is preserved below and marked as historical.

-- ---------------------------------------------------------------------------------------------
-- saved_properties
-- ---------------------------------------------------------------------------------------------
CREATE TABLE saved_properties (
    user_id     uuid NOT NULL REFERENCES users(id),
    property_id uuid NOT NULL REFERENCES properties(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, property_id)
);

-- ---------------------------------------------------------------------------
-- saved_properties: GET /me/saved
-- ---------------------------------------------------------------------------
--
-- The primary key (user_id, property_id) answers both the membership check and the delete, but
-- the list read is `WHERE user_id = ? ORDER BY created_at DESC` -- created_at is not in the key at
-- all. The PK stays: it is the uniqueness constraint that makes the save idempotent, and it is the
-- key the ON CONFLICT DO NOTHING insert depends on.
CREATE INDEX idx_saved_properties_user_created
    ON saved_properties (user_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- saved_searches: alerting. filters as JSONB (structured) alongside the URL query string.
--
-- SAVED SEARCHES CARRY TWO KINDS.
-- The alerts table was built for listings, where a search IS a URL query string. A flatmates alert
-- is a structured criteria object over a tab-gated filter set, and squeezing it into `query` would
-- mean parsing a query string to decide which tab an alert watches. Hence `kind`, `criteria`,
-- `label` and `mobile`.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE saved_searches (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    name            text,

    -- `query` was NOT NULL, which is correct for a listings alert and impossible for a flatmates
    -- one. The requirement does not disappear, it becomes conditional -- so it moves from the
    -- column to the ck_saved_searches_payload CHECK below, which states which kind needs which
    -- payload.
    query           text,
    filters         jsonb NOT NULL DEFAULT '{}'::jsonb,

    alert_frequency text NOT NULL DEFAULT 'daily' CHECK (alert_frequency IN ('off','instant','daily','weekly')),

    -- V8 declared channel IN ('whatsapp','email','push') but the contract has always listed `sms`
    -- too, so an SMS alert was a 500 from a constraint rather than a 422 from validation. The
    -- vocabulary below is the corrected one (V27).
    channel         text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms','email','push')),

    new_count       integer NOT NULL DEFAULT 0,

    kind            text NOT NULL DEFAULT 'listings' CHECK (kind IN ('listings','flatmates')),
    criteria        jsonb,
    label           text,
    mobile          text CHECK (mobile IS NULL OR mobile ~ '^[6-9][0-9]{9}$'),

    -- Why this column has to exist before the alert can be sent. `saved_searches` has carried
    -- `alert_frequency` (off | instant | daily | weekly) since V7, the UI has offered the choice for
    -- as long, and nothing has ever read it -- because nothing has ever sent an alert (D94). The
    -- sweep recomputes `new_count` every thirty minutes and stops there, so the promise on the card
    -- ("Daily") has never been kept or broken; it simply had no referent.
    --
    -- Sending on every sweep would give it one, and the wrong one. A user who chose "Daily" would be
    -- notified every thirty minutes the moment inventory moved, which is not a partial
    -- implementation of their choice -- it is the opposite of it, delivered under its name. The
    -- frequency is only meaningful against a record of when the last alert went out, and there is
    -- nowhere else to keep that: `updated_at` cannot serve, because the sweep writes it whenever
    -- `new_count` changes, including when the count falls and nobody is told anything.
    --
    -- Why nullable, with no backfill. Null means "this alert has never fired", which is true of
    -- every row in existence, and the reader treats it as "due". Backfilling now() would suppress
    -- the first alert for every existing user for a day or a week, silencing exactly the people who
    -- have been waiting longest for the feature to work. Backfilling created_at would be a
    -- fabricated claim that an alert was delivered on the day the search was saved.
    --
    -- No index. The sweep already reads every row in id order by design; this column is only ever
    -- examined on a row that has been loaded, and is never a search predicate.
    last_alerted_at timestamptz,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_saved_searches_payload
        CHECK ((kind = 'listings'  AND query IS NOT NULL)
            OR (kind = 'flatmates' AND criteria IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- Index the per-user engagement list reads (slice 8 review follow-up)
-- ---------------------------------------------------------------------------
--
-- V16 fixed this same class of defect for `notifications`; a review pass over the rest of the
-- slice-8 read surface found two more of it (`saved_searches` here and `saved_properties` above).
-- Both endpoints answer "mine, newest first" over a table that grows without bound as a user uses
-- the product, and in both cases the naive key satisfies the WHERE but not the ORDER BY -- so
-- Postgres finds the rows cheaply and then sorts every one of them, on every request, for exactly
-- the users who have the most rows.
--
-- api-standards.md §5: every sort must be index-backed.
--
-- Deliberately NOT indexed at all: announcements, banners, cms_services and faqs. Those are
-- editor-curated tables of a few dozen rows whose entire contents are read on every call; the
-- planner would ignore an index in favour of a sequential scan, so adding one would be cost
-- without benefit. They are bounded by an editor's patience, not by user growth -- which is the
-- distinction that matters here.
--
-- saved_searches: GET /me/saved-searches. The read is `WHERE user_id = ? ORDER BY created_at DESC`.
-- A bare (user_id) index -- the original shape -- leaves that sort unbacked, and is a redundant
-- prefix of the extended key below, so only the extended key exists.
CREATE INDEX idx_saved_searches_user_created
    ON saved_searches (user_id, created_at DESC);

CREATE INDEX idx_saved_searches_kind ON saved_searches (user_id, kind);

COMMENT ON COLUMN saved_searches.last_alerted_at IS
    'When this saved search last sent its owner a match alert. Null = never fired; the cadence in alert_frequency is measured from here, not from updated_at.';

-- ---------------------------------------------------------------------------------------------
-- Recent searches for a signed-in account: the "Resume your search" rail on Home and Dashboard.
--
-- These have lived in `localStorage` under `dzRecentSearches:<mobile>` since the prototype, and
-- `lib/localPrefs.js` argues at length that they belong there -- that a browsing trail is a fact
-- about a browser, not an account, and that collecting it server-side buys a small convenience at
-- the cost of a permanent record of what one person looked for. That argument is still right about
-- *anonymous* visitors, and they keep the local list unchanged. It is wrong about signed-in ones for
-- one concrete reason: the mobile-keyed bucket already promises per-account continuity and cannot
-- deliver it. A user searches on their phone, opens the laptop, and the rail that says "resume your
-- search" is empty; clearing site data loses it on the same device. A promise the storage cannot
-- keep is worse than no promise.
--
-- What that costs is bounded here rather than left to a retention policy nobody re-reads. Six rows
-- per user, hard-enforced on write, holding a label the user already saw on screen and a relative
-- URL of our own search pages. No IP, no user agent, no timestamps of anything but the search
-- itself, and nothing about which listings were opened -- `dzRecentProps` stays in the browser,
-- because a list of the individual homes a person looked at is exactly the sensitive artefact
-- `localPrefs.js` refused to create, and moving it here would create it.
--
-- NOT `saved_searches` (the alerts table), despite the family resemblance. A saved search is a
-- standing instruction the user deliberately created and expects to survive until they delete it,
-- with an alert frequency attached. A recent search is a byproduct of navigating, silently evicted
-- six searches later. Sharing a table would mean an alert row that can disappear because the user
-- kept browsing, which is a bug report waiting to happen.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE recent_searches (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- No ON DELETE CASCADE, matching every other user-owned table here: accounts are soft-deleted
    -- (`users.deleted_at`) and erasure runs through `User.erasePersonalData`, so there is no hard
    -- delete for a cascade to serve. A search trail carries no personal data of its own once the
    -- account behind it is pseudonymised.
    user_id     uuid NOT NULL REFERENCES users(id),

    -- What the user saw on the chip: "Rent | 2 BHK | Baner". Presentation only -- it is NOT the
    -- identity of the row, because two different searches can render the same label and the same
    -- search can render two labels once copy or locale changes.
    label       varchar(200) NOT NULL,

    -- The identity of the row. A relative URL on one of our own search pages, validated at the
    -- service boundary against an allowlist of paths; nothing external, protocol-relative or
    -- absolute reaches this column. Length-capped well under the index limit because a search URL
    -- is a handful of short query parameters and anything longer is a client bug or an attempt.
    url         varchar(500) NOT NULL,

    -- When the user last ran this search, which is what the rail sorts by. Deliberately its own
    -- column rather than a reuse of `updated_at`: re-running an identical search must move the row
    -- to the top, and if the only writes were to columns that already hold those values Hibernate
    -- would find the entity clean and skip the UPDATE entirely -- leaving `updated_at` where it was
    -- and the MRU order silently wrong. A column the service always sets is what makes the touch a
    -- real write.
    searched_at timestamptz NOT NULL DEFAULT now(),

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per user per search. This is what makes re-running a search a touch instead of a
-- duplicate, and it is deliberately keyed on the URL rather than the label: the label is what the
-- user read, the URL is what the search *was*. The old client de-duplicated by label, so two genuinely
-- different searches that happened to render the same chip collapsed into one and the user lost one
-- of them.
--
-- Also the read path: the rail fetches `WHERE user_id = ? ORDER BY searched_at DESC LIMIT 6`, and
-- this index narrows that to at most six rows before any sort happens. A second index on
-- `(user_id, searched_at DESC)` was considered and dropped -- sorting six rows is free, and an
-- index maintained on every search to save it would not be.
CREATE UNIQUE INDEX uq_recent_searches_user_url ON recent_searches (user_id, url);

-- ---------------------------------------------------------------------------------------------
-- Billing & Growth
-- ---------------------------------------------------------------------------------------------
CREATE TABLE plans (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    audience      text CHECK (audience IN ('owner','tenant','buyer','agent')),
    price         bigint NOT NULL DEFAULT 0,
    billing_cycle text CHECK (billing_cycle IN ('monthly','quarterly','yearly')),
    features      jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- `plans.listing_limit` / `plans.contact_limit`: a plan's entitlements as numbers, not prose
    -- (tech-debt D109, closed).
    --
    -- WHAT IT MEANS
    -- -------------
    -- How many live listings a plan allows, and how many owner contacts it grants, are hard numbers
    -- the paywall enforces. The plan row carried them only inside `features` — `"2 live listings"`,
    -- `"Unlimited owner contacts"` — which is display copy, not a field. So the client kept its own
    -- lookup table (`PLAN_LISTING_LIMITS = { owner2: 2, owner5: 5, ... }`) to know the real ceiling,
    -- duplicating a number the server already knows and letting the two drift the moment the copy is
    -- reworded. Parsing the integer back out of the sentence was the alternative and is worse: a
    -- paywall that silently reads the wrong ceiling leaks revenue in the generous direction.
    --
    -- These two columns give the number a home. The mapper projects them onto `PlanDto` and the
    -- client reads them off the wire, deleting the table.
    --
    -- NULLABLE ON PURPOSE — NULL MEANS "NO CAP"
    -- -----------------------------------------
    -- A null limit is a real answer, not a missing one: it means the plan imposes no ceiling on that
    -- dimension. Seeker Plus is a tenant plan, so it has no listing limit (null); its owner contacts
    -- are "unlimited", so it has no contact limit (null). An owner plan has no contact limit either
    -- — the limit only applies to the audience it is written for. The client already uses
    -- `Number.isFinite` as its unlimited idiom, so a null maps cleanly to "no ceiling" without a
    -- sentinel.
    listing_limit integer,
    contact_limit integer,

    -- D31b. The referral reward stops being money and becomes owner contacts, and the contact quota
    -- stops being a number in one browser.
    --
    -- Two things were wrong at once, and they were the same thing.
    --
    -- 1. The server paid a referral in rupees ("₹500 Draazy credit") while every screen the
    --    referrer could see promised "+15 owner contacts". `ReferralSummary.rewardsEarned` and
    --    `rewardsPending` were fetched by the frontend and rendered by nothing, because there was no
    --    rupee anywhere in the product to spend them on. The contract had it right all along --
    --    `Referral.reward` is documented in the OpenAPI as "Human label, e.g. '+15 owner contacts'"
    --    -- and the implementation drifted. This settles it in favour of the contract and the
    --    screens.
    --
    -- 2. The "+15" itself was `localStorage`: `dzContactsUsed:<mobile>` plus an allowance derived
    --    from `dzReferralStats:<mobile>`. A user who changed device lost every contact they had
    --    earned, and a user who opened devtools had as many as they liked. The frontend's own
    --    comment said so: "Prototype only -- the counter lives in localStorage and is NOT real
    --    security."
    --
    -- What an owner contact actually is, given D5. The owner's raw mobile is never revealed to a
    -- buyer, whatever the gate says -- so a contact is not a phone number. It is the right to open a
    -- `contact_requests` row: to put yourself in front of one owner and ask. That is the scarce
    -- thing, that is what is worth metering, and that is what the referral now pays in.
    --
    -- WHY THIS CHANGE ADDS ALMOST NOTHING.
    --
    -- There is no `contact_unlocks` table and no `contacts_used` column, deliberately.
    -- `uq_contact_requests_requester_property` already guarantees one row per (requester, listing),
    -- so `count(*) from contact_requests where requester_id = ?` is an exact, race-proof count of
    -- the distinct owners a caller has approached. A denormalised counter would be a second source
    -- of truth for a number the database already holds correctly, and the two would disagree the
    -- first time a row was inserted by anything but the one service that remembered to increment.
    --
    -- The referral grant is derived the same way, from `referrals.qualified_at` and
    -- `referrals.status`. That is not a shortcut either: a reward that is stored gets clawed back by
    -- hand, and a reward that is derived is withdrawn the instant the fraud desk moves the referral
    -- to `clawed-back`. The clawback becomes real rather than cosmetic, for free.
    --
    -- So the only fact that had nowhere to live is this column: which plans lift the contact ceiling
    -- entirely.
    --
    -- `plans.contact_limit` (above) could not answer this. It is NULL on all four seeded rows and its
    -- own comment admits it means two different things at once -- "unlimited / not-applicable" -- so
    -- an owner plan with no contact limit and a tenant plan with unlimited contacts are stored
    -- identically. A boolean that means one thing is worth more than a nullable integer that means
    -- either.
    --
    -- `contact_limit` is left exactly as it is: it is display data on the pricing page and changing
    -- it would move a number on a screen for no reason. This column is entitlement, and nothing
    -- renders it.
    --
    -- WHICH PLANS GET IT. The three priced plans lift the ceiling; Owner Free does not. That mirrors
    -- exactly what the browser used to enforce (`UNLIMITED_CONTACT_PLANS = ['seeker-plus', 'owner2',
    -- 'owner5']`), so nobody's entitlement changed on the day it shipped -- it only started being
    -- true on the server. It is keyed off the literal seeded ids rather than off `price > 0`,
    -- because "priced" and "unlimited" are two different decisions that happen to coincide today,
    -- and a promotional free month of Seeker Plus must not silently withdraw the entitlement it is
    -- promoting. `R__seed_reference_data.sql` inserts the plan rows with this column already set
    -- correctly, so a fresh database and an upgraded one agree.
    unlimited_contacts boolean NOT NULL DEFAULT false,

    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- subscriptions
--
-- V8's status vocabulary began at `active`, which left no way to record a subscription whose
-- checkout has been opened but not completed. The only two things a server can do with that gap
-- are both wrong: activate on `POST` (and hand out the plan to anyone who abandons the payment
-- page) or persist nothing until the webhook (and have `201` return a row that does not exist).
-- Spec fix S50 added `pending`, which is both the widened vocabulary and the default below.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE subscriptions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id),
    plan_id    uuid NOT NULL REFERENCES plans(id),
    status     text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'past-due', 'cancelled', 'expired')),
    started_at timestamptz NOT NULL DEFAULT now(),
    renews_at  timestamptz,

    -- The gateway order id. Unique (see uq_subscriptions_payment_ref), because it is what the
    -- payment webhook matches on: two rows claiming the same order would make "which subscription
    -- did this money buy?" ambiguous at exactly the moment it matters. The index is partial, because
    -- a free plan never creates an order.
    payment_ref text,

    -- The client's `Idempotency-Key`, scoped per user exactly as rent's is scoped per tenancy. A
    -- double-tapped Subscribe button must not produce two charges, and the header is the only thing
    -- that can tell a retry apart from a deliberate second purchase.
    idempotency_key text,

    -- Optimistic-locking counter (D161). See the block above CREATE TABLE boosts for why the two
    -- payment families gained a version column and what race it closes.
    version    bigint NOT NULL DEFAULT 0,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_subscriptions_payment_ref
    ON subscriptions (payment_ref) WHERE payment_ref IS NOT NULL;

CREATE UNIQUE INDEX uq_subscriptions_idempotency
    ON subscriptions (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- `GET /me/subscription` is "my current one", newest first. An index on user_id alone -- the
-- original shape -- leaves that sort unbacked and is a redundant prefix of this key, so only this
-- one exists.
CREATE INDEX idx_subscriptions_user_started ON subscriptions (user_id, started_at DESC);

-- ---------------------------------------------------------------------------------------------
-- The unpaid-order cap on subscriptions, enforced by the database (D160).
--
-- WHAT WAS WRONG
-- --------------
-- `POST /me/subscription` opens a real Cashfree order for every priced plan and had nothing
-- bounding how many a caller may hold open at once. The `Idempotency-Key` header is the only thing
-- that ever collapsed two attempts into one, and it is optional: omit it and the replay branch is
-- skipped entirely, so a loop over the endpoint opens unbounded live gateway orders against our
-- merchant account at no cost to the caller. `WriteRateLimitFilter` bounds the *rate* of those
-- requests; it does not bound the *total*, and an attacker who is content to be slow is unaffected.
--
-- Service requests already have this cap (D153, `uq_service_requests_open_unpaid`). Subscriptions
-- and boosts were simply never given one, on two paths that create exactly the same kind of order.
-- This index is the subscription half; the boost half is `uq_boosts_open_unpaid` below.
--
-- WHY THIS SHAPE
-- --------------
-- Partial, on (user_id) WHERE status = 'pending', because the invariant is exactly "one outstanding
-- unpaid order per person" and nothing wider. A subscription that is paid for (`active`), cancelled,
-- superseded or expired leaves the index entirely, so a customer may buy as many plans over their
-- lifetime as they like -- the cap is on *outstanding* orders, not on volume. This mirrors
-- `uq_service_requests_open_unpaid` and, like it, is what actually holds under concurrency:
-- the service's count-then-insert is an unlocked read over rows that do not exist yet, so N
-- concurrent callers all read zero. Only a uniqueness constraint can settle that argument, because
-- the database evaluates it at write time.
--
-- No `type` column in the key, unlike the service-request cap's (requester_id, type). A service
-- request has five desks and holding an unpaid conveyancing request should not block an unpaid rent
-- agreement; a subscription has one product family -- you are either buying a plan or you are not
-- -- so the family is the whole table and the user is the whole key.
--
-- The index matches SubscriptionService.MAX_OPEN_UNPAID_PER_USER = 1 exactly. Raising that constant
-- means replacing this index (a unique index cannot express "at most N"); its javadoc says so,
-- because the failure mode otherwise is the service waving a second order through and the database
-- refusing it with a message about the first.
--
-- PRE-EXISTING VIOLATIONS (historical: the retirement pass is not reproduced here)
-- -----------------------
-- Unlike the service-request cap, a backfill was required when this index first shipped (V44).
-- `pending` had existed since V23 with nothing capping it, so a user who opened two checkouts really
-- could hold two rows, and CREATE INDEX would then have failed the deploy on data the application
-- itself produced. Failing loudly is the right answer when the offending row would be a defect (the
-- service-request case); it is the wrong answer when the offending row is the documented previous
-- behaviour. A freshly created database has no such rows, so the pass is omitted here -- but its
-- reasoning is retained, because it still describes how the running system behaves.
--
-- The surplus rows were cancelled, keeping one per user, and the retention order was deliberate:
--
--   1. a row that HAS a payment_ref outranks one that does not. A row without a ref never reached
--      the gateway, so no money can ever arrive for it -- it is unreachable by construction and is
--      the safest thing to retire.
--   2. then the newest, because that is the checkout the customer most likely still has open.
--   3. then by id, purely so the statement is deterministic.
--
-- Cancelling releases the idempotency key with the status, for the same reason
-- `Subscription.abandonUnopened` does: the web client derives its key from the plan (`sub:<planId>`),
-- so a cancelled row that kept its key would be replayed on every later attempt and the customer
-- could never buy that plan again.
--
-- Residual risk, stated rather than hidden, in two parts.
--
-- The tiebreak prefers a row that HAS a payment_ref, but when a user holds two of those it keeps the
-- newest -- and the older one could be the one that was actually paid, with its webhook still
-- undelivered or lost. That row would be cancelled, and the payment reconciled against a
-- cancelled subscription. It is a narrow case (it needs two live orders and an in-flight settlement
-- on the older one) and it cannot be resolved from inside a migration, which is why every retired
-- row was logged with its gateway order id: the notices were the reconciliation list. Refusing
-- to deploy instead would have traded a handful of reconcilable rows for an outage.
--
-- And if a retired row's order is paid afterwards, the webhook finds it `cancelled`,
-- `Subscription.activate` refuses the transition, and `SubscriptionService.reportRefusedSettlement`
-- logs it at ERROR with the order id -- deliberately louder than the routine redelivery it used to
-- be mistaken for. Money taken with no plan granted is a support case, not silent corruption.
--
-- LOCKS
-- -----
-- Accepted, not overlooked, on the incremental path this replaces: the index was built
-- non-concurrently, so writes to `subscriptions` blocked for the duration. CONCURRENTLY cannot be
-- used -- it may not run inside a transaction, and Flyway wraps each migration in one -- and the
-- table is small enough that the pause is shorter than the deploy that contains it. If
-- `subscriptions` ever grows to where that stops being true, a future change to this index needs
-- splitting into a manual concurrent build plus a validating migration.
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_subscriptions_open_unpaid
    ON subscriptions (user_id)
    WHERE status = 'pending';

COMMENT ON COLUMN subscriptions.version IS
    'Optimistic-locking counter (D161). Maintained by Hibernate; raw SQL updates bypass it.';

-- ---------------------------------------------------------------------------------------------
-- boost_packs / boosts
-- ---------------------------------------------------------------------------------------------
CREATE TABLE boost_packs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    price         bigint NOT NULL DEFAULT 0,
    duration_days integer,
    placement     text CHECK (placement IN ('top','featured','homepage')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- Optimistic locking on the payment rows the abandoned-checkout sweep writes (D161).
--
-- WHAT WAS WRONG
--
-- D161 gave `subscriptions`, `boosts` and `rent_payments` a second concurrent writer. Until then
-- each of these rows had exactly one path out of its unpaid state -- the Cashfree webhook -- so the
-- "single owner" argument D48 used to keep versioning off most tables held here too. The sweep
-- breaks that: it selects unpaid rows past the TTL and retires them, on a timer, from a different
-- thread than the webhook fan-out.
--
-- Under READ COMMITTED those two writers lose data in one specific interleaving, and it is the
-- expensive one. The sweep's SELECT takes its snapshot and sees the row as unpaid; the webhook then
-- commits `active`; the sweep's UPDATE (matched by primary key alone) blocks, then overwrites the
-- settled row with `cancelled`. A customer who paid is cancelled, no exception is raised anywhere,
-- and the only trace is a log line saying the sweep did its job. The per-row status re-check in
-- Subscription.abandonCheckout() cannot catch this, because it reads the same stale snapshot.
--
-- `service_requests` was never exposed to it: that table was versioned for D48, which is exactly why
-- D152's sweep -- the one D161 generalised -- has always been safe. This brings the other three up
-- to the shape the one that already worked has. (`rent_payments.version` is declared in the
-- tenancy/finance file; the two declared here are `subscriptions.version` and `boosts.version`.)
--
-- WHY THIS SHAPE
--
-- VersionedEntity's Javadoc names this situation as its own extension point: "the next entity that
-- genuinely gains a second concurrent writer changes one word". This is that entity, three times
-- over. The alternative -- a guarded bulk UPDATE per family, re-evaluating the status at write time
-- -- would work, but it would make the three new families structurally different from the one they
-- were generalised with, and it would move the transition out of the entity that owns it. Adding
-- the column that the working family already has is both smaller and truer.
--
-- The loser of the race matches zero rows and raises OptimisticLockingFailureException. In the
-- sweep that aborts the family's batch for this tick and it retries in ten minutes, by which time
-- the row is settled and out of the query. In the webhook it surfaces as a 409 to Cashfree, which
-- redelivers. Both outcomes are correct and neither loses the payment.
--
-- `default 0` matters for the rows that already exist: @Version maps to a primitive long, so a null
-- would be read as a detached-entity marker and turn the next update into an insert attempt.
-- `not null` is what makes the lock unskippable -- a nullable version column is an optional lock.
--
-- Lock note: on the incremental path this replaces, `add column ... default` is metadata-only on
-- PostgreSQL 11+, so it did not rewrite the three tables.
--
-- ---------------------------------------------------------------------------------------------
-- boosts: the same three payment problems as subscriptions, and the same three answers (spec fix
-- S51) -- a `pending` state, a gateway handle and a retry key.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE boosts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id),
    pack_id     uuid NOT NULL REFERENCES boost_packs(id),

    -- WHY THE CAP NEEDED A COLUMN FIRST
    -- --------------------------------
    -- V23 chose to scope the boost idempotency key by `property_id` and wrote down its reasoning:
    -- "the row has no buyer column, and the buyer is always the listing's owner". That is true and
    -- it was the right call for a retry key -- but it cannot express the cap, which is per *person*.
    -- Scoping the cap to the listing instead would let one owner hold as many live orders as they
    -- hold listings, which is a bound but not the one the product asked for ("one outstanding unpaid
    -- order per user per product family", matching the service-request cap).
    --
    -- So `buyer_id` records who actually bought this window, stamped at purchase rather than derived
    -- from the listing on every read. Denormalised on purpose, and it is not merely convenient --
    -- listing ownership can change hands, and "who paid for this promotion" must not change with it.
    --
    -- ONE THING A FUTURE FEATURE MUST NOT BREAK
    -- -----------------------------------------
    -- `buyer_id` is the listing's owner at purchase time, which is exact today because a listing has
    -- never changed hands. If transfer is ever built, it must reassign or refuse `pending` boosts
    -- explicitly: silently moving a listing would otherwise re-attribute the previous owner's paid
    -- history to the new one, and the column is `updatable = false` precisely so that cannot happen
    -- by accident.
    buyer_id    uuid NOT NULL REFERENCES users(id),

    starts_at   timestamptz,
    ends_at     timestamptz,

    -- D64: revenue queries use actual payment confirmation rather than `starts_at` (the window-open
    -- proxy). `starts_at` is also set on comp/manual-grant activations, while `paid_at` is stamped
    -- only by the payment webhook — their divergence is how the finance desk tells a paid promotion
    -- from a gifted one.
    paid_at     timestamptz,

    status      text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'expired')),

    payment_ref text,

    -- Scoped by property rather than by user: the endpoint is /me/properties/{propId}/boost, and the
    -- buyer is always the listing's owner. Scoping the retry key to the thing the URL names is both
    -- narrower and impossible to get wrong. (The unpaid-order *cap* below is scoped by buyer, which
    -- is a different question -- see the block above `buyer_id`.)
    idempotency_key text,

    -- Optimistic-locking counter (D161). See the block above this table.
    version     bigint NOT NULL DEFAULT 0,

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_boosts_property ON boosts (property_id);

CREATE UNIQUE INDEX uq_boosts_payment_ref ON boosts (payment_ref) WHERE payment_ref IS NOT NULL;

CREATE UNIQUE INDEX uq_boosts_idempotency
    ON boosts (property_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- "Is this listing boosted right now?" -- the question search ranking will ask of every result.
CREATE INDEX idx_boosts_live ON boosts (property_id, ends_at DESC) WHERE status = 'active';

-- ---------------------------------------------------------------------------------------------
-- The unpaid-order cap on boosts, enforced by the database (D160).
--
-- The boost half of what `uq_subscriptions_open_unpaid` does for subscriptions:
-- `POST /me/properties/{propId}/boost` opens a real Cashfree order per priced pack and had no
-- ceiling on how many a caller may hold open. See that index's block for why the rate limit is not a
-- substitute and why a count-then-insert cannot hold.
--
-- WHY THIS SHAPE
-- --------------
-- Partial, on (buyer_id) WHERE status = 'pending'. A boost that is paid for (`active`) or dead
-- (`expired`) leaves the index, so the cap is on outstanding orders and not on how many promotions
-- an owner may buy. Matches BoostService.MAX_OPEN_UNPAID_PER_BUYER = 1 exactly; raising that
-- constant means replacing this index.
--
-- Note what the cap deliberately does NOT say: it is not "one pending boost per listing". An owner
-- with three listings may promote all three -- just not hold three unpaid checkouts open at once.
-- The unpaid one clears itself within the abandoned-checkout TTL (D161) or the moment they cancel
-- by paying, so the restriction is measured in minutes rather than being a latch.
--
-- PRE-EXISTING VIOLATIONS (historical: the retirement pass is not reproduced here)
-- -----------------------
-- Handled exactly as the subscription cap handled them, and for the same reason: `pending` had
-- existed since V23 with nothing capping it, so a duplicate pair was the previous behaviour rather
-- than a defect, and failing the deploy over it would have been wrong. Surplus rows were expired
-- (the terminal value `Boost.abandonUnopened` uses -- the contract's boost vocabulary has no third
-- one), keeping the row that can still take money: a row WITH a payment_ref outranks one without,
-- then the newest, then by id for determinism. The idempotency key was released with the status so
-- the owner's next attempt on that listing is not answered with the dead row.
--
-- Same caveat as the subscription pass: where a buyer holds two rows that both have a payment_ref,
-- keeping the newest can retire an older one whose payment is in flight. Every retired row was
-- therefore logged with its gateway order id, and those notices were the reconciliation list.
--
-- Backfill note, for the record: `buyer_id` was populated from `properties.owner_id`, which is the
-- value the derivation would have produced, and it was total -- `boosts.property_id` is NOT NULL and
-- a foreign key, and `properties.owner_id` is NOT NULL, so every existing row got a buyer and the
-- NOT NULL above could not fail on data.
--
-- LOCKS
-- -----
-- Accepted, not overlooked, on the incremental path this replaces. `SET NOT NULL` took ACCESS
-- EXCLUSIVE and scanned the table, and both indexes were built non-concurrently (CONCURRENTLY cannot
-- run inside the transaction Flyway wraps each migration in), so writes to `boosts` blocked for the
-- duration. The table is small enough that this was shorter than the deploy around it.
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_boosts_open_unpaid
    ON boosts (buyer_id)
    WHERE status = 'pending';

-- The cap's count reads by buyer on every purchase, and the partial index above cannot serve it:
-- that one covers only `pending` rows, so a count over any other status falls back to a scan. Plain
-- and unconditional, so "every boost this person has bought" -- which is what an ops screen asks --
-- is indexed too.
CREATE INDEX idx_boosts_buyer ON boosts (buyer_id);

COMMENT ON COLUMN boosts.version IS
    'Optimistic-locking counter (D161). Maintained by Hibernate; raw SQL updates bypass it.';

COMMENT ON COLUMN boosts.paid_at IS
    'Stamped when a payment webhook confirms receipt of funds. Null for comp activations and '
    'unpaid rows. Used by finance queries instead of starts_at so a manual-grant path cannot '
    'inflate revenue (D64).';

-- ---------------------------------------------------------------------------------------------
-- service_offerings / service_orders
-- ---------------------------------------------------------------------------------------------
CREATE TABLE service_offerings (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL,
    category       text,
    starting_price bigint,
    description    text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- `service_orders.status` carries 'quoted', the state the order lifecycle turns on (D58).
--
-- WHAT WAS WRONG
--
-- `ServiceOrder.status` and `ServiceOrder.amount` could only be changed by hand-written SQL. The
-- API let a customer place an order and let ops read it, and then stopped: there was no operation
-- that quoted a job, booked it, worked it or closed it. Every order that ever completed did so
-- because somebody typed an UPDATE against production -- unaudited, unvalidated, and with no
-- notion of which moves are legal, so `completed` was one typo away from an order nobody had
-- surveyed.
--
-- WHY A NEW STATUS RATHER THAN A NEW COLUMN
--
-- The missing piece is not storage. `amount` has existed since V8 and has always been nullable,
-- precisely because an offering's price is a "from" and the real number is agreed after a survey.
-- What was missing is the *moment* that number is set. Without it, "priced" and "not yet priced"
-- were the same state as far as the column was concerned, and the only way to tell them apart was
-- to look at whether `amount` happened to be null -- a fact about a nullable column, not a
-- decision anybody recorded.
--
-- `quoted` makes that moment a state, and the application makes it the only transition that may
-- write `amount`. An order that has been priced and an order that has not are now different rows,
-- and a price change after the customer accepted is unreachable rather than merely discouraged.
--
-- WHY THE OTHER FIVE NAMES ARE WHAT THEY ARE
--
-- The register describes the machine as pending -> quoted -> accepted -> in_progress -> completed.
-- Three of those names are not what this platform stores: `pending` is `placed`, `accepted` is
-- `scheduled`, `in_progress` is `in-progress`. Renaming them would mean rewriting live rows,
-- changing the published `ServiceOrder` enum in the contract, and breaking every client generated
-- from it -- for no behaviour a user could observe. The shape of the machine is what was
-- specified; the spellings are what was already shipped, and only the genuinely absent state was
-- added.
--
-- WHAT THAT CHANGE DID NOT DO
--
-- No existing row moved. `placed` remains the default and remains what `createServiceOrder`
-- writes; the constraint was widened, never narrowed, so nothing that was valid before it was
-- invalid after it. The legal transitions between the six states are enforced in
-- `ServiceOrderStatuses`, not here: a CHECK can say which values exist, but it cannot see the row's
-- previous value and so cannot say which moves are allowed.
--
-- NO PAYMENT COLUMNS, unlike subscriptions and boosts: `createServiceOrder` declares neither a 402
-- nor a payment callback, and the ServiceOffering carries a *starting* price, so the amount is
-- quoted after a survey rather than charged at order time. Adding a gateway handle here would be
-- inventing a flow the contract does not describe. The retry key below is the exception, and it is
-- not a payment handle.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE service_orders (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id   uuid NOT NULL REFERENCES service_offerings(id),
    user_id       uuid NOT NULL REFERENCES users(id),
    property_id   uuid REFERENCES properties(id),
    status        text NOT NULL DEFAULT 'placed'
                    CHECK (status IN ('placed','quoted','scheduled','in-progress','completed','cancelled')),
    amount        bigint,
    scheduled_for timestamptz,
    notes         text,
    idempotency_key text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_service_orders_idempotency
    ON service_orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- "Mine, newest first". An index on user_id alone -- the original shape -- leaves the sort unbacked
-- and is a redundant prefix of this key.
CREATE INDEX idx_service_orders_user_created ON service_orders (user_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- support_tickets: consumer support, per-user (distinct from ops Ticket).
--
-- THE THREAD HAS AN HONEST TWO-SIDED READ MODEL (D50 and D51, which are the same defect seen from
-- two ends: ops cannot triage a queue it has no unread signal for, and it had no queue to triage).
--
-- D50. `support_tickets.unread` (V8) is one boolean, so it could only ever mean one thing, and what
-- it means is "a support reply the raiser has not read". That is the customer's signal: staff
-- answering sets it, the raiser's own reply leaves it alone, POST /support/tickets/{id}/read clears
-- it. A staff member consequently had no way to see which tickets have a *customer* message waiting
-- -- the direction that actually decides what the desk works on next.
--
-- The fix is a second column, not a reinterpretation of the first. Overloading `unread` to mean
-- "somebody has something to read" would break the customer UI silently: the badge would light up on
-- the raiser's own message, and marking read from either side would clear the other's. Two booleans
-- is also deliberately the smaller change than a per-side read table -- there are exactly two sides
-- here, forever, and a table would buy generality for a third party that does not exist while adding
-- a join to every read.
--
-- Not timestamps either, for the same reason. `last_message_at` + two `last_read_at` columns is the
-- shape you want when "unread" has to be a *count*, and this thread has no count on the wire: the
-- contract's `unread` is a boolean and the whole thread ships inline. Three nullable timestamps to
-- derive a boolean the code already stores directly is more state, not less.
--
-- Historical note on the backfill, which is not reproduced here because a fresh database has no rows
-- to correct: `staff_unread` was seeded true for tickets already open on the day it shipped, because
-- a queue that starts empty is a queue that misses every one of them. A ticket is awaiting the desk
-- exactly when the newest message on it was written by the person who raised it -- the same rule the
-- application applies going forward, applied once to history. Tickets with no messages at all could
-- not match, correctly: the create path always writes the opening message in the same transaction,
-- so a message-less row is data that predates the API and has nothing for the desk to read.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE support_tickets (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id),
    subject    text NOT NULL,
    category   text,
    status     text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in-progress','waiting','resolved','closed')),
    unread     boolean NOT NULL DEFAULT false,
    staff_unread boolean NOT NULL DEFAULT false,

    -- Optimistic-locking counter (D48). `support_tickets` is one of the three tables two people
    -- legitimately edit at the same time; the full reasoning for why these three are versioned and
    -- nothing else is -- and why `default 0` and `not null` are both load-bearing -- is written out
    -- once, beside `tickets` and `service_requests`, in V07__DDL_service_requests.sql.
    version    bigint NOT NULL DEFAULT 0,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- GET /support/tickets is the caller's own, newest first (spec fix S47). An index on user_id alone
-- -- the original shape -- leaves the sort unbacked and is a redundant prefix of this key.
CREATE INDEX idx_support_tickets_user_created ON support_tickets (user_id, created_at DESC);

-- D51. The platform-wide read at GET /admin/support-tickets is `order by created_at desc limit ?`
-- over the whole table -- the one shape the per-user index never covered, because until D51 every
-- read of this table was scoped to one user (`idx_support_tickets_user_created`).
--
-- Same reasoning as the finalization and deal indexes: paging a sort that is not indexed makes the
-- read slower, not faster. Without this the planner gathers every support ticket on the platform,
-- quicksorts it, and discards all but twenty. With it, page one costs the same at ten rows and at
-- ten thousand.
CREATE INDEX idx_support_tickets_created
    ON support_tickets (created_at DESC);

-- The filtered read (`?awaitingReply=true`) is the one the desk actually lives in, and it is the
-- case where a plain composite index would be worst: `staff_unread` is true for a small and
-- shrinking minority of rows, so walking the index above newest-first and discarding non-matches
-- reads most of the table to fill one page.
--
-- Partial rather than composite, following the finalization index: `staff_unread = false` is
-- never queried -- "tickets nobody is waiting on" is not a view anyone asks for -- so half the
-- keyspace would be dead weight, and the index only carries rows while they are open work. It
-- shrinks as the desk clears the queue, which is the right direction for the hot index to move.
CREATE INDEX idx_support_tickets_awaiting_reply
    ON support_tickets (created_at DESC)
 WHERE staff_unread;

COMMENT ON COLUMN support_tickets.staff_unread IS
    'D50: a customer message the desk has not read. The mirror of `unread`, which is the raiser''s '
    'side. The raiser replying sets this; a staff or admin read clears it; a staff reply does not '
    'touch it. Neither column is ever cleared by the other side reading.';

COMMENT ON COLUMN support_tickets.unread IS
    'A support reply the raiser has not read. Set by a staff or admin reply, cleared by '
    'POST /support/tickets/{id}/read called by the raiser. Untouched by the raiser''s own replies, '
    'and since V53 untouched by a staff read as well -- that clears `staff_unread` instead.';

COMMENT ON COLUMN support_tickets.version IS
    'Optimistic-locking counter (D48). Maintained by Hibernate; raw SQL updates bypass it.';

CREATE TABLE support_ticket_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   uuid NOT NULL REFERENCES support_tickets(id),
    author_id   uuid REFERENCES users(id),
    author_role text CHECK (author_role IN ('buyer','owner','staff','admin')),
    body        text NOT NULL,
    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_ticket_messages_ticket ON support_ticket_messages (ticket_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- notifications: per-user, server-generated as a side-effect of approvals/state changes.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id),
    type       text,
    title      text,
    body       text,
    read       boolean NOT NULL DEFAULT false,
    link       text,

    -- THE DEFERRAL CLOCK.
    --
    -- SUPPRESSING A NOTIFICATION IS A DATA LOSS EVENT. Quiet hours are a statement about WHEN the
    -- user wants to be disturbed, not about WHETHER an offer on their listing is worth knowing.
    -- Dropping the write would mean an owner who sleeps 22:00-07:00 never learns an offer arrived at
    -- 02:00, and nothing anywhere would record that it happened -- the inbox is the only place these
    -- are ever read. So the row is always written; what quiet hours move is the moment it becomes
    -- VISIBLE.
    --
    -- `deliver_after` NULL means "deliverable now", which is what every existing row is and what
    -- every notification written outside a quiet window will be. When a write lands inside one, this
    -- is set to the instant that window closes, and `NotificationService.list` filters the inbox on
    -- `deliver_after IS NULL OR deliver_after <= now()`. At 07:00 the notification appears, in
    -- order, with its true `created_at` intact.
    --
    -- WHY NOT A SCHEDULED JOB. Because there is nothing for it to do. The inbox is a pull surface:
    -- the client asks, the server answers. A background sweep clearing a flag at 07:00 would produce
    -- the identical user-visible result while adding a component that can fail, lag, double-fire, or
    -- need a leader election once there are two instances -- and it would leave a window in which a
    -- row is due but not yet released. A comparison against now() has no such window and nothing to
    -- backfill. Same reasoning as deriving the verification badge instead of sweeping it.
    deliver_after timestamptz,

    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications (user_id, read, created_at DESC);

-- ---------------------------------------------------------------------------
-- Index for the paged notification read (spec fix S27)
-- ---------------------------------------------------------------------------
--
-- idx_notifications_user (user_id, read, created_at DESC) serves "my unread, newest first". The
-- list endpoint asks a different question -- "mine, newest first", with no predicate on `read` --
-- and `read` sits in the middle of that key, so Postgres can use the user_id prefix to find the
-- rows but must then sort every one of them to order them. That is a full sort per page for exactly
-- the users who have the most notifications.
--
-- api-standards.md §5 requires every sort be index-backed, so the read gets its own key. Both
-- indexes exist: they answer different questions and neither is a prefix of the other.
CREATE INDEX idx_notifications_user_created
    ON notifications (user_id, created_at DESC);

-- NO INDEX FOR `deliver_after`, DELIBERATELY. The obvious move is
-- `(user_id, deliver_after, created_at DESC)`, and it would be dead weight. The read is
--     WHERE user_id = ? AND (deliver_after IS NULL OR deliver_after <= now())
--     ORDER BY created_at DESC LIMIT 20
-- and an OR/range predicate on the second column destroys the index's ordering guarantee for the
-- third, so Postgres could not use it to satisfy the ORDER BY -- it would scan and sort. The
-- existing idx_notifications_user_created (user_id, created_at DESC) gives an ordered scan that
-- terminates at 20 rows with `deliver_after` applied as a cheap filter, which is strictly better
-- while deferred rows are rare (they are: quiet hours default to off). The planner would pick the
-- old index and never touch the new one, and every insert would pay for it. If profiling ever shows
-- otherwise, the shape that would help is a PARTIAL index -- `(user_id, created_at DESC) WHERE
-- deliver_after IS NULL` -- paired with an IS NULL-first query, not this one.

COMMENT ON COLUMN notifications.deliver_after IS
    'NULL = deliverable immediately (the overwhelming majority). Set to the end of the recipient''s '
    'quiet-hours window when the notification was written inside one; the inbox read hides the row '
    'until then. The notification is deferred, never suppressed (D94).';

-- ---------------------------------------------------------------------------------------------
-- referrals: fraud-review queue (schema: Referral). referred is often not yet a user -> mobile text;
-- referrer is a registered user -> FK, with denormalized mobile for the ops view.
--
-- REFERRAL INTEGRITY: the qualifying action, the share channel, and two hashed fraud signals.
--
-- Closes the referral half of D191/D56/D60/D55/D61. One decision rather than four because the
-- columns are one decision: Q17 (closed 2026-08-11) rules that a referral credits the referrer
-- *when the referee's first listing passes verification*, and everything below is either that event
-- or a signal the fraud desk needs in order to read it.
--
-- WHY THIS EVENT. The rejected alternatives are on record and should not be re-litigated here:
-- verified-mobile (a SIM costs less than the credit it mints), referee identity verification (too
-- much friction on the exact surface being used to buy liquidity), and manual review (does not
-- scale, and delays the reward that makes a referral scheme work at all). Clearing the ownership-
-- document gate is the one qualifying action that is already expensive to fake, so it does the
-- anti-fraud work twice and no separate fraud machinery is needed.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE referrals (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id      uuid REFERENCES users(id),
    referrer_mobile  text CHECK (referrer_mobile ~ '^[6-9][0-9]{9}$'),
    referred         text,
    referred_mobile  text CHECK (referred_mobile ~ '^[6-9][0-9]{9}$'),
    channel          text CHECK (channel IN ('seeker','owner')),

    -- `reward` is a human label ("+15 owner contacts") and `reward_amount` is its magnitude.
    --
    -- Both originally said rupees. Rewriting the label without rewriting the number would have left
    -- a fraud desk reading "+15 owner contacts ... 500", which is worse than either version alone,
    -- so D31b rewrote both together -- but only on rows that had not been decided. A `rewarded` or
    -- `clawed-back` referral is history: it records what was actually promised and released at the
    -- time, and restating it as a number of contacts would be a lie about a decision a person made.
    -- Those rows kept their rupees and their label, which is why `reward` is a free-text column and
    -- not an enum. (That rewrite was a one-time correction of existing rows and is not reproduced
    -- here; a fresh database mints every reward in contacts from the start.)
    reward           text,

    -- `reward` is prose while ReferralSummary.rewardsEarned is Money, so the summary had nothing to
    -- add up and a checker approving a payout was never shown its size. Spec fix S54 put the number
    -- on the wire; this is where it lives.
    reward_amount    bigint NOT NULL DEFAULT 0,

    -- Spec fix S52 added `clawed-back`. Clawback reverses a reward that was already released;
    -- folding it into `rejected` would lose the one distinction the fraud desk needs -- never paid
    -- versus paid and recovered.
    status           text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'qualified', 'rewarded', 'rejected', 'clawed-back')),
    risk             text CHECK (risk IN ('low','medium','high')),
    aadhaar_verified boolean NOT NULL DEFAULT false,
    aadhaar_unique   boolean NOT NULL DEFAULT false,

    -- `same_device` and `same_ip` are the findings, computed at redemption from the hashed signals
    -- below. See the PERSONAL DATA block beside `referred_ip_hash`.
    same_device      boolean NOT NULL DEFAULT false,
    same_ip          boolean NOT NULL DEFAULT false,
    velocity_high    boolean NOT NULL DEFAULT false,
    activated        boolean NOT NULL DEFAULT false,
    at               timestamptz NOT NULL DEFAULT now(),

    -- Reject and clawback both take a ReasonRequest. V7 recorded who decided and when but not why,
    -- which is the only part of the three a later reviewer actually needs.
    handled_by       text,
    handled_at       timestamptz,
    handled_reason   text,

    -- THE QUALIFYING ACTION (D191, D56)
    -- ---------------------------------
    -- `qualified` has been in the status CHECK since V7 and extended by V23, and no code path had
    -- ever produced it -- the vocabulary declared a state the platform could not reach. These two
    -- columns are what makes it reachable, and what makes it auditable afterwards.
    --
    -- WHY RECORD THE PROPERTY AND NOT JUST A FLAG. "First listing" is a claim about a specific
    -- listing on a specific date. A bare boolean leaves a fraud desk investigating a suspicious
    -- referrer with no way to ask which listing bought the credit, which is the first question they
    -- will have. It also makes the idempotency visible: a second announcement for the same property
    -- is recognisable as a repeat rather than inferred from a timestamp.
    --
    -- NO FOREIGN KEY TO `properties`, deliberately. This is evidence about a decision that was
    -- taken, not a live association: a listing that is later withdrawn or deleted must neither erase
    -- the record of why a credit was granted nor block its own deletion behind a growth-context row.
    qualified_at          timestamptz,
    qualified_property_id uuid,

    -- HOW THE LINK WAS ACTUALLY SHARED (D60)
    -- --------------------------------------
    -- `channel` says `seeker` or `owner`. That is which side of the marketplace the referred party
    -- joined on -- a real fact, and a useful one, but not the one the name promises. Nothing had ever
    -- recorded how the link travelled, because redemption carried no share context to record.
    --
    -- Added as a second column rather than by repurposing `channel`: `channel` is on the wire, in the
    -- contract's enum, in the ops queue's facet and behind a CHECK constraint, and changing what it
    -- means would silently rewrite every row already stored under the old meaning. A field that is
    -- merely under-named is cheaper to document than to migrate; a field that is *missing* has to be
    -- added either way.
    --
    -- Nullable, and null is the common case: the referee's browser can only report a share channel
    -- the referrer's link carried, and a code dictated over a phone call carries nothing. An unknown
    -- channel is recorded as unknown. The same rule as the two signals below -- a fabricated value is
    -- worse than an absent one, because a desk that trusts it stops looking.
    share_channel    text CHECK (share_channel IS NULL
                                 OR share_channel IN ('whatsapp', 'sms', 'email', 'copy', 'qr', 'other')),

    -- DEVICE AND NETWORK CORRELATION (D55) -- PERSONAL DATA, READ THIS BLOCK
    -- ---------------------------------------------------------------------
    -- `same_device` and `same_ip` have been NOT NULL DEFAULT false since V7 and nothing computed
    -- them, because the platform captured neither side of the comparison. The two strongest
    -- self-referral signals were therefore absent from the one desk that exists to catch
    -- self-referral.
    --
    -- WHAT IS STORED. A salted SHA-256 hex digest of the client address, and a salted SHA-256 hex
    -- digest of the User-Agent header. NEVER the raw address and NEVER the raw header. The salt is a
    -- deployment secret (`draazy.security.referral-signal-salt`); without it these are 64 hex
    -- characters that cannot be walked back to an address, which matters because the IPv4 space is
    -- 2^32 and an unsalted digest of it is reversible by anybody with a laptop and an afternoon.
    --
    -- PURPOSE LIMITATION. Referral fraud detection, and nothing else. These columns exist so that
    -- `same_device` and `same_ip` can be computed honestly at redemption. They are not an analytics
    -- input, not a login signal, and not a general device fingerprint: nothing outside
    -- billing/referral may read them, and the only comparison performed is equality between a
    -- referrer's stored digest and a referee's freshly computed one.
    --
    -- RETENTION: 90 DAYS, then cleared in place. Long enough for a fraud desk working a queue to
    -- correlate a cluster of referrals; short enough that the platform is not accumulating a
    -- permanent record of where every user was when they signed up. Enforced by
    -- ReferralSignalRetentionSweep, which blanks both columns once the row is older than the window,
    -- and disclosed to the subject through ErasureRetention#knownGaps(). The cleared row keeps
    -- `same_device`/`same_ip` -- the *finding* survives the evidence, which is the same shape as
    -- `aadhaar_verified` recording an outcome rather than a number.
    --
    -- WHY A HASH RATHER THAN NOTHING AT ALL. The society-leads table declined to record a client IP
    -- and said why: "the app sits behind proxies whose header policy is not settled, and a wrong
    -- client IP recorded as fact is worse than none (see D55 on referrals)." That objection has since
    -- been answered -- TrustedProxyConfig makes every deployment declare its topology, and refuses to
    -- boot if it does not -- so `getRemoteAddr()` is now either the socket peer or an
    -- X-Forwarded-For value from a proxy the deployment explicitly named. The reason to hold off is
    -- gone; the reason not to store the raw value is not.
    referred_ip_hash     text,
    referred_device_hash text,

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_referrals_referrer ON referrals (referrer_id);

-- One person can be referred once. Without this the whole scheme is a faucet: redeem a code,
-- redeem another, collect both rewards. Partial because the column is nullable and a referral
-- recorded without a mobile is not a duplicate of anything.
CREATE UNIQUE INDEX uq_referrals_referred_mobile
    ON referrals (referred_mobile) WHERE referred_mobile IS NOT NULL;

-- The ops queue filters on status and risk and sorts newest-first. An index on status alone -- the
-- original shape -- left every "high risk, pending" search sorting the whole pending set by hand.
CREATE INDEX idx_referrals_queue ON referrals (status, risk, at DESC);
CREATE INDEX idx_referrals_referrer_status ON referrals (referrer_id, status);

-- The per-referrer rolling-window cap (D61) counts qualifications, so it reads exactly this shape.
-- Partial because the overwhelming majority of rows never qualify and an index over their NULLs
-- would be most of the table for none of the benefit.
CREATE INDEX idx_referrals_referrer_qualified
    ON referrals (referrer_id, qualified_at) WHERE qualified_at IS NOT NULL;

COMMENT ON COLUMN referrals.qualified_at IS
    'When the referee''s first listing passed ownership verification (Q17). NULL until it does. '
    'Set exactly once: a second verified listing by the same owner, and re-verification after a '
    'lapse, are both no-ops.';
COMMENT ON COLUMN referrals.qualified_property_id IS
    'Which listing cleared the gate. Evidence, not an association -- no FK, so deleting the listing '
    'neither erases the reason a credit was granted nor is blocked by it.';
COMMENT ON COLUMN referrals.share_channel IS
    'How the referral link reached the referee, as reported at redemption. NULL when unknown, which '
    'includes every code passed on by voice. Distinct from `channel`, which records which side of '
    'the marketplace the referred party joined on.';
COMMENT ON COLUMN referrals.referred_ip_hash IS
    'Salted SHA-256 of the client address the referee redeemed from (IPv6 collapsed to its /64). '
    'PERSONAL DATA. Purpose: referral fraud detection only. Retention 90 days, then blanked by '
    'ReferralSignalRetentionSweep. Never the raw address.';
COMMENT ON COLUMN referrals.referred_device_hash IS
    'Salted SHA-256 of the User-Agent the referee redeemed with. PERSONAL DATA. Purpose: referral '
    'fraud detection only. Retention 90 days, then blanked by ReferralSignalRetentionSweep. Never '
    'the raw header.';

-- ---------------------------------------------------------------------------------------------
-- referral_codes.
--
-- `ReferralSummary.code` and the body of `redeemReferral` are the same string, and it existed
-- nowhere in the schema -- two operations depended on a value the database could not store.
--
-- Its own table rather than a column on `users`: the code is a growth-context concern with no
-- meaning to identity, and billing writing into identity's aggregate is the kind of cross-context
-- write the layering test exists to discourage. A one-column-per-user table costs one join on a
-- screen nobody opens in a loop.
--
-- user_id is the primary key: one code per user, forever. Rotating it would break every card and
-- WhatsApp message already carrying the old one.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE referral_codes (
    user_id    uuid PRIMARY KEY REFERENCES users(id),
    code       text NOT NULL UNIQUE,

    -- The other half of the fraud-signal comparison (D55; see the PERSONAL DATA block on
    -- `referrals.referred_ip_hash` for what is stored, why it is hashed, and the 90-day retention).
    -- The referrer's digests are stamped on their code row when the code is minted -- which is the
    -- moment they opened the referral screen to share it, so it is the device the link is about to
    -- be sent from.
    --
    -- WHY MINT-TIME AND NOT LAST-SEEN. Refreshing these on every read would put a write on a read
    -- path for a signal that is advisory. It would also be worse data, not better: a referrer who
    -- last opened the screen from an office network would match every colleague who signed up there
    -- that afternoon. The cost of stamping once is a false negative for a referrer who has since
    -- moved network, and a false negative here is the safe direction -- it sends the referral to a
    -- human instead of flagging an honest one.
    --
    -- Rows minted before these columns existed have all three NULL, and a NULL never matches: those
    -- referrers keep the pre-D55 behaviour of both signals reading false. That is correct rather
    -- than unfortunate.
    referrer_ip_hash     text,
    referrer_device_hash text,
    signals_at           timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN referral_codes.referrer_ip_hash IS
    'Salted SHA-256 of the address the referrer minted their code from (IPv6 collapsed to its /64). '
    'PERSONAL DATA. Purpose: referral fraud detection only. Retention 90 days from signals_at, then '
    'blanked by ReferralSignalRetentionSweep. Never the raw address.';
COMMENT ON COLUMN referral_codes.referrer_device_hash IS
    'Salted SHA-256 of the User-Agent the referrer minted their code with. PERSONAL DATA. Purpose: '
    'referral fraud detection only. Retention 90 days from signals_at, then blanked by '
    'ReferralSignalRetentionSweep. Never the raw header.';
COMMENT ON COLUMN referral_codes.signals_at IS
    'When the two digests above were captured. Drives their 90-day retention window; created_at '
    'cannot, because a row may be re-stamped and because it exists on rows that predate V64.';

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- `updated_at` column.
SELECT install_updated_at_triggers();
