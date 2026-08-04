package com.punenest.api.deals.offer;

import java.time.Instant;
import java.util.List;

/**
 * One offer as the wire sees it (contract {@code Offer}).
 *
 * <p>{@link #from} is a {@link Party} object — the buyer's identity with a mobile that is
 * contact-gated (masked until the owner acts). Direction lives in {@code history[].by},
 * not in the top-level object (reconciliation item g).
 *
 * @param id         opaque offer id
 * @param propertyId the listing the offer is against
 * @param from       the buyer as a {@link Party} (masked mobile until accepted)
 * @param amount     current (possibly countered) amount in whole INR
 * @param status     one of {@link OfferStatuses}
 * @param message    free-text note
 * @param createdAt  when the offer was first submitted
 * @param history    the negotiation trail — amount events only (submit + counters)
 */
public record OfferDto(
        String id,
        String propertyId,
        Party from,
        long amount,
        String status,
        String message,
        Instant createdAt,
        List<HistoryEntry> history) {

    /**
     * A platform user acting as a participant on the offer (contract {@code Party}).
     *
     * @param id     user id
     * @param name   display name
     * @param mobile contact-gated; masked ({@code 98XXXXX210}) until the owner has acted
     * @param role   {@code buyer} or {@code owner}
     */
    public record Party(String id, String name, String mobile, String role) {
    }

    /**
     * One negotiation-trail entry (contract {@code Offer.history[]} item).
     *
     * @param amount the proposed amount at this point
     * @param by     {@code buyer} or {@code owner} — direction inferred server-side
     * @param at     when this event occurred
     */
    public record HistoryEntry(long amount, String by, Instant at) {
    }
}
