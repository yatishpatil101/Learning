package com.draazy.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.util.List;

/** One reel: the card line plus its first {@link #MAX_PHOTOS} photos, so the feed needs no detail reads. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PropertyReel(
        String id,
        String slug,
        String title,
        String deal,
        BigDecimal bhk,
        Long price,
        BigDecimal area,
        String locality,
        List<String> photos) {

    public static final int MAX_PHOTOS = 5;
}
