package com.draazy.api.documents.vault;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;

/**
 * One file in a property's document vault — a sale deed, an index-II, a society NOC. Maps
 * {@code documents} (V6, tightened by V20).
 *
 * <p><strong>The bytes are not here.</strong> The row stores a {@code storageKey}, an opaque handle
 * into the object store; the {@code url} the client sees is minted per read and expires. That is
 * why there is no {@code url} column: a URL persisted in a row is a permanent, un-revocable
 * credential to a title deed, and the first thing anyone would do is email it.
 *
 * <p><strong>Ids, not associations</strong> — {@code propertyId} is a plain UUID for the same
 * reason as {@code leads.contact.ContactRequest}: the target lives in {@code catalog} and an object
 * reference would hard-wire a cross-context join.
 *
 * <p>{@code uploadedAt} is a distinct column from the inherited {@code createdAt} because V6 made
 * it so; they are set together and only {@code uploadedAt} is on the wire.
 */
@Entity
@Table(name = "documents")
@Getter
public class Document extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** Free text by contract ("Sale Deed", "Index II") — the vocabulary is the UI's, not the DB's. */
    @Column(name = "category")
    private String category;

    /** The uploader's filename, sanitised. Shown to the owner; never used as the storage key. */
    @Column(name = "file_name")
    private String fileName;

    @Column(name = "storage_key", updatable = false)
    private String storageKey;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @Column(name = "mime_type")
    private String mimeType;

    /**
     * Set when this file belongs to a service request (the old V7) — a draft agreement, the registered
     * copy, a document ops asked the customer for.
     *
     * <p>It does <em>not</em> replace {@link #propertyId}: a service-request document is still
     * about a flat, so it appears in that property's vault as well. That migration's comment read "a document
     * may belong to a service request <em>instead of</em> a property", but every service Draazy
     * sells is about a specific listing, so the {@code NOT NULL} added by the old V20 stands and this is an additional
     * link rather than an alternative one. {@code ServiceRequestService} refuses a doc upload on a
     * request with no property rather than letting a null through.
     */
    @Column(name = "service_request_id")
    private UUID serviceRequestId;

    @CreationTimestamp
    @Column(name = "uploaded_at", nullable = false, updatable = false)
    private Instant uploadedAt;

    protected Document() {
        // JPA
    }

    public Document(UUID propertyId, String category, String fileName, String storageKey,
            long sizeBytes, String mimeType) {
        this.propertyId = propertyId;
        this.category = category;
        this.fileName = fileName;
        this.storageKey = storageKey;
        this.sizeBytes = sizeBytes;
        this.mimeType = mimeType;
    }

    /** The service-request variant: the same file, additionally attached to a request. */
    public Document(UUID propertyId, UUID serviceRequestId, String category, String fileName,
            String storageKey, long sizeBytes, String mimeType) {
        this(propertyId, category, fileName, storageKey, sizeBytes, mimeType);
        this.serviceRequestId = serviceRequestId;
    }

}
