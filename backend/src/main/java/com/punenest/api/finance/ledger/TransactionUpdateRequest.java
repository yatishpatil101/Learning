package com.punenest.api.finance.ledger;

import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * The request body for {@code PATCH /me/finances/{propId}/transactions/{txnId}} (contract
 * {@code TransactionUpdate}, spec fix S19).
 *
 * <p><strong>Every field is optional, and absent means "leave it alone".</strong> That is what
 * PATCH means, and it is what the UI sends — the mock merges {@code {...txn, ...patch}}. The
 * contract previously reused {@code TransactionCreate} here, whose {@code required: [type, amount,
 * date]} obliged a client correcting a typo in {@code note} to resend three fields it had no reason
 * to touch.
 *
 * <p>The consequence is that {@code null} cannot be distinguished from "absent" for
 * {@code category} and {@code note} — a Jackson-bound record sees both as {@code null}. That is
 * accepted rather than solved with {@code Optional} wrappers or a raw map: the only fields where
 * "clear this value" is a meaningful instruction are the two free-text ones, and an owner clears
 * them by sending an empty string, which the service normalises to null. Paying for a
 * three-state field everywhere to serve that one case is not worth the shape it would force on
 * every caller.
 *
 * @param type      one of {@link TransactionTypes}, or null to leave unchanged
 * @param category  free text, or empty string to clear
 * @param amount    whole INR, unsigned and non-zero, or null to leave unchanged
 * @param date      the date the money moved, or null to leave unchanged
 * @param note      free text, or empty string to clear
 * @param recurring one of {@link RecurringIntervals}, or null to leave unchanged
 */
public record TransactionUpdateRequest(
        String type,
        @Size(max = 100) String category,
        @Positive Long amount,
        LocalDate date,
        @Size(max = 1000) String note,
        String recurring) {
}
