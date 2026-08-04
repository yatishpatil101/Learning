package com.punenest.api.billing.referral;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Referral scheme endpoints (contract tag {@code Billing &amp; Growth}).
 *
 * <p>Two audiences on one resource. {@code GET /me/referrals} and {@code POST /referrals/redeem} are
 * any authenticated user's; the queue and the three decisions are the fraud desk's and carry
 * {@code @PreAuthorize} matching the {@code x-roles} the contract gained in spec fix S53.
 */
@RestController
public class ReferralsController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private final ReferralService service;

    public ReferralsController(ReferralService service) {
        this.service = service;
    }

    /** {@code GET /me/referrals} (contract {@code getReferrals}). */
    @GetMapping(Routes.Referrals.MINE)
    public ReferralSummaryDto mine(@CurrentUser AuthPrincipal principal) {
        return service.summary(principal);
    }

    /** {@code POST /referrals/redeem} (contract {@code redeemReferral}) — 200, or 409. */
    @PostMapping(Routes.Referrals.REDEEM)
    public void redeem(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody RedeemRequest body) {
        service.redeem(principal, body.code());
    }

    /** {@code GET /referrals} (contract {@code listReferrals}) — the paged fraud-desk queue. */
    @GetMapping(Routes.Referrals.BASE)
    @PreAuthorize(STAFF_OR_ADMIN)
    public PageResponse<ReferralDto> queue(@RequestParam(required = false) String status,
            @RequestParam(required = false) String risk,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.queue(status, risk, Pageables.unsorted(pageable)), dto -> dto);
    }

    /** {@code POST /referrals/{id}/approve} (contract {@code approveReferral}). */
    @PostMapping(Routes.Referrals.APPROVE)
    @PreAuthorize(STAFF_OR_ADMIN)
    public ReferralDto approve(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.approve(principal, id);
    }

    /** {@code POST /referrals/{id}/reject} (contract {@code rejectReferral}). */
    @PostMapping(Routes.Referrals.REJECT)
    @PreAuthorize(STAFF_OR_ADMIN)
    public ReferralDto reject(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestBody(required = false) ReasonRequest body) {
        return service.reject(principal, id, body == null ? null : body.reason());
    }

    /** {@code POST /referrals/{id}/clawback} (contract {@code clawbackReferral}). */
    @PostMapping(Routes.Referrals.CLAWBACK)
    @PreAuthorize(STAFF_OR_ADMIN)
    public ReferralDto clawback(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestBody(required = false) ReasonRequest body) {
        return service.clawback(principal, id, body == null ? null : body.reason());
    }

    /** Body of {@code redeemReferral} (inline schema, {@code code} required). */
    public record RedeemRequest(@NotBlank String code) {
    }

    /**
     * Body of {@code rejectReferral} and {@code clawbackReferral} (schema {@code ReasonRequest}).
     *
     * <p>The request body is declared without {@code required: true}, so the reason is best-effort
     * context on the audit trail, not a gate.
     */
    public record ReasonRequest(String reason) {
    }
}
