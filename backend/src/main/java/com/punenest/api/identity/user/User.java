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

    /**
     * The natural key, and the one column erasure cannot blank.
     *
     * <p>{@code updatable = false} was here to stop a profile edit from moving somebody's identity
     * out from under every {@code user_id} on the platform, and that reason still holds — there is
     * still no setter. It had to be relaxed for exactly one write, {@link #erasePersonalData}, which
     * replaces the number with a pseudonym; the guarantee is now carried by the absence of a setter
     * rather than by the mapping, which is a weaker fence in the same place.
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
     * Owner preference: stay masked even after approving a contact request (V31, tech-debt D5).
     *
     * <p>Not a second gate — an owner who hides their number still approves requests, and the buyer
     * still gets a conversation. The only thing withheld is the ten digits. Lives here rather than on
     * the listing because the number is the person's, not the flat's.
     */
    @Column(name = "hide_number", nullable = false)
    @Setter
    private boolean hideNumber = false;

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

    /**
     * Irreversibly de-identify this account — the {@code users} half of a DPDP erasure
     * ({@code identity.user.erasure.ErasureService}, tech debt D177).
     *
     * <p>One method rather than a handful of setters because these fields have to stop being true
     * <em>together</em>. An erasure that cleared the name and left the email is not a partial
     * erasure, it is a failed one, and the failure would be invisible: the account would look erased
     * on every screen that renders a name.
     *
     * <p><strong>The row survives.</strong> Fifty-five tables carry a foreign key into this one and
     * are retained for reasons set out in {@code ErasureRetention} — deleting the row would either
     * cascade through all of them or violate every one of those constraints. What is removed is the
     * ability to identify a person from it, which is what the statute asks for; the row becomes an
     * anchor with nobody behind it.
     *
     * <p>{@code role} and {@code listingsCount} are left alone deliberately: neither identifies
     * anybody, and blanking the role would move an erased owner's retained listings into a state the
     * platform has no notion of.
     *
     * @param pseudonymMobile a stand-in satisfying the column's NOT NULL, UNIQUE and format CHECK;
     *                        derived from the row id, never from the number it replaces
     */
    public void erasePersonalData(String pseudonymMobile) {
        this.mobile = pseudonymMobile;
        this.name = null;
        this.email = null;
        this.avatar = null;
        this.city = null;
        // Credentials, not merely personal data: an erased account must not be able to authenticate.
        // Passwordless sign-in keys off `mobile`, which has just been replaced, and the password
        // path keys off this hash. Both are now dead.
        this.passwordHash = null;
        this.mobileVerified = false;
        this.verified = false;
        this.aadhaarVerified = false;
        this.lastActive = null;
        // 'archived' is the strongest of the three CHECKed states and the one every read path
        // already excludes. There is no 'erased' status and adding one would need a CHECK change
        // that every deployed database would have to take before this code could run at all.
        this.status = "archived";
        archive("Erased on the account holder's request (DPDP s.12(3))");
    }
}
