package com.punenest.api.finance.ledger;

import java.time.LocalDate;

/**
 * One ledger row as the wire sees it (contract {@code Transaction}).
 *
 * <p>{@code amount} is whole INR and always positive; {@link #type} carries the direction. Clients
 * that want a signed figure apply the sign themselves — see {@link TransactionTypes} for why the
 * sign is not stored.
 *
 * @param id         opaque transaction id
 * @param propertyId the listing this row belongs to
 * @param type       one of {@link TransactionTypes}
 * @param category   owner-chosen free text, may be null
 * @param amount     whole INR, unsigned
 * @param date       the date the money moved
 * @param recurring  one of {@link RecurringIntervals}
 */
public record TransactionDto(
        String id,
        String propertyId,
        String type,
        String category,
        Long amount,
        LocalDate date,
        String note,
        String recurring) {
}
