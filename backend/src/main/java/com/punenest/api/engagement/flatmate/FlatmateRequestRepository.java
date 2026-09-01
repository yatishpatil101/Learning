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
     *
     * <p><strong>V27's comment on that index is wrong; do not believe it</strong> (D176). It says
     * the index "is the reason the service does not check-then-insert" and that the interest
     * endpoints are "idempotent". Neither is true: this finder <em>is</em> a check-then-insert, in
     * both {@code FlatmateSeekerService.express} and {@code FlatmateSupplyService.record}, and has
     * been since V27 landed; and a second ask is <em>refused</em> with a 409, which is the opposite
     * of answering it idempotently. The index's real job is the backstop above READ COMMITTED,
     * where a pre-lock snapshot could carry a caller past this check. V27 cannot be edited in place
     * because Flyway validates checksums on every boot, so the correction lives in V54's header and
     * in a {@code COMMENT ON INDEX} that ships with the schema.
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

    /**
     * Who answered one particular ad, newest first, paged (D70).
     *
     * <p>The inbox above answers "who has written to me"; this answers "who replied to <em>this</em>
     * post", which is the question a poster looking at their own ad is actually asking. Before this
     * existed the only per-ad record was the notification the interest sent, so dismissing it lost
     * the lead while the row sat in the table.
     *
     * <p><strong>{@code hostId} is in the query and not only in the caller's check.</strong> The
     * service already refuses a post the caller does not own, so on every reachable path this
     * predicate is redundant — which is the point. The payload is a stranger's name and phone
     * number, and a second, independent narrowing means a future bug in the ownership check cannot
     * on its own return somebody else's leads. Costs nothing: {@code (kind, target_id)} are the
     * leading columns of V27's {@code uq_flatmate_requests_target_requester}, so the host is a
     * filter over rows already located by index.
     */
    Page<FlatmateRequest> findByKindAndTargetIdAndHostIdOrderByRequestedAtDesc(
            String kind, UUID targetId, UUID hostId, Pageable pageable);

    /** Host-scoped by id, so deciding somebody else's request is a 404 rather than a 403. */
    Optional<FlatmateRequest> findByIdAndHostId(UUID id, UUID hostId);

    /**
     * The requester's outbox — every ask this person sent, newest first, paged.
     *
     * <p>The mirror of {@link #findByHostIdOrderByRequestedAtDesc}, and the read that stops "I'm
     * interested" being a fact the browser remembers. The button state used to come from
     * {@code localStorage} via {@code rememberAsk}, which meant it was true on the phone that
     * pressed it and false everywhere else: same account, same post, a laptop, and the button
     * offered itself again. The row was always here; nothing could read it back.
     *
     * <p><strong>Ordered by {@code createdAt} rather than {@code requestedAt}, on purpose.</strong>
     * V27 indexed this side as {@code idx_flatmate_requests_requester (requester_id, created_at
     * DESC)} while the host side got {@code (host_id, requested_at DESC)}, so the two finders sort
     * by different columns to ride their own index. The values are set microseconds apart in the
     * same constructor, so no caller can tell the difference — but sorting this one by
     * {@code requestedAt} would drop the index's ordering and buy a sort of the whole outbox for
     * nothing. The DTO still reports {@code requestedAt}; only the ORDER BY differs.
     */
    Page<FlatmateRequest> findByRequesterIdOrderByCreatedAtDesc(UUID requesterId, Pageable pageable);

    /** The same outbox, narrowed to one verdict — "what am I still waiting on". */
    Page<FlatmateRequest> findByRequesterIdAndStatusOrderByCreatedAtDesc(
            UUID requesterId, String status, Pageable pageable);

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
