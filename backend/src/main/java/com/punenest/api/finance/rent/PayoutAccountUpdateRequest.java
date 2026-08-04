package com.punenest.api.finance.rent;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request to set an owner's payout account (contract {@code PayoutAccountUpdate}, spec fix S11).
 *
 * <p><strong>Why this is a separate shape from the read.</strong> GET and PUT originally shared one
 * schema whose only account field was {@code maskedAccount} — and you cannot <em>set</em> a bank
 * account from {@code XXXXXX7890}, so the write endpoint was uncallable as specified. Splitting
 * them also stops a client sending {@code verified: true} about itself: bank verification is the
 * payout rail's penny-drop answer, not the account holder's claim.
 *
 * <p>{@code accountNumber} is {@code writeOnly} in the contract and is never persisted in full —
 * only its masked tail is kept.
 *
 * @param accountHolder the name on the account; the one field always required
 * @param accountNumber full account number, required unless {@code upiId} is given
 * @param ifsc          branch code, required alongside {@code accountNumber}
 * @param upiId         VPA, an alternative to the account/IFSC pair
 */
public record PayoutAccountUpdateRequest(
        @NotBlank @Size(max = 120) String accountHolder,
        @Pattern(regexp = "^[0-9]{9,18}$",
                message = "must be 9-18 digits") String accountNumber,
        @Pattern(regexp = "^[A-Z]{4}0[A-Z0-9]{6}$",
                message = "must be a valid IFSC, e.g. HDFC0001234") String ifsc,
        @Size(max = 120) String upiId) {
}
