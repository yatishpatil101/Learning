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
import com.draazy.api.identity.verification.IdentityFilePurgeService;
import com.draazy.api.provider.DocumentScanner;
import com.draazy.api.provider.FileStorage;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

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
    private final IdentityFilePurgeService filePurge;

    // Scanners are cumulative: adding one must never replace the existing security checks.
    public DocumentService(DocumentRepository documents,
            PersonalDocumentRepository personalDocuments,
            ManagedPropertyDocumentRepository managedDocuments, PropertyRepository properties,
            ManagedPropertyRepository managedProperties, DocumentMapper mapper, FileStorage storage,
            List<DocumentScanner> scanners, BadgeEvidenceLookup badgeEvidence, AuditService audit,
            IdentityFilePurgeService filePurge) {
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
        this.filePurge = filePurge;
    }

    @Transactional(readOnly = true)
    public List<DocumentSummary> list(UUID ownerId, String propId) {
        return mapper.toSummaries(documents.findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(
                ownedProperty(ownerId, propId)));
    }

    /** A signed URL for one of the caller's own files: a listing's vault, the personal vault or a managed record's. */
    @Transactional(readOnly = true)
    public DocumentUrl url(UUID ownerId, String docId) {
        UUID id = Ids.parseUuid(docId).orElseThrow(() -> NotFoundException.of("Document"));
        String key = documents.findById(id)
                .filter(d -> d.getServiceRequestId() == null && d.getPropertyId() != null
                        && properties.findByIdAndOwner_Id(d.getPropertyId(), ownerId).isPresent())
                .map(Document::getStorageKey)
                .or(() -> personalDocuments.findById(id)
                        .filter(d -> d.getOwnerId().equals(ownerId))
                        .map(PersonalDocument::getStorageKey))
                .or(() -> managedDocuments.findById(id)
                        .filter(d -> managedProperties.findById(d.getManagedPropertyId())
                                .filter(m -> m.getOwnerId().equals(ownerId)).isPresent())
                        .map(ManagedPropertyDocument::getStorageKey))
                .orElseThrow(() -> NotFoundException.of("Document"));
        return new DocumentUrl(storage.signedDownloadUrl(key));
    }
    /** Store object, then row: reversed order leaves a row pointing at nothing on storage failure. */
    // Deliberately unscoped: caller passes an already-authorised `propertyId`.
    @Transactional
    public DocumentSummary upload(UUID ownerId, String propId, String category, MultipartFile file) {
        UUID propertyId = ownedProperty(ownerId, propId);
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);
        scan(file.getOriginalFilename(), type, bytes);

        String key = "documents/" + propertyId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        Document saved = documents.saveAndFlush(new Document(propertyId, category,
                DocumentUploads.safeFileName(file.getOriginalFilename()), key,
            bytes.length, type));

        return mapper.toSummary(saved);
    }

    // Deliberately unscoped: caller passes an already-authorised `propertyId`.
    // Same ordering, allowlist and server-minted key as `#upload`; key `personal/{ownerId`/{uuid}}.
    @Transactional
    public DocumentDto uploadForServiceRequest(UUID propertyId, UUID serviceRequestId,
            String category, MultipartFile file) {
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);
        scan(file.getOriginalFilename(), type, bytes);

        String key = (propertyId == null ? "documents/service-requests/" + serviceRequestId : "documents/" + propertyId)
                + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        return mapper.toDto(documents.saveAndFlush(new Document(propertyId, serviceRequestId,
                category, DocumentUploads.safeFileName(file.getOriginalFilename()), key,
            bytes.length, type)));
    }

    /** Same ordering, allowlist and server-minted key as {@link #upload}; key {@code personal/{ownerId}/{uuid}}. */
    @Transactional
    public DocumentDto fileFromPersonalVault(UUID ownerId, String personalDocId, UUID propertyId,
            UUID serviceRequestId, String category) {
        PersonalDocument source = Ids.parseUuid(personalDocId)
                .flatMap(personalDocuments::findById)
                .filter(d -> d.getOwnerId().equals(ownerId))
                .orElseThrow(() -> NotFoundException.of("Document"));
        return mapper.toDto(documents.saveAndFlush(new Document(propertyId, serviceRequestId,
                category, source.getFileName(), source.getStorageKey(),
                source.getSizeBytes() == null ? 0 : source.getSizeBytes(), source.getMimeType())));
    }

    @Transactional
    public void delete(AuthPrincipal owner, String propId, String docId) {
        UUID propertyId = ownedProperty(owner.userId(), propId);
        Document doc = Ids.parseUuid(docId)
                .flatMap(documents::findById)
                .filter(d -> propertyId.equals(d.getPropertyId()) && d.getServiceRequestId() == null)
                .orElseThrow(() -> NotFoundException.of("Document"));
        BadgeEvidenceLookup.Hold hold = badgeEvidence.holdOn(doc.getId());
        if (hold == BadgeEvidenceLookup.Hold.LIVE_BADGE) {
            throw new ConflictException("This document is the evidence for your listing's Ownership"
                    + " Verified badge and cannot be deleted while the badge stands. Ask support to"
                    + " withdraw the badge first.");
        }
        if (hold == BadgeEvidenceLookup.Hold.CITED) {

            audit.record(owner, "property.document.evidence.deleted", "document",
                    doc.getId().toString(), "propertyId", propertyId.toString(),
                    "category", doc.getCategory(), "fileName", doc.getFileName());
        }
        documents.delete(doc);
        purgeIfUnreferenced(doc.getStorageKey());
    }

    // A private managed record may never be advertised, so its papers cannot require a listing.
    @Transactional(readOnly = true)
    public List<DocumentSummary> listPersonal(UUID ownerId) {
        return mapper.toPersonalSummaries(
                personalDocuments.findByOwnerIdOrderByUploadedAtDescIdDesc(ownerId));
    }

    /** Same ordering, allowlist, scan and minted key as {@link #upload}, under {@code managed/{managedId}}. */
    @Transactional
    public DocumentSummary uploadPersonal(UUID ownerId, String category, MultipartFile file) {
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);
        scan(file.getOriginalFilename(), type, bytes);

        String key = "personal/" + ownerId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        return mapper.toSummary(personalDocuments.saveAndFlush(new PersonalDocument(ownerId, category,
                DocumentUploads.safeFileName(file.getOriginalFilename()), key,
            bytes.length, type)));
    }

    @Transactional
    public void deletePersonal(UUID ownerId, String docId) {
        PersonalDocument doc = Ids.parseUuid(docId)
                .flatMap(personalDocuments::findById)
                .filter(d -> d.getOwnerId().equals(ownerId))
                .orElseThrow(() -> NotFoundException.of("Document"));
        personalDocuments.delete(doc);
        purgeIfUnreferenced(doc.getStorageKey());
    }

    @Transactional(readOnly = true)
    public List<DocumentSummary> listManaged(UUID ownerId, String managedId) {
        return mapper.toManagedSummaries(
                managedDocuments.findByManagedPropertyIdOrderByUploadedAtDescIdDesc(
                        ownedManaged(ownerId, managedId)));
    }

    @Transactional
    public DocumentSummary uploadManaged(UUID ownerId, String managedId, String category,
            MultipartFile file) {
        UUID recordId = ownedManaged(ownerId, managedId);
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);
        scan(file.getOriginalFilename(), type, bytes);

        String key = "managed/" + recordId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        return mapper.toSummary(managedDocuments.saveAndFlush(new ManagedPropertyDocument(recordId,
                category, DocumentUploads.safeFileName(file.getOriginalFilename()), key,
            bytes.length, type)));
    }

    @Transactional
    public void deleteManaged(UUID ownerId, String managedId, String docId) {
        UUID recordId = ownedManaged(ownerId, managedId);
        ManagedPropertyDocument doc = Ids.parseUuid(docId)
                .flatMap(managedDocuments::findById)
                .filter(d -> d.getManagedPropertyId().equals(recordId))
                .orElseThrow(() -> NotFoundException.of("Document"));
        managedDocuments.delete(doc);
        purgeIfUnreferenced(doc.getStorageKey());
    }

    // fileFromPersonalVault shares one object between a personal row and document rows, so the
    // bytes leave storage only with the last row pointing at them.
    private void purgeIfUnreferenced(String key) {
        if (key != null && !documents.existsByStorageKey(key) && !personalDocuments.existsByStorageKey(key)) {
            filePurge.purgeKeys(List.of(key));
        }
    }

    private UUID ownedManaged(UUID ownerId, String managedId) {
        return Ids.parseUuid(managedId)
                .flatMap(managedProperties::findById)
                .filter(m -> m.getOwnerId().equals(ownerId))
                .map(ManagedProperty::getId)
                .orElseThrow(() -> NotFoundException.of("Managed property"));
    }

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

    private void scan(String fileName, String provedType, byte[] bytes) {
        for (DocumentScanner scanner : scanners) {
            DocumentScanner.Verdict verdict = scanner.scan(fileName, provedType, bytes);
            switch (verdict.outcome()) {
                case CLEAN -> {

                }
                case TOO_LARGE -> throw new PayloadTooLargeException(verdict.detail());
                case REJECTED -> throw new UnsupportedMediaTypeException(verdict.detail());
                default -> throw new IllegalStateException(
                        "unhandled scan outcome " + verdict.outcome());
            }
        }
    }
    }
