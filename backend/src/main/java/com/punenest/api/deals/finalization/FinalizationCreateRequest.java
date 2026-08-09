package com.punenest.api.deals.finalization;

import com.punenest.api.common.validation.IndianMobile;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/**
 * The request body for {@code POST /finalization/{propId}/request} (contract
 * {@code FinalizationCreate}).
 *
 * <p>{@code propertyId} is an optional echo of the {@code {propId}} path parameter. If present it
 * MUST equal the path value; a mismatch is a 422 (S4). The path is authoritative.
 *
 * @param propertyId        optional echo of the path param (must match if present)
 * @param counterpartyMobile 10-digit Indian mobile of the listing owner (must be registered)
 * @param agreedPrice       whole INR — the agreed price
 */
public record FinalizationCreateRequest(
        String propertyId,
        @NotBlank @IndianMobile
        String counterpartyMobile,
        @NotNull @Positive Long agreedPrice) {
}
