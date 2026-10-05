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

// The identity root other tables hang off; erasure contract: docs/system/data-model.md.
@Entity
@Table(name = "users")
@DynamicUpdate
@Getter
public class User extends SoftDeleteEntity implements TokenSubject {

    @Column(name = "name")
    @Setter
    private String name;

    // The natural key erasure cannot blank. No setter keeps identity from moving under user_id.
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

    @Column(name = "mobile_verified", nullable = false)
    @Setter
    private boolean mobileVerified = false;

    /** L2 opt-in identity badge — granted by staff review, a trust signal, never a hard gate. */
    @Column(name = "verified", nullable = false)
    @Setter
    private boolean verified = false;

    /** Owner preference: only accept contact requests from -verified users. */
    @Column(name = "verified_contact_only", nullable = false)
    @Setter
    private boolean verifiedContactOnly = false;

    // Not a second contact gate: the request is approved, only the digits are withheld.
    @Column(name = "hide_number", nullable = false)
    @Setter
    private boolean hideNumber = false;

    @Column(name = "share_activity_status", nullable = false)
    @Setter
    private boolean shareActivityStatus = true;

    @Column(name = "share_read_receipts", nullable = false)
    @Setter
    private boolean shareReadReceipts = true;

    // Persona predicate, never a quota input: includes rejected and archived listings.
    @Column(name = "listings_count", nullable = false)
    private int listingsCount = 0;

    @Column(name = "avatar")
    @Setter
    private String avatar;

    // Hibernate-populated because DEFAULT now only covers raw-SQL inserts.
    @CreationTimestamp
    @Column(name = "joined_at", nullable = false, updatable = false)
    private Instant joinedAt;

    @Column(name = "last_active")
    @Setter
    private Instant lastActive;

    // Internal review marker, deliberately not a status. No setter: the columns move together.
    @Column(name = "flagged", nullable = false)
    private boolean flagged = false;

    @Column(name = "flag_reason")
    private String flagReason;

    @Column(name = "flagged_at")
    private Instant flaggedAt;

    @Column(name = "flagged_by")
    private UUID flaggedBy;

    protected User() {

    }

    public User(String mobile, String role) {
        this.mobile = mobile;
        this.role = role;
    }

    // Overwrites rather than appends: the column says what the next person should inspect.
    public void flag(String reason, UUID by) {
        this.flagged = true;
        this.flagReason = reason;
        this.flaggedAt = Instant.now();
        this.flaggedBy = by;
    }

    public void clearFlag() {
        this.flagged = false;
        this.flagReason = null;
        this.flaggedAt = null;
        this.flaggedBy = null;
    }

    // Monotonic on purpose; lost-update race is accepted for this persona predicate.
    public void recordListingPosted() {
        this.listingsCount++;
    }

    // One method because these user PII fields must stop being true together.
    public void erasePersonalData(String pseudonymMobile) {
        this.mobile = pseudonymMobile;
        this.name = null;
        this.email = null;
        this.avatar = null;
        this.city = null;

        this.passwordHash = null;
        this.mobileVerified = false;
        this.verified = false;
        this.lastActive = null;

        this.status = "archived";
        archive("Erased on the account holder's request (DPDP s.12(3))");
    }
}
