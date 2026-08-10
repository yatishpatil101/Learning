package com.punenest.api.engagement.flatmate;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads over {@code flatmate_requests} (V27) — the host inbox. */
public interface FlatmateRequestRepository extends JpaRepository<FlatmateRequest, UUID> {

    /**
     * One request per (kind, target, requester). The unique index is what actually enforces this;
     * the finder is the re-read the write paths do behind their advisory lock, so a second ask is
     * refused with the contract's 409 rather than racing the index for it (D175).
     */
    Optional<FlatmateRequest> findByKindAndTargetIdAndRequesterId(
            String kind, UUID targetId, UUID requesterId);

    /**
     * The host's inbox, newest first, paged (D77).
     *
     * <p>Every row here is written by <em>somebody else</em> — a stranger answering the host's ad —
     * so the length of this list is set by how much interest the ad attracted, not by anything its
     * author did. A popular room in Kothrud collects hundreds of these and the host still only ever
     * reads the top of the pile. Both finders ride V27's {@code idx_flatmate_requests_host} and V49's
     * {@code idx_flatmate_requests_host_status_requested}, so page one costs the same at ten rows
     * and at ten thousand.
     */
    Page<FlatmateRequest> findByHostIdOrderByRequestedAtDesc(UUID hostId, Pageable pageable);

    Page<FlatmateRequest> findByHostIdAndStatusOrderByRequestedAtDesc(
            UUID hostId, String status, Pageable pageable);

    /** Host-scoped by id, so deciding somebody else's request is a 404 rather than a 403. */
    Optional<FlatmateRequest> findByIdAndHostId(UUID id, UUID hostId);

    /**
     * Backs the per-sender rate limit.
     *
     * <p>Counted over a window rather than for all time because an interest is <em>delivered</em>:
     * each one puts a stranger's number in front of a different person. That is a broadcast
     * channel, and the only meaningful question about a broadcast channel is how fast it runs.
     */
    long countByRequesterIdAndCreatedAtAfter(UUID requesterId, Instant since);

    /** Seats already taken on one group, for the full-group check. */
    long countByKindAndTargetIdAndStatus(String kind, UUID targetId, String status);
}
