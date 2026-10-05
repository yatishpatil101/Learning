package com.draazy.api.common.attachment;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MessageAttachmentRepository extends JpaRepository<MessageAttachment, UUID> {

    // Everything hanging off a batch of messages, in upload order.
    List<MessageAttachment> findByMessageIdInOrderByCreatedAtAsc(Collection<UUID> messageIds);
}
