package com.draazy.api.catalog.society;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.PositiveOrZero;
import java.math.BigDecimal;

/**
 * The back-office society editor's body. Every field is optional, and absent means unchanged.
 *
 * <p>The form sends all five together, but the route is a {@code PATCH} and is written to mean it:
 * an operator who opens the editor to tick one box must not blank the four fields somebody else
 * researched last month, and a body-shaped-like-the-row update is the commonest way that happens
 * quietly. {@code adminNote} is the one field where a value is not the only way to say something —
 * an empty string clears the note, which is why it cannot simply be coalesced away.
 *
 * @param registration       whether the society's registration is on file
 * @param conveyance         whether conveyance has been completed
 * @param maintenancePerSqft monthly maintenance in rupees per square foot
 * @param claimStatus        one of {@link SocietyClaimStatus}
 * @param adminNote          internal note; blank clears it, absent leaves it alone
 */
public record SocietyAdminEditRequest(
        Boolean registration,
        Boolean conveyance,

        /*
         * Capped at 100 because the mistake this catches is real and silent: the figure is rupees
         * per square foot -- one to eight in Pune -- and the box beside it on every maintenance
         * screen an operator has ever seen is the monthly bill. A 4,500 typed here validates
         * against a bare non-negative check and then quotes a two-bedroom flat at eleven lakh a
         * month on the public hub. Zero is allowed: some societies genuinely charge nothing.
         */
        @PositiveOrZero(message = "Maintenance cannot be negative.")
        @DecimalMax(value = "100", message = "Maintenance is rupees per sq ft, not the monthly bill.")
        BigDecimal maintenancePerSqft,

        String claimStatus,
        String adminNote) {
}
