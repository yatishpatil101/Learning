package com.draazy.api.services.request;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ServiceRequestPoliceIntimationRepository
        extends JpaRepository<ServiceRequestPoliceIntimation, UUID> {

    Optional<ServiceRequestPoliceIntimation> findByServiceRequestId(UUID serviceRequestId);

    List<ServiceRequestPoliceIntimation> findByServiceRequestIdIn(List<UUID> serviceRequestIds);
}
