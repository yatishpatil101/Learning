package com.punenest.api.engagement.notification;

import com.punenest.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A user notification — a server-generated message in the caller's inbox. Notifications are never
 * deleted, only marked read.
 *
 * <p>Extends {@link BaseEntity} (id + created_at). No updated_at needed — the only mutation is
 * the {@code read} flag, which does not merit audit timestamps.
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
    @Setter
    private String link;

    protected Notification() {}

    public Notification(UUID userId, String type, String title, String body) {
        this.userId = userId;
        this.type = type;
        this.title = title;
        this.body = body;
    }

}
