package com.punenest.api.documents.request;

import com.punenest.api.common.web.Routes;
import com.punenest.api.documents.vault.DocumentDto;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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

    /**
     * {@code GET /documents/shared?token=…} (contract {@code getSharedDocuments}) — anonymous by
     * contract.
     *
     * <p>The token is the only credential, so it is deliberately <em>not</em> in the path: a path
     * segment is the part of a URL that everything logs by default, whereas a query string can be
     * excluded from a log pattern. That is a configuration fact rather than a property of the URL,
     * so D42 tracks holding it true. Two things now do:
     *
     * <ul>
     *   <li>{@code server.tomcat.accesslog.pattern} is pinned to {@code %m %U %H} in
     *       {@code application.properties}, so enabling the container access log cannot write the
     *       token to disk. Application code that wants to log a URI must go through
     *       {@link com.punenest.api.common.web.LogSafeUri#redact(String)}; nothing does today.</li>
     *   <li>The chain sends {@code Referrer-Policy: no-referrer} (see {@code SecurityConfig}), so a
     *       browser holding this URL cannot forward it in a {@code Referer} header.</li>
     * </ul>
     *
     * <p>What remains, and is <em>not</em> fixed by either: browser history, bookmarks, any proxy or
     * CDN in front of this app, and the recipient pasting the link into a chat window. Those are
     * only closed by taking the token out of the query string altogether — the migration D42 leaves
     * open, because it changes every link ever issued.
     */
    @GetMapping(Routes.Documents.SHARED)
    public List<DocumentDto> getSharedDocuments(@RequestParam("token") String token) {
        return requestService.shared(token);
    }
}
