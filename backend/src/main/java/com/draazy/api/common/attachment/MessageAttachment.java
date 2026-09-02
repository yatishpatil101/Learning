package com.draazy.api.common.attachment;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * One file hanging off one message. Maps {@code message_attachments} (V76, D49).
 *
 * <p><strong>Two lifetimes in one row.</strong> A row is created by the upload endpoint with
 * {@code messageId == null}: it belongs to a thread and an uploader, and to no message yet. The
 * reply that names it binds it, once and permanently. That is the whole state machine, and the
 * reason it is a nullable column rather than a separate "pending uploads" table is that the bytes,
 * the proven type and the size are identical in both states — a second table would exist only to
 * hold the same five columns for a few seconds.
 *
 * <p><strong>{@code contentType} is the sniffed type, never the declared one.</strong> Same rule as
 * the document vault: the uploader's {@code Content-Type} header is used to reject and then
 * discarded, so a claim the client made can never come back out as the header that decides whether
 * a browser renders a file or downloads it.
 *
 * <p><strong>No URL is stored.</strong> {@code storageKey} is server-minted and opaque; the URL is
 * minted per read by {@link com.draazy.api.provider.FileStorage} and expires. Storing a URL would
 * make the row outlive the credential and would put a permanent link to private bytes in a table
 * that gets copied into staging.
 */
@Entity
@Table(name = "message_attachments")
@Getter
public class MessageAttachment extends BaseEntity {

    /** One of {@link MessageSurfaces}. CHECK-constrained in V76. */
    @Column(name = "surface", nullable = false, updatable = false)
    private String surface;

    /** The conversation or support ticket. Deliberately not a foreign key — see V76. */
    @Column(name = "thread_id", nullable = false, updatable = false)
    private UUID threadId;

    /** Null until a reply claims it. Set once, never cleared. */
    @Column(name = "message_id")
    private UUID messageId;

    @Column(name = "uploaded_by", nullable = false, updatable = false)
    private UUID uploadedBy;

    @Column(name = "storage_key", nullable = false, updatable = false)
    private String storageKey;

    @Column(name = "content_type", nullable = false, updatable = false)
    private String contentType;

    @Column(name = "size_bytes", nullable = false, updatable = false)
    private long sizeBytes;

    @Column(name = "file_name", nullable = false, updatable = false)
    private String fileName;

    protected MessageAttachment() {
        // JPA
    }

    public MessageAttachment(String surface, UUID threadId, UUID uploadedBy, String storageKey,
            String contentType, long sizeBytes, String fileName) {
        this.surface = surface;
        this.threadId = threadId;
        this.uploadedBy = uploadedBy;
        this.storageKey = storageKey;
        this.contentType = contentType;
        this.sizeBytes = sizeBytes;
        this.fileName = fileName;
    }

    /**
     * Claim this upload for a message. Package-private and one-way: {@link MessageAttachments} is
     * the only thing that may bind, and nothing may unbind, so an attachment cannot be moved from
     * one message to another after the fact.
     */
    void bindTo(UUID messageId) {
        this.messageId = messageId;
    }
}
