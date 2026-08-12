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
 *
 * <p><strong>It also carries the referrer's half of the D55 correlation signals (V64).</strong>
 * Stamped once, when the code is minted — which is the moment the referrer opened the share screen,
 * so it is the device the link is about to be sent from. Refreshing them on every read would put a
 * write on a read path for an advisory signal, and would make the data worse rather than better: a
 * referrer who last opened the screen from an office network would then match every colleague who
 * signed up there that afternoon. See {@link ReferralSignals} for what is stored and why it is
 * hashed; the digests are personal data, purpose-limited to referral fraud detection, and blanked
 * ninety days after {@code signalsAt} by {@link ReferralSignalRetention}.
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
     * Salted digest of the address the code was minted from, or null on a row minted before V64.
     * Compared against the referee's at redemption; a null never matches, so those referrers keep
     * the old behaviour of {@code sameIp} reading false.
     */
    @Column(name = "referrer_ip_hash")
    private String referrerIpHash;

    /** Salted digest of the User-Agent the code was minted with. As {@link #referrerIpHash}. */
    @Column(name = "referrer_device_hash")
    private String referrerDeviceHash;

    /**
     * When the two digests above were captured, and the start of their ninety-day retention window.
     *
     * <p>{@code createdAt} cannot serve: it is NOT NULL on rows that predate V64 and therefore
     * carry no digests, so a sweep keyed on it would spend every tick rewriting rows that hold
     * nothing.
     */
    @Column(name = "signals_at")
    private Instant signalsAt;

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

    ReferralCode(UUID userId, String code, ReferralSignals.Signals signals) {
        this.userId = userId;
        this.code = code;
        this.referrerIpHash = signals.ipHash();
        this.referrerDeviceHash = signals.deviceHash();
        this.signalsAt = signals.equals(ReferralSignals.Signals.NONE) ? null : Instant.now();
    }
}
