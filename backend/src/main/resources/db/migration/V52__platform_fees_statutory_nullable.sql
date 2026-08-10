-- V52 The rent row's statutory charges become nullable: "not a flat number" is a real answer (D163).
--
-- WHAT WAS WRONG
--
-- `platform_fees` publishes one flat figure per column per deal intent, and the `rent` row seeded
-- `stamp_duty = 0` and `registration = 0`. D150 then made the rent-agreement sidebar render the
-- server's breakdown instead of computing its own, so the displayed price became the charged price
-- by construction -- and both became wrong together. The platform billed `1999 + 0 + 0 + GST` for a
-- Leave & License that legally attracts stamp duty under Article 36A of the Maharashtra Stamp Act
-- and a registration fee under the Registration Act. Every rupee of that gap is money the platform
-- would have had to remit out of its own margin, per agreement.
--
-- WHY NULLABLE RATHER THAN A BETTER NUMBER
--
-- There is no better number. Art. 36A duty is 0.25% of a consideration built from the rent, the
-- term and the deposit, so it is ~918 rupees for a 32k/11-month tenancy and several times that for
-- a longer or larger one. Any single figure seeded here is correct for exactly one agreement and
-- wrong for all the others, and a confident wrong figure on a public page is worse than the honest
-- zero it replaces. Registration is genuinely flat, but it is flat *per registering body* -- Rs 1000
-- municipal, Rs 500 rural -- which one column also cannot say.
--
-- So the column stops claiming to know. NULL here means "this line is computed per agreement, not
-- published", which is the truth; the arithmetic lives in `catalog.fee.LeaveAndLicenceCharges` and
-- is applied per request beside `ServiceRequestService.priceFor`. The contract permits it already:
-- `Fees` declares no required properties and `FeeResponse` carries boxed `Long`s, so no response
-- shape changes -- the two fields simply stop carrying a figure for `rent`.
--
-- THE WIZARD NEEDS ONE LINE TO MATCH -- DO NOT SHIP THIS ALONE
--
-- The rent-agreement wizard has always had the correct Art. 36A fallback behind
-- `if (stampDuty == null)` and has always labelled the result an estimate via `computed`; that
-- branch was dead only because these columns could not be null. It is still dead, because
-- `frontend/src/services/providers/http/feesProvider.js` coerces the wire value with
-- `Number(row?.stampDuty) || 0`, on the stated ground that "the server's columns are NOT NULL, so
-- absence here is a contract break rather than 'not published'". This migration is exactly what
-- retires that premise, so that provider must pass null through:
--
--     stampDuty:    row?.stampDuty    == null ? null : Number(row.stampDuty) || 0,
--     registration: row?.registration == null ? null : Number(row.registration) || 0,
--
-- Until it does, the sidebar renders 0 for both lines while the server charges the real figure, and
-- the customer is quoted less than they are asked to pay. The backend half is correct on its own;
-- it is not *releasable* on its own.
--
-- The `buy` row is untouched. Its `stamp_duty = 0` is its own untruth -- Maharashtra charges 6-7% of
-- agreement value on a sale -- but that is a separate figure with a separate rule and is not D163.
--
-- SAFETY
--
-- Dropping NOT NULL and a DEFAULT is metadata-only on PostgreSQL: no table rewrite, no lock beyond
-- the brief ACCESS EXCLUSIVE the catalogue update needs, and every existing row keeps its value.
-- Nothing writes this table from application code (PlatformFee has no setters), so the only writer
-- is the repeatable seed, which sets both columns explicitly.

ALTER TABLE platform_fees
    ALTER COLUMN stamp_duty   DROP DEFAULT,
    ALTER COLUMN stamp_duty   DROP NOT NULL,
    ALTER COLUMN registration DROP DEFAULT,
    ALTER COLUMN registration DROP NOT NULL;

COMMENT ON COLUMN platform_fees.stamp_duty IS
    'Published stamp duty, whole rupees. NULL = not a flat figure, computed per agreement (D163); see catalog.fee.LeaveAndLicenceCharges.';
COMMENT ON COLUMN platform_fees.registration IS
    'Published registration fee, whole rupees. NULL = depends on the registering body, computed per agreement (D163): Rs 1000 municipal / Rs 500 rural.';
