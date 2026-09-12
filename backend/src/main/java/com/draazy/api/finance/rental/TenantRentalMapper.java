package com.draazy.api.finance.rental;

import java.time.LocalDate;

/**
 * {@link TenantRental} to {@link TenantRentalDto}.
 *
 * <p>The three totals are attached here rather than stored, and {@code asOf} is passed in rather
 * than read from the clock inside this class: every row in one response must be measured against
 * the same date, or a list read across midnight on 31 March would report two different financial
 * years within a single payload.
 */
final class TenantRentalMapper {

    private TenantRentalMapper() {
    }

    static TenantRentalDto toDto(TenantRental row, LocalDate asOf) {
        long months = RentalTotals.monthsDue(row.getLeaseStart(), row.getLeaseEnd(), asOf);
        long fyMonths =
                RentalTotals.monthsDueInFinancialYear(row.getLeaseStart(), row.getLeaseEnd(), asOf);
        return new TenantRentalDto(
                row.getId(),
                row.getAddress(),
                row.getLandlordName(),
                row.getMonthlyRent(),
                row.getDeposit(),
                row.getLeaseStart(),
                row.getLeaseEnd(),
                row.getStatus(),
                months,
                RentalTotals.total(months, row.getMonthlyRent()),
                RentalTotals.total(fyMonths, row.getMonthlyRent()));
    }
}
