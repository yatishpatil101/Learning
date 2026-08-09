package com.punenest.api.documents.vault;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.provider.FileStorage;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * The owner's document vault: the files attached to one of their listings — and, alongside it, the
 * owner's own personal (KYC) vault, which belongs to the <em>person</em> and has no listing. The
 * {@code personal*} methods are scoped directly by {@code owner_id} rather than by the property
 * lookup the class Javadoc below describes.
 *
 * <p><strong>Owner-scoped by lookup, 404 never 403.</strong> Every operation resolves the property
 * through {@code owner_id} first, so a document belonging to someone else's listing is invisible on
 * the read and a {@code 404} on the write. A {@code 403} would confirm that a particular property —
 * and therefore a particular sale deed — exists.
 *
 * <p><strong>Storage keys are server-minted.</strong> The client's filename is stored for display
 * and never used as a path; the key is {@code documents/{propertyId}/{uuid}}, which makes a
 * traversal or an overwrite of someone else's object impossible by construction rather than by
 * sanitising.
 *
 * <p><strong>The stored content type is the one the bytes prove, not the one the client sent.</strong>
 * Both upload paths read the file once, hand the bytes to {@link DocumentUploads#validate} and
 * persist whatever it returns. The client's declared type is used to reject and then dropped, so it
 * never reaches the object store or the {@code documents} row and cannot come back out as a response
 * header.
 */
@Service
public class DocumentService {

    private final DocumentRepository documents;
    private final PersonalDocumentRepository personalDocuments;
    private final PropertyRepository properties;
    private final DocumentMapper mapper;
    private final FileStorage storage;

    public DocumentService(DocumentRepository documents,
            PersonalDocumentRepository personalDocuments, PropertyRepository properties,
            DocumentMapper mapper, FileStorage storage) {
        this.documents = documents;
        this.personalDocuments = personalDocuments;
        this.properties = properties;
        this.mapper = mapper;
        this.storage = storage;
    }

    /** Contract {@code listDocuments} — the vault for one of the caller's listings, newest first. */
    @Transactional(readOnly = true)
    public List<DocumentDto> list(UUID ownerId, String propId) {
        return mapper.toDtos(documents.findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(
                ownedProperty(ownerId, propId)));
    }

    /**
     * Contract {@code uploadDocument} — store one file against a listing.
     *
     * <p>The bytes go to the object store <em>before</em> the row is written. The other order would
     * leave a row pointing at nothing whenever storage failed — a document the owner believes they
     * uploaded, and a broken link they only discover when a buyer follows it. This way a storage
     * failure raises before any row exists, and the worst case is an orphaned object nobody can
     * name, which costs disk and nothing else.
     *
     * @throws NotFoundException                if the listing is unknown or not the caller's
     * @throws com.punenest.api.common.error.UnsupportedMediaTypeException for a non-document type
     * @throws com.punenest.api.common.error.PayloadTooLargeException      for an oversized file
     */
    @Transactional
    public DocumentDto upload(UUID ownerId, String propId, String category, MultipartFile file) {
        UUID propertyId = ownedProperty(ownerId, propId);
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);

        String key = "documents/" + propertyId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        Document saved = documents.saveAndFlush(new Document(propertyId, category,
                DocumentUploads.safeFileName(file.getOriginalFilename()), key,
                file.getSize(), type));
        // saveAndFlush, not save: @UuidGenerator and @CreationTimestamp only populate at INSERT,
        // so a DTO built from the un-flushed entity would carry a null id and uploadedAt.
        return mapper.toDto(saved);
    }

    /**
     * Store one file against a service request (slice 11).
     *
     * <p><strong>Deliberately unscoped.</strong> Every other method here resolves the property
     * through {@code owner_id} first; this one takes an already-authorised {@code propertyId},
     * because the caller that owns the decision is {@code ServiceRequestService} and the rule it
     * enforces is not ownership — a staff member uploading the registered agreement does not own
     * the flat. Keeping the storage-key minting, the allowlist and the store-then-write ordering
     * here rather than duplicating them in the services context is the point; the authorisation
     * stays where the workflow is.
     *
     * @param propertyId       already authorised by the caller; never {@code null} (V20)
     * @param serviceRequestId the request this file belongs to
     */
    @Transactional
    public DocumentDto uploadForServiceRequest(UUID propertyId, UUID serviceRequestId,
            String category, MultipartFile file) {
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);

        String key = "documents/" + propertyId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        return mapper.toDto(documents.saveAndFlush(new Document(propertyId, serviceRequestId,
                category, DocumentUploads.safeFileName(file.getOriginalFilename()), key,
                file.getSize(), type)));
    }

    /**
     * Contract {@code deleteDocument} — remove one file from the caller's vault.
     *
     * <p>A hard delete of the row, matching the contract's {@code 204}. The object itself is left
     * in the store: object lifecycle is the store's job (a bucket rule), and issuing a delete we
     * cannot make transactional with the row would trade a tidy bucket for the possibility of a
     * row pointing at a deleted object. Recorded as debt, not silently ignored.
     */
    @Transactional
    public void delete(UUID ownerId, String propId, String docId) {
        UUID propertyId = ownedProperty(ownerId, propId);
        Document doc = Ids.parseUuid(docId)
                .flatMap(documents::findById)
                .filter(d -> d.getPropertyId().equals(propertyId) && d.getServiceRequestId() == null)
                .orElseThrow(() -> NotFoundException.of("Document"));
        documents.delete(doc);
    }

    /**
     * Contract {@code listPersonalDocuments} — the caller's own KYC papers, newest first.
     *
     * <p>Owner-scoped by the {@code owner_id} on every row: there is no lookup to fail, because a
     * personal document is only ever the caller's own.
     */
    @Transactional(readOnly = true)
    public List<DocumentDto> listPersonal(UUID ownerId) {
        return mapper.toPersonalDtos(
                personalDocuments.findByOwnerIdOrderByUploadedAtDescIdDesc(ownerId));
    }

    /**
     * Contract {@code uploadPersonalDocument} — store one KYC file for the caller.
     *
     * <p>Same store-then-write ordering, allowlist and server-minted key as {@link #upload}; the key
     * is {@code personal/{ownerId}/{uuid}}, so a traversal or an overwrite of someone else's object
     * is impossible by construction. The stored content type is the one the bytes prove, not the one
     * the client sent.
     *
     * @throws com.punenest.api.common.error.UnsupportedMediaTypeException for a non-document type
     * @throws com.punenest.api.common.error.PayloadTooLargeException      for an oversized file
     */
    @Transactional
    public DocumentDto uploadPersonal(UUID ownerId, String category, MultipartFile file) {
        byte[] bytes = readBytes(file);
        String type = DocumentUploads.validate(file.getContentType(), file.getSize(), bytes);

        String key = "personal/" + ownerId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        return mapper.toDto(personalDocuments.saveAndFlush(new PersonalDocument(ownerId, category,
                DocumentUploads.safeFileName(file.getOriginalFilename()), key,
                file.getSize(), type)));
    }

    /**
     * Contract {@code deletePersonalDocument} — remove one of the caller's KYC files.
     *
     * <p>Owner-scoped by lookup, {@code 404} never {@code 403}, matching {@link #delete}: a document
     * belonging to someone else is invisible, so a stranger's id yields a 404 rather than confirming
     * the row exists. The object is left in the store for the same reason as the property vault.
     */
    @Transactional
    public void deletePersonal(UUID ownerId, String docId) {
        PersonalDocument doc = Ids.parseUuid(docId)
                .flatMap(personalDocuments::findById)
                .filter(d -> d.getOwnerId().equals(ownerId))
                .orElseThrow(() -> NotFoundException.of("Document"));
        personalDocuments.delete(doc);
    }

    /**
     * Resolve the contract's {@code propId} — a UUID or a slug, as everywhere else — and prove the
     * caller owns it, in one lookup.
     */
    private UUID ownedProperty(UUID ownerId, String propId) {
        return Ids.parseUuid(propId)
                .flatMap(id -> properties.findByIdAndOwner_Id(id, ownerId))
                .or(() -> properties.findBySlugAndOwner_Id(propId, ownerId))
                .map(Property::getId)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    private static byte[] readBytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException("cannot read uploaded file", e);
        }
    }
}
