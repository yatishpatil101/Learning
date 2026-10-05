-- Only an owner-tier room or group publishes itself now (its flat is an Ops-approved listing).
-- `live` was the self-published state, so a non-owner row still holding it reached the board without
-- a moderator; it goes back to the queue. `approved` is a moderator's verdict and is left alone.
UPDATE flatmate_rooms  SET mod_status = 'pending' WHERE mod_status = 'live' AND verification_tier <> 'owner';
UPDATE flatmate_groups SET mod_status = 'pending' WHERE mod_status = 'live' AND verification_tier <> 'owner';
