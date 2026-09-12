package com.draazy.api.deals.offer;

import java.time.Instant;
import java.time.LocalDate;
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
 * @param createdAt  when the offer was first submitted
 * @param moveIn     the buyer's preferred possession date, or {@code null} if none was given (D112)
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
        LocalDate moveIn,
        List<HistoryEntry> history) {

    /**
     * A platform user acting as a participant on the offer (contract {@code Party}).
     *
     * <p><strong>{@code verified} is on this object because it cannot be derived from
     * {@code mobile}</strong> (tech-debt D114). The badge used to be resolved client-side by
     * looking the party's number up against the verified list. That works only while the number is
     * real: {@code mobile} here is contact-gated and normally arrives as {@code 98XXXXX210}, and a
     * mask is not reversible, so the lookup silently answered "not verified" for everyone. The
     * server holds both the identity and the badge, so it answers the question directly and the
     * masked digits are never asked to stand in for an identity.
     *
     * @param id       user id
     * @param mobile   contact-gated; masked ({@code 98XXXXX210}) until the owner has acted
     * @param role     {@code buyer} or {@code owner}
     * @param verified whether this party carries the Verified Tenant badge
     */
    public record Party(String id, String name, String mobile, String role, boolean verified) {
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
