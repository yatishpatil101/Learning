package com.punenest.api.moderation.verification;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The listing verification thread (contract tag {@code Moderation}).
 *
 * <p>Four of these five routes carry <strong>no</strong> {@code @PreAuthorize}, which is the correct
 * reading of the contract rather than an omission: they have no {@code x-roles} because the listing
 * owner is a participant in their own review. Their guard is participant-or-staff and lives in
 * {@link PropertyVerificationService}, because an annotation can express "is staff" but not "is staff or
 * owns the row this path points at". Only the decision — the checker half of the maker-checker pair
 * — is role-gated.
 */
@RestController
public class PropertyVerificationController {

    private final PropertyVerificationService service;

    public PropertyVerificationController(PropertyVerificationService service) {
        this.service = service;
    }

    /** {@code GET /properties/{id}/verification} (contract {@code getPropertyVerification}). */
    @GetMapping(Routes.Moderation.PROPERTY_VERIFICATION)
    public PropertyReviewResponse get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    /** {@code GET /admin/property-reviews} — paged queue of verification case files (D91). */
    @GetMapping(Routes.Moderation.ADMIN_PROPERTY_REVIEWS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public Page<PropertyVerificationService.PropertyReviewSummary> listCases(Pageable pageable) {
        return service.listCases(pageable);
    }

    /** {@code POST /properties/{id}/verification} (contract {@code initPropertyVerification}) — 201. */
    @PostMapping(Routes.Moderation.PROPERTY_VERIFICATION)
    @ResponseStatus(HttpStatus.CREATED)
    public PropertyReviewResponse initiate(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return service.initiate(principal, id);
    }

    /**
     * {@code POST /properties/{id}/verification/messages} (contract {@code addVerificationMessage})
     * — 201.
     *
     * <p>{@code attachments} is accepted and ignored: the contract declares it, but there is no
     * upload surface behind it yet and {@code review_messages} has no column for it. Accepting and
     * silently dropping is the honest option only because it is written down here — the alternative,
     * rejecting a documented field, would break a client that follows the contract.
     */
    @PostMapping(Routes.Moderation.VERIFICATION_MESSAGES)
    @ResponseStatus(HttpStatus.CREATED)
    public PropertyReviewResponse addMessage(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody MessageRequest body) {
        return service.addMessage(principal, id, body.body());
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
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public PropertyReviewResponse decide(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody DecisionRequest body) {
        return service.decide(principal, id, body.decision(), body.note());
    }

    /** Body of {@code addVerificationMessage} (schema {@code MessageCreate}). */
    public record MessageRequest(@NotBlank @Size(max = 4000) String body, List<String> attachments) {
    }

    /** Body of {@code verificationDecision} (schema {@code DecisionRequest}). */
    public record DecisionRequest(@NotBlank String decision, String note) {
    }
}
