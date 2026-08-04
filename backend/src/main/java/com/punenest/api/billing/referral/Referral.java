package com.punenest.api.billing.referral;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;

/**
 * One redeemed referral and the anti-fraud signals a checker decides on. Maps {@code referrals}
 * (V7, extended by V23).
 *
 * <p><strong>The reward is two fields, not one.</strong> {@code reward} is the human label the
 * referrer was promised ("+15 owner contacts"); {@code rewardAmount} is what it costs in rupees.
 * Before spec fix S54 only the label existed, so {@code ReferralSummary.rewardsEarned} — declared as
 * {@code Money} — had nothing to add up and a checker was asked to approve a payout without being
 * shown its size.
 *
 * <p><strong>The reward amount is frozen at redemption.</strong> It is copied onto the row rather
 * than read from settings when the summary is computed, so changing the offer never rewrites what
 * people were already promised.
 *
 * <p><strong>{@code sameDevice} and {@code sameIp} are always false today.</strong> The platform
 * captures neither a device fingerprint nor the request IP, so these two signals cannot be computed
 * honestly and are left at their default rather than filled with a guess. A fraud signal that is
 * wrong is worse than one that is absent: a checker who trusts it stops looking.
 */
@Entity
@Table(name = "referrals")
@Getter
public class Referral extends AuditedEntity {

    @Column(name = "referrer_id", updatable = false)
    private UUID referrerId;

    @Column(name = "referrer_mobile", updatable = false)
    private String referrerMobile;

    @Column(name = "referred", updatable = false)
    private String referred;

    @Column(name = "referred_mobile", updatable = false)
    private String referredMobile;

    @Column(name = "channel", updatable = false)
    private String channel;

    /** The human label. See the class Javadoc. */
    @Column(name = "reward", updatable = false)
    private String reward;

    /** What the label costs, whole rupees. Frozen at redemption. */
    @Column(name = "reward_amount", nullable = false, updatable = false)
    private long rewardAmount;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "risk", updatable = false)
    private String risk;

    @Column(name = "aadhaar_verified", nullable = false, updatable = false)
    private boolean aadhaarVerified;

    @Column(name = "aadhaar_unique", nullable = false, updatable = false)
    private boolean aadhaarUnique;

    @Column(name = "same_device", nullable = false, updatable = false)
    private boolean sameDevice;

    @Column(name = "same_ip", nullable = false, updatable = false)
    private boolean sameIp;

    @Column(name = "velocity_high", nullable = false, updatable = false)
    private boolean velocityHigh;

    @Column(name = "activated", nullable = false, updatable = false)
    private boolean activated;

    @Column(name = "at", nullable = false, updatable = false)
    private Instant at;

    @Column(name = "handled_by")
    private String handledBy;

    @Column(name = "handled_at")
    private Instant handledAt;

    /**
     * Written by the fraud desk and read only through the moderation query that needs it; not part
     * of the referral a user can see.
     */
    @Column(name = "handled_reason")
    @Getter(AccessLevel.NONE)
    private String handledReason;

    protected Referral() {
        // JPA
    }

    Referral(UUID referrerId, String referrerMobile, String referred, String referredMobile,
            String channel, String reward, long rewardAmount, String risk, boolean aadhaarVerified,
            boolean aadhaarUnique, boolean velocityHigh) {
        this.referrerId = referrerId;
        this.referrerMobile = referrerMobile;
        this.referred = referred;
        this.referredMobile = referredMobile;
        this.channel = channel;
        this.reward = reward;
        this.rewardAmount = rewardAmount;
        this.status = ReferralStatuses.PENDING;
        this.risk = risk;
        this.aadhaarVerified = aadhaarVerified;
        this.aadhaarUnique = aadhaarUnique;
        this.velocityHigh = velocityHigh;
        this.at = Instant.now();
    }

    /**
     * Move to a decided state, stamping who decided, when, and why.
     *
     * <p>The transition table is enforced by the caller ({@link ReferralService}) rather than here
     * so that a refused move can be turned into the right HTTP status; this method only records.
     */
    void decide(String nextStatus, String handler, String reason) {
        this.status = nextStatus;
        this.handledBy = handler;
        this.handledAt = Instant.now();
        this.handledReason = reason;
    }
}
