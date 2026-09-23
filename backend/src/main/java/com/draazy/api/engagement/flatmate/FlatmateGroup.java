package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
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

/** People teaming up ({@code flatmate_groups}). The address is nullable because "we have a flat" is
 * a state a group passes through, not a kind — column reasoning: docs/system/data-model.md. */
@Entity
@Table(name = "flatmate_groups")
@Getter
public class FlatmateGroup extends AuditedEntity implements FlatmateSupplyPost {

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

    /** Whole-flat rent. Per-head is {@link #perHead}, generated from this so it cannot drift. */
    @Column(name = "rent", nullable = false)
    @Setter
    private Long rent;

    @Column(name = "deposit")
    @Setter
    private Long deposit;

    /** Null means the host did not state it, which is not the same as a term of zero. */
    @Column(name = "notice_period_days")
    @Setter
    private Integer noticePeriodDays;

    @Column(name = "lock_in_months")
    @Setter
    private Integer lockInMonths;

    @Column(name = "maintenance_billing")
    @Setter
    private String maintenanceBilling;

    @Column(name = "electricity_billing")
    @Setter
    private String electricityBilling;

    @Column(name = "seats_total", nullable = false)
    @Setter
    private int seatsTotal = 2;

    /** {@code round(rent / seatsTotal)}, maintained by the database and read-only here — a second
     * writer would be a second answer to the only price a member sees. */
    @Column(name = "per_head", insertable = false, updatable = false)
    private Long perHead;

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

    /** True only once the flat's owner confirmed by OTP. Never client-asserted: the entire value of
     * the record is that the owner themselves acted. */
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

    @Embedded
    private ModerationRecheck recheck = new ModerationRecheck();

    /** Null means <em>unknown</em>, never {@code 0} — (0,0) is open ocean; radius search excludes
     * null instead. */
    @Column(name = "lat")
    @Setter
    private Double lat;

    /** @see #lat */
    @Column(name = "lng")
    @Setter
    private Double lng;

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

    /** Cascaded and orphan-removing because a member has no meaning outside its group — a genuine
     * composition, not an association. */
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

    /** Never null — see {@code FlatmateRoom#getRecheck} for why the field alone is not enough. */
    public ModerationRecheck getRecheck() {
        if (recheck == null) {
            recheck = new ModerationRecheck();
        }
        return recheck;
    }

    /** A parent listing is the only way a group can express an address — naming a society it has no
     * listing for is a claim, not a place. */
    public boolean hasAddress() {
        return propertyId != null;
    }

    /** Falls back to {@code seatsTotal - members} for legacy rows predating the explicit column,
     * which is the best answer available for them. */
    public int openSeats() {
        if (seatsOpen != null) {
            return Math.max(0, Math.min(seatsTotal, seatsOpen));
        }
        return Math.max(0, seatsTotal - members.size());
    }
}
