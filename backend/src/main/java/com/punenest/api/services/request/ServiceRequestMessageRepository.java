package com.punenest.api.services.request;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Conversation reads. Messages are immutable once written. */
public interface ServiceRequestMessageRepository extends JpaRepository<ServiceRequestMessage, UUID> {

    List<ServiceRequestMessage> findByRequestIdOrderByCreatedAtAsc(UUID requestId);

    /** The page read: one query for the whole page rather than one per request. */
    List<ServiceRequestMessage> findByRequestIdInOrderByCreatedAtAsc(Collection<UUID> requestIds);
}
