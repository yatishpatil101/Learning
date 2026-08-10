package com.punenest.api.deals.finalization;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The finalization endpoints: the maker/checker flow where a buyer proposes to finalize a listing's
 * deal and the owner accepts or declines.
 *
 * <p>All routes are authenticated by the default-deny posture in {@code SecurityConfig}.
 * No {@code @PreAuthorize} role guard — the spec carries no {@code x-roles} on these operations.
 * Authentication plus strict initiator/counterparty scoping is the gate.
 */
@RestController
public class FinalizationController {

    private final FinalizationService finalizationService;

    public FinalizationController(FinalizationService finalizationService) {
        this.finalizationService = finalizationService;
    }

    /**
     * {@code POST /finalization/{propId}/request} (contract {@code requestFinalization}) —
     * buyer requests finalization for a listing.
     */
    @PostMapping(Routes.Finalization.REQUEST)
    public FinalizationRequestDto requestFinalization(
            @CurrentUser AuthPrincipal principal,
            @PathVariable("propId") String propId,
            @Valid @RequestBody FinalizationCreateRequest body) {
        return finalizationService.request(principal.userId(), parseUuid(propId), body);
    }

    /**
     * {@code GET /finalization/{propId}/status} (contract {@code finalizationStatus}) —
     * the caller-relevant live request for this property.
     */
    @GetMapping(Routes.Finalization.STATUS)
    public FinalizationRequestDto finalizationStatus(
            @CurrentUser AuthPrincipal principal,
            @PathVariable("propId") String propId) {
        return finalizationService.status(principal.userId(), parseUuid(propId));
    }

    /**
     * {@code DELETE /finalization/{propId}/status} (contract {@code cancelFinalization}) —
     * the initiator soft-cancels their own request. Returns 204.
     */
    @DeleteMapping(Routes.Finalization.STATUS)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void cancelFinalization(
            @CurrentUser AuthPrincipal principal,
            @PathVariable("propId") String propId) {
        finalizationService.cancel(principal.userId(), parseUuid(propId));
    }

    /**
     * {@code GET /me/finalization-requests} (contract {@code myFinalizationRequests}) —
     * requests awaiting the caller's decision (counterparty-scoped), newest first, paged.
     *
     * <p><strong>Paged as of D77.</strong> Every row is a proposal a buyer aimed at the caller, so
     * the collection grows with inbound demand. Sort is fixed server-side.
     */
    @GetMapping(Routes.Finalization.ME_REQUESTS)
    public PageResponse<FinalizationRequestDto> myFinalizationRequests(
            @CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                finalizationService.myRequests(principal.userId(), Pageables.unsorted(pageable)),
                r -> r);
    }

    /**
     * {@code POST /finalization/requests/{reqId}/accept} (contract {@code acceptFinalization}) —
     * the counterparty accepts; auto-declines siblings and closes the deal.
     */
    @PostMapping(Routes.Finalization.ACCEPT)
    public void acceptFinalization(
            @CurrentUser AuthPrincipal principal,
            @PathVariable("reqId") String reqId) {
        finalizationService.accept(principal.userId(), parseUuid(reqId));
    }

    /**
     * {@code POST /finalization/requests/{reqId}/decline} (contract {@code declineFinalization}) —
     * the counterparty declines.
     */
    @PostMapping(Routes.Finalization.DECLINE)
    public void declineFinalization(
            @CurrentUser AuthPrincipal principal,
            @PathVariable("reqId") String reqId) {
        finalizationService.decline(principal.userId(), parseUuid(reqId));
    }

    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token)
                .orElseThrow(() -> NotFoundException.of("Finalization request"));
    }
}
