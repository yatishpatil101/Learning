package com.punenest.api.deals.offer;

import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Hand-written mapper for the offers feature. MapStruct is not used here because the entire
 * projection is trust-shaping: the buyer's mobile is gated, and the history trail is assembled
 * from a separate table — both are decisions a reviewer must read in source, not in generated code
 * ({@code api-standards.md} §8.1).
 *
 * <p>The masking helper is {@code private} so it cannot be accidentally exposed or imported.
 */
public final class OfferMapper {

    private OfferMapper() {
    }

    /**
     * Project one offer for the wire.
     *
     * @param offer      the stored row
     * @param buyer      the user who submitted the offer (resolved in batch)
     * @param history    the negotiation trail entries for this offer
     * @param visibility whether the buyer's mobile should be revealed
     */
    public static OfferDto toDto(Offer offer, User buyer, List<OfferHistory> history,
                                  ContactVisibility visibility) {
        return new OfferDto(
                offer.getId().toString(),
                offer.getPropertyId().toString(),
                toParty(buyer, visibility),
                offer.getAmount(),
                offer.getStatus(),
                offer.getMessage(),
                offer.getCreatedAt(),
                history.stream().map(OfferMapper::toHistoryEntry).toList());
    }

    /**
     * Build a {@link OfferDto.Party} for the buyer. Mobile is masked unless the owner has acted
     * (offer accepted) or an approved contact request exists (D5).
     */
    private static OfferDto.Party toParty(User buyer, ContactVisibility visibility) {
        if (buyer == null) {
            return null;
        }
        return new OfferDto.Party(
                buyer.getId().toString(),
                buyer.getName(),
                maskMobile(buyer.getMobile(), visibility),
                "buyer");
    }

    private static OfferDto.HistoryEntry toHistoryEntry(OfferHistory h) {
        return new OfferDto.HistoryEntry(h.getAmount(), h.getBy(), h.getAt());
    }

    /**
     * Mask or reveal. Delegates to {@link MobileMask} — the single definition. Kept private
     * so no other class can call it and mistake it for a general-purpose utility (§8.1).
     */
    private static String maskMobile(String mobile, ContactVisibility visibility) {
        return MobileMask.applyTo(mobile, visibility);
    }
}
