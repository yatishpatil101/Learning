package com.punenest.api.engagement.notification;

import java.util.Collection;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Notification reads and mark-read. All queries are strictly caller-scoped — user A can never
 * read or mark user B's notifications. Passing another user's notification ids to the mark-read
 * operation has no effect (invariant 2).
 */
@Service
public class NotificationService {

    private final NotificationRepository repo;
    private final NotificationMapper mapper;

    public NotificationService(NotificationRepository repo, NotificationMapper mapper) {
        this.repo = repo;
        this.mapper = mapper;
    }

    /**
     * Paged notifications, newest first. The sort is fixed server-side (contract does not expose
     * a sort parameter), so client-supplied sort is stripped before reaching the query.
     */
    @Transactional(readOnly = true)
    public Page<NotificationResponse> list(UUID userId, Pageable pageable) {
        Pageable sorted = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        return repo.findByUserId(userId, sorted).map(mapper::toResponse);
    }

    /**
     * Mark notifications read. If ids is null/empty, marks ALL of the caller's unread notifications.
     * Only ever touches the caller's own rows (invariant 2, 3).
     */
    @Transactional
    public void markRead(UUID userId, Collection<UUID> ids) {
        if (ids == null || ids.isEmpty()) {
            repo.markAllRead(userId);
        } else {
            repo.markRead(userId, ids);
        }
    }
}
