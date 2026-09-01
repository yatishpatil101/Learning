-- D31b. The referral reward stops being money and becomes owner contacts, and the contact quota
-- stops being a number in one browser.
--
-- Two things were wrong at once, and they were the same thing.
--
-- 1. The server paid a referral in rupees ("₹500 PuneNest credit") while every screen the referrer
--    could see promised "+15 owner contacts". `ReferralSummary.rewardsEarned` and `rewardsPending`
--    were fetched by the frontend and rendered by nothing, because there was no rupee anywhere in
--    the product to spend them on. The contract had it right all along -- `Referral.reward` is
--    documented in the OpenAPI as "Human label, e.g. '+15 owner contacts'" -- and the implementation
--    drifted. This settles it in favour of the contract and the screens.
--
-- 2. The "+15" itself was `localStorage`: `pnContactsUsed:<mobile>` plus an allowance derived from
--    `pnReferralStats:<mobile>`. A user who changed device lost every contact they had earned, and a
--    user who opened devtools had as many as they liked. The frontend's own comment said so:
--    "Prototype only -- the counter lives in localStorage and is NOT real security."
--
-- What an owner contact actually is, given D5. The owner's raw mobile is never revealed to a buyer,
-- whatever the gate says -- so a contact is not a phone number. It is the right to open a
-- `contact_requests` row: to put yourself in front of one owner and ask. That is the scarce thing,
-- that is what is worth metering, and that is what the referral now pays in.
--
-- WHY THIS MIGRATION ADDS ALMOST NOTHING.
--
-- There is no `contact_unlocks` table here and no `contacts_used` column, deliberately.
-- `uq_contact_requests_requester_property` (V9) already guarantees one row per (requester, listing),
-- so `count(*) from contact_requests where requester_id = ?` is an exact, race-proof count of the
-- distinct owners a caller has approached. A denormalised counter would be a second source of truth
-- for a number the database already holds correctly, and the two would disagree the first time a row
-- was inserted by anything but the one service that remembered to increment.
--
-- The referral grant is derived the same way, from `referrals.qualified_at` and `referrals.status`.
-- That is not a shortcut either: a reward that is stored gets clawed back by hand, and a reward that
-- is derived is withdrawn the instant the fraud desk moves the referral to `clawed-back`. The
-- clawback becomes real rather than cosmetic, for free.
--
-- So the only fact that had nowhere to live is the one below.

-- Which plans lift the contact ceiling entirely.
--
-- `plans.contact_limit` (V35) could not answer this. It is NULL on all four seeded rows and its own
-- comment admits it means two different things at once -- "unlimited / not-applicable" -- so an owner
-- plan with no contact limit and a tenant plan with unlimited contacts are stored identically. A
-- boolean that means one thing is worth more than a nullable integer that means either.
--
-- `contact_limit` is left exactly as it is: it is display data on the pricing page and changing it
-- would move a number on a screen for no reason. This column is entitlement, and nothing renders it.
ALTER TABLE plans
    ADD COLUMN unlimited_contacts boolean NOT NULL DEFAULT false;

-- The three priced plans lift the ceiling; Owner Free does not. This mirrors exactly what the
-- browser has been enforcing (`UNLIMITED_CONTACT_PLANS = ['seeker-plus', 'owner2', 'owner5']`), so
-- nobody's entitlement changes on the day this ships -- it only starts being true on the server.
--
-- Keyed off the literal seeded ids rather than off `price > 0`, because "priced" and "unlimited" are
-- two different decisions that happen to coincide today, and a promotional free month of Seeker Plus
-- must not silently withdraw the entitlement it is promoting. `R__seed_reference_data.sql` carries
-- the same values, so a fresh database and an upgraded one agree.
UPDATE plans SET unlimited_contacts = true
    WHERE id IN (
        'b1000000-0000-4000-8000-000000000002',  -- Owner Plus
        'b1000000-0000-4000-8000-000000000003',  -- Owner Pro
        'b1000000-0000-4000-8000-000000000004'   -- Seeker Plus
    );

-- The referral reward's unit changes under the existing rows.
--
-- `referrals.reward` is a human label and `referrals.reward_amount` is its magnitude. Both said
-- rupees. Rewriting the label without rewriting the number would leave a fraud desk reading
-- "+15 owner contacts ... 500", which is worse than either version alone.
--
-- Only rows that have not been decided are rewritten. A `rewarded` or `clawed-back` referral is
-- history: it records what was actually promised and released at the time, and restating it as a
-- number of contacts would be a lie about a decision a person made. Those rows keep their rupees and
-- their label, which is why `reward` is a free-text column and not an enum.
UPDATE referrals
   SET reward        = '+15 owner contacts',
       reward_amount = 15
 WHERE status IN ('pending', 'qualified');
