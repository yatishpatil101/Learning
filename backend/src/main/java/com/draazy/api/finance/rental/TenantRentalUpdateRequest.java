package com.draazy.api.finance.rental;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * The body of {@code PATCH /me/rentals/{rentalId}} (contract {@code TenantRentalUpdate}).
 *
 * <p><strong>Every field is optional and absent means "leave it alone"</strong> — the same shape
 * and the same reasoning as {@link com.draazy.api.finance.ledger.TransactionUpdateRequest}. The
 * ordinary edit here is a single field: the rent goes up at renewal, or a lease that was open gets
 * an end date when the tenant gives notice.
 *
 * <p>The known cost is that {@code null} and "absent" are indistinguishable to a Jackson-bound
 * record, so nothing on this body can express "clear this value". Three fields are nullable in the
 * table — {@code landlordName}, {@code deposit} and {@code leaseEnd} — and the free-text one is
 * cleared by sending an empty string, which the service normalises. The two numeric ones cannot be
 * un-set once given, which is accepted: a tenant who wrongly recorded a deposit can correct the
 * figure, and "I no longer know what I paid" is not an edit anyone makes.
 *
 * @param address      where they live, or null to leave unchanged
 * @param landlordName the landlord's name, or empty string to clear
 * @param monthlyRent  whole INR, or null to leave unchanged
 * @param deposit      whole INR, or null to leave unchanged
 * @param leaseStart   when the lease began, or null to leave unchanged
 * @param leaseEnd     when it ends, or null to leave unchanged
 * @param status       one of {@link RentalStatuses}, or null to leave unchanged
 */
public record TenantRentalUpdateRequest(
        @Size(max = 300) String address,
        @Size(max = 120) String landlordName,
        @Positive @Max(10_000_000) Long monthlyRent,
        @PositiveOrZero @Max(100_000_000) Long deposit,
        LocalDate leaseStart,
        LocalDate leaseEnd,
        String status) {

    /**
     * Only checkable when the request carries both dates. A patch that moves one of them past the
     * other is caught in the service, which has the stored row to compare against; this covers the
     * common case early and gives the same {@code fields[]} entry the create path does.
     */
    @AssertTrue(message = "leaseEnd cannot be before leaseStart")
    public boolean isDateRangeOrdered() {
        return leaseStart == null || leaseEnd == null || !leaseEnd.isBefore(leaseStart);
    }

    /** Same bound as the create path, for the same reason — see {@code TenantRentalCreateRequest}. */
    @AssertTrue(message = "leaseStart must be a real date, and no more than two years ahead")
    public boolean isLeaseStartInRange() {
        return leaseStart == null || RentalDates.isSane(leaseStart);
    }

    /** The same bound on the far end; see the create request for why the ordering rule is not enough. */
    @AssertTrue(message = "leaseEnd must be a real date, and no more than two years ahead")
    public boolean isLeaseEndInRange() {
        return leaseEnd == null || RentalDates.isSane(leaseEnd);
    }
}
