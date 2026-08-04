package com.punenest.api.documents.agreement;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RentAgreementRepository extends JpaRepository<RentAgreement, UUID> {

    List<RentAgreement> findByOwnerIdOrderByCreatedAtDesc(UUID ownerId);
}
