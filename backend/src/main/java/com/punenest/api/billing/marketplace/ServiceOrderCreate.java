package com.punenest.api.billing.marketplace;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/**
 * Contract {@code ServiceOrderCreate}.
 *
 * <p>No {@code amount}: the customer does not get to name the price, and there is no price to name
 * until the job is surveyed.
 *
 * @param propertyId    optional — some services (a home loan) attach to no listing at all
 * @param preferredSlot the slot the customer asked for; ops confirms or moves it
 */
public record ServiceOrderCreate(
        @NotBlank String offeringId,
        String propertyId,
        Instant preferredSlot,
        @Size(max = 2000) String notes) {
}
