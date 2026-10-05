package com.draazy.api.content;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

// Active-window filtering stays in one JPQL query so it cannot drift from the contract.
public interface AnnouncementRepository extends JpaRepository<AnnouncementEntity, UUID> {
}