package com.draazy.api.finance.rental;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * The body of {@code POST /me/rentals} (contract {@code TenantRentalCreate}).
 *
 * <p><strong>The bounds mirror V128's checks rather than replacing them.</strong> A constraint that
 * lives only here holds only for writers that pass through this record; the database constraint is
 * what makes it true of every row. Stating it twice buys a typed 422 naming the field instead of a
 * bare integrity violation surfacing as 409 "that conflicts with existing data", which tells
 * someone who mistyped a rent nothing about the rent.
 *
 * <p><strong>{@code leaseStart} is not {@code @PastOrPresent}.</strong> A tenant signing a lease
 * that begins next month is recording a real fact, and {@link RentalTotals} already declines to
 * accrue instalments before the start date — so a future start produces zeroes, which is correct,
 * rather than a 422 the form has no way to explain.
 *
 * @param address      where they live, as they describe it
 * @param landlordName the landlord's name, or null
 * @param monthlyRent  whole INR, positive
 * @param deposit      whole INR, or null when unknown — never coerced to zero
 * @param leaseStart   when the lease began
 * @param leaseEnd     when it ends, or null while open
 */
public record TenantRentalCreateRequest(
        @NotBlank @Size(max = 300) String address,
        @Size(max = 120) String landlordName,
        @NotNull @Positive @Max(10_000_000) Long monthlyRent,
        @PositiveOrZero @Max(100_000_000) Long deposit,
        @NotNull LocalDate leaseStart,
        LocalDate leaseEnd) {

    /**
     * The rule V128's {@code tenant_rentals_dates_ordered} holds, restated so a reversed pair
     * answers 422 with a {@code fields[]} entry — the same treatment
     * {@code TenancyDeclarationCreateRequest} gives the same mistake, for the same reason: it is a
     * typo, and a typo deserves to be named.
     */
    @AssertTrue(message = "leaseEnd cannot be before leaseStart")
    public boolean isDateRangeOrdered() {
        return leaseStart == null || leaseEnd == null || !leaseEnd.isBefore(leaseStart);
    }

    /**
     * The rule V128's {@code tenant_rentals_start_sane} holds, restated for the same reason as
     * the ordering above. Without it a mistyped year reaches the CHECK and comes back 409
     * "conflicts with existing data", which is both wrong and unactionable — there is no conflict,
     * the year is a typo. Bounded at the far end too, which the CHECK does not do: a lease cannot
     * start more than two years out, because a tenant recording a home they rent is describing one
     * they have or are about to have, not one in the next decade.
     */
    @AssertTrue(message = "leaseStart must be a real date, and no more than two years ahead")
    public boolean isLeaseStartInRange() {
        return leaseStart == null || RentalDates.isSane(leaseStart);
    }

    /**
     * The same bound on the far end. The ordering rule alone lets {@code 9999-12-31} through, which
     * the totals survive — {@code monthsDue} clamps to today — but the wallet then renders a lease
     * running for eight thousand years, and a typo that produces an absurd screen is exactly what
     * these bounds exist to catch.
     */
    @AssertTrue(message = "leaseEnd must be a real date, and no more than two years ahead")
    public boolean isLeaseEndInRange() {
        return leaseEnd == null || RentalDates.isSane(leaseEnd);
    }
}
