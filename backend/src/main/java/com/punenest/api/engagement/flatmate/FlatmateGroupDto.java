package com.punenest.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Contract schema {@code FlatmateGroup}.
 *
 * <p>{@link #seatsOpen()} is the honest count for a tenant backfilling one seat of a full flat — it
 * is <em>not</em> {@code seatsTotal - members}. See {@link FlatmateGroup#openSeats()}.
 *
 * <p>{@link #ownerMobile()} is null on the anonymous feed, as everywhere else in this domain.
 */
public record FlatmateGroupDto(
        UUID id,
        String title,
        String locality,
        String policy,
        Long rent,
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

    /**
     * The contract's inline member object. No user id: a member is a person, not necessarily a user.
     *
     * <p>{@link #name} and {@link #initials} are null when this member has not given a name — an OTP
     * account carries none until its profile is filled in (D118). They are then simply absent from
     * the response; a client renders its own placeholder rather than being handed an invented one.
     */
    public record Member(String name, String initials, boolean verified) {
    }
}
