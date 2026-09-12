package com.draazy.api.documents.request;

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

/**
 * The owner's side of document access at {@code /me/documents/requests}: the inbox of buyer asks
 * and the grant/decline decision.
 *
 * <p>Deliberately a separate controller from {@link com.draazy.api.documents.vault.MeDocumentsController}
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

    /**
     * {@code GET /me/documents/requests} (contract {@code myDocumentRequests}) — paged (D77).
     *
     * <p>Was a bare array. Every row is written by a prospective buyer, not by the owner reading
     * it, so the list grows with demand for the listing — the shape api-standards.md §5.1 requires
     * a page envelope for. An unspecified page returns the newest twenty, which is what every
     * existing caller was already reading off the front of the old array.
     *
     * <p>No {@code sort} parameter: the order is fixed server-side, so {@link Pageables#unsorted}
     * drops a client {@code ?sort=} rather than letting an unmapped property reach the query.
     */
    @GetMapping(Routes.MeDocuments.REQUESTS)
    public PageResponse<DocumentRequestDto> myDocumentRequests(
            @CurrentUser AuthPrincipal principal, @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                requestService.myRequests(principal.userId(), Pageables.unsorted(pageable)),
                dto -> dto);
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
