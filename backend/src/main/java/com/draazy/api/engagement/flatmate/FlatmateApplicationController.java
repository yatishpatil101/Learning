package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Writes are gated to consumer roles because applicants intend to live there; reads are caller-scoped. */
@RestController
public class FlatmateApplicationController {

    private final FlatmateApplicationService service;

    public FlatmateApplicationController(FlatmateApplicationService service) {
        this.service = service;
    }

    /** {@code GET /me/flatmate-groups} — the caller's own groups, moderation state included. */
    @GetMapping(Routes.Flatmates.MY_GROUPS)
    public PageResponse<FlatmateGroupCard> myGroups(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.myGroups(principal, pageable), dto -> dto);
    }

    /** {@code POST /flatmates/groups/{id}/apply} — the group's host applies to a listing. */
    @PostMapping(Routes.Flatmates.GROUP_APPLY)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public GroupApplicationDto apply(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody ApplyRequest body) {
        return service.apply(principal, id, body.listingId());
    }

    /** {@code GET /me/group-applications} — applications on the caller's own listings. */
    @GetMapping(Routes.Flatmates.MY_GROUP_APPLICATIONS)
    public PageResponse<GroupApplicationDto> inbox(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.inbox(principal, pageable), dto -> dto);
    }

    /** {@code PATCH /me/group-applications/{id}} — the owner accepts or declines. */
    @PatchMapping(Routes.Flatmates.MY_GROUP_APPLICATION_BY_ID)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public GroupApplicationDto decide(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody DecisionRequest body) {
        return service.decide(principal, id, body.status());
    }

    public record ApplyRequest(@NotNull UUID listingId) {
    }

    /** Verdict is checked against {@link FlatmateVocabulary#DECISION} in the service, so an unknown one is a 400
     * with the allowed set rather than a PostgreSQL check-constraint violation. */
    public record DecisionRequest(@NotBlank String status) {
    }
}
