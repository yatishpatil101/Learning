package com.draazy.api.moderation.verification;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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
 * The listing verification thread (contract tag {@code Moderation}). The thread routes are
 * participant-or-staff, guarded in the service — an annotation cannot express "owns this row".
 */
@RestController
public class PropertyVerificationController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    /** Seeing the verification queue — a list of other people's case files. */
    private static final String PROPERTIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_READ;

    /**
     * Deciding one — the same atom the supply console's approve/feature routes carry; this vocabulary
     * has only read and write. See {@link BackOfficePermissions#PROPERTIES_WRITE}.
     */
    private static final String PROPERTIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_WRITE;

    private final PropertyVerificationService service;
    private final PropertyReviewQueue queue;

    public PropertyVerificationController(PropertyVerificationService service, PropertyReviewQueue queue) {
        this.service = service;
        this.queue = queue;
    }

    /** {@code GET /properties/{id}/verification} (contract {@code getPropertyVerification}). */
    @GetMapping(Routes.Moderation.PROPERTY_VERIFICATION)
    public PropertyReviewResponse get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    /** {@code GET /admin/property-reviews} — paged queue of verification case files. */
    @GetMapping(Routes.Moderation.ADMIN_PROPERTY_REVIEWS)
    @PreAuthorize(PROPERTIES_READ)
    public Page<PropertyReviewSummary> listCases(Pageable pageable) {
        return queue.listCases(pageable);
    }

    /**
     * {@code GET /me/property-reviews} (contract {@code listMyPropertyReviews}) — the owner's own
     * case files, one page for a whole dashboard.
     */
    @GetMapping(Routes.Moderation.ME_PROPERTY_REVIEWS)
    public Page<PropertyReviewSummary> listMyCases(
            @CurrentUser AuthPrincipal principal, Pageable pageable) {
        return queue.listMyCases(principal, pageable);
    }

    @GetMapping(Routes.Moderation.ME_PROPERTY_REVIEWS + "/unread-count")
    public UnreadCount unreadCount(@CurrentUser AuthPrincipal principal) {
        return new UnreadCount(queue.unreadCount(principal));
    }

    public record UnreadCount(long count) {
    }

    /** {@code POST /properties/{id}/verification} (contract {@code initPropertyVerification}) — 201. */
    @PostMapping(Routes.Moderation.PROPERTY_VERIFICATION)
    @ResponseStatus(HttpStatus.CREATED)
    public PropertyReviewResponse initiate(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return service.initiate(principal, id);
    }

    @PostMapping(Routes.Moderation.VERIFICATION_MESSAGES)
    @ResponseStatus(HttpStatus.CREATED)
    public PropertyReviewResponse addMessage(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody MessageRequest body) {
        return service.addMessage(principal, id, body.body(), Boolean.TRUE.equals(body.clarificationRequested()));
    }

    @PostMapping(Routes.Moderation.PROPERTY_VERIFICATION + "/start")
    @PreAuthorize(PROPERTIES_WRITE)
    public PropertyReviewResponse start(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.start(principal, id);
    }

    @PatchMapping("/properties/{id}/lifecycle")
    @PreAuthorize(PROPERTIES_WRITE)
    public PropertyReviewResponse correct(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody LifecycleCorrection body) {
        return service.correct(principal, id, body.lifecycleStage(), body.reason());
    }

    /** {@code POST /properties/{id}/verification/read} (contract {@code markVerificationRead}) — 204. */
    @PostMapping(Routes.Moderation.VERIFICATION_READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.markRead(principal, id);
    }

    /**
     * {@code POST /properties/{id}/verification/decision} (contract {@code verificationDecision},
     * {@code x-roles: [staff, admin]}).
     */
    @PostMapping(Routes.Moderation.VERIFICATION_DECISION)
    @PreAuthorize(PROPERTIES_WRITE)
    public PropertyReviewResponse decide(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody DecisionRequest body) {
        return service.decide(principal, id, body.decision(), body.note());
    }

    /**
     * {@code PATCH /properties/{id}/verification/checklist} — tick or untick one line. {@code PATCH}
     * and one line per call so two reviewers on the same case cannot last-write-wins each other.
     */
    @PatchMapping(Routes.Moderation.VERIFICATION_CHECKLIST)
    @PreAuthorize(PROPERTIES_WRITE)
    public PropertyReviewResponse setChecklistItem(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody ChecklistUpdate body) {
        return service.setChecklistItem(principal, id, body.item(), Boolean.TRUE.equals(body.pass()));
    }

    public record MessageRequest(@NotBlank @Size(max = 4000) String body, Boolean clarificationRequested) {
    }

    public record LifecycleCorrection(@NotBlank String lifecycleStage,
            @NotBlank @Size(max = 2000) String reason) {
    }

    /** Body of {@code verificationDecision} (schema {@code DecisionRequest}). */
    public record DecisionRequest(@NotBlank String decision, String note) {
    }

    /**
     * Body of {@code setVerificationChecklist} (schema {@code ChecklistUpdate}). {@code pass} is boxed
     * so an omitted field binds distinctly; the controller collapses null to false.
     */
    public record ChecklistUpdate(@NotBlank String item, Boolean pass) {
    }
}
