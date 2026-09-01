package com.punenest.api.finance.rental;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Wire shape of a self-declared rental (contract {@code TenantRental}).
 *
 * <p><strong>The three totals are computed, not stored.</strong> {@code monthsPaid},
 * {@code totalPaid} and {@code fyPaid} follow from the lease dates and the monthly figure, so
 * storing them would create a second copy that goes stale the day the financial year turns over.
 * They are sent rather than left to the client for the reason {@link RentalTotals} gives: the
 * April-to-March boundary is easy to implement twice and easy to get wrong the second time.
 *
 * <p><strong>Named {@code Paid}, and that is a claim this DTO cannot make good on.</strong> These
 * are instalments the lease implies, not transfers anyone observed — no rent moves through the
 * platform. The UI labels them as self-declared, and nothing that scores a tenant may read them.
 *
 * <p>{@code NON_NULL}: {@code landlordName}, {@code deposit} and {@code leaseEnd} are genuinely
 * optional, and omitting the key says "not given" where {@code null} would read as "given as
 * nothing" — the distinction the deposit panel renders differently.
 *
 * @param id          opaque row id
 * @param address     the home, as the tenant describes it
 * @param landlordName the landlord's name, or omitted
 * @param monthlyRent whole INR
 * @param deposit     whole INR, or omitted when unknown
 * @param leaseStart  when the lease began
 * @param leaseEnd    when it ends, or omitted while open
 * @param status      one of {@link RentalStatuses}
 * @param monthsPaid  instalments due to date
 * @param totalPaid   {@code monthsPaid × monthlyRent}
 * @param fyPaid      the same, restricted to the current Indian financial year
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record TenantRentalDto(
        UUID id,
        String address,
        String landlordName,
        Long monthlyRent,
        Long deposit,
        LocalDate leaseStart,
        LocalDate leaseEnd,
        String status,
        long monthsPaid,
        long totalPaid,
        long fyPaid) {
}
