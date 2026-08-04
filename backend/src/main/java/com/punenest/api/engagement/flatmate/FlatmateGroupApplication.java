package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * A formed flatmate group applying to an owner's whole-flat rent listing (V29
 * {@code flatmate_group_applications}).
 *
 * <p>Distinct from {@link FlatmateRequest}, which is one person asking one host for one seat: here
 * the applicant is a <em>group</em> and the target is a <em>listing</em>, so both ends and the
 * direction differ.
 *
 * <p><strong>Two independent statuses.</strong> {@link #status} is the owner's decision and theirs
 * alone; {@link #modStatus} is the admin moderation axis. An admin removing a spam application must
 * not thereby decline it on the owner's behalf, and an owner declining must not hide it from
 * moderation — which is why {@link #moderate} and {@link #decide} touch different fields and are
 * called from different services.
 */
@Entity
@Table(name = "flatmate_group_applications")
@Getter
public class FlatmateGroupApplication extends AuditedEntity {

    @Column(name = "listing_id", nullable = false, updatable = false)
    private UUID listingId;

    @Column(name = "group_id", nullable = false, updatable = false)
    private UUID groupId;

    /** The group's host, denormalised so the admin list need not resolve it per row. */
    @Column(name = "applicant_id", nullable = false, updatable = false)
    private UUID applicantId;

    @Column(name = "status", nullable = false)
    private String status = FlatmateVocabulary.STATUS_PENDING;

    @Column(name = "mod_status", nullable = false)
    private String modStatus = FlatmateVocabulary.MOD_LIVE;

    /** Internal moderation note. The contract has no field for it; it is never returned. */
    @Column(name = "note")
    private String note;

    @Column(name = "decided_at")
    private Instant decidedAt;

    protected FlatmateGroupApplication() {
    }

    FlatmateGroupApplication(UUID listingId, UUID groupId, UUID applicantId) {
        this.listingId = listingId;
        this.groupId = groupId;
        this.applicantId = applicantId;
    }

    /** The owner's axis. The check constraint guarantees a timestamp travels with the decision. */
    void decide(String decision) {
        this.status = decision;
        this.decidedAt = Instant.now();
    }

    /** The admin's axis. Deliberately cannot touch {@link #status}. */
    void moderate(String newModStatus, String internalNote) {
        this.modStatus = newModStatus;
        this.note = internalNote;
    }
}
