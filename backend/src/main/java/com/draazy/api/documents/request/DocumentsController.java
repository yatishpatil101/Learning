package com.draazy.api.documents.request;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.DocumentDto;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
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

    /**
     * {@code GET /me/document-requests} (contract {@code myDocumentAsks}) — the caller's own asks,
     * newest first, paged (D123).
     *
     * <p>On this controller rather than {@code MeDocumentRequestsController}, despite the
     * {@code /me} prefix the two now share. That class is the <em>owner's</em> inbox and every
     * method on it is scoped through {@code properties.owner_id}; this one is scoped through
     * {@code requester_id}. Putting both authorisation rules in one class is how a later edit ends
     * up calling the wrong helper, and the buyer's side of a gate belongs with the rest of the
     * buyer's side of the gate — which is here, next to the {@code POST} that writes the row.
     *
     * <p>{@link Pageables#unsorted} for the same reason as the inbox: the order is fixed server-side
     * and a caller-supplied {@code sort} would let a client order rows by a column that is not
     * indexed for it.
     */
    @GetMapping(Routes.MeDocumentRequests.BASE)
    public PageResponse<DocumentRequestDto> myDocumentAsks(
            @CurrentUser AuthPrincipal principal, @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                requestService.myAsks(principal.userId(), Pageables.unsorted(pageable)),
                dto -> dto);
    }

    /**
     * {@code GET /me/document-requests/{reqId}/documents} (contract {@code myGrantedDocuments}) —
     * the documents one of the caller's own granted requests unlocked.
     *
     * <p>Beside {@link #myDocumentAsks} because it is scoped the same way: through
     * {@code requester_id}, never through {@code properties.owner_id}. The list says whether the
     * ask was answered; this says what the answer contains.
     *
     * <p>Signed-in rather than token-scoped, and that is the whole point. {@link #getSharedDocuments}
     * exists for a recipient with no account, and its credential is forwardable by design. This one
     * needs no credential the buyer could leak, because the buyer is already authenticated — which
     * is why a granted buyer can now open their documents without the owner having forwarded them
     * anything.
     */
    @GetMapping(Routes.MeDocumentRequests.DOCUMENTS_BY_ID)
    public List<DocumentDto> myGrantedDocuments(@CurrentUser AuthPrincipal principal,
            @PathVariable("reqId") String reqId) {
        return requestService.myGranted(principal.userId(), reqId);
    }

    /**
     * {@code GET /documents/shared} with {@code X-Share-Token} (contract {@code getSharedDocuments})
     * — anonymous by contract.
     *
     * <p><strong>The token is a header, not a query parameter (D42).</strong> It used to be
     * {@code ?token=…}, which made every share link itself a 7-day bearer credential: copied into
     * browser history and bookmarks, written to any proxy or CDN access log, and forwarded verbatim
     * the moment the recipient pasted it into a chat. Redacting our own logs and sending
     * {@code Referrer-Policy: no-referrer} closed the paths we control; none of them could close
     * those. A header is not part of the URL, so none of them exist for it.
     *
     * <p>The query parameter is <strong>gone</strong>, not deprecated. Nothing had ever built a link
     * carrying one — no share button ships yet — so there was no compatibility window to honour, and
     * a still-live bearer-in-URL path is the vulnerability rather than a migration aid. A stale
     * {@code ?token=…} URL now fails closed with the same opaque 401 as any other bad credential.
     *
     * <p>The caller is the SPA's {@code /shared-documents} route, which reads the token from
     * {@code location.hash}: a fragment is never sent to a server, so it is absent from access logs
     * and from {@code Referer} by construction, and the token reaches us only through this header.
     *
     * <p>The defences that were already here still stand behind it — the container access-log
     * pattern is pinned to {@code %m %U %H}, {@link com.draazy.api.common.web.LogSafeUri} redacts
     * {@code token} for any future request logger, and the chain sends
     * {@code Referrer-Policy: no-referrer}. Belt and braces: they now guard a URL that no longer
     * carries a secret.
     *
     * <p>{@code required = false} rather than letting Spring reject a missing header with a 400:
     * absent, blank and wrong must be indistinguishable, or the endpoint becomes an oracle. The
     * service answers all three with the same 401.
     */
    @GetMapping(Routes.Documents.SHARED)
    public List<DocumentDto> getSharedDocuments(
            @RequestHeader(name = ShareTokens.HEADER, required = false) String token) {
        return requestService.shared(token);
    }
}
