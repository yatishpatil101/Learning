package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Contract schema {@code FlatmateGroup}. {@link #seatsOpen()} is <em>not</em>
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
        Instant createdAt) {

    /** No user id: a member is a person, not necessarily a user. {@code name} and {@code initials}
     * are null when none was given, so a client renders its own placeholder. */
    public record Member(String name, String initials, boolean verified) {
    }
}
