package com.punenest.api.identity.user;

import com.punenest.api.common.persistence.SoftDeleteEntity;
import com.punenest.api.security.Roles;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.CreationTimestamp;

/**
 * The identity root every other table hangs off (reconciliation #10: {@code *Mobile} natural keys
 * become {@code user_id} FKs). Maps the {@code users} table (V2).
 *
 * <p>Enum-like columns ({@code role}/{@code team}/{@code status}) are mapped as {@code String} to
 * mirror the schema's "text + CHECK" policy — the cheapest thing to evolve (add a value with one
 * ALTER, no Java enum change required). Validation of allowed values lives in the CHECK constraint
 * and the DTO layer, not here.
 */
@Entity
@Table(name = "users")
public class User extends SoftDeleteEntity {

    @Column(name = "name")
    private String name;

    @Column(name = "mobile", nullable = false, unique = true, updatable = false)
    private String mobile;

    @Column(name = "email")
    private String email;

    /** BCrypt hash — staff/admin only; buyers/owners are passwordless (mobile-OTP). */
    @Column(name = "password_hash")
    private String passwordHash;

    @Column(name = "role", nullable = false)
    private String role = Roles.Wire.BUYER;

    @Column(name = "team")
    private String team;

    @Column(name = "status", nullable = false)
    private String status = "active";

    @Column(name = "city")
    private String city;

    /** L1 trust floor (ADR-019): the participation gate for contacting owners. */
    @Column(name = "mobile_verified", nullable = false)
    private boolean mobileVerified = false;

    /** L2 opt-in badge — a trust signal, never a hard gate. */
    @Column(name = "verified", nullable = false)
    private boolean verified = false;

    @Column(name = "aadhaar_verified", nullable = false)
    private boolean aadhaarVerified = false;

    /** Owner preference: only accept contact requests from L2-verified users. */
    @Column(name = "verified_contact_only", nullable = false)
    private boolean verifiedContactOnly = false;

    @Column(name = "listings_count", nullable = false)
    private int listingsCount = 0;

    @Column(name = "avatar")
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
    private Instant lastActive;

    protected User() {
        // JPA
    }

    public User(String mobile, String role) {
        this.mobile = mobile;
        this.role = role;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getMobile() {
        return mobile;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }

    public String getTeam() {
        return team;
    }

    public void setTeam(String team) {
        this.team = team;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getCity() {
        return city;
    }

    public void setCity(String city) {
        this.city = city;
    }

    public boolean isMobileVerified() {
        return mobileVerified;
    }

    public void setMobileVerified(boolean mobileVerified) {
        this.mobileVerified = mobileVerified;
    }

    public boolean isVerified() {
        return verified;
    }

    public void setVerified(boolean verified) {
        this.verified = verified;
    }

    public boolean isAadhaarVerified() {
        return aadhaarVerified;
    }

    public void setAadhaarVerified(boolean aadhaarVerified) {
        this.aadhaarVerified = aadhaarVerified;
    }

    public boolean isVerifiedContactOnly() {
        return verifiedContactOnly;
    }

    public void setVerifiedContactOnly(boolean verifiedContactOnly) {
        this.verifiedContactOnly = verifiedContactOnly;
    }

    public int getListingsCount() {
        return listingsCount;
    }

    public String getAvatar() {
        return avatar;
    }

    public void setAvatar(String avatar) {
        this.avatar = avatar;
    }

    public Instant getJoinedAt() {
        return joinedAt;
    }

    public Instant getLastActive() {
        return lastActive;
    }

    public void setLastActive(Instant lastActive) {
        this.lastActive = lastActive;
    }
}
