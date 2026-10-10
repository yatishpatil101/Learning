package com.draazy.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record PropertyCompare(
        String id,
        String slug,
        String deal,
        String propertyType,
        BigDecimal bhk,
        Long price,
        BigDecimal area,
        String areaUnit,
        String furnishing,
        String possession,
        String reraId,
        List<String> amenities,
        String locality,
        String city,
        String coverImage) {
}
