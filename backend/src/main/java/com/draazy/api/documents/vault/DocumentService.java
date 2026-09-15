package com.draazy.api.documents.vault;

import com.draazy.api.catalog.managed.ManagedProperty;
import com.draazy.api.catalog.managed.ManagedPropertyRepository;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.trust.BadgeEvidenceLookup;
import com.draazy.api.common.web.Ids;
import com.draazy.api.provider.DocumentScanner;
import com.draazy.api.provider.FileStorage;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * Owner document vault (property, personal/KYC, managed-record).
 * Rationale: docs/system/cross-cutting.md#document-vault-allowlist-sniff-scan-store
 */
@Service
public class DocumentService {

    private final DocumentRepository documents;
    private final PersonalDocumentRepository personalDocuments;
    private final ManagedPropertyDocumentRepository managedDocuments;
    private final PropertyRepository properties;
    private final ManagedPropertyRepository managedProperties;
    private final DocumentMapper mapper;
    private final FileStorage storage;
    private final List<DocumentScanner> scanners;
    private final BadgeEvidenceLookup badgeEvidence;
    private final AuditService audit;

    // Scanners are cumulative: adding one must never replace the existing security checks.
    public DocumentService(DocumentRepository documents,
            PersonalDocumentRepository personalDocuments,
            ManagedPropertyDocumentRepository managedDocuments, PropertyRepository properties,
            ManagedPropertyRepository managedProperties, DocumentMapper mapper, FileStorage storage,
            List<DocumentScanner> scanners, BadgeEvidenceLookup badgeEvidence, AuditService audit) {
        this.documents = documents;
        this.personalDocuments = personalDocuments;
        this.managedDocuments = managedDocuments;
        this.properties = properties;
        this.managedProperties = managedProperties;
        this.mapper = mapper;
        this.storage = storage;
        this.scanners = scanners;
        this.badgeEvidence = badgeEvidence;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public List<DocumentDto> list(UUID ownerId, String propId) {
        return mapper.toDtos(documents.findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(
                ownedProperty(ownerId, propId)));
    }

    /** Store object, then row: reversed order leaves a row pointing at nothing on storage failure. */
    @Transactional
    public DocumentDto upload(UUID ownerId, String propId, String category, MultipartFile file) {
        UUID propertyId = ownedProperty(ownerId, propId);
        Property property = properties.findForVerificationDecision(propertyId)
            .orElseThrow(() -> NotFoundException.of("Property"));
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);
        scan(file.getOriginalFilename(), type, bytes);

        String key = "documents/" + propertyId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        Document saved = documents.saveAndFlush(new Document(propertyId, category,
                DocumentUploads.safeFileName(file.getOriginalFilename()), key,
            bytes.length, type));
        property.recordLifecycleMedia();
        // saveAndFlush, not save: @UuidGenerator and @CreationTimestamp only populate at INSERT,
        // so a DTO built from the un-flushed entity would carry a null id and uploadedAt.
        return mapper.toDto(saved);
    }

    /**
     * Deliberately unscoped: caller passes an already-authorised {@code propertyId}.
     * Rationale: docs/system/cross-cutting.md#document-vault-allowlist-sniff-scan-store
     */
    @Transactional
    public DocumentDto uploadForServiceRequest(UUID propertyId, UUID serviceRequestId,
            String category, MultipartFile file) {
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);
        scan(file.getOriginalFilename(), type, bytes);

        String key = "documents/" + propertyId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        return mapper.toDto(documents.saveAndFlush(new Document(propertyId, serviceRequestId,
                category, DocumentUploads.safeFileName(file.getOriginalFilename()), key,
            bytes.length, type)));
    }

    /**
     * Hard delete of the row; object left in the store. Refuses when the file backs a live
     * Ownership Verified badge. Rationale: docs/system/cross-cutting.md#document-vault-allowlist-sniff-scan-store
     */
    @Transactional
    public void delete(AuthPrincipal owner, String propId, String docId) {
        UUID propertyId = ownedProperty(owner.userId(), propId);
        Document doc = Ids.parseUuid(docId)
                .flatMap(documents::findById)
                .filter(d -> d.getPropertyId().equals(propertyId) && d.getServiceRequestId() == null)
                .orElseThrow(() -> NotFoundException.of("Document"));
        BadgeEvidenceLookup.Hold hold = badgeEvidence.holdOn(doc.getId());
        if (hold == BadgeEvidenceLookup.Hold.LIVE_BADGE) {
            throw new ConflictException("This document is the evidence for your listing's Ownership"
                    + " Verified badge and cannot be deleted while the badge stands. Ask support to"
                    + " withdraw the badge first.");
        }
        if (hold == BadgeEvidenceLookup.Hold.CITED) {
            // The evidence row survives the delete with a null document_id, so this line is the only
            // remaining answer to "where did the file behind that verdict go?".
            audit.record(owner, "property.document.evidence.deleted", "document",
                    doc.getId().toString(), "propertyId", propertyId.toString(),
                    "category", doc.getCategory(), "fileName", doc.getFileName());
        }
        documents.delete(doc);
    }

    // KYC belongs to the person, not to a property their ownership of may have ended.
    @Transactional(readOnly = true)
    public List<DocumentDto> listPersonal(UUID ownerId) {
        return mapper.toPersonalDtos(
                personalDocuments.findByOwnerIdOrderByUploadedAtDescIdDesc(ownerId));
    }

    /** Same ordering, allowlist and server-minted key as {@link #upload}; key {@code personal/{ownerId}/{uuid}}. */
    @Transactional
    public DocumentDto uploadPersonal(UUID ownerId, String category, MultipartFile file) {
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);
        scan(file.getOriginalFilename(), type, bytes);

        String key = "personal/" + ownerId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        return mapper.toDto(personalDocuments.saveAndFlush(new PersonalDocument(ownerId, category,
                DocumentUploads.safeFileName(file.getOriginalFilename()), key,
            bytes.length, type)));
    }

    /** Owner-scoped by lookup, 404 never 403; object left in the store. */
    @Transactional
    public void deletePersonal(UUID ownerId, String docId) {
        PersonalDocument doc = Ids.parseUuid(docId)
                .flatMap(personalDocuments::findById)
                .filter(d -> d.getOwnerId().equals(ownerId))
                .orElseThrow(() -> NotFoundException.of("Document"));
        personalDocuments.delete(doc);
    }

    // A private managed record may never be advertised, so its papers cannot require a listing.
    @Transactional(readOnly = true)
    public List<DocumentDto> listManaged(UUID ownerId, String managedId) {
        return mapper.toManagedDtos(
                managedDocuments.findByManagedPropertyIdOrderByUploadedAtDescIdDesc(
                        ownedManaged(ownerId, managedId)));
    }

    /** Same ordering, allowlist, scan and server-minted key as {@link #upload}; key {@code managed/{managedId}/{uuid}}. */
    @Transactional
    public DocumentDto uploadManaged(UUID ownerId, String managedId, String category,
            MultipartFile file) {
        UUID recordId = ownedManaged(ownerId, managedId);
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);
        scan(file.getOriginalFilename(), type, bytes);

        String key = "managed/" + recordId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        return mapper.toDto(managedDocuments.saveAndFlush(new ManagedPropertyDocument(recordId,
                category, DocumentUploads.safeFileName(file.getOriginalFilename()), key,
            bytes.length, type)));
    }

    /** Owner-scoped by lookup, 404 never 403; object left in the store. Rows cascade when the record deletes. */
    @Transactional
    public void deleteManaged(UUID ownerId, String managedId, String docId) {
        UUID recordId = ownedManaged(ownerId, managedId);
        ManagedPropertyDocument doc = Ids.parseUuid(docId)
                .flatMap(managedDocuments::findById)
                .filter(d -> d.getManagedPropertyId().equals(recordId))
                .orElseThrow(() -> NotFoundException.of("Document"));
        managedDocuments.delete(doc);
    }

    // Managed records have no slug; the owner filter hides another owner's private vault.
    private UUID ownedManaged(UUID ownerId, String managedId) {
        return Ids.parseUuid(managedId)
                .flatMap(managedProperties::findById)
                .filter(m -> m.getOwnerId().equals(ownerId))
                .map(ManagedProperty::getId)
                .orElseThrow(() -> NotFoundException.of("Managed property"));
    }

    // This vault accepts a UUID or slug, always owner-scoped; other APIs may require a UUID.
    private UUID ownedProperty(UUID ownerId, String propId) {
        return Ids.parseUuid(propId)
                .flatMap(id -> properties.findByIdAndOwner_Id(id, ownerId))
                .or(() -> properties.findBySlugAndOwner_Id(propId, ownerId))
                .map(Property::getId)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    private static byte[] readBytes(MultipartFile file) {
        // Avoid buffering a known oversized upload; validation still checks the actual byte count.
        if (file.getSize() >= DocumentUploads.MAX_BYTES) {
            throw new PayloadTooLargeException("Files must be smaller than 1,000,000 bytes (1 MB)");
        }
        try {
            return file.getBytes();
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException("cannot read uploaded file", e);
        }
    }

    /**
     * Passes the proved type. A scanner unable to reach a verdict throws and that throw propagates
     * (catching would turn "scanner down" into "file fine"); throws 415 or 413.
     */
    private void scan(String fileName, String provedType, byte[] bytes) {
        for (DocumentScanner scanner : scanners) {
            DocumentScanner.Verdict verdict = scanner.scan(fileName, provedType, bytes);
            switch (verdict.outcome()) {
                case CLEAN -> {
                    // keep going: every scanner gets a look, none of them can wave a file through
                }
                case TOO_LARGE -> throw new PayloadTooLargeException(verdict.detail());
                case REJECTED -> throw new UnsupportedMediaTypeException(verdict.detail());
                default -> throw new IllegalStateException(
                        "unhandled scan outcome " + verdict.outcome());
            }
        }
    }
}
