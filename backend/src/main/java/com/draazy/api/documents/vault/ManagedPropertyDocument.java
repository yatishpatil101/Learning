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
 * One paper attached to a property an owner tracks privately in the Owner Hub — a sale deed, an
 * index-II, a society NOC gathered while deciding whether to sell. Maps
 * {@code managed_property_documents} (V93).
 *
 * <p><strong>The third sibling, for the reason that made the second.</strong> {@link Document}
 * belongs to a listing; {@link PersonalDocument} belongs to a person; this belongs to a
 * {@code managed_properties} row — a flat the owner owns and may never advertise. V6 left
 * {@code documents.property_id} nullable for ideas like this one and V20 closed it, reasoning that
 * a row with no property is unreachable. V32 answered that objection for KYC papers by adding a
 * table rather than reversing V20, so the property vault's sharing and grant logic could keep
 * assuming every row it holds has a listing. This follows the same rule rather than re-opening the
 * column.
 *
 * <p><strong>Not shareable, deliberately.</strong> No {@code serviceRequestId} and no share token.
 * A managed record is private by construction — the owner has not published it, so there is no
 * buyer to grant access to. An owner who wants these papers in front of a buyer publishes the flat
 * and uploads to the listing's vault, which is a different bucket with a different audience.
 *
 * <p><strong>Ids, not associations</strong> — {@code managedPropertyId} is a plain UUID, following
 * {@link Document#getPropertyId()}: the target lives in {@code catalog.managed} and an object
 * reference would hard-wire a cross-context join.
 *
 * <p>{@code uploadedAt} is a distinct column from the inherited {@code createdAt}, following the
 * {@link Document} convention; they are set together and only {@code uploadedAt} is on the wire.
 */
@Entity
@Table(name = "managed_property_documents")
@Getter
public class ManagedPropertyDocument extends AuditedEntity {

    @Column(name = "managed_property_id", nullable = false, updatable = false)
    private UUID managedPropertyId;

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

    @CreationTimestamp
    @Column(name = "uploaded_at", nullable = false, updatable = false)
    private Instant uploadedAt;

    protected ManagedPropertyDocument() {
        // JPA
    }

    public ManagedPropertyDocument(UUID managedPropertyId, String category, String fileName,
            String storageKey, long sizeBytes, String mimeType) {
        this.managedPropertyId = managedPropertyId;
        this.category = category;
        this.fileName = fileName;
        this.storageKey = storageKey;
        this.sizeBytes = sizeBytes;
        this.mimeType = mimeType;
    }

}
