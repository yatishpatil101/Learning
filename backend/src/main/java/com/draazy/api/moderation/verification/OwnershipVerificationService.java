package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.Notifier;
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
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Rationale: docs/flows/admin/property-verification.md#ownership-gate.
@Service
public class OwnershipVerificationService {

    /** Long enough for an ops note naming the flat and the defect, short enough not to fill a log. */
    private static final int MAX_REASON_LENGTH = 300;

    private static final Set<String> BADGE_STATUSES =
            Set.of(PropertyStatus.PENDING, PropertyStatus.APPROVED, PropertyStatus.PAUSED);

    private final OwnershipEvidenceRepository evidence;
    private final PropertyRepository properties;
    private final DocumentRepository documents;
    private final DocumentMapper documentMapper;
    private final AuditService audit;
    private final VerificationAnnouncer announcer;
    private final AccountPermissions permissions;
    private final OwnershipDocumentAccess documentAccess;
    private final Notifier notifier;

    public OwnershipVerificationService(OwnershipEvidenceRepository evidence,
            PropertyRepository properties, DocumentRepository documents, DocumentMapper documentMapper,
            AuditService audit, VerificationAnnouncer announcer, AccountPermissions permissions,
            OwnershipDocumentAccess documentAccess, Notifier notifier) {
        this.evidence = evidence;
        this.properties = properties;
        this.documents = documents;
        this.documentMapper = documentMapper;
        this.audit = audit;
        this.announcer = announcer;
        this.permissions = permissions;
        this.documentAccess = documentAccess;
        this.notifier = notifier;
    }

    // Participant-or-staff so owners can see which fact is still missing.
    @Transactional(readOnly = true)
    public OwnershipVerificationResponse get(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        return OwnershipGate.toResponse(property,
                evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId()),
                Instant.now(), reviews(actor));
    }

    // Reviewer-only and audited because it mints signed URLs to identity scans.
    @Transactional(readOnly = true)
    public List<DocumentDto> listDocuments(AuthPrincipal actor, String propertyId) {
        if (!reviews(actor)) {
            throw new ForbiddenException("Only property reviewers may read a listing's documents");
        }
        Property property = load(propertyId);

        boolean badgeAsked = property.isOwnershipRequested() && !property.isArchived();
        if (!badgeAsked && !documentAccess.mayRead(property.getId(), Instant.now())) {
            throw new ForbiddenException("document_access_expired",
                    "Document access for this verification case has expired");
        }
        List<Document> rows = documents
                .findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(property.getId());
        audit.record(actor, "property.documents.read", "property", propertyId,
                "documents", String.valueOf(rows.size()));
        return documentMapper.toDtos(rows);
    }

    // Recording never grants the badge; the gate is a separate judgement.
    @Transactional
    public OwnershipVerificationResponse recordEvidence(AuthPrincipal actor, String propertyId,
            String docType, String documentId, LocalDate issuedOn, String subjectName) {
        Property property = otherPersonsProperty(actor, propertyId);
        Instant now = Instant.now();
        if (!OwnershipEvidenceTypes.isKnown(docType)) {
            throw new BadRequestException("docType must be one of " + OwnershipEvidenceTypes.DOC_TYPES);
        }
        if (OwnershipEvidenceTypes.isRetiredIdentityEvidence(docType)) {
            throw new ValidationException("Identity comes from the account's identity verification");
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
                    "subjectName is required for " + docType + ": the row must name the person the document proves");
        }
        Document cited = vaultDocument(property, documentId);

        if (cited != null && issuedOn.isAfter(
                cited.getUploadedAt().atZone(PlatformTime.IST).toLocalDate())) {
            throw new BadRequestException(
                    "issuedOn cannot post-date the upload: a document cannot be issued after it was filed");
        }

        // The dropdown alone must not decide what a file is: a bill filed as "Electricity Bill" and recorded as
        // `index_ii` would close the title leg of a sale badge. See contradicts().
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

    // Announces only on transition into verified state.
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

    // Evidence rows survive revocation because they are the investigation.
    @Transactional
    public OwnershipVerificationResponse revoke(AuthPrincipal actor, String propertyId, String reason) {

        requireReason(reason);
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

    @Transactional
    public OwnershipVerificationResponse request(AuthPrincipal actor, String propertyId) {
        Property property = Ids.parseUuid(propertyId)
                .flatMap(properties::findForVerificationDecision)
                .filter(p -> actor.userId().equals(p.getOwner().getId()))
                .orElseThrow(() -> NotFoundException.of("Property"));
        Instant now = Instant.now();
        if (property.isOwnershipVerifiedAt(now)) {
            throw new ConflictException("already_verified", "This listing already has the Verified badge");
        }
        if (property.isArchived() || !BADGE_STATUSES.contains(property.getStatus())) {
            throw new ConflictException("listing_not_open", "Only a live or under-review listing can ask for the badge");
        }
        if (documents.findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(property.getId()).isEmpty()) {
            throw new ConflictException("documents_missing", "Upload the ownership documents first");
        }
        if (!property.isOwnershipRequested()) {
            property.requestOwnershipReview(now);
            audit.record(actor, "property.ownership.requested", "property", propertyId);
        }
        return OwnershipGate.toResponse(property,
                evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId()), now, false);
    }

    @Transactional
    public OwnershipVerificationResponse decline(AuthPrincipal actor, String propertyId, String reason) {
        requireReason(reason);
        Property property = otherPersonsProperty(actor, propertyId);
        if (!property.isOwnershipRequested()) {
            throw new ConflictException("no_open_request", "This listing has no open badge request");
        }
        Instant now = Instant.now();
        String why = reason.strip();
        property.declineOwnershipReview(why, now);
        audit.record(actor, "property.ownership.declined", "property", propertyId,
                "reason", why, "owner", String.valueOf(property.getOwner().getId()));
        notifier.notify(property.getOwner().getId(), "listing.badge_declined",
                "Verified badge not granted yet", why,
                "/dashboard?tab=documents&prop=" + property.getId());
        return OwnershipGate.toResponse(property,
                evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId()), now, true);
    }

    private static void requireReason(String reason) {

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
    }

    // Resolve here so one flat's evidence cannot cite another listing's deed.
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
        return Roles.isBackOffice(actor.role());
    }

    // Account grant, not staff role alone, controls access to staff-only material.
    private boolean reviews(AuthPrincipal actor) {
        return isStaff(actor) && permissions.granted(actor, BackOfficePermissions.PROPERTIES_VERIFY);
    }

    private Property participantProperty(AuthPrincipal actor, String propertyId) {
        Property property = load(propertyId);
        if (!isStaff(actor) && !actor.userId().equals(property.getOwner().getId())) {
            throw NotFoundException.of("Property");
        }
        return property;
    }

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
