package com.punenest.api.finance.rent;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * Request to set up or change an autopay mandate.
 *
 * <p>Split from the read shape for the same reason as {@link PayoutAccountUpdateRequest}: the read
 * carries {@code id}, {@code status} and {@code provider}, none of which a client may assert.
 * Letting a caller PUT {@code status: active} would let a tenant reactivate a mandate they had
 * revoked, which is consent they never re-gave.
 *
 * @param tenancyId  which tenancy the mandate charges against; must be the caller's own
 * @param maxAmount  the ceiling the tenant authorises, whole rupees
 * @param dayOfMonth 1–28 only; a mandate set for the 30th does not fire in February, which is the
 *                   one month a tenant most needs it to work
 * @param status     optionally {@code paused} or {@code revoked} to change an existing mandate;
 *                   absent means "leave it as it is"
 */
public record RentMandateUpdateRequest(
        @NotBlank String tenancyId,
        @PositiveOrZero Long maxAmount,
        @Min(1) @Max(28) Integer dayOfMonth,
        String status) {
}
