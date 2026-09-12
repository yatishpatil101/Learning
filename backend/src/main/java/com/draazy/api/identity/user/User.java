package com.draazy.api.identity.user;

import com.draazy.api.common.persistence.SoftDeleteEntity;
import com.draazy.api.security.Roles;
import com.draazy.api.security.TokenSubject;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.DynamicUpdate;

/**
 * The identity root every other table hangs off; maps {@code users} (V2). Text-mapped enum columns,
 * {@code @DynamicUpdate} and the erasure contract: docs/system/data-model.md § Identity root notes.
 */
@Entity
@Table(name = "users")
@DynamicUpdate
@Getter
public class User extends SoftDeleteEntity implements TokenSubject {

    @Column(name = "name")
    @Setter
    private String name;

    /**
     * The natural key, and the one column erasure cannot blank. No setter: that absence, rather than
     * {@code updatable = false}, is what keeps identity from moving under every {@code user_id}.
     */
    @Column(name = "mobile", nullable = false, unique = true)
    private String mobile;

    @Column(name = "email")
    @Setter
    private String email;

    /** BCrypt hash — staff/admin only; buyers/owners are passwordless (mobile-OTP). */
    @Column(name = "password_hash")
    @Setter
    private String passwordHash;

    @Column(name = "role", nullable = false)
    @Setter
    private String role = Roles.Wire.BUYER;

    @Column(name = "team")
    @Setter
    private String team;

    @Column(name = "status", nullable = false)
    @Setter
    private String status = "active";

    @Column(name = "city")
    @Setter
    private String city;

    /** L1 trust floor (ADR-019): the participation gate for contacting owners. */
    @Column(name = "mobile_verified", nullable = false)
    @Setter
    private boolean mobileVerified = false;

    /** L2 opt-in badge — a trust signal, never a hard gate. */
    @Column(name = "verified", nullable = false)
    @Setter
    private boolean verified = false;

    @Column(name = "aadhaar_verified", nullable = false)
    @Setter
    private boolean aadhaarVerified = false;

    /** Owner preference: only accept contact requests from L2-verified users. */
    @Column(name = "verified_contact_only", nullable = false)
    @Setter
    private boolean verifiedContactOnly = false;

    /**
     * Owner preference: stay masked even after approving a contact request (V31). Not a second gate —
     * the request is still approved and the conversation still happens; only the digits are withheld.
     */
    @Column(name = "hide_number", nullable = false)
    @Setter
    private boolean hideNumber = false;

    /**
     * How many listings this account has <em>ever</em> posted, including the rejected and archived —
     * a persona predicate, never a quota input. See {@link #recordListingPosted()}.
     */
    @Column(name = "listings_count", nullable = false)
    private int listingsCount = 0;

    @Column(name = "avatar")
    @Setter
    private String avatar;

    /**
     * Hibernate-populated like {@code created_at}, since entities boot under {@code ddl-auto=validate}
     * and cannot rely on the schema's {@code DEFAULT now()} (that only covers raw-SQL inserts).
     */
    @CreationTimestamp
    @Column(name = "joined_at", nullable = false, updatable = false)
    private Instant joinedAt;

    @Column(name = "last_active")
    @Setter
    private Instant lastActive;

    /**
     * Internal review marker (V77) — a note between colleagues, deliberately not a status. No
     * {@code @Setter}: the four columns move together. See docs/system/data-model.md.
     */
    @Column(name = "flagged", nullable = false)
    private boolean flagged = false;

    @Column(name = "flag_reason")
    private String flagReason;

    @Column(name = "flagged_at")
    private Instant flaggedAt;

    @Column(name = "flagged_by")
    private UUID flaggedBy;

    protected User() {
        // JPA
    }

    public User(String mobile, String role) {
        this.mobile = mobile;
        this.role = role;
    }

    /**
     * Raise the internal review flag, or re-raise it with a fresh reason. Overwrites rather than
     * appends: the column answers "what should the next person look at"; the history is audited.
     */
    public void flag(String reason, UUID by) {
        this.flagged = true;
        this.flagReason = reason;
        this.flaggedAt = Instant.now();
        this.flaggedBy = by;
    }

    /**
     * Lower the flag and forget what it said: a reason left on an unflagged account reads on every
     * later screen as an accusation that was never withdrawn. What happened is in {@code audit_log}.
     */
    public void clearFlag() {
        this.flagged = false;
        this.flagReason = null;
        this.flaggedAt = null;
        this.flaggedBy = null;
    }

    /**
     * Record that this account has posted a listing. Monotonic on purpose, an increment rather than a
     * setter, and its lost-update race is accepted — docs/system/data-model.md § Identity root notes.
     */
    public void recordListingPosted() {
        this.listingsCount++;
    }

    /**
     * Irreversibly de-identify this account — the {@code users} half of a DPDP erasure. One method
     * because these fields must stop being true together; what survives and why: data-model.md.
     */
    public void erasePersonalData(String pseudonymMobile) {
        this.mobile = pseudonymMobile;
        this.name = null;
        this.email = null;
        this.avatar = null;
        this.city = null;
        // Credentials, not merely personal data: both sign-in paths key off `mobile` (just replaced)
        // and this hash. Both are now dead.
        this.passwordHash = null;
        this.mobileVerified = false;
        this.verified = false;
        this.aadhaarVerified = false;
        this.lastActive = null;
        // 'archived' is the strongest CHECKed state and already excluded by every read path; a new
        // 'erased' value would need a CHECK change on every deployed database first.
        this.status = "archived";
        archive("Erased on the account holder's request (DPDP s.12(3))");
    }
}
