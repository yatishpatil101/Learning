package com.draazy.api.billing.referral;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.servlet.http.HttpServletRequest;
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
    public ReferralSummaryDto mine(@CurrentUser AuthPrincipal principal,
            HttpServletRequest request) {
        return service.summary(principal, request);
    }

    /** {@code POST /referrals/redeem} (contract {@code redeemReferral}) — 200, or 409. */
    @PostMapping(Routes.Referrals.REDEEM)
    public void redeem(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody RedeemRequest body, HttpServletRequest request) {
        service.redeem(principal, body.code(), body.shareChannel(), request);
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

    /**
     * Body of {@code redeemReferral} (inline schema, {@code code} required).
     *
     * <p>{@code shareChannel} is optional and unvalidated here on purpose (D60): it says how the
     * link reached this person, and an older client that does not send it, or sends a value this
     * build has no name for, must still be able to redeem. {@link ShareChannels#normalise} drops
     * what it does not recognise rather than turning an advisory analytics field into a way to fail
     * a real referral.
     */
    public record RedeemRequest(@NotBlank String code, String shareChannel) {
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
