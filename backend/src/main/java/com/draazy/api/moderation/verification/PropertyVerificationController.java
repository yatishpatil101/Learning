package com.draazy.api.moderation.verification;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
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
 * The listing verification thread (contract tag {@code Moderation}).
 *
 * <p>Five of these eight routes carry <strong>no</strong> {@code @PreAuthorize}, which is the correct
 * reading of the contract rather than an omission: they have no {@code x-roles} because the listing
 * owner is a participant in their own review. Their guard is participant-or-staff and lives in
 * {@link PropertyVerificationService}, because an annotation can express "is staff" but not "is staff or
 * owns the row this path points at". The owner's queue is the fifth, and is guarded by nothing at
 * all beyond authentication, because it is scoped by the caller's own id — there is no row it could
 * return that the caller does not already own. The three that are guarded are the ops-only ones: the
 * staff queue, which is a list of other people's case files, the checklist, which is the reviewer's
 * own working record, and the decision — the checker half of the maker-checker pair.
 */
@RestController
public class PropertyVerificationController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    /** Seeing the verification queue — a list of other people's case files. */
    private static final String PROPERTIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_READ;

    /**
     * Deciding one.
     *
     * <p>The same atom the supply console's approve/feature routes carry. {@code V61}'s
     * {@code properties:verify} tried to make this a narrower grant than featuring a listing; this
     * vocabulary has only read and write, so the sub-scope is gone — see
     * {@link BackOfficePermissions#PROPERTIES_WRITE}.
     */
    private static final String PROPERTIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_WRITE;

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
    @PreAuthorize(PROPERTIES_READ)
    public Page<PropertyVerificationService.PropertyReviewSummary> listCases(Pageable pageable) {
        return service.listCases(pageable);
    }

    /**
     * {@code GET /me/property-reviews} (contract {@code listMyPropertyReviews}) — the owner's own
     * case files, one page for a whole dashboard (D218).
     */
    @GetMapping(Routes.Moderation.ME_PROPERTY_REVIEWS)
    public Page<PropertyVerificationService.PropertyReviewSummary> listMyCases(
            @CurrentUser AuthPrincipal principal, Pageable pageable) {
        return service.listMyCases(principal, pageable);
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
    @PreAuthorize(PROPERTIES_WRITE)
    public PropertyReviewResponse decide(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody DecisionRequest body) {
        return service.decide(principal, id, body.decision(), body.note());
    }

    /**
     * {@code PATCH /properties/{id}/verification/checklist} (contract {@code setVerificationChecklist},
     * {@code x-roles: [staff, admin]}) — tick one line, or untick it (D218).
     *
     * <p>Carries the same {@code properties:write} atom as the decision rather than the read atom,
     * because a tick is a step towards publishing: the reviewer who reads the checklist before
     * approving is trusting whoever set it.
     *
     * <p>PATCH, not POST, and one line per call: the console ticks items one at a time as the
     * reviewer works down the list, so a whole-list PUT would make every tick a
     * last-write-wins race against a second reviewer working the same case.
     */
    @PatchMapping(Routes.Moderation.VERIFICATION_CHECKLIST)
    @PreAuthorize(PROPERTIES_WRITE)
    public PropertyReviewResponse setChecklistItem(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody ChecklistUpdate body) {
        return service.setChecklistItem(principal, id, body.item(), Boolean.TRUE.equals(body.pass()));
    }

    /** Body of {@code addVerificationMessage} (schema {@code MessageCreate}). */
    public record MessageRequest(@NotBlank @Size(max = 4000) String body, List<String> attachments) {
    }

    /** Body of {@code verificationDecision} (schema {@code DecisionRequest}). */
    public record DecisionRequest(@NotBlank String decision, String note) {
    }

    /**
     * Body of {@code setVerificationChecklist} (schema {@code ChecklistUpdate}).
     *
     * <p>{@code pass} is boxed so that an omitted field is distinguishable from {@code false} at the
     * binding layer; the controller collapses null to false, since "not stated" and "not checked"
     * are the same fact about a checklist line.
     */
    public record ChecklistUpdate(@NotBlank String item, Boolean pass) {
    }
}
