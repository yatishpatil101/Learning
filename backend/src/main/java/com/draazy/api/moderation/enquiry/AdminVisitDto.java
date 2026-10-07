package com.draazy.api.moderation.enquiry;

import java.time.Instant;

// Not VisitDto: that one gates the mobile on the viewer's relationship to the visit, and an operator has none.
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
