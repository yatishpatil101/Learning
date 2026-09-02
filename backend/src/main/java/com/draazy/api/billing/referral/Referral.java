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
 * (V7, extended by V23).
 *
 * <p><strong>The reward is two fields, not one.</strong> {@code reward} is the human label the
 * referrer was promised ("+15 owner contacts") and {@code rewardAmount} is its magnitude (15).
 * Before spec fix S54 only the label existed, so the summary had nothing to add up and a checker was
 * asked to approve a grant without being shown its size.
 *
 * <p><strong>The unit is owner contacts, and it used to be rupees (D31b).</strong> The label always
 * said contacts — so did the API contract — while {@code rewardAmount} counted a ₹500 credit that no
 * screen displayed and nothing could spend. V91 restated the undecided rows and left the decided
 * ones alone, because a {@code rewarded} row records what a person actually released at the time and
 * is not ours to re-denominate after the fact. That is why {@link #reward} is free text and not an
 * enum: the column has to be able to hold two eras of the offer at once.
 *
 * <p><strong>The reward amount is frozen at redemption.</strong> It is copied onto the row rather
 * than read from settings when the summary is computed, so changing the offer never rewrites what
 * people were already promised.
 *
 * <p><strong>{@code sameDevice} and {@code sameIp} are computed at redemption (D55, V64).</strong>
 * They were {@code false} on every row for as long as the platform captured neither side of the
 * comparison; it now stores a salted digest of the referee's address and User-Agent here, and of the
 * referrer's on their {@link ReferralCode}, and compares the two. The old rule still governs the
 * gaps: a code minted before V64, or a request that carried no {@code User-Agent}, produces no
 * digest and the signal stays {@code false}. A fraud signal that is wrong is worse than one that is
 * absent, because a checker who trusts it stops looking.
 *
 * <p><strong>The two digests are personal data with a ninety-day life.</strong> Their purpose is
 * referral fraud detection and nothing else, they are never on the wire, and
 * {@link ReferralSignalRetention} blanks them once the row passes the window. The <em>findings</em>
 * outlive the evidence — {@code sameDevice} and {@code sameIp} stay, the same way
 * {@code aadhaarVerified} records an outcome rather than a number.
 *
 * <p><strong>{@code qualifiedAt} is the one thing that mints a credit without a human (Q17).</strong>
 * It moves from null exactly once, when the referred party's <em>first</em> listing passes ownership
 * verification. Because it can only move once on a row, and {@code uq_referrals_referred_mobile}
 * admits one row per referred mobile, "one credit per referee, ever" needs no further constraint.
 * Since D31b it is also the moment the grant becomes spendable, so this field is now load-bearing
 * for an entitlement and not only for a checker's confidence.
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
     * How the link reached the referee, as reported at redemption. Null when unknown, which
     * includes every code passed on by voice — see {@link ShareChannels}. Distinct from
     * {@link #channel}, which records which side of the marketplace the referred party joined on.
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

    /**
     * Whether the referred party has done something real on the platform.
     *
     * <p>Updatable since V64. It was declared alongside {@code status = 'qualified'} and, like it,
     * was produced by nothing — so the desk read {@code false} on every row including the ones it
     * had just approved. Q17 supplies the activation event, and this flag and the status now move
     * together in {@link #qualify}: a row that says {@code qualified} while claiming the referee
     * never activated contradicts itself on the desk's own screen.
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
     * Salted digest of the address the referee redeemed from. Personal data; see the class Javadoc
     * for its purpose limitation and retention. Never returned on the wire.
     *
     * <p>Stored rather than merely compared and discarded, because the comparison it feeds is only
     * referrer-to-referee: the pattern a fraud desk is actually looking for is one referrer whose
     * <em>referees</em> all share an address, and that question can only be asked of rows that kept
     * the digest. It is also what makes {@link #sameIp} auditable after the fact instead of a
     * boolean nobody can check. No getter: nothing in Java needs to read it, and not having one is
     * the cheapest guarantee it never reaches a DTO.
     */
    @Column(name = "referred_ip_hash")
    @Getter(AccessLevel.NONE)
    private String referredIpHash;

    /**
     * Salted digest of the User-Agent the referee redeemed with. Personal data; see the class
     * Javadoc for its purpose limitation and retention. Never returned on the wire, and no getter,
     * for the same reasons as {@link #referredIpHash}.
     */
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
            boolean aadhaarVerified, boolean aadhaarUnique, boolean velocityHigh,
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
        this.aadhaarVerified = aadhaarVerified;
        this.aadhaarUnique = aadhaarUnique;
        this.sameDevice = sameDevice;
        this.sameIp = sameIp;
        this.velocityHigh = velocityHigh;
        this.referredIpHash = signals.ipHash();
        this.referredDeviceHash = signals.deviceHash();
        this.at = Instant.now();
    }

    /**
     * Record that the referee's first listing cleared the ownership gate (Q17).
     *
     * <p>Returns whether anything changed, and that return value <em>is</em> the idempotency: the
     * announcement runs inside the verification write's transaction, so a retried write announces
     * again, and a second verified listing by the same owner announces a different property against
     * the same referral. Both must mint exactly nothing the second time. Guarding on
     * {@code qualifiedAt == null} rather than on the property id makes that true for a repeat of the
     * same announcement and for a genuinely different listing alike, which is what "first listing"
     * has to mean if a second one is not to buy a second credit.
     *
     * <p>Only a {@code pending} referral qualifies. A row the desk has already rejected must not be
     * resurrected by a later verification, and one already {@code rewarded} has nothing left to
     * gain — the caller checks the status because it also has to decide whether to consume a slot in
     * the referrer's monthly allowance.
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
