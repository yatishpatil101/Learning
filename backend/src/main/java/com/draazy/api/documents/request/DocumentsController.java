package com.draazy.api.documents.request;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.DocumentSummary;
import com.draazy.api.documents.vault.DocumentUrl;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The buyer/anonymous side of document access: asking, and reading what a grant unlocked. */
@RestController
public class DocumentsController {

    private final DocumentRequestService requestService;

    public DocumentsController(DocumentRequestService requestService) {
        this.requestService = requestService;
    }

    /** {@code POST /documents/requests} (contract {@code requestDocumentAccess}). */
    @PostMapping(Routes.Documents.REQUESTS)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentRequestDto requestDocumentAccess(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody DocumentRequestCreate body) {
        return requestService.request(principal.userId(), body);
    }

    /** Lives here, not on {@code MeDocumentRequestsController}, which is scoped via {@code properties.owner_id};
     * this one is scoped via {@code requester_id}, and mixing both rules invites calling the wrong helper. */
    @GetMapping(Routes.MeDocumentRequests.BASE)
    public PageResponse<DocumentRequestDto> myDocumentAsks(
            @CurrentUser AuthPrincipal principal, @RequestParam(required = false) UUID propertyId,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                requestService.myAsks(principal.userId(), propertyId, Pageables.unsorted(pageable)),
                dto -> dto);
    }

    /** Scoped via {@code requester_id}; needs no forwardable credential because the buyer is already signed in. */
    @GetMapping(Routes.MeDocumentRequests.DOCUMENTS_BY_ID)
    public List<DocumentSummary> myGrantedDocuments(@CurrentUser AuthPrincipal principal,
            @PathVariable("reqId") String reqId) {
        return requestService.myGranted(principal.userId(), reqId);
    }

    /** Same requester scoping as {@link #myGrantedDocuments}; a file the grant does not unlock is a 404. */
    @GetMapping(Routes.MeDocumentRequests.DOCUMENT_URL)
    public DocumentUrl myGrantedDocumentUrl(@CurrentUser AuthPrincipal principal,
            @PathVariable("reqId") String reqId, @PathVariable("docId") String docId) {
        return requestService.myGrantedUrl(principal.userId(), reqId, docId);
    }

    /** The token is a header, not a query parameter, so it never reaches browser history, proxy logs or Referer;
     * a stale {@code ?token=} URL fails closed with the same opaque 401. */
    @GetMapping(Routes.Documents.SHARED)
    public List<DocumentSummary> getSharedDocuments(
            @RequestHeader(name = ShareTokens.HEADER, required = false) String token) {
        return requestService.shared(token);
    }

    /** Anonymous and token-scoped like {@link #getSharedDocuments}; the exact path is rate limited likewise. */
    @GetMapping(Routes.Documents.SHARED_URL)
    public DocumentUrl getSharedDocumentUrl(
            @RequestHeader(name = ShareTokens.HEADER, required = false) String token,
            @RequestParam("docId") String docId) {
        return requestService.sharedUrl(token, docId);
    }
}
