package com.punenest.api.finance.rent;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * Request to pay rent (contract {@code RentPaymentCreate}).
 *
 * <p><strong>There is no {@code amount} field, and that is spec fix S12.</strong> It used to be
 * required and client-supplied, so a tenant could have sent ₹1 and the server would have recorded
 * it as the month's rent settled. The amount is now taken from the tenancy. This is the slice-4
 * lesson restated: derive the sensitive value, do not validate what the client sent.
 *
 * @param tenancyId      which tenancy to pay; must be one the caller is the tenant of
 * @param expectedAmount what the client believes the rent is — a purely optimistic check. If it
 *                       disagrees with the tenancy's rent the server answers 409 rather than
 *                       charging, so a tenant looking at a stale screen after a rent revision is
 *                       told the figure moved instead of silently authorising the new one.
 * @param method         see {@link PaymentMethods}; {@code cash} cannot be initiated
 */
public record RentPaymentCreateRequest(
        @NotBlank String tenancyId,
        @PositiveOrZero Long expectedAmount,
        String method) {
}
