package com.draazy.api.moderation.verification;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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

// Participant-or-staff guard lives in service; annotations cannot express "owns this row".
@RestController
public class PropertyVerificationController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private static final String PROPERTIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_READ;

    // Verification decisions use the verification atom.
    private static final String PROPERTIES_VERIFY =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_VERIFY;

    private static final Set<String> CASE_STATUSES =
            Set.of("in_review", "needs_info", "approved", "rejected", "pending");

    private final PropertyVerificationService service;
    private final PropertyVerificationOverrideService overrides;
    private final PropertyReviewQueue queue;

    public PropertyVerificationController(PropertyVerificationService service,
            PropertyVerificationOverrideService overrides, PropertyReviewQueue queue) {
        this.service = service;
        this.overrides = overrides;
        this.queue = queue;
    }

    /** {@code GET /properties/{id}/verification} (contract {@code getPropertyVerification}). */
    @GetMapping(Routes.Moderation.PROPERTY_VERIFICATION)
    public PropertyReviewResponse get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    @GetMapping(Routes.Moderation.ADMIN_PROPERTY_REVIEWS)
    @PreAuthorize(PROPERTIES_READ)
    public Page<PropertyReviewSummary> listCases(
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "false") boolean unread, Pageable pageable) {
        if (status != null && !CASE_STATUSES.contains(status)) {
            throw new BadRequestException("status must be one of " + String.join(", ",
                    CASE_STATUSES.stream().sorted().toList()));
        }
        if (unread && status != null) {
            throw new BadRequestException("unread cannot be combined with status");
        }
        return queue.listCases(status, unread, pageable);
    }

    // Owner dashboard gets its own case files in one page.
    @GetMapping(Routes.Moderation.ME_PROPERTY_REVIEWS)
    public Page<PropertyReviewSummary> listMyCases(
            @CurrentUser AuthPrincipal principal, Pageable pageable) {
        return queue.listMyCases(principal, pageable);
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
    @PreAuthorize(PROPERTIES_VERIFY)
    public PropertyReviewResponse start(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.start(principal, id);
    }

    /** {@code POST /properties/{id}/verification/read} (contract {@code markVerificationRead}) — 204. */
    @PostMapping(Routes.Moderation.VERIFICATION_READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.markRead(principal, id);
    }

    // POST /properties/{id/verification/decision} (contract verificationDecision, x-roles: [staff, admin]).
    @PostMapping(Routes.Moderation.VERIFICATION_DECISION)
    @PreAuthorize(PROPERTIES_VERIFY)
    public PropertyReviewResponse decide(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody DecisionRequest body) {
        return service.decide(principal, id, body.decision(), body.note(),
                body.reasonCode(), body.expectedStatus());
    }

    @PostMapping("/properties/{id}/verification/override-requests")
    @PreAuthorize(PROPERTIES_VERIFY)
    @ResponseStatus(HttpStatus.CREATED)
    public PropertyReviewResponse requestOverride(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody OverrideRequest body) {
        return overrides.request(principal, id, body.reason());
    }

    @PostMapping("/properties/{id}/verification/override-requests/{requestId}/approve")
    @PreAuthorize(PROPERTIES_VERIFY)
    public PropertyReviewResponse approveOverride(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @PathVariable String requestId,
            @Valid @RequestBody(required = false) OverrideApproval body) {
        return overrides.approve(principal, id, requestId, body == null ? null : body.note());
    }

    // One line per PATCH so reviewers cannot overwrite each other's checklist changes.
    @PatchMapping(Routes.Moderation.VERIFICATION_CHECKLIST)
    @PreAuthorize(PROPERTIES_VERIFY)
    public PropertyReviewResponse setChecklistItem(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody ChecklistUpdate body) {
        return service.setChecklistItem(principal, id, body.item(), Boolean.TRUE.equals(body.pass()));
    }

    public record MessageRequest(@NotBlank @Size(max = 4000) String body, Boolean clarificationRequested) {
    }

    @RejectionNeedsReason
    public record DecisionRequest(@NotBlank String decision, @Size(max = 2000) String note,
            String reasonCode, String expectedStatus) {
    }

    // Boxed pass lets omission bind distinctly; controller collapses null to false.
    public record ChecklistUpdate(@NotBlank String item, Boolean pass) {
    }

    public record OverrideRequest(@NotBlank @Size(max = 300) String reason) {
    }

    public record OverrideApproval(@Size(max = 2000) String note) {
    }
}
