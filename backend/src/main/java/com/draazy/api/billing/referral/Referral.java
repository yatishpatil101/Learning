package com.draazy.api.billing.referral;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;

/**
 * One redeemed referral and the anti-fraud signals a checker decides on. Maps {@code referrals}
 * (V7, extended by V23). Rationale: docs/flows/ops/referrals-fraud.md.
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

    /**
     * How the link reached the referee (voice-passed codes report null). Distinct from
     * {@link #channel}, which records which side of the marketplace they joined on.
     */
    @Column(name = "share_channel", updatable = false)
    private String shareChannel;

    /** The human label. See the class Javadoc. */
    @Column(name = "reward", updatable = false)
    private String reward;

    /** How many the label is worth — owner contacts since D31b, rupees on older decided rows. */
    @Column(name = "reward_amount", nullable = false, updatable = false)
    private long rewardAmount;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "risk", updatable = false)
    private String risk;

    @Column(name = "identity_verified", nullable = false, updatable = false)
    private boolean identityVerified;

    @Column(name = "identity_unique", nullable = false, updatable = false)
    private boolean identityUnique;

    @Column(name = "same_device", nullable = false, updatable = false)
    private boolean sameDevice;

    @Column(name = "same_ip", nullable = false, updatable = false)
    private boolean sameIp;

    @Column(name = "velocity_high", nullable = false, updatable = false)
    private boolean velocityHigh;

    /**
     * Whether the referee has done something real on the platform.
     * Moves together with {@code status} in {@link #qualify} so the desk never sees a contradiction.
     */
    @Column(name = "activated", nullable = false)
    private boolean activated;

    @Column(name = "at", nullable = false, updatable = false)
    private Instant at;

    /** When the referee's first listing cleared the ownership gate. Null until it does. */
    @Column(name = "qualified_at")
    private Instant qualifiedAt;

    /**
     * Which listing cleared it. Evidence rather than an association — no foreign key, so a listing
     * that is later withdrawn neither erases the reason a credit was granted nor is blocked by it.
     */
    @Column(name = "qualified_property_id")
    private UUID qualifiedPropertyId;

    /**
     * Salted digest of the referee's address. Personal data, no getter so it never reaches a DTO.
     * Rationale: docs/flows/ops/referrals-fraud.md.
     */
    @Column(name = "referred_ip_hash")
    @Getter(AccessLevel.NONE)
    private String referredIpHash;

    /** Salted digest of the referee's User-Agent. Personal data, no getter; see {@link #referredIpHash}. */
    @Column(name = "referred_device_hash")
    @Getter(AccessLevel.NONE)
    private String referredDeviceHash;

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
            String channel, String shareChannel, String reward, long rewardAmount, String risk,
            boolean identityVerified, boolean identityUnique, boolean velocityHigh,
            boolean sameDevice, boolean sameIp, ReferralSignals.Signals signals) {
        this.referrerId = referrerId;
        this.referrerMobile = referrerMobile;
        this.referred = referred;
        this.referredMobile = referredMobile;
        this.channel = channel;
        this.shareChannel = shareChannel;
        this.reward = reward;
        this.rewardAmount = rewardAmount;
        this.status = ReferralStatuses.PENDING;
        this.risk = risk;
        this.identityVerified = identityVerified;
        this.identityUnique = identityUnique;
        this.sameDevice = sameDevice;
        this.sameIp = sameIp;
        this.velocityHigh = velocityHigh;
        this.referredIpHash = signals.ipHash();
        this.referredDeviceHash = signals.deviceHash();
        this.at = Instant.now();
    }

    /**
     * Record that the referee's first listing cleared ownership (Q17). Returns whether anything
     * changed; that return value is the idempotency. Rationale: docs/flows/ops/referrals-fraud.md.
     */
    boolean qualify(UUID propertyId, Instant verifiedAt) {
        if (this.qualifiedAt != null || !ReferralStatuses.PENDING.equals(this.status)) {
            return false;
        }
        this.status = ReferralStatuses.QUALIFIED;
        this.qualifiedAt = verifiedAt;
        this.qualifiedPropertyId = propertyId;
        this.activated = true;
        return true;
    }

    /**
     * Stamp a decided state; caller ({@link ReferralService}) enforces the transition table so a
     * refused move can carry the right HTTP status.
     */
    void decide(String nextStatus, String handler, String reason) {
        this.status = nextStatus;
        this.handledBy = handler;
        this.handledAt = Instant.now();
        this.handledReason = reason;
    }
}
