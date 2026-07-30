package com.punenest.api.leads.contact;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The listing owner's side of the contact gate at {@code /me/contact-requests}: the inbox of incoming
 * requests and the approve/decline decision.
 *
 * <p><strong>Strictly owner-scoped.</strong> Both operations derive the owner from the JWT and reach
 * rows only through the listings that owner actually owns. A request against someone else's listing is
 * invisible on the read and a {@code 404} on the write — never a {@code 403}, which would confirm that
 * a foreign lead exists.
 *
 * <p>No role guard, for the same reason as {@code MeListingsController}: the spec carries no
 * {@code x-roles}, and any signed-in user becomes an owner the moment they post. Authentication plus
 * owner-scoping is the gate.
 */
@RestController
public class MeContactRequestsController {

    private final ContactService contactService;

    public MeContactRequestsController(ContactService contactService) {
        this.contactService = contactService;
    }

    /**
     * {@code GET /me/contact-requests} (contract {@code myContactRequests}) — incoming requests for
     * the caller's own listings, newest first.
     *
     * <p>A bare array, not a {@link com.punenest.api.common.web.PageResponse}, because the contract
     * says so: an owner's inbox is small and the UI derives its "waiting on you" count by filtering
     * this list client-side (there is no {@code pendingContactCount} endpoint — see the slice-3
     * reconciliation log).
     *
     * <p>Each entry carries the requester with a <em>masked</em> mobile; the real one appears in the
     * {@code contact} object only once the request is approved.
     */
    @GetMapping(Routes.MeContactRequests.BASE)
    public List<ContactRequestResponse> myContactRequests(@CurrentUser AuthPrincipal principal) {
        return contactService.myRequests(principal.userId());
    }

    /**
     * {@code PATCH /me/contact-requests/{reqId}} (contract {@code respondContactRequest}) — approve or
     * decline one request. Approving is what unmasks both numbers.
     *
     * <p>Returns {@code 200} with an empty body, matching the contract's bodyless {@code Updated}
     * response; the client refetches the inbox. Only {@code pending → approved|declined} is legal.
     *
     * @throws com.punenest.api.common.error.NotFoundException when the id is unknown or foreign
     * @throws com.punenest.api.common.error.ConflictException when the request was already answered
     */
    @PatchMapping(Routes.MeContactRequests.BY_ID)
    public void respondContactRequest(@CurrentUser AuthPrincipal principal,
            @PathVariable String reqId, @Valid @RequestBody StatusUpdate body) {
        contactService.respond(principal.userId(), reqId, body);
    }
}
