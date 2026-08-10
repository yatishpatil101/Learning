-- V42: close the service_requests.type vocabulary.
--
-- `type` was free text (`@NotBlank @Size(64)` and nothing else), and the price of a request is
-- decided by matching that string exactly: only 'rent-agreement' is charged the platform fee plus
-- stamp duty plus registration plus GST, and every other value falls through to the free desk that
-- goes straight into the ops queue. So 'Rent-Agreement', 'rent_agreement', or the frontend's own
-- 'rental' did not fail -- they created an *unpaid* rent agreement and put ops to work drafting a
-- statutory document nobody had been billed for. A payment gate you opt into by spelling a string
-- correctly is not a gate.
--
-- ServiceRequestTypes.isKnown is the 400; this CHECK is the enforcement, in the same relationship
-- the status column has had since V7. Both exist because a service can be bypassed by a future
-- caller and a constraint cannot.
--
-- EXISTING ROWS (D156)
-- --------------------
-- The first draft of this migration swept *everything* outside the vocabulary into 'legal' and said
-- nothing about it. That was wrong twice over. 'rental' is the value the frontend's mock seam has
-- been writing all along -- it is the alias serviceRequestMapper.js puts on the rent-agreement desk
-- -- so the rows most likely to exist on a real database were exactly the ones being relabelled,
-- and relabelled to the wrong desk: a rent agreement is the one *priced* service, and calling it
-- 'legal' turns a paid job into a free one. And because the original string was overwritten in
-- place, nobody could tell afterwards whether a 'legal' row had always been legal.
--
-- So this migration now does three things before it constrains anything:
--
--   1. counts the rows per distinct `type` into the deploy log, so the effect on a real database is
--      visible in the output rather than inferred from the schema afterwards;
--   2. copies the pre-migration value into `details._migratedFromType` on every row it is about to
--      rewrite, so the evidence survives the rewrite and a row can be put back by hand;
--   3. maps 'rental' explicitly onto 'rent-agreement' -- the desk it always meant -- and only then
--      lands the genuinely unrecognisable remainder on 'legal'.
--
-- 'legal' stays the landing spot for that remainder, for the reason it always was: it is free, so
-- this cannot invent a charge, and it is a real desk, so the row stays workable. A request is
-- somebody's open matter, and a migration is the wrong place to decide it never happened.
--
-- Note what is *not* changed. A 'rental' row moved to 'rent-agreement' keeps whatever `amount`,
-- `status` and `payment_ref` it already had; this migration does not retro-bill anyone and does not
-- push anything back behind the paid gate. It only makes the desk name honest so the vocabulary can
-- be closed behind it.

-- 1. Pre-flight census, into the deploy log.
DO $$
DECLARE
    r RECORD;
    total bigint := 0;
BEGIN
    FOR r IN
        SELECT type AS t, count(*) AS n
        FROM service_requests
        GROUP BY type
        ORDER BY type
    LOOP
        total := total + r.n;
        RAISE NOTICE 'V42 pre-flight: service_requests.type = % -> % row(s)%',
            r.t, r.n,
            CASE WHEN r.t IN ('rent-agreement', 'legal', 'interior', 'packers', 'valuation')
                 THEN '' ELSE ' (WILL BE REWRITTEN)' END;
    END LOOP;
    RAISE NOTICE 'V42 pre-flight: % service_requests row(s) in total', total;
END $$;

-- 2. Preserve the original value on the rows about to be rewritten.
--
-- `details` is nullable jsonb (V36), so the NULL case is spelled out rather than left to `||`, which
-- returns NULL for a NULL operand and would have silently preserved nothing. The third branch is
-- defensive: the column is only ever written from a Java Map, so a non-object payload should be
-- impossible -- but merging into one would error, and dropping one would be worse than either.
UPDATE service_requests
SET details = CASE
        WHEN details IS NULL
            THEN jsonb_build_object('_migratedFromType', type)
        WHEN jsonb_typeof(details) = 'object'
            THEN details || jsonb_build_object('_migratedFromType', type)
        ELSE jsonb_build_object('_migratedFromType', type, '_migratedDetails', details)
    END
WHERE type NOT IN ('rent-agreement', 'legal', 'interior', 'packers', 'valuation');

-- 3a. The known alias, mapped to the desk it always meant.
UPDATE service_requests
SET type = 'rent-agreement'
WHERE type = 'rental';

-- 3b. Whatever is left is genuinely unrecognisable; park it on the free desk.
UPDATE service_requests
SET type = 'legal'
WHERE type NOT IN ('rent-agreement', 'legal', 'interior', 'packers', 'valuation');

ALTER TABLE service_requests
    ADD CONSTRAINT service_requests_type_check
    CHECK (type IN ('rent-agreement', 'legal', 'interior', 'packers', 'valuation'));
