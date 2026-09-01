package com.punenest.api.services.request;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /me/service-request-invites} — the counterparty's side of a co-filled service request
 * (D121).
 *
 * <p><strong>A separate controller from {@link ServiceRequestsController} because it is a separate
 * resource.</strong> Everything on {@code /service-requests/{id}} is scoped to a request the caller
 * can already see; these two operations are the only ones addressed to somebody who cannot. Hanging
 * them off the request's own path would have meant a route under {@code /service-requests/{id}} that
 * a non-participant is allowed to call, which is precisely the exception a reader of that controller
 * should not have to hold in their head.
 *
 * <p><strong>No {@code @PreAuthorize} on either.</strong> The guard is being the invited person, and
 * it is stronger than any role: an admin calling these gets the same 404 a stranger does, because
 * accepting an invitation on somebody else's behalf is the one thing this flow must not permit.
 *
 * <p>There is no {@code GET /service-request-invites/{id}} and no token-addressed variant. The mock
 * had one — a random invite id in a WhatsApp link, openable by whoever received the forward — and
 * reproducing it would have made an unauthenticated URL sufficient to read a rent, a deposit and two
 * sets of identity documents.
 */
@RestController
public class ServiceRequestInvitesController {

    private final CoFillParties parties;

    public ServiceRequestInvitesController(CoFillParties parties) {
        this.parties = parties;
    }

    /**
     * {@code GET /me/service-request-invites} (contract {@code myServiceRequestInvites}) —
     * outstanding invitations only.
     *
     * <p>Unpaged, unlike every other list on this API, and that is a property of the data rather
     * than an omission: a pending invitation is answered or it is not, so the list is bounded by how
     * many agreements one person is mid-way through arranging. If it ever is not, the answer is a
     * cap on outstanding invitations, not a page cursor.
     *
     * <p>Answered invitations are deliberately absent. Once accepted, the request itself appears in
     * {@code GET /service-requests} and the invitation stops being the interesting object; once
     * declined, there is nothing to do with it. Both remain visible to the requester through
     * {@code ServiceRequest.parties}, which is the side that needs to know.
     *
     * <p>Claims first (V107), and this is the route where it matters most: somebody invited before
     * they held an account has no invitation addressed to their user id until the claim runs, so
     * without it their very first look at this list \u2014 the screen the invitation sends them to \u2014
     * would be empty, and the flow would dead-end exactly where it is supposed to begin.
     */
    @GetMapping(Routes.ServiceRequests.MY_INVITES)
    public List<ServiceRequestPartyDto> myInvites(@CurrentUser AuthPrincipal principal) {
        parties.claimPendingFor(principal);
        return parties.myInvites(principal);
    }

    /**
     * {@code POST /me/service-request-invites/{partyId}} (contract
     * {@code decideServiceRequestInvite}) — 200.
     *
     * <p>{@code POST} to the invitation rather than {@code PATCH} of a {@code status} field: the two
     * outcomes are named acts with different consequences, and a writable status is a field somebody
     * eventually sets to a third value.
     */
    @PostMapping(Routes.ServiceRequests.INVITE_DECISION)
    public ServiceRequestPartyDto decide(@CurrentUser AuthPrincipal principal,
            @PathVariable String partyId, @Valid @RequestBody InviteDecision body) {
        return parties.decide(principal, partyId, body.decision());
    }

    /** Body of {@code decideServiceRequestInvite} (schema {@code InviteDecision}). */
    public record InviteDecision(@NotBlank String decision) {
    }
}
