package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A person looking for flatmates who has no address yet — the {@code team-up} feed (V27
 * {@code flatmate_seeker_posts}).
 *
 * <p><strong>What is published here is a person, not a place</strong>, and every difference from
 * {@link com.punenest.api.catalog.property.Property} follows from that. There is no address to
 * moderate, no owner to verify, nothing to visit and no price to negotiate — only a budget, a
 * shortlist of localities and a description of how someone lives. It is also why
 * {@link #verifiedContactOnly} exists at all: on a listing the thing being protected is a phone
 * number, here it is the person themselves.
 *
 * <p>One live post per identity, enforced by a partial unique index rather than by a service check.
 * Archiving frees the slot, so somebody who found a flat last year and is looking again is not
 * blocked by their own history.
 */
@Entity
@Table(name = "flatmate_seeker_posts")
@Getter
public class FlatmateSeekerPost extends AuditedEntity {

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "name", nullable = false)
    @Setter
    private String name;

    @Column(name = "gender", nullable = false)
    @Setter
    private String gender = "any";

    @Column(name = "age")
    @Setter
    private Integer age;

    @Column(name = "occupation")
    @Setter
    private String occupation;

    @Column(name = "budget", nullable = false)
    @Setter
    private Long budget;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "localities", nullable = false)
    @Setter
    private List<String> localities = new ArrayList<>();

    /**
     * The literal {@code now}, a legacy day bucket ({@code 15}/{@code 30}/{@code 60}) or an ISO
     * date. Kept as the caller wrote it so a client renders back exactly what the seeker chose.
     */
    @Column(name = "move_in")
    @Setter
    private String moveIn;

    /**
     * {@link #moveIn} parsed to a date, so "available within 30 days" is an index range scan rather
     * than a string parse per row. Null means now, or unparseable — both are immediately available.
     */
    @Column(name = "move_in_at")
    @Setter
    private LocalDate moveInAt;

    @Column(name = "flat_pref", nullable = false)
    @Setter
    private String flatPref = "any";

    @Column(name = "room_pref", nullable = false)
    @Setter
    private String roomPref = "any";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", nullable = false)
    @Setter
    private List<String> tags = new ArrayList<>();

    @Column(name = "note")
    @Setter
    private String note;

    /** The seeker's half of ADR-019: only badged callers may express interest. Opt-in, never default. */
    @Column(name = "verified_contact_only", nullable = false)
    @Setter
    private boolean verifiedContactOnly = false;

    /**
     * The seeker's L2 badge as it stood when the post was written (ADR-009a). Snapshotted rather
     * than joined live, because the badge on a card is a claim about post time — recomputing it
     * would silently rewrite history on every read.
     */
    @Column(name = "verified", nullable = false)
    @Setter
    private boolean verified = false;

    @Column(name = "mod_status", nullable = false)
    @Setter
    private String modStatus = FlatmateVocabulary.MOD_LIVE;

    @Column(name = "lat")
    @Setter
    private Double lat;

    @Column(name = "lng")
    @Setter
    private Double lng;

    @Column(name = "archived", nullable = false)
    private boolean archived = false;

    @Column(name = "archived_at")
    private Instant archivedAt;

    @Column(name = "archive_reason")
    private String archiveReason;

    protected FlatmateSeekerPost() {
    }

    FlatmateSeekerPost(UUID userId, String name, Long budget) {
        this.userId = userId;
        this.name = name;
        this.budget = budget;
    }

    /**
     * Soft-delete. Backs both "Delete" and "Mark filled" — the contract gives them one operation
     * because they are the same fact about the world, differing only in how the seeker feels.
     */
    void archive(String reason) {
        this.archived = true;
        this.archivedAt = Instant.now();
        this.archiveReason = reason;
    }

    /** Visible on a consumer surface: neither archived nor hidden by a moderator. */
    public boolean isVisible() {
        return !archived && !FlatmateVocabulary.MOD_HIDDEN.contains(modStatus);
    }
}
