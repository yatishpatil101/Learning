package com.draazy.api.services.request;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ServiceRequestDocumentReviewRepository
        extends JpaRepository<ServiceRequestDocumentReview, UUID> {

    List<ServiceRequestDocumentReview> findByServiceRequestId(UUID serviceRequestId);

    Optional<ServiceRequestDocumentReview> findByDocumentId(UUID documentId);
}
