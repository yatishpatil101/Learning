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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Either participant may reschedule, so participation is checked in {@link VisitService#reschedule},
 * not by a route-level role guard. */
@RestController
public class VisitController {

    private final VisitService visitService;

    public VisitController(VisitService visitService) {
        this.visitService = visitService;
    }

    /** Sort is fixed server-side; {@code Pageables.unsorted} strips a client-supplied one. */
    @GetMapping(Routes.Visits.BASE)
    public PageResponse<VisitDto> listVisits(@CurrentUser AuthPrincipal principal,
                                             @RequestParam(required = false) UUID propertyId,
                                             @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(visitService.myVisits(
                principal.userId(), propertyId, Pageables.unsorted(pageable)), v -> v);
    }

    @PostMapping(Routes.Visits.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public VisitDto scheduleVisit(@CurrentUser AuthPrincipal principal,
                                   @Valid @RequestBody VisitCreateRequest body) {
        return visitService.schedule(principal.userId(), body);
    }

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
