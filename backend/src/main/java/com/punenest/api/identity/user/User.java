package com.punenest.api.identity.user;

import com.punenest.api.common.persistence.SoftDeleteEntity;
import com.punenest.api.security.Roles;
import com.punenest.api.security.TokenSubject;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

/**
 * The identity root every other table hangs off (reconciliation #10: {@code *Mobile} natural keys
 * become {@code user_id} FKs). Maps the {@code users} table (V2).
 *
 * <p>Enum-like columns ({@code role}/{@code team}/{@code status}) are mapped as {@code String} to
 * mirror the schema's "text + CHECK" policy — the cheapest thing to evolve (add a value with one
 * ALTER, no Java enum change required). Validation of allowed values lives in the CHECK constraint
 * and the DTO layer, not here.
 * <p>Implements {@link TokenSubject} so {@code security.JwtService} can mint a token without
 * importing this package — the abstraction lives in the kernel and the feature satisfies it, which
 * keeps the context graph acyclic (see {@code docs/system/package-structure.md} §2). The interface
 * demands nothing new: it is exactly the five accessors the token already read.
 */
@Entity
@Table(name = "users")
@Getter
public class User extends SoftDeleteEntity implements TokenSubject {

    @Column(name = "name")
    @Setter
    private String name;

    @Column(name = "mobile", nullable = false, unique = true, updatable = false)
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

    @Column(name = "listings_count", nullable = false)
    private int listingsCount = 0;

    @Column(name = "avatar")
    @Setter
    private String avatar;

    /**
     * When the account was created. Hibernate-populated ({@link CreationTimestamp}) like
     * {@code created_at}, since entities boot under {@code ddl-auto=validate} and can't rely on the
     * schema's {@code DEFAULT now()} (that only covers raw-SQL inserts).
     */
    @CreationTimestamp
    @Column(name = "joined_at", nullable = false, updatable = false)
    private Instant joinedAt;

    @Column(name = "last_active")
    @Setter
    private Instant lastActive;

    protected User() {
        // JPA
    }

    public User(String mobile, String role) {
        this.mobile = mobile;
        this.role = role;
    }

}
