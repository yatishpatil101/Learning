package com.punenest.api.content;

import com.punenest.api.common.persistence.SoftDeleteEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An editor-curated announcement (the banner strip at the top of the app). Extends
 * {@link SoftDeleteEntity} for the soft-delete triplet.
 *
 * <p>Active window filtering: only rows where {@code active=true AND archived=false} AND
 * the current time is within [{@code starts_at}, {@code ends_at}] (null bounds mean open-ended)
 * are served to the public endpoint.
 */
@Entity
@Table(name = "announcements")
@Getter
public class AnnouncementEntity extends SoftDeleteEntity {

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "body")
    private String body;

    @Column(name = "severity")
    private String severity;

    @Column(name = "starts_at")
    private Instant startsAt;

    @Column(name = "ends_at")
    private Instant endsAt;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    /** Editor-written translations, keyed language then wire field name — see {@link FaqEntity}. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "translations", nullable = false)
    private Map<String, Map<String, String>> translations = new LinkedHashMap<>();

    protected AnnouncementEntity() {}

    /**
     * Copy the non-null fields of {@code w} onto this row.
     *
     * <p>Null means "leave alone" — see {@link ContentWrite}. Lives on the entity rather than in
     * the service so the writable surface of an announcement is stated once, next to the columns.
     */
    void apply(ContentWrite w) {
        if (w.title() != null) { this.title = w.title(); }
        if (w.body() != null) { this.body = w.body(); }
        if (w.severity() != null) { this.severity = w.severity(); }
        if (w.startsAt() != null) { this.startsAt = w.startsAt(); }
        if (w.endsAt() != null) { this.endsAt = w.endsAt(); }
        if (w.active() != null) { this.active = w.active(); }
        if (w.translations() != null) { this.translations = w.translations(); }
    }
}
