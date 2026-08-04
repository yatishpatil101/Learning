package com.punenest.api.deals.offer;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The listing owner's view of incoming offers at {@code /me/offers}. Strictly owner-scoped: the
 * id set comes from the caller's own listings, so a caller can never see offers against someone
 * else's listing. Anyone else's row is invisible — 404, never 403.
 *
 * <p>No role guard, for the same reason as the other {@code /me/**} controllers: the spec carries
 * no {@code x-roles}; authentication plus owner-scoping is the gate.
 */
@RestController
public class MeOffersController {

    private final OfferService offerService;

    public MeOffersController(OfferService offerService) {
        this.offerService = offerService;
    }

    /**
     * {@code GET /me/offers} (contract {@code offersOnMine}) — offers on the caller's own listings,
     * newest first.
     */
    @GetMapping(Routes.Offers.ME)
    public List<OfferDto> offersOnMine(@CurrentUser AuthPrincipal principal) {
        return offerService.offersOnMine(principal.userId());
    }
}
