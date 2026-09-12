package com.draazy.api.identity.auth;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * A single-use invite that lets one back-office colleague set their own password. Maps
 * {@code staff_invites} (V71, tech debt D206).
 *
 * <p><strong>What it is for.</strong> V67 stopped one administrator minting a colleague alone, but
 * the create form still carried a {@code password} field — so the maker chose the credential the
 * new account would sign in with, and the checker's co-signature attested to a row rather than to a
 * person. A row here means the account has no usable password and cannot authenticate at all until
 * the human it belongs to redeems the token and chooses one. Neither administrator ever sees that
 * token: it is handed straight to {@link com.draazy.api.provider.StaffInviteSender} and never
 * returned to an HTTP caller.
 *
 * <p><strong>Only the digest of the secret is stored.</strong> The token given to the invitee is
 * {@code <id>.<secret>}: the id is a selector that fetches exactly this row, and the secret is
 * verified with {@link java.security.MessageDigest#isEqual} — see {@link StaffInviteService}. A dump
 * of this table is therefore not replayable, on the same reasoning as {@code refresh_tokens} and
 * {@code otp_codes}.
 *
 * <p>No setters. {@link #redeem()} is the only mutation, it is one-way, and it refuses a second
 * call — single use is the property this class exists to be, and a setter would hand it away.
 */
@Entity
@Table(name = "staff_invites")
@Getter
public class StaffInvite extends BaseEntity {

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /** {@code sha256(secret)}. The raw token is never persisted anywhere. */
    @Column(name = "token_hash", nullable = false, updatable = false)
    private String tokenHash;

    /**
     * The administrator who minted the account. Kept for the audit trail only — this person is
     * deliberately never told the token, which is the whole content of D206.
     */
    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    /** Null while the invite is open, which is what blocks the account from authenticating. */
    @Column(name = "redeemed_at")
    private Instant redeemedAt;

    protected StaffInvite() {
        // JPA
    }

    /** A new, open invite for {@code userId}, minted by {@code createdBy}. */
    public StaffInvite(UUID userId, String tokenHash, UUID createdBy, Instant expiresAt) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.createdBy = createdBy;
        this.expiresAt = expiresAt;
    }

    /** Has the invitee already set their password? The one question the login gate asks. */
    public boolean isRedeemed() {
        return redeemedAt != null;
    }

    public boolean isExpired(Instant now) {
        return !now.isBefore(expiresAt);
    }

    /**
     * Burn the invite.
     *
     * <p>Refuses a second call with an {@link IllegalStateException} rather than an
     * {@code ApiException}: the service ahead of this already answers a redeemed token with the same
     * deliberately vague 401 it gives an unknown one, so reaching here twice means a <em>caller</em>
     * is wrong, not a user. Stated twice on purpose — single use enforced in exactly one place is
     * single use until the next write path forgets.
     */
    public void redeem() {
        if (redeemedAt != null) {
            throw new IllegalStateException("invite already redeemed: " + getId());
        }
        this.redeemedAt = Instant.now();
    }
}
