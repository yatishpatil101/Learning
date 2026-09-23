package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
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

/** A person looking for flatmates who has no address yet — the {@code team-up} feed (V27). One live
 * post per identity, enforced by a partial unique index; archiving frees the slot. */
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

    /** The top of the range. Null means {@link #budget} is both ends, not that there is no ceiling. */
    @Column(name = "budget_max")
    @Setter
    private Long budgetMax;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "localities", nullable = false)
    @Setter
    private List<String> localities = new ArrayList<>();

    /** Kept as the caller wrote it — the literal {@code now}, a legacy day bucket or an ISO date —
     * so a client renders back exactly what the seeker chose. */
    @Column(name = "move_in")
    @Setter
    private String moveIn;

    /** {@link #moveIn} parsed, so "within 30 days" is an index range scan rather than a per-row
     * parse. Null means now, or unparseable — both are immediately available. */
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

    /** Snapshotted rather than joined live: the badge on a card is a claim about post time, so
     * recomputing it would silently rewrite history on every read. */
    @Column(name = "verified", nullable = false)
    @Setter
    private boolean verified = false;

    @Column(name = "mod_status", nullable = false)
    @Setter
    private String modStatus = FlatmateVocabulary.MOD_PENDING;

    @Embedded
    private ModerationRecheck recheck = new ModerationRecheck();

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

    /** Backs both "Delete" and "Mark filled" — the contract gives them one operation because they
     * are the same fact about the world. */
    void archive(String reason) {
        this.archived = true;
        this.archivedAt = Instant.now();
        this.archiveReason = reason;
    }

    /** Visible on a consumer surface: neither archived nor awaiting/denied by a moderator. */
    public boolean isVisible() {
        return !archived && FlatmateVocabulary.isPublic(modStatus);
    }

    /** Never null — see {@code FlatmateRoom#getRecheck} for why the field alone is not enough. */
    public ModerationRecheck getRecheck() {
        if (recheck == null) {
            recheck = new ModerationRecheck();
        }
        return recheck;
    }
}
