package com.punenest.api.deals.offer;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The offer endpoints: submit, respond, and the buyer's own offers at {@code /offers}.
 *
 * <p>Both routes are authenticated by the default-deny posture in {@code SecurityConfig}.
 *
 * <p><strong>No {@code @PreAuthorize} role guard</strong> — the spec carries no {@code x-roles} on
 * these operations. Authentication plus strict owner/participant scoping is the gate.
 */
@RestController
public class OfferController {

    private final OfferService offerService;

    public OfferController(OfferService offerService) {
        this.offerService = offerService;
    }

    /**
     * {@code POST /offers} (contract {@code submitOffer}) — buyer submits a price offer.
     *
     * @throws com.punenest.api.common.error.NotFoundException when the property does not exist
     * @throws com.punenest.api.common.error.ConflictException  when blocked by a closed deal or duplicate
     */
    @PostMapping(Routes.Offers.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public OfferDto submitOffer(@CurrentUser AuthPrincipal principal,
                                @Valid @RequestBody OfferCreateRequest body) {
        return offerService.submit(principal.userId(), body);
    }

    /**
     * {@code POST /offers/{id}/respond} (contract {@code respondOffer}) — accept, decline, or
     * counter an offer.
     *
     * @throws com.punenest.api.common.error.NotFoundException when the offer is unknown or
     *                                                          the caller is not a participant
     * @throws com.punenest.api.common.error.ConflictException  on an illegal state transition
     */
    @PostMapping(Routes.Offers.RESPOND)
    public void respondOffer(@CurrentUser AuthPrincipal principal,
                             @PathVariable("id") String id,
                             @Valid @RequestBody OfferRespondRequest body) {
        offerService.respond(principal.userId(), parseUuid(id), body);
    }

    /**
     * {@code GET /offers/mine} (contract {@code myOffers}) — offers the caller MADE.
     */
    @GetMapping(Routes.Offers.MINE)
    public List<OfferDto> myOffers(@CurrentUser AuthPrincipal principal) {
        return offerService.myOffers(principal.userId());
    }

    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Offer"));
    }
}
