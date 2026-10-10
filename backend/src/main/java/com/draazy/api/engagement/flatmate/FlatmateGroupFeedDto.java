package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record FlatmateGroupFeedDto(
        UUID id,
        String title,
        String locality,
        String policy,
        Long rent,
        Long deposit,
        Integer noticePeriodDays,
        Integer lockInMonths,
        String maintenanceBilling,
        String electricityBilling,
        Long perHead,
        int seatsTotal,
        int seatsOpen,
        List<Member> members,
        UUID propertyId,
        String hostRole,
        String verificationTier,
        boolean agreementDeclared,
        boolean ownerConsent,
        String reviewStatus,
        List<String> tags,
        String note,
        String ownerName,
        Instant createdAt,
        FlatmateGroupPreferences preferences) {

    /** No member-row id: only the host's own read needs it, to remove someone. */
    public record Member(String name, String initials, boolean verified, boolean host) {
    }
}
