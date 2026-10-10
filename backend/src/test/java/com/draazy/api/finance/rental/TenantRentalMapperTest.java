package com.draazy.api.finance.rental;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("the rental row reaches the wire with every stored and derived field")
class TenantRentalMapperTest {

    @Test
    @DisplayName("stored fields pass through and the lifetime and financial-year totals are derived")
    void everyFieldIsMapped() {
        TenantRental row = new TenantRental(UUID.randomUUID());
        row.setAddress("Flat 7, Baner");
        row.setMonthlyRent(20_000L);
        row.setDeposit(100_000L);
        row.setLeaseStart(LocalDate.of(2025, 1, 10));
        row.setLeaseEnd(LocalDate.of(2026, 1, 9));

        TenantRentalDto dto = TenantRentalMapper.toDto(row, LocalDate.of(2025, 6, 10));

        assertThat(dto.id()).isEqualTo(row.getId());
        assertThat(dto.address()).isEqualTo("Flat 7, Baner");
        assertThat(dto.monthlyRent()).isEqualTo(20_000L);
        assertThat(dto.deposit()).isEqualTo(100_000L);
        assertThat(dto.leaseStart()).isEqualTo(LocalDate.of(2025, 1, 10));
        assertThat(dto.leaseEnd()).isEqualTo(LocalDate.of(2026, 1, 9));
        assertThat(dto.status()).isEqualTo(RentalStatuses.ACTIVE);
        assertThat(dto.monthsPaid()).isEqualTo(6);
        assertThat(dto.totalPaid()).isEqualTo(120_000L);
        assertThat(dto.fyPaid()).isEqualTo(60_000L);
    }
}
