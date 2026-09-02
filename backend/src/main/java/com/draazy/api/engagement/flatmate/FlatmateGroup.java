package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * People teaming up (V27 {@code flatmate_groups}).
 *
 * <p><strong>The address is nullable because "we have a flat" is a state a group passes through,
 * not a different kind of group.</strong> A group holding an address sorts into the {@code move-in}
 * tab, one still hunting into {@code team-up} — the same row moves between tabs as the group's
 * search progresses. Two tables would have meant deleting a group and recreating it the day it
 * signed a lease, losing its members and its history at exactly the moment they became real.
 *
 * <p>{@link #seatsOpen} is not {@code seatsTotal - members.size()}, and that is the whole reason it
 * is stored. A sitting tenant backfilling one seat of a full four-person flat has one seat open and
 * four members; deriving it would advertise three seats that do not exist.
 */
@Entity
@Table(name = "flatmate_groups")
@Getter
public class FlatmateGroup extends AuditedEntity {

    @Column(name = "host_id", nullable = false, updatable = false)
    private UUID hostId;

    @Column(name = "title", nullable = false)
    @Setter
    private String title;

    @Column(name = "locality", nullable = false)
    @Setter
    private String locality;

    /** {@code any} means open-join: a request against it is auto-accepted rather than queued. */
    @Column(name = "policy", nullable = false)
    @Setter
    private String policy = FlatmateVocabulary.POLICY_OPEN;

    /** Whole-flat rent. Per-head is computed on read so it can never drift from this. */
    @Column(name = "rent", nullable = false)
    @Setter
    private Long rent;

    @Column(name = "seats_total", nullable = false)
    @Setter
    private int seatsTotal = 2;

    @Column(name = "seats_open")
    @Setter
    private Integer seatsOpen;

    @Column(name = "property_id")
    @Setter
    private UUID propertyId;

    @Column(name = "host_role", nullable = false)
    @Setter
    private String hostRole = "tenant";

    @Column(name = "verification_tier", nullable = false)
    @Setter
    private String verificationTier = FlatmateVocabulary.TIER_IDENTITY;

    @Column(name = "agreement_declared", nullable = false)
    @Setter
    private boolean agreementDeclared = false;

    /**
     * True only once the flat's owner confirmed by OTP. Never client-asserted: the entire value of
     * the record is that the owner themselves acted, so a boolean in a request body would be worth
     * exactly nothing.
     */
    @Column(name = "owner_consent", nullable = false)
    @Setter
    private boolean ownerConsent = false;

    @Column(name = "owner_consent_mobile")
    @Setter
    private String ownerConsentMobile;

    @Column(name = "address_fingerprint")
    @Setter
    private String addressFingerprint;

    @Column(name = "flag_for_review", nullable = false)
    @Setter
    private boolean flagForReview = false;

    @Column(name = "mod_status", nullable = false)
    @Setter
    private String modStatus = FlatmateVocabulary.MOD_PENDING;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", nullable = false)
    @Setter
    private List<String> tags = new ArrayList<>();

    @Column(name = "note")
    @Setter
    private String note;

    @Column(name = "archived", nullable = false)
    private boolean archived = false;

    @Column(name = "archived_at")
    private Instant archivedAt;

    @Column(name = "archive_reason")
    private String archiveReason;

    /**
     * Members, owned by the group. Cascaded and orphan-removing because a member has no meaning
     * outside the group it belongs to — this is a genuine composition, not an association.
     */
    @OneToMany(mappedBy = "group", cascade = CascadeType.ALL, orphanRemoval = true,
            fetch = FetchType.LAZY)
    @OrderBy("createdAt asc")
    private List<FlatmateGroupMember> members = new ArrayList<>();

    protected FlatmateGroup() {
    }

    FlatmateGroup(UUID hostId, String title, String locality, Long rent) {
        this.hostId = hostId;
        this.title = title;
        this.locality = locality;
        this.rent = rent;
    }

    /** Add a member, keeping both sides of the association consistent. */
    void addMember(FlatmateGroupMember member) {
        member.attachTo(this);
        this.members.add(member);
    }

    void archive(String reason) {
        this.archived = true;
        this.archivedAt = Instant.now();
        this.archiveReason = reason;
    }

    public boolean isVisible() {
        return !archived && FlatmateVocabulary.isPublic(modStatus);
    }

    /**
     * A group that already holds an address belongs in {@code move-in} rather than {@code team-up}.
     * A parent listing is the only way a group expresses an address — a group naming a society it
     * has no listing for is a claim, and claims do not move a post into the "real places" tab.
     */
    public boolean hasAddress() {
        return propertyId != null;
    }

    /**
     * Seats genuinely open. Falls back to {@code seatsTotal - members} for legacy rows that predate
     * the explicit column, which is the best answer available for them and the correct one for a
     * group that was never backfilled.
     */
    public int openSeats() {
        if (seatsOpen != null) {
            return Math.max(0, Math.min(seatsTotal, seatsOpen));
        }
        return Math.max(0, seatsTotal - members.size());
    }
}
