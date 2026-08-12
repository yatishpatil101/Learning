-- Notification preferences get a server home, and the inbox gets a deferral clock (D94, D15).
--
-- WHAT WAS BROKEN. `getNotifPrefs`/`setNotifPrefs`/`inQuietHours` have existed in the browser since
-- the settings screen shipped: three delivery-channel switches, a master `matchAlerts` switch, a
-- quiet-hours window and a language. All of it lived in localStorage, under a key suffixed with the
-- user's mobile number, and the server had never been told any of it. The consequence was not
-- cosmetic. `Notifications.jsx` suppresses the alerts IT derives while `inQuietHours()` is true, so
-- the user is shown a product that honours a 22:00-07:00 window -- and then the server writes an
-- offer, a moderation verdict or a message notification at 03:00 and it is simply there. The
-- promise was kept by exactly the half of the system that generates the least of the traffic.
--
-- ONE ROW PER USER, KEYED BY THE USER. No surrogate id, for the reason `owner_kyc` and
-- `ownership_bases` give: a user has exactly one set of preferences, and a surrogate key would
-- permit two, which introduces the question "which of these is in force?" that nothing in the
-- product can answer. The primary key IS the answer.
--
-- ABSENT ROW == TODAY'S DEFAULTS, NOT SILENCE. This is the failure mode worth naming, because it is
-- the one that would be discovered by users rather than by tests. Every account that exists today
-- has no row here and will not have one until it opens Settings and changes something. If the
-- server read a missing row as "all switches off" it would mute the entire platform's notifications
-- for its entire existing user base on deploy, and every one of those notifications is lost rather
-- than delayed. So the reader (`NotificationPreferenceService.effective`) resolves an absent row to
-- the same constants the browser has always defaulted to, and these column defaults repeat them so
-- that a row created by raw SQL cannot disagree with a row created by the application. The two
-- copies are pinned against each other by `NotificationPreferencesEndpointTest`, which reads back a
-- row inserted naming nothing but the user.
--
-- WHY THE QUIET WINDOW IS TEXT AND NOT `time`. The value is a wall-clock label -- "22:00" -- with no
-- date and no zone, and Postgres `time` would be a marginally tighter spelling of exactly that. The
-- deciding argument is the wire: the browser has always stored and sent `'22:00'`, the `<input
-- type="time">` that produces it emits `HH:mm`, and a `time` column round-trips as `22:00:00`. That
-- extra `:00` would either have to be trimmed on the way out (a formatting rule in the mapper, i.e.
-- a place for the two representations to drift) or accepted into the contract (changing a value the
-- client already persists). A CHECK constraint buys the validation `time` would have given us
-- without touching the shape the client agreed to.
--
-- WHY `start == end` IS ALLOWED AND MEANS "NEVER". Rejecting it would be defensible, but the
-- browser's `inQuietHours` already returns false for it and a user who drags both ends together is
-- expressing "no window", not committing an error. Fifteen minutes of quiet is expressible; zero
-- minutes has to be too, or the only way to express it is the `enabled` flag, and then two controls
-- disagree about the same fact. The Java side (`QuietHours.deferUntil`) makes the same call.
CREATE TABLE notification_preferences (
    user_id             uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    email               boolean NOT NULL DEFAULT true,
    sms                 boolean NOT NULL DEFAULT false,
    whatsapp            boolean NOT NULL DEFAULT true,
    match_alerts        boolean NOT NULL DEFAULT true,
    quiet_hours_enabled boolean NOT NULL DEFAULT false,
    quiet_start         text    NOT NULL DEFAULT '22:00',
    quiet_end           text    NOT NULL DEFAULT '07:00',
    language            text    NOT NULL DEFAULT 'en',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_preferences_quiet_start_check
        CHECK (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT notification_preferences_quiet_end_check
        CHECK (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT notification_preferences_language_check
        CHECK (language IN ('en', 'hi', 'mr'))
);

COMMENT ON TABLE notification_preferences IS
    'One row per user; absent means the defaults in NotificationPreferenceService. Read by '
    'NotificationPublisher on every server-written notification (D94).';
COMMENT ON COLUMN notification_preferences.match_alerts IS
    'The master switch for saved-search/price alerts only. It does not silence transactional '
    'notifications -- an offer on your listing is not an alert you opted into, it is an event you '
    'are a party to, and a user who muted match alerts has not asked to stop hearing about those.';
COMMENT ON COLUMN notification_preferences.email IS
    'Channel switch. Carried and returned; NOT YET consulted by any server code, because nothing on '
    'the server sends email, SMS or WhatsApp today -- the Notifier port writes an in-app inbox row '
    'and nothing else. Persisting them now means the switches the user already sets survive the '
    'move off localStorage, and the first real sender inherits an answer instead of a migration.';
COMMENT ON COLUMN notification_preferences.language IS
    'The language the platform should address this user in. Same caveat as the channel switches: '
    'stored and returned, with no server-side renderer consuming it yet.';

-- THE DEFERRAL CLOCK.
--
-- SUPPRESSING A NOTIFICATION IS A DATA LOSS EVENT. Quiet hours are a statement about WHEN the user
-- wants to be disturbed, not about WHETHER an offer on their listing is worth knowing. Dropping the
-- write would mean an owner who sleeps 22:00-07:00 never learns an offer arrived at 02:00, and
-- nothing anywhere would record that it happened -- the inbox is the only place these are ever read.
-- So the row is always written; what quiet hours move is the moment it becomes VISIBLE.
--
-- `deliver_after` NULL means "deliverable now", which is what every existing row is and what every
-- notification written outside a quiet window will be. When a write lands inside one, this is set
-- to the instant that window closes, and `NotificationService.list` filters the inbox on
-- `deliver_after IS NULL OR deliver_after <= now()`. At 07:00 the notification appears, in order,
-- with its true `created_at` intact.
--
-- WHY NOT A SCHEDULED JOB. Because there is nothing for it to do. The inbox is a pull surface: the
-- client asks, the server answers. A background sweep clearing a flag at 07:00 would produce the
-- identical user-visible result while adding a component that can fail, lag, double-fire, or need a
-- leader election once there are two instances -- and it would leave a window in which a row is due
-- but not yet released. A comparison against now() has no such window and nothing to backfill. Same
-- reasoning V63 gives for deriving the verification badge instead of sweeping it.
ALTER TABLE notifications ADD COLUMN deliver_after timestamptz;

COMMENT ON COLUMN notifications.deliver_after IS
    'NULL = deliverable immediately (the overwhelming majority). Set to the end of the recipient''s '
    'quiet-hours window when the notification was written inside one; the inbox read hides the row '
    'until then. The notification is deferred, never suppressed (D94).';

-- NO NEW INDEX, DELIBERATELY. The obvious move is `(user_id, deliver_after, created_at DESC)`, and
-- it would be dead weight. The read is
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

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- updated_at column.
SELECT install_updated_at_triggers();
