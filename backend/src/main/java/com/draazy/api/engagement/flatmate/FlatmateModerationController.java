package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Staff/admin side of the flatmates market. Verification and moderation stay on separate routes —
 * see {@link FlatmateModerationService} for why they must not collapse into one another. */
@RestController
public class FlatmateModerationController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String FLATMATES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_FLATMATES_READ;
    private static final String FLATMATES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_FLATMATES_WRITE;

    private final FlatmateModerationService service;
    private final FlatmateTrustReconciler reconciler;

    public FlatmateModerationController(FlatmateModerationService service,
            FlatmateTrustReconciler reconciler) {
        this.service = service;
        this.reconciler = reconciler;
    }

    /** {@code GET /admin/flatmate-reviews} (contract {@code listFlatmateReviews}) — paged, because
     * this is a platform-wide table with no scoping. */
    @GetMapping(Routes.Moderation.FLATMATE_REVIEWS)
    @PreAuthorize(FLATMATES_READ)
    public PageResponse<FlatmateReviewDto> queue(@RequestParam(required = false) String status,
            @RequestParam(required = false) Boolean flagged,
            @PageableDefault(size = 20, sort = "createdAt",
                    direction = Sort.Direction.ASC) Pageable pageable) {
        return PageResponse.of(service.queue(status, flagged, pageable), dto -> dto);
    }

    /** {@code PATCH /admin/flatmate-reviews/{id}} (contract {@code decideFlatmateReview}). */
    @PatchMapping(Routes.Moderation.FLATMATE_REVIEW_BY_ID)
    @PreAuthorize(FLATMATES_WRITE)
    public FlatmateReviewDto decide(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody DecisionRequest body) {
        return service.decideReview(principal, id, body.decision(), body.note());
    }

    /** {@code GET /admin/flatmates/moderation}. Oldest first by default: newest-first starves the
     * person who has been waiting longest. */
    @GetMapping(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
    @PreAuthorize(FLATMATES_READ)
    public PageResponse<FlatmateModerationQueueDto> moderationQueue(
            @RequestParam(defaultValue = "post") String kind,
            @RequestParam(required = false) String modStatus,
            @PageableDefault(size = 20, sort = "createdAt",
                    direction = Sort.Direction.ASC) Pageable pageable) {
        return PageResponse.of(service.moderationQueue(kind, modStatus, pageable), dto -> dto);
    }

    /** {@code PATCH /admin/flatmates/{id}/moderation}. 200 with no body: the contract declares no
     * response schema, and a client should refetch the queue rather than re-render a row. */
    @PatchMapping(Routes.Moderation.FLATMATE_MODERATION)
    @PreAuthorize(FLATMATES_WRITE)
    @ResponseStatus(HttpStatus.OK)
    public void moderate(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody ModerationRequest body) {
        service.moderate(principal, id, body.modStatus(), body.note());
    }

    /** {@link #FLATMATES_WRITE}, not read: it demotes posts. Idempotent — it re-asks a question
     * rather than applying a delta, so a second click finds nothing left to do. */
    @PostMapping(Routes.Moderation.FLATMATE_OWNER_TIER_RECONCILE)
    @PreAuthorize(FLATMATES_WRITE)
    public ReconcileResponse reconcileOwnerTier(@CurrentUser AuthPrincipal principal) {
        return new ReconcileResponse(reconciler.reconcileOwnerTier(principal));
    }

    /** How many posts the pass demoted. Zero is the healthy answer, not an error. */
    public record ReconcileResponse(int demoted) {
    }

    /** Contract schema {@code DecisionRequest}: {@code approved} or {@code rejected}, with a reason
     * mandatory on a rejection (checked in the service, and again by the database). */
    public record DecisionRequest(@NotBlank String decision, @Size(max = 600) String note) {
    }

    /** The contract's inline moderation body. {@code note} is internal and never shown to consumers. */
    public record ModerationRequest(@NotBlank String modStatus, @Size(max = 600) String note) {
    }

    /** {@code GET /admin/group-applications} (contract {@code listGroupApplications}) — paged. */
    @GetMapping(Routes.Moderation.GROUP_APPLICATIONS)
    @PreAuthorize(FLATMATES_READ)
    public PageResponse<GroupApplicationDto> applications(
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.applications(pageable), dto -> dto);
    }

    /** Named "decide" by the contract, but it writes the <em>moderation</em> axis only — the owner's
     * accept/decline is theirs alone. See {@link FlatmateModerationService}. */
    @PatchMapping(Routes.Moderation.GROUP_APPLICATION_BY_ID)
    @PreAuthorize(FLATMATES_WRITE)
    public GroupApplicationDto moderateApplication(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody ModerationRequest body) {
        return service.moderateApplication(principal, id, body.modStatus(), body.note());
    }
}
