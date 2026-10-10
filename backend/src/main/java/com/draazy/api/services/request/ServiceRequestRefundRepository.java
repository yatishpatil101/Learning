package com.draazy.api.services.request;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ServiceRequestRefundRepository extends JpaRepository<ServiceRequestRefund, UUID> {

    List<ServiceRequestRefund> findByServiceRequestIdOrderByCreatedAtDesc(UUID serviceRequestId);

    @Query("select coalesce(sum(r.amount), 0) from ServiceRequestRefund r where r.serviceRequestId = :requestId and r.status = 'approved'")
    long approvedTotal(@Param("requestId") UUID requestId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from ServiceRequestRefund r where r.serviceRequestId = :requestId and r.status = 'requested'")
    Optional<ServiceRequestRefund> findOpenForUpdate(@Param("requestId") UUID requestId);
}
