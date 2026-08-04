package com.punenest.api.billing.referral;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * One user's shareable referral code. Maps {@code referral_codes} (V23).
 *
 * <p><strong>Why this table exists at all.</strong> {@code ReferralSummary.code} and the body of
 * {@code redeemReferral} are the same string, and it existed nowhere in the schema — two contract
 * operations depended on a value the database could not store.
 *
 * <p><strong>Why its own table rather than a column on {@code users}.</strong> The code is a growth
 * concern with no meaning to identity, and having billing write into identity's aggregate is the
 * cross-context coupling the layering test exists to discourage.
 *
 * <p>Not a {@code BaseEntity}: the primary key <em>is</em> the user id. One code per user, forever —
 * rotating it would break every card and forwarded message already carrying the old one.
 */
@Entity
@Table(name = "referral_codes")
@Getter
public class ReferralCode {

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "code", nullable = false, updatable = false)
    private String code;

    /**
     * Bookkeeping column. No caller reads it and the response has no field for it.
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    @Getter(AccessLevel.NONE)
    private Instant createdAt;

    /**
     * Bookkeeping column. No caller reads it and the response has no field for it.
     */
    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    @Getter(AccessLevel.NONE)
    private Instant updatedAt;

    protected ReferralCode() {
        // JPA
    }

    ReferralCode(UUID userId, String code) {
        this.userId = userId;
        this.code = code;
    }
}
