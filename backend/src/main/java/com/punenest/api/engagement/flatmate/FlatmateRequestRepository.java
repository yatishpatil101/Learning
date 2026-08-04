package com.punenest.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads over {@code flatmate_requests} (V27) — the host inbox. */
public interface FlatmateRequestRepository extends JpaRepository<FlatmateRequest, UUID> {

    /**
     * One request per (kind, target, requester). The unique index is what actually enforces this;
     * the finder exists so a resend can rewrite the message instead of colliding.
     */
    Optional<FlatmateRequest> findByKindAndTargetIdAndRequesterId(
            String kind, UUID targetId, UUID requesterId);

    /** The host's inbox, newest first. */
    List<FlatmateRequest> findByHostIdOrderByRequestedAtDesc(UUID hostId);

    List<FlatmateRequest> findByHostIdAndStatusOrderByRequestedAtDesc(UUID hostId, String status);

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
