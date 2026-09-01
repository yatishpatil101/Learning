package com.punenest.api.moderation.enquiry;

import java.time.Instant;

/**
 * One site visit as the demand board shows it.
 *
 * <p>Not {@code VisitDto}: that record's mobile is contact-gated on the <em>viewer's</em>
 * relationship to the visit, which is a question with no answer for an operator who is neither the
 * visitor nor the owner. Masked unconditionally here, for the same reason as
 * {@link AdminEnquiryDto}.
 *
 * @param id            opaque visit id
 * @param propertyId    the listing being visited
 * @param propertyTitle the listing's title
 * @param locality      the listing's locality slug
 * @param visitorName   who is visiting
 * @param visitorMobile <strong>always masked</strong>
 * @param slot          the agreed date and time
 * @param mode          {@code in-person} or {@code video}
 * @param status        {@code scheduled}, {@code completed} or {@code cancelled}
 * @param createdAt     when the visit was booked
 */
public record AdminVisitDto(
        String id,
        String propertyId,
        String propertyTitle,
        String locality,
        String visitorName,
        String visitorMobile,
        Instant slot,
        String mode,
        String status,
        Instant createdAt) {
}
