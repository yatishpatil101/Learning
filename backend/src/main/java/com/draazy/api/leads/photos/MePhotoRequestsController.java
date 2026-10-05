package com.draazy.api.leads.photos;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MePhotoRequestsController {

    private final PhotoRequestService photoRequests;

    public MePhotoRequestsController(PhotoRequestService photoRequests) {
        this.photoRequests = photoRequests;
    }

    @GetMapping(Routes.MePhotoRequests.BASE)
    public PageResponse<PhotoRequestResponse> myPhotoRequests(
            @CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                photoRequests.myRequests(principal.userId(), Pageables.unsorted(pageable)), r -> r);
    }

    @PatchMapping(Routes.MePhotoRequests.BY_ID)
    public PhotoRequestResponse decide(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID reqId, @Valid @RequestBody DecisionRequest body) {
        return photoRequests.decide(principal, reqId, body.decision());
    }

    public record DecisionRequest(@NotBlank String decision) {
    }
    }
