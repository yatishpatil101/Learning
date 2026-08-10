package com.punenest.api.deals.deal;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
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
 * The deal lifecycle endpoints — the owner's view of their listing's transaction state at
 * {@code /me/deals}. Strictly owner-scoped: every operation verifies the caller owns the property.
 * Anyone else gets 404, never 403.
 *
 * <p>No {@code @PreAuthorize} role guard — the spec carries no {@code x-roles} on these operations.
 * Authentication plus strict owner-scoping is the gate.
 */
@RestController
public class MeDealsController {

    private final DealService dealService;

    public MeDealsController(DealService dealService) {
        this.dealService = dealService;
    }

    /**
     * {@code GET /me/deals} (contract {@code myDeals}) — the deals on the caller's own listings,
     * newest first, paged.
     *
     * <p><strong>Paged as of D77.</strong> Sort is fixed to newest-first inside the query, so no
     * client sort is accepted; {@code Pageables.unsorted} strips one rather than letting an unknown
     * property name reach the query and become a 500. An unspecified page returns the first twenty,
     * which is what every existing caller was already reading off the front of the old array.
     */
    @GetMapping(Routes.Deals.BASE)
    public PageResponse<DealDto> myDeals(@CurrentUser AuthPrincipal principal,
                                         @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                dealService.myDeals(principal.userId(), Pageables.unsorted(pageable)), d -> d);
    }

    /**
     * {@code GET /me/deals/{propId}} (contract {@code getDeal}) — deal status for one property.
     * Returns a synthesized active Deal when no stored row exists.
     *
     * @throws com.punenest.api.common.error.NotFoundException when the property does not exist
     *                                                          or is not the caller's
     */
    @GetMapping(Routes.Deals.BY_PROP)
    public DealDto getDeal(@CurrentUser AuthPrincipal principal,
                           @PathVariable("propId") String propId) {
        return dealService.getDeal(principal.userId(), parseUuid(propId));
    }

    /**
     * {@code POST /me/deals/{propId}/reserve} (contract {@code reserveDeal}) — marks the property
     * under offer.
     */
    @PostMapping(Routes.Deals.RESERVE)
    public void reserve(@CurrentUser AuthPrincipal principal,
                        @PathVariable("propId") String propId) {
        dealService.reserve(principal.userId(), parseUuid(propId));
    }

    /**
     * {@code POST /me/deals/{propId}/close} (contract {@code closeDeal}) — closes the deal.
     */
    @PostMapping(Routes.Deals.CLOSE)
    public void close(@CurrentUser AuthPrincipal principal,
                      @PathVariable("propId") String propId,
                      @Valid @RequestBody DealCloseRequest body) {
        dealService.close(principal.userId(), parseUuid(propId), body);
    }

    /**
     * {@code POST /me/deals/{propId}/reopen} (contract {@code reopenDeal}) — reopens a
     * closed/reserved deal.
     */
    @PostMapping(Routes.Deals.REOPEN)
    public void reopen(@CurrentUser AuthPrincipal principal,
                       @PathVariable("propId") String propId) {
        dealService.reopen(principal.userId(), parseUuid(propId));
    }

    /**
     * {@code GET /me/deals/{propId}/parties} (contract {@code listParties}) — the under-offer
     * parties on a deal.
     */
    @GetMapping(Routes.Deals.PARTIES)
    public List<DealPartyDto> listParties(@CurrentUser AuthPrincipal principal,
                                           @PathVariable("propId") String propId) {
        return dealService.listParties(principal.userId(), parseUuid(propId));
    }

    /**
     * {@code POST /me/deals/{propId}/parties} (contract {@code addParty}) — adds an off-platform
     * interested party. Returns 201.
     */
    @PostMapping(Routes.Deals.PARTIES)
    @ResponseStatus(HttpStatus.CREATED)
    public DealPartyDto addParty(@CurrentUser AuthPrincipal principal,
                                  @PathVariable("propId") String propId,
                                  @Valid @RequestBody DealPartyCreateRequest body) {
        return dealService.addParty(principal.userId(), parseUuid(propId), body);
    }

    /**
     * {@code DELETE /me/deals/{propId}/parties/{partyId}} (contract {@code removeParty}) —
     * soft-deletes a party from a deal. Returns 204.
     */
    @DeleteMapping(Routes.Deals.PARTY_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeParty(@CurrentUser AuthPrincipal principal,
                            @PathVariable("propId") String propId,
                            @PathVariable("partyId") String partyId) {
        dealService.removeParty(principal.userId(), parseUuid(propId), parseUuid(partyId));
    }

    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Property"));
    }
}
