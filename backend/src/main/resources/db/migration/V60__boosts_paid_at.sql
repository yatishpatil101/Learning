-- V60 D64: add paid_at to boosts so revenue queries use actual payment confirmation rather than
-- starts_at (the window-open proxy). starts_at will also be set on comp/manual-grant activations,
-- while paid_at is stamped only by the payment webhook — their divergence is how the finance desk
-- will tell a paid promotion from a gifted one.
--
-- Backfill: every row whose status is 'active' was activated by the webhook, so starts_at is the
-- payment instant for those. 'expired' rows may have failed or succeeded; if starts_at is non-null
-- the window did open (payment arrived), so backfill those too. Rows with a null starts_at (failed
-- payments, abandoned checkouts) correctly receive a null paid_at.

ALTER TABLE boosts ADD COLUMN paid_at timestamptz;

UPDATE boosts
   SET paid_at = starts_at
 WHERE starts_at IS NOT NULL;

COMMENT ON COLUMN boosts.paid_at IS
    'Stamped when a payment webhook confirms receipt of funds. Null for comp activations and '
    'unpaid rows. Used by finance queries instead of starts_at so a manual-grant path cannot '
    'inflate revenue (D64).';
