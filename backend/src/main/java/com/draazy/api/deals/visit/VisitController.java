package com.draazy.api.deals.visit;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
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
 * The visitor-facing visit endpoints: schedule, list-my-visits, and reschedule at {@code /visits}.
 *
 * <p>All routes are authenticated by the default-deny posture in {@code SecurityConfig}.
 * No {@code @PreAuthorize} role guard — the spec carries no {@code x-roles} on these operations.
 *
 * <p><strong>D3:</strong> {@code POST /visits} and {@code POST /visit-requests} both delegate to
 * {@link VisitService#schedule} — one service method creating the same stored shape. This
 * controller serves the visitor surface; {@link VisitRequestController} serves the owner surface.
 * Reschedule ({@code PATCH /visits/{id}/slot}, D87) lives here because it is keyed off the
 * visitor-facing {@code /visits} base, but either participant may call it — the scoping check is
 * in {@link VisitService#reschedule}, not the route.
 */
@RestController
public class VisitController {

    private final VisitService visitService;

    public VisitController(VisitService visitService) {
        this.visitService = visitService;
    }

    /**
     * {@code GET /visits} (contract {@code listVisits}) — visits the caller booked, newest first,
     * paged.
     *
     * <p>Strictly caller-scoped (spec fix S3): returns only visits where the caller is the visitor.
     *
     * <p><strong>Paged as of D77</strong>, in step with the owner surface at
     * {@code /me/visit-requests} — the same table read from the other end of a visit. Sort is fixed
     * server-side; {@code Pageables.unsorted} strips a client-supplied one.
     */
    @GetMapping(Routes.Visits.BASE)
    public PageResponse<VisitDto> listVisits(@CurrentUser AuthPrincipal principal,
                                             @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                visitService.myVisits(principal.userId(), Pageables.unsorted(pageable)), v -> v);
    }

    /**
     * {@code POST /visits} (contract {@code scheduleVisit}) — schedule a visit on a listing.
     *
     * @throws com.draazy.api.common.error.NotFoundException when the property does not exist
     * @throws com.draazy.api.common.error.ConflictException  when a live visit already exists
     */
    @PostMapping(Routes.Visits.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public VisitDto scheduleVisit(@CurrentUser AuthPrincipal principal,
                                   @Valid @RequestBody VisitCreateRequest body) {
        return visitService.schedule(principal.userId(), body);
    }

    /**
     * {@code PATCH /visits/{id}/slot} (contract {@code rescheduleVisit}) — move a live visit to a
     * new slot, returning it to {@code scheduled} so the other party re-confirms (D87).
     *
     * <p>Either participant (visitor or owner) may reschedule; the service enforces participation
     * (404 for a stranger) and rejects a terminal visit (409). A malformed id is a 404, matching
     * the status route.
     *
     * @throws NotFoundException when the visit is unknown, the id is malformed, or the caller is
     *                           not a participant
     * @throws com.draazy.api.common.error.ConflictException when the visit is in a terminal state
     */
    @PatchMapping(Routes.Visits.SLOT)
    public void rescheduleVisit(@CurrentUser AuthPrincipal principal,
                                 @PathVariable("id") String id,
                                 @Valid @RequestBody VisitSlotUpdateRequest body) {
        visitService.reschedule(principal.userId(), parseUuid(id), body);
    }

    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Visit"));
    }
}
