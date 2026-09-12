package com.draazy.api.documents.agreement;

import com.draazy.api.common.validation.IndianMobile;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import java.time.LocalDate;

/**
 * Contract schema {@code RentAgreementCreate} (spec fix S38).
 *
 * <p>Deliberately not the full {@code RentAgreement}: {@code id}, {@code status} and
 * {@code documentUrl} are server-owned, and accepting them would let a client post an agreement
 * that claims to be {@code registered} with a {@code documentUrl} pointing anywhere it liked.
 *
 * <p>{@code tenantMobile} carries the contract's {@code Mobile} pattern, which is also the V6 CHECK
 * — so the same string is rejected at the edge and at the table, rather than the edge being the
 * only guard.
 */
public record RentAgreementCreate(
        @NotBlank String propertyId,
        @IndianMobile
        String tenantMobile,
        @PositiveOrZero Long rent,
        @PositiveOrZero Long deposit,
        LocalDate startDate,
        @Min(1) @Max(60) Integer durationMonths) {
}
