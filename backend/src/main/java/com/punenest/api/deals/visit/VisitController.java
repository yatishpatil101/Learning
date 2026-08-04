package com.punenest.api.deals.visit;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The visitor-facing visit endpoints: schedule and list-my-visits at {@code /visits}.
 *
 * <p>Both routes are authenticated by the default-deny posture in {@code SecurityConfig}.
 * No {@code @PreAuthorize} role guard — the spec carries no {@code x-roles} on these operations.
 *
 * <p><strong>D3:</strong> {@code POST /visits} and {@code POST /visit-requests} both delegate to
 * {@link VisitService#schedule} — one service method creating the same stored shape. This
 * controller serves the visitor surface; {@link VisitRequestController} serves the owner surface.
 */
@RestController
public class VisitController {

    private final VisitService visitService;

    public VisitController(VisitService visitService) {
        this.visitService = visitService;
    }

    /**
     * {@code GET /visits} (contract {@code listVisits}) — visits the caller booked, newest first.
     *
     * <p>Strictly caller-scoped (spec fix S3): returns only visits where the caller is the visitor.
     */
    @GetMapping(Routes.Visits.BASE)
    public List<VisitDto> listVisits(@CurrentUser AuthPrincipal principal) {
        return visitService.myVisits(principal.userId());
    }

    /**
     * {@code POST /visits} (contract {@code scheduleVisit}) — schedule a visit on a listing.
     *
     * @throws com.punenest.api.common.error.NotFoundException when the property does not exist
     * @throws com.punenest.api.common.error.ConflictException  when a live visit already exists
     */
    @PostMapping(Routes.Visits.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public VisitDto scheduleVisit(@CurrentUser AuthPrincipal principal,
                                   @Valid @RequestBody VisitCreateRequest body) {
        return visitService.schedule(principal.userId(), body);
    }
}
