package com.punenest.api.finance.rent;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The rent money rail — paying rent, both sides of the ledger, autopay and payouts.
 *
 * <p>No {@code @PreAuthorize}: none of these operations carries {@code x-roles} in the contract, and
 * a role guard would be the wrong instrument anyway. Whether the caller is "the owner" or "the
 * tenant" is a fact about the tenancy, not a claim in their token, so the guard is participant
 * scoping inside {@link RentService} — and a non-participant gets 404, never 403.
 */
@RestController
public class RentController {

    private final RentService rentService;

    public RentController(RentService rentService) {
        this.rentService = rentService;
    }

    /** {@code GET /me/rent-payments} (contract {@code myRentPayments}) — the tenant's side. */
    @GetMapping(Routes.Rent.PAYMENTS)
    public PageResponse<RentPaymentDto> myRentPayments(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                rentService.myRentPayments(principal.userId(), Pageables.unsorted(pageable)),
                dto -> dto);
    }

    /**
     * {@code POST /me/rent-payments} (contract {@code payRent}) — 201.
     *
     * <p>The returned payment is <strong>pending</strong>, whatever its {@code status} reads: only
     * the provider callback can settle it. See {@link RentPaymentStatuses}.
     *
     * @param idempotencyKey the contract's {@code Idempotency-Key}; a repeat returns the original
     *                       payment rather than charging twice
     */
    @PostMapping(Routes.Rent.PAYMENTS)
    @ResponseStatus(HttpStatus.CREATED)
    public RentPaymentDto payRent(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody RentPaymentCreateRequest body,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return rentService.payRent(principal.userId(), body, idempotencyKey);
    }

    /**
     * {@code GET /me/rent-ledger} (contract {@code rentLedger}) — the owner's side.
     *
     * <p>Sort stripped via {@link Pageables#unsorted(Pageable)}, as on {@code /me/rent-payments}:
     * neither rent operation declares a {@code sort} parameter and both queries fix their own
     * order (newest due-date first).
     */
    @GetMapping(Routes.Rent.LEDGER)
    public PageResponse<RentPaymentDto> rentLedger(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                rentService.rentLedger(principal.userId(), Pageables.unsorted(pageable)),
                dto -> dto);
    }

    /** {@code GET /me/rent-mandate} (contract {@code getMandate}). Empty shape when unset. */
    @GetMapping(Routes.Rent.MANDATE)
    public RentMandateDto getMandate(@CurrentUser AuthPrincipal principal) {
        return rentService.getMandate(principal.userId());
    }

    /** {@code PUT /me/rent-mandate} (contract {@code setMandate}, spec fix S22). */
    @PutMapping(Routes.Rent.MANDATE)
    public RentMandateDto setMandate(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody RentMandateUpdateRequest body) {
        return rentService.setMandate(principal.userId(), body);
    }

    /** {@code GET /me/payout-account} (contract {@code getPayoutAccount}). Empty shape when unset. */
    @GetMapping(Routes.Rent.PAYOUT_ACCOUNT)
    public PayoutAccountDto getPayoutAccount(@CurrentUser AuthPrincipal principal) {
        return rentService.getPayoutAccount(principal.userId());
    }

    /** {@code PUT /me/payout-account} (contract {@code setPayoutAccount}, spec fix S11) — replaces. */
    @PutMapping(Routes.Rent.PAYOUT_ACCOUNT)
    public PayoutAccountDto setPayoutAccount(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody PayoutAccountUpdateRequest body) {
        return rentService.setPayoutAccount(principal.userId(), body);
    }
}
