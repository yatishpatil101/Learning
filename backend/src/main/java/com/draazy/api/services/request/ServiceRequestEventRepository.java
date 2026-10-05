package com.draazy.api.services.request;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

// Timeline reads.
// Append-only, so there is no update or delete path.
public interface ServiceRequestEventRepository extends JpaRepository<ServiceRequestEvent, UUID> {

    List<ServiceRequestEvent> findByRequestIdOrderByAtAsc(UUID requestId);

    List<ServiceRequestEvent> findByRequestIdInOrderByAtAsc(Collection<UUID> requestIds);

    boolean existsByRequestIdAndEvent(UUID requestId, String event);

    Optional<ServiceRequestEvent> findFirstByRequestIdAndEventInOrderByAtDesc(UUID requestId,
            Collection<String> events);
}
