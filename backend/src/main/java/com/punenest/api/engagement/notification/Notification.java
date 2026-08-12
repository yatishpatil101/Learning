package com.punenest.api.engagement.notification;

import com.punenest.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.Setter;

/**
 * A user notification — a server-generated message in the caller's inbox.
 *
 * <p>Extends {@link BaseEntity} (id + created_at). No updated_at needed — the only in-place mutation
 * is the {@code read} flag, which does not merit audit timestamps; the only other change is a
 * dismiss, which hard-deletes the row (there is nothing to time-stamp about a row that is gone).
 *
 * <p><strong>The constructor is package-private, and that is a guard rather than tidiness.</strong>
 * Delivery rules — quiet-hours deferral and the master alert switch — live in
 * {@link NotificationPublisher}, and they are only worth anything if there is no second way to
 * write a row. There used to be: five sites in {@code engagement.flatmate} built notifications
 * directly, in the same package tree, so no architecture rule caught them and a flatmate request at
 * 03:00 arrived at 03:00 long after quiet hours were supposed to exist. They now go through
 * {@link com.punenest.api.common.trust.Notifier} like everything else, and this keeps it that way:
 * the sixth site cannot compile.
 */
@Entity
@Table(name = "notifications")
@Getter
public class Notification extends BaseEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "type")
    private String type;

    @Column(name = "title")
    private String title;

    @Column(name = "body")
    private String body;

    @Column(name = "read", nullable = false)
    @Setter
    private boolean read = false;

    @Column(name = "link")
    @Setter(AccessLevel.PACKAGE)
    private String link;

    /**
     * The instant this becomes visible in the inbox, or {@code null} for "now" (V73).
     *
     * <p>Set only when the notification was written inside the recipient's quiet-hours window, to
     * the moment that window closes. The row exists and is complete from the instant it is written
     * — {@code createdAt} records when the thing actually happened — and this defers only when the
     * user is shown it. See {@link NotificationPublisher} for why deferral rather than suppression,
     * and {@link NotificationService#list} for the read that honours it.
     */
    @Column(name = "deliver_after")
    @Setter(AccessLevel.PACKAGE)
    private Instant deliverAfter;

    protected Notification() {}

    Notification(UUID userId, String type, String title, String body) {
        this.userId = userId;
        this.type = type;
        this.title = title;
        this.body = body;
    }

}
