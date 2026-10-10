package com.draazy.api.deals.deal;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

// No `@PreAuthorize` role guard — the spec carries no `x-roles` on these operations.
// Authentication plus strict owner-scoping is the gate.
@RestController
public class MeDealsController {

    private final DealService dealService;

    public MeDealsController(DealService dealService) {
        this.dealService = dealService;
    }

    @GetMapping(Routes.Deals.BY_PROP)
    public DealDto getDeal(@CurrentUser AuthPrincipal principal,
                           @PathVariable("propId") String propId) {
        return dealService.getDeal(principal.userId(), parseUuid(propId));
    }

    @PostMapping(Routes.Deals.RESERVE)
    public void reserve(@CurrentUser AuthPrincipal principal,
                        @PathVariable("propId") String propId) {
        dealService.reserve(principal.userId(), parseUuid(propId));
    }

    @PostMapping(Routes.Deals.CLOSE)
    public void close(@CurrentUser AuthPrincipal principal,
                      @PathVariable("propId") String propId,
                      @Valid @RequestBody DealCloseRequest body) {
        dealService.close(principal.userId(), parseUuid(propId), body);
    }

    @PostMapping(Routes.Deals.REOPEN)
    public void reopen(@CurrentUser AuthPrincipal principal,
                       @PathVariable("propId") String propId) {
        dealService.reopen(principal, parseUuid(propId));
    }

    @GetMapping(Routes.Deals.PARTIES)
    public List<DealPartyDto> listParties(@CurrentUser AuthPrincipal principal,
                                           @PathVariable("propId") String propId) {
        return dealService.listParties(principal.userId(), parseUuid(propId));
    }

    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Property"));
    }
}
