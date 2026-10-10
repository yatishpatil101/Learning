package com.draazy.api.identity.user.erasure;

import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Erasure requests. Backed by the two indexes V56 declares. */
public interface ErasureRequestRepository extends JpaRepository<ErasureRequest, UUID> {

    /** Only ever finds a pending row: a completed request carries no subject id, by design. */
    Optional<ErasureRequest> findBySubjectIdAndStatus(UUID subjectId, String status);

    /** Every request the subject has ever filed that still names them — pending, or rejected. */
    Page<ErasureRequest> findBySubjectIdOrderByRequestedAtDesc(UUID subjectId, Pageable pageable);

    /** The admin queue, newest first. */
    Page<ErasureRequest> findAllByOrderByRequestedAtDesc(Pageable pageable);

    /** The admin queue narrowed to one state, newest first. */
    Page<ErasureRequest> findByStatusOrderByRequestedAtDesc(String status, Pageable pageable);

    /** Row-locked so a second concurrent decision waits, then sees the first's outcome and gets the 409. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from ErasureRequest r where r.id = :id")
    Optional<ErasureRequest> findForDecision(@Param("id") UUID id);
}
