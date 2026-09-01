package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
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

/**
 * Group applications — the consumer ends of {@code flatmate_group_applications}.
 *
 * <p>Three routes for two different people. The applicant's host commits the group
 * ({@link #apply}); the listing's owner reads their inbox ({@link #inbox}) and answers
 * ({@link #decide}). The admin's moderation axis lives in {@link FlatmateModerationController} and
 * shares no route with any of these, so no request can be ambiguous about which column it writes.
 *
 * <p>Both writes are role-gated to the consumer roles for the same reason a room or a group is: an
 * application is made by somebody who intends to live there, which ops staff do not. The reads are
 * caller-scoped, so they need no role beyond being signed in.
 *
 * <p>{@link #myGroups} is the fourth route and the flow's first step — which of the caller's groups
 * could apply at all. It answers about groups rather than applications, but it is here because this
 * is what asks the question; see {@code FlatmateApplicationService#myGroups}.
 */
@RestController
public class FlatmateApplicationController {

    private final FlatmateApplicationService service;

    public FlatmateApplicationController(FlatmateApplicationService service) {
        this.service = service;
    }

    /** {@code GET /me/flatmate-groups} — the caller's own groups, moderation state included. */
    @GetMapping(Routes.Flatmates.MY_GROUPS)
    public PageResponse<FlatmateGroupDto> myGroups(@CurrentUser AuthPrincipal principal,
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

    /**
     * Which flat the group wants.
     *
     * <p>The group is the path, so only the listing travels in the body — and it is required
     * rather than defaulted, because there is no sensible flat to guess.
     */
    public record ApplyRequest(@NotNull UUID listingId) {
    }

    /**
     * The owner's yes or no.
     *
     * <p>Validated as non-blank here and against {@link FlatmateVocabulary#DECISION} in the
     * service, so an unknown verdict is a 400 with the allowed set rather than a check-constraint
     * violation from PostgreSQL.
     */
    public record DecisionRequest(@NotBlank String status) {
    }
}
