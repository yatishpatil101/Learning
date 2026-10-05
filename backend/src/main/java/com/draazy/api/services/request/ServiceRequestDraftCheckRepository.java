package com.draazy.api.services.request;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ServiceRequestDraftCheckRepository extends JpaRepository<ServiceRequestDraftCheck, UUID> {

    Optional<ServiceRequestDraftCheck> findByRequestIdAndDraftVersion(UUID requestId, int draftVersion);

    List<ServiceRequestDraftCheck> findByRequestIdIn(Collection<UUID> requestIds);
}
