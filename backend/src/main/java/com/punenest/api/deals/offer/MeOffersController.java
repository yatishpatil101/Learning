package com.punenest.api.deals.offer;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
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
     * newest first, paged.
     *
     * <p><strong>Paged as of D77.</strong> Every row in this collection is written by a
     * <em>buyer</em>, not by the owner reading it, so it grows with how much interest the listing
     * attracts — the owner an unpaged read punishes is the successful one. Sort is fixed
     * server-side; {@code Pageables.unsorted} strips a client-supplied one.
     */
    @GetMapping(Routes.Offers.ME)
    public PageResponse<OfferDto> offersOnMine(@CurrentUser AuthPrincipal principal,
                                               @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                offerService.offersOnMine(principal.userId(), Pageables.unsorted(pageable)), o -> o);
    }
}
