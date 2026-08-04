package com.punenest.api.deals.visit;

import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;

/**
 * Hand-written mapper for the visits feature. MapStruct is not used here because the entire
 * projection is trust-shaping: the visitor's mobile is gated (masked until the owner confirms),
 * and the viewer's own number is always revealed — these decisions must stay reviewable in source,
 * not in generated code ({@code api-standards.md} §8.1).
 *
 * <p>The masking helper is {@code private} so it cannot be accidentally exposed or imported.
 */
public final class VisitMapper {

    private VisitMapper() {
    }

    /**
     * Project one visit for the wire.
     *
     * @param visit      the stored row
     * @param visitor    the user who booked (resolved in batch)
     * @param visibility whether the visitor's mobile should be revealed
     */
    public static VisitDto toDto(Visit visit, User visitor, ContactVisibility visibility) {
        return new VisitDto(
                visit.getId().toString(),
                visit.getPropertyId().toString(),
                toParty(visitor, visibility),
                visit.getSlot(),
                visit.getMode(),
                visit.getStatus(),
                visit.getCreatedAt());
    }

    /**
     * Build a {@link VisitDto.Party} for the visitor. Mobile is masked unless the owner has
     * confirmed (status confirmed/completed/no-show) or an approved contact request exists (D5).
     */
    private static VisitDto.Party toParty(User visitor, ContactVisibility visibility) {
        if (visitor == null) {
            return null;
        }
        return new VisitDto.Party(
                visitor.getId().toString(),
                visitor.getName(),
                maskMobile(visitor.getMobile(), visibility),
                "buyer");
    }

    /**
     * Mask or reveal. Delegates to {@link MobileMask} — the single definition. Kept private
     * so no other class can call it and mistake it for a general-purpose utility (§8.1).
     */
    private static String maskMobile(String mobile, ContactVisibility visibility) {
        return MobileMask.applyTo(mobile, visibility);
    }
}
