package com.punenest.api.engagement.notification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * One user's notification and communication preferences. Maps {@code notification_preferences}
 * (V73).
 *
 * <p><strong>Natural key, no surrogate id</strong> — the same reasoning {@code identity.kyc.OwnerKyc}
 * gives: a user has exactly one set of preferences, so V73 makes {@code user_id} the primary key.
 * A surrogate id would permit two rows and with them the question "which of these is in force?",
 * which nothing in the product can answer. The contract agrees: {@code GET/PUT
 * /me/notification-preferences} is singular and carries no id.
 *
 * <p><strong>There is deliberately no row for most users, and that is not a gap.</strong> A user who
 * has never opened Settings has no row here, and {@link NotificationPreferenceService#effective}
 * resolves that to {@link NotificationPreferenceService#DEFAULTS} — the same values the browser has
 * always defaulted to. Absent must never read as "everything off"; see the migration for why that
 * distinction is the difference between a preference and an outage.
 *
 * <p><strong>The quiet window is stored as it is typed.</strong> {@code quietStart}/{@code quietEnd}
 * are {@code HH:mm} wall-clock labels with no date and no zone, matching what {@code <input
 * type="time">} produces and what the browser has always persisted. V73's CHECK constraints do the
 * validating a {@code time} column would have done, without changing the shape on the wire.
 * {@link QuietHours} is the only place that interprets them.
 */
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

    /**
     * Replace every preference at once.
     *
     * <p><strong>A whole-document write, not a patch</strong>, because the endpoint is a
     * {@code PUT}: the client sends the complete settings screen and the server stores it. There is
     * no per-field setter for the same reason there is no {@code PATCH} — a partial write over a
     * screen where every control is visible at once invites two tabs to disagree about which fields
     * the second one meant to leave alone.
     */
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
