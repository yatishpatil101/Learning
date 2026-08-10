package com.punenest.api.deals.visit;

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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The owner-facing visit endpoints: request-visit, list-visit-requests, update-status.
 *
 * <p>All routes are authenticated by the default-deny posture in {@code SecurityConfig}.
 * No {@code @PreAuthorize} role guard — the spec carries no {@code x-roles} on these operations.
 *
 * <p><strong>D3:</strong> {@code POST /visit-requests} delegates to the same
 * {@link VisitService#schedule} as {@code POST /visits}. One create path, two surfaces.
 */
@RestController
public class VisitRequestController {

    private final VisitService visitService;

    public VisitRequestController(VisitService visitService) {
        this.visitService = visitService;
    }

    /**
     * {@code GET /me/visit-requests} (contract {@code myVisitRequests}) — visit requests on the
     * caller's own listings, newest first, paged. Strictly owner-scoped.
     *
     * <p><strong>Paged as of D77.</strong> A booking here is made by a <em>visitor</em>, so the
     * collection grows with demand for the listing rather than with anything its owner did.
     */
    @GetMapping(Routes.Visits.ME_REQUESTS)
    public PageResponse<VisitDto> myVisitRequests(@CurrentUser AuthPrincipal principal,
                                                  @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                visitService.visitRequestsOnMine(principal.userId(), Pageables.unsorted(pageable)),
                v -> v);
    }

    /**
     * {@code POST /visit-requests} (contract {@code requestVisit}) — request a visit on a listing.
     * Delegates to the same service method as {@code POST /visits} (D3).
     *
     * @throws com.punenest.api.common.error.NotFoundException when the property does not exist
     * @throws com.punenest.api.common.error.ConflictException  when a live visit already exists
     */
    @PostMapping(Routes.Visits.REQUEST_BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public VisitDto requestVisit(@CurrentUser AuthPrincipal principal,
                                  @Valid @RequestBody VisitCreateRequest body) {
        return visitService.schedule(principal.userId(), body);
    }

    /**
     * {@code PATCH /visit-requests/{id}/status} (contract {@code updateVisitStatus}) — confirm,
     * cancel, complete, or no-show a visit.
     *
     * @throws com.punenest.api.common.error.NotFoundException when the visit is unknown or
     *                                                          the caller is not a participant
     * @throws com.punenest.api.common.error.ForbiddenException when the caller is a participant
     *                                                           but not authorised for this transition
     * @throws com.punenest.api.common.error.ConflictException  on an illegal state transition
     */
    @PatchMapping(Routes.Visits.STATUS)
    public void updateVisitStatus(@CurrentUser AuthPrincipal principal,
                                   @PathVariable("id") String id,
                                   @Valid @RequestBody VisitStatusUpdateRequest body) {
        visitService.updateStatus(principal.userId(), parseUuid(id), body);
    }

    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Visit"));
    }
}
