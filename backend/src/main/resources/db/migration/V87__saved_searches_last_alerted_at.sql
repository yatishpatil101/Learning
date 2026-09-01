-- V87 — record when a saved search last actually told its owner something.
--
-- Why this column has to exist before the alert can be sent. `saved_searches` has carried
-- `alert_frequency` (off | instant | daily | weekly) since V7, the UI has offered the choice for as
-- long, and nothing has ever read it -- because nothing has ever sent an alert (D94). The sweep
-- recomputes `new_count` every thirty minutes and stops there, so the promise on the card ("Daily")
-- has never been kept or broken; it simply had no referent.
--
-- Sending on every sweep would give it one, and the wrong one. A user who chose "Daily" would be
-- notified every thirty minutes the moment inventory moved, which is not a partial implementation
-- of their choice -- it is the opposite of it, delivered under its name. The frequency is only
-- meaningful against a record of when the last alert went out, and there is nowhere to keep that:
-- `updated_at` cannot serve, because the sweep writes it whenever `new_count` changes, including
-- when the count falls and nobody is told anything.
--
-- Why nullable, with no backfill. Null means "this alert has never fired", which is true of every
-- row in existence, and the reader treats it as "due". Backfilling now() would suppress the first
-- alert for every existing user for a day or a week, silencing exactly the people who have been
-- waiting longest for the feature to work. Backfilling created_at would be a fabricated claim that
-- an alert was delivered on the day the search was saved.
--
-- No index. The sweep already reads every row in id order by design; this column is only ever
-- examined on a row that has been loaded, and is never a search predicate.
alter table public.saved_searches
    add column if not exists last_alerted_at timestamptz;

comment on column public.saved_searches.last_alerted_at is
    'When this saved search last sent its owner a match alert. Null = never fired; the cadence in alert_frequency is measured from here, not from updated_at.';
