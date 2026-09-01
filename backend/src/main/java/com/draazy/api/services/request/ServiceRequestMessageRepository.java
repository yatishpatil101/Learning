package com.draazy.api.services.request;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Conversation reads. Message bodies are immutable once written; only the receipt moves. */
public interface ServiceRequestMessageRepository extends JpaRepository<ServiceRequestMessage, UUID> {

    List<ServiceRequestMessage> findByRequestIdOrderByCreatedAtAsc(UUID requestId);

    /** The page read: one query for the whole page rather than one per request. */
    List<ServiceRequestMessage> findByRequestIdInOrderByCreatedAtAsc(Collection<UUID> requestIds);

    /**
     * Stamp the unread messages written by the side the reader is <em>not</em> on (D121).
     *
     * <p>One statement rather than load-mutate-save: a thread can be long, the rows are otherwise
     * immutable so there is nothing for the persistence context to lose, and {@code read_at is null}
     * in the predicate makes it idempotent — re-opening a thread cannot move a receipt that was
     * already taken. Backed by {@code idx_service_request_messages_unread} (V75), which is partial on
     * exactly that predicate.
     *
     * <p>{@code clearAutomatically} so a caller that reads the thread back in the same transaction
     * sees the stamps rather than its stale first-level cache.
     *
     * @param roles the author roles to stamp — {@code staff/admin} for a customer reading,
     *              {@code buyer/owner} for an operator
     * @return how many receipts were taken, so the caller can tell a real read from a no-op
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update ServiceRequestMessage m set m.readAt = :at
            where m.requestId = :requestId
              and m.readAt is null
              and m.authorRole in :roles
            """)
    int markRead(@Param("requestId") UUID requestId,
            @Param("roles") Collection<String> roles,
            @Param("at") Instant at);
}
