package com.draazy.api.deals.offer;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * The request body for {@code POST /offers/{id}/respond} (contract {@code OfferResponse}).
 *
 * @param action        one of {@link OfferActions#ACCEPT}, {@link OfferActions#DECLINE} or
 *                      {@link OfferActions#COUNTER}
 * @param counterAmount required when {@code action == "counter"}; whole INR
 */
public record OfferRespondRequest(
        @NotBlank @Pattern(regexp = OfferActions.PATTERN, message = OfferActions.PATTERN_MESSAGE)
        String action,
        @Positive Long counterAmount,
        @Size(max = 1000) String message) {
}
