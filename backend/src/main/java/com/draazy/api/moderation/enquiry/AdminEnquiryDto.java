package com.draazy.api.moderation.enquiry;

import java.time.Instant;

public record AdminEnquiryDto(
        String id,
        String propertyId,
        String propertyTitle,
        String locality,
        String requesterName,
        String requesterMobile,
        String status,
        Instant createdAt) {
}
