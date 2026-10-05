package com.draazy.api.finance.rental;

import java.time.LocalDate;

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
