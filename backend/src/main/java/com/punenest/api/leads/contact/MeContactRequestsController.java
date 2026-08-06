package com.punenest.api.leads.contact;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
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
     * the caller's own listings, newest first, paged.
     *
     * <p><strong>Paged as of the contact-integration slice (D78).</strong> It was a bare array, on
     * the argument that an owner's inbox is small — but this collection grows with <em>demand</em>
     * rather than with the owner's own actions, so the owner whose listing is doing well is exactly
     * the one an unpaged read punishes. The "waiting on you" count that used to be derived by
     * filtering this array client-side now has its own endpoint, because deriving it from one page
     * would silently under-count.
     *
     * <p>Each entry carries the requester with a <em>masked</em> mobile; the real one appears in the
     * {@code contact} object only once the request is approved.
     */
    @GetMapping(Routes.MeContactRequests.BASE)
    public PageResponse<ContactRequestResponse> myContactRequests(
            @CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                contactService.myRequests(principal.userId(), Pageables.unsorted(pageable)), r -> r);
    }

    /**
     * {@code GET /me/contact-requests/pending-count} (contract {@code myPendingContactCount}) — the
     * owner's "waiting on you" badge.
     *
     * <p>Counted in the database rather than by fetching the inbox and filtering it. The old
     * approach downloaded an inbox to display an integer, and became wrong the moment the inbox was
     * paged.
     */
    @GetMapping(Routes.MeContactRequests.PENDING_COUNT)
    public PendingCountResponse pendingCount(@CurrentUser AuthPrincipal principal) {
        return new PendingCountResponse(contactService.myPendingCount(principal.userId()));
    }

    /**
     * Body of {@code myPendingContactCount} — an object, not a bare integer.
     *
     * <p>A bare {@code 7} is a valid JSON response and a dead end: it cannot gain a sibling field
     * without breaking every client that parsed it as a number. An object can.
     *
     * @param pending requests in {@code pending} status against any of the caller's listings
     */
    public record PendingCountResponse(long pending) {
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
