package com.draazy.api.billing.boost;

/** Contract {@code BoostPack} — one line of the public promotion price list. */
public record BoostPackDto(
        String id,
        String name,
        long price,
        Integer durationDays,
        String placement) {
}
