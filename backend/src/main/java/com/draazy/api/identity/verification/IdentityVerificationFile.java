package com.draazy.api.identity.verification;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * One captured image of a case (front, back, selfie) — maps {@code identity_verification_files} (V23).
 * Only the storage key is kept; URLs are minted per read. Row-existence == bytes-still-exist.
 */
@Entity
@Table(name = "identity_verification_files")
@Getter
public class IdentityVerificationFile extends BaseEntity {

    public static final String FRONT = "front";
    public static final String BACK = "back";
    public static final String SELFIE = "selfie";

    @Column(name = "verification_id", nullable = false, updatable = false)
    private UUID verificationId;

    @Column(name = "kind", nullable = false, updatable = false)
    private String kind;

    @Column(name = "storage_key", nullable = false, updatable = false)
    private String storageKey;

    @Column(name = "content_type", nullable = false, updatable = false)
    private String contentType;

    @Column(name = "size_bytes", nullable = false, updatable = false)
    private int sizeBytes;

    protected IdentityVerificationFile() {
        // JPA
    }

    public IdentityVerificationFile(UUID verificationId, String kind, String storageKey,
            String contentType, int sizeBytes) {
        this.verificationId = verificationId;
        this.kind = kind;
        this.storageKey = storageKey;
        this.contentType = contentType;
        this.sizeBytes = sizeBytes;
    }
}
