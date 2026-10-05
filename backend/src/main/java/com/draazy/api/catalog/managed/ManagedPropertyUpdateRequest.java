package com.draazy.api.catalog.managed;

import com.draazy.api.catalog.property.AreaUnit;
import com.draazy.api.catalog.property.DealIntent;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import java.math.BigDecimal;
import java.util.Map;

/** Every field is nullable because PATCH applies only values that are present. */
public record ManagedPropertyUpdateRequest(
        String title,
        @Pattern(regexp = DealIntent.PATTERN, message = DealIntent.PATTERN_MESSAGE) String deal,
        String propertyType,
        BigDecimal bhk,
        @PositiveOrZero Long price,
        String locality,
        String society,
        BigDecimal area,
        @Pattern(regexp = AreaUnit.PATTERN, message = AreaUnit.PATTERN_MESSAGE) String areaUnit,
        String furnishing,
        Boolean rented,
        String tenantName,
        Long monthlyRent,
        Integer dueDay,
        Map<String, Object> valuation) {
}
