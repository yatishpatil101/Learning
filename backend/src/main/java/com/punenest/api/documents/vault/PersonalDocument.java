package com.punenest.api.documents.vault;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;

/**
 * One of a user's own KYC papers — an Aadhaar, a PAN, a passport photo, an ownership proof. Maps
 * {@code personal_documents} (V32).
 *
 * <p><strong>Owned by the person, not a listing.</strong> This is the sibling of {@link Document}
 * and shares its storage model exactly — the bytes live in the object store under an opaque
 * {@code storageKey} and the {@code url} is minted per read and expires, so there is no {@code url}
 * column. What it deliberately lacks is a {@code propertyId} and a {@code serviceRequestId}: a
 * personal document belongs to a {@code ownerId} (a {@code users} row), never enters a property's
 * vault, and is never shared through the document-request flow. Keeping it in its own table is what
 * lets {@code documents}'s sharing logic assume every row it holds has a property (V20).
 *
 * <p>{@code uploadedAt} is a distinct column from the inherited {@code createdAt}, following the
 * {@link Document} convention; they are set together and only {@code uploadedAt} is on the wire.
 */
@Entity
@Table(name = "personal_documents")
@Getter
public class PersonalDocument extends AuditedEntity {

    @Column(name = "owner_id", nullable = false, updatable = false)
    private UUID ownerId;

    /** Free text by contract ("Aadhaar Card", "PAN Card") — the vocabulary is the UI's, not the DB's. */
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

    protected PersonalDocument() {
        // JPA
    }

    public PersonalDocument(UUID ownerId, String category, String fileName, String storageKey,
            long sizeBytes, String mimeType) {
        this.ownerId = ownerId;
        this.category = category;
        this.fileName = fileName;
        this.storageKey = storageKey;
        this.sizeBytes = sizeBytes;
        this.mimeType = mimeType;
    }

}
