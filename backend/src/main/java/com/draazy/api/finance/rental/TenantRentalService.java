package com.draazy.api.finance.rental;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Why this is a separate service and not two more methods on `FinanceService`.
@Service
public class TenantRentalService {

    /** Live rentals one tenant may hold. Abuse ceiling, not a product rule — see {@code addRental}. */
    static final int MAX_RENTALS_PER_TENANT = 50;

    private final TenantRentalRepository rentals;

    public TenantRentalService(TenantRentalRepository rentals) {
        this.rentals = rentals;
    }

    // Resolve today once so a midnight read cannot mix financial years in one payload.
    @Transactional(readOnly = true)
    public List<TenantRentalDto> myRentals(UUID callerId) {
        LocalDate today = LocalDate.now(PlatformTime.IST);
        return rentals.findLiveByTenantId(callerId).stream()
                .map(row -> TenantRentalMapper.toDto(row, today))
                .toList();
    }

    @Transactional
    public TenantRentalDto addRental(UUID callerId, TenantRentalCreateRequest body) {
        if (rentals.countLiveByTenantId(callerId) >= MAX_RENTALS_PER_TENANT) {
            throw new ValidationException("You can record up to " + MAX_RENTALS_PER_TENANT
                    + " rentals. Remove one you no longer need before adding another.");
        }
        TenantRental row = new TenantRental(callerId);
        row.setAddress(body.address().trim());
        row.setMonthlyRent(body.monthlyRent());
        row.setDeposit(body.deposit());
        row.setLeaseStart(body.leaseStart());
        row.setLeaseEnd(body.leaseEnd());
        row.setStatus(RentalStatuses.ACTIVE);
        return TenantRentalMapper.toDto(rentals.save(row), LocalDate.now(PlatformTime.IST));
    }

    @Transactional
    public TenantRentalDto updateRental(UUID callerId, UUID rentalId,
                                        TenantRentalUpdateRequest body) {
        TenantRental row = rentals.findLiveByIdAndTenantId(rentalId, callerId)
                .orElseThrow(() -> NotFoundException.of("Rental"));

        if (body.address() != null) {
            row.setAddress(requireNonBlank(body.address(), "address"));
        }
        if (body.monthlyRent() != null) {
            row.setMonthlyRent(body.monthlyRent());
        }
        if (body.deposit() != null) {
            row.setDeposit(body.deposit());
        }
        if (body.leaseStart() != null) {
            row.setLeaseStart(body.leaseStart());
        }
        if (body.leaseEnd() != null) {
            row.setLeaseEnd(body.leaseEnd());
        }
        if (body.status() != null) {
            row.setStatus(requireValidStatus(body.status()));
        }

        if (row.getLeaseEnd() != null && row.getLeaseEnd().isBefore(row.getLeaseStart())) {
            throw new BadRequestException("leaseEnd cannot be before leaseStart");
        }

        // `addRental` cannot produce this state because it forces ACTIVE, which makes this PATCH the only way in.
        if (RentalStatuses.ENDED.equals(row.getStatus()) && row.getLeaseEnd() == null) {
            throw new BadRequestException("leaseEnd is required when status is ended");
        }
        return TenantRentalMapper.toDto(rentals.save(row), LocalDate.now(PlatformTime.IST));
    }

    @Transactional
    public void deleteRental(UUID callerId, UUID rentalId) {
        TenantRental row = rentals.findLiveByIdAndTenantId(rentalId, callerId)
                .orElseThrow(() -> NotFoundException.of("Rental"));
        row.archive("Deleted by tenant");
        rentals.save(row);
    }

    private static String requireValidStatus(String status) {
        if (!RentalStatuses.isValid(status)) {
            throw new BadRequestException(
                    "status must be one of: " + RentalStatuses.ACTIVE + ", "
                            + RentalStatuses.ENDED);
        }
        return status;
    }

    private static String requireNonBlank(String value, String field) {
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            throw new BadRequestException(field + " must not be blank");
        }
        return trimmed;
    }
}
