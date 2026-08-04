package com.punenest.api.billing.marketplace;

/**
 * Contract {@code ServiceOffering} — one line of the marketplace price list.
 *
 * @param startingPrice indicative whole rupees; the real amount is quoted after a survey
 */
public record ServiceOfferingDto(
        String id,
        String name,
        String category,
        Long startingPrice,
        String description) {
}
