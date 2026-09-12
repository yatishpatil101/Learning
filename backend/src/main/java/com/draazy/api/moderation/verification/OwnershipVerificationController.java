package com.draazy.api.moderation.verification;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The ownership gate (contract tag {@code Moderation}, D190) — how the
 * <strong>Ownership Verified</strong> badge is earned.
 *
 * <p>Held apart from {@link PropertyVerificationController} because the two surfaces answer
 * different questions about the same listing: that one is the owner&lt;-&gt;ops conversation and
 * the approve/reject that ends it, this one is the documentary evidence behind a claim the buyer
 * reads off the listing card. They also fail differently — a rejected listing disappears from
 * search, whereas a lapsed badge leaves the listing live and merely stops it making a claim it can
 * no longer support.
 *
 * <p>The read carries no {@code x-roles}: like the thread it sits beside, the owner is a
 * participant, and an owner who cannot see which document is missing cannot send it. All three
 * writes are staff/admin, and all three additionally refuse the listing's own owner — roles here
 * are additive, so a staff member is also somebody's landlord, and the role alone would let one
 * verify their own flat.
 */
@RestController
public class OwnershipVerificationController {

    /**
     * Recording evidence, granting the badge and revoking it are all the supply console's write.
     *
     * <p>{@code GET} below carries no atom on purpose: it is the owner's own view of their own
     * claim as much as a moderator's, and {@link OwnershipVerificationService#get} decides which of
     * the two the caller is. An atom there would refuse the owner.
     */
    private static final String PROPERTIES_WRITE =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
                    + BackOfficePermissions.REQUIRE_PROPERTIES_WRITE;

    private final OwnershipVerificationService service;

    public OwnershipVerificationController(OwnershipVerificationService service) {
        this.service = service;
    }

    /**
     * {@code GET /properties/{id}/verification/ownership} (contract
     * {@code getOwnershipVerification}).
     */
    @GetMapping(Routes.Moderation.VERIFICATION_OWNERSHIP)
    public OwnershipVerificationResponse get(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return service.get(principal, id);
    }

    /**
     * {@code POST /properties/{id}/verification/ownership/evidence} (contract
     * {@code recordOwnershipEvidence}, {@code x-roles: [staff, admin]}) — 201.
     */
    @PostMapping(Routes.Moderation.VERIFICATION_OWNERSHIP_EVIDENCE)
    @PreAuthorize(PROPERTIES_WRITE)
    @ResponseStatus(HttpStatus.CREATED)
    public OwnershipVerificationResponse recordEvidence(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody EvidenceRequest body) {
        return service.recordEvidence(principal, id, body.docType(), body.documentId(),
                body.issuedAt(), body.subjectName());
    }

    /**
     * {@code POST /properties/{id}/verification/ownership} (contract
     * {@code verifyOwnership}, {@code x-roles: [staff, admin]}).
     */
    @PostMapping(Routes.Moderation.VERIFICATION_OWNERSHIP)
    @PreAuthorize(PROPERTIES_WRITE)
    public OwnershipVerificationResponse verify(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return service.verify(principal, id);
    }

    /**
     * {@code DELETE /properties/{id}/verification/ownership} (contract
     * {@code revokeOwnershipVerification}, {@code x-roles: [staff, admin]}).
     *
     * <p>The reason travels as a query parameter rather than a body: DELETE bodies are widely
     * dropped by proxies and by several HTTP clients, and a revocation whose reason silently
     * vanishes in transit is worse than one that never carried it.
     */
    @DeleteMapping(Routes.Moderation.VERIFICATION_OWNERSHIP)
    @PreAuthorize(PROPERTIES_WRITE)
    public OwnershipVerificationResponse revoke(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @RequestParam String reason) {
        return service.revoke(principal, id, reason);
    }

    /**
     * Body of {@code recordOwnershipEvidence} (schema {@code OwnershipEvidenceCreate}).
     *
     * @param issuedAt the document's own date, which is why it is required rather than defaulted to
     *                 now: a default here would quietly turn every stale document into a fresh one
     * @param subjectName whose identity the document is. Conditionally required rather than
     *                    {@code @NotBlank}, because only the identity doc types name a person — the
     *                    rule belongs with the vocabulary that knows which those are, so it is
     *                    enforced in the service and by a CHECK in V66 (D202)
     */
    public record EvidenceRequest(
            @NotBlank String docType,
            String documentId,
            @NotNull Instant issuedAt,
            @Size(max = 120) String subjectName) {
    }
}
