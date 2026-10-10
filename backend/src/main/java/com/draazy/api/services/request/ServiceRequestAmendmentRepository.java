package com.draazy.api.services.request;

import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ServiceRequestAmendmentRepository extends JpaRepository<ServiceRequestAmendment, UUID> {

    Optional<ServiceRequestAmendment> findByServiceRequestIdAndStatus(UUID serviceRequestId, String status);

    List<ServiceRequestAmendment> findByServiceRequestIdInAndStatus(Collection<UUID> serviceRequestIds, String status);

    List<ServiceRequestAmendment> findByServiceRequestIdAndPaymentRefNotNull(UUID serviceRequestId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from ServiceRequestAmendment a where a.serviceRequestId = :requestId and a.status = 'proposed'")
    Optional<ServiceRequestAmendment> findOpenForUpdate(@Param("requestId") UUID requestId);

    @Query("select a.serviceRequestId from ServiceRequestAmendment a where a.paymentRef = :orderId")
    Optional<UUID> findRequestIdByPaymentRef(@Param("orderId") String orderId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from ServiceRequestAmendment a where a.paymentRef = :orderId")
    Optional<ServiceRequestAmendment> findByPaymentRefForUpdate(@Param("orderId") String orderId);
}
