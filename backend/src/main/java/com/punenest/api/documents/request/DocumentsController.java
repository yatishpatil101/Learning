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
     * segment is the part of a URL that everything logs by default, whereas a query string is at
     * least omitted by the container access log we ship (which is off entirely today). That is a
     * configuration fact rather than an enforced guarantee, so it is recorded as debt (D42) —
     * anything that turns request logging on must exclude this parameter.
     */
    @GetMapping(Routes.Documents.SHARED)
    public List<DocumentDto> getSharedDocuments(@RequestParam("token") String token) {
        return requestService.shared(token);
    }
}
