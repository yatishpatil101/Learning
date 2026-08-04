package com.punenest.api.deals.deal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

/**
 * An off-platform interested party the owner jotted down while the listing is reserved.
 * Maps {@code deal_parties} (V11).
 *
 * <p>Not an {@link com.punenest.api.common.persistence.AuditedEntity}: the table uses a
 * {@code deleted_at} soft-delete column rather than the platform-wide {@code archived} triplet,
 * because this is an owner's private scratchpad, not a moderation-visible business entity.
 *
 * <p>Not a {@code users} FK — an under-offer party is a name and a mobile, with no account.
 */
@Entity
@Table(name = "deal_parties")
@Getter
public class DealParty {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "deal_id", nullable = false, updatable = false)
    private UUID dealId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "mobile")
    private String mobile;

    @Column(name = "note")
    private String note;

    @Column(name = "deleted_at")
    @Setter
    private Instant deletedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /**
     * Bookkeeping column. No caller reads it and the response has no field for it.
     */
    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    @Getter(AccessLevel.NONE)
    private Instant updatedAt;

    protected DealParty() {
        // JPA
    }

    public DealParty(UUID dealId, String name, String mobile, String note) {
        this.dealId = dealId;
        this.name = name;
        this.mobile = mobile;
        this.note = note;
    }
}
