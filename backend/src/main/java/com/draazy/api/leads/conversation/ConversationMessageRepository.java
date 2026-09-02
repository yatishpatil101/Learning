package com.draazy.api.leads.conversation;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads and the one bulk write over {@code messages}. */
public interface ConversationMessageRepository extends JpaRepository<ConversationMessage, UUID> {

    /** One thread, oldest first — chat reads downwards. Serves {@code idx_messages_conversation}. */
    List<ConversationMessage> findByConversationIdOrderByCreatedAtAsc(UUID conversationId);

    /**
     * The unread tally for a whole inbox in one query rather than one per thread.
     *
     * <p>Returns only the threads that actually have unread messages, so the caller must treat an
     * absent conversation id as zero rather than expecting a row per thread. Serves the partial
     * index {@code idx_messages_unread}.
     */
    @Query("""
            select m.conversationId, count(m) from ConversationMessage m
            where m.conversationId in :conversationIds
              and m.authorId <> :readerId
              and m.read = false
            group by m.conversationId
            """)
    List<Object[]> unreadCounts(@Param("conversationIds") Collection<UUID> conversationIds,
            @Param("readerId") UUID readerId);

    /**
     * Mark everything in one thread that the caller did not write as read.
     *
     * <p>A bulk update rather than a fetch-and-loop: a long thread would otherwise be loaded into
     * memory to flip a boolean on each row. The cost is the usual one — this bypasses the
     * persistence context, so any {@link ConversationMessage} already loaded in the same
     * transaction keeps its stale {@code read} value. Nothing reads that field back in the same
     * request, and the endpoint returns 204.
     *
     * @return the number of messages actually marked, which is 0 on a thread already read
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update ConversationMessage m set m.read = true
            where m.conversationId = :conversationId
              and m.authorId <> :readerId
              and m.read = false
            """)
    int markRead(@Param("conversationId") UUID conversationId, @Param("readerId") UUID readerId);
}
