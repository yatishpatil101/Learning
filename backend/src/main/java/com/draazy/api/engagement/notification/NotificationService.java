package com.draazy.api.engagement.notification;

import com.draazy.api.common.error.NotFoundException;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** All queries are strictly caller-scoped — user A can never read or mark user B's notifications.
 * Passing another user's notification ids to the mark-read operation has no effect (invariant 2). */
@Service
public class NotificationService {

    public static final Duration READ_VISIBILITY = Duration.ofDays(30);

    private final NotificationRepository repo;
    private final NotificationMapper mapper;

    public NotificationService(NotificationRepository repo, NotificationMapper mapper) {
        this.repo = repo;
        this.mapper = mapper;
    }

    /** Deferred quiet-hours rows stay hidden only until their delivery instant. */
    @Transactional(readOnly = true)
    public Page<NotificationResponse> list(UUID userId, Pageable pageable) {
        Pageable sorted = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        Instant now = Instant.now();
        return repo.findDeliverable(userId, now, now.minus(READ_VISIBILITY), sorted)
                .map(mapper::toResponse);
    }

    @Transactional(readOnly = true)
    public long unreadCount(UUID userId) {
        return repo.countUnreadDeliverable(userId, Instant.now());
    }

    /** Empty ids means all visible caller rows; deferred rows must not be consumed unseen. */
    @Transactional
    public void markRead(UUID userId, Collection<UUID> ids) {
        Instant now = Instant.now();
        if (ids == null || ids.isEmpty()) {
            repo.markAllRead(userId, now);
        } else {
            repo.markRead(userId, ids, now);
        }
    }

    /** Foreign ids return 404, and dismiss hard-deletes because only the inbox reads the row. */
    @Transactional
    public void dismiss(UUID userId, UUID id) {
        Notification entity = repo.findByIdAndUserId(id, userId)
                .orElseThrow(() -> NotFoundException.of("Notification"));
        repo.delete(entity);
    }
}
