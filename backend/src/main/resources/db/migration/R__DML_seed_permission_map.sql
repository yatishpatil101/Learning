-- D67: give `settings.permissions` a complete, explicit, behaviour-identical starting value, so the
-- allow-list the guards now consult can be edited safely.
--
-- Until this seed the row did not exist server-side at all: R__DML_seed_reference_data.sql seeds `fees`,
-- `flags` and `site` and nothing else, and the only `permissions` document in the repository lived in
-- the frontend prototype's db.json. `security/PermissionMap` treats an absent document as "no policy
-- configured, the compiled-in four-role baseline applies", so without this file the guards would be
-- inert on every real deployment -- which is the D67 bug wearing a guard as a hat.
--
-- Why every team gets the FULL capability set. This file must not change who can do what. It is
-- writing down the map that describes today, so that tomorrow's edit to it is a visible, one-team
-- change rather than a cliff: PermissionMap denies a team whose key is missing from a present
-- document, so a partial map -- an administrator saving one desk's bundle into an empty document --
-- would otherwise lock out every desk they did not name. Seeding all six teams from
-- security/Teams.java (rental, legal, loans, interior, packers, valuation) removes that cliff
-- entirely, and the settings endpoint's merge semantics (S60) cannot subsequently delete a key, only
-- empty it. `loans` is absent from the frontend prototype's map and present here, because a team the
-- platform recognises and the map does not is exactly the disagreement this seed exists to settle.
--
-- `admin` is ["*"] rather than an enumerated list. The wildcard says out loud that administrators are
-- unrestricted, which silence could not have said here -- an omitted key is a denial.
--
-- ---------------------------------------------------------------------------------------------
-- WHY THIS IS REPEATABLE, AND THE ONE THING THAT MAKES IT SAFE
-- ---------------------------------------------------------------------------------------------
-- The conflict clause is a merge whose direction is the whole design: `EXCLUDED.value ||
-- settings.value` starts from the defaults below and lets the STORED document win every key it
-- already declares. Two consequences, and both are wanted:
--
--   * A deployment that already has a hand-written map keeps it verbatim and merely gains default
--     bundles for the teams it never mentioned. That is the "accounts whose stored map disagrees
--     with their role" reconciliation the register asked for, expressed as data rather than a script.
--   * Re-running is a no-op on anything a human has written. Which is what makes `R__` legitimate
--     here even though R__DML_seed_reference_data.sql's ON CONFLICT DO UPDATE would be indefensible for
--     an access-control document: that file overwrites, this one only fills gaps.
--
-- THE TRAP THAT FALLS OUT OF IT, for whoever edits this file next: changing a bundle below will NOT
-- change any deployment that already has the row, because the stored value wins. This file can only
-- ever establish a policy, never revise one. A revision is either an administrator's edit through
-- /admin/settings or a versioned migration that says so explicitly.
--
-- Guarded by jsonb_typeof because `permissions` is `additionalProperties: true` in the contract, so
-- the stored value could legally be an array or a string and `||` on one of those would produce
-- nonsense. A non-object is left exactly as it is; PermissionMap already reads an unusable document
-- as "fall back to the role baseline".
INSERT INTO settings (key, value) VALUES
    ('permissions', '{
        "rental":    ["view_dashboard", "view_service_requests", "update_ticket", "export_csv"],
        "legal":     ["view_dashboard", "view_service_requests", "update_ticket", "export_csv"],
        "loans":     ["view_dashboard", "view_service_requests", "update_ticket", "export_csv"],
        "interior":  ["view_dashboard", "view_service_requests", "update_ticket", "export_csv"],
        "packers":   ["view_dashboard", "view_service_requests", "update_ticket", "export_csv"],
        "valuation": ["view_dashboard", "view_service_requests", "update_ticket", "export_csv"],
        "admin":     ["*"]
    }'::jsonb)
ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value || settings.value
    WHERE jsonb_typeof(settings.value) = 'object';
