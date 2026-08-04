package com.punenest.api.deals.deal;

import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;

/**
 * Hand-written mapper for the deals feature. MapStruct is not used here because the projection
 * is entirely trust-shaping: the counterparty may be off-platform, and mobile masking must stay
 * reviewable in source, not in generated code ({@code api-standards.md} §8.1).
 *
 * <p>The masking helper is {@code private} so it cannot be accidentally exposed.
 */
public final class DealMapper {

    private DealMapper() {
    }

    /**
     * Project a stored deal for the wire.
     *
     * @param deal          the stored row
     * @param counterparty  the resolved user, or {@code null} for off-platform
     */
    public static DealDto toDto(Deal deal, User counterparty) {
        return new DealDto(
                deal.getId().toString(),
                deal.getPropertyId().toString(),
                deal.getDeal(),
                toCounterpartyParty(deal, counterparty),
                deal.getAgreedPrice(),
                deal.getStatus(),
                deal.getClosedAt());
    }

    /**
     * Synthesize an active deal DTO when no stored row exists (reconciliation item d).
     *
     * @param propertyId the listing id
     * @param dealIntent {@code buy} or {@code rent}
     */
    public static DealDto synthesizeActive(String propertyId, String dealIntent) {
        return new DealDto(
                null,
                propertyId,
                dealIntent,
                null,
                null,
                DealStatuses.ACTIVE,
                null);
    }

    /** Project a deal party for the wire. */
    public static DealPartyDto toPartyDto(DealParty party) {
        return new DealPartyDto(
                party.getId().toString(),
                party.getName(),
                party.getMobile(),
                party.getNote(),
                party.getCreatedAt());
    }

    /**
     * Build the counterparty {@link DealDto.Party}. For an off-platform close, {@code id} and
     * {@code name} may be null — the mobile is always present.
     *
     * <p>Mobile visibility: the owner is the only viewer of their own deal, and they typed the
     * mobile in themselves on close, so it is <strong>revealed</strong>. Still routed through
     * {@link MobileMask#applyTo} behind a private method so the rule stays in one place.
     */
    private static DealDto.Party toCounterpartyParty(Deal deal, User counterparty) {
        if (deal.getCounterpartyMobile() == null && counterparty == null) {
            return null;
        }
        String mobile = deal.getCounterpartyMobile();
        // why: the owner typed this mobile; reveal it, but route through MobileMask so the
        // rule stays in one place and MapStruct cannot adopt it as an implicit converter.
        String maskedOrRevealed = maskMobile(mobile, ContactVisibility.REVEALED);
        return new DealDto.Party(
                counterparty != null ? counterparty.getId().toString() : null,
                counterparty != null ? counterparty.getName() : null,
                maskedOrRevealed,
                "buyer");
    }

    /**
     * Mask or reveal. Delegates to {@link MobileMask} — the single definition. Kept private
     * so no other class can call it (§8.1).
     */
    private static String maskMobile(String mobile, ContactVisibility visibility) {
        return MobileMask.applyTo(mobile, visibility);
    }
}
