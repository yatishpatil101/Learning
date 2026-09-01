-- Recent searches for a signed-in account: the "Resume your search" rail on Home and Dashboard.
--
-- These have lived in `localStorage` under `pnRecentSearches:<mobile>` since the prototype, and
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
-- itself, and nothing about which listings were opened -- `pnRecentProps` stays in the browser,
-- because a list of the individual homes a person looked at is exactly the sensitive artefact
-- `localPrefs.js` refused to create, and moving it here would create it.
--
-- NOT `saved_searches` (the alerts table), despite the family resemblance. A saved search is a
-- standing instruction the user deliberately created and expects to survive until they delete it,
-- with an alert frequency attached. A recent search is a byproduct of navigating, silently evicted
-- six searches later. Sharing a table would mean an alert row that can disappear because the user
-- kept browsing, which is a bug report waiting to happen.
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

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- `updated_at` column.
SELECT install_updated_at_triggers();
