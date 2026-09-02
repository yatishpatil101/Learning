package com.draazy.api.finance.ledger;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * The request body for {@code POST /me/finances/{propId}/transactions} (contract
 * {@code TransactionCreate}).
 *
 * <p>{@code amount} is {@code @Positive}: the sign is carried by {@code type}, so a negative
 * amount would be a second way to express an expense and the two would disagree in any query that
 * checked only one of them. Zero is rejected too — a ledger row for no money is not a fact about
 * anything.
 *
 * <p><strong>{@code date} is deliberately unconstrained.</strong> The instinct is to reject a
 * future date, since a ledger records money that has moved. But the Add-transaction modal's date
 * picker has no upper bound, so a server-side {@code @PastOrPresent} would turn a legitimate
 * entry — next month's EMI, a post-dated cheque — into a 422 the UI has no way to explain. The
 * owner's ledger is the owner's record of their own affairs; the server's job is to store it
 * faithfully, not to argue about which day it happened.
 *
 * @param type      one of {@link TransactionTypes} — validated in the service against the
 *                  vocabulary, not by an annotation, so the error is a typed 422 naming the field
 * @param category  owner-chosen free text; null is allowed
 * @param amount    whole INR, unsigned and non-zero
 * @param date      the date the money moved
 * @param recurring one of {@link RecurringIntervals}; null means {@code none}
 */
public record TransactionCreateRequest(
        @NotNull String type,
        @Size(max = 100) String category,
        @NotNull @Positive Long amount,
        @NotNull LocalDate date,
        @Size(max = 1000) String note,
        String recurring) {
}
