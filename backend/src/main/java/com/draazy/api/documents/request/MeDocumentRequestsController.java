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

@RestController
public class MeDocumentRequestsController {

    private final DocumentRequestService requestService;

    public MeDocumentRequestsController(DocumentRequestService requestService) {
        this.requestService = requestService;
    }

    @GetMapping(Routes.MeDocuments.REQUESTS)
    public PageResponse<DocumentRequestDto> myDocumentRequests(
            @CurrentUser AuthPrincipal principal, @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                requestService.myRequests(principal.userId(), Pageables.unsorted(pageable)),
                dto -> dto);
    }

    @PatchMapping(Routes.MeDocuments.REQUEST_BY_ID)
    public void respondDocumentRequest(@CurrentUser AuthPrincipal principal,
            @PathVariable("reqId") String reqId, @Valid @RequestBody StatusUpdate body) {
        requestService.respond(principal, reqId, body);
    }
    }
