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

/**
 * The tenant's own record of the homes they rent — the counterpart to
 * {@link com.draazy.api.finance.ledger.FinanceService}, which keeps the owner's.
 *
 * <p><strong>Caller-scoped, and that is the entire access-control story.</strong> Every method
 * takes {@code callerId} and every query carries it, so "belongs to someone else" and "does not
 * exist" are the same lookup and therefore the same 404. There is no owner-side, admin-side or
 * mobile-keyed read of this table anywhere, by design: an owner who wants to know what their tenant
 * believes the rent to be has to ask them.
 *
 * <p><strong>Why this is a separate service and not two more methods on {@code FinanceService}.</strong>
 * That one resolves every request through a property the caller owns and answers 404 rather than 403
 * because the existence of a ledger is itself a fact about someone else's assets. A tenant holds no
 * property id. Admitting a second kind of caller to the most carefully scoped endpoint family on
 * the platform, to serve a table that shares none of its columns, would put that guarantee at risk
 * for no structural gain.
 *
 * <p><strong>Nothing validates the contents, and nothing should.</strong> The rent, the address and
 * the landlord's name are the tenant's account of their own affairs; the server's job is to store
 * them faithfully. The bounds that exist — positive rent, ordered dates, length caps — are there so
 * a typo cannot produce an absurd dashboard or an unbounded column, not to adjudicate the lease.
 *
 * <p><strong>These rows must never reach a trust score.</strong> The Rent Passport is a document a
 * tenant hands to a prospective landlord under the words "verified rent-payment record"; scoring it
 * from figures the tenant typed in themselves would fabricate exactly the trust it exists to prove.
 * The structural guarantee is that nothing outside this package can read a rental for another user;
 * the remaining discipline is that no scoring code may import it at all.
 */
@Service
public class TenantRentalService {

    /** Live rentals one tenant may hold. Abuse ceiling, not a product rule — see {@code addRental}. */
    static final int MAX_RENTALS_PER_TENANT = 50;

    private final TenantRentalRepository rentals;

    public TenantRentalService(TenantRentalRepository rentals) {
        this.rentals = rentals;
    }

    /**
     * Contract {@code myRentals} — the caller's rentals, most recent lease first.
     *
     * <p>{@code today} is resolved once and passed to every row so that a list read at midnight on
     * 31 March cannot report two different financial years inside one payload.
     */
    @Transactional(readOnly = true)
    public List<TenantRentalDto> myRentals(UUID callerId) {
        LocalDate today = LocalDate.now(PlatformTime.IST);
        return rentals.findLiveByTenantId(callerId).stream()
                .map(row -> TenantRentalMapper.toDto(row, today))
                .toList();
    }

    /**
     * Contract {@code addRental} — records one. Returns 201.
     *
     * <p>The per-tenant ceiling is not a product rule, it is the only thing standing between this
     * endpoint and unbounded growth. {@code myRentals} returns a bare array with no paging, and the
     * DSAR export truncates a dataset past its row limit and marks it {@code truncated} — so a
     * script left running here would first make the tenant's own wallet unusable and then start
     * degrading the evidence their subject-access request is supposed to produce. Nobody rents
     * {@value #MAX_RENTALS_PER_TENANT} homes, so the honest caller never meets this.
     */
    @Transactional
    public TenantRentalDto addRental(UUID callerId, TenantRentalCreateRequest body) {
        if (rentals.countLiveByTenantId(callerId) >= MAX_RENTALS_PER_TENANT) {
            throw new ValidationException("You can record up to " + MAX_RENTALS_PER_TENANT
                    + " rentals. Remove one you no longer need before adding another.");
        }
        TenantRental row = new TenantRental(callerId);
        row.setAddress(body.address().trim());
        row.setLandlordName(blankToNull(body.landlordName()));
        row.setMonthlyRent(body.monthlyRent());
        row.setDeposit(body.deposit());
        row.setLeaseStart(body.leaseStart());
        row.setLeaseEnd(body.leaseEnd());
        row.setStatus(RentalStatuses.ACTIVE);
        return TenantRentalMapper.toDto(rentals.save(row), LocalDate.now(PlatformTime.IST));
    }

    /**
     * Contract {@code updateRental} — a genuine partial update; an absent field is left alone.
     *
     * @throws NotFoundException when the row does not exist, is archived, or belongs to another
     *                           tenant — indistinguishable on purpose
     */
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
        // Free text: present-but-empty means "clear it", the only erasure a PATCH bound to a record
        // can express (see TenantRentalUpdateRequest).
        if (body.landlordName() != null) {
            row.setLandlordName(blankToNull(body.landlordName()));
        }

        // Re-checked against the stored row, not just the body: a patch that carries only one of
        // the two dates passes the record's own assertion vacuously, and moving `leaseStart` past
        // an existing `leaseEnd` would otherwise reach V128's CHECK and surface as a bare integrity
        // violation rather than a 422 naming the field.
        if (row.getLeaseEnd() != null && row.getLeaseEnd().isBefore(row.getLeaseStart())) {
            throw new BadRequestException("leaseEnd cannot be before leaseStart");
        }

        // An ended lease has to say when it ended. `monthsDue` reads a null `leaseEnd` as "still
        // running" and clamps to today, so a row patched to `ended` on its own would go on adding
        // an instalment every month, for ever, for a home the tenant has left — inflating the HRA
        // figure they repeat to their employer. `addRental` cannot produce this state because it
        // forces ACTIVE, which makes this PATCH the only way in.
        if (RentalStatuses.ENDED.equals(row.getStatus()) && row.getLeaseEnd() == null) {
            throw new BadRequestException("leaseEnd is required when status is ended");
        }
        return TenantRentalMapper.toDto(rentals.save(row), LocalDate.now(PlatformTime.IST));
    }

    /**
     * Contract {@code deleteRental} — soft-deletes one. Returns 204.
     *
     * <p>Soft, and distinct from {@link RentalStatuses#ENDED}: ending a rental means the tenant
     * moved out and last year's rent still counts toward last year's HRA claim, whereas this means
     * the row should never have existed. Keeping the row lets the second be undone; a tenant who
     * deletes the wrong lease has otherwise lost a year of their own record.
     */
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

    private static String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
