-- Reset punenest_e2e to its baseline. Run before a browser suite, never during one.
--
-- ## Why truncate-and-replay rather than anything cleverer
--
-- The seeds are Flyway *repeatable* migrations, so the obvious idea - "ask Flyway to re-run them" -
-- does not work: Flyway replays an R__ script only when its checksum changes, and the checksum is
-- of the file, which has not changed. Deleting its history row to force a replay would leave the
-- rows a spec created still sitting there, so the result would not be a baseline either.
--
-- The other candidate was a Postgres template database (DROP + CREATE ... TEMPLATE). It is faster,
-- and it was rejected because DROP DATABASE fails while a single connection is open: the backend's
-- pool holds several, so the reset would depend on stopping and restarting the backend around every
-- run. Truncating leaves the pool untouched, which is what lets this run against a backend that is
-- already up.
--
-- ## Why the table list is discovered rather than written down
--
-- A hand-maintained list is wrong the day someone adds a migration, and wrong *silently* - the
-- forgotten table simply keeps last run's rows, so a spec that passes because of leftover data looks
-- green. Reading pg_tables cannot go stale.
--
-- flyway_schema_history is the one exclusion: it describes the schema, not the data, and wiping it
-- would make the next backend start believe an empty database needed all 78 migrations again
-- against tables that already exist.
--
-- One TRUNCATE naming every table at once, with CASCADE: separate statements would have to respect
-- foreign-key order, and that order is another thing that goes stale.
DO $$
DECLARE
  targets text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO targets
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename <> 'flyway_schema_history';

  IF targets IS NULL THEN
    RAISE NOTICE 'no tables found - has the backend ever started against this database?';
  ELSE
    -- RESTART IDENTITY so a sequence-backed id is the same on run 2 as on run 1; a spec that
    -- asserts on a generated reference should not depend on how many times the suite has run.
    EXECUTE 'TRUNCATE TABLE ' || targets || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;
