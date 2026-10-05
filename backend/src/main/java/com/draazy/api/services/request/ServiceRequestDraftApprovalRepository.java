package com.draazy.api.services.request;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ServiceRequestDraftApprovalRepository
        extends JpaRepository<ServiceRequestDraftApproval, UUID> {

    List<ServiceRequestDraftApproval> findByRequestIdAndDraftVersion(UUID requestId, int draftVersion);

    List<ServiceRequestDraftApproval> findByRequestIdIn(Collection<UUID> requestIds);

    Optional<ServiceRequestDraftApproval> findByRequestIdAndDraftVersionAndPartyKey(
            UUID requestId, int draftVersion, String partyKey);
}
