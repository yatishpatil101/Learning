package com.draazy.api.finance.rental;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record TenantRentalDto(
        UUID id,
        String address,
        Long monthlyRent,
        Long deposit,
        LocalDate leaseStart,
        LocalDate leaseEnd,
        String status,
        long monthsPaid,
        long totalPaid,
        long fyPaid) {
}
