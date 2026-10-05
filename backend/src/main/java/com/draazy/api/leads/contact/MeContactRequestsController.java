package com.draazy.api.leads.contact;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MeContactRequestsController {

    private final ContactService contactService;

    public MeContactRequestsController(ContactService contactService) {
        this.contactService = contactService;
    }

    // Entries mask requester mobile; approved requests reveal it only in `contact`.
    // The "waiting on you" count that used to be derived by filtering this array client-side now has its own endpoint.
    @GetMapping(Routes.MeContactRequests.BASE)
    public PageResponse<ContactRequestResponse> myContactRequests(
            @CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                contactService.myRequests(principal.userId(), Pageables.unsorted(pageable)), r -> r);
    }

    @GetMapping(Routes.MeContactRequests.PENDING_COUNT)
    public PendingCountResponse pendingCount(@CurrentUser AuthPrincipal principal) {
        return new PendingCountResponse(contactService.myPendingCount(principal.userId()));
    }

    // Wrap counts now so future sibling fields do not break numeric JSON clients.
    public record PendingCountResponse(long pending) {
    }

    @PatchMapping(Routes.MeContactRequests.BY_ID)
    public void respondContactRequest(@CurrentUser AuthPrincipal principal,
            @PathVariable String reqId, @Valid @RequestBody StatusUpdate body) {
        contactService.respond(principal, reqId, body);
    }
    }
