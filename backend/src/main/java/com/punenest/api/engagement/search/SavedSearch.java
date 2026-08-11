package com.punenest.api.engagement.search;

import com.punenest.api.common.persistence.BaseEntity;
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
