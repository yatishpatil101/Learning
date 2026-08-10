package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Ops and admin side of the flatmates market (contract tag {@code Moderation}).
 *
 * <p>Every route here is staff/admin, matching the contract's {@code x-roles}. The two axes are kept
 * on separate routes deliberately — see {@link FlatmateModerationService} for why verification and
 * moderation must not collapse into one another.
 */
@RestController
public class FlatmateModerationController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private final FlatmateModerationService service;

    public FlatmateModerationController(FlatmateModerationService service) {
        this.service = service;
    }

    /**
     * {@code GET /admin/flatmate-reviews} (contract {@code listFlatmateReviews}) — paged.
     *
     * <p>Was a bare array, and was the wrong one: it read every row of a platform-wide table with
     * no scoping and no cap, while every other admin queue in the API pages. See
     * {@link FlatmateModerationService#queue}.
     */
    @GetMapping(Routes.Moderation.FLATMATE_REVIEWS)
    @PreAuthorize(STAFF_OR_ADMIN)
    public PageResponse<FlatmateReviewDto> queue(@RequestParam(required = false) String status,
            @RequestParam(required = false) Boolean flagged,
            @PageableDefault(size = 20, sort = "createdAt",
                    direction = Sort.Direction.ASC) Pageable pageable) {
        return PageResponse.of(service.queue(status, flagged, pageable), dto -> dto);
    }

    /** {@code PATCH /admin/flatmate-reviews/{id}} (contract {@code decideFlatmateReview}). */
    @PatchMapping(Routes.Moderation.FLATMATE_REVIEW_BY_ID)
    @PreAuthorize(STAFF_OR_ADMIN)
    public FlatmateReviewDto decide(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody DecisionRequest body) {
        return service.decideReview(principal, id, body.decision(), body.note());
    }

    /**
     * {@code GET /admin/flatmates/moderation} — the queue D72 created.
     *
     * <p>Oldest first by default: a moderation queue served newest-first starves the person who has
     * been waiting longest, which is the one outcome that turns "we moderate posts" into "we lose
     * posts".
     */
    @GetMapping(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
    @PreAuthorize(STAFF_OR_ADMIN)
    public PageResponse<FlatmateModerationQueueDto> moderationQueue(
            @RequestParam(defaultValue = "post") String kind,
            @RequestParam(required = false) String modStatus,
            @PageableDefault(size = 20, sort = "createdAt",
                    direction = Sort.Direction.ASC) Pageable pageable) {
        return PageResponse.of(service.moderationQueue(kind, modStatus, pageable), dto -> dto);
    }

    /**
     * {@code PATCH /admin/flatmates/{id}/moderation} (contract {@code moderateFlatmatePost}).
     *
     * <p>200 with no body: the contract declares no response schema, and the client already knows
     * what it set. Echoing the post back would invite a client to re-render a row it should be
     * refetching from the queue it is working through.
     */
    @PatchMapping(Routes.Moderation.FLATMATE_MODERATION)
    @PreAuthorize(STAFF_OR_ADMIN)
    @ResponseStatus(HttpStatus.OK)
    public void moderate(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody ModerationRequest body) {
        service.moderate(principal, id, body.modStatus(), body.note());
    }

    /**
     * Contract schema {@code DecisionRequest} as this queue uses it: {@code approved} or
     * {@code rejected}, with a reason that is mandatory on a rejection (checked in the service, and
     * again by the database).
     */
    public record DecisionRequest(@NotBlank String decision, @Size(max = 600) String note) {
    }

    /** The contract's inline moderation body. {@code note} is internal and never shown to consumers. */
    public record ModerationRequest(@NotBlank String modStatus, @Size(max = 600) String note) {
    }

    /** {@code GET /admin/group-applications} (contract {@code listGroupApplications}) — paged. */
    @GetMapping(Routes.Moderation.GROUP_APPLICATIONS)
    @PreAuthorize(STAFF_OR_ADMIN)
    public PageResponse<GroupApplicationDto> applications(
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.applications(pageable), dto -> dto);
    }

    /**
     * {@code PATCH /admin/group-applications/{id}} (contract {@code decideGroupApplication}).
     *
     * <p>Named "decide" by the contract, but it writes the <em>moderation</em> axis only — the
     * owner's accept/decline is theirs alone. See {@link FlatmateModerationService}.
     */
    @PatchMapping(Routes.Moderation.GROUP_APPLICATION_BY_ID)
    @PreAuthorize(STAFF_OR_ADMIN)
    public GroupApplicationDto moderateApplication(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody ModerationRequest body) {
        return service.moderateApplication(principal, id, body.modStatus(), body.note());
    }
}
