package com.draazy.api.engagement.notification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/** Natural key: a user has exactly one preferences row, and missing rows mean defaults. */
@Entity
@Table(name = "notification_preferences")
@Getter
public class NotificationPreference {

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "email", nullable = false)
    private boolean email = true;

    @Column(name = "sms", nullable = false)
    private boolean sms = false;

    @Column(name = "whatsapp", nullable = false)
    private boolean whatsapp = true;

    @Column(name = "match_alerts", nullable = false)
    private boolean matchAlerts = true;

    @Column(name = "quiet_hours_enabled", nullable = false)
    private boolean quietHoursEnabled = false;

    @Column(name = "quiet_start", nullable = false)
    private String quietStart = "22:00";

    @Column(name = "quiet_end", nullable = false)
    private String quietEnd = "07:00";

    @Column(name = "language", nullable = false)
    private String language = "en";

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected NotificationPreference() {
        // JPA
    }

    public NotificationPreference(UUID userId) {
        this.userId = userId;
    }

    /** Whole-document write because the endpoint is a {@code PUT}. */
    void replace(boolean email, boolean sms, boolean whatsapp, boolean matchAlerts,
            boolean quietHoursEnabled, String quietStart, String quietEnd, String language) {
        this.email = email;
        this.sms = sms;
        this.whatsapp = whatsapp;
        this.matchAlerts = matchAlerts;
        this.quietHoursEnabled = quietHoursEnabled;
        this.quietStart = quietStart;
        this.quietEnd = quietEnd;
        this.language = language;
    }
}
