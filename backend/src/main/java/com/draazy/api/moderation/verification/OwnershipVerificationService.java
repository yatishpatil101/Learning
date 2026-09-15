package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.VerificationAnnouncer;
import com.draazy.api.common.web.Ids;
import com.draazy.api.documents.vault.Document;
import com.draazy.api.documents.vault.DocumentDto;
import com.draazy.api.documents.vault.DocumentMapper;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The ownership gate: how the <strong>Ownership Verified</strong> badge is earned, and how it
 * lapses. Rationale: docs/flows/admin/property-verification.md#ownership-gate.
 */
@Service
public class OwnershipVerificationService {

    /** Long enough for an ops note naming the flat and the defect, short enough not to fill a log. */
    private static final int MAX_REASON_LENGTH = 300;

    private final OwnershipEvidenceRepository evidence;
    private final PropertyRepository properties;
    private final DocumentRepository documents;
    private final DocumentMapper documentMapper;
    private final AuditService audit;
    private final VerificationAnnouncer announcer;
    private final AccountPermissions permissions;

    public OwnershipVerificationService(OwnershipEvidenceRepository evidence,
            PropertyRepository properties, DocumentRepository documents, DocumentMapper documentMapper,
            AuditService audit, VerificationAnnouncer announcer, AccountPermissions permissions) {
        this.evidence = evidence;
        this.properties = properties;
        this.documents = documents;
        this.documentMapper = documentMapper;
        this.audit = audit;
        this.announcer = announcer;
        this.permissions = permissions;
    }

    /**
     * {@code GET /properties/{id}/verification/ownership} — the case file. Participant-or-staff, so
     * an owner can see which fact their listing is still waiting on.
     */
    @Transactional(readOnly = true)
    public OwnershipVerificationResponse get(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        return OwnershipGate.toResponse(property,
                evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId()),
                Instant.now(), reviews(actor));
    }

    /**
     * {@code GET /properties/{id}/verification/ownership/documents} — the owner's vault as the
     * reviewer sees it. Reviewer-only and audited: it mints signed URLs to Aadhaar and PAN scans.
     */
    @Transactional(readOnly = true)
    public List<DocumentDto> listDocuments(AuthPrincipal actor, String propertyId) {
        if (!reviews(actor)) {
            throw new ForbiddenException("Only property reviewers may read a listing's documents");
        }
        Property property = load(propertyId);
        List<Document> rows = documents
                .findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(property.getId());
        audit.record(actor, "property.documents.read", "property", propertyId,
                "documents", String.valueOf(rows.size()));
        return documentMapper.toDtos(rows);
    }

    /**
     * {@code POST /properties/{id}/verification/ownership/evidence} — staff/admin record one sighted
     * document. Recording never grants the badge; the gate is a separate judgement.
     */
    @Transactional
    public OwnershipVerificationResponse recordEvidence(AuthPrincipal actor, String propertyId,
            String docType, String documentId, LocalDate issuedOn, String subjectName) {
        Property property = otherPersonsProperty(actor, propertyId);
        Instant now = Instant.now();
        if (!OwnershipEvidenceTypes.isKnown(docType)) {
            throw new BadRequestException("docType must be one of " + OwnershipEvidenceTypes.DOC_TYPES);
        }
        if (issuedOn == null) {
            throw new BadRequestException("issuedOn is required");
        }
        if (issuedOn.isAfter(LocalDate.now(PlatformTime.IST))) {
            throw new BadRequestException("issuedOn cannot be in the future");
        }
        String subject = subjectName == null || subjectName.isBlank() ? null : subjectName.strip();
        if (subject == null && OwnershipEvidenceTypes.namesASubject(docType)) {
            throw new BadRequestException(
                    "subjectName is required for " + docType + ": an identity document is evidence "
                            + "of whose identity it is, and a row that does not say cannot be checked");
        }
        Document cited = vaultDocument(property, documentId);
        // A file cannot have been issued after it was filed; without this an old bill is re-cited
        // each quarter with today's date, renewing the expiry window off one unchanged artefact.
        if (cited != null && issuedOn.isAfter(
                cited.getUploadedAt().atZone(PlatformTime.IST).toLocalDate())) {
            throw new BadRequestException(
                    "issuedOn cannot post-date the upload: a document cannot be issued after it was filed");
        }
        // The dropdown alone must not decide what a file is: a bill filed as "Electricity Bill" and
        // recorded as `index_ii` would close the title leg of a sale badge. See contradicts().
        if (cited != null && OwnershipEvidenceTypes.contradicts(docType, cited.getCategory())) {
            throw new BadRequestException("documentId is filed as \"" + cited.getCategory()
                    + "\", which is not a " + docType + ": re-file the document or cite another");
        }

        OwnershipEvidence saved = evidence.saveAndFlush(new OwnershipEvidence(property.getId(),
                docType, cited == null ? null : cited.getId(), issuedOn, actor.userId(), subject));
        // Row id and vault reference, so an investigation can reach the artefact after a vault
        // delete nulls `document_id`. `subjectName` is excluded: the audit log holds no names.
        audit.record(actor, "property.ownership.evidence", "property", propertyId,
                "evidenceId", saved.getId().toString(), "docType", docType,
                "documentId", saved.getDocumentId() == null ? null : saved.getDocumentId().toString(),
                "issuedOn", issuedOn.toString());
        return OwnershipGate.toResponse(property,
                evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId()), now, true);
    }

    /**
     * {@code POST /properties/{id}/verification/ownership} — staff/admin grant the badge. Names the
     * missing facts on rejection, and announces only on a transition into the verified state.
     */
    @Transactional
    public OwnershipVerificationResponse verify(AuthPrincipal actor, String propertyId) {
        Property property = otherPersonsProperty(actor, propertyId);
        Instant now = Instant.now();
        List<OwnershipEvidence> rows = evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId());
        OwnershipGate.State gate = OwnershipGate.evaluate(property, rows, now);
        if (!gate.missing().isEmpty()) {
            throw new BadRequestException("ownership evidence is incomplete: missing "
                    + String.join(", ", gate.missing()));
        }

        boolean wasVerified = property.isOwnershipVerifiedAt(now);
        Instant grantedAt = wasVerified ? property.getOwnershipVerifiedAt() : now;
        property.verifyOwnership(grantedAt, gate.until());
        audit.record(actor, "property.ownership.verified", "property", propertyId,
                "until", gate.until() == null ? null : gate.until().toString(),
                "owner", String.valueOf(property.getOwner().getId()));
        if (!wasVerified) {
            announcer.announceOwnershipVerified(property.getOwner().getId(), property.getId(), now);
        }
        return OwnershipGate.toResponse(property, rows, now, true);
    }

    /**
     * {@code DELETE /properties/{id}/verification/ownership} — staff/admin withdraw the badge, for
     * evidence that turns out to be forged. Evidence rows survive: they are the investigation.
     */
    @Transactional
    public OwnershipVerificationResponse revoke(AuthPrincipal actor, String propertyId, String reason) {
        // Before the row lock: a malformed request should not queue behind a concurrent decision
        // only to be rejected on a field it could have been rejected on immediately.
        if (reason == null || reason.isBlank()) {
            throw new BadRequestException("reason is required");
        }
        // A query string is copied into proxy and access logs, which have none of `audit_log`'s
        // handling; the reason belongs in the audit entry.
        if (reason.length() > MAX_REASON_LENGTH) {
            throw new BadRequestException("reason must be at most " + MAX_REASON_LENGTH + " characters");
        }
        Property property = otherPersonsProperty(actor, propertyId);
        Instant now = Instant.now();
        if (property.getOwnershipVerifiedAt() != null) {
            property.revokeOwnershipVerification();
            audit.record(actor, "property.ownership.revoked", "property", propertyId,
                    "reason", reason, "owner", String.valueOf(property.getOwner().getId()));
        }
        return OwnershipGate.toResponse(property,
                evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId()), now, true);
    }

    /**
     * Resolve the optional vault reference here rather than at the foreign key: an id belonging to a
     * <em>different</em> listing would otherwise let one flat's evidence cite another's title deed.
     */
    private Document vaultDocument(Property property, String documentId) {
        if (documentId == null || documentId.isBlank()) {
            return null;
        }
        Document document = Ids.parseUuid(documentId)
                .flatMap(documents::findById)
                .orElseThrow(() -> new BadRequestException("documentId does not exist"));
        if (!property.getId().equals(document.getPropertyId())
                || document.getServiceRequestId() != null) {
            throw new BadRequestException("documentId belongs to a different listing");
        }
        return document;
    }

    private static boolean isStaff(AuthPrincipal actor) {
        return Roles.Wire.STAFF.equals(actor.role()) || Roles.Wire.ADMIN.equals(actor.role());
    }

    /**
     * Whether this caller reviews properties, not merely holds a staff role. Read from
     * {@link AccountPermissions} (per account), never {@code PermissionMap} (per desk).
     */
    private boolean reviews(AuthPrincipal actor) {
        return isStaff(actor) && permissions.granted(actor, BackOfficePermissions.PROPERTIES_WRITE);
    }

    /** Load the listing and assert the caller is the owner or staff, else 404. */
    private Property participantProperty(AuthPrincipal actor, String propertyId) {
        Property property = load(propertyId);
        if (!isStaff(actor) && !actor.userId().equals(property.getOwner().getId())) {
            throw NotFoundException.of("Property");
        }
        return property;
    }

    /**
     * Load the listing for a write, under a row lock, and refuse its owner. The lock stops two
     * concurrent grants announcing twice and serialises evidence writes against a decision.
     */
    private Property otherPersonsProperty(AuthPrincipal actor, String propertyId) {
        Property property = Ids.parseUuid(propertyId)
                .flatMap(properties::findForVerificationDecision)
                .orElseThrow(() -> NotFoundException.of("Property"));
        if (actor.userId().equals(property.getOwner().getId())) {
            throw new ForbiddenException("You cannot verify the ownership of your own listing");
        }
        return property;
    }

    private Property load(String propertyId) {
        return Ids.parseUuid(propertyId)
                .flatMap(properties::findById)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }
}
