package com.draazy.api.catalog.managed;

import com.draazy.api.catalog.property.AreaUnit;
import com.draazy.api.catalog.property.DealIntent;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import java.math.BigDecimal;
import java.util.Map;

/** Server-owned fields are absent so clients cannot supply visibility, status, or owner. */
public record ManagedPropertyCreateRequest(
        String title,
        @NotNull @Pattern(regexp = DealIntent.PATTERN, message = DealIntent.PATTERN_MESSAGE) String deal,
        @NotBlank String propertyType,
        BigDecimal bhk,
        @NotNull @PositiveOrZero Long price,
        @NotBlank String locality,
        String localitySlug,
        String societyId,
        BigDecimal area,
        @Pattern(regexp = AreaUnit.PATTERN, message = AreaUnit.PATTERN_MESSAGE) String areaUnit,
        String furnishing,
        Boolean rented,
        String tenantName,
        Long monthlyRent,
        Integer dueDay,
        Map<String, Object> valuation,
        String publishedListingId) {
}
