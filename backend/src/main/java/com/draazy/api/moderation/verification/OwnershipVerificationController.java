package com.draazy.api.moderation.verification;

import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.DocumentDto;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
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
 * The ownership gate (contract tag {@code Moderation}) — how the <strong>Ownership Verified</strong>
 * badge is earned. Rationale: docs/flows/admin/property-verification.md#ownership-gate.
 */
@RestController
public class OwnershipVerificationController {

    /**
     * Recording evidence, granting the badge and revoking it are all the supply console's write.
     * The {@code GET} carries no atom: an owner is a participant, and an atom would refuse them.
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
     * {@code GET /properties/{id}/verification/ownership/documents} — the owner's uploads for this
     * listing, with signed URLs, so the reviewer can open each one and cite it as evidence.
     */
    @GetMapping(Routes.Moderation.VERIFICATION_OWNERSHIP_DOCUMENTS)
    @PreAuthorize(PROPERTIES_WRITE)
    public List<DocumentDto> listDocuments(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.listDocuments(principal, id);
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
                body.issuedOn(), body.subjectName());
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
     * {@code DELETE /properties/{id}/verification/ownership}. The reason travels as a query
     * parameter because DELETE bodies are widely dropped; its length is capped in the service.
     */
    @DeleteMapping(Routes.Moderation.VERIFICATION_OWNERSHIP)
    @PreAuthorize(PROPERTIES_WRITE)
    public OwnershipVerificationResponse revoke(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @RequestParam String reason) {
        return service.revoke(principal, id, reason);
    }

    /**
     * Body of {@code recordOwnershipEvidence}. {@code issuedOn} is the document's own day, never
     * defaulted; {@code subjectName} is conditionally required and enforced in the service.
     */
    public record EvidenceRequest(
            @NotBlank String docType,
            String documentId,
            @NotNull LocalDate issuedOn,
            @Size(max = 120) String subjectName) {
    }
}
