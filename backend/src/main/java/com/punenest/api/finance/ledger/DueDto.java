package com.punenest.api.finance.ledger;

import java.time.LocalDate;

/**
 * A recurring ledger row projected forward to its next occurrence (contract {@code Due}, spec fix
 * S14).
 *
 * <p>The contract models this as {@code allOf: [Transaction, {nextDue, daysUntil}]}. It is a flat
 * record here rather than a wrapper because the wire shape is flat: a nested {@code transaction}
 * object would be a different JSON document from the one the contract describes.
 *
 * <p><strong>Why the server computes this at all.</strong> The recurrence rule is the server's —
 * it owns {@code recurring} and the anchor date — so the projection is the server's answer too.
 * The mock recomputes it in the browser; two implementations of a date rule drift, and then the
 * due date an owner sees depends on which screen they are looking at.
 *
 * @param id         opaque transaction id
 * @param type       one of {@link TransactionTypes}
 * @param category   owner-chosen free text
 * @param amount     whole INR, unsigned
 * @param date       the anchor — the last known occurrence
 * @param recurring  one of {@link RecurringIntervals}; never {@code none} here
 * @param nextDue    the next occurrence on or after today
 * @param daysUntil  whole days from today to {@code nextDue}; negative would mean overdue, though
 *                   {@code nextDue} is by construction never in the past
 */
public record DueDto(
        String id,
        String propertyId,
        String type,
        String category,
        Long amount,
        LocalDate date,
        String note,
        String recurring,
        LocalDate nextDue,
        long daysUntil) {
}
