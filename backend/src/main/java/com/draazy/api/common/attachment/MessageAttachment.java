package com.draazy.api.common.attachment;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

@Entity
@Table(name = "message_attachments")
@Getter
public class MessageAttachment extends BaseEntity {

    @Column(name = "surface", nullable = false, updatable = false)
    private String surface;

    /** The conversation or support ticket. Deliberately not a foreign key — by design. */
    @Column(name = "thread_id", nullable = false, updatable = false)
    private UUID threadId;

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

    }

    public static MessageAttachment conversationPhoto(UUID threadId, UUID messageId, UUID uploadedBy,
            String storageKey, String contentType, long sizeBytes, String fileName) {
        MessageAttachment attachment = new MessageAttachment();
        attachment.surface = "conversation";
        attachment.threadId = threadId;
        attachment.messageId = messageId;
        attachment.uploadedBy = uploadedBy;
        attachment.storageKey = storageKey;
        attachment.contentType = contentType;
        attachment.sizeBytes = sizeBytes;
        attachment.fileName = fileName;
        return attachment;
    }
    }
