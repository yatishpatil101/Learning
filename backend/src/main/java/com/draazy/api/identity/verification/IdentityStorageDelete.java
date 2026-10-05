package com.draazy.api.identity.verification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "identity_storage_deletes")
public class IdentityStorageDelete {

    @Id
    @Column(name = "storage_key", nullable = false, updatable = false)
    private String storageKey;

    @Column(name = "queued_at", nullable = false, updatable = false)
    private Instant queuedAt;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "last_error")
    private String lastError;

    protected IdentityStorageDelete() {
    }

    public IdentityStorageDelete(String storageKey, Instant queuedAt) {
        this.storageKey = storageKey;
        this.queuedAt = queuedAt;
    }

    public String getStorageKey() {
        return storageKey;
    }

    public int getAttempts() {
        return attempts;
    }
}
