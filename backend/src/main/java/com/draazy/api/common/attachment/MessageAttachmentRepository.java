package com.draazy.api.common.attachment;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads over {@code message_attachments} (V76). */
public interface MessageAttachmentRepository extends JpaRepository<MessageAttachment, UUID> {

    /**
     * Everything hanging off a batch of messages, in upload order.
     *
     * <p>Batched rather than per-message for the same reason {@code ConversationMapper} batches its
     * name and unread lookups: the caller is always projecting a whole thread, so a per-message
     * finder would be an N+1 that only shows up on the longest conversations. Serves
     * {@code idx_message_attachments_message}.
     */
    List<MessageAttachment> findByMessageIdInOrderByCreatedAtAsc(Collection<UUID> messageIds);

    /**
     * The caller's own unbound uploads on one thread — the only rows a reply may claim.
     *
     * <p>Scoped by uploader as well as by thread, so a participant cannot attach the <em>other</em>
     * participant's pending upload to their own message. Serves
     * {@code idx_message_attachments_pending}.
     */
    List<MessageAttachment> findByThreadIdAndUploadedByAndMessageIdIsNull(UUID threadId, UUID uploadedBy);

    /** How many unbound uploads the caller is already sitting on for this thread. */
    long countByThreadIdAndUploadedByAndMessageIdIsNull(UUID threadId, UUID uploadedBy);
}
