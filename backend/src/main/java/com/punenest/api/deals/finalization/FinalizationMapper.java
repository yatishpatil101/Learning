package com.punenest.api.deals.finalization;

import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;

/**
 * Hand-written mapper for the finalization feature. MapStruct is not used here because the entire
 * projection is trust-shaping: both parties' mobiles are gated (masked until accepted), and the
 * viewer's own number is always revealed — these decisions must stay reviewable in source, not in
 * generated code ({@code api-standards.md} §8.1).
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
     * @param status     the request status (drives masking: pending = masked, accepted = revealed)
     */
    public static FinalizationRequestDto toDto(FinalizationRequest request,
                                                User initiator,
                                                User counterparty,
                                                java.util.UUID viewerId) {
        ContactVisibility initiatorVis = mobileVisibility(
                viewerId, request.getInitiatorId(), request.getStatus());
        ContactVisibility counterpartyVis = mobileVisibility(
                viewerId, request.getCounterpartyId(), request.getStatus());

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
     * <p>A viewer always sees their own number. Otherwise: masked while pending, revealed once
     * accepted. This mirrors the offer masking rule (D5): a finalization request is itself an
     * approach, so each side's mobile stays masked until the request is accepted.
     */
    private static ContactVisibility mobileVisibility(java.util.UUID viewerId,
                                                       java.util.UUID partyId,
                                                       String status) {
        if (viewerId.equals(partyId)) {
            return ContactVisibility.REVEALED;
        }
        if (FinalizationStatuses.ACCEPTED.equals(status)) {
            return ContactVisibility.REVEALED;
        }
        return ContactVisibility.MASKED;
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
