package com.punenest.api.services.request;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Timeline reads. Append-only, so there is no update or delete path. */
public interface ServiceRequestEventRepository extends JpaRepository<ServiceRequestEvent, UUID> {

    List<ServiceRequestEvent> findByRequestIdOrderByAtAsc(UUID requestId);

    /** The page read: every request's history in one query rather than one query per row. */
    List<ServiceRequestEvent> findByRequestIdInOrderByAtAsc(Collection<UUID> requestIds);
}
