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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class VisitRequestController {

    private final VisitService visitService;

    public VisitRequestController(VisitService visitService) {
        this.visitService = visitService;
    }

    @GetMapping(Routes.Visits.ME_REQUESTS)
    public PageResponse<VisitDto> myVisitRequests(@CurrentUser AuthPrincipal principal,
                                                  @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                visitService.visitRequestsOnMine(principal.userId(), Pageables.unsorted(pageable)),
                v -> v);
    }

    // `PATCH /visit-requests/{id`/status} (contract `updateVisitStatus`) — confirm, cancel, complete, or no-show a visit.
    @PatchMapping(Routes.Visits.STATUS)
    public void updateVisitStatus(@CurrentUser AuthPrincipal principal,
                                   @PathVariable("id") String id,
                                   @Valid @RequestBody VisitStatusUpdateRequest body) {
        visitService.updateStatus(principal, parseUuid(id), body);
    }

    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Visit"));
    }
    }
