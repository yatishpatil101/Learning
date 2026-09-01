package com.punenest.api.deals.visit;

import java.time.Instant;

/**
 * One visit as the wire sees it (contract {@code Visit}).
 *
 * <p>{@link #visitor} is a {@link Party} object — the visitor's identity with a mobile that is
 * contact-gated. Two readers may see the digits: the visitor themselves, at every status, and the
 * listing owner once the visit is {@code confirmed} (or {@code completed} / {@code no-show}, which
 * only follow it). While a visit is merely {@code scheduled} the owner sees {@code 97XXXXX734} —
 * booking must not be a way to harvest a phone number. A reschedule resets the status to
 * {@code scheduled} (D87) and therefore re-masks it. See
 * {@code VisitService#visitorMobileVisibility}, which is the one place that decides this.
 *
 * <p>Until 2026-08 this paragraph said "masked until the owner confirms" while the code masked it
 * unconditionally — documented behaviour that had never shipped. The gap is recorded rather than
 * quietly closed because it is the reason the owner→visitor WhatsApp handoff sat dead behind an
 * {@code isFullMobile} guard for months: the client failed safe on a masked value, so nothing ever
 * went red. A privacy field documented backwards is worse than one left undocumented.
 *
 * @param id         opaque visit id
 * @param propertyId the listing the visit is against
 * @param visitor    the visitor as a {@link Party} (mobile gated — see above)
 * @param slot       the proposed date/time as a single ISO instant
 * @param mode       {@code in-person} or {@code video}
 * @param status     one of {@link VisitStatuses}
 * @param createdAt  when the visit was booked
 */
public record VisitDto(
        String id,
        String propertyId,
        Party visitor,
        Instant slot,
        String mode,
        String status,
        Instant createdAt) {

    /**
     * A platform user acting as a participant on the visit (contract {@code Party}).
     *
     * @param id     user id
     * @param mobile contact-gated; raw to the visitor themselves at every status, raw to the
     *               listing owner once the visit is confirmed, and masked
     *               ({@code 98XXXXX210}) to everyone else
     * @param role   always {@code buyer} (the visitor)
     */
    public record Party(String id, String name, String mobile, String role) {
    }
}
