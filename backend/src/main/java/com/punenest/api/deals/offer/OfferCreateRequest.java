package com.punenest.api.deals.offer;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * The request body for {@code POST /offers} (contract {@code OfferCreate}).
 *
 * @param propertyId the listing being offered on (required — S1 spec fix)
 * @param amount     whole INR (the contract's {@code Money} type)
 * @param message    optional free-text note from the buyer
 * @param moveIn     the buyer's preferred possession date (optional — D112); a calendar day, not an
 *                   instant, so a bare {@code LocalDate}. Unconstrained on purpose: a buyer may name
 *                   any date, and refusing a past one here would 422 a flow the mock accepts
 */
public record OfferCreateRequest(
        @NotBlank String propertyId,
        @NotNull @Positive Long amount,
        @Size(max = 1000) String message,
        LocalDate moveIn) {
}
