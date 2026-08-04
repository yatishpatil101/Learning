package com.punenest.api.deals.offer;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * The request body for {@code POST /offers} (contract {@code OfferCreate}).
 *
 * @param propertyId the listing being offered on (required — S1 spec fix)
 * @param amount     whole INR (the contract's {@code Money} type)
 * @param message    optional free-text note from the buyer
 */
public record OfferCreateRequest(
        @NotBlank String propertyId,
        @NotNull @Positive Long amount,
        @Size(max = 1000) String message) {
}
