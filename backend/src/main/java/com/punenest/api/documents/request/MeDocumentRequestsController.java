package com.punenest.api.documents.request;

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
 * The owner's side of document access at {@code /me/documents/requests}: the inbox of buyer asks
 * and the grant/decline decision.
 *
 * <p>Deliberately a separate controller from {@link com.punenest.api.documents.vault.MeDocumentsController}
 * even though both live under {@code /me/documents}: one is the owner's own files, the other is
 * other people's requests for them, and the URI overlap is the contract's shape rather than a
 * shared responsibility. Merging them would put the route-precedence hazard described on
 * {@link Routes.MeDocuments} inside a single class where it looks like an ordering bug.
 */
@RestController
public class MeDocumentRequestsController {

    private final DocumentRequestService requestService;

    public MeDocumentRequestsController(DocumentRequestService requestService) {
        this.requestService = requestService;
    }

    /** {@code GET /me/documents/requests} (contract {@code myDocumentRequests}). */
    @GetMapping(Routes.MeDocuments.REQUESTS)
    public List<DocumentRequestDto> myDocumentRequests(@CurrentUser AuthPrincipal principal) {
        return requestService.myRequests(principal.userId());
    }

    /**
     * {@code PATCH /me/documents/requests/{reqId}} (contract {@code respondDocumentRequest}).
     *
     * <p>Returns {@code 200} with an empty body, matching the contract; the client refetches the
     * inbox to pick up the newly minted share token.
     */
    @PatchMapping(Routes.MeDocuments.REQUEST_BY_ID)
    public void respondDocumentRequest(@CurrentUser AuthPrincipal principal,
            @PathVariable("reqId") String reqId, @Valid @RequestBody StatusUpdate body) {
        requestService.respond(principal.userId(), reqId, body);
    }
}
