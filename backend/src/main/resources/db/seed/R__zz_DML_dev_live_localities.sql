-- Dev/e2e/sandbox stand-in for "users have already picked these from Google": the demo data binds to
-- them, and place_id stays null so a real Google pick adopts the row instead of minting a twin.
update localities
set archived_at = null, active = true
where archived_at is not null and place_id is null;
