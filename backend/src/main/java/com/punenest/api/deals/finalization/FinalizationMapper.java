package com.punenest.api.deals.finalization;

import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;

/**
 * Hand-written mapper for the finalization feature. MapStruct is not used here because the entire
 * projection is trust-shaping: only the viewer's own number is revealed — the counterparty's mobile
 * stays masked at every status (D5 global policy; a finalization request is pre-deal) — and these
 * decisions must stay reviewable in source, not in generated code ({@code api-standards.md} §8.1).
 *
 * <p>The masking helper is {@code private} so it cannot be accidentally exposed or imported.
 */
public final class FinalizationMapper {

    private FinalizationMapper() {
    }

    /**
     * Project one finalization request for the wire.
     *
     * @param request    the stored row
     * @param initiator  the user who initiated (resolved in batch)
     * @param counterparty the user who must accept (resolved in batch)
     * @param viewerId   the current caller's id (to determine own-number reveal)
     */
    public static FinalizationRequestDto toDto(FinalizationRequest request,
                                                User initiator,
                                                User counterparty,
                                                java.util.UUID viewerId) {
        ContactVisibility initiatorVis = mobileVisibility(viewerId, request.getInitiatorId());
        ContactVisibility counterpartyVis = mobileVisibility(viewerId, request.getCounterpartyId());

        return new FinalizationRequestDto(
                request.getId().toString(),
                request.getPropertyId().toString(),
                toParty(initiator, initiatorVis, "buyer"),
                toParty(counterparty, counterpartyVis, "owner"),
                request.getAgreedPrice(),
                request.getStatus(),
                request.getCreatedAt());
    }

    /**
     * Determine mobile visibility for a party in a finalization request.
     *
     * <p>A viewer sees only their own number (D5 global policy). The counterparty's mobile stays
     * masked at every status — a finalization request is pre-deal, so accepting it unlocks the in-app
     * conversation, not the digits; raw numbers are exchanged only on a signed tenancy/deal.
     */
    private static ContactVisibility mobileVisibility(java.util.UUID viewerId,
                                                       java.util.UUID partyId) {
        return viewerId.equals(partyId)
                ? ContactVisibility.REVEALED : ContactVisibility.MASKED;
    }

    private static FinalizationRequestDto.Party toParty(User user, ContactVisibility visibility,
                                                         String role) {
        if (user == null) {
            return null;
        }
        return new FinalizationRequestDto.Party(
                user.getId().toString(),
                user.getName(),
                maskMobile(user.getMobile(), visibility),
                role);
    }

    /**
     * Mask or reveal. Delegates to {@link MobileMask} — the single definition. Kept private
     * so no other class can call it and mistake it for a general-purpose utility (§8.1).
     */
    private static String maskMobile(String mobile, ContactVisibility visibility) {
        return MobileMask.applyTo(mobile, visibility);
    }
}
