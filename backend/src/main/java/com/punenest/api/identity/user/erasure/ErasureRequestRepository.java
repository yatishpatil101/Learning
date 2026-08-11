package com.punenest.api.identity.user.erasure;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Erasure requests. Backed by the two indexes V56 declares. */
public interface ErasureRequestRepository extends JpaRepository<ErasureRequest, UUID> {

    /**
     * The subject's own live request, if they have one.
     *
     * <p>Only ever finds a pending row, because a completed one no longer carries a subject id at
     * all — which is the design, not a limitation of this finder. A subject asking "what happened to
     * my request" after it completed has no account left to ask from.
     */
    Optional<ErasureRequest> findBySubjectIdAndStatus(UUID subjectId, String status);

    /** Every request the subject has ever filed that still names them — pending, or rejected. */
    Page<ErasureRequest> findBySubjectIdOrderByRequestedAtDesc(UUID subjectId, Pageable pageable);

    /** The admin queue, newest first. */
    Page<ErasureRequest> findAllByOrderByRequestedAtDesc(Pageable pageable);

    /** The admin queue narrowed to one state, newest first. */
    Page<ErasureRequest> findByStatusOrderByRequestedAtDesc(String status, Pageable pageable);
}
