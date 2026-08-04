package com.punenest.api.finance.rent;

/**
 * An owner's payout destination as returned (contract {@code PayoutAccount}).
 *
 * <p><strong>Read shape only — the full account number is never here</strong>, because it is never
 * stored. See {@link PayoutAccount} and spec fix S11.
 *
 * @param accountHolder  the name on the account
 * @param maskedAccount  masked tail, e.g. {@code XXXXXX7890}
 * @param ifsc           branch code
 * @param upiId          VPA, if the owner settles by UPI instead
 * @param verified       whether the payout rail's penny-drop succeeded; never client-supplied
 */
public record PayoutAccountDto(
        String accountHolder,
        String maskedAccount,
        String ifsc,
        String upiId,
        boolean verified) {

    /**
     * The shape returned when an owner has not linked an account.
     *
     * <p>Empty object rather than 404, per the slice-5 D5 ruling: not having set up payouts yet is
     * a normal state, and the client needs to render an empty form either way.
     */
    public static PayoutAccountDto none() {
        return new PayoutAccountDto(null, null, null, null, false);
    }
}
