package com.punenest.api.moderation.verification;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PropertyReviewRepository extends JpaRepository<PropertyReview, UUID> {

    /** {@code property_id} is UNIQUE (V5), so a listing has at most one open case file. */
    Optional<PropertyReview> findByPropertyId(UUID propertyId);
}
