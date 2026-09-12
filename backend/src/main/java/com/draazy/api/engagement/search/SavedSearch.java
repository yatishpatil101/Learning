package com.draazy.api.engagement.search;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

/**
 * A user's persisted search with optional alert preferences. The table has no {@code archived}
 * column — saved searches are hard-deleted (D8.9), because they are a personal preference
 * (like a shortlist toggle) rather than an auditable business record.
 *
 * <p>Extends {@link BaseEntity} (id + created_at). {@code updated_at} is mapped explicitly because
 * the table has it but there is no archived triplet to warrant extending {@code AuditedEntity}
 * without creating a misleading inheritance hierarchy.
 */
@Entity
@Table(name = "saved_searches")
@Getter
public class SavedSearch extends BaseEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "name")
    @Setter
    private String name;

    /** Nullable since V27: a flatmates alert carries {@link #criteria} instead. */
    @Column(name = "query")
    private String query;

    /**
     * Which discovery surface this alert watches.
     *
     * <p>A listings alert IS a URL query string; a flatmates alert is a structured criteria object
     * over a tab-gated filter set. Squeezing the second into {@link #query} would mean parsing a
     * query string to discover which tab an alert belongs to.
     */
    @Column(name = "kind", nullable = false)
    @Setter
    private String kind = "listings";

    /** Contract {@code FlatmateAlertCriteria}, stored whole. Required when {@link #kind} is flatmates. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "criteria", columnDefinition = "jsonb")
    @Setter
    private String criteria;

    /** Short human summary rendered on the alert card, e.g. "Move in now · Baner · Verified". */
    @Column(name = "label")
    @Setter
    private String label;

    /**
     * The signed-out lead path: an anonymous alert is keyed by mobile so it re-homes on sign-in.
     * Null for every alert created by an authenticated caller, who already has an identity.
     */
    @Column(name = "mobile")
    @Setter
    private String mobile;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "filters", nullable = false, columnDefinition = "jsonb")
    @Setter
    private String filters = "{}";

    @Column(name = "alert_frequency", nullable = false)
    @Setter
    private String alertFrequency = "daily";

    @Column(name = "channel", nullable = false)
    @Setter
    private String channel = "whatsapp";

    @Column(name = "new_count", nullable = false)
    @Setter
    private int newCount = 0;

    /**
     * When this alert last actually told its owner something. Null means it never has.
     *
     * <p><strong>Not derivable from {@link #updatedAt}, which is why it is a column.</strong> The
     * sweep writes {@code updated_at} whenever {@link #newCount} changes, and the count changes in
     * both directions — it falls back to zero on the tick after an alert fires, because the
     * baseline has moved. Measuring a "daily" cadence from {@code updated_at} would therefore
     * measure time since the last bookkeeping write rather than time since the last thing the user
     * saw, and would reset itself on a write the user was never told about.
     *
     * <p>Written by the sweep when it publishes an alert. "Published" and "delivered" are not the
     * same claim, and this column only makes the first: {@code Notifier} returns nothing, so the
     * sweep cannot learn that the master {@code matchAlerts} switch dropped the row, or that quiet
     * hours deferred it to the morning. Neither case makes the clock wrong. A user with alerts off
     * receives nothing whatever this column says, and a deferred notification has still been sent —
     * it is waiting, and sending a second one on top of it would be the bug.
     */
    @Column(name = "last_alerted_at")
    @Setter
    private Instant lastAlertedAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected SavedSearch() {}

    public SavedSearch(UUID userId, String query) {
        this.userId = userId;
        this.query = query;
    }

    /**
     * A flatmates alert: no query string, a criteria document instead.
     *
     * <p>A second constructor rather than a nullable-query one, because the two kinds genuinely
     * require different things and a single constructor would accept a row the CHECK constraint
     * then rejects at flush time — a 500 for what is really a programming error.
     */
    static SavedSearch forFlatmates(UUID userId, String criteria, String label) {
        SavedSearch entity = new SavedSearch();
        entity.userId = userId;
        entity.kind = "flatmates";
        entity.criteria = criteria;
        entity.label = label;
        return entity;
    }

}
