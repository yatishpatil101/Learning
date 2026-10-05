package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Contract schema {@code FlatmateGroup}. {@link #seatsOpen()} is not
 * {@code seatsTotal - members} — see {@link FlatmateGroup#openSeats()}. */
public record FlatmateGroupDto(
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
        String ownerConsentMobile,
        String reviewStatus,
        String addressFingerprint,
        boolean flagForReview,
        String modStatus,
        List<String> tags,
        String note,
        String ownerName,
        String ownerMobile,
        Instant createdAt,
        FlatmateGroupPreferences preferences) {

    public record Member(UUID id, String name, String initials, boolean verified, boolean host) {
    }
}
