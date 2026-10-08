package com.draazy.api.catalog.society;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.PositiveOrZero;
import java.math.BigDecimal;

/** PATCH body: absent means unchanged; an empty {@code adminNote} clears it, so it cannot be coalesced away. */
public record SocietyAdminEditRequest(
        Boolean registration,
        Boolean conveyance,

        /* Capped at 100: this is rupees per sq ft (1-8 in Pune), and a typed 4,500 would quote a flat at lakhs
           a month on the public hub. Zero is allowed: some societies charge nothing. */
        @PositiveOrZero(message = "Maintenance cannot be negative.")
        @DecimalMax(value = "100", message = "Maintenance is rupees per sq ft, not the monthly bill.")
        BigDecimal maintenancePerSqft,

        String adminNote) {
}
