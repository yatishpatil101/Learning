package com.draazy.api.billing.boost;

import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Entity→wire projection for boost packs and boosts. Hand-written for the same reason as
 * {@code PlanMapper}: field copying plus the {@code UUID → String} id convention, with nothing
 * trust-shaped to hide (api-standards §8.1).
 */
@Component
public class BoostMapper {

    public BoostPackDto toDto(BoostPack pack) {
        return new BoostPackDto(
                pack.getId().toString(),
                pack.getName(),
                pack.getPrice(),
                pack.getDurationDays(),
                pack.getPlacement());
    }

    public List<BoostPackDto> toPackDtos(List<BoostPack> packs) {
        return packs.stream().map(this::toDto).toList();
    }

    public BoostDto toDto(Boost boost) {
        // paymentSessionId is single-use and never stored, so it is null from the entity; the
        // purchase flow attaches a fresh one via withPaymentSessionId for a priced pack (D167).
        return new BoostDto(
                boost.getId().toString(),
                boost.getPropertyId().toString(),
                boost.getPackId().toString(),
                boost.getStartsAt(),
                boost.getEndsAt(),
                boost.getStatus(),
                boost.getPaymentRef(),
                null);
    }
}
